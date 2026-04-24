/* ═══════════════════════════════════════════════════════════════════════════
   WATCHLIST — State CRUD, panel toggle, rendering, auto-refresh
   ═══════════════════════════════════════════════════════════════════════════ */

function applyWatchlistPanelState() {
  document.body.classList.toggle("watchlist-collapsed", isWatchlistPanelHidden);
  const panelToggle = $("watchlist-panel-toggle");
  const railToggle = $("watchlist-rail-toggle");
  if (panelToggle) {
    panelToggle.textContent = isWatchlistPanelHidden ? "‹" : "›";
    panelToggle.title = isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist";
    panelToggle.setAttribute("aria-label", isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist");
  }
  if (railToggle) {
    railToggle.textContent = "";
    railToggle.title = "Show watchlist";
    railToggle.setAttribute("aria-label", "Show watchlist");
    railToggle.classList.toggle("hidden", !isWatchlistPanelHidden);
  }
}

function toggleWatchlistPanel() {
  isWatchlistPanelHidden = !isWatchlistPanelHidden;
  window.localStorage.setItem(WATCHLIST_PANEL_STORAGE_KEY, String(isWatchlistPanelHidden));
  applyWatchlistPanelState();
}

function applyResponsiveWatchlistPanelState() {
  document.body.classList.toggle("watchlist-collapsed", isWatchlistPanelHidden);
  const panelToggle = $("watchlist-panel-toggle");
  const railToggle = $("watchlist-rail-toggle");
  if (panelToggle) {
    panelToggle.textContent = isWatchlistPanelHidden ? "‹" : "›";
    panelToggle.title = isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist";
    panelToggle.setAttribute("aria-label", isWatchlistPanelHidden ? "Show watchlist" : "Hide watchlist");
  }
  if (railToggle) {
    railToggle.textContent = "";
    railToggle.title = "Show watchlist";
    railToggle.setAttribute("aria-label", "Show watchlist");
    railToggle.classList.toggle("hidden", !isWatchlistPanelHidden);
  }
  scheduleScreenerLayoutSync();
}

function toggleResponsiveWatchlistPanel() {
  isWatchlistPanelHidden = !isWatchlistPanelHidden;
  window.localStorage.setItem(WATCHLIST_PANEL_STORAGE_KEY, String(isWatchlistPanelHidden));
  applyResponsiveWatchlistPanelState();
}

function setWatchlistStatus(message, tone = "") {
  const root = $("watchlist");
  root.innerHTML = "";
  const node = document.createElement("div");
  node.className = `watchlist-state${tone ? ` ${tone}` : ""}`;
  node.textContent = message;
  root.appendChild(node);
}

function getDefaultWatchlistsState() {
  return {
    activeId: "red_list",
    lists: {
      red_list: { id: "red_list", title: "Red list", symbols: ["NSE:RELIANCE", "NSE:TCS", "NSE:INFY", "NSE:HDFCBANK"] },
      banks: { id: "banks", title: "Banks", symbols: ["NSE:HDFCBANK", "NSE:ICICIBANK", "NSE:SBIN", "NSE:KOTAKBANK"] },
    },
  };
}

function getWatchlistsState() {
  try {
    const raw = window.localStorage.getItem(WATCHLISTS_STORAGE_KEY);
    if (!raw) return getDefaultWatchlistsState();
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.lists || !parsed.activeId) return getDefaultWatchlistsState();
    return parsed;
  } catch (error) {
    console.warn("Failed to parse watchlist state", error);
    return getDefaultWatchlistsState();
  }
}

function saveWatchlistsState(state) {
  window.localStorage.setItem(WATCHLISTS_STORAGE_KEY, JSON.stringify(state));
}

function getActiveWatchlist() {
  const state = getWatchlistsState();
  return state.lists[state.activeId] || Object.values(state.lists)[0] || null;
}

function syncWatchlistDropdown() {
  const state = getWatchlistsState();
  const select = $("watchlist-select");
  select.innerHTML = "";
  Object.values(state.lists).forEach((list) => {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.title;
    option.selected = list.id === state.activeId;
    select.appendChild(option);
  });
  const activeList = state.lists[state.activeId] || Object.values(state.lists)[0] || null;
  $("watchlist-subtitle").textContent = activeList
    ? `${activeList.symbols.length} symbols saved locally` : "Custom synced watchlist";
  $("watchlist-section-label").textContent = activeList ? activeList.title.toUpperCase() : "ACTIVE LIST";
}

async function loadWatchlistQuotes(options = {}) {
  const requestId = ++watchlistRequestId;
  const activeList = getActiveWatchlist();
  const root = $("watchlist");
  if (!activeList) { root.innerHTML = ""; return; }
  $("watchlist-count").textContent = String(activeList.symbols.length);
  if (!activeList.symbols.length) { renderWatchlist([]); return; }

  // Only show loading status if NOT a silent refresh
  if (!options.silent) {
    setWatchlistStatus("Loading watchlist...");
  }

  try {
    const response = await fetch(
      `/api/watchlist?source=${encodeURIComponent(currentSourceId)}&symbols=${encodeURIComponent(activeList.symbols.join(","))}`
    );
    const payload = await response.json();
    if (requestId !== watchlistRequestId) return;
    renderWatchlist(payload.items || []);
  } catch (error) {
    if (requestId !== watchlistRequestId) return;
    console.error(error);
    setWatchlistStatus("Failed to load watchlist.", "error");
  }
}

