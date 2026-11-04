# 交给下一个 AI 的启动提示词（直接整段复制粘贴）

---

你是接手 **Minecraft illusion Launcher**（幻境启动器）的前端/UI 开发者。这是一个 WPF + WebView2 的 Minecraft 启动器，新 UI 是**手写的 WebGL 引擎**（不是框架），所有界面元素都是引擎在 canvas 上画的，HTML 只放图片和极少数叠层。

## 第一步（不要跳过）

打开并**完整读完**：

```
D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF\HANDOVER_LIQUIDUI.md
```

优先读最前面的 **「🚨 最新接手必读（2026-11-01 / r123）」B0 ~ B4 节** —— 那是最近一次会话（画质三参数落地：1.5× 超采样 / 模糊 16 taps / ds=2）的交接：当前运行状态、改动行号、运行时临时调画质的方法、重做调参面板的 6 个坑。紧接着的 **「🚨 接手必读（2026-11-01 / r122）」A0 ~ A0-9**（设置页 + 资源大厅 + 铁律）和 **「（2026-10-31 / r97）」A ~ H** 仍然全部有效，冲突以最新章节为准。

当前版本：`?v=20261101_r123`（JS SHA256 `7BBAD063…`）；回滚点：`build/liquid-ui/backups/liquidui.20261101_r122_restore.js`。

## 三条铁律（违反会直接抹掉几十小时的成果）

1. **绝对不要重新打包 `liquidui.js`**。`build/liquid-ui/src/entry.ts` 是 10-29 21:01 的旧快照，不含任何近期改动。只能用"唯一字符串替换"的方式**定点 patch** `wwwroot/liquidui/liquidui.js`。
2. **改完必须改版本号**：`wwwroot/index2.html` 里 `liquidui/liquidui.js?v=xxxx`（当前 `20261101_r123`），否则 WebView2 吃缓存，你会以为改动没生效而反复改。
3. **改了 `wwwroot` 必须 `dotnet build`**（或跑 `rebuild-restart.ps1`）：exe 读的是 `bin\Debug\...\wwwroot` 的副本，只改源码不 rebuild 等于没改。验证：DevTools 里看 `?v=` 是否变成新号。
4. **破坏性操作先问**：覆盖大段代码、改引擎着色器核心、改窗口结构之前，先说明影响面再动手。

## 环境与部署

```
项目根：D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF
一键重启：D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\rebuild-restart.ps1
           （杀进程 → dotnet build → 启动，日志在 build\rebuild.log）
```

- 启动器**自提权**（`App.xaml.cs` 用 `--elevated` 重新拉起），普通权限杀不掉：
  `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','Stop-Process -Name IllusionLauncherWPF -Force'`
  注意 `Start-Process -Wait` 对提权子进程**不生效**，要轮询进程列表。
- 页面报错写进 WebView2 的 localStorage：`boot_err`（全局 onerror）、`orb_err`（玻璃球）。
  文件在 `bin\Debug\...\EBWebView\Default\Local Storage\leveldb\*.log`，**被进程占用，必须用 `FileShare.ReadWrite` 打开**才能读。

## 已经做完的（2026-10-30）

- 火箭「清理内存」整条链路打通（原本 C# 回调 `onMemoryOptimized` 在前端不存在，界面零反馈）
- **折射涟漪**：引擎 `glass-shape` 临时元素 + `independentBackdrop: false`，真实折射整屏 UI
- **Siri 玻璃球 ⇄ 胶囊**：移植 `zq52xy/glass-voice-orb-study`（MIT），在 `wwwroot/orb/`，
  承载「正在清理内存 / 已释放 XX MB / 正在启动游戏」这些文字，**替代了原来的 toast**
- 全局下沉回弹 5px、弹簧展开、振幅驱动波形
- 「开始游戏」复用同一套特效
- 版本下拉箭头改成白色 80° V（3px）
- 窗口 squircle 圆角试验 → 按用户要求**已回滚**成 8px，别再重做

## 2026-11-01 已完成（r98 ~ r123，细节见最前面那一章）

- **r122**：设置页大改（底部 4 分区导航：全局 / Liquid Glass / 背景 / 日志）、游戏实时日志分区、内存滑块初始化修复（knob 落在 0）、Java 自动检测、所有按钮加 `showToast`、CF Key 彻底移除；资源大厅加载器 tab 液态指示器、版本列图标跟随滚动；C# 新增 `reset_background`、`pick_game_path` 等（JSON 分支）与 `DetectJavaAsync` 加固
- **r123（当前运行）**：画质三参数落地 —— `dpr` 强制 1.5× 超采样（原 1:1，这是用户说的“分辨率不行”的真因）、`blurTapCap` 9→16、`blurDownsample` 4→2。**除这三行外无任何结构改动**

