# Web 远程控制台与 Electron 桌面端诊断系统详细对比分析

## 一、演进历史与设计动机对比

### 1.1 开发时序与需求演化

| 维度 | Web 远程控制台 | Electron 桌面端诊断系统 |
|------|---------------|------------------------|
| **开发阶段** | 第一阶段（初期） | 第二阶段（后期） |
| **原始需求** | 实验室环境下的机器人遥控、传感器监控、数据采集 | 模型训练完成后需要实车部署与在线推理 |
| **核心痛点** | 没有可视化手段控制机器人、无法远程监控传感器 | Web 端无法运行 ONNX 模型，浏览器不能调用本地 C++ 推理引擎 |
| **设计决策** | 用浏览器解决"随时随地访问"问题 | 用桌面客户端解决"本地推理+离线运行"问题 |

### 1.2 为什么不合并成一套？

两套系统并存的根本原因在于**浏览器安全沙箱（Sandbox）的不可逾越性**。

现代浏览器（Chrome/Firefox/Edge）基于多进程架构，渲染进程运行在高度受限的沙箱中，禁止以下操作：
- 启动本地操作系统子进程（如 `yp_fault_infer.exe`）
- 直接读写本地文件系统（如下载路径外的任意目录）
- 加载未经签名的原生动态链接库（如 `onnxruntime.dll`）

Electron 本质上是"Chromium + Node.js"的融合体：渲染进程仍然是 Chromium，但主进程拥有完整的 Node.js 权限，可以执行 `child_process.spawn()`、`fs.readFileSync()`、`require('better-sqlite3')` 等原生操作。这是两者能力差异的根源，也是无法合并的技术约束。

---

## 二、技术架构深度对比

### 2.1 架构模式

| 维度 | Web 远程控制台 | Electron 桌面端诊断系统 |
|------|---------------|------------------------|
| **架构模式** | B/S（Browser/Server，浏览器/服务器） | C/S（Client/Server，客户端/服务器），但 ROS 后端仍为服务器 |
| **前端运行环境** | 用户设备的浏览器渲染引擎 | Electron 内嵌的 Chromium 渲染引擎 |
| **后端服务位置** | 机器人上位机（`:8000` HTTP + `:9090` WebSocket） | 机器人上位机（仅 `:9090` WebSocket），本地主进程提供原生能力 |
| **进程模型** | 浏览器标签页单进程 + 远程 Python HTTP 服务器 | Electron 主进程 + 渲染进程 + ONNX 推理子进程，三进程协作 |

### 2.2 前端技术栈细节

**Web 端技术栈（基于 `web/package.json` 与源码）**：
- **框架**：React 18（函数式组件 + Hooks）
- **构建工具**：Vite（原生 ESM，开发服务器 HMR）
- **状态管理**：`useReducer` 全局状态机（非 Redux，轻量级）
- **UI 组件**：自研组件 + `lucide-react` 图标库 + `recharts` 图表库
- **通信层**：原生 `WebSocket` API 直接连接 rosbridge，无封装库
- **样式**：原生 CSS（`styles.css`），无 Tailwind / Bootstrap
- **国际化**：自研 `useLang` Hook，中英双语言对象映射
- **入口**：`main.jsx` → `createRoot(document.getElementById('root'))`

**Electron 端技术栈（基于 `desktop/package.json` 与源码）**：
- **框架**：无前端框架，原生 Vanilla JS（HTML/CSS/JS）
- **构建工具**：无（开发时直接加载源文件，发布时 `electron-builder` 打包）
- **状态管理**：无集中式状态库，各模块通过 DOM 事件和全局变量通信
- **UI 组件**：无组件库，纯手写 HTML + SVG 图标（内联在 `index.html` 中）
- **通信层**：自研 `RosClient` 类（`ros-client.js`），同样基于原生 `WebSocket`
- **样式**：原生 CSS（`styles.css`），VS Code 深色主题风格
- **国际化**：自研 `i18n.js`，键值对映射，通过 `data-i18n` 属性批量替换
- **入口**：`main.js` → `loadFile('./renderer/index.html')`

