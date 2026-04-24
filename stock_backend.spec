# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['D:\\projects\\stock_data_pipelines\\apps\\web_app\\server\\app.py'],
    pathex=[],
    binaries=[],
    datas=[('D:\\projects\\stock_data_pipelines\\apps\\web_app', 'apps/web_app'), ('D:\\projects\\stock_data_pipelines\\trading_view_advanced_charts', 'trading_view_advanced_charts'), ('D:\\projects\\stock_data_pipelines\\data', 'data'), ('D:\\projects\\stock_data_pipelines\\packages', 'packages'), ('D:\\projects\\stock_data_pipelines\\config', 'config')],
    hiddenimports=['duckdb', 'pandas', 'yfinance', 'langchain_openai', 'langchain', 'langchain.text_splitter', 'langchain_anthropic', 'langchain_deepseek', 'langchain_google_genai', 'langchain_groq', 'langchain_xai', 'langchain_ollama', 'langchain_gigachat', 'langchain_core', 'langgraph', 'langgraph.graph', 'pydantic', 'httpx', 'pdfminer', 'pdfminer.high_level', 'selenium', 'transformers', 'requests', 'tqdm', 'sklearn', 'openpyxl', 'bs4', 'plotly', 'lxml', 'lxml.html'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='stock_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='stock_backend',
)
