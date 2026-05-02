/* ═══════════════════════════════════════════════════════════════════════════
   NEWS — Announcements feed, arrival detection, sidebar, RED LIST, sounds
   ═══════════════════════════════════════════════════════════════════════════ */

let lastSeenAnnouncementDate = null;
let audioCtx = null;
let newsPollTimer = null;
let newsTimeAgoTimer = null;
let newsClockTimer = null;
let latestFetchedAt = null;
let cachedAnnouncements = [];
let watchlistNewsCache = [];

/* Sound mode: 'off' | 'all' | 'watchlist' */
let soundMode = 'off';

/* ── Arrival Detection ──────────────────────────────────────────────────── */

function getLastSeenTime() {
  return localStorage.getItem('announcements_lastSeenTime') || '1970-01-01T00:00:00';
}

function setLastSeenTime(isoStr) {
  localStorage.setItem('announcements_lastSeenTime', isoStr);
}

function markAllSeen() {
  if (latestFetchedAt) setLastSeenTime(latestFetchedAt);
  document.querySelectorAll('.news-card.is-new').forEach(c => c.classList.remove('is-new'));
  document.querySelectorAll('.news-new-tag').forEach(t => t.remove());
  updateNewBadge(0);
}

/* ── Time Formatting ────────────────────────────────────────────────────── */

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Handle "DD-Mon-YYYY HH:MM:SS" format from BSE
  const bseMatch = String(dateStr).match(/^(\d{1,2})-(\w{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (bseMatch) {
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const [, d, mon, y, h, m, s] = bseMatch;
    return new Date(Number(y), months[mon] || 0, Number(d), Number(h), Number(m), Number(s));
  }
  // Try ISO / standard Date parsing
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatExactTime(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return dateStr || '';
  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[d.getMonth()];
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${day} ${mon} ${h}:${m}:${s}`;
}

function formatTimeAgo(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return '0s ago';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getSentimentClass(sentiment) {
  const s = (sentiment || '').toLowerCase();
  if (s.includes('positive') || s.includes('good') || s.includes('bullish')) return 'positive';
  if (s.includes('negative') || s.includes('bad') || s.includes('bearish')) return 'negative';
  return 'neutral';
}

/* ── Sound Alerts ───────────────────────────────────────────────────────── */

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playBeep(type) {
  ensureAudioCtx();
  if (type === 'positive') {
    // High clean sine tone — single pulse
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } else {
    // Low harsh sawtooth — double pulse
    for (let i = 0; i < 2; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(330, audioCtx.currentTime + i * 0.18);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.18 + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.18);
      osc.stop(audioCtx.currentTime + i * 0.18 + 0.15);
    }
  }
}

function cycleSoundMode() {
  if (soundMode === 'off') soundMode = 'all';
  else if (soundMode === 'all') soundMode = 'watchlist';
  else soundMode = 'off';
  updateSoundButton();
  // Init audio context on first enable (needs user gesture)
  if (soundMode !== 'off') ensureAudioCtx();
}

function updateSoundButton() {
  const btn = $('news-sound-btn');
  if (!btn) return;
  btn.className = 'sound-mode-btn';
  if (soundMode === 'off') {
    btn.textContent = '🔕';
    btn.title = 'Sound alerts: OFF — click to enable';
  } else if (soundMode === 'all') {
    btn.textContent = '🔔';
    btn.title = 'Sound alerts: ALL — click for watchlist only';
    btn.classList.add('mode-all');
  } else {
    btn.textContent = '🔔★';
    btn.title = 'Sound alerts: WATCHLIST ONLY — click to disable';
    btn.classList.add('mode-watchlist');
  }
}

function shouldPlaySound(item) {
  if (soundMode === 'off') return false;
  if (soundMode === 'watchlist') {
    try {
      const state = getWatchlistsState();
      const activeList = state.lists[state.activeId];
      if (activeList && item.symbol) {
        return activeList.symbols.includes(`NSE:${item.symbol}`);
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  return true; // mode === 'all'
}

/* ── Live Clock ─────────────────────────────────────────────────────────── */

function startLiveClock() {
  function tick() {
    const el = $('news-live-clock');
    if (!el) return;
    const now = new Date();
    const day = now.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mon = months[now.getMonth()];
    const year = now.getFullYear();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    el.textContent = `${day} ${mon} ${year}, ${h}:${m}:${s}`;
  }
  tick();
  if (newsClockTimer) clearInterval(newsClockTimer);
  newsClockTimer = setInterval(tick, 1000);
}

/* ── Time-ago Ticker ────────────────────────────────────────────────────── */

function startTimeAgoTicker() {
  if (newsTimeAgoTimer) clearInterval(newsTimeAgoTimer);
  newsTimeAgoTimer = setInterval(() => {
    // Update card time-ago labels
    document.querySelectorAll('.news-time-ago[data-date]').forEach(el => {
      el.textContent = formatTimeAgo(el.dataset.date);
    });
    // Update sidebar recent-arrival time labels
    document.querySelectorAll('.recent-arrival-time[data-date]').forEach(el => {
      el.textContent = formatTimeAgo(el.dataset.date);
    });
  }, 1000);
}

/* ── New Badge ──────────────────────────────────────────────────────────── */

function updateNewBadge(count) {
  const badge = $('news-new-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = `${count} new ↑`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ── Data Fetching ──────────────────────────────────────────────────────── */

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
    return {
      announcements: data.announcements || [],
      stats: data.stats || { total: 0, positive: 0, negative: 0, neutral: 0 }
    };
  } catch (error) {
    console.error("Failed to fetch announcements:", error);
    return { announcements: [], stats: { total: 0, positive: 0, negative: 0, neutral: 0 } };
  }
}

/* ── Card Rendering ─────────────────────────────────────────────────────── */

function renderNewsFeed(containerId, announcements) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = "";

  if (!announcements.length) {
    container.innerHTML = `<div class="news-empty">No announcements available.</div>`;
    return;
  }

  const lastSeen = getLastSeenTime();

  announcements.forEach(item => {
    const sentimentClass = getSentimentClass(item.sentiment);
    const isNew = item.fetched_at && item.fetched_at > lastSeen;

    const div = document.createElement("div");
    div.className = `news-card sentiment-${sentimentClass}${isNew ? ' is-new' : ''}`;
    if (item.pdf_url) div.dataset.pdfUrl = item.pdf_url;

    const displayTitle = item.title || item.summary?.substring(0, 120) || 'Announcement';
    const displaySymbol = item.symbol || item.company_name || '';
    const broadcastDate = item.broadcast_date || item.fetched_at || '';
    const formattedSummary = window.marked ? marked.parse(item.summary || 'No summary available.') : (item.summary || 'No summary available.');

    div.innerHTML = `
      <div class="news-card-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div>
          <div class="news-card-meta">
            <span class="ticker-pill ${sentimentClass}">${displaySymbol}</span>
            <span class="sentiment-dot ${sentimentClass}"></span>
            ${isNew ? '<span class="news-new-tag">NEW</span>' : ''}
          </div>
        </div>
        <div class="news-card-times">
          <span class="news-card-date">${formatExactTime(broadcastDate)}</span>
          <span class="news-time-ago" data-date="${broadcastDate}">${formatTimeAgo(broadcastDate)}</span>
        </div>
      </div>
      <div class="news-card-expand-row" onclick="this.parentElement.classList.toggle('expanded')" style="cursor:pointer;">
        <div class="news-card-title">${displayTitle}</div>
        <span class="expand-arrow">▶</span>
      </div>
      <div class="news-card-body">
        <div class="news-details-grid">
          <div class="news-detail-item">
            <span class="news-detail-label">Symbol</span>
            <span class="news-detail-value">${displaySymbol}</span>
          </div>
          <div class="news-detail-item">
            <span class="news-detail-label">Sentiment</span>
            <span class="news-detail-value" style="text-transform:capitalize;">${sentimentClass}</span>
          </div>
          <div class="news-detail-item">
            <span class="news-detail-label">Date</span>
            <span class="news-detail-value">${broadcastDate}</span>
          </div>
          <div class="news-detail-item">
            <span class="news-detail-label">Company</span>
            <span class="news-detail-value">${item.company_name || displaySymbol}</span>
          </div>
        </div>
        <div class="news-card-summary markdown-body">${formattedSummary}</div>
        ${item.pdf_url ? `<a href="${item.pdf_url}" target="_blank" class="news-pdf-btn">📄 View PDF</a>` : ''}
      </div>
    `;
    container.appendChild(div);
  });
}

/* ── Sidebar: Announcement Stats ────────────────────────────────────────── */

function updateAnnouncementStats(stats) {
  const el = $('announcement-stats-inline');
  if (!el || !stats) return;
  el.innerHTML = `
    <div class="announcement-stat-inline">
      <span class="stat-value">${stats.total}</span>
      <span class="stat-label">TOTAL</span>
    </div>
    <div class="announcement-stat-inline">
      <span class="stat-value" style="color: var(--success);">▲ ${stats.positive}</span>
      <span class="stat-label">UP</span>
    </div>
    <div class="announcement-stat-inline">
      <span class="stat-value" style="color: var(--danger);">▼ ${stats.negative}</span>
      <span class="stat-label">DOWN</span>
    </div>
  `;
}

/* ── Sidebar: RED LIST ──────────────────────────────────────────────────── */

let redListTimer = null;

async function updateRedList(announcements) {
  const feed = $('red-list-feed');
  if (!feed) return;

  // Extract unique symbols with negative sentiment
  const negSymbols = [];
  const seen = new Set();
  for (const a of announcements) {
    if (getSentimentClass(a.sentiment) === 'negative' && a.symbol && !seen.has(a.symbol)) {
      seen.add(a.symbol);
      negSymbols.push(a.symbol);
      if (negSymbols.length >= 8) break;
    }
  }

  if (!negSymbols.length) {
    feed.innerHTML = '<div style="padding: 8px 14px; font-size: 11px; color: var(--muted);">No negative announcements</div>';
    return;
  }

  try {
    const nseSymbols = negSymbols.map(s => `NSE:${s}`).join(',');
    const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(nseSymbols)}`);
    const data = await response.json();
    const items = data.items || [];

    feed.innerHTML = '';
    items.forEach(item => {
      const changeVal = Number(item.change || 0);
      const changeClass = changeVal >= 0 ? 'up' : 'down';
      const price = item.price !== undefined ? Number(item.price).toFixed(2) : '--';
      const change = item.change !== undefined ? (changeVal >= 0 ? '+' : '') + Number(item.change).toFixed(2) : '--';
      const pct = item.change_pct !== undefined ? (changeVal >= 0 ? '+' : '') + Number(item.change_pct).toFixed(2) + '%' : '--';

      const row = document.createElement('div');
      row.className = 'red-list-item';
      row.innerHTML = `
        <span class="red-list-symbol">${item.symbol || ''}</span>
        <span class="red-list-price ${changeClass}">${price}</span>
        <span class="red-list-name">${item.description || item.symbol || ''}</span>
        <span class="red-list-change ${changeClass}">${change} · ${pct}</span>
      `;
      row.addEventListener('click', () => {
        $('symbol-input').value = item.symbol || '';
        if (typeof buildWidget === 'function') buildWidget({ symbol: `NSE:${item.symbol}` });
      });
      feed.appendChild(row);
    });
  } catch (error) {
    console.error('Failed to load RED LIST quotes:', error);
    feed.innerHTML = '<div style="padding: 8px 14px; font-size: 11px; color: var(--muted);">Failed to load quotes</div>';
  }
}

/* ── Sidebar: Recent Arrivals ───────────────────────────────────────────── */

async function renderRecentArrivals(announcements) {
  const feed = $('recent-arrivals-feed');
  if (!feed) return;
  // Don't clear immediately to avoid flicker. Clearing happens right before appending.

  // Get active watchlist symbols
  let watchlistSymbols = [];
  try {
    const state = await getWatchlistsState();
    const activeList = state.lists[state.activeId];
    if (activeList) {
      watchlistSymbols = activeList.symbols.map(s => s.replace('NSE:', ''));
    }
  } catch (e) { console.error("Error getting watchlist for sidebar:", e); }

  // Filter announcements for watchlist
  const watchlistAnnouncements = announcements.filter(a => watchlistSymbols.includes(a.symbol));

  // Merge with cache to preserve history if the new batch has fewer items
  // We prioritize newer items from the current fetch
  if (watchlistAnnouncements.length > 0) {
    // Basic deduplication and merging
    const existingIds = new Set(watchlistAnnouncements.map(a => a.id));
    const merged = [...watchlistAnnouncements, ...watchlistNewsCache.filter(a => !existingIds.has(a.id))];
    // Keep only the latest 40 items in cache
    watchlistNewsCache = merged.sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at)).slice(0, 40);
  }

  if (watchlistNewsCache.length === 0) {
    feed.innerHTML = '<div style="padding: 14px; font-size: 11px; color: var(--muted); text-align: center;">No announcements for watchlist stocks</div>';
    return;
  }

  // Clear now that we have data to render
  feed.innerHTML = '';
  watchlistNewsCache.slice(0, 20).forEach((item, idx) => {
    const displaySymbol = item.symbol || '';
    const titleSnippet = item.title || item.summary || 'Announcement';
    const dateStr = item.broadcast_date || item.fetched_at || '';
    const summary = item.summary || 'No summary available.';
    const sentimentClass = getSentimentClass(item.sentiment);

    const row = document.createElement('div');
    row.className = `recent-arrival-item sentiment-${sentimentClass}`;
    row.innerHTML = `
      <div class="recent-arrival-top">
        <span class="recent-arrival-dot ${sentimentClass}"></span>
        <span class="recent-arrival-text"><strong>${displaySymbol}</strong> — ${titleSnippet}...</span>
      </div>
      <span class="recent-arrival-time" data-date="${dateStr}">${formatTimeAgo(dateStr)}</span>
      <div class="recent-arrival-summary markdown-body">${window.marked ? marked.parse(summary) : summary}</div>
      ${item.pdf_url ? `<a href="${item.pdf_url}" target="_blank" class="recent-arrival-pdf" onclick="event.stopPropagation()">📄 View PDF</a>` : ''}
    `;

    row.addEventListener('click', (e) => {
      // Toggle expansion
      const isExpanded = row.classList.contains('expanded');
      
      // Close others
      document.querySelectorAll('.recent-arrival-item.expanded').forEach(el => el.classList.remove('expanded'));
      
      if (!isExpanded) {
        row.classList.add('expanded');
      }
    });
    feed.appendChild(row);
  });
}

