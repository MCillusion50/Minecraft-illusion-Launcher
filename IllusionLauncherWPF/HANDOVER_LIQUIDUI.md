# 新 UI 交接文档（liquidui.js / index2.html）

> 用途：新会话的 AI 接手"新 UI"（index2.html + liquidui.js）前必读。
> 关键提醒：**liquidui.js 是外部工程打包产物 + 本地大量改动**，直接重新打包会覆盖所有改动。
> 最后更新：**2026-11-03（第 25 轮：性能诊断收尾 + 帧率上限 60，版本 r153）**

---

# 🚨 最新接手必读（2026-11-03 / r153）★当前版本

## R0. 这次的完整排除结论（花了很多轮，别重新踩）

用户症状：静止 120fps 顺滑；**一执行动作（滚动 / 切分区 / 按住指示器）就掉到 77~90**。

用 r145~r147 加的 HUD（`Ctrl+Shift+F` 显示，`Ctrl+Shift+G` 开 GPU 同步）测出的硬数据：

| 指标 | 值 | 结论 |
|---|---|---|
| RAF 静止 | 120（屏幕 120Hz） | 基准 |
| RAF 动作中 | 77~90 | 每帧 ~12.9ms，超出 120Hz 的 8.3ms 预算 |
| draw（CPU 提交） | **0.5~1.2ms** | CPU 很闲 |
| long task | **0** | JS/GC 完全没问题 |

**所有渲染侧优化都无效**（实测过，不要再试）：

| 尝试 | 结果 |
|---|---|
| 降 44% 像素（dpr 2.0→1.5） | ❌ 帧率无变化 |
| 关折射 / 关模糊 | ❌ 无变化 |
| 小元件（<12000px²）不走玻璃管线 | ❌ 依旧掉帧 |
| 滚动/切分区/动画期间降 Kawase 迭代 | ⚠️ 有效但不够 |

⇒ **确认：瓶颈是每帧的固定开销（元素数 × draw call / FBO 切换），与像素量无关。**

## R1. r153 的解法：帧率上限 ~60

`requestRender()` 里加 16ms 门限（`window.__FPS_CAP` 可调，设 0 解除）。
理由：120Hz 下每帧要 12.9ms、预算只有 8.3ms → 永远在 120↔77 之间抖；
限到 16ms 后每帧都能画完，**稳定 60 比抖动 77 看着顺**。

## R2. 真正能根治但没做的方向

1. **减少每帧 draw call**：`usePerElementFbo` 每块玻璃一个 FBO，20 块玻璃 = 40+ 次切换。
   合并成少量 FBO / 批量 draw 是唯一能真正回到 120fps 的路，但改动大。
2. **减少元素数量**：注释里 37 处硬编码玻璃，很多小元件本可以用 `makePlainRect`。
  注意：r151 试过抛 `blurRadius=0` 但 **kind 仍是 glass-shape**，仍然走玻璃 pass，所以无效。
   真正降级必须换 `kind: "plain-rect"`。
3. **滚动时只平移不重建**：旧实现踩过 hitRect 不同步的坑，但对象复用 + 对象池能减少 GC（不过 long=0，GC 不是瓶颈）。

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r153` |
| 回滚点 | `backups\liquidui.20261103_r152.js` |
| 调试入口 | `__RENDER_SCALE`（分辨率）/ `__FPS_CAP`（帧率上限）/ `__GLASS_MIN_AREA`（已回滚）/ Ctrl+Shift+F、G |

---

# 🚨 接手必读（2026-11-03 / r152）—— r153 的基础

## Q0. 必须先知道的环境事实（我之前两次都判断错了）

| 项 | 值 |
|---|---|
| 窗口 DIP | **1060 × 620**（`MainWindow.xaml`） |
| `window.devicePixelRatio` | **2.0**（Windows 200% 缩放） |
| 旧 canvas（r123~r142） | 2116×1236 = **262 万** |
| 新 canvas（r143） | 1587×927 = **147 万**（**-44%**） |

**坑**：原来的写法 `Math.max(window.devicePixelRatio || 1, Number(__RENDER_SCALE || x))`
在 devicePixelRatio=2 的屏幕上，`x` 写 1.5 还是 1 都会被 `Math.max(2, x)` 吃掉 ——
所以 r123 的“1.5 超采样”和 r140 的“降到 1.0”**两次都没生效**，canvas 一直是 262 万。

r143 改成彻底不看 devicePixelRatio：
```js
this.dpr = Math.min(Math.max(1, Number(window.__RENDER_SCALE || 1.5)), 3);
```

## Q1. 用户的关键观察（调性能时先读这条）

> “一旦有大玻璃容器的地方就会掉帧” —— 这是对的，也解释了为什么一直只盯模糊没用。

玻璃每个像素要算：圆角 SDF、折射偏移（两次采样）、色散、边缘高光、内描边、背景采样。
**全按像素计费**。一块 1000×500 的大卡片 = 50 万像素 × 这一整套；
而老 UI 的 `backdrop-filter` 每像素只做「模糊 + 饱和」，没有折射 SDF。
所以：**大玻璃 = 固定的全屏模糊成本 + 最大的 fragment 面积**，两头都吃满。

下一步可选（按性价比）：
1. 大玻璃跳色散（`quickToggles.chromatic`）—— 每像素省掉 7 次采样
2. 大玻璃的折射精度降级（`refractionHeight` 量化 / 减少采样）
3. `bbox` 区域模糊

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r143` |
| 回滚点 | `backups\liquidui.20261103_r142.js` |

---

# 🚨 接手必读（2026-11-03 / r142）—— r143 的基础

## P0. 下载页「获取」= 实心按钮

位置：`buildDownload()` 里版本列表行尾的 `dl-get-<i>`（`makeButton`）。

**关键坑**：`makeButton(id, rect, spec)` 的对象里是 `...GLASS_PARAMS` 直接铺开，
**spec 里的 `refractionHeight` / `blurRadius` 不会被透传**（只认 `tintColor / surfaceColor / label / labelColor / labelFontSizePx`）。
所以想让按钮变实心，只能**创建后直接改元素属性**：

```js
const getBtn = makeButton("dl-get-" + i, getR, {...}, false);
getBtn.refractionHeight = 0;
getBtn.refractionAmount = 0;
getBtn.blurRadius = 0;
```

- `blurRadius = 0` 同时让 `__gBase.b = 0`，所以全局模糊倍率、`veil` 削白都对它无效（正确行为）
- `highlight`（边缘高光）和 `outerShadow` 保留 —— 否则按钮会变成一块死平的色块
- 还想更“实”（不透背景）：把 `surfaceColor` 的 alpha 从 0.9 改到 1.0

> 同一个文件里的 `dl-clear`（红色的 ✕）仍是玻璃按钮，用户本轮只点名了「获取」。

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r142` |
| 回滚点 | `backups\liquidui.20261103_r141.js` |

---

# 🚨 接手必读（2026-11-03 / r141）—— r142 的基础

## O0. 卡顿定位：分区切换那一瞬

用户体感是“分区滑块的一瞬间卡”，不是持续掉帧。原因链：

1. 点底部导航 → `setSec = k; build();` → **全量重建元素**
2. 新元素没有 `elFboCache` → 所有玻璃同帧失效
3. 而 `blurCacheMissesPerFrame = 1`（引擎的渐进式填充）→ **每帧只补 1 块玻璃**
4. 于是连续卡好几帧，感觉上就是“切换卡一下”

修法：在 `build()` **之前**调 `gtDragLod()` —— 复用拖动那套降载（miss 预算 999 + kawaseQuality 0.5 + 关内阴影），
300ms 后自动恢复全质量并 `markAllDirty()`。代码位置：`buildSettings()` 里 `SET_NAV` 的 `onSelect`。

## O1. 如果切换还卡

说明单帧仍然太重（一次全屏模糊约 116 万像素 × 4 轮）。下一步：
1. 把 `gtDragLod` 的 `kawaseQuality` 再降到 0.35（切换瞬间更模糊，但只持续 300ms）
2. 或者给分区切换加一个“先显示旧内容、新内容 180ms 后淡入”的过渡，把重建藏起来
3. 彻底方案仍是 `bbox` 区域模糊

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r141` |
| 回滚点 | `backups\liquidui.20261103_r140.js` |

---

# 🚨 接手必读（2026-11-03 / r140）—— r141 的基础

## N0. 一行改动

```js
// L4208
this.dpr = Math.min(Math.max(window.devicePixelRatio || 1, Number(window.__RENDER_SCALE || 1)), 3);
//                                                                       ^ 原来是 1.5
```

用户显示器 100% 缩放 → `devicePixelRatio = 1`，所以现在 canvas 就是 **CSS 尺寸的原生像素**（约 1410×824），
像素量从 262 万降到 116 万（**-56%**）。模糊 / 玻璃 / 合成所有 pass 全部受益。

**副作用（必须告知用户）**：
1. 文字和边缘会糊一点（这就是他最早抱怨“分辨率不行”时加 1.5 的原因）
2. 模糊的**设备像素半径**也随 dpr 变小 → 同样的 blurV 看起来模糊更弱

运行时改回去（无需重编）：
```js
window.__RENDER_SCALE = 1.5; window.dispatchEvent(new Event('resize'));
```
折中值 **1.25**（像素 -31%，糊得不明显）。

## N1. 像素档位对照（调性能时直接查）

| `__RENDER_SCALE` | canvas 像素 | 相对 1.0 |
|---|---|---|
| 1.0（当前） | 116 万 | 1.0× |
| 1.25 | 181 万 | 1.56× |
| 1.5（r123~r139） | 262 万 | 2.25× |

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r140` |
| 回滚点 | `backups\liquidui.20261103_r139.js` |

---

# 🚨 接手必读（2026-11-03 / r139）—— r140 的基础

## M0. 拖动期三处降载

r138 已做降采样（-80%），r139 再砍**拖动期间的重复计算**：

| 改动 | 位置 | 效果 |
|---|---|---|
| 只标脏「大玻璃 + 预览」（`面积 ≥ 18000` 或 `id === "set-glass-preview"`） | `gtApplyGlobals()` 循环 | 每帧重算玻璃数 **15 → 3~4** |
| 拖动时 `quickToggles.innershadow = false` | `gtDragLod()` | 跳过 Canvas2D ring-mask 生成（参数每帧变就要重建） |
| `GT_DRAG_QUALITY = 0.6 → 0.5` | 同上 | Kawase 迭代 8 → 4 |

松手 300ms 后 `gtDragLod` 的定时器会：恢复 miss 预算 / tapCap / kawaseQuality / innershadow，
并调 `markAllDirty()` —— 小元素在那一刻一次性补齐（所以拖动时小元素玻璃是“滞后”的，这是故意的）。

## M1. 如果还掉帧，下一个要确认的东西

必须分清场景，否则会一直改错地方：

| 现象 | 病因 | 对策 |
|---|---|---|
| **拖动滑块**时掉 | 每帧重算多块玻璃（本轮已治） | 再降 GT_DRAG_QUALITY / 只留预览 |
| **静止**就掉 | 说明每帧都在重绘（dirty 没生效） | 查 `requestRender` 谁在每帧调 |
| **切页/滚动**时掉 | 全量 `markAllDirty` | 查 build() 里的 dirty 范围 |
| **窗口动画**（缩放/拖动）时掉 | 每次 resize 重建 FBO | 查 `resizeFBOs` 频率 |

剩余未做的大头：
1. **超采样 1.5 → 1.3**（全局 -30%，但会牺牲一点文字锐度，需用户确认）
2. **实现 `blurTexture` 的 `bbox` 区域模糊**（-90%，动渲染管线）
3. **box blur 替换 Kawase**（O(1)/像素，与半径无关）

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r139`，878 810 bytes |
| 回滚点 | `backups\liquidui.20261103_r138.js` |

---

# 🚨 接手必读（2026-11-03 / r138）—— r139 的基础

## L0. 为什么新 UI 比老 UI 卡（根因，以后别重复分析）

| 维度 | 老 UI（CSS `backdrop-filter`） | 本引擎 |
|---|---|---|
| 模糊范围 | **元素矩形**（几十万像素） | **全屏 2116×1236**（262 万） |
| 降采样 | 内部 1/4 左右 | r132 时 1:1 |
| 算法 | box blur，**O(1)/像素，与半径无关** | Kawase，**轮数 ∝ 半径**（半径 12 → 8 轮 × 4 tap） |
| 多块玻璃 | 共享背景捕获 | **每种不同半径各做一次全屏模糊** |

单块 1200×600 玻璃，粗略差两个数量级。而且半径越大 Kawase 越贵 —— 这就是“拉大模糊就卡”的本质。

**还有一块没做的肥肉**：`blurTexture(srcTex, radius, bbox)` 的 **bbox 参数形同虚设**，
函数体里压根没用，所有调用也没传。实现“只模糊元素那一块”能再降 ~90%。

## L1. 本轮：恢复降采样（方案 2）

只改了一行：`this.blurDownsample = 1 → 2`。

引擎的 `pickDsBlurLevel(radius)` 本身就是按半径分档的（`dynamicBlurDownsample = true`）：

| 半径（**设备 px** = blurV × dpr1.5） | ds |
|---|---|
| < 6（即 **blurV < 4**） | 1（全分辨率，小半径保持细腻） |
| ≥ 6（blurV ≥ 4） | 2 |
| ≥ 12 | 4 → 被 `maxDs = 2` 钳住 |

