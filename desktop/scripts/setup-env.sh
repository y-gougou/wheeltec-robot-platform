#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_VENV_DIR="$PROJECT_ROOT/python"
PYTHON_COMMAND="${PYTHON_COMMAND:-python3}"
PIP_INDEX_URL="${PIP_INDEX_URL:-}"
EXTRA_PIP_ARGS=()
TOOLCHAIN_DIR="$PROJECT_ROOT/.toolchain"
NODE_VERSION="20.18.1"
CMAKE_VERSION="3.28.1"
NINJA_VERSION="1.12.1"
PYTHON_VERSION="3.11.9"
UV_VERSION="0.11.11"
LLVM_VERSION="18.1.8"
NODE_BIN=""
NPM_BIN=""
CMAKE_BIN=""
NINJA_BIN=""
UV_BIN=""
CLANG_BIN=""
CLANGXX_BIN=""
LLD_BIN=""

SKIP_SYSTEM_TOOLS=0
SKIP_NODE_INSTALL=0
SKIP_BUNDLED_PYTHON=0
SKIP_PYTHON_DEPS=0
BUILD_INFERENCE=0
OFFLINE_INFERENCE=0
CHECK_ONLY=0
FORCE=0
USE_SYSTEM_TOOLS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-system-tools|-SkipSystemTools) SKIP_SYSTEM_TOOLS=1 ;;
    --skip-node-install|-SkipNodeInstall) SKIP_NODE_INSTALL=1 ;;
    --skip-bundled-python|-SkipBundledPython) SKIP_BUNDLED_PYTHON=1 ;;
    --skip-python-deps|-SkipPythonDeps) SKIP_PYTHON_DEPS=1 ;;
    --build-inference|-BuildInference) BUILD_INFERENCE=1 ;;
    --offline-inference|-OfflineInference) OFFLINE_INFERENCE=1 ;;
    --check-only|-CheckOnly) CHECK_ONLY=1 ;;
    --force|-Force) FORCE=1 ;;
    --use-system-tools|-UseSystemTools) USE_SYSTEM_TOOLS=1 ;;
    --python-command|-PythonCommand)
      shift
      PYTHON_COMMAND="${1:?missing value for --python-command}"
      ;;
    --python-venv-dir|-PythonVenvDir)
      shift
      PYTHON_VENV_DIR="${1:?missing value for --python-venv-dir}"
      ;;
    --pip-index-url|-PipIndexUrl)
      shift
      PIP_INDEX_URL="${1:?missing value for --pip-index-url}"
      ;;
    --toolchain-dir|-ToolchainDir)
      shift
      TOOLCHAIN_DIR="${1:?missing value for --toolchain-dir}"
      ;;
    --extra-pip-arg|-ExtraPipArg)
      shift
      EXTRA_PIP_ARGS+=("${1:?missing value for --extra-pip-arg}")
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  SKIP_SYSTEM_TOOLS=1
  SKIP_NODE_INSTALL=1
  SKIP_BUNDLED_PYTHON=1
  SKIP_PYTHON_DEPS=1
  BUILD_INFERENCE=0
fi

step() {
  printf '\n==> %s\n' "$1" >&2
}

ok() {
  printf 'OK  %s\n' "$1" >&2
}

warn() {
  printf 'WARN %s\n' "$1" >&2
}

have() {
  command -v "$1" >/dev/null 2>&1
}

download_file() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" && "$FORCE" -eq 0 ]]; then
    ok "Using cached download: $dest"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  echo ">> download $url"
  if have curl; then
    curl -fL "$url" -o "$dest"
  elif have wget; then
    wget -O "$dest" "$url"
  else
    echo "curl or wget is required for project-local downloads." >&2
    exit 1
  fi
}