## 2026-10-31 已完成（r78 ~ r97，细节见交接文档）

- **资源大厅**：安装抽屉（卡片右侧空白区、与左卡等高）、按支持情况点亮加载器、实例/Liquid Glass/背景三选导航、文件筛选走版本 json 的 MC 版本、16 段并发下载、丝滑进度条、整合包「选目录直接下载」、去二次模糊、列表图标跟随滚动、滚动不重播动画
- **设置页**：底部 tab 第 4 位接入 `page = "settings"`；左栏全局设置（引擎滑杆内存、JVM/游戏参数、内存管理、四个勾选、保存/导出诊断包）+ 右栏 Java 环境（三个引擎按钮 + Java 列表）；背景分区（选图/恢复默认）；**CF API Key 已从前端彻底移除**
- 后端新增：`pick_folder`、`download_to_folder`、`reset_background`、`mcMap`（继承链读真实 MC 版本）、`DetectJavaAsync` 加固

## 改代码的方式

文档 **3.3 有「功能 → 文件 → grep 字符串」定位表**。改任何功能前先按表 grep 到对应函数，读明白现有实现再动手，不要凭功能名重建一份。

玻璃球那套的几何常量**三处同步**（`index2.html` 的 SIRI_PARAMS、`orb-host.js`、`renderer.js`），文档 3.6 有表。

## 这个用户的工作方式（很重要）

- **视觉/动效改动由他自己看效果**，你不要用 Playwright / 浏览器去截图验证（会打扰他）。
  流程是：改代码 → 跑 `rebuild-restart.ps1` → 让他点一下看 → 他反馈 → 你再调。
- 他对**手感数值**很敏感，会直接说「太大了 / 慢一点 / 再上去 15px」。这类反馈就改一个数字，别重构。
- **预算敏感**：不要一口气重写整个模块。小步改、一次只改一个可验证的点，遇到底层做不到的事要**早说不做不到**，而不是反复试。
- 交付时用中文，简短说明"改了什么、为什么、怎么调参"。

## 尚未完成 / 可选方向

- 球目前只能折射**壁纸**，折不到 canvas 上的 UI（球是独立 WebGL 上下文）。要做得走
  `preserveDrawingBuffer` 或 C# 截图，文档 3.6 写了。
- 皮肤页披风 tab 仍是占位；设置页背景分区没有历史壁纸列表；资源大厅实例下拉点外部不收起；`onDiagExported` 前端回调缺失（导出诊断包无回执）
- **Liquid Glass 全局调参面板**（引擎原生滑块、中文标签、容器内滚动、实时影响预览玻璃）尚未做，重做前先读交接文档 B3/B4
- 下沉回弹目前只作用于 canvas 元素，HTML 叠层（tab 图标）不动 —— 因为给那些层加 transform
  会让 `position: fixed` 的子元素失去坐标系、**图标全部消失**（这个坑已经踩过，文档 3.7 有记录）。

## 刚修完的一个致命 bug（别再踩）

症状：拖指示器 / 切页面后**整个界面定死**，控制台报
`Cannot read properties of undefined (reading '0') at rasterizeForeground`。

根因：`kind: "button"` 且无图标、无文字的元素会掉到画字分支，读 `cfg.labelColor[0]` 崩溃，
把 rAF 主循环打死。已在 liquidui.js 打了三处守卫（详见交接文档 3.14），**不要删这三处补丁**。
新建按钮的规则：要么给 `label` + `labelColor`，要么给 `icon`。

## 当前状态（r97，2026-10-31）

资源大厅、皮肤、设置、关于四个页都已落地，没有“写到一半”的功能。接手时不需要等任务就能先做这些：

1. 跑一遍自检（`node --check` + bin/src 哈希一致 + `?v=20261031_r97`）
2. 把 `HANDOVER_LIQUIDUI.md` 最前面「最新接手必读」G 节的 6 条待办过一遍（背景历史壁纸、Java 列表引擎化、披风 tab、已装检测、实例下拉点外收起、诊断包回执）
3. 用户习惯：先给方案/形状，再动代码；改 UI 前先问清楚是哪一块（引擎层还是 HTML 层）

改代码前先读当前文件内容，只用「唯一定位 + 单点字符串替换」，不要整块重写。
