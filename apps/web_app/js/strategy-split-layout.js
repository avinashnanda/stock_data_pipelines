(function () {
  const STORAGE_KEYS = {
    sidebarWidth: "strategy_lab_sidebar_width",
    editorWidth: "strategy_lab_editor_width",
    resultsHeight: "strategy_lab_results_height",
  };

  let initialized = false;

  function initStrategyLabSplits() {
    if (initialized) return;
    initialized = true;
    applySavedSplitValues();
    bindHandle("sidebar", document.querySelector(".strategy-sidebar-handle"), resizeSidebar);
    bindHandle("workspace", document.querySelector(".strategy-workspace-handle"), resizeWorkspaceEditor);
    bindHandle("results", document.querySelector(".strategy-results-handle"), resizeResultsPanel);
  }

  function applySavedSplitValues() {
    const root = document.documentElement;
    const savedSidebar = Number(window.localStorage.getItem(STORAGE_KEYS.sidebarWidth));
    const savedEditor = Number(window.localStorage.getItem(STORAGE_KEYS.editorWidth));
    const savedResults = Number(window.localStorage.getItem(STORAGE_KEYS.resultsHeight));

    if (Number.isFinite(savedSidebar) && savedSidebar > 0) {
      root.style.setProperty("--strategy-sidebar-width", `${clamp(savedSidebar, 220, 520)}px`);
    }
    if (Number.isFinite(savedEditor) && savedEditor > 0) {
      root.style.setProperty("--strategy-editor-width", `${clamp(savedEditor, 360, 820)}px`);
    }
    if (Number.isFinite(savedResults) && savedResults > 0) {
      root.style.setProperty("--strategy-results-height", `${clamp(savedResults, 180, 560)}px`);
    }
  }

  function bindHandle(name, handle, resizeFn) {
    if (!handle) return;
    const onPointerDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      handle.classList.add("dragging");
      const move = (moveEvent) => resizeFn(moveEvent, handle);
      const up = () => {
        handle.classList.remove("dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.dispatchEvent(new Event("resize"));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
      resizeFn(event, handle);
    };

    handle.addEventListener("pointerdown", onPointerDown);
    handle.dataset.splitName = name;
  }

  function resizeSidebar(event) {
    const lab = document.querySelector(".strategy-lab");
    if (!lab) return;
    if (lab.classList.contains("sidebar-collapsed")) return;
    const rect = lab.getBoundingClientRect();
    const next = clamp(event.clientX - rect.left, 220, Math.min(520, rect.width * 0.42));
    document.documentElement.style.setProperty("--strategy-sidebar-width", `${Math.round(next)}px`);
    window.localStorage.setItem(STORAGE_KEYS.sidebarWidth, String(Math.round(next)));
  }

  function resizeWorkspaceEditor(event) {
    const grid = document.querySelector(".strategy-main-grid");
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const next = clamp(event.clientX - rect.left, 380, Math.min(920, rect.width * 0.72));
    document.documentElement.style.setProperty("--strategy-editor-width", `${Math.round(next)}px`);
    window.localStorage.setItem(STORAGE_KEYS.editorWidth, String(Math.round(next)));
  }

  function resizeResultsPanel(event) {
    const workspace = document.querySelector(".strategy-workspace");
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const next = clamp(rect.bottom - event.clientY, 180, Math.min(560, rect.height * 0.65));
    document.documentElement.style.setProperty("--strategy-results-height", `${Math.round(next)}px`);
    window.localStorage.setItem(STORAGE_KEYS.resultsHeight, String(Math.round(next)));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.initStrategyLabSplits = initStrategyLabSplits;
  window.applyStrategyLabSplitValues = applySavedSplitValues;
})();