效果：模糊像素 /4，且 `dsRadius` 变小后 Kawase 从 8 轮降到 6 轮 → **合计约 -80%**。
代价：blurV ≥ 4 的大半径会有轻微块感（在大模糊下发不明显）。

想改阈值就改 `pickDsBlurLevel` 里的 `if (r >= 6)`（调大 → 更多半径保留全分辨率，更慢更细）。

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r138`，877 952 bytes |
| 回滚点 | `backups\liquidui.20261103_r137.js` |
| 待办 | 方案①（实现 bbox 区域模糊，收益最大）、方案③（换 box blur，O(1) 与半径无关） |

---

# 🚨 接手必读（2026-11-03 / r137）—— r138 的基础

## K0. 厚度到底该动什么（用户纠正过我一次）

r136 我把 thickness 接到了 `highlight` + `outerShadow` → 用户当场纠正：
**“高光应该不要动，动的应该是内部，让他凸起来”**。这是对的：
- 边缘高光 = 玻璃表面的反光，只影响“边缘锐不锐”，不产生体积
- **内阴影 `innerShadow` 才是凸起感的来源**：元素内侧一圈暗边 = 玻璃被“垫起来”
- 引擎已有现成通道：`drawInnerShadowPass()`（Canvas2D ring-mask），
  开关 `quickToggles.innershadow = true`（L9977，默认开）
- 格式：`innerShadow = { radius, alpha, offsetX, offsetY }`；全工程原先只有 2 处元素用它

## K1. r137 的实现

`glassApplyToConfig()` 里：

```js
var dp = g.depth;                       // 0 = 现在的样子，0~2
if (dp > 0.001 && c.rect.w * c.rect.h >= 12000) {   // 只给大玻璃，不给按钮/胶囊铺 mask
  c.innerShadow = {
    radius:  _r * (0.6 + dp * 0.8),     // 基准 6 → dp1: 8.4，dp2: 13.2
    alpha:   min(1, _a * dp),           // 基准 0.35
    offsetX: 0,
    offsetY: _oy * dp                   // 基准 6，正值 = 阴影落在上沿内侧（凹）；觉得要凸就改负
  };
  c.__gBase.isGen = true;
} else if (c.__gBase.isGen) { /* 恢复原值 / null */ }
```

- **面积阈值 12000px²** 是性能红线：内阴影走 Canvas2D 生成遮罩，每元素一张。
  想铺得更小就给按钮也开，但先测帧率。
- `offsetY` 正负决定凹凸方向（当前用正，与现有 2 处一致）。用户嫌“凹”就改成负值。
- 高光 `highlight` / 外投影 `outerShadow` **完全不参与厚度**，回到原值。

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r137`，877 683 bytes |
| 回滚点 | `backups\liquidui.20261103_r136.js`（高光/投影版本） |

---

# 🚨 接手必读（2026-11-03 / r136）—— r137 已推翻其厚度实现

## J0. 新增：`depth` 玻璃厚度（面板第 2 项）

| 项 | 值 |
|---|---|
| key / 范围 / 步进 | `depth` / 0~2.5 / 0.05，显示 `1.00×` |
| 默认 | 1.00（**等于现在，零视觉变化**） |
| 影响 | 边缘高光 `highlight.alpha`（clamp 0~1）+ `widthDp`；外投影 `outerShadow.alpha` + `radius` + `offsetY` |
| 不影响的 | `innerShadow`（大多数元素是 null）、`surfaceColor`、模糊、折射 |

实现与 blur/refraction 同一套：`__gBase` 里多存 `hl:{a,w}` / `sh:{a,r,oy}`，
`glassApplyToConfig()` 每次**从基准现算 + 新建对象**（不累乘、不污染调用点字面量）。

## J1. 为什么没做内阴影（下一步可选项）

`innerShadow` 的格式是 `{radius, alpha, offsetX, offsetY}`，全工程只有 **2 处**元素用了它，
其余都是 null；而且它走独立的 `drawInnerShadowPass()`，每个元素多一趟渲染。
真正让玻璃“变厚”的确实是内阴影（iOS 的暗侧阴影），但它：
- 需要给所有元素生成默认 innerShadow → 48 处都多一趟 pass
- 还需确认 `quickToggles.innershadow` 开关（L7943）

想上就单独做一轮，建议先只给大面板（外卡、弹层）开，别铺全量。

## J2. 注意：参数已 5 项，面板会滚动

`GT_ROW_H = 96`，5 行 = 480px，超过可视高度 → `gtMaxScroll > 0`，
**要靠滚轮在左侧参数区滚动**才能看到最下面的项。
滚动实现是 r127 的「滚一格 `build()` 一次」，所以滚完滑块的 rect/hitRect 天然一致；
如果拖动滑块时列表在跳，查 `gtScrollBy()` 和 `canvas wheel` 分支（在 listener 最开头）。

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r136`，877 196 bytes |
| 回滚点 | `backups\liquidui.20261103_r135.js` |

---

# 🚨 接手必读（2026-11-03 / r135）—— r136 的基础

## I0. 这一轮定位到的关键事实（以后再改设置页先读这里）

用户报“只有设置页有白雾，0.0 时完全没有”。查证结果：

1. `index2.html` **没有背景层**，只有 `<canvas id="c">`，`body` 透明；canvas `clearColor(0,0,0,0)` 全透明。
2. 壁纸纹理 `this.wallpaperTexture`（L4062）只是喂给 shader 的一份副本，**不是页面背景**。
3. **设置页背后没有可模糊的内容**（纯色/透明）→ 在设置页拖模糊滑块，玻璃本身几乎不变；
   唯一会变的是 `veil`（r133 加的表面白度衰减），所以 **1.6 以上拖不动是正常的，不是坏了**。
4. 白雾 = 固定白度 `surfaceColor.a` 叠在无内容背景上；其他页面因为背后有壁纸，白度被冲淡。

## I1. 本轮改动（只动设置页，其他页面零影响）

| 位置 | 旧 | 新 |
|---|---|---|
| `GLASS_ALPHA`（`set-card` 用） | 0.1 | **0.035** |
| `set-left` / `set-right` 两块 plain 面板 | 0.07 | **0.03** |

目标：设置页玻璃近似纯透明，靠边缘高光 + 外阴影立住（用户原话：“纯透明模糊才是正道”）。

## I2. 未做：让设置页也铺壁纸

用户原本选 C（壁纸 + 降白），但**壁纸那半本轮故意没做**：背景层不在 `liquidui.js` 的页面代码里，
盲改跨层（C#/WPF 或引擎背景路径）风险高。如果下次要做，先确认：
- 设置页的纯色底到底是谁画的（候选：C# `MainWindow` 的 WebView2 背景、或引擎里根据 page 跳过壁纸绘制）
- 若改成铺壁纸，`set-card` 的白度应该回调到 0.06~0.07，否则会变成一块“壁纸图片”而不是玻璃

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r135` |
| 回滚点 | `backups\liquidui.20261103_r133.js` |

---

# 🚨 接手必读（2026-11-03 / r133）—— r135 的基础

## H0. 一句话

白雾不是模糊算法的问题，是 **`surfaceColor` 的固定白 alpha**（0.07~0.16）在小模糊时最显眼：
背景清晰、细节多 → 白膜把细节压淡 = “蒙了一层雾”；模糊大时背景已被抹匀 → 白膜只整体提亮一点点 → 看不出来。

**用户实测：白雾在模糊 1.0~1.5 之间消失**，所以 `GT_VEIL_MAX = 0.35 → 1.6`（`glassApplyToConfig` 里）。

- `< 1.6`：`surfaceColor[3] *= b / 1.6` 线性衰减，b→0 时玻璃完全透明
- `>= 1.6`：veil = 1，**与之前完全一致**（默认 blurV=8 时所有元素 b≥2，视觉零变化）
- 只对 `__gBase.b > 0` 的元素生效，原本 blurRadius=0 的纯色块/防二次模糊层不受影响

| 项 | 值 |
|---|---|
| 版本 | `?v=20261101_r133`，875 543 bytes，SHA256 `0D9D2B559005E3BE097A6E828E1A763A2B1F050225F7BDE059A95F5C99A39EF8` |
| 回滚点 | `backups\liquidui.20261103_r132.js` |

若 1.2 附近仍偏白，只需把 `GT_VEIL_MAX` 再往上调（1.8 / 2.0），不要动其它东西。

---

# 🚨 接手必读（2026-11-03 / r132）—— r133 的基础

> 首次真正动到**模糊着色器本身**。前几轮（r130/r131）改的高斯 taps 全部白费——
> 因为 `useKawaseBlur = true`，实际跑的永远是 `kawaseBlurTexture()`，高斯路径是死代码。

## G0. 当前状态

| 项 | 值 |
|---|---|
| 版本号 | `index2.html` → `?v=20261101_r132` |
| liquidui.js | 875 282 bytes，`node --check` 通过，`bin == src` True |
| 回滚点 | `backups\liquidui.20261103_r131.js` |

## G1. 先记住这条：引擎跑的是 Kawase，不是高斯

`blurTexture()` 第一行：
```js
if (this.useKawaseBlur) return this.kawaseBlurTexture(srcTex, radius);
```
`useKawaseBlur = true`（L9793）。所以 `blurTapCap`、`computeBlur1DTapCount`、`pickDsBlurLevel` 的 taps 量化
**全部只影响高斯分支，永远不执行**。改模糊质量必须改 Kawase 那条路。

Kawase = 每轮只采 **4 个对角点**（等权 0.25），迭代 N 轮。
N 由 `kawaseIterationsForRadius(radius, quality)`：radius<1.5→2、<3→3、<6→4、<12→6、≥12→**8（上限）**，
再乘 `kawaseQuality` 并 clamp 到 [2, 8]。
**所以 quality 调到 >1 对半径 ≥12 的元素毫无作用（已经是上限 8）**，别白费劲。

## G2. 这轮的两个修改

### ① 线性空间平均（治“发白发灰”）
`generateKawaseBlurShader` 原来直接对 sRGB 编码值做加权平均 —— 数学上错，会导致中间调偏移，
半径越大越“蒙一层雾”。改成 **gamma 2.0 近似**：采样后 `rgb*rgb` 解码到线性，平均，再 `sqrt` 编码回去。
为什么用 2.0 而不是 2.2：square/sqrt 比 pow 便宜很多，感知差异极小。
以后若要更准，只能上 RGBA16F FBO + 真正的线性管道（第 3 层，未做）。

### ② 取消模糊降采样（治“不绵密”）
`this.blurDownsample = 2` → **1**。
原来 `effectiveBlurDownsample = 2 × dpr(1.5) = 3` → 模糊在 1/2 分辨率上算再放大，2px 块感就是不绵密的直接原因；
也可能是拖动闪烁的一部分（半径跨 6/12 边界时切换 FBO 档位）。
设 1 后 `dsBlurLevels = [1]`，`pickDsBlurLevel` 永远返回全分辨率。

## G3. 代价与拖动 LOD（重要）

取消降采样 = 模糊像素数 ×4（若半径 ≥12 迭代也从 6→8，合计约 ×5）。
静止时靠缓存（同半径只算一次）几乎无感；**拖动时会重**，所以拖动 LOD 必须作用于 Kawase：

```js
// gtDragLod()
R.blurCacheMissesPerFrame = 999;   // 允许同帧多块玻璃重算（否则退回内联 poisson = 闪）
R.kawaseQuality = 0.6;             // 迭代 8 → 约 5，保拖动帧率
// 松手 300ms 后恢复原值 + markAllDirty()
```

注意 `blurTapCap = 13` 那行对 Kawase **无效**，保留只为高斯兼容。

## G4. 如果还是不够

下一层（未做，需要先验 WebGL2）：FBO 换 RGBA16F + shader 全线性管道 → 无色带、颜色绝对正确。
当前 FBO 是 `RGBA/UNSIGNED_BYTE`（L3187），8-bit 反复迭代会累积量化误差。
**先查** `canvas.getContext("webgl"|"webgl2")` 才能决定这条路能不能走。

---

# 🚨 接手必读（2026-11-03 / r131）—— r132 的基础

> r130 的两个“修复”方向是错的（改 surfaceColor 削白、taps 量化），**真因在下面两条**。
> 以后遇到“小模糊发白”或“拖半径闪”，先看这两个开关，不要先去调参数。

## F0. 当前状态

| 项 | 值 |
|---|---|
| 版本号 | `index2.html` → `?v=20261101_r131` |
| liquidui.js | 874 319 bytes，`node --check` 通过，`bin == src` True |
| 回滚点 | `backups\liquidui.20261103_r130.js` |

## F1. 发白的真因：`shouldUseSeparableBlur` 的 0.5 阈值（已修）

```js
function shouldUseSeparableBlur(el, state) {
  if (el.blurRadius < 0.5) return false;   // ← 元凶
```

半径 < 0.5（**CSS px**，不含 dpr）时，`resolveBackdropTex` 直接跳过第一个分支，
改走 `bgOnlyTex` / `curTex` + shader 内联 poisson 兼容路径 —— 背景源与合成方式都不同，观感就是一层白。
**r131 改成 `< 0.05`**，让所有半径走同一条路径。半径极小时 `blurTexture` 内部仍会
`dsRadius < 0.5 → return srcTex`（不模糊），但那是“清晰背景”，不会白。

