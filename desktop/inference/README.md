# Fault Inference Runtime

This directory contains the desktop-side inference runtime for robot fault diagnosis.

## Architecture

Electron collects the realtime ROS telemetry window through rosbridge, then sends a
50x15 raw feature window to a standalone C++ process over newline-delimited JSON.
The C++ process owns preprocessing, backend dispatch, inference, and softmax
postprocessing.

The first production backend is `onnxruntime`. `tensorrt`, `openvino`, and `npu`
are reserved backend names and return `backend unavailable` until their SDK-specific
implementations are added.

## Environment Setup

To prepare a fresh machine for desktop packaging and inference builds:

```bash
npm run setup:env
```

The command auto-detects the platform and defaults to a project-local toolchain
under `desktop/.toolchain/`. The setup scripts only prepend these tools to the
current process `PATH`; they do not write system environment variables.

- Windows local downloads: Node.js, uv, CMake, Ninja, and LLVM/Clang.
- macOS/Linux local downloads: Node.js, uv, CMake, Ninja, and LLVM/Clang.
- Python is managed by uv. The scripts set `UV_CACHE_DIR` and
  `UV_PYTHON_INSTALL_DIR` under `desktop/.toolchain/uv`, then create the
  project-local `desktop/python` venv with `uv venv`.
- On Windows, offline inference builds use project-local `clang++` and Ninja.
  Real ONNX Runtime builds prefer project-local `clang-cl`, but still need the
  Windows SDK/MSVC environment because the official ONNX Runtime win-x64 package
  uses the MSVC ABI.

It also installs Electron npm dependencies and installs model-export packages
with `uv pip install`.

Useful variants:

```bash
npm run setup:check
npm run setup:env:build-infer
npm run setup:env:offline-infer
npm run setup:env:system
```

For custom switches, call the platform script directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1 -SkipPythonDeps -BuildInference
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1 -UseSystemTools
```

```bash
bash scripts/setup-env.sh --skip-python-deps --build-inference
bash scripts/setup-env.sh --use-system-tools
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple bash scripts/setup-env.sh
```

## Build

By default CMake downloads the matching prebuilt ONNX Runtime CPU package with
`FetchContent`:

```powershell
npm run build:infer
```

On Windows, real ONNX Runtime inference should be built with Visual Studio Build
Tools 2022 and the "Desktop development with C++" workload. The npm build script
prefers Ninja plus project-local `clang-cl` inside the Visual Studio developer
environment when `clang-cl` is compatible with the installed MSVC STL, then falls
back to MSVC `cl` or the Visual Studio generator.

To avoid MSVC completely on Windows, build ONNX Runtime from source with
project-local `llvm-mingw`, then build this inference executable against that
matching MinGW/LLVM ABI package:

```powershell
npm run build:infer:source
```

This downloads `llvm-mingw` and ONNX Runtime source into `desktop/.toolchain`,
builds `onnxruntime.dll` from source, installs a local ONNX Runtime root under
`desktop/.toolchain/onnxruntime-v1.18.1-mingw`, then builds `yp_fault_infer`
with `ONNXRUNTIME_ROOT` pointing at that local build.

Useful overrides:

```powershell
# Use an already-extracted ONNX Runtime package
$env:ONNXRUNTIME_ROOT="C:\path\to\onnxruntime"
cmake -S .\onnxruntime -B .\onnxruntime\build

# Pin a different release
cmake -S .\onnxruntime -B .\onnxruntime\build -DYP_ONNXRUNTIME_VERSION=1.18.1

# Use a mirror or GPU package URL
cmake -S .\onnxruntime -B .\onnxruntime\build -DYP_ONNXRUNTIME_PACKAGE_URL="https://..."

# Build the protocol/backend registry without ONNX Runtime for UI integration tests
npm run build:infer:offline
```

If ONNX Runtime cannot be resolved, the executable still builds but reports the
ONNX Runtime backend as unavailable. This keeps Electron integration testable
before the SDK is available.

## Model Export

```powershell
pip install torch onnx joblib scikit-learn
python .\tools\export_sage_cnn_onnx.py
```

The script exports:

- `desktop/models/sage_cnn/sage_cnn_selected_best_model.onnx`
- `desktop/models/sage_cnn/scaler.json`
- `desktop/models/sage_cnn/feature_config_used.json`

The default `desktop/models/sage_cnn/model_manifest.json` references these files
with paths relative to the manifest.
