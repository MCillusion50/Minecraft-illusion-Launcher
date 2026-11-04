# 直接复制粘贴给另一个 AI 的接手说明

（如果你是能读文件的 agent，直接读这两份就够了，不用看下面的正文）
- D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF\HANDOVER_PROMPT.md
- D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF\HANDOVER_LIQUIDUI.md（重点读最前面 3.0 ~ 3.15）

---

## 正文（粘贴用）

接手 Minecraft illusion Launcher（WPF + WebView2 + 手写 WebGL 引擎）的前端。

**先读文件**（不要凭猜测动手）：
```
D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF\HANDOVER_PROMPT.md
D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\IllusionLauncherWPF\HANDOVER_LIQUIDUI.md  → 只读最前面 3.0 ~ 3.15
```

**四条铁律**
1. 绝不重新打包 `liquidui.js`（`build/liquid-ui/src/entry.ts` 已改名为 `.OBSOLETE-1029`，是旧快照）。只允许对 `wwwroot/liquidui/liquidui.js` 做**唯一字符串替换**。
2. 绝不整体覆盖写文件，只用 edit 定点替换。
3. 改完必须改 `wwwroot/index2.html` 里的 `?v=` 版本号（当前 `20261030_r66`）。
4. 改了 `wwwroot` 必须 `dotnet build`（或跑 `rebuild-restart.ps1`）——exe 读的是 `bin\Debug\...\wwwroot` 的副本，只改源码等于没改。

**关于你之前可能看到的“引擎底层机制”说明，那是错的，请以下面的为准**

崩溃 `Cannot read properties of undefined (reading '0') at rasterizeForeground` 的真实原因：

- 不是 `makePlainRect(..., true)` 的问题，`scroll` 参数与崩溃无关；
- 不是 `isInteractive` 的问题；
- 真实原因：`kind: "button"` 且**没有 icon、没有非空 label** 的元素，会穿过 `rasterizeForeground` 的两个提前返回，掉到画文字的分支，读 `cfg.labelColor[0]`（`makeButton` 里 `labelColor: spec.labelColor`，spec 不传即 undefined）→ 抛错 → rAF 主循环死 → 整个界面卡死。

**这个 bug 已经修好了**（liquidui.js 三处守卫：空 label 直接 return、`_lc` 颜色兜底、makeButton 默认色）。不要重复修、不要删这三处。

**当前进度**
- 玻璃球 / 胶囊 / 折射涟漪 / 全局下沉回弹：完成
- 用户正在自己写「资源大厅」页（Modrinth/CurseForge），函数 `buildResourceHall(...)` 约在 liquidui.js L14478
- 他可能同时在改 `liquidui.js`：**改任何东西之前先读当前内容**，不要用记忆里的旧代码

**工作方式**
- 视觉/动效由用户自己看效果，不要用 Playwright / 浏览器截图验证
- 改动 → 用户手动 rebuild + 重启 → 他反馈 → 再调
- 小步改，一次只改一个可验证的点；遇到底层做不到要早说
- 输出用中文，说明「改了什么 / 为什么 / 怎么调参」