### 2.3 关键设计差异

**Web 端 React 的优劣势**：
- 优势：组件化、状态管理清晰、图表库（Recharts）丰富、开发体验好（Vite HMR）
- 劣势：需要编译构建（`npm run build` → `dist/`），产物体积大（`index-DtICZlW-.js` 约 616 KB），对 Python `SimpleHTTPServer` 的 MIME 类型敏感

**Electron 端原生 JS 的优劣势**：
- 优势：零构建开销（开发时直接改 `renderer/*.js` 立即生效），无框架依赖，进程间通信简单直接
- 劣势：代码组织松散（3000+ 行 `app.js`），无虚拟 DOM 优化，图表需手写 Canvas（`charts.js`）

---

## 三、加载与部署机制对比

### 3.1 页面加载路径

**Web 端加载链路**：
```
用户浏览器输入 http://<robot_ip>:8000
    ↓ TCP 连接到机器人 :8000
web_dashboard_server.py (Python SimpleHTTPServer)
    ↓ os.chdir('web/dist/')
返回 index.html (引用 ./assets/index-xxx.js)
    ↓ 浏览器请求 ./assets/index-xxx.js
Python 静态服务器返回 JS 文件
    ↓ React  hydration 执行
WebSocket 连接 ws://<robot_ip>:9090
```

**Electron 端加载链路**：
```
用户双击 YP Console.exe 或 npm start
    ↓ Electron 主进程启动
main.js 执行 createWindow()
    ↓ loadFile('./renderer/index.html')
直接从本地磁盘读取 HTML/CSS/JS (file:// 协议)
    ↓ 渲染进程解析内联 SVG + 原生 JS
用户输入机器人 IP，点击 Connect
    ↓ WebSocket 连接 ws://<ip>:9090
```

### 3.2 部署依赖对比

| 维度 | Web 端 | Electron 端 |
|------|--------|-------------|
| **用户端依赖** | 任意现代浏览器（Chrome/Firefox/Edge） | Windows/macOS/Linux 操作系统 |
| **用户端安装** | 无需安装，输入 URL 即可访问 | 需安装 `.exe` / `.AppImage` / `.dmg` |
| **网络依赖** | 必须与机器人网络互通（`:8000` + `:9090`） | 仅需与 `:9090` 互通，`:8000` 不需要 |
| **机器人端依赖** | 必须启动 `web_dashboard_server.py` | 不需要启动 `web_dashboard_server.py` |
| **离线可用性** | 完全不可用（无 HTTP 服务则无页面） | 界面可用，ROS 功能离线，历史数据/本地推理可用 |

---

## 四、ROS 通信机制对比

### 4.1 连接方式

两套系统使用**完全相同的 rosbridge 协议**，连接的是**同一个 `:9090` 端口**，但初始化方式不同：

**Web 端**：
```javascript
// main.jsx
const defaultUrl = `ws://${window.location.hostname || '127.0.0.1'}:9090`;
const ros = useRosbridge(defaultUrl);
```
- `window.location.hostname` 在通过 `http://robot_ip:8000` 访问时自动解析为 `robot_ip`
- 若用户直接打开本地文件（`file://`），则回退到 `127.0.0.1`

**Electron 端**：
```javascript
// ros-client.js
RosClient.prototype.connect = function (ip) {
    var url = 'ws://' + ip + ':9090';
    this.socket = new WebSocket(url);
};
```
- IP 地址由用户在界面输入框（`#input-ip`）手动填写，默认留空
- 无任何自动推断逻辑，完全依赖用户输入

### 4.2 多客户端支持

