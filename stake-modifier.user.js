// ==UserScript==
// @name         Stake.com Visual Balance & Live Stats Modifier
// @namespace    http://tampermonkey.net/
// @version      9.11
// @description  Adds a persistent fake USDC balance, live stat tracking with a working graph, and an integrated settings UI to visually simulate gameplay on Stake.com (including slots). Now with balance decrease on losses!
// @author       XaRTeCK (Enhanced by Gemini)
// @match        *://stake.com/*
// @match        *://rgs.twist-rgs.com/*
// @connect      stake.com
// @connect      rgs.twist-rgs.com
// @license      CC-BY-NC-ND-4.0
// @grant        none
// @run-at       document-start
// @downloadURL https://update.greasyfork.org/scripts/590760/Stakecom%20Visual%20Balance%20%20Live%20Stats%20Modifier.user.js
// @updateURL https://update.greasyfork.org/scripts/590760/Stakecom%20Visual%20Balance%20%20Live%20Stats%20Modifier.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const BALANCE_STORAGE_KEY = 'stake_fake_usdc_balance_v1';
    const STATS_STORAGE_KEY = 'stake_fake_stats_usdc_v1';
    const DEFAULT_USDC_VALUE = 1000;
    // USDC is an ERC-20 token with 6 decimals, so 1 USDC = 1,000,000 base units
    const USDC_BASE_UNITS = 1_000_000;

    let currentFakeBet = { amount: 0, currency: null };
    let fakeStats = getFakeStats();

    // ============================================================
    // Popup event handling — bound IMMEDIATELY at document-start,
    // before any Stake.com script exists, so our capture-phase
    // listeners are the first ones the browser calls.
    // ============================================================
    let lastPopupActionTime = 0;

    function handlePopupEvent(event) {
        // Keyboard support: Enter / Space, only when focus is inside the popup.
        if (event.type === 'keydown') {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const popup = document.getElementById('visual-script-welcome');
            if (!popup || !popup.contains(document.activeElement)) return;
        }

        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target || typeof target.closest !== 'function') return;

        const trigger = target.closest('#popup-balance-save, #visual-script-close, #visual-script-overlay');
        if (!trigger) return;

        // Prevent Stake's own handlers from also reacting to our popup.
        event.stopImmediatePropagation();
        if (event.type === 'keydown') event.preventDefault();

        // pointerdown + mousedown + click all fire for a single press — act on the first only.
        const now = Date.now();
        if (now - lastPopupActionTime < 250) return;
        lastPopupActionTime = now;

        if (trigger.id === 'popup-balance-save') {
            const input = document.getElementById('popup-fake-balance-input');
            let saved = false;
            try {
                saved = setFakeUsdcValue(input ? input.value : '');
            } catch (err) {
                console.error('[Visual Modifier] setFakeUsdcValue error:', err);
            }
            trigger.textContent = saved ? 'Saved!' : 'Set Balance';
            trigger.style.backgroundColor = saved ? '#6CDE07' : '#008756';
            setTimeout(() => {
                trigger.textContent = 'Set Balance';
                trigger.style.backgroundColor = '#008756';
            }, 1500);
        } else {
            document.getElementById('visual-script-welcome')?.remove();
            document.getElementById('visual-script-overlay')?.remove();
        }
    }

    ['click', 'pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach((type) => {
        document.addEventListener(type, handlePopupEvent, true);
    });
    console.log('[Visual Modifier] Popup handlers bound at document-start.');

    function getFakeUsdcValue() {
        const savedBalance = localStorage.getItem(BALANCE_STORAGE_KEY);
        return savedBalance ? parseFloat(savedBalance) : DEFAULT_USDC_VALUE;
    }

    // Best effort: find the element(s) currently displaying the balance and rewrite the
    // text immediately, without waiting for a React re-render or a balance refetch.
    function updateVisibleBalance(value) {
        const text = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let updated = false;
        const seen = new Set();

        const maybeUpdate = (el) => {
            if (seen.has(el) || el.children.length > 0) return; // skip containers/buttons with icons
            seen.add(el);
            const raw = (el.textContent || '').trim();
            if (!raw || raw.length > 20 || !/^[\d\s.,-]+$/.test(raw)) return; // must look like a plain number
            el.textContent = text;
            updated = true;
        };

        document.querySelectorAll('[data-testid*="balance" i], [data-testid*="wallet" i]').forEach(maybeUpdate);
        return updated;
    }

    // Hardened: writes the value to storage AND tries to update the visible balance live.
    function setFakeUsdcValue(amount) {
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount < 0) return false;

        try {
            localStorage.setItem(BALANCE_STORAGE_KEY, numericAmount.toString());
        } catch (e) {
            console.error('[Visual Modifier] Could not save balance to localStorage:', e);
            return false;
        }

        const footerInput = document.getElementById('fake-balance-input-usdc');
        if (footerInput) footerInput.value = numericAmount.toFixed(2);

        const updated = updateVisibleBalance(numericAmount);
        if (!updated) {
            console.warn('[Visual Modifier] Balance saved to storage, but no visible balance element was found. A page refresh will apply it.');
        }

        // Fallback nudge: forces Stake's balance component to re-render if this selector still exists.
        try {
            const balanceToggle = document.querySelector('[data-testid="balance-toggle"] button');
            if (balanceToggle) {
                balanceToggle.click();
                setTimeout(() => balanceToggle.click(), 50);
            }
        } catch (e) {}

        return true;
    }

    function getFakeStats() {
        const savedStats = localStorage.getItem(STATS_STORAGE_KEY);
        const defaultStats = { profit: 0, wagered: 0, wins: 0, losses: 0, profitHistory: [0] };
        if (savedStats) {
            const parsed = JSON.parse(savedStats);
            if (!Array.isArray(parsed.profitHistory) || parsed.profitHistory.length === 0) {
                parsed.profitHistory = [0];
            }
            return { ...defaultStats, ...parsed };
        }
        return defaultStats;
    }

    function saveFakeStats(stats) {
        localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
    }

    function resetFakeStats() {
        fakeStats = { profit: 0, wagered: 0, wins: 0, losses: 0, profitHistory: [0] };
        saveFakeStats(fakeStats);
        updateLiveStatsDisplay();
    }

    function showBalanceSetupPopup() {
        if (document.getElementById('visual-script-welcome')) return; // avoid duplicates
        const popupHTML = `
            <div id="visual-script-welcome" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: auto !important; background-color: #2f3c4c; color: #fff; padding: 25px; border-radius: 10px; box-shadow: 0 5px 20px rgba(0,0,0,0.5); z-index: 2147483647; max-width: 450px; text-align: center; font-family: 'Inter', sans-serif;">
                <h2 style="margin: 0 0 15px 0; font-size: 22px;">Visual Gameplay Modifier Active</h2>
                <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.5; color: #b0bdce;">
                    Set your visual USDC balance below. You can change this amount anytime at the bottom of the Stake.com page. Your balance will increase on wins and decrease on losses!
                </p>
                <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 20px;">
                     <input type="number" step="0.01" id="popup-fake-balance-input" value="${getFakeUsdcValue()}"
                           style="pointer-events: auto !important; background-color: #1f2a38; border: 1px solid #3c4a5c; color: white; border-radius: 5px; padding: 10px; width: 100%; text-align: center; font-size: 16px;"
                    >
                    <button type="button" id="popup-balance-save" style="pointer-events: auto !important; background-color: #008756; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 16px; font-weight: bold; white-space: nowrap;">Set Balance</button>
                </div>
                <div style="display: flex; justify-content: flex-end; align-items: center;">
                    <button type="button" id="visual-script-close" style="pointer-events: auto !important; background-color: #55657e; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 16px; font-weight: bold;">Close</button>
                </div>
            </div>
            <div id="visual-script-overlay" style="pointer-events: auto !important; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2147483646;"></div>
        `;
        document.body.insertAdjacentHTML('beforeend', popupHTML);
        console.log('[Visual Modifier] Popup inserted.');
    }

    function drawFakeGraph(svg, history) {
        if (!svg) return;

        while (svg.firstChild) svg.removeChild(svg.firstChild);
        if (history.length < 2) return;

        const width = svg.clientWidth || 225;
        const height = svg.clientHeight || 170;
        const padding = 5;

        const maxProfit = Math.max(...history);
        const minProfit = Math.min(...history);
        const range = (maxProfit - minProfit) === 0 ? 1 : maxProfit - minProfit;

        const getCoords = (value, index) => {
            const x = (index / (history.length - 1)) * (width - padding * 2) + padding;
            const y = height - ((value - minProfit) / range) * (height - padding * 2) - padding;
            return { x: x.toFixed(2), y: y.toFixed(2) };
        };

        let linePathData = '';
        history.forEach((value, index) => {
            const { x, y } = getCoords(value, index);
            linePathData += `${index === 0 ? 'M' : 'L'} ${x} ${y} `;
        });

        const lastPoint = getCoords(history[history.length - 1], history.length - 1);
        const firstPoint = getCoords(history[0], 0);
        const fillPathData = `${linePathData} L ${lastPoint.x} ${height} L ${firstPoint.x} ${height} Z`;

        const finalProfit = history[history.length - 1];
        const color = finalProfit >= 0 ? 'var(--green-500)' : 'var(--red-500)';

        svg.innerHTML = `
            <path d="${fillPathData}" fill="${color}" fill-opacity="0.2"></path>
            <path d="${linePathData}" fill="none" stroke="${color}" stroke-width="2"></path>
        `;
    }

    function updateLiveStatsDisplay() {
        const profitEl = document.querySelector('[data-testid="bets-stats-profit"]');
        if (!profitEl) return;

        const statsContainer = profitEl.closest('div.draggable');
        if (!statsContainer) return;

        const wageredEl = statsContainer.querySelector('[data-testid="bets-stats-wagered"]');
        const winsEl = statsContainer.querySelector('[data-testid="bets-stats-wins"]');
        const lossesEl = statsContainer.querySelector('[data-testid="bets-stats-losses"]');
        const svg = statsContainer.querySelector('div.graph-wrap svg');

        if (wageredEl && winsEl && lossesEl) {
             // USDC is pegged 1:1 with USD, so no conversion multiplier is needed.
             const profitValue = fakeStats.profit;
             const wageredValue = fakeStats.wagered;
             const formatCurrency = (value) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' }).replace('$', '€');

             profitEl.textContent = formatCurrency(profitValue);
             profitEl.classList.remove('text-positive', 'text-critical');
             profitEl.classList.add(profitValue >= 0 ? 'text-positive' : 'text-critical');

             wageredEl.textContent = formatCurrency(wageredValue);
             winsEl.textContent = fakeStats.wins.toLocaleString('en-US');
             lossesEl.textContent = fakeStats.losses.toLocaleString('en-US');

             if (svg) {
                drawFakeGraph(svg, fakeStats.profitHistory);
             }
        }
    }

    function injectBalanceSettings(footerElement) {
        if (document.getElementById('fake-balance-settings')) return;
        const settingsHTML = `
            <div id="fake-balance-settings" class="p-4 mt-6 border-t-2 border-t-grey-500 text-grey-200">
              <div class="flex flex-col gap-2 max-w-sm mx-auto">
                <label for="fake-balance-input-usdc" class="ds-body-md-strong text-white text-center">Visual Balance Modifier</label>
                <p class="ds-body-sm text-center">This only changes the balance you see on your screen. Balance will update with wins and losses!</p>
                <input type="number" step="0.01" id="fake-balance-input-usdc" value="${getFakeUsdcValue().toFixed(2)}"
                       style="background-color: #1f2a38; border: 1px solid #3c4a5c; color: white; border-radius: 5px; padding: 8px; width: 100%; text-align: center;"
                >
                <button id="reset-stats-button-footer" style="background-color: #55657e; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold; margin-top: 10px;">Reset Live Stats</button>
                <span id="fake-balance-saved" style="color: #6CDE07; font-size: 12px; height: 16px; transition: opacity 0.3s ease-out; opacity: 0; text-align: center;">Saved!</span>
              </div>
            </div>
        `;
        footerElement.insertAdjacentHTML('afterbegin', settingsHTML);

        const input = document.getElementById('fake-balance-input-usdc');
        const savedMessage = document.getElementById('fake-balance-saved');
        const resetButton = document.getElementById('reset-stats-button-footer');
        let timeoutId;

        input.addEventListener('input', (event) => {
            setFakeUsdcValue(event.target.value);
            savedMessage.textContent = 'Saved!';
            savedMessage.style.opacity = '1';
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => { savedMessage.style.opacity = '0'; }, 1500);
        });

        resetButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to reset your visual stats (Profit, Wagered, Wins, Losses, and Graph)?')) {
                resetFakeStats();
                savedMessage.textContent = 'Stats Reset!';
                savedMessage.style.opacity = '1';
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    savedMessage.style.opacity = '0';
                }, 1500);
            }
        });
    }

    function updateStatsAndHistory(betAmount, payout) {
        const previousBalance = getFakeUsdcValue();
        let newBalance = previousBalance;

        fakeStats.wagered += betAmount;
        if (payout > 0) {
            fakeStats.wins++;
            fakeStats.profit += payout - betAmount;
            newBalance = previousBalance + (payout - betAmount);
        } else {
            fakeStats.losses++;
            fakeStats.profit -= betAmount;
            newBalance = previousBalance - betAmount;
        }

        // Ensure balance doesn't go negative
        newBalance = Math.max(0, newBalance);
        
        // Update the fake balance to reflect wins/losses
        setFakeUsdcValue(newBalance);
        
        fakeStats.profitHistory.push(fakeStats.profit);
        saveFakeStats(fakeStats);
        updateLiveStatsDisplay();
        
        console.log(`[Visual Modifier] Balance: ${previousBalance.toFixed(2)} → ${newBalance.toFixed(2)} | Profit: ${fakeStats.profit.toFixed(2)}`);
    }

    // ============ Slot support helpers ============

    // Recursively zero out every positive "amount" found anywhere in a request body
    // and return the total. Handles flat casino bodies as well as nested slot payloads.
    function zeroBetAmounts(obj) {
        let total = 0;
        if (!obj || typeof obj !== 'object') return total;
        if (typeof obj.amount === 'number' && obj.amount > 0) {
            total += obj.amount;
            obj.amount = 0;
        }
        for (const key of Object.keys(obj)) {
            if (key === 'amount') continue;
            const val = obj[key];
            if (Array.isArray(val)) {
                for (const item of val) total += zeroBetAmounts(item);
            } else if (val && typeof val === 'object') {
                total += zeroBetAmounts(val);
            }
        }
        return total;
    }

    // Deep-search a response for the game result object (an object that carries both an
    // amount and a payout / payoutMultiplier). Slot results are usually nested under "result".
    function findGameResult(data) {
        if (!data || typeof data !== 'object') return null;
        const seen = new Set();
        const queue = [data];
        while (queue.length) {
            const node = queue.shift();
            if (!node || typeof node !== 'object' || seen.has(node)) continue;
            seen.add(node);
            if (node.amount != null && (node.payout != null || node.payoutMultiplier != null)) {
                return node;
            }
            for (const key of Object.keys(node)) {
                const val = node[key];
                if (val && typeof val === 'object') queue.push(val);
            }
        }
        return null;
    }

    // ============ END helpers ============

    const originalFetch = window.fetch;
    window.fetch = async function(url, options) {
        const FAKE_USDC_BALANCE = getFakeUsdcValue();
        const FAKE_PROVIDER_BALANCE = FAKE_USDC_BALANCE * USDC_BASE_UNITS;
        const requestUrl = new URL(url.toString(), window.location.origin);
        const host = requestUrl.hostname;
        const path = requestUrl.pathname;

        if (host.includes('rgs.twist-rgs.com') && path.includes('/wallet/authenticate')) {
            const response = await originalFetch(url, options);
            const data = await response.clone().json();
            if (data.balance) data.balance.amount = FAKE_PROVIDER_BALANCE;
            return new Response(JSON.stringify(data), { status: 200, headers: response.headers });
        }

        if (host.includes('stake.com') && path.includes('/_api/graphql') && options?.body) {
            let requestBody;
            try { requestBody = JSON.parse(options.body); } catch (e) { return originalFetch(url, options); }
            let modifiedOptions = options;

            if (requestBody.operationName === 'UserBalances') {
                const response = await originalFetch(url, options);
                const data = await response.clone().json();
                const usdcBalance = data?.data?.user?.balances.find(b => b.available.currency === 'usdc');
                if (usdcBalance) usdcBalance.available.amount = FAKE_USDC_BALANCE;
                return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
            }

            if (requestBody.query?.includes('mutation') && requestBody.variables?.amount > 0) {
                currentFakeBet = { amount: requestBody.variables.amount, currency: requestBody.variables.currency };
                const modifiedBody = JSON.parse(JSON.stringify(requestBody));
                modifiedBody.variables.amount = 0;
                modifiedOptions = { ...options, body: JSON.stringify(modifiedBody) };
            }

            const response = await originalFetch(url, modifiedOptions);
            const responseClone = response.clone();
            try {
                const data = await response.json();
                if (data.data) {
                    const gameDataKey = Object.keys(data.data).find(key => data.data[key] && typeof data.data[key] === 'object' && 'amount' in data.data[key]);
                    if (gameDataKey && currentFakeBet.amount > 0) {
                        const gameData = data.data[gameDataKey];
                        gameData.amount = currentFakeBet.amount;
                        gameData.payout = (gameData.payoutMultiplier || 0) * currentFakeBet.amount;
                        updateStatsAndHistory(currentFakeBet.amount, gameData.payout);
                        if (!gameData.active) currentFakeBet = { amount: 0, currency: null };
                        return new Response(JSON.stringify(data), { status: 200, headers: response.headers });
                    }
                }
                return responseClone;
            } catch (e) { return responseClone; }
        }

        // ============ Casino API (covers slots too) ============
        if (host.includes('stake.com') && path.startsWith('/_api/casino/')) {
            let modifiedOptions = options;

            // Matches dice/roulette bets, bonus rounds, AND slot spins (/bet, /spin, /buy-feature, etc.)
            if (/\/(bet|roll|bonus|spin|play|buy)$/.test(path) && options?.body) {
                try {
                    const originalRequestBody = JSON.parse(options.body);
                    const modifiedBody = JSON.parse(JSON.stringify(originalRequestBody));
                    let totalAmount = 0;
                    if (path.includes('/roulette/bet')) {
                        ['colors', 'parities', 'dozens', 'numbers', 'columns', 'halves'].forEach(key => {
                            if (Array.isArray(modifiedBody[key])) modifiedBody[key].forEach(bet => { totalAmount += bet.amount; bet.amount = 0; });
                        });
                    } else {
                        // Slots (and everything else): zero any "amount" at any nesting depth
                        totalAmount = zeroBetAmounts(modifiedBody);
                    }
                    if (totalAmount > 0) {
                        currentFakeBet = {
                            amount: totalAmount,
                            currency: originalRequestBody.currency || currentFakeBet.currency || 'usdc'
                        };
                        modifiedOptions = { ...options, body: JSON.stringify(modifiedBody) };
                    }
                } catch (e) {}
            }

            const response = await originalFetch(url, modifiedOptions);
            const responseClone = response.clone();
            try {
                const data = await response.json();
                // Deep-search instead of only checking top-level keys -> handles slot "result" nesting
                const gameData = findGameResult(data);
                if (gameData && currentFakeBet.amount > 0) {
                    const isFreeSpin = (gameData.amount || 0) === 0;
                    const betForStats = isFreeSpin ? 0 : currentFakeBet.amount;

                    gameData.amount = currentFakeBet.amount;
                    gameData.payout = (gameData.payoutMultiplier || 0) * currentFakeBet.amount + (gameData.bonusPayout || 0);
                    if (gameData.payout === 0 && gameData.winAmount > 0) gameData.payout = gameData.winAmount;
                    if ('winAmount' in gameData) gameData.winAmount = gameData.payout;

                    updateStatsAndHistory(betForStats, gameData.payout);
                    if (gameData.state?.rounds) gameData.state.rounds.forEach(r => { if ('amount' in r) r.amount = currentFakeBet.amount; });

                    // Keep tracking while a slot bonus round is in progress; reset once fully done
                    if (!gameData.active && !gameData.bonusActive) currentFakeBet = { amount: 0, currency: null };
                    return new Response(JSON.stringify(data), { status: 200, headers: response.headers });
                }
                return responseClone;
            } catch (e) { return responseClone; }
        }
        return originalFetch(url, options);
    };

    window.addEventListener('DOMContentLoaded', () => {
        showBalanceSetupPopup();
        const mainObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    if (node.matches('footer[data-testid="footer"]') && !document.getElementById('fake-balance-settings')) {
                        injectBalanceSettings(node);
                    }
                    if (node.matches('div.draggable') && node.querySelector('[data-testid="bets-stats-profit"]')) {
                         setTimeout(() => updateLiveStatsDisplay(), 100);
                    }
                    const resetButton = node.matches('[data-testid="draggable-stats-reset"]') ? node : node.querySelector('[data-testid="draggable-stats-reset"]');
                    if (resetButton && !resetButton.dataset.scriptListenerAttached) {
                        resetButton.dataset.scriptListenerAttached = 'true';
                        resetButton.addEventListener('click', (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (confirm('Are you sure you want to reset your visual stats? This will clear the graph and all tracked data.')) {
                                resetFakeStats();
                            }
                        }, true);
                    }
                }
            }
        });
        mainObserver.observe(document.body, { childList: true, subtree: true });
    });
})();