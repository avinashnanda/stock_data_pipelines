"""
Master build script for Stock Data Pipelines Desktop Application.

This script orchestrates the full build pipeline:
  1. Packages the Python backend into an executable (via PyInstaller).
  2. Installs Electron dependencies.
  3. Builds the Electron app into a distributable installer.

Usage:
    python build_scripts/build_desktop.py          # Build for current platform
    python build_scripts/build_desktop.py --skip-python  # Skip Python packaging (if already built)
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ELECTRON_DIR = PROJECT_ROOT / "electron"
PYTHON_DIST_DIR = PROJECT_ROOT / "python_dist"


def step(msg: str):
    print(f"\n{'─' * 60}")
    print(f"  {msg}")
    print(f"{'─' * 60}\n")


def run(cmd: list[str], cwd: Path = PROJECT_ROOT, check: bool = True):
    """Run a command and stream output."""
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(cwd))
    if check and result.returncode != 0:
        print(f"\n  ❌ Command failed with exit code {result.returncode}")
        sys.exit(result.returncode)
    return result


def package_python():
    """Step 1: Package Python backend with PyInstaller."""
    step("Step 1/3: Packaging Python backend with PyInstaller")
    run([sys.executable, str(PROJECT_ROOT / "build_scripts" / "package_python.py")])

    if not (PYTHON_DIST_DIR / "stock_backend").exists():
        print("  ❌ Python packaging failed – output directory not found.")
        sys.exit(1)

    print("  ✅ Python backend packaged successfully.")


def install_electron_deps():
    """Step 2: Install Electron npm dependencies."""
    step("Step 2/3: Installing Electron dependencies")

    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    run([npm_cmd, "install"], cwd=ELECTRON_DIR)
    print("  ✅ Electron dependencies installed.")


def build_electron():
    """Step 3: Build the Electron distributable."""
    step("Step 3/3: Building Electron distributable")

    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    if sys.platform == "win32":
        run([npm_cmd, "run", "dist:win"], cwd=ELECTRON_DIR)
    elif sys.platform == "darwin":
        run([npm_cmd, "run", "dist:mac"], cwd=ELECTRON_DIR)
    else:
        run([npm_cmd, "run", "dist"], cwd=ELECTRON_DIR)

    print(f"  ✅ Distributable built. Check: {ELECTRON_DIR / 'dist'}")


def main():
    parser = argparse.ArgumentParser(description="Build Stock Data Pipelines desktop app")
    parser.add_argument(
        "--skip-python",
        action="store_true",
        help="Skip Python packaging step (use existing python_dist/)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  Stock Data Pipelines – Desktop App Builder")
    print("=" * 60)

    if not args.skip_python:
        package_python()
    else:
        step("Step 1/3: Skipping Python packaging (--skip-python)")

    install_electron_deps()
    build_electron()

    print("\n" + "=" * 60)
    print("  🎉 Desktop application built successfully!")
    print(f"  Installer location: {ELECTRON_DIR / 'dist'}")
    print("=" * 60)


if __name__ == "__main__":
    main()
