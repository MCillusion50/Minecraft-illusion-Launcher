# 资源大厅 · 安装流程交接单（2026-10-31，r97）

## 当前状态（已验证可用）

| 项 | 状态 |
|---|---|
| 列表（缩略图 52×52 圆角裁切 / 名字 / 介绍） | ✅ 走 HTML 叠层 `#rhIconLayer` |
| 玻璃卡片 | ✅ `makeGlassShape` M_FROST 参数，`independentBackdrop: true` |
| 分类下拉（模组包/材质包/光影包/整合包） | ✅ 引擎绘制，**翻在按钮上方**，弹簧入场（`_rhMenuPop`） |
| ☰ + 搜索胶囊融合 | ✅ 胶囊 `rh-search-cap`（玻璃）+ HTML `#rhSearchInput` |
| 搜索逻辑 | ✅ 380ms 防抖 / 回车立即 / Esc 清空，写 `dl.rhQuery` 后 `build()` |
| 列表裁剪 | ✅ `#rhIconLayer` 用 `clip-path: inset(...)` 裁到列表区 |
| 分区指示器同步 | ✅ 顶部 tabs3 + 分段控件都补了 `renderer.setTabSelected` |

版本 `?v=20261030_r77`，`bin == src` 哈希一致。

## 关键代码位置

| 位置 | 内容 |
|---|---|
| `buildResourceHall(cardX, cardY, cardW, cardH)` | 大厅主构建（约 L14500 起） |
| `renderRhIcons()` + `_rhEsc()` | HTML 列表渲染（缩略图+标题+介绍） |
| `dl.rhIconData` | 每项 `{src,x,y,w,h,baseY,title,desc,fullW}` |
| `dl.rhQuery` / `dl.rhCategory` / `dl.rhSource` | 搜索词 / 分类 / Modrinth|CurseForge |
| `rh-cat-pop-bg` / `rh-cat-pop-*` | 分类菜单元素 id 前缀（弹簧动画按前缀匹配） |
| `#rhSearchInput` | 搜索输入框（用 opacity 显隐，不要用 display，否则重建会丢焦点） |

## 待做：安装流程（本次任务）

**需求**：点「获取」→ 右侧空白区域划出一块玻璃面板，里面选择版本 → 安装。
点获取之前这块面板不能存在。

**老 UI 已经有完整实现（读 JSON），直接学它**：

```
wwwroot/index.html（299,661 字节 / 6546 行，老 UI，还在仓库里）
  L2250  installCfMod(modId, fileId, projectType)      — CurseForge 安装
  L4203  installFromDetail()                            — 详情页安装
  L4248  installCfCardAction(modId, fileId, projectType)
  L4259  installCfFlow(modId, projectType)             — CF 选版本流程
  L4418  installCardAction(source, projectId, projectType, fileId)  — 卡片通用入口
  L4434  installModrinth(projectId, projectType)        — Modrinth 选版本流程
```

**照着抄的要点**：
1. 先拉版本列表（JSON），列表项含：版本号、游戏版本、加载器、文件大小、下载 URL
2. 用户选一个版本 → 调下载 action → 进度回调
3. 完成后按 `projectType` 放到对应目录：
   `mods` / `resourcepacks` / `shaderpacks`
4. 装完刷新该项的「已安装」状态

**新 UI 的实现建议**（避免重蹈今天踩过的坑）：
- 右侧玻璃面板用**引擎元素**画（卡片框 + 版本列表行），文字和缩略图仍用 HTML 叠层
- 面板状态放 `dl`（如 `dl.rhInstall = { open, projectId, versions, selected, busy }`）
- 面板打开时同样要 `clip-path` 或隐藏 HTML 列表，避免 DOM 盖住引擎面板
- 不要新建第二套 `#rhSearchInput` 那样的常驻节点；面板 DOM 只在 open 时创建

## 今天踩过的坑（务必别再踩）