## F2. 拖动闪烁的真因：`blurCacheMissesPerFrame = 1`（已用拖动 LOD 绕过）

源码注释：每帧只允许 **1 次**新的模糊计算，其余 cache miss 本帧 `didBlur=false`，
退回 shader 内联 poisson（质量不同），留到后续帧渐进填充。

静止时缓存全命中 → 不闪；但拖半径时每帧附近都变，十几块玻璃各自是不同的 `qRadius` key →
全部 miss → **每帧只有 1 块是真分离模糊，其余是兜底**，逐帧轮换 = 闪。

r131 的修法（`gtDragLod()`，在 `gtApplyGlobals` 里调用）：
- 拖动中：`blurCacheMissesPerFrame = 999`（全部重算，不再降级）+ `blurTapCap = 13`（降质量保帧率）
- 松手 300ms 无新事件：恢复原值（普遍是 miss=1 / tapCap=28）+ `markAllDirty()` 重绘一次
- 原来的值存在 `R._gtSavedMiss` / `R._gtSavedTap`，**不要写死常量恢复**

代价：拖动过程是 13 taps 的粗模糊，松手才变精细。这是故意的（drag LOD）。

## F3. 引擎里其它同类“除阀”位置（以后碰到先查这几处）

| 位置 | 阈值 | 含义 |
|---|---|---|
| `shouldUseSeparableBlur` | 0.05（原 0.5） | 小于它就走另一条渲染路径 |
| `blurTexture` 里 `dsRadius < 0.5` | 0.5 | 设备像素，小于它直接返回源纹理（不模糊） |
| 遮罩 shader `uRadius < 0.5` | 0.5 | 同上，用于高光遮罩模糊 |
| `computeBlur1DTapCount` | 0.5 / 量化 7·13·19·28 | taps 档位 |
| `backdropBlurCacheMax` | 64 | 模糊缓存上限，拖动时 0.1 步进会快速填满并驱逐 |

---

# 🚨 接手必读（2026-11-03 / r130）—— 已被 r131 推翻的部分见上面

> 在 r129 的全局倍率基础上只解决三个用户报的毛病，不新增功能。

## E0. 当前状态

| 项 | 值 |
|---|---|
| 版本号 | `index2.html` → `?v=20261101_r130` |
| liquidui.js | 872 677 bytes，SHA256 `184D083FF0557591EAC76080AAAAE1670236B13820F6FE37870B6A8E4FB7341E` |
| bin == src | True，`node --check` 通过 |
| 回滚点 | `backups\liquidui.20261103_r129.js`（= 纯倍率制） |

## E1. 三个问题的根因与修法（都是引擎侧真实原因，别退回）

**① 模糊 0.10 以内发白**
引擎里 `blurTexture()` 有 `if (dsRadius < 0.5) return srcTex;`，遮罩 shader 也有 `if (uRadius < 0.5) texture2D` ——
模糊半径（**设备像素**，要乘 dpr 1.5）小于 0.5 时**直接不模糊**，玻璃退化成“背景 + 白 surface”的一层白纱。
→ 修法：`GT_VEIL_MAX = 0.8`，在 `glassApplyToConfig()` 里算 `veil = clamp(b / 0.8, 0, 1)`，
把 `surfaceColor[3]` 乘上 veil，模糊越接近 0 白度越少，玻璃趋近全透明而不是变白。
**只对基准 `blurRadius > 0` 的元素生效**，原本就是 0 的元素（防二次模糊/纯色块）不受影响。

**② 拉高模糊时闪烁**
`computeBlur1DTapCount()` 随半径逐像素返回不同 taps（7…33），
`runBlurPasses()` 里的 `ensureBlurPrograms(tapCount)` 于是**每换一个 taps 就现编一个新 GLSL program**，
拖动全程要编译 ~20 个程序 → 顿卡/闪烁。
→ 修法：taps **量化到 4 档** `7 / 13 / 19 / 28`，并在 `window.__lgRenderer` 赋值后 `setTimeout 1500ms` 预编译这 4 档。
以后要改档位，**预热数组和量化表达式必须同步改**（两处）。

**③ 模糊必须是 0.1 步进的真真实数值**
`GT_DEF` 里 blur 从倍率 `blurM(0~2.5, step .05)` 改成 **`blurV`：0~24，step 0.1**，显示一位小数（`8.0`）。
内部倍率 = `blurV / 8`（`GT_BLUR_BASE = 8` = `M_LIQUID.blurRadius` 原值，所以 8.0 = 原来的 1.00×）。
折射高度 / 折射强度仍然是倍率（用户只要求改模糊）。
旧的 `localStorage["glassGlobals"]` 里如果存的是 `blurM`，启动时会自动换算 `blurV = blurM × 8`。

## E2. 代码位置（r130）

| 位置 | 内容 |
|---|---|
| ~L2711 `computeBlur1DTapCount` | taps 量化表达式 `n<=8?7 : n<=14?13 : n<=21?19 : 28` |
| ~L11470~11530 | `GG.blurV` / `GT_BLUR_BASE` / `GT_VEIL_MAX` / `glassApplyToConfig()` |
| ~L16700 `window.__lgRenderer = renderer;` 后 | 4 档预热 `setTimeout(...,1500)` |
| `GT_DEF` | `blurV` 项 `min:0, max:24, step:0.1` |
| `gtGet` / `gtFmt` | `blurV` 默认 8、显示 `toFixed(1)` |

---

# 🚨 接手必读（2026-11-03 / r129）—— r130 的基础

> 本章在 r128（= r123 画质三参数 + 调参面板）基础上改的**只有一件事**：
> 把原来只作用于 8 个元素的 `M_LIQUID`，换成能覆盖全部玻璃的「基准值 × 全局倍率」机制，
> 并加了「重置 / 保存」两个胶囊按钮。引擎 / 着色器一行没动。

## D0. 当前状态

| 项 | 值 |
|---|---|
| 版本号 | `index2.html` → `?v=20261101_r129` |
| liquidui.js | 870 303 bytes，SHA256 `9851891016E9FF484B168945119754A94F5854784CB3DDC7EB0933E206C08E3A` |
| bin == src | True，`node --check` 通过 |
| 回滚点 | `build\liquid-ui\backups\liquidui.20261101_r128.js` + `index2.20261101_r128.html`；r129 自身也存了 `liquidui.20261103_r129.js` |

## D1. 为什么是「倍率」而不是绝对值（关键设计，别改回去）

全工程 `makeGlassShape` 共 **48 处调用**，实际分布：

| 分类 | 处数 | 改倍率前是否响应调参 |
|---|---|---|
| `...M_LIQUID` | 8 | ✅ |
| `...M_FROST` / `...M_THICK` | 3 | ❌ 固定值 |
| **完全硬编码**（自带 `blurRadius:` / `refractionHeight:` / `refractionAmount:` 字面量） | **37** | ❌ **根本不看 M_LIQUID** |

这就是「拖滑杆只有一部分玻璃变」的原因。37 处里还有 4 处**故意把 `refractionHeight` 设成 0**（玻璃叠玻璃会「挖洞」，铁律 8），
所以不能统一塞一个绝对值 —— 必须保留每块玻璃的相对层次。

结论：**元素基准值 × 全局倍率**。默认倍率 1.00 时与 r128 逐像素一致。

## D2. 代码位置（r129）

| 位置 | 内容 |
|---|---|
| `var M_LIQUID = {...}` 之后（约 L11456） | `var GG = { blurM, refrHM, refrAM, chroma }` + `glassApplyToConfig()` + `window.__glassG` / `window.__glassApply` |
| `renderer.setButtons(configs)` 第一行（约 L4803） | `if (window.__glassApply) for (const _c of configs) window.__glassApply(_c);` ← **唯一注入点** |
| `GT_DEF`（约 L18000） | 4 项改成倍率 key：`blurM` / `refrHM` / `refrAM` / `chroma` |
| `gtApplyGlobals(force)`（新增，约 L18025） | 遍历 `renderer.buttonConfigs` 重算 + `markElementDirty` + `requestRender` |
| `gtApplyLive(k, v)` | 写 `window.__glassG[k]` → 调 `gtApplyGlobals(true)` |
| `buildSettings()` 里 `if (setSec === "glass")` | 标题右侧两个胶囊：`setb-gl-reset` / `setb-gl-save`；`mkSetBtn` 已上移到 `secName` 之前 |
| `localStorage["glassGlobals"]` | 保存的键；启动时在 GG 的 IIFE 里读取并 clamp |

## D3. 三个容易踩的点

1. **`__gBase` 只记一次**：每次 `build()` 元素对象都是新构造的，所以不会累乘。若将来改成复用旧 config 对象，会指数放大 —— 改之前先看 `setButtons`。
2. **chroma 是「允许色散」总开关，不是「强制开」**：默认 `1` = 保持各元素原本的 `chromaticAberration`（视觉与 r128 一致）；拨到 `0` = 全部关闭（省性能）。引擎里真正的门是 `el.chromaticAberration && quickToggles.chromatic`（L7582）。不要把它改成强制 1，那会让 48 块玻璃一起开 7-tap 色散。
3. **基准值必须落成数字**：`Number(c.blurRadius) || 0`。某些元素类型若缺字段，`undefined × 倍率` 会变成 NaN 直接污染 uniform。

## D4. 重置 / 保存按钮

- 「重置」：GG 归 1（chroma 归 1）→ 删 localStorage → `gtApplyGlobals(true)` → `build()` → toast「已重置」
- 「保存」：`localStorage.setItem("glassGlobals", JSON.stringify(window.__glassG))` → toast「已保存」
- 位置：左栏标题「Liquid Glass」右侧，两个 62×26 胶囊（`makeButton`，主按钮蓝色 `[0.17,0.53,1,0.9]`）

## D5. 本轮踩到的部署坑（重要）

`rebuild-restart.ps1` 里的 `Stop-Process` **杀不掉已提权的旧实例**，于是每跑一次就多一个启动器进程，
两个实例共用同一个 `EBWebView` 数据目录会互相抢 localStorage（`glassGlobals` 就在里面）。
**重建后必须检查进程数**，多出来的用提权杀：

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','Stop-Process -Id <旧PID> -Force' -WindowStyle Hidden
```

---

# 🚨 接手必读（2026-11-01 / r125）—— r129 的基础

> 本章在 r123 基础上**只加了一个调参面板**，引擎/画质参数一行没动（B1 的三处仍是 1.5× / 16 taps / ds=2）。
> ⚠️ 历史章节：本章写的 `?v=20261101_r127` / 864 929 bytes 是当时的快照，后续 r128 把 `blurTapCap` 改成了 28，
> r129 又把面板语义改成倍率并加了重置/保存按钮 —— 以最前面的 r129 章节为准。

## C0. 当前状态

| 项 | 值 |
|---|---|
| 版本号 | `index2.html` → `?v=20261101_r127` |
| liquidui.js | 864 929 bytes，`node --check` 通过，`bin == src`（哈希一致） |
| 回滚点 | `build/liquid-ui/backups/liquidui.20261101_r123.js` + `index2.20261101_r123.html` |

## C0-4. r127：滚动改成「重建」+ 动 `dynamicBlurDownsample`

**① 参数区滚动彻底改成 rebuild**（`gtScrollBy(dy)`：改 `gtScrollY` → `build()`）。
r126 之前是手动平移 `rect` / `hitRect` / knob 基准，出现三个连锁症状：
视觉移位了但 hitRect 不同步（点不到）、填充条 fraction 与位置来自两套状态（蓝条不跟手）。
现在滑块的 rect / hitRect / fill / knob 全部由 `gtFrac()` 在一次 build 里现算，天然一致。
**教训：引擎里给元素做滚动，不要自己挪元素，直接重建**（皮肤网格 `skScroll += dy; build()` 就是这么做的）。

**② `dynamicBlurDownsample` 由 false 改成 true**（渲染器构造函数，行内注释写了原因）。
原来 OFF 时 `ds = blurDownsample(2) × dpr(1.5) = 3` —— **所有玻璃的模糊都在 1/3 分辨率上算再放大**：

- blurRadius 很小（0.4~0.7）时几乎没有模糊量可算，等于把 1/3 分辨率的背景直接拉大 → 用户看到的“一下放大”
- 大半径也带着 1/3 分辨率的块状感 → user 说的“脏、不绵密”

ON 之后 `pickDsBlurLevel` 按半径选：`radius < 12px → ds=1`（全分辨率），`≥12 → ds=2`。
代价是模糊 pass 像素数变多（ds 1 → 9×/4× 于 ds3/2），FPS 会掉。运行时可对比：

```js
window.__lgRenderer.dynamicBlurDownsample = false;   // 退回 r126 画质
window.__lgRenderer.blurTapCap = 33;                 // 默认 28（r128），33 是自然上限
window.__RENDER_SCALE = 1.2; window.dispatchEvent(new Event('resize')); // 省性能
```

## C0-5. r128：blurTapCap 16 → 28

用户要求「改到 28 看看」。28 **合法**：`generateGaussianKernel1D` 里有 `tapCount % 2 === 1 ? i - half : i - half + 0.5`
的半格偏移分支，偶数 tap 不会让模糊中心偏移，不用担心要凑奇数。

代价：模糊 pass 的取样量约 16→28 = 1.75×（叠加 r127 的 ds=1，小半径时是 r123 的 ~9×1.75 倍片段工作量）。
掉帧先看 FPS HUD；要退就 `window.__lgRenderer.blurTapCap = 16`，要更狠就 33。

## C0-2. r126 修的两件事

1. **步进 0.5 → 0.1**（`GT_DEF` 的 `step`），`gtSetFromFrac` 里多了一层 `Math.round(q*1000)/1000` 消浮点尾巴。
2. **滚动后滑块「脱轨」的真正原因**：`gtBuildParams` 的 `push(el, dy)` 里，滑块那四个元素（track/fill/knob）传的是 `dy: 0`，
   但它们实际建在 `rowY+44`。一旦 `gtApplyScroll` 跑起来（`gtMaxScroll > 0` 时滚一下），
   `el.rect.y = baseY - gtScrollY + dy` 就把整组拉回 `rowY` → 蓝条和胶囊叠到标题文字上、拖动手感全乱。
   **现在 `dy` 一律由 `el.rect.y - rowY` 现算**，不再手写常量。以后加参数只要用 `push(el)` 一个参数。
3. 顺带：数值文字下面垫了一块 `rgba(0,0,0,.34)` 的深色小胶囊（宽 64 / 圆角 11）——纯白字压在亮玻璃背景上根本看不见。

## C0-3. 排查手法（这次靠它定位）

`boot_err` 就是唯一真相，读法：

```powershell
$f = "...\bin\Debug\net10.0-windows10.0.19041.0\IllusionLauncherWPF.exe.WebView2\EBWebView\Default\Local Storage\leveldb\000026.log"
# 必须 FileShare.ReadWrite 打开（进程占着）
```

量 UI 位置别靠眼睛：截图丢给 Pillow 统计蓝色条（`b>150 && b-g>40 && b-r>60`）和白色文字的 y 区间，
一比就知道是哪一组元素被挪了 44px。这次就是这么定位的。

## C0-1. r125 修的一个致命 bug（r124 上线即崩）

**症状**：进设置页拖动任意一个调参滑块 → **整个界面定死**，什么都点不动，`boot_err` 里刷屏：

```
Uncaught TypeError: Cannot read properties of undefined (reading '0')
  at LiquidGlassRenderer.rasterizeText (liquidui.js:5322)
  at LiquidGlassRenderer.rasterizeForeground (:5218)
