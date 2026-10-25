# 前端交接文档（Minecraft illusion Launcher / WPF + WebView2）

> 用途：新会话的 AI 或新接手的开发者，先读这份，不必重新通读 8000+ 行前端。
> 最后更新：2026-10-25

---

## 1. 技术栈与运行方式

- 宿主：WPF (.NET 10, `net10.0-windows10.0.19041.0`)，内嵌 **WebView2**
- 前端：纯静态 `wwwroot/`，**无框架、无构建、无打包**，直接改文件即可
- 虚拟域名：资源通过 `https://app.local/` 映射到 `wwwroot/`
  - 背景：`https://app.local/bg.jpg`
  - 皮肤：`https://skins.local/{id}.png`（C# 端映射到皮肤库目录）

### 文件清单（wwwroot/）

| 文件 | 说明 |
|---|---|
| `index.html` | 全部页面结构 + 三段内嵌 `<script>` |
| `style.css` | 全部样式（含大量追加式覆盖，见第 5 节） |
| `bg.jpg` | 默认背景 |
| `steve.png` | 默认头像 |
| `grass_block.png` | 默认版本图标 |
| `fabirc.png` / `forge.png` / `neoforge.png` | 加载器图标 |
| `made.png` / `easy.png` / `bangbang93.jpg` / `ceshi*.png` | 关于页头像 |
| `modrith.svg` / `forge.svg` | 关于页 SVG 标识 |
| `zybg.jpg` | 备用背景 |

---

## 2. 页面结构（index.html）

单页应用，`.page` 切换显示，`#sidebar` 导航 + `#content` 内容区。

| 页面 id | 导航 | 主要内容 |
|---|---|---|
| `page-home` | 主页 | 账户卡、版本选择、启动按钮、皮肤库、微软登录、账户管理、Java/图标配置、mrpack 导出 |
| `page-versions` | 联机 | EasyTier 建房/加入房间 |
| `page-download` | 下载 | 版本下载+拖入整合包、Mod/资源包/光影/整合包（Modrinth+CurseForge）、多线程下载 |
| `page-settings` | 设置 | 内存、JVM 参数、Java 管理、游戏目录、背景、清理、实时日志 |
| `page-about` | 关于 | 海浪、粒子、开发者卡、鸣谢跑马灯 |

### 三段内嵌 script（都在 index.html）

1. **主业务脚本**（约 1065–5139 行）
   - 页面切换、账户、版本、下载、Modrinth/CF、皮肤、联机、日志、Java、Toast
   - 所有 `window.onXxx` 回调都在这里
2. **WebGL 液态玻璃脚本**（约 5141–5657 行）
   - `#glCanvas` 用 SDF + 折射 + 色散 + 涟漪渲染玻璃
   - `GLASS_SELECTORS` 决定哪些元素有玻璃效果
3. **关于页跑马灯脚本**（`#about-marquee-js`，约 5658–5715 行）

---

## 3. 前后端通信协议（关键）

### 前端 → C#

```js
// 发 JSON 对象
function post(obj) { window.chrome.webview.postMessage(JSON.stringify(obj)); }
// 发纯字符串（简单命令）
function postStr(s) { window.chrome.webview.postMessage(s); }
```

常用 `action`：

| action | 说明 |
|---|---|
| `launch_mc` | 启动游戏（versionId, username, skinId） |
| `cancel_launch` | 取消启动 |
| `scan_versions` | 扫描已安装版本（postStr） |
| `download_mc` | 下载 MC 版本（versionId, versionUrl, loader, loaderVersion） |
| `search_modrinth` / `modrinth_detail` / `get_mod_versions_info` | Modrinth |
| `search_curseforge` / `get_cf_files` / `install_curseforge_mod` | CurseForge |
| `download_modrinth_file` | 下载指定文件到实例 |
| `install_modpack` / `drop_modpack` / `install_modrinth_modpack` | 整合包 |
| `list_skins` / `import_skin` / `apply_skin` / `delete_skin` | 皮肤 |
| `ms_login_start` | 微软设备码登录 |
| `create_room` / `join_room` / `close_room` / `leave_room` | 联机 |
| `open_folder` / `delete_version` / `list_files` / `toggle_file` / `delete_file` / `import_files` | 文件管理 |
| `pick_java` / `pick_java_folder` / `detect_java` / `set_default_java` / `save_java` | Java |
| `pick_game_path` / `pick_background` / `reset_background` / `get_background` | 路径/背景 |
| `load_version_config` / `load_global_config` / `save_global_config` | 配置 |
| `pick_version_icon` / `get_version_icons` / `export_mrpack` | 版本配置 |
| `optimize_memory` / `clean_garbage` / `export_diagnostics` | 工具 |
| `load_stats` / `get_about_info` / `open_url` | 其它 |

