# 桌面端运行、测试与打包手册

本文档面向日常开发和毕业设计演示，说明 Electron 桌面端从环境准备、快速测试、推理编译到 Windows 打包的推荐流程。

## 命令选择

| 目标 | 推荐命令 | 速度 | 说明 |
| --- | --- | --- | --- |
| 日常开发测试 | `npm start` | 最快 | 直接启动 Electron，不打包 |
| 测试推理程序是否能编译 | `npm run build:infer` | 快 | 增量构建，成功后通常显示 `ninja: no work to do` |
| 只测试 UI 和协议 | `npm run build:infer:offline` | 快 | 不链接真实 ONNX Runtime |
| 快速测试打包后的目录 | `npm run build:<platform>:dir` | 中等 | 生成 unpacked 目录，不压安装包 |
| 最终发布安装包 | `npm run build:<platform>` | 慢 | 生成安装包，会压缩资源 |
| 完全不用 MSVC ABI | `npm run build:infer:source` | 很慢 | 从源码构建 ONNX Runtime |

平时不要一上来就跑完整打包命令。它最慢，因为会执行完整 Electron 打包和安装包压缩。

平台命令对应关系：

| 平台 | 快速目录构建 | 完整打包 | 主要输出 |
| --- | --- | --- | --- |
| Windows | `npm run build:win:dir` | `npm run build:win` | `dist/win-unpacked` / NSIS 安装包 |
| Linux | `npm run build:linux:dir` | `npm run build:linux` | `dist/linux-unpacked` / AppImage |
| macOS | `npm run build:mac:dir` | `npm run build:mac` | `dist/mac*` / DMG |

macOS 完整打包一般需要在 macOS 上执行；Windows/Linux 上可以维护脚本和配置，但不要期待稳定产出可签名的 macOS 安装包。

## 首次环境准备

进入桌面端目录：

```powershell
cd "D:\projects\01 ROS\turn_on_wheeltec_robot\desktop"
```

准备本地工具链、Node 依赖、uv 管理的 Python venv 和模型导出依赖：

```powershell
npm run setup:env
```

脚本默认把工具链下载到工程目录：

```text
desktop/.toolchain/
```

Python venv 放在：

```text
desktop/python/
```

这些目录不写入系统环境变量，也不会提交到 Git。

如果只想检查当前环境，不下载、不安装：

```powershell
npm run setup:check
```

如果 Python 依赖已经装好，只想补桌面端 npm 依赖：

```powershell
npm install
```

## 日常开发测试

最常用命令：

```powershell
npm start
```

`npm start` 会直接启动 Electron，适合测试：

- 页面布局、语言、主题、设置。
- ROS 连接和实时数据展示。
- 驾驶、急停、巡航、采集控制。
- CSV 列表、预览和数据集构建入口。
- 模型转换入口。

`npm start` 不会打包，也不会自动重新编译 C++ 推理程序。如果修改了 C++ 推理代码，先运行：

```powershell
npm run build:infer
```

然后再运行：

```powershell
npm start
```

## 机器人侧联调

桌面端依赖机器人侧 rosbridge 和 HTTP API。

推荐三终端方式：

```bash
# 终端 1：底盘、IMU、里程计
roslaunch turn_on_wheeltec_robot turn_on_wheeltec_robot.launch

# 终端 2：数据采集
roslaunch turn_on_wheeltec_robot data_collector.launch fault_label:=0

# 终端 3：Web 控制和 API，避免重复启动底盘/采集/电流节点
roslaunch turn_on_wheeltec_robot web_control.launch start_base:=false start_current_reader:=false start_data_collector:=false
```

桌面端连接：

```text
rosbridge: ws://<robot_ip>:9090
HTTP API:  http://<robot_ip>:8000
```

如果桌面端连接成功但速度、航向或推理一直等待，先在机器人侧检查：

```bash
rostopic hz /odom
rostopic hz /imu
rostopic hz /current_data
rostopic hz /wheel_speed
```

故障推理需要 `/wheel_speed`。没有三路轮速时，桌面端不会用 0 假数据补齐。

## 推理程序构建

### 默认真实 ONNX Runtime

```powershell
npm run build:infer
```

第一次运行会通过 CMake 下载 ONNX Runtime 预编译包。之后通常是增量构建，速度很快。

成功时常见输出：

```text
ONNX Runtime enabled: ...
ninja: no work to do.
```