extract_archive() {
  local archive="$1"
  local dest="$2"
  if [[ -d "$dest" && "$FORCE" -eq 0 ]]; then
    ok "Using existing tool directory: $dest"
    return
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  case "$archive" in
    *.zip)
      if have unzip; then
        unzip -q "$archive" -d "$dest"
      else
        echo "unzip is required to extract $archive" >&2
        exit 1
      fi
      ;;
    *.tar.gz|*.tgz)
      tar -xzf "$archive" -C "$dest"
      ;;
    *.tar.xz|*.txz)
      tar -xJf "$archive" -C "$dest"
      ;;
    *)
      echo "Unsupported archive: $archive" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

sudo_cmd() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    echo "sudo is required for installing system packages." >&2
    exit 1
  fi
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux) echo "linux" ;;
    *) echo "unsupported" ;;
  esac
}

install_macos_tools() {
  if ! xcode-select -p >/dev/null 2>&1; then
    step "Installing Xcode Command Line Tools"
    xcode-select --install || true
    warn "Finish the Xcode installer, then rerun this script."
    exit 1
  fi

  if ! have brew; then
    echo "Homebrew is required on macOS. Install it from https://brew.sh, then rerun this script." >&2
    exit 1
  fi

  step "Installing macOS build tools"
  brew update
  brew install git node python@3.11 cmake ninja llvm pkg-config
}

install_linux_tools() {
  step "Installing Linux build tools"
  if have apt-get; then
    sudo_cmd apt-get update
    sudo_cmd apt-get install -y git nodejs npm python3 python3-venv python3-pip cmake ninja-build clang lld build-essential pkg-config
  elif have dnf; then
    sudo_cmd dnf install -y git nodejs npm python3 python3-pip cmake ninja-build clang lld gcc gcc-c++ make pkgconf-pkg-config
  elif have yum; then
    sudo_cmd yum install -y git nodejs npm python3 python3-pip cmake ninja-build clang lld gcc gcc-c++ make pkgconfig
  elif have pacman; then
    sudo_cmd pacman -Sy --needed git nodejs npm python python-pip cmake ninja clang lld base-devel pkgconf
  elif have zypper; then
    sudo_cmd zypper install -y git nodejs npm python3 python3-pip python3-venv cmake ninja clang lld gcc gcc-c++ make pkg-config
  elif have brew; then
    brew install git node python@3.11 cmake ninja llvm pkg-config
  else
    echo "No supported package manager found. Install git, node, npm, python3, cmake, ninja, and a C++ compiler manually." >&2
    exit 1
  fi
}

ensure_system_tools() {
  local os_name
  os_name="$(detect_os)"
  case "$os_name" in
    macos) install_macos_tools ;;
    linux) install_linux_tools ;;
    *)
      echo "Unsupported OS for setup-env.sh: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

