# 0816 可用性审计与部署说明

本仓库是从 `turn_on_wheeltec_robot` 清理并修复得到的 ROS Noetic catkin 包。

## 已修复的阻塞问题

- 补回 `include/wheeltec_robot.h` 末尾缺失的 `};`，避免 `wheeltec_robot_node` 编译失败。
- 底盘接收帧现在对当前串口缓冲区计算 BCC，而不是错误地校验上一帧缓存。
- 电流节点的动态配置同时接受 Web/Electron 发出的 JSON 和旧的 `key=value` 格式。
- 初始化电流节点的待应用参数，避免重连时读取未初始化内存。
- 串口读取异常会进入断线重连逻辑，不再被静默吞掉。
- 电流串口默认值统一为当前车辆使用的 `/dev/ttyUSB1`。
- 巡航模式也受心跳保护；控制端断开后会输出零速度。
- 底盘主循环增加 200 Hz 限速，避免无数据时占满一个 CPU 核心。
- Web 生产构建保存在 `web/dist`，克隆后无需 Node.js 即可由 ROS HTTP 服务提供页面。
- Electron、electron-builder、better-sqlite3 更新到通过 npm 安全审计的组合。

## Ubuntu/ROS Noetic 部署

不要让同一个 catkin 工作空间同时存在两个 `turn_on_wheeltec_robot` 包。先备份旧包，再把本仓库克隆到包目录：

```bash
cd ~/ml_robot_ws/src
mv turn_on_wheeltec_robot turn_on_wheeltec_robot.backup.$(date +%Y%m%d_%H%M%S)
git clone <0816仓库地址> turn_on_wheeltec_robot

cd ~/ml_robot_ws
catkin_make
source devel/setup.bash
```

启动核心 Web/桌面控制链路：

```bash
roslaunch turn_on_wheeltec_robot web_control.launch \
  current_port:=/dev/ttyUSB1
```

如果外置 FDI IMU 包未安装，使用：

```bash
roslaunch turn_on_wheeltec_robot web_control.launch \
  current_port:=/dev/ttyUSB1 \
  start_fdilink_ahrs:=false
```

## 上车验收

```bash
rosnode list | grep -E 'wheeltec_robot|current_reader|rosbridge|web_cmd_vel_adapter'
rostopic info /current_data
rostopic hz /current_data
rostopic hz /odom
rostopic echo -n 1 /web/current_reader_status
```

速度测试前架空车轮或留出安全空间，并准备急停：

```bash
rostopic pub -1 /web/heartbeat std_msgs/Empty '{}'
rostopic pub -1 /cmd_vel_web geometry_msgs/Twist \
  '{linear: {x: 0.05, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.0}}'
```

该命令只发一帧；适配器会在 0.5 秒指令超时或 1 秒心跳超时后自动输出零速度。

## 尚需硬件确认

- `/dev/ttyCH343USB0` 是否始终为底盘控制器。
- 电流板是否输出 `$CURRENT,ch0,ch1,ch2*XX`，且 XOR 覆盖从 `$` 到 `*` 前一个字符。
- 底盘 STM32 上行帧是否为 30 字节、帧头 `0x7B`、帧尾 `0x7D`。
- 固件是否支持仓库中的故障配置扩展帧。

Web/rosbridge 默认监听所有网卡且没有鉴权，只应连接可信局域网；不要直接暴露到公网。