/* ── Filter Pill Logic ──────────────────────────────────────────────────── */

function getActiveSentiments() {
  const sentiments = [];
  if ($('pill-positive')?.classList.contains('active')) sentiments.push('POSITIVE');
  if ($('pill-negative')?.classList.contains('active')) sentiments.push('NEGATIVE');
  if ($('pill-neutral')?.classList.contains('active')) sentiments.push('NEUTRAL');
  return sentiments;
}

function bindFilterPills() {
  ['pill-positive', 'pill-negative', 'pill-neutral'].forEach(id => {
    const pill = $(id);
    if (pill) {
      pill.addEventListener('click', () => {
        pill.classList.toggle('active');
        refreshNewsView();
      });
    }
  });
}

/* ── Main Refresh ───────────────────────────────────────────────────────── */

async function refreshNewsView(options = {}) {
  const startEl = $("news-filter-start");
  const endEl = $("news-filter-end");
  const symbolEl = $("news-filter-symbol");
  const sentiments = getActiveSentiments();

  // Fetch the feed (filtered by sentiment) and stats (unfiltered by sentiment) in one call
  const data = await loadAnnouncements({
    start_date: startEl?.value || "",
    end_date: endEl?.value || "",
    symbol: symbolEl?.value?.toUpperCase() || "",
    sentiments: sentiments.join(","),
    limit: 100
  });

  cachedAnnouncements = data.announcements;
  renderNewsFeed("news-feed", data.announcements);

  // Update stats from the server-side aggregate
  updateAnnouncementStats(data.stats);

  // Update badge/sidebar (we still use the 50 items for these)
  const lastSeen = getLastSeenTime();
  const newCount = data.announcements.filter(a => a.fetched_at && a.fetched_at > lastSeen).length;
  updateNewBadge(newCount);

  if (data.announcements.length > 0) {
    const maxFetched = data.announcements.reduce((max, a) => {
      return (a.fetched_at && a.fetched_at > max) ? a.fetched_at : max;
    }, '');
    if (maxFetched) latestFetchedAt = maxFetched;
  }

  renderRecentArrivals(data.announcements);
}