ensure_local_toolchain() {
  step "Preparing project-local toolchain"
  local os_name arch downloads node_archive node_platform cmake_archive cmake_platform ninja_archive ninja_platform llvm_archive llvm_platform uv_archive uv_platform
  os_name="$(detect_os)"
  arch="$(detect_arch)"
  downloads="$TOOLCHAIN_DIR/downloads"

  case "$os_name:$arch" in
    linux:x64)
      node_platform="linux-x64"
      cmake_platform="linux-x86_64"
      ninja_platform="linux"
      llvm_platform="x86_64-linux-gnu-ubuntu-18.04"
      uv_platform="x86_64-unknown-linux-gnu"
      ;;
    linux:arm64)
      echo "Project-local Linux ARM64 toolchain is not available because Ninja does not publish a portable ARM64 Linux zip." >&2
      echo "Use: bash scripts/setup-env.sh --use-system-tools" >&2
      exit 1
      ;;
    macos:x64)
      node_platform="darwin-x64"
      cmake_platform="macos-universal"
      ninja_platform="mac"
      llvm_platform="x86_64-apple-darwin"
      uv_platform="x86_64-apple-darwin"
      ;;
    macos:arm64)
      node_platform="darwin-arm64"
      cmake_platform="macos-universal"
      ninja_platform="mac"
      llvm_platform="arm64-apple-macos11"
      uv_platform="aarch64-apple-darwin"
      ;;
    *)
      echo "Unsupported local toolchain platform: $os_name/$arch" >&2
      exit 1
      ;;
  esac

  node_archive="$downloads/node-v$NODE_VERSION-$node_platform.tar.gz"
  cmake_archive="$downloads/cmake-$CMAKE_VERSION-$cmake_platform.tar.gz"
  ninja_archive="$downloads/ninja-$ninja_platform-$NINJA_VERSION.zip"
  llvm_archive="$downloads/clang+llvm-$LLVM_VERSION-$llvm_platform.tar.xz"
  uv_archive="$downloads/uv-$UV_VERSION-$uv_platform.tar.gz"

  download_file "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$node_platform.tar.gz" "$node_archive"
  extract_archive "$node_archive" "$TOOLCHAIN_DIR/node"
  NODE_BIN="$TOOLCHAIN_DIR/node/node-v$NODE_VERSION-$node_platform/bin/node"
  NPM_BIN="$TOOLCHAIN_DIR/node/node-v$NODE_VERSION-$node_platform/bin/npm"

  download_file "https://github.com/Kitware/CMake/releases/download/v$CMAKE_VERSION/cmake-$CMAKE_VERSION-$cmake_platform.tar.gz" "$cmake_archive"
  extract_archive "$cmake_archive" "$TOOLCHAIN_DIR/cmake"
  CMAKE_BIN="$TOOLCHAIN_DIR/cmake/cmake-$CMAKE_VERSION-$cmake_platform/bin/cmake"

  download_file "https://github.com/ninja-build/ninja/releases/download/v$NINJA_VERSION/ninja-$ninja_platform.zip" "$ninja_archive"
  extract_archive "$ninja_archive" "$TOOLCHAIN_DIR/ninja"
  NINJA_BIN="$TOOLCHAIN_DIR/ninja/ninja"

  download_file "https://github.com/llvm/llvm-project/releases/download/llvmorg-$LLVM_VERSION/clang+llvm-$LLVM_VERSION-$llvm_platform.tar.xz" "$llvm_archive"
  extract_archive "$llvm_archive" "$TOOLCHAIN_DIR/llvm"
  CLANG_BIN="$TOOLCHAIN_DIR/llvm/clang+llvm-$LLVM_VERSION-$llvm_platform/bin/clang"
  CLANGXX_BIN="$TOOLCHAIN_DIR/llvm/clang+llvm-$LLVM_VERSION-$llvm_platform/bin/clang++"
  LLD_BIN="$TOOLCHAIN_DIR/llvm/clang+llvm-$LLVM_VERSION-$llvm_platform/bin/lld"

  download_file "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$uv_platform.tar.gz" "$uv_archive"
  extract_archive "$uv_archive" "$TOOLCHAIN_DIR/uv"
  UV_BIN="$TOOLCHAIN_DIR/uv/uv-$uv_platform/uv"
  if [[ ! -x "$UV_BIN" && -x "$TOOLCHAIN_DIR/uv/uv" ]]; then
    UV_BIN="$TOOLCHAIN_DIR/uv/uv"
  fi

  local missing=()
  [[ -x "$NODE_BIN" ]] || missing+=("node")
  [[ -x "$NPM_BIN" ]] || missing+=("npm")
  [[ -x "$CMAKE_BIN" ]] || missing+=("cmake")
  [[ -x "$NINJA_BIN" ]] || missing+=("ninja")
  [[ -x "$CLANG_BIN" ]] || missing+=("clang")
  [[ -x "$CLANGXX_BIN" ]] || missing+=("clang++")
  [[ -x "$LLD_BIN" ]] || missing+=("lld")
  [[ -x "$UV_BIN" ]] || missing+=("uv")
  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "Local toolchain is incomplete: ${missing[*]}" >&2
    exit 1
  fi

  export UV_CACHE_DIR="$TOOLCHAIN_DIR/uv/cache"
  export UV_PYTHON_INSTALL_DIR="$TOOLCHAIN_DIR/uv/python"
  export UV_NO_MODIFY_PATH=1
  if [[ -n "$PIP_INDEX_URL" ]]; then
    export UV_INDEX_URL="$PIP_INDEX_URL"
  fi
  mkdir -p "$UV_CACHE_DIR" "$UV_PYTHON_INSTALL_DIR"
  "$UV_BIN" python install "$PYTHON_VERSION"

  export PATH="$(dirname "$NODE_BIN"):$(dirname "$CMAKE_BIN"):$(dirname "$NINJA_BIN"):$(dirname "$CLANG_BIN"):$(dirname "$UV_BIN"):$PATH"
  ok "Local toolchain ready: $TOOLCHAIN_DIR"
}