rosbridge_server 天然支持多客户端并发连接：
- **场景**：Web 端和 Electron 端可以同时在线，互不干扰
- **共享状态**：两者订阅同一个 `/odom`、`/imu`、`/current_data` 话题，看到的是同一组传感器数据
- **竞争风险**：两者都可以发布 `/cmd_vel_web`，同时操控会产生竞争。实际使用中应避免多前端同时发控制指令。

---

## 五、功能实现方式逐项对比

### 5.1 运动控制

| 功能 | Web 端实现 | Electron 端实现 |
|------|-----------|----------------|
| **虚拟摇杆** | React 组件 `ManualDrive` + `DirPad`，鼠标/触摸事件监听 | Canvas 绘制 `dpad-canvas`，鼠标事件监听 (`drive.js`) |
| **键盘控制** | `useKeyboard` Hook，监听 `window.addEventListener('keydown')` | 全局 `document.addEventListener('keydown')` (`drive.js`) |
| **手柄控制** | `useGamepad` Hook，轮询 `navigator.getGamepads()` | 同样轮询 `navigator.getGamepads()` (`drive.js`) |
| **PID 巡航** | 完整实现：设定目标速度 → `cmd_vel_web_adapter.py` 订阅 `/odom` 做 PID 闭环 | 仅发送目标速度到 `/web/cruise_cmd`，无 PID 闭环（依赖后端 Python 节点） |
| **速度指令出口** | `/cmd_vel_web` → `cmd_vel_web_adapter.py` → `/cmd_vel` | `/cmd_vel_web` → `cmd_vel_web_adapter_node` → `/cmd_vel` |

**关键差异**：Web 端的 Python 版适配器（`cmd_vel_web_adapter.py`）内置了 PID 巡航闭环，而 Electron 端连接的 C++ 版适配器（`cmd_vel_web_adapter_node.cpp`）没有 PID 巡航。因此 **Web 端巡航功能更完整**。

### 5.2 安全保护

两套前端共享**同一套 ROS 后端安全节点**，安全策略完全一致：
- `heartbeat_timeout = 1.0 s`
- `cmd_timeout = 0.5 s`
- `max_linear_x = 1.50 m/s`（Web 端 launch 参数，实际 Python 版为 0.4）
- 急停锁存 `/web/estop`

差异在于**前端自身的急停按钮**：Web 端有 React 渲染的急停 UI，Electron 端有原生 HTML 按钮，两者都发布相同的 ROS Topic。

### 5.3 数据采集

| 功能 | Web 端实现 | Electron 端实现 |
|------|-----------|----------------|
| **采集启停** | React 状态管理，HTTP POST 或 WebSocket 发送指令 | 原生 JS，通过 rosbridge 发送 `/web/collection_enable` |
| **文件列表** | HTTP GET `/api/data/list`，返回 JSON | 同样 HTTP GET `/api/data/list`（调用同一后端 API） |
| **CSV 预览** | HTTP GET `/api/data/preview?file=xxx` | 同样调用 HTTP API |
| **CSV 下载** | HTTP 流式下载，浏览器自动弹保存框 | 通过 Electron `shell.openExternal` 或主进程 `ipcRenderer` 调用原生下载 |
| **数据集构建** | HTTP POST `/api/dataset/build`，后端执行 `build_fault_dataset.py` | 本地直接 `child_process.spawn` 运行 `build_fault_dataset.py`，结果写入 SQLite |

**关键差异**：Web 端的数据集构建完全依赖机器人上的 HTTP 服务，构建进度通过 HTTP 轮询获取；Electron 端可以在本地 Windows 环境直接调用 Python 脚本构建数据集（如果配置了 Python 运行时），构建历史自动存入 SQLite。

### 5.4 故障注入

两套前端都通过 rosbridge 发布故障配置到 ROS Topic，**实现方式完全一致**：
- Topic：`/chassis/fault_config`（或 Web 端用的相关 Topic）
- 参数：`enable`、`fault_type`、`wheel_mask`、`alpha`

### 5.5 故障诊断推理（核心差异）

