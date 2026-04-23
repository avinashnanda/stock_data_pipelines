/* ═══════════════════════════════════════════════════════════════════════════
   NEWS — Announcements feed, fetcher control, sound alerts, polling
   ═══════════════════════════════════════════════════════════════════════════ */

let lastSeenAnnouncementDate = null;
let audioCtx = null;
let newsPollTimer = null;

function playBeep(type) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(type === 'positive' ? 880 : 220, audioCtx.currentTime);
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.5);
}

async function loadAnnouncements(params = {}) {
  try {
    const searchParams = new URLSearchParams();
    searchParams.append("limit", params.limit || 50);
    if (params.symbol) searchParams.append("symbol", params.symbol);
    if (params.start_date) searchParams.append("start_date", params.start_date);
    if (params.end_date) searchParams.append("end_date", params.end_date);
    if (params.sentiments) searchParams.append("sentiments", params.sentiments);
    const url = `/api/announcements?${searchParams.toString()}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.announcements || [];
  } catch (error) {
    console.error("Failed to fetch announcements:", error);
    return [];
  }
}

function renderNewsFeed(containerId, announcements) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = "";
  if (!announcements.length) {
    container.innerHTML = `<div class="screener-empty">No announcements available.</div>`;
    return;
  }
  announcements.forEach(item => {
    let sentimentClass = "sentiment-neutral";
    const sentiment = (item.sentiment || "").toLowerCase();
    if (sentiment.includes("positive") || sentiment.includes("good") || sentiment.includes("bullish")) {
      sentimentClass = "sentiment-positive";
    } else if (sentiment.includes("negative") || sentiment.includes("bad") || sentiment.includes("bearish")) {
      sentimentClass = "sentiment-negative";
    }
    const div = document.createElement("div");
    div.className = `news-card ${sentimentClass}`;
    const formattedSummary = window.marked ? marked.parse(item.summary || "No summary available.") : (item.summary || "No summary available.");
    const displayTitle = item.title ? item.title : (item.symbol || item.company_name || "Announcement");
    const displaySymbol = item.title ? `<div class="news-card-symbol" style="color: var(--accent); font-weight: bold; font-size: 13px; text-transform: uppercase;">${item.symbol || ""}</div>` : "";
    div.innerHTML = `
      <div class="news-card-header" style="cursor: pointer;" onclick="this.parentElement.classList.toggle('expanded')">
        <div style="display: flex; flex-direction: column; gap: 4px; padding-right: 12px;">
          ${displaySymbol}
          <div class="news-card-title">${displayTitle}</div>
        </div>
        <div class="news-card-date" style="white-space: nowrap; flex-shrink: 0;">${item.broadcast_date || item.fetched_at || ""}</div>
      </div>
      <div class="news-card-summary markdown-body">${formattedSummary}</div>
      ${item.pdf_url ? `<a href="${item.pdf_url}" target="_blank" class="news-card-link">View PDF</a>` : ""}
    `;
    container.appendChild(div);
  });
}

async function refreshNewsView() {
  const startEl = $("news-filter-start");
  const endEl = $("news-filter-end");
  const symbolEl = $("news-filter-symbol");
  const sentiments = [];
  if ($("news-filter-positive")?.checked) sentiments.push("POSITIVE");
  if ($("news-filter-negative")?.checked) sentiments.push("NEGATIVE");
  if ($("news-filter-neutral")?.checked) sentiments.push("NEUTRAL");
  const announcements = await loadAnnouncements({
    start_date: startEl?.value || "",
    end_date: endEl?.value || "",
    symbol: symbolEl?.value || "",
    sentiments: sentiments.join(","),
    limit: 50
  });
  renderNewsFeed("news-feed", announcements);
}

async function refreshActiveStockNews() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  const start_date = date.toISOString().split("T")[0];
  const announcements = await loadAnnouncements({
    symbol: currentSymbol.replace("NSE:", ""),
    limit: 30, start_date: start_date,
    sentiments: "POSITIVE,NEGATIVE"
  });
  renderNewsFeed("active-stock-news", announcements);
}

async function toggleFetcher() {
  try {
    const response = await fetch("/api/announcements/toggle", { method: "POST" });
    const data = await response.json();
    updateFetcherButtonState(data.running);
  } catch (error) { console.error("Failed to toggle fetcher:", error); }
}

async function checkFetcherStatus() {
  try {
    const response = await fetch("/api/announcements/status");
    const data = await response.json();
    updateFetcherButtonState(data.running);
    const progressContainer = $("fetcher-progress-container");
    if (data.running) {
      if (progressContainer) progressContainer.style.display = "flex";
      const pct = data.total ? (data.processed / data.total) * 100 : 0;
      if ($("fetcher-progress")) $("fetcher-progress").value = pct;
      if ($("fetcher-status-text")) {
        let txt = `Processing: ${data.processed}/${data.total}`;
        if (data.current_company) txt += ` (${data.current_company})`;
        $("fetcher-status-text").textContent = txt;
      }
    } else {
      if (progressContainer) progressContainer.style.display = "none";
    }
  } catch (error) { console.error("Failed to check fetcher status:", error); }
}

async function checkFundamentalStatus() {
  try {
    const response = await fetch("/api/announcements/refresh_fundamentals_status");
    const data = await response.json();
    const progressContainer = $("fundamental-progress-container");
    const btn = $("news-refresh-fundamentals");
    if (data.running) {
      if (progressContainer) progressContainer.style.display = "flex";
      if (btn) { btn.textContent = "Refreshing..."; btn.disabled = true; }
      const pct = data.total ? (data.processed / data.total) * 100 : 0;
      if ($("fundamental-progress")) $("fundamental-progress").value = pct;
      if ($("fundamental-status-text")) $("fundamental-status-text").textContent = `Refreshing: ${data.processed}/${data.total}`;
    } else {
      if (progressContainer) progressContainer.style.display = "none";
      if (btn && btn.textContent === "Refreshing...") { btn.textContent = "Refresh Fundamentals"; btn.disabled = false; }
    }
    if (data.last_refresh) {
      const dateStr = new Date(data.last_refresh).toLocaleString();
      if ($("fundamental-last-refresh")) $("fundamental-last-refresh").textContent = `Updated: ${dateStr}`;
      if ($("fundamental-count")) $("fundamental-count").textContent = `${data.company_count} Companies`;
    } else {
      if ($("fundamental-last-refresh")) $("fundamental-last-refresh").textContent = `Updated: Never`;
      if ($("fundamental-count")) $("fundamental-count").textContent = `0 Companies`;
    }
  } catch (error) { console.error("Failed to check fundamental status:", error); }
}

function updateFetcherButtonState(isRunning) {
  const btn = $("news-fetcher-toggle");
  if (btn) {
    btn.textContent = isRunning ? "Stop Fetcher" : "Start Fetcher";
    btn.className = isRunning ? "primary-button" : "secondary-button";
  }
}

function startNewsPolling() {
  if (newsPollTimer) clearInterval(newsPollTimer);
  newsPollTimer = setInterval(async () => {
    if (currentView === "news") refreshNewsView();
    const latestAnnouncements = await loadAnnouncements({ limit: 5 });
    if (latestAnnouncements.length > 0) {
      const maxDate = latestAnnouncements[0].fetched_at;
      if (lastSeenAnnouncementDate && maxDate > lastSeenAnnouncementDate) {
        if ($("news-sound-toggle")?.checked) {
          const item = latestAnnouncements[0];
          const watchlistOnly = $("news-sound-watchlist")?.checked;
          const state = getWatchlistsState();
          const activeList = state.lists[state.activeId];
          let shouldPlay = true;
          if (watchlistOnly && activeList && item.symbol) {
            if (!activeList.symbols.includes(`NSE:${item.symbol}`)) shouldPlay = false;
          }
          if (shouldPlay) {
            const sentiment = (item.sentiment || "").toLowerCase();
            if (sentiment.includes("positive") || sentiment.includes("good") || sentiment.includes("bullish")) playBeep("positive");
            else if (sentiment.includes("negative") || sentiment.includes("bad") || sentiment.includes("bearish")) playBeep("negative");
          }
        }
      }
      lastSeenAnnouncementDate = maxDate;
    }
    refreshActiveStockNews();
    checkFetcherStatus();
    checkFundamentalStatus();
  }, 10000);
}