1. **作用域**：`pushEl` 是行循环内部的局部函数；在 `buildResourceHall` 主体里要用 `els.push(...)`
2. **DOM 永远在 canvas 之上**：引擎画的菜单/面板会被 HTML 列表文字盖住 → 要么把引擎内容画到没有 DOM 的区域（今天用"翻到上方"解决菜单），要么藏掉对应 DOM
3. **改完必须 `dotnet build`**：exe 读 `bin\Debug\...\wwwroot` 副本；而且 **Copy-Item 还原会保留旧时间戳 → MSBuild 跳过复制**，需要先刷新 LastWriteTime
4. **`liquidui.js` 混了 CR/LF 两种换行**：PowerShell `Get-Content` 会把某些行合并显示，锚点要挑纯 ASCII 行
5. **禁止重新打包**（`entry.ts` 已冻结改名 `.OBSOLETE-1029`）
6. 每次改动都要改 `index2.html` 里的 `?v=`，否则 WebView2 用缓存
7. 改完看日志确认无异常：`boot_err` 在 WebView2 的 `Local Storage/leveldb/*.log`，需 `FileShare.ReadWrite` 打开（这次就是靠它一眼看出 `pushEl is not defined`）

---

# 安装面板（下一步要做的事）—— 已挖清的接口与现状

## 老 UI 的接口（wwwroot/index.html，已验证可用，新 UI 直接复用）

| action | 参数 | 返回 |
|---|---|---|
| `modrinth_detail` | `{projectId}` | 项目详情（name / icon / 简介） |
| `get_mod_versions_info` | `{projectId}` | 回调 `window.onModVersionsInfo(data)`，**`data.raw` 是 JSON 字符串**，`JSON.parse` 后是 Modrinth v2 版本数组 |
| `download_modrinth_file` | `{url, fileName, saveVersion}` | 真正下载并放进 `mods`/`resourcepacks`/`shaderpacks` |
| `install_modpack` | `{projectId, gameVersion}` | 整合包安装 |
| `cancel_download` | — | 取消 |
| CurseForge | `curseforge_*` / `get_cf_*` 一套 | 同上 |

版本对象字段（Modrinth v2）：`id / name / version_number / game_versions[] / loaders[] / version_type / files[{url, filename, primary}]`。

## 新版里「获取」按钮的现状

`liquidui.js` L14730 附近，目前是**死元素**：

```js
const getBtn = makePlainRect("rh-get-bg-" + i, { x: getX, y: getY, w: getW, h: getH }, [0.17, 0.53, 1, 0.9], getH / 2, false);
pushEl(getBtn);
pushEl(makeText("rh-get-tx-" + i, ..., "\u83B7\u53D6", { color: [1,1,1,1], fontSizePx: 13, ... }));
```

- **没有任何点击处理** —— 要先换成 `makeButton(...)`，再加 `inter["rh-get-btn-" + i] = { onTap: () => openRhInstall(item) }`
- `item` 的项目 id 字段需要确认（列表映射处 `desc: h.description` 附近，可能叫 `project_id` / `id`）

## 用户拍板的方案

**A. 卡片内部右侧抽屉**（点「获取」才出现），把老 UI 的逻辑整套搬过来，只换皮。

## 建议实现步骤

1. **状态**：`dl.rhInstall = { open, projectId, title, versions: [], loading, busy }`
2. **获取按钮**：`makePlainRect` → `makeButton`，`inter["rh-get-btn-" + i] = { onTap: () => openRhInstall(item) }`
3. **openRhInstall(item)**：设状态 → `postStr`/对应 post 发 `get_mod_versions_info {projectId}` → `build()`
4. **回调**：`window.onModVersionsInfo = (d) => { dl.rhInstall.versions = JSON.parse(d.raw || "[]"); dl.rhInstall.loading = false; build(); }`（放在 `onModrinthResult` 旁边）
5. **抽屉绘制**（在 `buildResourceHall` 末尾，`if (dl.rhInstall.open)`）：
   - 引擎：`makeGlassShape("rh-install-bg", {右侧宽度约 360}, M_FROST 参数)` + 标题 `makeText` + 关闭 `makeButton("rh-install-close")`
   - 抽屉要把列表裁剪让出来：把 `#rhIconLayer` 的 `clip-path` 右边距改成 `抽屉宽 + 间距`
6. **版本行**：新建 HTML 层 `#rhInstallLayer`（position:fixed + overflow:hidden + clip-path 到抽屉矩形），每行 `名字 / 游戏版本+加载器 / 安装按钮`，按钮 `onclick` 发 `download_modrinth_file {url, fileName, saveVersion}`
   - `saveVersion` 用当前选中的启动器版本 id
   - DOM 永远在 canvas 之上，所以行内容必须用 HTML（引擎画不了图片/可点击行）