| 维度 | Web 端 | Electron 端 |
|------|--------|-------------|
| **诊断能力** | ❌ 完全不具备 | ✅ 核心功能 |
| **推理引擎** | 无 | ONNX Runtime C++ (`yp_fault_infer.exe`) |
| **模型加载** | 无 | `inference-service.js` spawn 子进程，加载 `models/sage_cnn/` |
| **输入数据** | 无 | 从 rosbridge 接收 15 通道传感器流，构建 `[15, 50]` 滑动窗口 |
| **预处理** | 无 | 使用训练阶段 `StandardScaler` 参数（`scaler.json`）Z-score 标准化 |
| **推理输出** | 无 | 4 维 logits → Softmax → 部署守卫后处理 → 诊断标签 |
| **结果展示** | 无 | 实时更新诊断面板（类别、置信度、概率条、历史趋势） |
| **故障告警** | 无 | 声光报警（界面闪烁 + 状态栏变色）、自动记录日志 |

**这是两套系统最根本的功能分野**。Web 端无论怎么扩展，都不可能在不借助后端服务的情况下实现浏览器本地 ONNX 推理（WebGL 后端性能不足且不支持你的 C++ 自定义算子）。

---

## 六、数据流与存储对比

### 6.1 传感器数据流

**Web 端数据流**：
```
STM32 → wheeltec_robot_node → /odom, /imu, /current_data
    ↓
rosbridge_server → WebSocket → 浏览器
    ↓
React 组件渲染（Recharts 图表、状态文本）
    ↓
data_collector.py → CSV 落盘
    ↓
HTTP API → 文件列表/预览/下载
```

**Electron 端数据流**：
```
STM32 → wheeltec_robot_node → /odom, /imu, /current_data
    ↓
rosbridge_server → WebSocket → Electron 渲染进程
    ↓
原生 JS 渲染（Canvas 图表、DOM 更新）
    ↓
（分支一）data_collector.py → CSV 落盘
（分支二）实时窗口 → IPC → 主进程 → stdin → yp_fault_infer.exe
    ↓
stdout → JSON-RPC → IPC → 渲染进程 → 诊断面板更新
    ↓
SQLite 数据库（实验记录、诊断历史）
```

### 6.2 文件存储对比

| 维度 | Web 端 | Electron 端 |
|------|--------|-------------|
| **CSV 存储位置** | 机器人本地磁盘（`/home/wheeltec/...`） | 同左（通过 HTTP API 访问） |
| **CSV 访问方式** | HTTP 下载流 | HTTP 下载流 + 本地文件系统（如果 CSV 在本地） |
| **数据集存储** | 机器人本地（`.npy` 文件） | 机器人本地或 Windows 本地（取决于构建脚本执行位置） |
| **实验历史** | ❌ 无持久化，刷新页面丢失 | ✅ SQLite 本地数据库（`userData/yp_console.db`） |
| **连接历史** | ❌ 无 | ✅ SQLite 记录每次连接 IP、时间、状态 |
| **配置持久化** | `localStorage`（主题、语言） | `localStorage` + SQLite（设置项） |

---

## 七、安全模型对比

### 7.1 浏览器/Electron 安全策略

**Web 端 CSP（Content Security Policy）**：
- 无显式 CSP（由 Python `SimpleHTTPServer` 返回，无安全头）
- 浏览器同源策略限制：如果前端部署域名与 rosbridge IP 不同源，可能触发 CORS（但实际局域网部署通常同源）
- 无法访问 `file://` 协议资源

**Electron 端 CSP**：
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data: file:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src ws://*:* wss://*:* http://*:*;" />
```
- 显式配置了 CSP，允许 `file:` 协议图片、允许 `ws://*:*` 和 `http://*:*` 任意连接（开发/局域网友好，但生产环境较宽松）
- `contextIsolation: true` + `nodeIntegration: false` + 专用 `preload.js`：渲染进程被严格隔离，无法直接调用 Node.js API，只能通过白名单 IPC 通信

### 7.2 进程安全

