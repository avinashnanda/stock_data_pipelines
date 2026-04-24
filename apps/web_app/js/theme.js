/* ═══════════════════════════════════════════════════════════════════════════
   THEME — Theme toggle and application
   ═══════════════════════════════════════════════════════════════════════════ */

function applyShellTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme-toggle").textContent = theme === "dark" ? "Day Mode" : "Night Mode";
}

async function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  window.localStorage.setItem("tradingview_ui_theme", currentTheme);
  applyShellTheme(currentTheme);
  if (widget) {
    await widget.changeTheme(currentTheme);
  }
}