7. **完成**：`window.onDownloadProgress` / 完成回调里刷新列表已安装状态

## 注意（今天踩过的坑）

- `pushEl` 只是**行循环内部**的局部函数，外层用 `els.push(...)`
- 引擎画在 canvas 上，HTML 永远盖在上面 → 抽屉里的可点击行必须 HTML
- 改完必须 `dotnet build`，且如果文件时间戳比 bin 里旧，MSBuild 会**跳过复制**（`Copy-Item` 会保留旧时间戳，要先 `(Get-Item f).LastWriteTime = Get-Date`）
- 报错看 `boot_err`（localStorage leveldb，需 FileShare.ReadWrite）

---

# 安装面板已实现（2026-10-30 第 5 轮，r78）

版本 `?v=20261030_r78`，`bin` 与 `src` 哈希一致。回滚点：
`build\liquid-ui\backups\liquidui.20261030_r77_pre-install.js`（= r77_good，788,265 字节）。

## A 方案：卡片内右侧抽屉

| 项 | 实现 |
|---|---|
| 状态 | `dl.rhInst = { open, projectId, title, source, versions[], loading, busy, pct, msg, err, doneId, installingId }` + `dl.rhInstRect / rhInstScroll / rhInstTarget / rhInstMax` |
| 打开 | `openRhInstall(item)`：设状态 → Modrinth 发 `get_mod_versions_info {projectId}` / CF 发 `get_cf_files {modId}` → `build()` |
| 关闭 | `closeRhInstall()`：`open=false` + 清 `#rhInstallLayer` + `build()` |
| 引擎绘制 | `rh-inst-bg`（M_FROST 参数玻璃，independentBackdrop:true）+ 标题 `rh-inst-title` + 副标题（源 · 当前实例）+ `rh-inst-close` 圆形按钮（makeButton + makeText icon） |
| 版本行 | **HTML** `#rhInstallLayer`（z-index 19）：每行 名字 / `类型 · MC版本 · 加载器 · 大小` + 蓝色「安装」按钮，`data-idx` + 事件委托 |
| 滚动 | 滚轮分支优先命中抽屉矩形 → rAF 缓动 `rhInstAnimate` → 只改 `#rhInstTrack` 的 translate3d |
| 列表让位 | 抽屉打开时 `rowW = cardW-36-(instW+14)`，`#rhIconLayer` 的 clip-path 右边距同样加 `instW+14` |
| 下载 | Modrinth → `download_modrinth_file {url,fileName,saveVersion,projectType}`；CF → `install_curseforge_mod {modId,fileId,versionId,projectType}` |
| 进度 | `onDownloadProgress` 开头分流：`dl.rhInst.busy` 为真时只更新抽屉（按钮变百分比 + 底部状态行），**不碰** `dl.phase` / 整包进度条 |
| 收尾 | `onModrinthInstallDone`（原来前端根本没有这个回调 → 失败静默）+ 进度 done(>=100) → `_rhInstFinish(ok)` → 行变「已装」+ `item.installed=true` + toast |
| 关闭时机 | 切源 / 切分区 / 选分类 / 离开大厅都会清掉抽屉 |

## 本次踩到的关键点（务必记住）

**「获取」按钮原来点不动的真正原因**：引擎的 `hitTest` 命中的是**元素 id**，
`onTap` 也是按 `interactions[el.id]` 查的。旧代码把交互挂成 `inter["rh-get-"+i]`，
而元素 id 是 `rh-get-bg-{i}` → 永远查不到 → 死按钮。
**新交互一律用元素 id 作 key**，例如 `inter["rh-get-bg-"+i] = { onTap }`。

其他：
1. `liquidui.js` 里给字符串写 `\'Segoe UI\'` 时，注意 JS 字符串引号要与 CSS 引号区分；CSS 直接写
   `font-family:Segoe UI,sans-serif`（不带引号）也合法，省掉转义麻烦。
2. `#rhInstallLayer` 自身 `pointer-events:none`，只有行内 `<button>` 设 `pointer-events:auto`，
   所以不会挡住画布上的点击。
