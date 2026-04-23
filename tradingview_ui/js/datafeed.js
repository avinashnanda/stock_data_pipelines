(function () {
  const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "30", "60", "240", "1D", "1W", "1M"];
  const POLL_INTERVAL_MS = 10000;

  function toQuery(params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        search.set(key, String(value));
      }
    });
    return search.toString();
  }

  async function fetchJson(path, params) {
    const query = params ? `?${toQuery(params)}` : "";
    const response = await fetch(`${path}${query}`);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  }

  function resolutionToSeconds(resolution) {
    if (resolution === "1D" || resolution === "D") {
      return 86400;
    }
    if (resolution === "1W" || resolution === "W") {
      return 7 * 86400;
    }
    if (resolution === "1M" || resolution === "M") {
      return 30 * 86400;
    }
    return Number.parseInt(resolution, 10) * 60;
  }

  function createAppDatafeed(sourceId, setStatus) {
    const subscriptions = new Map();
    const quoteSubscriptions = new Map();

    return {
      onReady(callback) {
        window.setTimeout(() => {
          callback({
            exchanges: [{ value: "NSE", name: "NSE", desc: "National Stock Exchange of India" }],
            symbols_types: [{ name: "Stock", value: "stock" }],
            supported_resolutions: SUPPORTED_RESOLUTIONS,
            supports_marks: false,
            supports_search: true,
            supports_timescale_marks: false,
            supports_time: true,
          });
        }, 0);
      },

      searchSymbols(userInput, exchange, symbolType, onResultReadyCallback) {
        fetchJson("/api/search", { source: sourceId, query: userInput, exchange, symbolType })
          .then((data) => onResultReadyCallback(data.items || []))
          .catch((error) => {
            console.error("searchSymbols failed", error);
            setStatus(`Search failed: ${error.message}`, "error");
            onResultReadyCallback([]);
          });
      },

      resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
        fetchJson("/api/symbol", { source: sourceId, symbol: symbolName })
          .then((symbolInfo) => onSymbolResolvedCallback(symbolInfo))
          .catch((error) => {
            console.error("resolveSymbol failed", error);
            setStatus(`Symbol lookup failed: ${error.message}`, "error");
            onResolveErrorCallback(error.message);
          });
      },

      getBars(symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) {
        fetchJson("/api/history", {
          source: sourceId,
          symbol: symbolInfo.ticker || symbolInfo.name,
          resolution,
          from: periodParams.from,
          to: periodParams.to,
        })
          .then((data) => {
            const bars = data.bars || [];
            if (!bars.length) {
              onHistoryCallback([], { noData: true });
              setStatus(`No data for ${symbolInfo.name} on ${resolution}`, "warning");
              return;
            }

            onHistoryCallback(bars, { noData: false });
            setStatus(`Loaded ${symbolInfo.name} from ${sourceId}`, "ready");
          })
          .catch((error) => {
            console.error("getBars failed", error);
            setStatus(`History request failed: ${error.message}`, "error");
            onErrorCallback(error.message);
          });
      },

      subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID) {
        const seconds = resolutionToSeconds(resolution);
        const poll = async () => {
          const now = Math.floor(Date.now() / 1000);
          const from = now - Math.max(seconds * 12, 86400);
          try {
            const data = await fetchJson("/api/history", {
              source: sourceId,
              symbol: symbolInfo.ticker || symbolInfo.name,
              resolution,
              from,
              to: now + seconds,
            });
            const bars = data.bars || [];
            if (bars.length) {
              onRealtimeCallback(bars[bars.length - 1]);
            }
          } catch (error) {
            console.error("subscribeBars poll failed", error);
          }
        };

        poll();
        const timerId = window.setInterval(poll, POLL_INTERVAL_MS);
        subscriptions.set(subscriberUID, timerId);
      },

      unsubscribeBars(subscriberUID) {
        const timerId = subscriptions.get(subscriberUID);
        if (timerId) {
          window.clearInterval(timerId);
          subscriptions.delete(subscriberUID);
        }
      },

      getQuotes(symbols, onDataCallback, onErrorCallback) {
        fetchJson("/api/quotes", {
          source: sourceId,
          symbols: symbols.join(","),
        })
          .then((data) => onDataCallback(data.items || []))
          .catch((error) => {
            console.error("getQuotes failed", error);
            if (onErrorCallback) {
              onErrorCallback(error.message);
            }
          });
      },

      subscribeQuotes(symbols, fastSymbols, onRealtimeCallback, listenerGUID) {
        const poll = async () => {
          try {
            const data = await fetchJson("/api/quotes", {
              source: sourceId,
              symbols: symbols.join(","),
            });
            onRealtimeCallback(data.items || []);
          } catch (error) {
            console.error("subscribeQuotes poll failed", error);
          }
        };

        poll();
        const timerId = window.setInterval(poll, POLL_INTERVAL_MS);
        quoteSubscriptions.set(listenerGUID, timerId);
      },

      unsubscribeQuotes(listenerGUID) {
        const timerId = quoteSubscriptions.get(listenerGUID);
        if (timerId) {
          window.clearInterval(timerId);
          quoteSubscriptions.delete(listenerGUID);
        }
      },

      getServerTime(callback) {
        callback(Math.floor(Date.now() / 1000));
      },
    };
  }

  window.createAppDatafeed = createAppDatafeed;
})();
