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
  if (!document.body) return;
  isWatchlistPanelHidden = !isWatchlistPanelHidden;
  window.localStorage.setItem(WATCHLIST_PANEL_STORAGE_KEY, String(isWatchlistPanelHidden));
  applyWatchlistPanelState();
}

function toggleWatchlistDropdown(show) {
  const container = document.querySelector(".watchlist-dropdown-container");
  const menu = $("watchlist-dropdown-menu");
  if (!container || !menu) {
    console.warn("Watchlist dropdown elements not found. Stale cache?");
    return;
  }

  const isVisible = typeof show === "boolean" ? !show : !menu.classList.contains("hidden");
  
  if (isVisible) {
    menu.classList.add("hidden");
    container.classList.remove("open");
  } else {
    syncWatchlistDropdown(); // Ensure list is fresh
    menu.classList.remove("hidden");
    container.classList.add("open");
  }
}

function showPrompt(title, message, defaultValue = "") {
  return new Promise((resolve) => {
    const modal = $("prompt-modal");
    const input = $("prompt-modal-input");
    const confirmBtn = $("prompt-modal-confirm");
    const cancelBtn = $("prompt-modal-cancel");
    const closeBtn = $("prompt-modal-close");
    
    if (!modal || !input) { 
      // Fallback if modal not present (stale cache)
      try { resolve(window.prompt(message, defaultValue)); } catch(e) { resolve(null); }
      return; 
    }

    $("prompt-modal-title").textContent = title;
    $("prompt-modal-message").textContent = message;
    input.value = defaultValue;
    input.classList.remove("hidden");
    modal.classList.remove("hidden");
    input.focus();

    const cleanup = (val) => {
      modal.classList.add("hidden");
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
      window.removeEventListener("keydown", onKeyDown);
      resolve(val);
    };

    const onKeyDown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); cleanup(input.value); }
      if (e.key === "Escape") { e.preventDefault(); cleanup(null); }
    };

    confirmBtn.onclick = () => cleanup(input.value);
    cancelBtn.onclick = () => cleanup(null);
    closeBtn.onclick = () => cleanup(null);
    window.addEventListener("keydown", onKeyDown);
  });
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = $("prompt-modal");
    const input = $("prompt-modal-input");
    const confirmBtn = $("prompt-modal-confirm");
    const cancelBtn = $("prompt-modal-cancel");
    const closeBtn = $("prompt-modal-close");
    
    if (!modal) { 
      try { resolve(window.confirm(message)); } catch(e) { resolve(false); }
      return; 
    }

    $("prompt-modal-title").textContent = title;
    $("prompt-modal-message").textContent = message;
    if (input) input.classList.add("hidden");
    modal.classList.remove("hidden");

    const cleanup = (val) => {
      modal.classList.add("hidden");
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      resolve(val);
    };

    confirmBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    if (closeBtn) closeBtn.onclick = () => cleanup(false);
  });
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
  const listContainer = $("watchlist-list-container");
  const activeNameLabel = $("active-watchlist-name");
  
  if (listContainer) {
    listContainer.innerHTML = "";
    Object.values(state.lists).forEach((list) => {
      const item = document.createElement("div");
      item.className = `menu-item${list.id === state.activeId ? " active" : ""}`;
      item.textContent = list.title;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        switchActiveWatchlist(list.id);
        toggleWatchlistDropdown(false);
      });
      listContainer.appendChild(item);
    });
  }

  const activeList = state.lists[state.activeId] || Object.values(state.lists)[0] || null;
  if (activeNameLabel) {
    activeNameLabel.textContent = activeList ? activeList.title : "Select Watchlist";
  }

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

async function createNewWatchlist() {
  const listName = await showPrompt("New Watchlist", "Enter a name for your new watchlist:");
  if (!listName || !listName.trim()) return;
  const state = getWatchlistsState();
  const id = `list_${Date.now()}`;
  state.lists[id] = { id, title: listName.trim(), symbols: [currentSymbol] };
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

async function renameActiveWatchlist() {
  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) return;

  const newName = await showPrompt("Rename Watchlist", "Enter a new name for this watchlist:", activeList.title);
  if (newName && newName.trim()) {
    activeList.title = newName.trim();
    saveWatchlistsState(state);
    syncWatchlistDropdown();
  }
}

async function clearActiveWatchlist() {
  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) return;

  const confirmed = await showConfirm("Clear Watchlist", `Are you sure you want to remove all symbols from "${activeList.title}"?`);
  if (confirmed) {
    activeList.symbols = [];
    saveWatchlistsState(state);
    loadWatchlistQuotes().catch((error) => console.error(error));
  }
}

async function copyActiveWatchlist() {
  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) return;

  const newName = await showPrompt("Copy Watchlist", "Enter a name for the copied watchlist:", `${activeList.title} (Copy)`);
  if (newName && newName.trim()) {
    const id = `list_${Date.now()}`;
    state.lists[id] = { id, title: newName.trim(), symbols: [...activeList.symbols] };
    state.activeId = id;
    saveWatchlistsState(state);
    syncWatchlistDropdown();
    loadWatchlistQuotes().catch((error) => console.error(error));
  }
}

async function deleteActiveWatchlist() {
  const state = getWatchlistsState();
  const activeList = state.lists[state.activeId];
  if (!activeList) return;

  const listIds = Object.keys(state.lists);
  if (listIds.length <= 1) {
    await showConfirm("Cannot Delete", "You must have at least one watchlist.");
    return;
  }

  const confirmed = await showConfirm("Delete Watchlist", `Are you sure you want to permanently delete "${activeList.title}"?`);
  if (confirmed) {
    delete state.lists[state.activeId];
    state.activeId = Object.keys(state.lists)[0];
    saveWatchlistsState(state);
    syncWatchlistDropdown();
    loadWatchlistQuotes().catch((error) => console.error(error));
  }
}
