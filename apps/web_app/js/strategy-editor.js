(function () {
  const defaultStrategyTemplate = `from backtesting import Strategy
from backtesting.lib import crossover
import pandas as pd


def SMA(values, length):
    return pd.Series(values).rolling(length).mean()


class SmaCross(Strategy):
    fast_length = 10
    slow_length = 30

    def init(self):
        self.sma_fast = self.I(SMA, self.data.Close, self.fast_length)
        self.sma_slow = self.I(SMA, self.data.Close, self.slow_length)

    def next(self):
        if crossover(self.sma_fast, self.sma_slow):
            self.buy()
        elif crossover(self.sma_slow, self.sma_fast):
            self.position.close()
`;

  let monacoLoaderPromise = null;
  let monacoEditor = null;

  function loadMonacoLoader() {
    if (window.monaco && window.monaco.editor) {
      return Promise.resolve(window.monaco);
    }
    if (monacoLoaderPromise) return monacoLoaderPromise;

    monacoLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/loader.min.js";
      script.onload = () => {
        window.require.config({
          paths: {
            vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
          },
        });
        window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject);
      };
      script.onerror = () => reject(new Error("Failed to load Monaco Editor"));
      document.head.appendChild(script);
    });

    return monacoLoaderPromise;
  }

  async function initStrategyEditor() {
    const editorHost = $("strategy-editor");
    const fallback = $("strategy-editor-fallback");
    if (!editorHost || !fallback) return null;
    if (monacoEditor) return monacoEditor;

    fallback.value = defaultStrategyTemplate;
    try {
      await loadMonacoLoader();
      fallback.classList.add("hidden");
      editorHost.classList.remove("hidden");
      monacoEditor = window.monaco.editor.create(editorHost, {
        value: fallback.value,
        language: "python",
        theme: document.documentElement.dataset.theme === "light" ? "vs" : "vs-dark",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        roundedSelection: true,
        scrollBeyondLastLine: false,
        padding: { top: 14, bottom: 14 },
      });
      return monacoEditor;
    } catch (error) {
      console.error(error);
      editorHost.classList.add("hidden");
      fallback.classList.remove("hidden");
      return null;
    }
  }

  function getStrategyCode() {
    if (monacoEditor) return monacoEditor.getValue();
    const fallback = $("strategy-editor-fallback");
    return fallback ? fallback.value : defaultStrategyTemplate;
  }

  function setStrategyCode(code) {
    const nextValue = code || defaultStrategyTemplate;
    if (monacoEditor) {
      monacoEditor.setValue(nextValue);
    }
    const fallback = $("strategy-editor-fallback");
    if (fallback) fallback.value = nextValue;
  }

  function getDefaultStrategyTemplate() {
    return defaultStrategyTemplate;
  }

  function syncStrategyEditorTheme(theme) {
    if (!window.monaco || !window.monaco.editor || !monacoEditor) return;
    window.monaco.editor.setTheme(theme === "light" ? "vs" : "vs-dark");
  }

  window.initStrategyEditor = initStrategyEditor;
  window.getStrategyCode = getStrategyCode;
  window.setStrategyCode = setStrategyCode;
  window.getDefaultStrategyTemplate = getDefaultStrategyTemplate;
  window.syncStrategyEditorTheme = syncStrategyEditorTheme;
})();
