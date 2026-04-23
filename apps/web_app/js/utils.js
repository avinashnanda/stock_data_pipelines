/* ═══════════════════════════════════════════════════════════════════════════
   UTILS — Shared helper functions
   ═══════════════════════════════════════════════════════════════════════════ */

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, tone) {
  const node = $("status");
  if (!node) { return; }
  node.textContent = message;
  node.dataset.tone = tone || "neutral";
}

function normalizeSymbolInput(symbol) {
  return symbol.trim().toUpperCase().replace(/^NSE:/, "");
}

function getDefaultSymbol() {
  const symbol = $("symbol-input").value.trim().toUpperCase();
  return symbol ? `NSE:${symbol}` : "NSE:RELIANCE";
}

function formatNumberWithSeparators(value, options = {}) {
  if (value === null || value === undefined || value === "") { return "--"; }
  if (typeof value !== "number" || !Number.isFinite(value)) { return String(value); }
  const { minimumFractionDigits = 0, maximumFractionDigits = Math.abs(value) < 100 ? 2 : 0 } = options;
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits, maximumFractionDigits }).format(value);
}

function formatCompactValue(value) {
  return formatNumberWithSeparators(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(Number(value)) < 100 ? 2 : 0,
  });
}

function formatIndianCompactAxis(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) { return "--"; }
  const numericValue = Number(value);
  const absoluteValue = Math.abs(numericValue);
  if (absoluteValue >= 10_000_000) {
    return `${formatNumberWithSeparators(numericValue / 10_000_000, { maximumFractionDigits: 2 })} Cr`;
  }
  if (absoluteValue >= 100_000) {
    return `${formatNumberWithSeparators(numericValue / 100_000, { maximumFractionDigits: 2 })} L`;
  }
  return formatNumberWithSeparators(numericValue, {
    minimumFractionDigits: 0,
    maximumFractionDigits: absoluteValue < 100 ? 2 : 0,
  });
}

function titleizeKey(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCellValue(value, key = "") {
  if (value === null || value === undefined || value === "") { return "--"; }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (String(key).toLowerCase().includes("%")) {
      return formatNumberWithSeparators(value, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    return formatNumberWithSeparators(value, {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    });
  }
  return String(value);
}

function isNumericColumn(rows, key) {
  return rows.some((row) => typeof row[key] === "number" && Number.isFinite(row[key]));
}