```

**根因**：`makeText()` 的文字是**对象** `el.text = { content, color, fontSizePx, align, ... }`，
而 `rasterizeText` 里读的是 `t = cfg.text; t.color[0]`。r124 的 `gtApplyLive()` 把数值写成了
`el.text = "8"`（字符串）→ `cfg.text.color` undefined → `undefined[0]` 抛错 → rAF 主循环死 → 看起来就是「滑块拉不动 / 整页卡死」。

**正确写法**（引擎里改文字只有这一种）：

```js
el.text.content = "新文字";
renderer.fgDirtyIds.add(el.id);   // 标记前景重栅格
renderer.requestRender();
```

参考实现：L12197（启动进度百分比）、L16424（底部 tab 文案）。

**顺带改**：`gtApplyLive()` 不再 `markAllDirty()`，改成 `renderer.markElementDirty("set-glass-preview")`
——只让预览玻璃那块重绘，拖滑块时不会每帧全屏重排玻璃。

## C1. 加了什么（设置页 · Liquid Glass 分区左栏）

四个**引擎原生滑块**（`window.__addSlider`，不是 HTML `input[type=range]`），英文主标签 + 中文说明 + 右侧数值：

| 参数 | 写进哪 | 范围 / 步长 | 形状 |
|---|---|---|---|
| Blur radius 模糊半径 | `M_LIQUID.blurRadius` | 0–24 / 0.5 | 滑块 |
| Refraction height 折射高度 | `M_LIQUID.refractionHeight` | 0–48 / 0.5 | 滑块 |
| Refraction amount 折射强度 | `M_LIQUID.refractionAmount` | −48–24 / 0.5 | 滑块 |
| Chromatic aberration 色差 | `M_LIQUID.chromaticAberration` | 0/1 | **会 snap 的开关式滑块**（值显示 开/关） |

- 行距 `GT_ROW_H = 96`（滑块热区高 48，96 才不会上下误触）。
- 四个参数在 `M_LIQUID` 里 → 资源大厅 / 版本面板 / 下载面板下次 `build()` 一起变，**是真正的全局参数**。
- `chromaticAberration` 在**着色器里是 0/1**（`uChromaticAberration > 0.5` 才开），所以滑块做成 snap 到两端的开关；默认 `0`（关），别改成默认开——7-tap 色散很贵。
- 实时预览：拖滑块时 `gtApplyLive()` **直接改 `set-glass-preview` 元素的参数 + `M_LIQUID` + 数值文字**，然后 `markAllDirty()/requestRender()`。**不能 rebuild**——rebuild 会把正在拖的滑块元素拆掉（就是 B4 第 3 条那个坑的同一类）。

## C2. 代码位置（r124 行号）

| 位置 | 内容 |
|---|---|
| L17936 起 | `GT_DEF` / `gtGet` / `gtFrac` / `gtFmt` / `gtApplyLive` / `gtSetFromFrac` / `gtApplyScroll` / `gtAnimateScroll` / `gtBuildParams` |
| `buildSettings()` 里 `if (setSec === "glass")` 块 | 右栏预览 `gtPreview` + 提示文字 + 调 `gtBuildParams(...)` |
| `canvas.addEventListener("wheel")` **最开头** | 参数区内部滚动分支（`gtArea` / `gtMaxScroll`） |
| `var M_LIQUID` | 末尾多了 `chromaticAberration: 0` |

## C3. 容器内滚动说明

滚动机制已就位：`gtItems`（每行 `{baseY, els:[{el, dy, hitDy, togY}]}`）+ rAF 缓动 + `clipRect` 裁剪 + 手动同步 `hitRect.y` / `isToggleKnob.trackOriginalY`（照抄 `applyVerticalCenter` 的做法）。

**但现在只有 4 行，`gtMaxScroll` 算出来是 0，所以滚轮不会动** —— 这是正常的，不是坏了。以后往 `GT_DEF` 里加参数超过一屏高度，滚动会自动生效。

旧的 `renderGlassTune()` / `TUNE_DEF` / `_fmtTune` 是 r134 回滚后的**死代码**（没人调用），没删；`buildSettings` 末尾清 `#glassTuneLayer` 的那段也只作用于不存在的 DOM 节点，无害。

---

# 🚨 接手必读（2026-11-01 / r123）—— 历史节点

> 本章只有一件事：把 r134 里的三处**纯数值**改动单独落地到 r122 基础上，冻结为 r123。
> 除这三行外**没有任何结构/逻辑改动**。下方 r122 章节仍然完全有效，是 r123 的直接基础。

## B0. 当前运行状态（2026-11-01 18:19 自检）

| 项 | 值 |
|---|---|
| 版本号 | `index2.html` → `?v=20261101_r123` |
| liquidui.js | 856 797 bytes，SHA256 `7BBAD0635B33CD367798D9F797F8AE89EE6AC4E41E00CA10B985305422CFD30D` |
| bin == src | True（`bin\Debug\net10.0-windows10.0.19041.0\wwwroot\`） |
| 进程 | 运行中（rebuild-restart.ps1 于 18:19 启动） |
| 回滚点 | `build\liquid-ui\backups\liquidui.20261101_r122_restore.js` + `index2.20261101_r122_restore.html` |
| 语法 | `node --check` 通过 |

## B1. r123 的三处改动（唯一定位，与 r134 逐字一致）

| 行号 | 位置 | 旧 | 新 | 作用 |
|---|---|---|---|---|
| 4197 | `resize()` 里算 dpr | `this.dpr = Math.min(window.devicePixelRatio \|\| 1, 3);` | `this.dpr = Math.min(Math.max(window.devicePixelRatio \|\| 1, Number(window.__RENDER_SCALE \|\| 1.5)), 3);` | 用户显示器 100% 缩放 → `devicePixelRatio = 1` → 原来等于 1:1 渲染、零超采样。现在**强制 1.5× 超采样** |
| 9806 | 渲染器构造函数 | `this.blurTapCap = 9;` | `this.blurTapCap = 16;` | 高斯模糊每趟 1D tap 数 9→16，玻璃更绵密、脏边减少 |
| 9811 | 渲染器构造函数 | `this.blurDownsample = 4;` | `this.blurDownsample = 2;` | 模糊降采样 4×→2×，模糊缓冲分辨率翻倍 |

**不要多改的两处**（看起来像但其实是死的）：
- `CatalogState` 里（约 L10695）的 `blurTapCap: 9` / `blurDownsample: 1` **不会被应用到渲染器**，是死字段。
- `this.effectiveBlurDownsample = 4`（L9830）是初始值，`resizeFBOs()` 会覆盖它，保持 4 即可。

## B2. 运行时临时调画质（不改文件、不重启）

`dpr` 在 `resize()` 里读 `window.__RENDER_SCALE`，DevTools Console：

```js
window.__RENDER_SCALE = 1.2;                 // 想更省性能就调小（不低于 1）
window.dispatchEvent(new Event('resize'));   // 或直接拖一下窗口边框
```

掉帧时优先降这个，其次再考虑 `blurTapCap`。

## B3. 用户诉求与心态（重要）

- 用户认为原玻璃「**脏、不够绵密**」、整体「**分辨率不行**」。这三处就是该诉求的前半段答案。
- 用户**明确要求保留** 1.5× 超采样 / 16 taps / ds=2，**不要因为 FPS 掉了就自作主张降回去**。掉帧要如实报告（左下角 FPS HUD）并给选项让他决定。
- 后半段诉求（尚未做）：设置页 Liquid Glass 分区里的**全局视觉调参面板**，用**引擎原生滑块**（`__addSlider`，不要 HTML `input[type=range]`），中文标签、白色字体、参数区容器内滚动、拖动实时影响预览玻璃。

## B4. 重做调参面板前必读的 6 个坑（来自已回滚的 r134）

1. `renderGlassTune` 有缓存优化：`sig` 相同只刷数值不重建 DOM，但**清理分支没重置 `sig`** → 面板空白。清理时补 `layer.dataset.sig = ""`。
2. **真凶**：`buildSettings()` 结尾有一段 r122 遗留的**无条件清理代码**，会把刚渲染好的 `#glassTuneLayer` 立刻清空隐藏。先删它。
3. 预览玻璃的参数是**构建时从 `M_LIQUID` 拷贝**的，`markAllDirty()` 不会更新已存在元素 → 拖滑块毫无效果。正确做法：在 `_tuneApply` 里直接改 `renderer.buttonConfigs` 中 `id === "set-glass-preview"` 那个元素的参数，再 `markAllDirty()`。
4. 滚轮滚动分支要插在 `canvas.addEventListener("wheel")` **最开头**；塞进 download 下拉分支里会让设置页永远进不来。
5. **禁止用大括号计数删代码块**（`const { x, y }` 会被数进去）。只用精确字符串匹配，见铁律 13。
6. `quickToggles.chromatic` 默认 `true`，会让色差在所有玻璃上常开（7-tap 色散很贵），要改 `false` 交给滑块控制。

---

# 🚨 接手必读（2026-11-01 / r122）——r123 的基础章节

> 本章覆盖 r97 → r122 的所有改动，**优先级最高**。下方 r97 章节及更早仍然有效，有冲突以本章为准。

## A0. 部署（新）

- **桌面快捷方式 IllusionHotReload.lnk** → hot-reload.cmd → hot-reload.ps1（在 D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\）
  - 双击 = 弹 UAC 提权 → 杀进程 → dotnet build → 启动 exe
  - **不会 esbuild 重新打包 liquidui.js**（区别于旧的 build-run.ps1，那个危险已删）
  - 日志：IllusionLauncherWPF\build\hot-reload.log
- 已删除桌面旧的「幻境启动器.lnk」（指向 build-run.ps1，会 esbuild 重打包覆盖改动）

## A0-2. 🚨 最重要架构坑：OnWebMessage 有两套分支

MainWindow.xaml.cs 的 OnWebMessage：
- **JSON 分支**：if (msg.StartsWith("{")) { ... return; }（约 L1444~2216）—— 新 UI 发 post({action:...}) 走这里
- **纯字符串分支**：switch (msg) { ... }（约 L2218+）—— 老 UI 发 postStr("xxx") 走这里

**新 UI 发 JSON，如果某个 action 只在 switch(msg) 里处理，就永远收不到（假按钮）。**
本轮踩过并已修：detect_java / pick_java / pick_java_folder / pick_background / reset_background / pick_game_path —— 都在 JSON 分支补了 else if (action == "...")。
**以后任何新按钮，先确认它的 action 在 JSON 分支有处理。**（check_update 例外：在 HandleFeatureMessage 里，JSON 分支先调它，能收到。）

## A0-3. 新 UI 缺失的 C# → 前端回调（本轮已补）

后端会调这些 window.onXxx，新 UI 原来根本没定义（老 UI 有）：
- onJavaPicked({path}|{error}|null)
- onGamePathPicked({path}|null)
- onBackgroundPicked({url,path}|null)
- onBackgroundReset(...)

新增后端回调时，务必在新 UI 也定义对应 window.onXxx，否则前端无反应。

## A0-4. 设置页（r97 → r122 大改）

