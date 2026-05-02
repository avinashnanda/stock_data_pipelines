let _strategySignalShapes = [];
let _strategySignals = [];

function setStrategySignals(signals) {
  const seen = new Set();
  _strategySignals = (Array.isArray(signals) ? signals : []).filter((signal) => {
    const key = [
      signal?.time || "",
      String(signal?.type || "").toUpperCase(),
      Number(signal?.price || 0).toFixed(4),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clearStrategySignals() {
  let chart;
  try {
    chart = widget?.activeChart?.();
  } catch (_) {
    // Widget not ready yet
  }
  if (!chart || typeof chart.removeEntity !== "function") {
    _strategySignalShapes = [];
    return;
  }

  _strategySignalShapes.forEach((entityId) => {
    try {
      chart.removeEntity(entityId);
    } catch (error) {
      console.error("Failed to remove strategy signal entity", error);
    }
  });
  _strategySignalShapes = [];
}

function applyStrategySignals() {
  let chart;
  try {
    chart = widget?.activeChart?.();
  } catch (_) {
    // Widget not ready yet
  }
  if (!chart || typeof chart.createShape !== "function") return;

  clearStrategySignals();
  if (currentView !== "strategylab" || !_strategySignals.length) return;

  _strategySignals.forEach((signal) => {
    const point = buildSignalPoint(signal);
    if (!point) return;

    const isBuy = String(signal.type || "").toUpperCase() === "BUY";
    const color = isBuy ? "#00c853" : "#ff1744";
    const label = `${isBuy ? "BUY" : "SELL"} @ ${Number(signal.price || 0).toFixed(2)}`;
    try {
      const entityId = chart.createShape(
        point,
        {
          shape: isBuy ? "arrow_up" : "arrow_down",
          lock: true,
          disableSave: true,
          disableSelection: true,
          overrides: {
            color,
            backgroundColor: color,
            borderColor: color,
            linewidth: 3,
            textColor: "#ffffff",
            transparency: 0,
          },
          text: label,
          zOrder: "top",
        }
      );
      _strategySignalShapes.push(entityId);
    } catch (error) {
      console.error("Failed to create strategy signal shape", error);
    }
  });
}

function resetStrategySignals() {
  _strategySignals = [];
  clearStrategySignals();
}

function buildSignalPoint(signal) {
  const timeValue = Date.parse(signal.time);
  const priceValue = Number(signal.price);
  if (!Number.isFinite(timeValue) || !Number.isFinite(priceValue)) return null;
  return {
    time: Math.floor(timeValue / 1000),
    price: priceValue,
  };
}
