# Minecraft illusion Launcher (幻影启动器)

一款基于 C# (WPF) + WebView2 深度定制的现代化 Minecraft 启动器。拥有极致的 UI 体验、创新的桌面交互，以及自研的底层高兼容性依赖解析逻辑。

## 核心特性 (Features)

- 液态玻璃 UI：基于 WebGL 原生渲染与 CSS 混合叠加，实现极致的折射、高光与物理质感，支持深浅主题平滑过渡。
- 独立桌面灵动岛：游戏启动后，主窗口自动隐藏，右下角弹出独立 WPF 原生“灵动岛”。支持平滑展开/收缩、鼠标悬浮 Q 弹反馈、一键截图直达、快速唤回主界面或强杀游戏进程。
- 智能依赖体检与自愈：内置 JarIntegrityChecker，针对老旧版本（如 1.7.10、1.12.2）的 Forge 加载器，自动检测并补齐 launchwrapper、ASM、LZMA 等核心前置库，告别手打补丁。
- 极限性能优化：
  - 无边框透明窗口 + Environment.Exit(0) 幽灵进程绝杀，点叉秒退，任务管理器干干净净。
  - WebView2 后台自动挂起，绝不抢占游戏资源。
- 玩家配置保护：智能拦截 options.txt 覆盖逻辑，只在首次生成中文配置，绝不覆盖玩家在游戏内的心血设置。

## 技术栈 (Tech Stack)

- 前端表现层：HTML5 / CSS3 / Vanilla JavaScript
- 渲染引擎：WebGL Shader (液态玻璃效果) / Skinview3d (皮肤预览)
- 后端宿主：C# (.NET / WPF)
- 核心通信：Microsoft.Web.WebView2 (postMessage 机制)
- 数据通讯：JSON (System.Text.Json)
- 网络底层：HttpClient (多源并发测速、断点续传)
- 游戏核心层：ProjBobcat (资源补全支持)

## 核心模块目录 (Project Structure)

- MainWindow.xaml.cs：启动器宿主核心，负责窗口无边框处理、WebView2 渲染、下载引擎、游戏启动参数拼接。
- CapsuleWindow.xaml / .cs：独立桌面灵动岛模块，承载亚克力毛玻璃特效与启动状态反馈。
- JarIntegrityChecker.cs：老版本专属依赖体检机，自动下载缺失的底层 Jar 文件。
- wwwroot/index.html：前端主页面。
- wwwroot/style.css：已高度模块化的样式表（液态玻璃、动画、UI 布局）。

## 开发路线图 (Roadmap)

- [x] 液态玻璃 WebGL 渲染与 CSS 拆分重构
- [x] 独立桌面灵动岛 (CapsuleWindow) 状态闭环
- [x] 1.7.10 / 1.12.2 老版本 Forge 兼容性修复
- [x] 幽灵进程清理与游戏帧率解锁
- [ ] 重构核心：引入 SmartDependencyResolver 智能依赖解析器
  - 抛弃传统 if 硬编码补丁，实现类似 HMCL/PrismLauncher 的模块化解析。
  - 递归合并 inheritsFrom 继承链。
  - 自动推导 Maven 坐标，生成完整下载路径。
  - 系统规则 (Rules) 过滤与 Classpath 拓扑去重。


注意：修改前端 HTML/CSS 或 C# 底层后，请务必在任务管理器中结束 IllusionLauncherWPF.exe 和 msedgewebview2.exe 进程，确保缓存刷新。

## 开源协议 (License)

本项目仅供学习与交流使用。请支持 Minecraft 正版游戏。