纯字符串命令：`minimize` / `close` / `optimize_memory` / `drag` / `get_background` / `detect_java` / `pick_java` / `pick_java_folder` / `pick_game_path` / `pick_background` / `scan_versions`

### C# → 前端

C# 调 `webView.CoreWebView2.ExecuteScriptAsync("window.onXxx(...)")`。前端需预先定义 `window.onXxx`。

主要回调：

- 启动：`onLaunchProgress` / `onGameCrashed` / `onGameForceKilled` / `onGameLog`
- 版本：`onInstalledVersions`（含 versions / javaMap / loaderMap）/ `onVersionDeleted` / `onVersionIconsLoaded` / `onVersionIconPicked` / `onVersionRealInfo`
- 下载：`onModrinthResult` / `onModrinthDetail` / `onModVersionsInfo` / `onCurseForgeResult` / `onCfFilesInfo` / `onModrinthInstallDone` / `onModpackDetected` / `onModpackInstalled` / `onModpackDownloaded`
- 文件：`onFileList` / `onFileChanged` / `onFileToast` / `onHostDrop` / `onModpackDrop`
- 账户：`onMsLoginDeviceCode` / `onMsLoginSuccess` / `onMsLoginFailed` / `onAvatarFetched`
- 皮肤：`onSkinLibrary` / `onSkinApplied`
- Java：`onJavaDetected` / `onJavaPicked`
- 背景：`onBackgroundLoaded` / `onBackgroundPicked`
- 联机：`onCreateRoomResult` / `onCloseRoomResult` / `onJoinRoomResult` / `onLeaveRoomResult`
- 其它：`onAboutInfo` / `onStatsLoaded` / `onStatsUpdated` / `onMemoryOptimized` / `onGamePathPicked`

**约定**：回调数据统一形如 `{ ok: bool, error?: string, ... }`，前端先判 `ok`。

---

## 4. WebGL 液态玻璃（改样式时必须知道）

- `#glCanvas` 固定全屏，z-index 1，`pointer-events: none`
- `#uiLayer` z-index 2，承载所有真实 UI
- 玻璃元素列表：`GLASS_SELECTORS`（index.html 约 5443 行）
- 圆角优先读元素 `data-radius`，其次读 `getComputedStyle().borderTopLeftRadius`，最后按 class 兜底
- **重要**：WebGL 与 CSS 是两套圆角。若 CSS 改了圆角但 `data-radius` 没改，可能出现两层边缘错位。改圆角时优先改 CSS，`getTargets()` 会自动读实际圆角（除非元素写了 `data-radius`）
- 涟漪/主题切换：`window._themeRipple = { active, progress, centerX, centerY, isDark }`
- 背景更新：`window.updateWebGLBackground(url)`

---

## 5. style.css 的坑（务必先读）

### 5.1 追加式覆盖

文件是多轮迭代叠加的，**后写的规则生效**。常见模式：

```
/* ================= tweak-batchN ================= */
```

从 `tweak-batch1` 到 `tweak-batch15` 及之后各类命名块，同一选择器被反复重定义。改样式前**必须 `search_code` 查该选择器所有出现位置**，否则改了半天不生效，或误伤别处。

### 5.2 已知重复定义（历史遗留，未清理）

- `.top-tabs` / `.sub-tabs`：多处重定义
- `.version-option`：v1 / v2 / v3 三套
- `#versionSelectList`：多次重设 max-height
- `@keyframes pageIn`：至少 4 个版本
- `.pill-indicator`：多次重定义
- `#panel-thread .glass-panel`：连续 10+ 段覆盖（squircle 实验遗留）

### 5.3 高优先级 `!important` 很多

大量规则带 `!important`，新增样式若不加 `!important` 可能被压制。建议新增块也用 `!important` 并放在文件末尾。

### 5.4 全局滚动条被隐藏

```css
::-webkit-scrollbar { display: none !important; }
```

局部滚动条按需单独恢复。

---

## 6. 已知代码问题（待清理，改动时留意）

1. `index.html` 中 `extractMcVersion()` **定义了两次**（约 3821、4542 行）
2. `index.html` 中 `onDlResVersionChange()` **定义了两次**（约 4332、4376 行）
3. `openModDetail` 里对 `modDetailBody` 用 `innerHTML = p.body`，Modrinth 返回的是 Markdown，当前按 HTML 直出，存在 XSS/显示问题风险（本地应用，风险有限）
4. `getTargets()` 每帧全量 `querySelectorAll` + `getBoundingClientRect`，元素多时有性能压力
5. 皮肤 URL 使用 `https://skins.local/{id}.png`，`cropSkinHead` 用 canvas 读取，需 C# 端正确设置 CORS/映射
6. 部分 `innerHTML` 拼接未转义（如 CF 项目名 `m.name`），建议统一走 `escapeHtml`