- 底部导航改成 buildTabCapsule 分段控件，**4 个分区**：全局 / Liquid Glass / 背景 / 日志
  - SET_NAV = [["global","全局"],["glass","Liquid Glass"],["bg","背景"],["logs","日志"]]
- **Liquid Glass 分区**：拉条（renderGlassTune）已去掉不调用（不完善），只留标题+预览玻璃
- **日志分区**（新）：玻璃面板 + 标题「游戏实时日志」+ 右侧三按钮（自动滚动/清空/复制）+ 黑色日志框
  - 后端 onGameLog({text}) 推送，前端累加到 gameLogBuffer（全局变量，上限 200KB）
  - gameLogAutoScroll 控制自动滚底；高亮：[ERR]/Exception/ERROR 红，Caused by/WARN 黄
- **内存滑块**：修了引擎 makeLiquidSlider 的 initFraction 不生效 bug（knob 初始位置永远在 0），并让 ensureToggleState 初始化；滑块宽度撑满（w: gw）
  - 这个修复动了引擎底层（L11029 附近）+ ensureToggleState，**所有 __addSlider 都受益**，别回滚
- **更换游戏目录**：玻璃胶囊，左显示 _stShortPath(gamePath)，右蓝色按钮「更换目录」→ pick_game_path
- **Java 卡片**：_stJavaRow 圆角改 24（胶囊）
- **所有按钮加 toast**：用 window.showToast(title, msg)（灵动岛，**不是** showGlobalToast，那个不存在）
- **Java 自动检测**：buildSettings 里 if (!live.javaAutoDetected) { live.javaAutoDetected = true; post({action:"detect_java"}); }
- 删除两处「内容待填入」占位文字

## A0-5. 后端 Java 检测（DetectJavaAsync，xaml.cs 约 L7794）

- 硬编码搜索列表加了 D:\illusion_Version\java
- 新增：读 JAVA_HOME 环境变量 + 遍历 PATH 找 java.exe（取其父目录，因为 ScanJavaDirAsync 拼 bin\java.exe）
- 用户实际 Java：D:\illusion_Version\java\jre-25\jdk-25.0.4.1+1\bin\java.exe（多套一层版本目录，depth 3 能扫到）

## A0-6. 资源大厅 / 下载面板

- 「获取版本」加载卡：去掉「正在获取版本…」文字，只留白色 rh-spin（.rh-spin CSS 已是白色）
- **加载器 tab**（原版/Forge/Fabric/NeoForge，版本下载面板 L15817 附近）：指示器改成液态玻璃 isBottomTabIndicator（和底部导航同套），可点可拖；文字保持白色不变色；容器加 isBottomTabContainer
  - 指示器内缩 _ldIndInset = 10（不撑满）
  - selectLoader() 里调 renderer.setTabSelected("inst-ld", idx, n) 驱动滑动
  - 拖动用 makeTabDragInteractions("inst-ld", _ldTabW, ...) 挂到 inst-ld-bar

## A0-7. 关于页

- 四个按钮（问题反馈/GitHub/帮助文档/检查更新）改成引擎 makeButton（有按压动画）
- **检查更新**：onTap 改 post({action:"check_update"})（**不跳转网站**），后端 CheckUpdateAsync 回调 onUpdateInfo({ok,current,latest,hasUpdate,htmlUrl,...})，前端 toast 提示
  - 老 UI 发现新版本还会弹确认框+跳下载，新 UI 目前只 toast，没做跳转

## A0-8. 版本列表图标（#verIconLayer）

- 图标是独立 HTML 层（position:fixed），因为 loader 图标是 PNG（引擎 icon 只支持 SVG path）
- **跟面板滑入同步**：startTween 里给 #verIconLayer 设 transform: translateX((1-k)*slideDist)，同曲线同 460ms
- 草方块（grass_block.png）放大到 38px（其他 24px），水平中心对齐（x = r.x + 9）
- **版本设置面板打开时隐藏**：build() 里 if (!versionPanelOpen || versionSettingsOpen || page !== "home") 清空+隐藏 verIconLayer
- 图标层用 clip-path: inset(0 right 0 left) 横向裁到面板宽度（_vpx = W - PANEL_W - 20）

## A0-9. 引擎通用坑（本轮踩过）

- build(animate) 的 animate 参数**根本没被用到**，build(true) 不等于有动画
- 版本列表打开时的列表项淡入是 runListEnterAnimation()（ease-out cubic，260ms，stagger 14ms），但**打开面板**（versionPanelOpen = !versionPanelOpen; build(true)）**不触发它**（listEnterPending 只在切分类时设 true）
- 面板整体滑入是 startTween（build(true) 时 prev 非空触发，460ms，k=1-(1-p)^5，SLIDE_DIST = PANEL_W + 90）；只作用于 canvas elements + pendingIcons（#iconLayer img），独立 HTML 层（如 verIconLayer）需手动加 transform 才同步

# 🚨 最新接手必读（2026-10-31 / r97）

> 本章覆盖 r77 → r97 的所有改动。下方「第 3 轮接手必读」及更早章节仍然有效（部署流程、窗口圆角、orb、波线等），
> 如有冲突，以本章为准。

## A. 60 秒上手

| 项 | 值 |
|---|---|
| 当时版本（历史，现为 r123） | `index2.html` → `?v=20261031_r97` |
| 主文件 | `wwwroot/liquidui/liquidui.js`（≈850 KB / 18 700 行，单文件 bundle，**禁止重新打包**） |
| 入口 | `wwwroot/index2.html`（HTML 叠层都在这里） |
| 回滚点 | `build/liquid-ui/backups/liquidui.20261030_r77_pre-install.js`（= r77 可用版） |
| 部署脚本 | `D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\rebuild-restart.ps1` |
| 构建日志 | `IllusionLauncherWPF\build\rebuild.log` |
| 后端 | `MainWindow.xaml.cs`（主窗/下载/Java/背景/圆角）、`MainWindow.Features.cs`（功能 action 分发） |

标准改动流程：

```powershell
# 1) 改完先自查语法（bundle 是普通脚本，node --check 可用）
node --check wwwroot\liquidui\liquidui.js
# 2) 必须改 index2.html 里的 ?v=xxxxxxxx_rNN，否则吃缓存
# 3) 部署：脚本会提权杀进程 + dotnet build + 启动
powershell -NoProfile -ExecutionPolicy Bypass -File D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\rebuild-restart.ps1
# 4) 必须校验 bin 与 src 一致，False 等于没改
(Get-FileHash wwwroot\liquidui\liquidui.js).Hash -eq (Get-FileHash bin\Debug\net10.0-windows10.0.19041.0\wwwroot\liquidui\liquidui.js).Hash
```

启动器**自提权**，普通 `Stop-Process` 杀不掉：

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','Stop-Process -Name IllusionLauncherWPF -Force' -WindowStyle Hidden
```

## B. 十条铁律（违反任一条都会白干）

1. **绝不重新打包** `liquidui.js`。`build/liquid-ui/src/entry.ts` 是 10-29 的旧快照，打包会覆盖掉几十轮本地改动。只能做「唯一定位 + 单点字符串替换」。
2. **一次改一处、改前先 grep 定位**（`Select-String` 找函数名/锚点），改完 `node --check`。
3. **改完必须改 `?v=`**（当前 `20261031_r97`，递增 NN）。
4. **改完 wwwroot 必须 rebuild**：exe 读的是 `bin\Debug\...\wwwroot` 的副本。
5. **引擎按钮绝不能放进 HTML 滚动容器**——HTML 滚动时 canvas 元素不跟随，会错位。规则：引擎画固定区（标题/滑块/按钮），HTML 只放滚动内容（输入框/列表行）。
6. **引擎 `onTap` 按元素 id 查** `interactions[el.id]`。`inter["rh-get-"+i]` 配元素 id `rh-get-bg-{i}` = 死按钮（踩过）。**交互 key 必须等于元素 id**。
7. **C# → 前端 的 JSON 是 PascalCase**（启动器没有配 camelCase policy）。读 C# 对象要用 `d.Path` / `d.Version`（建议两个都兼容）。前端发给 C# 的 payload 用 camelCase 没问题（后端按字段名读）。
8. **不要玻璃叠玻璃做模糊**：父面板已是玻璃时，子卡片用 `makePlainRect`，或把 `blurRadius / refractionHeight / refractionAmount` 置 0、`saturation:1`，否则二次模糊非常脏（用户明确反感）。
9. **系统对话框必须回 UI 线程**：`OpenFileDialog` / `FolderBrowserDialog` 在 `Task.Run`（MTA）里会静默失败。用 `Dispatcher.InvokeAsync(...)`（`pick_java` 是正确范例）。
10. **弹层/列表的进入动画只能播一次**：`render()` 里对 dd / list 的 `animateEnter` 要有「刚打开」标志（`window.__ddJustOpened` / `window.__suppressEnter`），否则每次滚动重建都会重播，用户会觉得恶心。

## C. 代码地图（liquidui.js，r97 行号，会漂移，优先按函数名搜）

| 行 | 函数 | 说明 |
|---|---|---|
| 11060 | `makeLiquidSlider` | 引擎滑块，暴露为 `window.__addSlider`（`{id,x,y,w,value,onChange,onLive}` → `{elements, interactions}`） |
| 11480 | `post` | 发消息给 C# |
| 11590 | `window.onGlobalConfigLoaded` | 全局配置回填 → `live.cfg`（**会立刻清掉 curseForgeApiKey**） |
| 11743 | `var page` / `onTabSelect` | 页面状态与底部 tab 路由（`i===3 skin / 4 settings / 5 about`） |
| 11945 | `buildHome` | 主页 |
| 12684 | `buildVersionPanel` | 「选择版本」面板（图标在 `#verIconLayer`） |
| 13939 | `window.onDownloadProgress` | 下载进度；开头按 `dl.rhInst.busy` 分流进资源大厅抽屉 |
| 14460 | `buildResourceHall` | 资源大厅（列表 + 安装抽屉） |
| 14570 | `openRhInstall` / `rhInstDownload` | 打开抽屉 / 开始下载 |
| 15290 | `renderRhInstDom` | 抽屉内部的 HTML（加载器三格、实例下拉、文件卡、进度卡） |
| 17320 | `renderVerIcons` / `verUpdateIcons` | 版本列表 loader 图标层（跟随滚动） |
| 17660 | `buildSettings` | 设置页骨架（外卡 + 左右面板 + 底部导航胶囊） |
| 17700 | `renderSetInputs` | 设置页 HTML 内容（滚动区、输入框、Java 列表、背景预览） |
| 17790 | `wireSetLayer` | 设置页事件（**document 级委托**） |
| 18340 | `window.__addSlider` / `makeButton` / `makeGlassShape` | 引擎基础件 |

后端（`MainWindow.xaml.cs` / `MainWindow.Features.cs`）：

| 位置 | 内容 |
|---|---|
| xaml.cs `OnWebMessage` 约 1800-2300 | 所有 `case/if (action == "...")` 的总入口 |
| xaml.cs 约 1100 / 2630 | `DownloadParallelAsync(url, savePath, progress, sha1, multiMirror, segCount, minParallelSize)`，默认 16 段 / ≥5MB |
| xaml.cs 约 7660 | `DetectLoaderKind()` / `DetectMcVersion()`（读版本 json 的 `inheritsFrom` 继承链） |
| xaml.cs 约 7770 | `DetectJavaAsync()`（已逐目录 + 逐项 try/catch，异常也会推送已有结果） |
| xaml.cs 约 7317 | `PickBackgroundAsync()`（必须 `Dispatcher.InvokeAsync` 调用） |
| xaml.cs 约 1887 | `save_global_config`（JavaPath/GamePath/BackgroundPath 从 `_global` 继承；CF Key 留空即保留旧值） |
| Features.cs 约 1110 | 资源大厅 `download_modrinth_file`（唯一传 `16 段 / ≥1MB` 的调用点） |
| Features.cs 约 350-1200 | `HandleFeatureMessage(action, root, sender)`：整合包、皮肤、`pick_folder`、`download_to_folder`、CF 安装 |

全局配置字段（camelCase 发送 / PascalCase 返回）：`maxMemoryMB`、`minMemoryMB`、`autoMemory`、`memoryPreset`（**合法值只有 `g1gc` / `zgc` / 空**）、`gameArgs`、`jvmArgs`、`disableVulkan`、`useHighPerformanceGpu`、`javaPath`、`gamePath`、`backgroundPath`、`curseForgeApiKey`。

## D. 渲染分层（谁在上面）

| 层 | 来源 | z-index / 说明 |
|---|---|---|
| canvas（引擎） | index2.html | 最底，所有玻璃/文字/引擎按钮都画在这里 |
| `#iconLayer` / `#svgLayer` | index2.html | 引擎图片/SVG 图标层 |
| `#setInputLayer` | JS 创建 | 17，设置页 HTML |
| `#rhIconLayer` | index2.html | 18，资源大厅图标（clip-path 裁剪） |
| `#verIconLayer` / `#glassTuneLayer` | JS 创建 | 18，版本列表图标 / Liquid Glass 调试 |
| `#rhInstallLayer` | index2.html | 19，资源大厅抽屉（版本行/下拉/进度） |
| `#skinLayer` / `#aboutLayer` | index2.html | 皮肤 3D 画布 / 关于页叠层 |

**记住**：HTML 层永远在 canvas 之上，所以引擎画的按钮要么放在 HTML 不覆盖的区域，要么 HTML 主动让位（资源大厅下载按钮就靠 HTML 文件卡宽度 `pw-106` 让位）。