Windows 上默认使用官方 `onnxruntime-win-x64` 包，因此属于 MSVC ABI 路线。当前脚本逻辑：

- `clang-cl >= 20` 且兼容当前 MSVC STL 时，可以用 `clang-cl`。
- 否则自动退回 VS 自带 `cl`。
- 如果没有可用 MSVC/Windows SDK 环境，使用源码重建路线或离线后端。

### 离线占位后端

```powershell
npm run build:infer:offline
```

它适合测试 UI、进程启动和 JSON-RPC 协议，但不能进行真实 ONNX 推理。界面会显示 ONNX Runtime backend unavailable。

### 源码重建 ONNX Runtime

```powershell
npm run build:infer:source
```

这条路线会下载 `llvm-mingw` 和 ONNX Runtime 源码到 `.toolchain`，然后从源码构建 `onnxruntime.dll`，最后用同一套 MinGW/LLVM ABI 编译 `yp_fault_infer`。

它最慢，适合明确要求“不使用官方 MSVC ABI 预编译包”的场景。普通开发不建议每次都跑。

## 模型导出

默认模型包位于：

```text
desktop/models/sage_cnn/
```

重新导出模型：

```powershell
npm run export:model
```

导出依赖由 `npm run setup:env` 通过 uv 安装。如果手动安装，使用：

```powershell
python -m pip install torch onnx joblib scikit-learn
```

模型包至少包含：

```text
model_manifest.json
*.onnx
scaler.json
feature_config_used.json
```

自定义模型导入方式见 `docs/FAULT_INFERENCE.md`。

### 使用设置页模型转换

桌面端设置页的“故障诊断”区域可以直接把训练输出转换成模型包。它对应的是当前 SAGE-CNN 训练工程，不是任意模型通用转换器。

需要填写：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `模型代码目录` | `C:\Users\86141\Desktop\yp projects\model\model\ypmodel` | 能导入 `from models import build_model` 的训练工程根目录 |
| `已选模型目录` | `...\ypmodel\selected_sage_cnn_model` | 包含最佳权重和 scaler 的目录 |
| `导出目录` | `D:\projects\01 ROS\turn_on_wheeltec_robot\desktop\models\sage_cnn` | 转换后的模型包目录 |
| `Python 运行时` | `D:\projects\01 ROS\turn_on_wheeltec_robot\desktop\python\Scripts\python.exe` | 推荐使用 `setup:env` 创建的项目内 Python |

`已选模型目录` 必须包含：

```text
sage_cnn_selected_best_model.pth
strict_scaler.pkl
feature_config_used.json
```

点击“转换模型”后会生成：

```text
model_manifest.json
sage_cnn_selected_best_model.onnx
scaler.json
feature_config_used.json
```

转换成功后，“模型清单”会自动回填为新生成的 `model_manifest.json`，并触发重新加载。状态变为 `ready` 后即可用于实时推理。

更完整的字段说明和错误排查见 `docs/FAULT_INFERENCE.md` 的“桌面端模型转换面板”。

## 快速打包测试

推荐日常使用对应平台的 `*:dir` 命令：

```powershell
npm run build:win:dir
```

```bash
npm run build:linux:dir
npm run build:mac:dir
```

常见输出目录：

```text
desktop/dist/win-unpacked/
desktop/dist/linux-unpacked/
desktop/dist/mac/
```

这些命令不生成安装包，只把应用和资源整理成可运行目录。适合检查：

- 打包后的 Electron 是否能启动。
- `yp_fault_infer.exe` 是否被带进去。
- `onnxruntime.dll` 是否在推理程序同目录。
- `models/` 是否被带进去。
- `python/` venv 是否被带进去。
- `resources/release/` 是否包含发布元信息。

每次执行 `npm run build:*` 或 `npm run build:*:dir` 前，桌面端会先运行：

```bash
npm run prepare:release
```

该步骤以 `desktop/app-config.json` 为准，同步 `package.json`、`package-lock.json` 和 Electron 打包配置，并生成：

```text
desktop/build/release/app-config.json
desktop/build/release/release-info.json
```

打包后对应文件会出现在：

```text
resources/release/app-config.json
resources/release/release-info.json
```

`release-info.json` 会包含版本号、应用名、包名、`appId`、生成时间和当前 Git 分支/提交号，便于确认安装包来自哪一次发布。

Windows 运行方式：

```powershell
.\dist\win-unpacked\YP Console.exe
```

Linux 运行方式：