---

## 7. 改动记录（2026-10-25）

全部为**追加式**改动，未重写原有规则。

### index.html
- `SEL` 选择器（约 3253 行）加入 `.launch-btn-main`，使其支持鼠标跟随边缘光

### style.css（末尾追加）
1. `launch-btn-main-edge-light`：启动按钮 1.5px 边缘光，hover 增强，启动中随按钮淡出
2. `ver-download-btn-glass`：下载按钮由蓝色渐变改为半透明白色玻璃（`rgba(255,255,255,.22)` + 毛玻璃），覆盖 `tweak-batch15-apple` 的蓝色
3. `account-panel-unify`：
   - `#accountPanel` 圆角 44px → 24px，与主页账户卡统一
   - `#offlineAddForm .small-btn` 改为蓝色实芯（`rgba(59,130,246,.92)`）

### 边缘光机制（复用，非新建）
- CSS：`::after` 径向渐变 + `mask-composite: exclude` 只留 1.5px 边缘
- JS：`mousemove` 时给元素写 `--mx` / `--my` 百分比
- 想给新按钮加边缘光：① CSS 把选择器加进 `::after` 规则组 ② JS 把选择器加进 `SEL`

---

## 8. 给下一个 AI / 开发者的操作建议

1. **不要整文件读**。用 `search_code` 定位 → `read_file` 只读相关行段
2. **改样式优先在文件末尾追加**，带 `!important`，用注释块标注用途
3. **一次 `edit_file` 携带多个 edits**，减少往返
4. **改前先 `search_code` 查选择器是否已被覆盖过**
5. **验证用 `search_code` 查关键字**，不要重读整个文件
6. 本机 shell 是 Windows，**没有 `cp`**，用 `powershell -NoProfile -Command "Copy-Item ..."`
7. `execute_command` 在本机常返回空输出（`(no output)`），退出码为准；需要看内容时改用 `read_file` / `search_code`

---

## 9. 版本命名约定（前端展示）

`prettyVersionName()` 处理：

- `fabric-loader-{loaderVer}-{mcVer}` → `{mcVer}-Fabric {loaderVer}`
- `{mcVer}-forge-{forgeVer}` → `{mcVer}-Forge {forgeVer}`
- `neoforge-{ver}` → `NeoForge {ver}`
- `{mcVer}-neoforge-{ver}` → `{mcVer}-NeoForge {ver}`
- `quilt-loader-{ver}` → `Quilt {ver}`

版本分类：优先用 C# 返回的 `versionLoaderMap`，缺失时按 id 正则猜（`versionKindOf`）。

---

## 10. 本地状态（localStorage）

| key | 内容 |
|---|---|
| `accounts` | 账户数组 `[{name, type, uuid?}]` |
| `currentAccount` | 当前账户索引或 `null` |
| `customSkins` | 自定义皮肤映射 |
| `customVersionNames` | 版本重命名 + 自定义图标（`icon_{id}`）+ 图标缩放（`scale_{id}`） |
| `appliedSkinByUser` | 用户名 → 皮肤 id |

---

## 11. 快速定位表

| 要找什么 | 位置 |
|---|---|
| 启动流程 | `launchVersion()` / `launchMainBtnClick()` / `window.onLaunchProgress` |
| 版本扫描 | `scanInstalledToHome()` → `postStr('scan_versions')` → `window.onInstalledVersions` |
| 版本选择面板 | `renderVersionSelectList()` / `versionActionButtons()` |
| Modrinth 搜索 | `sendModrinthSearch()` / `window.onModrinthResult` |
| CurseForge 搜索 | `cfSearch()` / `window.onCurseForgeResult` |
| 下载配置弹窗 | `installModrinth()` / `installCfFlow()` / `onDlInstanceSelectChange()` |
| 拖入整合包 | `setupDropZone()` / `window.onModpackDetected` / `onModpackInstalled` |
| 文件管理 | `openFileManager()` / `renderFileList()` / `window.onFileList` |
| 皮肤 3D | `toggleSkinPanel()`（skinview3d）/ `cropSkinHead()` |
| 联机 | `startCreateRoom()` / `startJoinRoom()` / `onCreateRoomResult` 等 |
| WebGL 玻璃 | `GLASS_SELECTORS` / `getTargets()` / `render()` |
| 边缘光 | CSS `tweak-batch11~14` + 末尾追加块；JS `SEL` |