function renderWatchlist(items) {
  const root = $("watchlist");
  root.innerHTML = "";
  renderWatchlistStats(items);
  items.forEach((item) => {
    const symbolId = item.full_name || `NSE:${item.symbol}`;
    const row = document.createElement("div");
    row.className = "watchlist-item";
    if (symbolId === currentSymbol) row.classList.add("active");
    const changeClass = (item.change || 0) >= 0 ? "up" : "down";
    const last = item.price !== undefined ? Number(item.price).toFixed(2) : "--";
    const change = item.change !== undefined ? Number(item.change).toFixed(2) : "--";
    const pct = item.change_pct !== undefined ? `${Number(item.change_pct).toFixed(2)}%` : "--";
    row.innerHTML = `
      <button type="button" class="watchlist-main">
        <span class="watch-symbol">
          <span class="watch-symbol-line">
            <strong>${item.symbol}</strong>
            <span class="watch-dot"></span>
          </span>
          <small>${item.description || item.symbol}</small>
        </span>
        <span class="watch-last">${last}</span>
        <span class="watch-change ${changeClass}">${change}</span>
        <span class="watch-change ${changeClass}">${pct}</span>
      </button>
      <button type="button" class="watch-remove" aria-label="Remove ${item.symbol}" title="Remove ${item.symbol}">x</button>
    `;
    row.querySelector(".watchlist-main").addEventListener("click", () => {
      $("symbol-input").value = item.symbol;
      buildWidget({ symbol: symbolId, resolution: currentResolution });
    });
    row.querySelector(".watch-remove").addEventListener("click", (event) => {
      event.stopPropagation();
      removeSymbolFromActiveWatchlist(symbolId);
    });
    root.appendChild(row);
  });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.textContent = "No symbols in this watchlist yet.";
    root.appendChild(empty);
  }
}

function renderWatchlistStats(items) {
  const statsNode = $("watchlist-stats");
  const total = items.length;
  const gainers = items.filter((item) => Number(item.change || 0) > 0).length;
  const losers = items.filter((item) => Number(item.change || 0) < 0).length;
  const averageMove = total ? items.reduce((sum, item) => sum + Number(item.change_pct || 0), 0) / total : 0;
  statsNode.innerHTML = `
    <div class="watch-stat-card"><span>Symbols</span><strong>${total}</strong></div>
    <div class="watch-stat-card"><span>Up</span><strong class="up">${gainers}</strong></div>
    <div class="watch-stat-card"><span>Down</span><strong class="down">${losers}</strong></div>
    <div class="watch-stat-card"><span>Avg Move</span><strong class="${averageMove >= 0 ? "up" : "down"}">${averageMove.toFixed(2)}%</strong></div>
  `;
}

function startWatchlistAutoRefresh() {
  if (watchlistRefreshTimer) window.clearInterval(watchlistRefreshTimer);
  watchlistRefreshTimer = window.setInterval(() => {
    // Use silent refresh for auto-refresh to avoid UI flickering
    loadWatchlistQuotes({ silent: true }).catch((error) => console.error(error));
  }, 15000);
}

function addSymbolToActiveWatchlist(symbolText) {
  const symbol = normalizeSymbolInput(symbolText || "");
  if (!symbol) return;
  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) return;
  const fullSymbol = `NSE:${symbol}`;
  if (!activeList.symbols.includes(fullSymbol)) {
    activeList.symbols.push(fullSymbol);
    saveWatchlistsState(state);
    loadWatchlistQuotes().catch((error) => console.error(error));
  }
}

function removeSymbolFromActiveWatchlist(symbolText) {
  const symbol = normalizeSymbolInput(symbolText || "");
  if (!symbol) return;
  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) return;
  const fullSymbol = `NSE:${symbol}`;
  activeList.symbols = activeList.symbols.filter((item) => item !== fullSymbol);
  saveWatchlistsState(state);
  loadWatchlistQuotes().catch((error) => console.error(error));
}

function createNewWatchlist() {
  const listName = window.prompt("New watchlist name");
  if (!listName) return;
  const state = getWatchlistsState();
  const id = `list_${Date.now()}`;
  state.lists[id] = { id, title: listName, symbols: [currentSymbol] };
  state.activeId = id;
  saveWatchlistsState(state);
  syncWatchlistDropdown();
  loadWatchlistQuotes().catch((error) => console.error(error));
}

function switchActiveWatchlist(listId) {
  const state = getWatchlistsState();
  if (!state.lists[listId]) return;
  state.activeId = listId;
  saveWatchlistsState(state);
  syncWatchlistDropdown();
  loadWatchlistQuotes().catch((error) => console.error(error));
}