## E. 模块完成度（r97）

| 模块 | 状态 | 备注 |
|---|---|---|
| 主页 | ✅ | 版本列表带 loader 图标（引擎层 `#verIconLayer`） |
| 联机 | ✅ | `buildOnline()`，未重点验证 |
| 下载 → 游戏下载 | ✅ | 版本面板去二次模糊、图标跟随滚动、动画不重播 |
| 下载 → 资源大厅 | ✅ | Modrinth/CurseForge 搜索、分类、安装抽屉、16 段并发下载、丝滑进度 |
| 下载 → 线程下载 | ✅ | `ThreadDownloader` |
| 皮肤 | ✅ | skinview3d + 本地皮肤导入/删除/应用；披风 tab 只有占位 |
| 设置 | 🟡 新做 | 全局（内存/参数/勾选/保存/诊断包）+ 右栏 Java 环境 + 背景分区；Java tab 已按用户要求隐藏 |
| 关于 | ✅ | HTML 叠层 + `about-wave.css` |

## F. 已知坑与症状（省时间的清单）

| 症状 | 原因 | 处理 |
|---|---|---|
| 整页卡死、拖动指示器就定住 | `rasterizeForeground` 里 button 无 label 无 icon 时读 `labelColor[0]` 崩 | 已有三处补丁；新建 button 必须给 `label` 或 `icon` 或 `labelColor` |
| 改了代码但界面没变 | 忘了 `?v=` / 忘了 rebuild | 见 A 节流程 |
| 按钮点了没反应 | ①`inter` key ≠ 元素 id ②HTML 按钮事件绑在会被重建的层上 | ①key 用元素 id ②改 document 级委托（`#setInputLayer` 就是这样修的） |
| 点了没反应（弹对话框类） | `Task.Run` 里弹 `OpenFileDialog`（MTA） | 改 `Dispatcher.InvokeAsync` |
| 卡片糊成一团 | 玻璃叠玻璃 | 子卡片去模糊（铁律 8） |
| 列表滚动时图标不动 | 图标是 build 时按绝对坐标画的 | 建独立层 + 在 `applyScroll()` 里更新 `top` |
| 滚动时反复播进入动画 | `render()` 无条件 `animateEnter` | 加"刚打开"标志 |
| Java 检测没结果 | `DetectJavaAsync` 中任一目录抛异常导致永不回调 | 已加逐目录 try/catch（若再出问题，看 `_detectedJava` 是否被清空后抛异常） |
| 恢复默认背景无效 | `onBg("")` 旧实现直接 return | 现在空值回落 `bg.jpg` |
| C# 回调里字段全是 undefined | PascalCase | 兼容 `d.Path \|\| d.path` |

## G. 待办（按优先级）

1. **设置页「背景」分区**：目前只有「选择图片 / 恢复默认」，没有历史壁纸列表；`#setInputLayer` 里已预留右栏预览位。
2. **Java 列表行引擎化**：现在 Java 行是 HTML（因为它在一个滚动容器里）。若要统一成引擎绘制，必须连"滚动同步"一起做（参考 `verUpdateIcons` 的做法）。
3. **皮肤页披风 tab**：仍是占位（`#skinLayer` 与引擎互斥的坑见第 4 轮章节）。
4. **资源大厅「已装」检测**：`item.installed` 只是会话内标记，没有扫 `mods/` 目录。
5. **资源大厅实例下拉点外部不收起**（小体验项）。
6. 设置页「导出诊断包」只发 `export_diag`，没有回执 toast 细节。

## H. 调试手段

- **FPS HUD**：左下角（含 draw 平均/最大），`index2.html` 里内置
- **前端报错**：`window.onerror` → `localStorage.boot_err`；读法是扫 `bin\Debug\...\IllusionLauncherWPF.exe.WebView2\EBWebView\Default\Local Storage\leveldb\*.log`（用 `FileStream` 共享读，别用 Get-Content）
- **截图**：`CopyFromScreen` 可用，`PrintWindow` 抓不到 WebView2；Chatbox 会盖住启动器，先置前后再截
- **进程置前**：`SetForegroundWindow`（提权与非提权同级才有效）
- **C# 快速验证**：`dotnet build IllusionLauncherWPF.csproj -v q`，若报"文件被占用"说明进程没杀掉

---

# 🚨 第 3 轮（2026-10-30）接手必读

## 3.0 三条硬规矩

1. **绝对不要重新打包 `liquidui.js`。** `build/liquid-ui/src/entry.ts` 是 10-29 21:01 的**旧快照**，不含 10/29 晚间与 10/30 的全部改动。一旦 esbuild 重打，今天所有成果全部丢失（历史上已发生过）。
2. **只做定点 patch**：改 bundle 时用「唯一字符串替换」，先按 3.3 的定位表找到对应函数再改，**不要整段重写、不要凭记忆重建**。
3. 改完 `liquidui.js` 或 `index2.html` 后，**必须改 `index2.html` 里 `liquidui/liquidui.js?v=...` 的版本号**，否则 WebView2 吃缓存看不到改动。当前是 `?v=20261030_r77`。
4. **改了 `wwwroot` 必须 `dotnet build`**（或跑 `rebuild-restart.ps1`）。exe 读的是
   `bin\Debug\net10.0-windows10.0.19041.0\wwwroot` 的**副本**，只改源码不 rebuild = 没改。
   这个坑 2026-10-30 踩过一次，导致误判“补丁无效”。验证：DevTools 里看 `?v=` 是否变成新号。

## 3.1 部署流程

```
D:\illusion-C#\illusionLauncher\IllusionLauncherWPF\rebuild-restart.ps1
```
杀进程 → `dotnet build` → 启动，日志写 `IllusionLauncherWPF\build\rebuild.log`。

- 启动器是**自提权**进程（`App.xaml.cs` 用 `--elevated` 重新拉起），普通权限杀不掉：
  `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','Stop-Process -Name IllusionLauncherWPF -Force'`
  注意 `Start-Process -Wait` **对提权子进程不生效**，要轮询进程列表确认结束。
