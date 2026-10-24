# WHEELTEC 机器人控制与诊断平台

面向 WHEELTEC R550PLUS 三全向轮机器人的 ROS 1 工程，集成底盘串口通信、电流与 IMU 数据采集、Web 控制、Electron 桌面监控和 ONNX 故障推理。GitHub 项目名为 **wheeltec-robot-platform**，ROS 包名仍为 **turn_on_wheeltec_robot**。

本仓库原名 `0816`，用于维护机器人应用层。毕业设计中的传感器固件、底盘固件、训练数据和实验结果保留在 [robot-fault-diagnosis-thesis](https://github.com/y-gougou/robot-fault-diagnosis-thesis)；早期 ROS 开发记录及大型网格资产见 [wheeltec-development-history](https://github.com/y-gougou/wheeltec-development-history)。

## 功能与目录

| 目录或文件 | 内容 |
| --- | --- |
| `src/`、`include/` | 底盘通信、航向桥接、Web 速度适配、电流读取的 C++ 节点 |
| `scripts/`、`scripts/core/` | CSV 采集、HTTP/文件 API、故障注入、数据集构建及共享工具 |
| `launch/` | 控制、采集、建图、导航启动配置 |
| `config/`、`params_*/` | 各车型与导航参数 |
| `map/`、`urdf/` | 地图与机器人描述；部分 URDF 所需 meshes 未随本仓库提供 |
| `web/` | React/Vite 源码与已提交的 `web/dist/` 生产页面 |
| `desktop/` | Electron 界面、SQLite、推理服务、模型配置及打包脚本 |
| `docs/` | 使用、协议、桌面构建和推理文档 |
| `tools/verify_repository.py` | 仓库静态检查脚本 |
| `CMakeLists.txt`、`package.xml` | ROS catkin 构建与依赖声明 |

CMake 实际构建四个节点：`wheeltec_robot_node`、`heading_bridge_node`、`cmd_vel_web_adapter_node`、`current_reader_node`。当前编译选项为 C++11。

## 环境与构建

机器人端按 ROS Noetic、Python 3、catkin 环境配置。依赖以 [package.xml](../package.xml) 为准，包括 `roscpp`、`rospy`、`serial`、常用消息包、TF 和 `rosbridge_server`。导航、外置 IMU 等功能还需要对应 launch 引用的外部 ROS 包，完整硬件驱动不包含在本仓库内。

下面使用独立工作空间，避免已有工作空间中出现两个同名 ROS 包：

```bash
mkdir -p ~/wheeltec_platform_ws/src
cd ~/wheeltec_platform_ws/src
git clone https://github.com/y-gougou/wheeltec-robot-platform.git turn_on_wheeltec_robot

cd ~/wheeltec_platform_ws
# 在已安装 ROS Noetic、配置好 rosdep 的环境执行
source /opt/ros/noetic/setup.bash
rosdep install --from-paths src --ignore-src -r -y
catkin_make
source devel/setup.bash
```

数据集构建功能的额外 Python 依赖见 [requirements-dataset.txt](../requirements-dataset.txt)，包含 NumPy、pandas、scikit-learn；按所用 Python 环境安装。当前文档整理未在实车或 ROS 构建环境重跑编译，安装模式另见下方 meshes 限制。

## 启动与连接

基础 Web 控制入口如下。此示例关闭外置 FDI IMU，使用已有底盘 IMU；如需 N100 航向和相关控制功能，应配置对应硬件与驱动。

```bash
source ~/wheeltec_platform_ws/devel/setup.bash
roslaunch turn_on_wheeltec_robot web_control.launch \
  current_port:=/dev/ttyUSB1 \
  start_fdilink_ahrs:=false
```

浏览器打开 `http://<机器人IP>:8000/`，rosbridge WebSocket 为 `ws://<机器人IP>:9090`。入口默认启动底盘、电流读取、采集节点、Web 服务和控制适配器；采集节点启动后由界面开始录制，`collection_auto_start` 默认为 `false`。

安装并配置 `fdilink_ahrs` 后，可使用 N100 数据：

```bash
roslaunch turn_on_wheeltec_robot web_control.launch \
  start_fdilink_ahrs:=true \
  imu_topic:=/n100/imu
```

不要同时重复启动同一底盘、串口读取或采集节点。若这些节点已经单独运行，启动 Web 入口时设置相应 `start_base`、`start_current_reader`、`start_data_collector` 为 `false`；已有 FDI 驱动时也设置 `start_fdilink_ahrs:=false`。

仅采集时可使用：

```bash
roslaunch turn_on_wheeltec_robot data_collector.launch \
  current_port:=/dev/ttyUSB1 \
  fault_label:=0 \
  fault_name:=normal \
  output_dir:=/home/wheeltec/R550PLUS_data_collect/log_v2
```

此入口不会启动底盘；需要先运行底盘节点。`data_collector.launch` 默认 `auto_start:=true`，并要求先收到电流数据。输出路径应按实际机器修改。

## Web 与桌面开发

Web 的生产构建已提交，机器人提供页面时无需现场安装 Node.js。修改前端后，在仓库根目录执行：

```bash
cd web
npm ci
npm run dev
# 生成机器人 HTTP 服务使用的页面
npm run build
```

Electron 开发入口：

```bash
cd desktop
npm ci
npm start
```

桌面环境还依赖 Electron/SQLite 原生组件；真实故障推理需要构建 ONNX Runtime 推理程序并配置模型。具体工具链、`npm run build:infer` 和平台打包命令见 [桌面构建指南](DESKTOP_BUILD_AND_TEST.md)，不要把“界面可启动”当作“推理后端已就绪”。

## 硬件、协议与模型适配

- 底盘串口在 [base_serial.launch](../launch/include/base_serial.launch) 中配置，当前为 `/dev/ttyCH343USB0`、115200；电流串口通过 `current_port` 配置，当前默认 `/dev/ttyUSB1`、115200。设备编号需按现场确认。
- 电流读取使用 `$CURRENT,ch0,ch1,ch2*XX` 文本帧及 XOR 校验；这是三个有效电流通道。毕业设计中独立的四通道 HostApp/ROS 驱动使用另一套二进制解析器，不能直接视为同一协议。
- 底盘上行帧、角度控制、轮速和故障配置扩展必须与 STM32 固件匹配。参阅 [串口协议](PROTOCOL.md) 和 [审计与部署说明](../AUDIT_0816.md)。
- 本版本包含当前帧 BCC 校验、200 Hz 底盘主循环限速、电流配置处理和巡航心跳保护等修复；毕业设计中的 ROS 快照仍保留其原有行为。
- 控制适配器默认指令超时 0.5 秒、心跳超时 1 秒。Web/rosbridge 默认监听所有网卡且没有鉴权，应在可信局域网内使用；实车测试需确认急停和固件响应。
- 桌面推理需要里程计、轮速、IMU、电流等 15 个特征，模型窗口为 50 点。使用配套的模型、scaler、特征顺序和标签映射；现有部署映射为 `normal=0, wheel_slip=1, drive_abnormal=2, shaft_eccentricity=3`。缺少轮速时不能用零值替代后宣称结果有效。详见 [故障推理](FAULT_INFERENCE.md)。

## 可选 meshes 与当前限制

本仓库没有 `meshes/`。部分 `urdf/` 文件仍使用 `package://turn_on_wheeltec_robot/meshes/...` 路径，因此相关车型的可视化会缺少网格；`CMakeLists.txt` 的安装规则也仍列出该目录，`catkin_make install` 存在缺目录失败风险。普通控制启动与模型可视化、安装目标应分别验证。

完整历史资产位于 [开发历史中的 meshes 目录](https://github.com/y-gougou/wheeltec-development-history/tree/668af4ad85521e6a91191258c2b77c7dfeb5a3ca/turn_on_wheeltec_robot/meshes)，共有 469 个文件，原始文件大小合计约 1.11 GB。本次整理未自动复制这些资产。

需要可视化时，先检查所用 URDF 中的 `filename`，从该固定历史版本取出它实际引用的车型目录，再按原路径放到本仓库 `meshes/` 下。保留原文件名称、大小写与来源记录；仅恢复一个车型并不意味着其他 URDF 的资源也齐全。

## 完整文档与来源

- [完整操作参考（原 README 全文）](reference-guide.md)：保留原有细节；其中历史示例应结合本页的实际默认值与限制使用。
- [Web 控制台](../web/README.md)
- [桌面应用](DESKTOP_APP.md)
- [桌面构建与测试](DESKTOP_BUILD_AND_TEST.md)
- [故障推理](FAULT_INFERENCE.md)
- [串口协议](PROTOCOL.md)
- [审计与部署](../AUDIT_0816.md)
- [毕业设计系统、固件与训练实验](https://github.com/y-gougou/robot-fault-diagnosis-thesis)

项目作者：杨鹏（Yang Peng）。保留 WHEELTEC 原有驱动代码、作者注释及依赖组件的版权信息；本仓库许可证见 [MIT LICENSE](../LICENSE)，`Copyright (c) 2026 Yang Peng`。仓库更名不改变 ROS 包名、接口或历史提交。