| 维度 | Web 端 | Electron 端 |
|------|--------|-------------|
| **渲染进程权限** | 极低（浏览器沙箱） | 较低（Electron 沙箱 + contextIsolation） |
| **主进程权限** | 无（不存在） | 完整 Node.js 权限（可读写文件、启动子进程） |
| **子进程隔离** | 无 | ONNX 推理运行在独立进程，崩溃不影响主程序 |
| **代码注入风险** | 低（浏览器同源策略） | 低（CSP + preload 白名单），但高于浏览器 |

---

## 八、开发维护对比

### 8.1 开发体验

| 维度 | Web 端 | Electron 端 |
|------|--------|-------------|
| **开发服务器** | `vite --host 0.0.0.0 --port 5173`（HMR 热更新） | `npm start`（Electron 重载整窗口，无 HMR） |
| **调试工具** | Chrome DevTools（F12） | Chromium DevTools（Ctrl+Shift+I）+ Node.js 调试器 |
| **代码组织** | 组件化（17 个 .jsx 组件 + 3 个 Hooks） | 模块化（8 个 .js 文件按功能拆分，但无组件封装） |
| **构建产物** | `dist/` 目录（HTML + JS + CSS，需构建） | 无开发期产物，发布时 `electron-builder` 打包 `.exe` |
| **依赖体积** | `node_modules` 较大（React + Recharts + Vite） | `node_modules` 极大（Electron 33 + electron-builder） |
| **跨平台** | 天然跨平台（任何有浏览器的设备） | 需分别打包（Win/Mac/Linux），体积大（含 Chromium 内核） |

### 8.2 维护成本

**Web 端维护**：
- 修改 React 源码 → `npm run build` → 同步 `dist/` 到机器人 → 重启 `web_dashboard_server.py`
- 构建产物对 Python `SimpleHTTPServer` 的 MIME 类型敏感（`.js` 必须是 `application/javascript`）
- 浏览器兼容性风险（不同浏览器对 WebSocket、Gamepad API 支持有差异）

**Electron 端维护**：
- 修改 `renderer/*.js` → 保存即生效（开发期无需构建）
- 发布时需 `electron-builder` 打包，生成安装包（`YP Console Setup 1.1.0.exe`）
- 需维护 ONNX 推理子进程的兼容性（`yp_fault_infer.exe` 依赖 MSVC 运行时）
- Electron 版本升级可能带来 Breaking Changes（如 IPC API 变更）

---

## 九、适用场景决策矩阵

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 实验室快速遥控、多人协作 | Web 端 | 零安装，手机/平板/电脑都能打开 |
| 故障样本采集实验 | Web 端 | 配合 PID 巡航功能，精确控制运动轨迹 |
| 现场实车长期监测 | Electron 端 | 离线可用，本地推理，数据持久化 |
| 模型推理效果验证 | Electron 端 | 唯一支持 ONNX 实时推理的平台 |
| 数据集批量构建 | Electron 端 | SQLite 记录构建历史，便于追溯 |
| 无网络环境下的调试 | Electron 端 | 不需要 `:8000` HTTP 服务，仅需 rosbridge |
| 临时查看机器人状态 | Web 端 | 最快，输入 IP 即可 |
| 跨平台部署（Mac/Linux）| Electron 端 | 打包相应平台安装包即可 |

---

## 十、总结：一句话定义两套系统

- **Web 远程控制台**：运行在浏览器里的"遥控器+实验面板"，解决"如何方便地操控机器人和采集数据"的问题。
- **Electron 桌面端诊断系统**：运行在操作系统里的"智能诊断工作站"，解决"如何在机器人身边实时运行 AI 模型并给出故障告警"的问题。

两者共用同一套 ROS 后端，共享传感器数据流，但在**能力边界**上被浏览器安全沙箱截然分割——Web 端止步于数据采集，Electron 端延伸至模型推理，这正是两套系统必须并存的根本原因。