- 备份目录：`IllusionLauncherWPF\build\liquid-ui\backups\`
  - `liquidui.20261030_0940_prework.js`（10-30 开工前）
  - `liquidui.20261030_1403_after-orb.js` + `index2.20261030_1403.html`（玻璃球/涟漪/回弹全部完成后）
  - 桌面另有一份完整快照：`C:\Users\MCill\Desktop\illusionLauncher-backup-20261030\`（335 文件 / 6.8MB，含 MANIFEST-SHA256）
- ⚠️ `wwwroot\liquidui\liquidui.backup.js` 与正式文件 **SHA256 完全相同**，是重复文件、**不是**可回滚的旧版。

## 3.2 本轮改了什么（功能层）

1. 火箭「清理内存」终于有反馈（之前 C# 回调用了一个前端不存在的函数）→ 3.4
2. 折射涟漪：临时 glass-shape 元素，**真实折射引擎画面**（含 UI）→ 3.5
3. Siri 玻璃球 ⇄ 胶囊，承载文字（移植 zq52xy/glass-voice-orb-study）→ 3.6
4. 全局下沉回弹（5px，弹簧回位）→ 3.7
5. 「开始游戏」复用同一套特效 → 3.8
6. 版本下拉箭头换成白色 80° V（3px 描边）→ 3.9
7. 窗口 squircle 圆角试验 → **已按用户要求回滚**（3.10）
8. 边缘光 `siriAura`（Siri 一圈彩光）→ **已废弃但代码保留不删**（3.11）

## 3.3 改动定位表（grep 这些字符串）

| 功能 | 文件 | 定位字符串 |
|---|---|---|
| 火箭交互 | liquidui.js | `"tb-btn-optimize_memory"` |
| 开始游戏交互 | liquidui.js | `"btn-start": { onTap` |
| 清理动画 | liquidui.js | `function startMemSpinner` / `function stopMemSpinner` |
| 特效总入口 | liquidui.js | `function playOrbFx` / `function endOrbFx` / `function _elCenter` |
| 折射涟漪 | liquidui.js | `function startRefractionRipple` |
| 下沉回弹 | liquidui.js | `function playUiLift` / `function _applyUiLift` |
| 元素推送钩子 | liquidui.js | `function pushElements`（开头调 `_applyUiLift()`） |
| 内存回调 | liquidui.js | `window.onMemoryOptimized` |
| 壁纸转发 | liquidui.js | `function onBg(url)` 末尾 `window.__orb.setBg` |
| 下拉箭头 SVG | liquidui.js | `function placeExpandSvg` 里的 `layer.innerHTML` |
| 球参数 | index2.html | `<script>window.SIRI_PARAMS` |
| 球 DOM/CSS | index2.html | `#siriOrb` / `#orbLabel` |
| 球封装 | wwwroot/orb/orb-host.js | 全文（我写的，可自由改） |
| 球引擎 | wwwroot/orb/src/*.js | 原样 vendored（MIT），**尽量只改常量** |
| 球的 GLSL | wwwroot/orb/siri-shaders.js | 生成文件，改它没用，见 3.6 说明 |

## 3.4 火箭清理内存（原来为什么“没功能”）

链路：`onTap → postStr("optimize_memory")` → C# `case "optimize_memory"` → `RequestAdminOptimizeAsync()` → 回调 `window.onMemoryOptimized({ok, freedMB, nowMB})`。
**但 `liquidui.js` 里根本没有 `onMemoryOptimized`** → 内存确实清了，界面零反馈。已补齐，且**不再弹 toast**，结果写进胶囊文字。

## 3.5 折射涟漪（`startRefractionRipple`）

用引擎自己的 `glass-shape` 造临时元素：
- `surfaceColor`/`tintColor` = `[0,0,0,0]`（完全透明，只是个“透镜环”）
- `refractionHeight = 30 + 0.055*r`、`refractionAmount = -95*decay`、`chromaticAberration: true`
- **`independentBackdrop: false`** —— 关键：采样整个场景 FBO，所以能折射 UI（按钮/文字/头像底板）；代价是每帧要重绘整屏，是引擎里最重的路径
- 半径 22 → 900（盖住整窗，从火箭位到最远角约 863）、`DUR = 1500ms`
- 每帧改 `rect` 后 `pushElements()`，结束时从 `elements` 摘掉

## 3.6 Siri 玻璃球 / 胶囊（wwwroot/orb/）

**素材来源**：`github.com/zq52xy/glass-voice-orb-study`（MIT）。移植方式：
- `wwwroot/orb/src/{pipeline,renderer,uniforms,state}.js` —— 原样 vendored，只改了 `renderer.js` 的 `CORNER_MAX 44 → 52`
- `wwwroot/orb/siri-shaders.js` —— **生成文件**。源 GLSL 在 `build/liquid-ui/orb-glsl/*.glsl`（原文一并留存，附 `ATTRIBUTION.md` 写明来源/许可/调参公式），生成器是 `build/liquid-ui/build-orb.mjs`：
  `node build/liquid-ui\build-orb.mjs` → 重写 `wwwroot/orb/siri-shaders.js`（当前 22296 字节）。
  **不要手改产物**，改 GLSL 就改源文件再重生。
- `wwwroot/orb/orb-host.js` —— 我写的封装，对外暴露：`window.__orb.{setBg, setText, setLevel, expand, place, show, hide}`

**几何常量（三处必须同步，改一处就要改三处）**
| 名字 | 值 | 位置 |
|---|---|---|
| `ballWidth` (BALL) | 104 | SIRI_PARAMS / orb-host `var BALL` |
| `dialogWidth` (DIALOG_W) | 264 | SIRI_PARAMS / orb-host |
| `dialogHeight` | 104 | SIRI_PARAMS |
| `CORNER_MAX` | 52 | renderer.js + orb-host（= 半高，真正胶囊） |
| canvas 宽 | 312 | index2.html `#siriOrb` + orb-host `CANVAS_W` |

**必须知道的两件事**
1. `window.SIRI_PARAMS` **必须在 `renderer.js` 之前定义**（renderer 顶层就有 `const p = window.SIRI_PARAMS`）。当前写在 index2.html 的一个内联 `<script>` 里。
2. 引擎胶囊宽度被 `maxDialogW = viewportW - 48` 卡死 → **canvas 宽必须是 DIALOG_W + 48**，否则胶囊会被 clamp 变小。

**画面处理**
- canvas 上下文是 `alpha: false`，球外是黑色 → 每帧用 `clip-path: inset(T R B L round corner)` 跟着当前形变裁（公式抄 `renderer._layout()`，含 breathe/press，见 `syncClip`）
- 壁纸折射：`cropForOrb()` 按 CSS `cover` 反算源矩形，裁一块 312×120 喂给 `setBackground`，所以球里是“正下方那块壁纸”而不是整张图缩略。每次 show 重裁。
- 只能折射壁纸，折不到 canvas 上的 UI（球是独立 WebGL 上下文，拿不到引擎画面）

**手感参数（都在 SIRI_PARAMS）**
| 参数 | 当前值 | 含义 |
|---|---|---|
| `glassHeight` | 9 | 折射带宽度（越小越只在外圈弯） |
| `refractAmount` | -38 | 折射强度 |
| `curvature` | 0.9 | 1=圆形斜边最鼓，0=平斜切 |
| `containerBlack` | 0.37 | 深色容器起点（拉长深色渐变就加它） |

展开獥弹在 `orb-host.js`：`SPRING_K = 200, SPRING_C = 14`（ζ≈0.5，有过冲）。振幅：`setLevel(0.95)` 工作态 / `0.32` 平静态，`fakeAudio()` 用双层包络。

## 3.7 全局下沉回弹（`playUiLift`）

引擎元素没有位移通道（`graphicsLayer` 只有 scale/rotation），所以用**增量改 `rect.y`**：

```js
function _applyUiLift() {
  const d = _uiLift - _uiLiftApplied;   // 只写差值
  if (!d) return;
  for (…) if (e.rect && e.id !== "__ripple") e.rect.y += d;
  _uiLiftApplied = _uiLift;             // 不会累积漂移
}
```

`pushElements()` 开头调它。曲线：前 22% ease-out 下沉，后 78% `amp * e^(-4.6u) * cos(7.4u)`（会过冲 → 回弹）。当前幅度 **5px**。

⚠️ **踩过的坑**：不要把 DOM 叠层（`#iconLayer` / `#svgLayer` / `#avatarWrap`）加 `translate`/`transform` 去“跟着动”—— 这些层的子元素是 `position: fixed`，父级一旦有 transform 就成了它们的包含块，**tab 图标和下拉箭头会全部消失**。已在 index2.html 留注释。

## 3.8 「开始游戏」复用特效

```js
"btn-start": { onTap: () => { playOrbFx("正在启动游戏"); endOrbFx(); launchGame(); } },
```
⚠️ `playOrbFx(text, anchorId)` 的第二个参数**不传**就用火箭锚点；传 `"btn-start"` 会让球跑到窗口下面（开始按钮在窗口中部偏下）。

## 3.9 下拉箭头

`placeExpandSvg()` 里的内联 SVG 已从 Material 实心箭头改成：
```html
<path d="M7.2 9.3 L12 15 L16.8 9.3" fill="none" stroke="#ffffff"
      stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
```
顶点 (12,15)，两臂各偏竖直 40°（合计 80°）。`viewBox 24 / 显示 18`，所以 `stroke-width = 3px × 24/18 = 4`。

## 3.10 窗口圆角（已回滚，别重做）

本轮试过用 `SetWindowRgn` + 超椭圆把窗口切成 squircle（代码在 `MainWindow.xaml.cs` 的 `ApplySquircleRegion()`），用户最终要求**回归原样 8px 圆角**，所以：
- `ApplySquircleRegion()` 调用**已注释**（方法体保留，想再开就取消两行注释）
- `index2.html` 的 `--win-r` 回到 `8px`，`corner-shape` 全部删除，`#winEdge` 已删
- **保留生效**：`DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE`（去掉 Win11 那圈 1px 系统边框）
- 结论（供参考）：DWM 圆角上限 8px；窗口区域无抗锯齿；超椭圆指数 4 会在角尖产生 38px 横向跳变、锯齿明显

## 3.11 边缘光 siriAura（已废弃、不要删）

`index2.html` 的 `#siriAura` / `#siriBurst` 与 bundle 里的 `siriStart/siriStop/_siriShuffle` 仍在，但 **`siriStart` 已经没人调用**（用户评价“透明的鼓起来的，还不如不要”）。保留代码，不要再触发它。

## 3.12 诊断手段

WebView2 的 localStorage 有两个诊断键，页面 `window.onerror` 会写 `boot_err`，球封装会写 `orb_err`：
```
bin\Debug\…\IllusionLauncherWPF.exe.WebView2\EBWebView\Default\Local Storage\leveldb\*.log
```
文件被进程占用，**必须以 `FileShare.ReadWrite` 打开**才能读，不能直接 Get-Content。

## 3.13 接手自检清单（花 1 分钟跑一遍，确认没被人改坏）

```powershell
$w='D:\illusion-C#\illusionLauncher\IllusionLauncherWPF'
Select-String -Path "$w\IllusionLauncherWPF\wwwroot\index2.html" -Pattern 'liquidui.js\?v='
```

| 检查项 | 期望值 |
|---|---|
| `?v=` 版本号 | 与本节 3.0 一致（当前 `20261030_r77`） |
| `index2.html` 的 `SIRI_PARAMS` | `ballWidth 104 / dialogWidth 264 / dialogHeight 104 / margin 0 / glassHeight 9 / refractAmount -38 / curvature 0.9 / containerBlack 0.37` |
| `orb-host.js` | `BALL 104 / DIALOG_W 264 / CANVAS_W 312 / CORNER_MAX 52` |
| `renderer.js` | `const CORNER_MAX = 52`（原版是 44） |
| `build-orb.mjs` | 能跑，输出 22296 字节左右的 `siri-shaders.js` |
| `wwwroot/orb/` | 存在 `siri-shaders.js` / `orb-host.js` / `src/{pipeline,renderer,uniforms,state}.js` |

数字对不上 = 有人重新打包或覆盖了，先去 `build/liquid-ui/backups/` 找回。

---

## 0. 一句话背景

新 UI = `index2.html` + `liquidui/liquidui.js`（WebGL 液态玻璃渲染引擎，外部工程 `liquid-glass-webgl` 打包生成）。
旧 UI = `index.html` + `style.css`（DOM 版，见 `FRONTEND_HANDOVER.md`）。

**当前 `liquidui.js`（约 742KB）= 外部打包版本 + 本轮所有本地改动叠加。**
本地改动全部直接写在 `liquidui.js` 里，**没有同步回 `entry.ts` 源码**。

> ✅ **2026-10-30 校正**：`entry.ts` **在本仓库**（`build/liquid-ui/src/entry.ts`，4391 行），但它是**10-29 21:01 的旧快照**，10/29 晚间和 10/30 的改动都不在里面。所以“重新打包会丢改动”的结论不变，原因不是“没源码”，而是“源码是旧的”。

---

## 1. ⚠️ 最重要的规则：不要直接重新打包覆盖 liquidui.js

- `liquidui.js` 由外部工程（`liquid-glass-webgl`，含 `entry.ts`）用打包工具生成，然后复制到 `wwwroot/liquidui/liquidui.js`。
- 本仓库 `.csproj` **没有**任何打包脚本，`dotnet build` 不会重新生成 `liquidui.js`，只复制 `wwwroot` 到 `bin`。
- **危险操作**：从外部工程重新打包 `liquidui.js` 并覆盖过来 → 本轮所有本地改动全部丢失（历史上已发生过一次）。
- **如果要重新打包**（比如改引擎 shader/滑块）：
  1. 先告诉 AI / 备份当前 `wwwroot/liquidui/liquidui.js`
  2. 打包后，把旧文件和新文件对比，重新合并本文档第 3 节列出的所有改动
  3. 或者：本轮改动逐步迁移到 `entry.ts` 源码里（一劳永逸，但工作量大）

**备份**：⚠️ `wwwroot/liquidui/liquidui.backup.js` 与正式文件 **SHA256 完全相同**，是重复文件，**不能当回滚点**。真正的可用备份在 `build/liquid-ui/backups/`。

---

## 2. 技术要点（新 UI）

- 渲染：WebGL canvas，所有 UI 元素是 JS 对象（`makeButton` / `makeText` / `makeGlassShape` / `makePlainRect`），由 `renderer.setElements(elements)` 绘制
- 交互：`interactions[id] = { onTap, onDrag, onDragStart, onDragEnd, tip }`，canvas 的 `pointerdown/move/up` 里 `hitTest` 命中后派发
- 按钮按压动画：`makeButton` 默认 `isInteractive: true`，引擎自动处理（`renderer.setPressed`），**不用额外写**
- 滚动：`listItems`（版本列表）/ `dlItems`（下载页）/ `vsetItems`（设置面板文件列表），每项 `{ baseY, els: [{el, dy}] }`，`applyScroll` 里 `el.rect.y = baseY - scrollY + dy`
- DOM 覆盖层（canvas 画不了的）：`#iconLayer`（分类图标）、`#vsetIconLayer`（文件图标）、`#vsetSpin`（转圈）、`#vsetDropGlow`（拖入白光）、`#aboutTip`（灵动岛 tooltip）、`#vsetNameInput`（名称输入框）
- 面板宽度：`PANEL_W`（全局 460）；版本设置面板 `pw = PANEL_W + 60`，`px = W - pw - 20`（右贴边、左扩 60），`ph + 30`（比版本列表高 30）

---

## 3. 本轮全部本地改动清单（liquidui.js）

### 3.1 版本选择面板（buildVersionPanel）
- `CATS`：`all`→`gzt.png`、`modpack`→`zhb.png`，每项加 `tip`（全部/原版/Forge/Fabric/NeoForge/整合包）
- 胶囊高度 `catH = 40`，左右缩进 `px + 16`，宽 `PANEL_W - 32`
- `indicatorInset: 8`（指示器小 8px），`onSelect(k,i)` 里调 `renderer.setTabSelected("ver-cats", i, 6)`
- 草方块图标 36×34，其他 22×20
- 卡片名称：`nm = customVersionNames[vid] || v.name || vid`（自定义名优先）
- 卡片右侧齿轮 `ver-gear-i`（ICON_GEAR，34×34），点击 → `versionSettingsOpen = true` 进设置面板
- `listItems` 用 `{el, dy}` 结构（齿轮垂直居中不错位）

### 3.2 buildTabCapsule（通用 tab 胶囊）
- 支持 `cfg.indicatorInset`（指示器内缩）
- 无 label 的 tab 生成透明 `makePlainRect` 热区（可点击 + 拖动）
- interaction 挂 `tip`

### 3.3 版本设置面板（buildVersionSettings）
- 入口：`buildVersionPanel` 开头 `if (versionSettingsOpen) return buildVersionSettings(px, py, ph)`
- 返回箭头 / 标题「版本设置 · 版本名」/ 关闭 X
- 5 个 SVG tab（`VSET_TABS`：mods/resourcepacks/shaderpacks/setting/delete），选中蓝/未选白（`VSVG_URL_BLUE`/`VSVG_URL`），带 tip
- 内容区分支：`delete`（版本删除）/ `setting`（版本设置）/ 文件类（mods/resourcepacks/shaderpacks）

### 3.4 文件列表（mods/resourcepacks/shaderpacks）
- 状态：`vsetFiles` / `vsetLoading` / `vsetScrollY` / `vsetTargetScroll` / `vsetMaxScroll` / `vsetListTop` / `vsetListH` / `vsetAnim` / `vsetItems` / `vsetIconData` / `vsetPendingDeleteFile`
- 渲染：玻璃行 + 图标（`f.icon`，无则问号 `VSVG_URL.question`）+ 名称 + 已启用/已禁用 + 禁用/启用按钮 + ✕ 删除
- 删除：点 ✕ → 行变「取消 / 确认删除」→ 确认发 `delete_file`
- 滚动：`vsetApplyScroll` / `vsetAnimateScroll`（rAF 缓动，系数 0.18），`vsetUpdateIcons` 逐帧更新 `#vsetIconLayer` 图标位置
- 图标：`renderVsetIcons`（全量重建，`build()` 后调）/ `vsetUpdateIcons`（滚动帧）
- 加载态：spinner `#vsetSpin` + 「正在扫描资源…」
- 空态：「还没有文件」
- 首次进入文件 tab 自动发 `list_files`

### 3.5 版本删除（delete tab）
- 提示 + 「删除此版本」按钮 → 确认/取消 → `delete_version`
- `onVersionDeleted`：`versionSettingsOpen = false`（回列表）+ `postStr("scan_versions")` 刷新

### 3.6 回调（window.onXxx）
- `onFileList` / `onFileChanged` / `onFileToast`（tooltip 2 秒自动隐藏）
- `onVersionDeleted` / `onDeleteFailed`
- `onVersionConfigLoaded`（Java 路径）/ `onVersionJavaUpdated` / `onVersionIconPicked`
- `onHostDrop`（拖入导入 → `import_files`）

### 3.7 拖入导入
- `document` 监听 `dragover` / `dragleave` / `drop`（WebView2 `AllowExternalDrop=true` 走 HTML5）
- 拖入时显示 `#vsetDropGlow` 白色发光边框
- `postMessageWithAdditionalObjects("file_drop_mods", files)` → C# → `onHostDrop({paths})`

### 3.8 tooltip 灵动岛
- `showGlobalTip(text, cx, cy)`：鼠标上方居中，越界翻转/贴边，空文本隐藏
- `canvas mousemove` 里 `showGlobalTip(hit ? interactions[hit.id]?.tip : "", ...)`
- `#aboutTip` 样式：半透明黑 + 白字 + 胶囊圆角 + 毛玻璃（在 index2.html）
- 以后任何 interaction 挂 `tip: "文字"` 即可显示

### 3.9 版本设置 tab（setting）
- Row1：名称输入（DOM `#vsetNameInput`）+ 保存 → `customVersionNames[id]` + localStorage
- Row2：图标方块（`icon_`）+ 保存图片（`pick_version_icon` → `onVersionIconPicked`）+ 恢复（删 `icon_`）
- Row3：iOS 滑块（`window.__addSlider`）→ `scale_`（0.5~2.0）
- Row4：Java 路径条（`load_version_config` → `onVersionConfigLoaded`）
- Row5：恢复全局（`clear_version_java`）/ 选择EXE（`pick_java_for_version`）/ 选择目录（`pick_java_folder_for_version`）
- Row6：导出整合包 mrpack（`export_mrpack`）
- 布局宽度 `sx = px + 30`、`sw = pw - 60`；内容垂直居中

### 3.10 启动进度条（重点）
- 位置：主页开始游戏按钮下方
- 视觉：9px 粗白色圆角直线，从左到右生长（`#launchRingSvg` 改为直线，`transform: scaleX`）
- 0% 空圆环、>0% 平滑淡入（opacity 过渡）
- 98% 后模拟爬行到 99.9%（`_launchFakeInterval`，100ms 涨 0.05）
- 取消/失败/完成时重置，回正常状态
- 取消按钮：红色、宽度对齐按钮、首次出现 `enterProgress` 渐显 350ms
- **进度文字必须用 HTML DOM 覆盖**（`#launchPctDom` / `#launchMsgDom`），不用 canvas `makeText`
- 状态用 `window.launching`（不是 IIFE 局部变量），否则 C# 回调和前端不通
- 切页/非主页时 `build()` 隐藏进度条和文字
- 修复了启动游戏导致 `dl.phase === "installing"` 卡死下载界面的问题（`onLaunchProgress` 开头强制重置）

### 3.11 下载进度条
- 白色 7px 进度条（`inst-bar-bg` / `inst-fg`）
- 百分比（20px 白字，完成变绿）：进度条左上方
- 网速（14px）：进度条右上方
- 阶段文字（13px）：进度条下方居中
- 全部用 HTML DOM 覆盖（`#dlPctDom` / `#dlSpeedDom` / `#dlMsgDom`），不用 canvas
- 版本号标题改白字 + halo
- 加载器 tab 文字全白、下拉列表文字全白、展开动画 160ms

### 3.12 全局 Toast
- DOM：`#globalToast`（顶部三球下方 8px、水平居中）
- 样式：纯黑 80% + 毛玻璃 + 胶囊圆角 + 内高光 + 深投影
- 动画：从中心向两边展开（`scaleX(0.05) → 1`），0.42s 带回弹，消失缩回
- 函数：`window.showToast(title, message, duration)`（默认 2.2s 自动隐藏）/ `window.hideToast()`
- 已接入：下载开始/完成、创建房间成功、加入房间成功、关闭房间、复制房间码、复制验证码、使用皮肤、使用披风、删除皮肤、导入皮肤、检查更新、导入模组、删除版本

### 3.13 联机页账户信息
- 头像下方：玻璃胶囊「正版账户 / 离线账户」（正版蓝色调、离线白色调）
- 胶囊下方：名字玻璃胶囊 + 粗体字（14px / 800）

### 3.14 新增全局数据
- `customVersionNames`（localStorage，`{id: 名称, icon_id: url, scale_id: 数字}`）+ `saveCustomVersionNames()`
- `ICON_GEAR` / `ICON_BACK` / `svgDataUri()` / `VSVG` / `VSVG_URL` / `VSVG_URL_BLUE` / `VSET_TABS`
- 状态：`versionSettingsOpen` / `versionSettingsId` / `versionSettingsTab` / `vset*` 系列

---

## 4. index2.html 新增内容

| 元素 | 用途 |
|---|---|
| `#vsetSpin` + CSS `@keyframes vsetSpinRotate` | 扫描资源转圈 |
| `#vsetIconLayer` | 文件图标 DOM 层（fixed, z-index 18, overflow hidden） |
| `#vsetDropGlow` + CSS | 拖入白色发光边框 |
| `#vsetNameInput`（`.glass-input`） | 版本名输入框 |
| `#aboutTip`（改样式） | 灵动岛 tooltip（半透明黑 + 白字 + 胶囊 + 毛玻璃） |

---

## 5. 引擎滑块（makeLiquidSlider）

- 外部打包已导出 `window.__makeLiquidSlider` / `window.__addSlider`（16426 行附近）
- 签名：`makeLiquidSlider(idPrefix, x, y, w, groupId, trackColor, accentColor, rendererRef, onChange, scroll, liveUpdate, value, snap, onLive)`
- `__addSlider({ id, x, y, w, value, trackColor, accentColor, snap, onLive, onChange, scroll })` 返回 `{ elements, interactions }`
- **曾因 tree-shake 丢失过一次**，需要在 `entry.ts` 顶层挂 `window.__makeLiquidSlider = makeLiquidSlider` 才保留

---

## 6. 已知坑

1. **重新打包覆盖**：见第 1 节，最高优先级
2. **pendingIcons 不受 clipRect 裁剪**：DOM img 固定定位，滚动时不自动裁剪 → 文件图标用独立 `#vsetIconLayer` + 手动按范围显示/隐藏
3. **ph 共用**：`buildVersionPanel` 的 `ph` 被版本列表和设置面板共用 → 设置面板里 `ph = ph + 30` 单独加高
4. **customVersionNames 是新加的**：其他模块若要用，先确认已定义
5. **applyScroll 的 dy**：`listItems` 必须用 `{el, dy}` 结构，直接 `el.rect.y = baseY - scrollY` 会丢元素垂直偏移（齿轮跑位 bug 的根因）
6. **C# 启动读 JSON**：`versions/{id}/{id}.json`，改名（`customVersionNames`）只影响显示，不改目录，不影响启动
7. **启动进度文字必须用 HTML DOM 覆盖层**：进度百分比/消息文字不要用 canvas `makeText`（每次 `build()` 重建会吞更新）。用 `index2.html` 里的 `#launchPctDom` / `#launchMsgDom`，直接改 `textContent`。状态用 `window.launching`（不是 IIFE 内局部变量）
8. **WebView2 缓存**：改完 `liquidui.js` 后，必须改 `index2.html` 里 `<script src="liquidui/liquidui.js?v=...">` 的版本号，否则会加载旧缓存（可用 `v=日期_时间`）
9. **DOM 覆盖层元素的"幽灵残留"**（高频问题，务必关注）：
   - `index2.html` 里的所有 `position:fixed` 覆盖层（`#vsetNameInput`、`#vsetSpin`、`#launchPctDom`、`#launchMsgDom`、`#launchRingSvg`、`#vsetDropGlow` 等）**不会随 canvas 页面切换自动隐藏**，必须在以下位置显式隐藏：
     - `build()` 开头统一判断（如非对应页面/状态则 `display:none`）
     - 切 tab / 返回 / 关闭面板 / 切页面 的 onTap 回调里
   - 典型症状：元素飘在别的页面/区域、字体大、无背景框、像"幽灵"一样黏在屏幕上。
   - `#vsetNameInput` 已在 build、切 tab、返回、关闭处全部隐藏；若新增 DOM 覆盖层，务必同步加隐藏逻辑。

---

## 7. 相关文件

| 文件 | 说明 |
|---|---|
| `wwwroot/liquidui/liquidui.js` | 新 UI 引擎 + 所有本地改动（742KB） |
| `wwwroot/liquidui/liquidui.backup.js` | 重新打包前旧版备份 |
| `wwwroot/index2.html` | 新 UI 页面 + DOM 覆盖层 |
| `wwwroot/index.html` | 旧 UI（DOM 版，功能完整，可参考实现） |
| `wwwroot/ring-glass.js` | 关于页圆环 shader |
| `IllusionLauncherWPF/MainWindow.xaml.cs` | C# 侧 action 处理（list_files / toggle_file / delete_file / delete_version / import_files / pick_version_icon / load_version_config / pick_java_for_version / clear_version_java / export_mrpack 等） |
| `FRONTEND_HANDOVER.md` | 旧 UI 交接文档 |

---

## 8. C# 侧相关 action（新 UI 用到的）

| action | 参数 | 回调 |
|---|---|---|
| `list_files` | versionId, folderType | `onFileList({versionId, folderType, files})` |
| `toggle_file` | versionId, folderType, fileName | `onFileChanged()` |
| `delete_file` | versionId, folderType, fileName | `onFileChanged()` |
| `import_files` | versionId, folderType, paths | `onFileChanged()` |
| `delete_version` | versionId | `onVersionDeleted(id)` / `onDeleteFailed(id, err)` |
| `pick_version_icon` | versionId | `onVersionIconPicked({url})` |
| `load_version_config` | versionId | `onVersionConfigLoaded({versionId, config:{javaPath}})` |
| `pick_java_for_version` / `pick_java_folder_for_version` | versionId | `onVersionJavaUpdated({versionId, ok, javaPath})` |
| `clear_version_java` | versionId | `onVersionJavaUpdated` |
| `export_mrpack` | versionId | （后台执行） |
| `file_drop_mods`（postMessageWithAdditionalObjects） | files | `onHostDrop({paths})` |

`folderType`：`mods` / `resourcepacks` / `shaderpacks`

---

# 3.14 已知引擎崩溃类 bug（2026-10-30 已修，别删补丁）

**症状**：拖动指示器 / 切到新页面后**整个界面定死**，DevTools 报
`Uncaught TypeError: Cannot read properties of undefined (reading '0')`
`at LiquidGlassRenderer.rasterizeForeground`。因为主线程 rAF 循环被打死，看起来是“卡死”。

**根因**：`rasterizeForeground` 的两个提前返回都拦不住 `kind === "button"`：

```js
if (cfg.kind === "text" && cfg.text) { ...; return; }              // 文字为空 → 拦不住
if (cfg.kind !== "button" && !cfg.label && !cfg.icon) { ...; return; } // 是 button → 拦不住
if (cfg.icon) { ...; return; }                                      // 无图标 → 拦不住
// 一路掉到这里：
const colorStr = rgba(cfg.labelColor[0] ...)   // undefined[0] → 崩
```

而 `makeButton` 原本是 `labelColor: spec.labelColor` —— spec 不传就是 `undefined`。

**已打的三处补丁（都在 `wwwroot/liquidui/liquidui.js`，均为唯一字符串替换）**：

| # | 位置 | 补丁内容 |
|---|---|---|
| ① | 图标分支之后、`const fontPx` 之前 | `if (!cfg.label) { this.fgDirtyIds.delete(cfg.id); return; }` |
| ② | 原 `const colorStr` 处 | `const _lc = cfg.labelColor \|\| [1,1,1,1];`，后文全用 `_lc` |
| ③ | `makeButton` 返回对象 | `labelColor: spec.labelColor \|\| [1,1,1,1],` |

**不要删这三处**。删了等于把“任何无文字按钮都能炸主线程”的雷装回去。

**新建元素时的规则**：`kind: "button"` 要么给 `label` + `labelColor`，要么给 `icon`；
两者都没有的元素现在会被静默跳过（不画前景、不崩），但别再依赖这个兜底。

---

# 3.15 当前状态（2026-10-30 17:00）

| 项 | 状态 |
|---|---|
| `?v=` | `20261030_r77`（已 rebuild 部署，源码 = bin 哈希一致）|
| 玻璃球 / 胶囊 / 涟漪 / 下沉回弹 | 完成并验收 |
| 清理内存 & 开始游戏接入同一套特效 | 完成 |
| 资源大厅（Modrinth/CurseForge 搜索下载）| **用户正在自己写**，`buildResourceHall(cardX,cardY,cardW,cardH)` 约在 L14478 |
| `entry.ts` | 已改名为 `entry.ts.OBSOLETE-1029`（防误打包），说明见 `src/README-FROZEN.md` |
| 引擎崩溃类 bug | 已修，见 3.14 |

**接手时的第一件事**：按 3.13 跑自检，确认 `?v=` 与源码/bin 三者一致；
如果用户在同时改前端，**改任何文件前先把他的改动读一遍**，不要用 write 整体覆盖，只用 edit 做唯一字符串替换。

---

# 第 4 轮（2026-10-30 晚）—— 资源大厅

可跑版本：`?v=20261030_r77`，备份 `build/liquid-ui/backups/liquidui.20261030_r77_good.js`（788,265 字节）。

## 本轮完成

1. **火箭清理内存崩溃修复**（见 3.14，三处守卫，勿删）
2. **资源大厅列表**：缩略图 52×52 圆角裁切 + 名字 + 介绍，走 HTML 叠层 `#rhIconLayer`
   - 字段映射：`title = item.name || item.title`，`desc = item.desc || item.summary || item.description`
   - `_rhEsc()` 做 HTML 转义
3. **玻璃卡片**：`makeGlassShape` + M_FROST 参数（`refractionAmount: 0` + `blurRadius: 12`），`independentBackdrop: true`
4. **分类下拉**：引擎绘制，**翻到按钮上方**（`fy = btnY - fh - 10`），弹簧入场 `_rhMenuPop()`（ζ≈0.42）
5. **☰ 与搜索框融合**：`rh-search-cap` 玻璃胶囊 + HTML `#rhSearchInput`
   - 380ms 防抖 / 回车立即 / Esc 清空，写 `dl.rhQuery` 后 `build()`
6. **列表裁剪**：`#rhIconLayer` 用 `clip-path: inset(listTop-4 …)` 裁到列表区（必须在 `dl.rhListTop/rhListH` 赋值**之后**执行）
7. **分区指示器同步**：`buildTabBar("tabs3", …)` 的 onSelect 和分段控件的 `tap` 里补 `setSelection`
8. **搜索框只在大厅显示**：`build()` 开头设 `opacity: 0`、大厅里设 `1` —— **必须用 opacity 不能用 display**，否则重建时输入框丢焦点

## 待做

**安装面板** → 完整规格见 `HANDOVER_RESOURCE_HALL.md`（老 UI 接口、字段、7 步实现、踩坑清单都在里面）