tool_or_command() {
  local local_path="$1"
  local command_name="$2"
  if [[ -n "$local_path" && -x "$local_path" ]]; then
    echo "$local_path"
  else
    echo "$command_name"
  fi
}

initialize_uv_environment() {
  if [[ -z "$UV_BIN" ]]; then
    if [[ -x "$TOOLCHAIN_DIR/uv/uv" ]]; then
      UV_BIN="$TOOLCHAIN_DIR/uv/uv"
    else
      local candidate
      candidate="$(find "$TOOLCHAIN_DIR/uv" -mindepth 2 -maxdepth 2 -type f -name uv 2>/dev/null | head -n 1 || true)"
      if [[ -n "$candidate" ]]; then
        UV_BIN="$candidate"
      fi
    fi
  fi

  export UV_CACHE_DIR="$TOOLCHAIN_DIR/uv/cache"
  export UV_PYTHON_INSTALL_DIR="$TOOLCHAIN_DIR/uv/python"
  export UV_NO_MODIFY_PATH=1
  if [[ -n "$PIP_INDEX_URL" ]]; then
    export UV_INDEX_URL="$PIP_INDEX_URL"
  fi
  mkdir -p "$UV_CACHE_DIR" "$UV_PYTHON_INSTALL_DIR"
}

ensure_node_deps() {
  step "Installing Electron desktop dependencies"
  (cd "$PROJECT_ROOT" && "$(tool_or_command "$NPM_BIN" npm)" install)
}

venv_python() {
  if [[ -x "$PYTHON_VENV_DIR/bin/python3" ]]; then
    echo "$PYTHON_VENV_DIR/bin/python3"
  else
    echo "$PYTHON_VENV_DIR/bin/python"
  fi
}

reset_python_venv_dir() {
  local readme_path="$PYTHON_VENV_DIR/README.md"
  local readme_backup="$TOOLCHAIN_DIR/python-README.md.tmp"
  if [[ -f "$readme_path" ]]; then
    mkdir -p "$TOOLCHAIN_DIR"
    cp "$readme_path" "$readme_backup"
  fi
  rm -rf "$PYTHON_VENV_DIR"
}

restore_python_readme() {
  local readme_path="$PYTHON_VENV_DIR/README.md"
  local readme_backup="$TOOLCHAIN_DIR/python-README.md.tmp"
  if [[ -f "$readme_backup" ]]; then
    cp "$readme_backup" "$readme_path"
    rm -f "$readme_backup"
  fi
}

python_venv_usable() {
  local venv_py="$1"
  local venv_cfg="$PYTHON_VENV_DIR/pyvenv.cfg"
  [[ -x "$venv_py" && -f "$venv_cfg" ]] || return 1

  local base_python
  base_python="$(awk -F= '/^executable[[:space:]]*=/{ sub(/^[[:space:]]+/, "", $2); print $2; exit }' "$venv_cfg")"
  if [[ -n "$base_python" && ! -e "$base_python" ]]; then
    warn "Existing Python venv points to a missing base interpreter: $base_python"
    return 1
  fi
  return 0
}