/* ── Active Stock News (for Price tab sidebar) ──────────────────────────── */

async function refreshActiveStockNews() {
  // This is a no-op now since the sidebar shows Recent Arrivals instead
  // The sidebar is updated via refreshNewsView and the polling loop
}

/* ── Fetcher Control ────────────────────────────────────────────────────── */

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

    // LIVE badge
    const liveBadge = $("news-live-badge");
    if (liveBadge) liveBadge.classList.toggle("hidden", !data.running);

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

/* ── Polling ────────────────────────────────────────────────────────────── */

function startNewsPolling() {
  if (newsPollTimer) clearInterval(newsPollTimer);
  newsPollTimer = setInterval(async () => {
    // If on news tab, do a full refresh (now including recent arrivals)
    if (currentView === "news") {
      refreshNewsView({ silent: true });
    } else {
      // If NOT on news tab, fetch a larger pool (200) to ensure watchlist coverage in sidebar
      const data = await loadAnnouncements({ limit: 200 });
      if (data.announcements.length > 0) {
        updateAnnouncementStats(data.stats);
        renderRecentArrivals(data.announcements);
        
        // Sound alert check
        const latestAnnouncements = data.announcements.slice(0, 10);
        const maxDate = latestAnnouncements[0].fetched_at;
        if (lastSeenAnnouncementDate && maxDate > lastSeenAnnouncementDate) {
          const item = latestAnnouncements[0];
          if (shouldPlaySound(item)) {
            const sClass = getSentimentClass(item.sentiment);
            playBeep(sClass === 'positive' ? 'positive' : 'negative');
          }
        }
        lastSeenAnnouncementDate = maxDate;
      }
    }

    checkFetcherStatus();
    checkFundamentalStatus();
  }, 10000);
}

/* ── Init ───────────────────────────────────────────────────────────────── */

function initNewsModule() {
  // Set default dates to today
  const today = new Date().toISOString().split('T')[0];
  if ($('news-filter-start')) $('news-filter-start').value = today;
  if ($('news-filter-end')) $('news-filter-end').value = today;

  startLiveClock();
  startTimeAgoTicker();
  bindFilterPills();
  updateSoundButton();

  // New badge click → scroll to first new + mark seen
  const badge = $('news-new-badge');
  if (badge) {
    badge.addEventListener('click', () => {
      const firstNew = document.querySelector('.news-card.is-new');
      if (firstNew) firstNew.scrollIntoView({ behavior: 'smooth', block: 'start' });
      markAllSeen();
    });
  }
}
