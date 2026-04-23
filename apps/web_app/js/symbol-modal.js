/* ═══════════════════════════════════════════════════════════════════════════
   SYMBOL MODAL — Add-symbol search dialog
   ═══════════════════════════════════════════════════════════════════════════ */

function setSymbolSearchStatus(message) {
  $("symbol-search-status").textContent = message;
}

function openSymbolModal() {
  const modal = $("symbol-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  $("symbol-search-input").value = "";
  $("symbol-search-results").innerHTML = "";
  setSymbolSearchStatus("Start typing to search symbols.");
  window.setTimeout(() => $("symbol-search-input").focus(), 0);
}

function closeSymbolModal() {
  const modal = $("symbol-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function searchSymbols(query) {
  const resultsNode = $("symbol-search-results");
  resultsNode.innerHTML = "";
  if (!query.trim()) { setSymbolSearchStatus("Start typing to search symbols."); return; }
  setSymbolSearchStatus("Searching...");
  const response = await fetch(
    `/api/search?source=${encodeURIComponent(currentSourceId)}&query=${encodeURIComponent(query)}`
  );
  const payload = await response.json();
  const items = payload.items || [];
  if (!items.length) { setSymbolSearchStatus("No matching symbols found."); return; }
  setSymbolSearchStatus(`Found ${items.length} matches.`);
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol-result";
    button.innerHTML = `
      <span class="symbol-result-main">
        <strong>${item.symbol}</strong>
        <small>${item.exchange || "NSE"}</small>
      </span>
      <span class="symbol-result-desc">${item.description || item.full_name || item.symbol}</span>
    `;
    button.addEventListener("click", () => {
      addSymbolToActiveWatchlist(item.full_name || `NSE:${item.symbol}`);
      closeSymbolModal();
    });
    resultsNode.appendChild(button);
  });
}