ensure_python_venv() {
  initialize_uv_environment
  local venv_py
  venv_py="$(venv_python)"
  if python_venv_usable "$venv_py" && [[ "$FORCE" -eq 0 ]]; then
    ok "uv-managed Python venv already exists: $venv_py"
  else
    step "Creating uv-managed Python venv"
    if [[ -e "$PYTHON_VENV_DIR" ]]; then
      reset_python_venv_dir
    fi
    local uv
    uv="$(tool_or_command "$UV_BIN" uv)"
    if [[ ! -x "$uv" ]] && ! have "$uv"; then
      echo "uv was not found" >&2
      exit 1
    fi
    "$uv" venv --python "$PYTHON_VERSION" "$PYTHON_VENV_DIR"
    restore_python_readme
  fi
  venv_python
}

install_python_deps() {
  local venv_py="$1"
  initialize_uv_environment
  local uv
  uv="$(tool_or_command "$UV_BIN" uv)"
  local pip_base=("pip" "install" "--python" "$venv_py")
  if [[ -n "$PIP_INDEX_URL" ]]; then
    pip_base+=("--index-url" "$PIP_INDEX_URL")
  fi
  pip_base+=("${EXTRA_PIP_ARGS[@]}")

  step "Installing Python model export dependencies"
  "$uv" "${pip_base[@]}" --upgrade pip setuptools wheel
  "$uv" "${pip_base[@]}" torch onnx joblib scikit-learn
}

build_inference_runtime() {
  step "Building C++ inference runtime"
  if [[ "$OFFLINE_INFERENCE" -eq 1 ]]; then
    (cd "$PROJECT_ROOT" && "$(tool_or_command "$NPM_BIN" npm)" run build:infer:offline)
  else
    (cd "$PROJECT_ROOT" && "$(tool_or_command "$NPM_BIN" npm)" run build:infer)
  fi
}

show_versions() {
  step "Tool versions"
  for command_name in git node npm cmake ninja clang clang++ lld uv; do
    local tool="$command_name"
    case "$command_name" in
      node) tool="$(tool_or_command "$NODE_BIN" node)" ;;
      npm) tool="$(tool_or_command "$NPM_BIN" npm)" ;;
      cmake) tool="$(tool_or_command "$CMAKE_BIN" cmake)" ;;
      ninja) tool="$(tool_or_command "$NINJA_BIN" ninja)" ;;
      clang) tool="$(tool_or_command "$CLANG_BIN" clang)" ;;
      clang++) tool="$(tool_or_command "$CLANGXX_BIN" clang++)" ;;
      lld) tool="$(tool_or_command "$LLD_BIN" lld)" ;;
      uv) tool="$(tool_or_command "$UV_BIN" uv)" ;;
    esac
    if [[ -x "$tool" ]] || have "$tool"; then
      "$tool" --version 2>/dev/null | head -n 1 || warn "Could not read version for $command_name"
    else
      warn "$command_name not found in PATH"
    fi
  done

  local venv_py
  venv_py="$(venv_python)"
  if [[ -x "$venv_py" ]]; then
    "$venv_py" --version
  fi
}

main() {
  if [[ "$SKIP_SYSTEM_TOOLS" -eq 0 ]]; then
    if [[ "$USE_SYSTEM_TOOLS" -eq 1 ]]; then
      ensure_system_tools
    else
      ensure_local_toolchain
    fi
  fi

  if [[ "$SKIP_NODE_INSTALL" -eq 0 ]]; then
    ensure_node_deps
  fi

  local venv_py=""
  if [[ "$SKIP_BUNDLED_PYTHON" -eq 0 ]]; then
    venv_py="$(ensure_python_venv)"
    if [[ "$SKIP_PYTHON_DEPS" -eq 0 ]]; then
      install_python_deps "$venv_py"
    fi
  fi

  if [[ "$BUILD_INFERENCE" -eq 1 ]]; then
    build_inference_runtime
  fi

  show_versions
  step "Done"
  ok "Desktop build environment is ready."
  if [[ -n "$venv_py" ]]; then
    ok "Bundled Python runtime: $venv_py"
  fi
}

main
