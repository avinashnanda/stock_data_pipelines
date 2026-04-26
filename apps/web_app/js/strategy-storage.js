(function () {
  async function apiJson(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
  }

  async function listStrategies() {
    const payload = await apiJson("/api/strategies");
    return payload.items || [];
  }

  async function loadStrategy(strategyId) {
    return apiJson(`/api/strategies/${encodeURIComponent(strategyId)}`);
  }

  async function saveStrategy(payload) {
    const strategyId = payload.id;
    const method = strategyId ? "PUT" : "POST";
    const url = strategyId ? `/api/strategies/${encodeURIComponent(strategyId)}` : "/api/strategies";
    return apiJson(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function deleteStrategy(strategyId) {
    return apiJson(`/api/strategies/${encodeURIComponent(strategyId)}`, {
      method: "DELETE",
    });
  }

  async function listBacktests() {
    const payload = await apiJson("/api/backtests");
    return payload.items || [];
  }

  async function loadBacktest(runId) {
    return apiJson(`/api/backtests/${encodeURIComponent(runId)}`);
  }

  async function deleteBacktest(runId) {
    return apiJson(`/api/backtests/${encodeURIComponent(runId)}`, {
      method: "DELETE",
    });
  }

  async function generateStrategy(prompt, model) {
    return apiJson("/api/strategies/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model }),
    });
  }

  async function getCapabilities() {
    return apiJson("/api/strategy-lab/capabilities");
  }

  async function exportBacktest(runId, format) {
    return apiJson("/api/backtest/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, format }),
    });
  }

  async function listPaperSessions() {
    const payload = await apiJson("/api/paper");
    return payload.items || [];
  }

  async function startPaperSession(payload) {
    return apiJson("/api/paper/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function stopPaperSession(sessionId) {
    return apiJson(`/api/paper/${encodeURIComponent(sessionId)}`, {
      method: "POST",
    });
  }

  async function placePaperOrder(payload) {
    return apiJson("/api/paper/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  window.strategyStorageApi = {
    listStrategies,
    loadStrategy,
    saveStrategy,
    deleteStrategy,
    listBacktests,
    loadBacktest,
    deleteBacktest,
    generateStrategy,
    getCapabilities,
    exportBacktest,
    listPaperSessions,
    startPaperSession,
    stopPaperSession,
    placePaperOrder,
  };
})();