```bash
./dist/linux-unpacked/YP\ Console
```

macOS 运行方式：

```bash
open "dist/mac/YP Console.app"
```

如果只是自己开发调试，`npm start` 更快；如果要验证“打包后路径是否正确”，用 `build:win:dir`。

## 最终 Windows 安装包

Windows:

```powershell
npm run build:win
```

Linux:

```bash
npm run build:linux
```

macOS:

```bash
npm run build:mac
```

输出目录：

```text
desktop/dist/
```

完整打包会生成平台安装包，例如 Windows NSIS、Linux AppImage、macOS DMG。它慢是正常的，原因包括：

- 复制 Electron 运行时。
- 打包 renderer、main、preload、assets、SQLite 原生依赖。
- 复制 `python/` venv。
- 复制 `yp_fault_infer.exe` 和 ONNX Runtime 动态库。
- 复制默认模型。
- 压缩生成安装包。

如果终端长时间没有输出，Windows 的 `build-win.js` 会实时显示 electron-builder 日志；仍然慢时，通常是在压缩安装包。

## 推荐工作流

### 只改前端界面

```powershell
npm start
```

发布前：

```powershell
npm run build:win:dir
```

Linux/macOS 对应：

```bash
npm run build:linux:dir
npm run build:mac:dir
```

### 改了 Electron 主进程或 preload

```powershell
node --check main.js
node --check preload.js
npm start
```

发布前：

```powershell
npm run build:win:dir
```

Linux/macOS 对应：

```bash
npm run build:linux:dir
npm run build:mac:dir
```

### 改了 C++ 推理程序

```powershell
npm run build:infer
npm start
```

发布前：

```powershell
npm run build:win:dir
```

Linux/macOS 对应：

```bash
npm run build:linux:dir
npm run build:mac:dir
```

### 要出最终安装包

```powershell
npm run build:infer
npm run build:win
```

### 全新机器准备

```powershell
npm run setup:env
npm run build:infer
npm start
```

确认没问题后：

```powershell
npm run build:win:dir
npm run build:win
```

Linux:

```bash
npm run build:linux:dir
npm run build:linux
```

macOS:

```bash
npm run build:mac:dir
npm run build:mac
```

## 常见问题

### npm run build:win 看起来卡住

优先等日志输出。完整安装包压缩阶段就是慢。

开发阶段改用对应平台的目录构建：

```powershell
npm run build:win:dir
```

```bash
npm run build:linux:dir
npm run build:mac:dir
```

### npm start 能不能测试推理

可以，但前提是已经编译过推理程序：

```powershell
npm run build:infer
npm start
```

如果没有编译推理程序，界面仍能启动，但故障诊断会显示后端不可用或进程未找到。

### npm run build:infer 提示 clang-cl 版本不兼容

本机 MSVC STL 可能要求更高版本 Clang。当前脚本会自动避开不兼容的 `clang-cl 18`，改用 VS 自带 `cl`。

完全不用 MSVC ABI 时，运行：

```powershell
npm run build:infer:source
```

### npm audit 有高危提示

不要直接运行：

```powershell
npm audit fix --force
```

它可能破坏 Electron 和 electron-builder 的依赖组合。先判断漏洞是否影响桌面端运行时，再选择升级。

### 打包后缺少推理程序

先确认本地构建产物存在：

```powershell
Test-Path .\inference\onnxruntime\build\yp_fault_infer.exe
Test-Path .\inference\onnxruntime\build\onnxruntime.dll
```

再运行：

```powershell
npm run build:win:dir
```

检查：

```powershell
Get-ChildItem .\dist\win-unpacked\resources\inference
```

### 打包后缺少 Python

先确认 venv 存在：

```powershell
Test-Path .\python\Scripts\python.exe
```

如果不存在：

```powershell
npm run setup:env
```

然后重新打包。

## 提交前检查

建议至少运行：

```powershell
node --check main.js
node --check preload.js
node --check inference-service.js
node --check model-converter-service.js
node --check scripts\build-infer.js
node --check scripts\build-win.js
node --check scripts\setup-env.js
npm run build:infer
```

如果修改了打包配置，再运行：

```powershell
npm run build:win:dir
```

Linux/macOS 打包配置对应检查：

```bash
npm run build:linux:dir
npm run build:mac:dir
```

不要提交以下目录：

```text
desktop/.toolchain/
desktop/python/
desktop/inference/onnxruntime/build/
desktop/dist/
desktop/node_modules/
```