3. 抽屉 DOM 每次 `renderRhInstDom()` 全量重建（几十个节点），进度 100ms 一次也够用，重建后会重新套滚动位移。

## 还没做 / 可继续

- 版本列表没有按当前实例（MC 版本 + 加载器）过滤或置顶，Modrinth 原序（最新在前）
- 没有「已安装文件」的文件系统级检测（`已装` 只是本次会话内的标记）
- 整合包（modpack）分类目前仍走 `download_modrinth_file`（会落到 mods 目录），需要改走 `install_modrinth_modpack` / `install_curseforge_modpack`
- CF 需要 `%APPDATA%\.illusionlauncher\global.json` 里配置 `curseForgeApiKey`

---

# 2026-10-30 深夜批（r90 ~ r96）改动摘要

当前版本 `?v=20261030_r96`，已构建、`bin` 与 `src` 哈希一致。
回滚点：`build\liquid-ui\backups\liquidui.20261030_r77_pre-install.js`（= r77_good）。

## 资源大厅
- 行卡片去二次模糊：`ver-item-* / dl-item-* / rh-row-*` 的玻璃参数改为 `blurRadius:0 / refractionHeight:0 / refractionAmount:0 / saturation:1`
- 版本列表 loader 图标：独立 `#verIconLayer`，`applyScroll()` 每帧 `verUpdateIcons()`（不跟随滚动的坑已修）
- 下拉/列表的进入动画只在「刚打开」「内容变化」时播放：`window.__suppressEnter` + `window.__ddJustOpened`
- 下载：进度条改增量更新（`updateRhProgressDom` 只改 width），过渡 `cubic-bezier(.22,.61,.36,1)`；`PARALLEL_THRESHOLD` 常量保持 5MB 不变，只有大厅调用点传 `16 段 / ≥1MB`
- 整合包：抽屉变「保存到哪个文件夹」+ 引擎下载按钮；新 action `pick_folder` / `download_to_folder`（只下载不安装）
- `DetectMcVersion()`：读 `versions/<id>/<id>.json` 的 `inheritsFrom` 继承链拿真实 MC 版本，走新的 `mcMap` 下发

## 设置页（新）
- tab 索引 4 → `page = "settings"`，`buildSettings()`：外卡片 + 左右面板 + 底部导航胶囊（全局 / Liquid Glass / 背景）
- 引擎按钮：保存全局设置、导出诊断包、选择 java.exe、选择 Java 目录、自动检测、选择图片、恢复默认
- HTML 层 `#setInputLayer`：JVM 参数(textarea)、游戏参数、内存管理下拉、三个勾选、Java 列表行、背景预览；面板内 `overflow-y:auto` 滚动
- 内存滑块：引擎 `window.__addSlider`，画在固定区（不参与滚动），数值由 HTML 显示
- **CF API Key 已从设置页移除**，`onGlobalConfigLoaded` 收到后立刻置空，`save_global_config` 不再提交该字段

## 本轮踩到的坑（重要）
1. `pick_background` 原用 `Task.Run`（MTA 线程）弹 WPF `OpenFileDialog` → 直接抛异常，表现为「点了没反应」。改用 `Dispatcher.InvokeAsync`
2. HTML 按钮事件原来绑在 `#setInputLayer` 且靠 `dataset.wired` 只绑一次 → 层重建后点击全失效。改 document 级委托（`window.__setLayerWired`）
3. 引擎按钮绝不能放进 HTML 滚动容器（滚动会错位），必须放固定区
4. `DetectJavaAsync` 原来没有 try/catch，任一目录/坏 java.exe 抛异常就会导致 `onJavaDetected` 永不发送（表现为「检测没有」）；已逐目录 + 逐项兜底
5. C# 序列化是 **PascalCase**（无 camelCase policy），前端读 Java 列表要兼容 `Path/Version`

## 待核 / 待办
- ~~`memoryPreset` 取值核对~~ **已修（r97）**：C# 实际只认 `g1gc` / `zgc` / 空，设置页下拉已改为这三项
- 设置页「背景」分区只做了选图 / 恢复默认，没有历史壁纸列表
- Java 列表行仍是 HTML（如需统一成引擎绘制，要连滚动同步一起做）
