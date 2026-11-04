(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/sdf.ts
  var SDF_GLSL, COVER_GLSL;
  var init_sdf = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/sdf.ts"() {
      "use strict";
      SDF_GLSL = /* glsl */
      `
// Corner style: 0 = circular (standard arc), 1 = continuous (squircle/superellipse).
// Declared here (in SDF_GLSL) because sdShape references it, and SDF_GLSL is
// included by multiple shaders (element, shadow, highlight, plain-rect).
uniform float uCornerStyle;

// --- Continuous-curvature SDF texture (capsule shape) ---
// When uUseContinuousSdf > 0.5, sdShape() dispatches to sdContinuousCurvature
// which samples a precomputed SDF texture (generated from the G2-continuous
// Bezier path in continuous-curve.ts). Only the dialog card sets this to 1;
// other shaders that include SDF_GLSL leave it at the default 0 \u2014 sdShape
// falls through to the analytic sdRoundedRect / sdContinuousRoundedRect path.
uniform sampler2D uContinuousSdf;
uniform float uUseContinuousSdf;        // 0 or 1
uniform float uNoContinuousSdfInRefraction;  // 0 or 1 \u2014 when 1, refraction/highlight SDF forces analytic sdRoundedRect (ignores uUseContinuousSdf). Mask/clip still uses uUseContinuousSdf.
uniform vec2  uContinuousSdfTexSize;    // SDF texture size in px (256, 256)
uniform vec2  uContinuousSdfElementSize; // element's original w,h in px

// radiusAt \u2014 picks the corner radius from cornerRadii based on which
// quadrant 'coord' is in. For uniform radii (the catalog case) this
// always returns the same value.
float radiusAt(vec2 coord, vec4 radii) {
    if (coord.x >= 0.0) {
        if (coord.y <= 0.0) return radii.y;
        else return radii.z;
    } else {
        if (coord.y <= 0.0) return radii.x;
        else return radii.w;
    }
}

// sdRoundedRect \u2014 signed distance to a rounded-rect boundary.
// Negative inside, positive outside, zero on the edge.
// Uses standard circular arcs for the corners.
float sdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
    vec2 cornerCoord = abs(coord) - (halfSize - vec2(radius));
    float outside = length(max(cornerCoord, 0.0)) - radius;
    float inside = min(max(cornerCoord.x, cornerCoord.y), 0.0);
    return outside + inside;
}

// sdContinuousRoundedRect \u2014 continuous-curvature rounded rect.
// The original uses G2-continuous Bezier corners (ContinuousCurvatureRoundedRectangleCornerBuilder).
// The visual difference between Continuous and Circular is very subtle (only
// curvature continuity at the tangent points). For the SDF-based renderer,
// the circular arc SDF (sdRoundedRect) is a close enough approximation \u2014 the
// Bezier corners deviate from the arc by <0.5% of the radius, which is
// sub-pixel at typical element sizes.
//
// When uCornerStyle=1 (continuous), we use sdRoundedRect directly. The
// difference from the original is imperceptible. A future upgrade could
// implement exact Bezier SDF for pixel-perfect matching.
float sdContinuousRoundedRect(vec2 coord, vec2 halfSize, float radius) {
    return sdRoundedRect(coord, halfSize, radius);
}

// sampleClipMask \u2014 sample R channel (coverage) from the mask texture.
// Returns browser-native AA coverage [0,1] for clip + edgeAlpha.
float sampleClipMask(vec2 coord, vec2 halfSize, float radius) {
    float maxDim = max(max(uContinuousSdfElementSize.x, uContinuousSdfElementSize.y), 1e-4);
    float aspectW = uContinuousSdfElementSize.x / maxDim;
    float margin = 4.0;
    float drawW = (uContinuousSdfTexSize.x - 2.0 * margin) * aspectW;
    float scale = drawW / max(uContinuousSdfElementSize.x, 1e-4);
    vec2 tex = uContinuousSdfTexSize * 0.5 + coord * scale;
    vec2 uv = tex / uContinuousSdfTexSize;
    return texture2D(uContinuousSdf, uv).r;  // R = coverage [0,1]
}

// sampleClipSdf \u2014 sample G channel (SDF) from the mask texture.
// Returns signed distance: negative inside, positive outside, 0 at edge.
// Same shape as sampleClipMask (both from the same Bezier path), so clip
// and stroke shapes are always identical.
float sampleClipSdf(vec2 coord, vec2 halfSize, float radius) {
    float maxDim = max(max(uContinuousSdfElementSize.x, uContinuousSdfElementSize.y), 1e-4);
    float aspectW = uContinuousSdfElementSize.x / maxDim;
    float margin = 4.0;
    float drawW = (uContinuousSdfTexSize.x - 2.0 * margin) * aspectW;
    float scale = drawW / max(uContinuousSdfElementSize.x, 1e-4);
    vec2 tex = uContinuousSdfTexSize * 0.5 + coord * scale;
    vec2 uv = tex / uContinuousSdfTexSize;
    float g = texture2D(uContinuousSdf, uv).g;  // G = SDF [0,1]
    return (g * 2.0 - 1.0) * radius;  // decode to element-space distance
}

// sdClipShape \u2014 SDF for clip/discard when uUseContinuousSdf is OFF.
float sdClipShape(vec2 coord, vec2 halfSize, float radius) {
    return sdRoundedRect(coord, halfSize, radius);
}

// sdShape \u2014 SDF for refraction/highlight internal calculations.
// When uUseContinuousSdf=1 AND uNoContinuousSdfInRefraction=0, uses
// sampleClipSdf (same G2 shape as clip mask). Otherwise uses the analytic
// sdRoundedRect. This lets the "disable smooth SDF in glass" toggle strip
// the G2 SDF out of the refraction/lens computation while keeping the G2
// clip mask intact (capsuleShape still controls edge shape).
float sdShape(vec2 coord, vec2 halfSize, float radius) {
    if (uUseContinuousSdf > 0.5 && uNoContinuousSdfInRefraction < 0.5) {
        return sampleClipSdf(coord, halfSize, radius);
    }
    return sdRoundedRect(coord, halfSize, radius);
}

// gradSdRoundedRect \u2014 gradient of the SDF (points outward from edge).
// Used both for refraction direction and highlight specular.
vec2 gradSdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
    vec2 cornerCoord = abs(coord) - (halfSize - vec2(radius));
    if (cornerCoord.x >= 0.0 || cornerCoord.y >= 0.0) {
        vec2 v = max(cornerCoord, vec2(0.0));
        // Guard against normalize(0,0) -> NaN
        float len = length(v);
        if (len < 1e-6) return vec2(0.0);
        return sign(coord) * (v / len);
    } else {
        float gradX = step(cornerCoord.y, cornerCoord.x);
        return sign(coord) * vec2(gradX, 1.0 - gradX);
    }
}

// rotateBy \u2014 rotate a 2D vector by angle (radians). Used to un-rotate the
// sample coord into the element's local space (so the SDF shape appears
// rotated by +uElementRotation), and to rotate refraction offsets back to
// screen space.
vec2 rotateBy(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// erfApprox \u2014 error function approximation (Abramowitz & Stegun 7.1.26).
// Max error < 2.5e-5. Used by inner shadow to model BlurMaskFilter's
// Gaussian convolution of a ring shape. erf(x) \u2208 [-1, 1].
float erfApprox(float x) {
    float a = abs(x);
    float t = 1.0 / (1.0 + 0.47047 * a);
    float y = 1.0 - (((0.3480242 * t - 0.0958798) * t + 0.7478556) * t * exp(-a * a));
    return sign(x) * y;
}
`;
      COVER_GLSL = /* glsl */
      `
// Returns wallpaper UV for a canvas pixel coordinate (top-left origin).
vec2 coverUv(vec2 canvasPx) {
    float canvasAspect = uCanvasSize.x / uCanvasSize.y;
    float wpAspect = uWallpaperSize.x / uWallpaperSize.y;
    vec2 uv = canvasPx / uCanvasSize;
    if (wpAspect > canvasAspect) {
        // Wallpaper is wider than canvas \u2014 crop horizontally.
        float s = canvasAspect / wpAspect;
        uv.x = (uv.x - 0.5) * s + 0.5;
    } else {
        // Wallpaper is taller than canvas \u2014 crop vertically.
        float s = wpAspect / canvasAspect;
        uv.y = (uv.y - 0.5) * s + 0.5;
    }
    return uv;
}

// Per-axis scale: 1 canvas pixel in wallpaper UV units.
// Used to convert a blur radius (in canvas px) into UV-space offsets
// for poisson-disc sampling.
vec2 canvasPxToUvScale() {
    float canvasAspect = uCanvasSize.x / uCanvasSize.y;
    float wpAspect = uWallpaperSize.x / uWallpaperSize.y;
    if (wpAspect > canvasAspect) {
        return vec2(canvasAspect / wpAspect, 1.0) / uCanvasSize;
    } else {
        return vec2(1.0, wpAspect / canvasAspect) / uCanvasSize;
    }
}
`;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/element-uniforms.ts
  var ELEMENT_UNIFORMS_GLSL;
  var init_element_uniforms = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/element-uniforms.ts"() {
      "use strict";
      ELEMENT_UNIFORMS_GLSL = /* glsl */
      `
uniform sampler2D uBackdrop;
uniform sampler2D uWallpaperSampler;  // wallpaper texture (unscaled backdrop for toggle knobs)
uniform sampler2D uTabsBackdropSampler;  // tabsBackdrop FBO (tinted scene for indicator CombinedBackdrop)
uniform vec2  uCanvasSize;        // canvas size in px
uniform vec2  uWallpaperSize;     // UNUSED \u2014 kept for uniform-set compatibility
uniform vec2  uElementOffset;     // element top-left in canvas px (SCALED rect \u2014 where the quad is drawn)
uniform vec2  uElementSize;       // element size in px (SCALED \u2014 includes graphicsLayer scaleX/scaleY)
uniform vec4  uBackdropBbox;      // (offsetX, offsetY, sizeX, sizeY) in UV [0,1] \u2014 region of fullscreen scene the backdrop texture covers. Identity (0,0,1,1) when fullscreen.
uniform vec4  uCornerRadii;       // (topLeft, topRight, bottomRight, bottomLeft) in px (ORIGINAL, unscaled)
uniform float uRefractionHeight;  // px (ORIGINAL space \u2014 NOT scaled by layerScale, faithful to AGSL)
uniform float uRefractionAmount;  // px (ORIGINAL space \u2014 NOT scaled, faithful to AGSL)
// --- Layer transform (faithful to graphicsLayer { scaleX, scaleY }) ---
// The original applies the refraction shader at the ORIGINAL element size, THEN
// scales the entire rendered layer by (scaleX, scaleY) via graphicsLayer. To
// replicate this in a single-pass shader, we compute the SDF/refraction in
// ORIGINAL space (by dividing the screen-space centered coord by uLayerScale),
// then map the refraction offset back to screen space for backdrop sampling.
// This keeps the SDF shape correct (not stretched) while covering the scaled rect.
uniform vec2  uOriginalSize;        // element size in px (ORIGINAL, unscaled by graphicsLayer)
uniform float uOriginalCornerRadius; // corner radius in px (ORIGINAL, unscaled)
uniform vec2  uLayerScale;          // (scaleX, scaleY) from graphicsLayer \u2014 maps original\u2192screen
uniform float uElementRotation;    // rotation in radians (graphicsLayer rotationZ) \u2014 0 = none
uniform float uDepthEffect;       // 0 or 1
uniform float uChromaticAberration; // 0 or 1
uniform float uBlurRadius;        // px
uniform float uSaturation;        // vibrancy = 1.5
uniform float uBrightness;        // brightness offset (0 for vibrancy)
uniform float uContrast;          // 1.0 for vibrancy
uniform vec4  uTintColor;         // rgba; alpha 0 = no tint
uniform vec4  uSurfaceColor;      // rgba; alpha 0 = no surface
uniform vec4  uHighlightColor;    // rgb + 1.0 (alpha handled by uHighlightAlpha)
uniform float uHighlightAngle;    // radians
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;     // 0=default, 1=ambient, 2=plain
uniform float uHighlightStrokeWidth; // px (full stroke width, matching paint.strokeWidth)
uniform float uHighlightBlur;     // px (BlurMaskFilter radius)
// Content scale (non-uniform, faithful to LiquidToggle.kt / LiquidSlider.kt):
//   scale(scaleX, scaleY) { drawBackdrop() }
// Toggle: X lerp(2/3, 0.75, p), Y lerp(0, 0.75, p)
// Slider: X lerp(2/3, 1, p),    Y lerp(0, 1, p)
// At rest Y=0 \u2192 backdrop sampled from a single horizontal line (degenerate),
// but the white overlay (alpha=1) hides it. When pressed, scales to full.
uniform float uContentScaleX;
uniform float uContentScaleY;
// --- Toggle knob CombinedBackdrop effect (faithful to LiquidToggle.kt) ---
// The knob's backdrop is a CombinedBackdrop of:
//   1. Outer backdrop (LayerBackdrop wallpaper OR CanvasBackdrop solid color)
//   2. Scaled trackBackdrop (track color rect, scaled by lerp(2/3,0.75) x lerp(0,0.75))
// uUseToggleBackdrop = 1.0 \u2192 sample outer backdrop + composite scaled track color
// uUseToggleBackdrop = 0.0 \u2192 sample scene (uBackdrop) as before
//
// uUseSolidBackdrop = 1.0 \u2192 outer backdrop is solid color (uSolidBackdropColor)
// uUseSolidBackdrop = 0.0 \u2192 outer backdrop is wallpaper texture (uWallpaperSampler)
// Faithful to ToggleContent.kt:
//   - t1 (on wallpaper): backdrop = LayerBackdrop \u2192 sample wallpaper texture
//   - t2 (on card):      backdrop = rememberCanvasBackdrop { drawRect(color) } \u2192 solid color
uniform float uUseToggleBackdrop;
uniform float uUseSolidBackdrop;
uniform vec4  uSolidBackdropColor;  // rgba 0..1; used when uUseSolidBackdrop = 1.0
uniform vec4  uTrackColor;        // rgba 0..1; alpha 0 = no track color
uniform vec4  uTrackRect;         // (centerX, centerY, halfW, halfH) in canvas px (dpr-scaled)
uniform float uTrackCornerRadius; // canvas px (dpr-scaled)
// --- Bottom tab \u6307\u793A\u5668 CombinedBackdrop (faithful to LiquidBottomTabs.kt) ---
// The \u6307\u793A\u5668's backdrop = CombinedBackdrop(wallpaper, \u5185\u5C42\u80CC\u666F\u677F) where
// \u5185\u5C42\u80CC\u666F\u677F (tabsBackdrop) is a hidden Row with ColorFilter.tint(accentColor). Only the
// opaque \u6807\u7B7E\u5185\u5BB9 (icons/labels) becomes blue after tint \u2014 the glass part
// is transparent. We pass up to 8 tab content rects; pixels inside any rect
// (clipped to the \u5BB9\u5668 capsule) are tinted accentColor.
uniform float uIndicatorBackdrop;    // 0 or 1
uniform vec4  uContainerRect;        // (centerX, centerY, halfW, halfH) in canvas px (dpr-scaled)
uniform float uContainerCornerRadius; // canvas px (dpr-scaled)
uniform vec4  uIndicatorAccent;      // (r, g, b, a) \u2014 accentColor + unused
uniform float uInsetPx;              // indicator backdrop inset in device px (4dp * dpr)
uniform float uIndicatorPressProgress; // 0..1 press progress (for 2nd-layer scale)
uniform float uIndicatorPanelOffset; // panel offset in device px (2nd-layer x translation)
uniform float uDpr;                 // device pixel ratio (for dp\u2192px conversion)
uniform vec2  uContainerCenter;      // container center (scale origin) in canvas px (dpr-scaled)
uniform float uContainerScale;       // container layerBlock scale (1 + 16dp/width * pressProgress)
// Tab content fgTextures (icon+label alpha masks) for blue tint. Up to 8 tabs.
// Only opaque icon/label pixels become blue \u2014 the container glass stays natural.
uniform sampler2D uTabContentTex0;
uniform sampler2D uTabContentTex1;
uniform sampler2D uTabContentTex2;
uniform sampler2D uTabContentTex3;
uniform sampler2D uTabContentTex4;
uniform sampler2D uTabContentTex5;
uniform sampler2D uTabContentTex6;
uniform sampler2D uTabContentTex7;
uniform vec4  uTabContentRects[8];   // (centerX, centerY, halfW, halfH) per tab, canvas px (dpr-scaled)
uniform float uTabContentCount;      // number of valid tab rects (0..8)
uniform sampler2D uTabsGlassLayer;   // scene snapshot BEFORE tab-content (wallpaper+glass only, no text)
// --- SDF texture glass (faithful to SdfShader.kt) ---
uniform sampler2D uSdfTexSampler;   // clock_sdf texture (R=SDF, GB=normal, A=shape alpha)
uniform float uUseSdfTexture;       // 0 or 1
uniform vec2  uSdfTexSize;          // texture natural dimensions (px)
uniform float uSdfLightAngle;       // bevel light angle (degrees)
uniform float uEnterAlpha;          // global element alpha (enterProgress, 0..1)
// Highlight generation distance multiplier. The SDF-texture shader computes
// intensity = circleMap(1.0 - min(1.0, -sd * uSdfHighlightScale)) where sd is
// the normalized signed distance (-1 deep inside, 0 at edge, +1 far outside).
// The intensity field drives BOTH the refraction offset AND the bevel-lighting
// contribution. Physically it controls the WIDTH of the edge band where the
// glass effect transitions from full (at the edge) to zero (interior):
//   higher scale = narrower/sharper edge band (thinner glass edge feel)
//   lower scale  = wider/gentler edge band (thicker glass edge feel)
// Exposed as "\u73BB\u7483\u539A\u5EA6" (glass thickness) in the TextGlass UI. Default 1.5
// matches the original hardcoded constant in SdfShader.kt.
uniform float uSdfHighlightScale;   // default 1.5
// Bevel lighting on/off (0 or 1). When 0, the shader still computes
// intensity (so refraction \u2014 the glass distortion of the backdrop \u2014 still
// uses uSdfHighlightScale and stays fully adjustable), but the BEVEL
// brightness contribution (color *= 1 + 0.5 * intensity * bevel) is
// skipped entirely. This lets the TextGlass \u5149\u5F71 toggle turn the
// light/shadow layer on/off WITHOUT zeroing the thickness slider's shader
// value (so the slider is never dead). The base brightness dim (\u22120.1) is
// controlled separately via uBrightness on the JS side.
uniform float uSdfBevelEnabled;     // default 1 (on)
// Whole-glass tint dye hue (0..360 degrees). The TextGlass \u67D3\u8272 slider picks
// a hue; the ENTIRE glass body takes on that hue via BlendMode.Hue (faithful
// to Skia's non-separable Hue blend: result takes hue from the tint src, keeps
// the glass's own saturation + value). This is NOT a flat color overlay or CSS
// hue-rotate filter \u2014 it's a proper hue replacement that preserves the glass's
// luminance and saturation, so a dyed glass still looks like glass, just tinted.
// 0 = OFF (no tint \u2014 the slider's leftmost position). 1..360 = hue degrees
// (1 = red-ish, 120 = green, 240 = blue, 360 = red). The off-state is checked
// via uSdfGlassTintHue > 0.5 so the slider's leftmost (0) disables the tint
// entirely. Independent of the \u5149\u5F71 (bevel) toggle \u2014 dyes the whole glass body
// regardless of whether the edge lighting layer is on.
uniform float uSdfGlassTintHue;     // default 0 (off); 1..360 = hue
// Glass tint master switch (0 or 1). Gates BOTH the color-mix filter (below)
// AND the hue-dye (above). When OFF, no tint of any kind is applied regardless
// of uSdfGlassTintHue / uSdfGlassTintMix. Faithful to "\u67D3\u8272\u52A0\u4E00\u4E2A\u5F00\u5173".
uniform float uSdfGlassTintEnabled; // default 0 (off)
// Color-mix filter strength (0..1). BEFORE the hue-dye, the glass body is
// mixed toward a flat color (the pure saturated hue color) by this amount.
// This is a "color mix" filter (SrcOver-style blend toward a solid color) \u2014
// distinct from the hue-dye which replaces hue but preserves S/V. 0 = no
// color-mix (only the hue-dye applies); 1 = full color overlay. Faithful to
// "\u67D3\u8272\u524D\u52A0\u4E00\u4E2A\u6EE4\u955C\uFF08\u989C\u8272\u6DF7\u5408\uFF09\u6DF7\u5408\u5F3A\u5EA6\u8981\u53EF\u4EE5\u8C03".
uniform float uSdfGlassTintMix;     // default 0 (off); 0..1 = mix strength
// Hue-dye strength (0..1, default 0.85). Controls how strongly the
// BlendMode.Hue dye is applied to the glass body. 0 = no hue-dye (only the
// color-mix filter applies if any); 1 = full hue replacement. Originally
// hardcoded at 0.85 (matching the original's constant), now exposed as a
// slider so the user can tune the dye intensity independently of the
// color-mix filter. Faithful to "\u52A0\u4E00\u4E2A\u8C03\u67D3\u8272\u5F3A\u5EA6\u7684".
uniform float uSdfGlassTintStrength; // default 0.85; 0..1 = dye strength
// Tint color saturation (0..1, default 1.0). The tint source color is
// hsv2rgb(hue/360, S, V); S was hardcoded 1.0 before. 0 = gray, 1 = full.
uniform float uSdfGlassTintSaturation; // default 1.0; 0..1
// Tint color lightness/value (0..1, default 1.0). The V in hsv2rgb.
// 0 = black, 0.5 = mid, 1 = full brightness.
uniform float uSdfGlassTintLightness;  // default 1.0; 0..1
// Edge matte (0 or 1). When 1, the SDF edge band (where intensity is high,
// i.e. near the text boundary) is desaturated toward luminance AND slightly
// darkened \u2014 a frosted/matte rim. The edge band factor is intensity itself
// (1 at the very edge, 0 in the interior), so the matte effect fades smoothly
// into the clear glass interior. Faithful to the user request: "\u7528sdf\u6E32\u67D3\u8FB9\u7F18\uFF0C
// \u7136\u540E\u7ED9\u8FB9\u7F18\u964D\u4F4E\u63D0\u4EAE\u4E0E\u9971\u548C\u5EA6" (render the edge with SDF, then reduce the
// edge's brightness and saturation). Independent of the bevel toggle.
uniform float uSdfEdgeMatteEnabled; // default 0 (off)
// Edge matte target bitmask (default 7 = all). Controls WHICH layers the
// matte desaturate+darken applies to. bit 0 (1) = bevel (\u5149\u5F71 highlight),
// bit 1 (2) = tint (\u67D3\u8272), bit 2 (4) = base (refraction/body). When a bit is
// unset, that layer's edge contribution is preserved (not matted). The
// shader checks each bit independently so the user can matte only the bevel
// edge, or only the tint edge, etc. Faithful to "\u54D1\u5149\u5C42\u53EF\u4EE5\u8C03\u662F\u5426\u4F5C\u7528\u4E8E\u67D0
// \u4E9B\u5C42" (the matte layer can be tuned to apply to certain layers).
uniform float uSdfEdgeMatteTargets; // default 7 (all three layers)
// Per-layer matte tuning parameters. Each vec2 = (range, min):
//   range (0..1, default 1.0) \u2014 how far the matte effect extends from the
//     text boundary inward. 1.0 = the matte fades across the FULL intensity
//     field (edge = full strength, interior = zero, original behavior);
//     0.5 = the matte reaches full strength at intensity=0.5 and stays full
//     for intensity > 0.5 (a sharper/narrower matte band right at the rim);
//     small values = very thin matte rim. The edge factor is computed as
//     clamp(intensity / max(range, 0.001), 0.0, 1.0).
//   min (0..1, default 0.0) \u2014 minimum matte amount applied even in the deep
//     interior (where intensity \u2192 0). 0 = interior is clear (no matte);
//     0.3 = interior always has at least 30% matte. The final edge factor is
//     edgeClamped * (1.0 - min) + min. Faithful to "\u7ED9\u54D1\u5149\u6BCF\u5C42\u52A0\u4E0A\u4F5C\u7528\u53C2\u6570
//     \u8C03\u8282\uFF0C\u6BD4\u5982\u8303\u56F4\uFF0C\u6700\u5C0F\u503C".
// One vec2 per layer: bevel (bit 0), tint (bit 1), base (bit 2), brighten
// (bit 3). When the overall uSdfEdgeMatteEnabled is OFF, these are ignored.
// When a layer's bit in uSdfEdgeMatteTargets is unset, that layer's params
// are also ignored.
uniform vec2  uSdfEdgeMatteBevelParams; // (range, min) for bevel layer
uniform vec2  uSdfEdgeMatteTintParams;  // (range, min) for tint layer
uniform vec2  uSdfEdgeMatteBaseParams;  // (range, min) for base layer
uniform vec2  uSdfEdgeMatteBrightenParams; // (range, min) for brighten layer
// Per-layer matte STRENGTH (0..2, default 1.0). Scales the desaturate amount
// (matteStrength 0.65) AND the darken amount (matteDarken 0.18) for that
// layer. 0 = no matte effect at all (even at full edge); 1 = original
// strength; 2 = doubled. Independent per layer so the user can crank the
// bevel matte without affecting the tint/base matte. Faithful to "\u8C03\u6574\u63D0\u4EAE
// \u5C42\u54D1\u5149\u7684".
uniform float uSdfEdgeMatteBevelStrength; // default 1.0
uniform float uSdfEdgeMatteTintStrength;  // default 1.0
uniform float uSdfEdgeMatteBaseStrength;  // default 1.0
uniform float uSdfEdgeMatteBrightenStrength; // default 1.0
// Raw SDF debug render \u2014 when > 0.5, the SDF-texture glass path bypasses all
// glass effects and outputs the SDF's R channel directly as grayscale
// (inside = white, outside = black, AA via A channel). Used by TextGlass to
// inspect texture quality / aliasing / padding.
uniform float uSdfDebugMode;        // 0 or 1
// \u5411\u53CD\u6298\u5C04 (Reverse refraction) toggle (0 or 1). When 1, the SDF-texture
// glass path's refraction pixel offset is REVERSED in direction and DOUBLED
// in distance: instead of sampling the backdrop INWARD (toward text center
// via screenCoord - offset), it samples OUTWARD (away from text center via
// screenCoord + 2*offset). The offset magnitude and intensity field are
// unchanged \u2014 only the sign flips and the distance doubles. Default 0.
uniform float uSdfOuterRefraction;  // 0 or 1
// Coverage (A channel) \u2192 mask smoothstep range. The clock_sdf.webp texture
// uses (0.5, 1.0) \u2014 its A channel is 0 outside, 255 inside with a 1px AA
// edge, so smoothstep(0.5, 1.0) gives a 0.5px AA edge. The text SDF texture
// stores the raw Canvas2D alpha (0..255 with a 1-2px AA edge); using
// (0.5, 1.0) clips the lower half of the AA range \u2192 hard aliased edges,
// especially on small text. For text SDF, we widen to (0.0, 1.0) so the
// full Canvas2D AA gradient is preserved \u2192 smooth edges at all sizes.
uniform float uSdfAaMin;            // default 0.5 (clock_sdf); 0.0 for text SDF
// --- Per-element FBO optimization ---
// When uUsePerElementFbo > 0.5, the element is being rendered into a small
// bbox-sized FBO (NOT the fullscreen scene FBO). In that case gl_FragCoord
// ranges over [0..uElFboSize], so screenCoord must be reconstructed as
// uSceneRectOffset + (gl_FragCoord with Y flipped by uElFboSize.y) to map
// back into the full-canvas top-left-origin coordinate space that the rest
// of the shader (sampleBackdrop, coverUv, SDF, etc.) expects.
uniform float uUsePerElementFbo;    // 0 or 1
uniform vec2  uSceneRectOffset;     // element bbox top-left in canvas px (top-left origin, device px)
uniform vec2  uElFboSize;           // per-element FBO size in device px
// DEPRECATED: uBackdropRect was used by the old PEF path that sampled a
// cropped backdrop texture. The current PEF path samples the FULLSCREEN
// scene texture (same as ping-pong), so sceneUv no longer reads this.
// Kept in the uniform list for cache-index compatibility; not referenced
// by any shader code. Safe to remove once the uniform-cache list is cleaned.
uniform vec4  uBackdropRect;        // (x, y, w, h) top-left origin, scene device px (UNUSED)
// When 1.0, skip applyColorControls in the element shader (colorControls was
// already applied as a fullscreen pass BEFORE the 2-pass blur on the backdrop
// FBO, matching the original's colorControls\u2192blur\u2192lens order). Used by
// backdropFbo + useSeparableBlur elements (dialog card).
uniform float uSkipColorControls;   // 0 or 1
// (uNoContinuousSdfInRefraction is declared in SDF_GLSL \u2014 included by element.ts.
//  When 1.0, the refraction/lens computation forces analytic sdRoundedRect,
//  stripping the G2 SDF texture out of the glass-body refraction. The clip
//  mask is NOT affected \u2014 capsuleShape still controls the edge.)
// --- Magnifier glass (faithful to MagnifierContent.kt) ---
uniform float uUseMagnifier;        // 0 or 1
uniform float uMagnifierZoom;       // zoom factor (1.5)
uniform float uMagnifierOffsetY;    // sample Y offset to cursor (80dp, device px)
// --- Sample wallpaper directly (bypass scene FBO) ---
// When 1.0, sampleBackdrop uses coverUv + uWallpaperSampler (clean wallpaper)
// instead of sceneUv + uBackdrop (scene FBO). Used by elements that sit over
// a scrim/dim (Dialog card, ControlCenter tiles) so the glass refracts the
// clean wallpaper instead of the alpha-decayed scene FBO. Faithful to the
// original where LayerBackdrop captures the wallpaper Image (alpha=1).
uniform float uSampleWallpaper;     // 0 or 1
// --- Scrim color (applied to the wallpaper BEFORE colorControls/blur/lens) ---
// Faithful to DialogContent.kt / ControlCenterContent.kt where the scrim
// (drawRect(dimColor)) is painted onto the wallpaper Image (via
// BackdropDemoScaffold's modifier = drawWithContent { drawContent(); drawRect(dimColor) }),
// so the LayerBackdrop captures wallpaper+scrim as one opaque layer.
// In the port, when uSampleWallpaper=1 (clean wallpaper), we apply the scrim
// here in the shader to replicate that composited backdrop. uScrimColor.a=0
// means no scrim. Applied as SrcOver: backdrop.rgb = scrim.rgb*scrim.a + backdrop.rgb*(1-scrim.a).
uniform vec4 uScrimColor;           // rgba 0..1; a=0 = no scrim
// --- \u5185\u5C42\u80CC\u666F\u677F rim highlight stroke mask (Canvas2D, same approach as outer rim) ---
// When uIndicatorBackdrop=1, the inner backdrop plate's rim highlight is sampled
// from this pre-rasterized Canvas2D stroke mask instead of computed analytically.
// The mask is drawn for the \u5185\u5C42\u80CC\u666F\u677F capsule shape (uContainerRect dimensions)
// with clip(stroke) + BlurMaskFilter, giving browser-native Skia AA.
uniform sampler2D uInnerStrokeMask;   // Canvas2D stroke mask texture for inner backdrop highlight
uniform vec2  uInnerStrokeMaskOffset; // margin (strokeMargin) in device px \u2014 UV offset
uniform vec2  uInnerStrokeMaskSize;   // (maskW, maskH) in device px \u2014 total mask texture size
`;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/element-utils.ts
  function generateGaussianDisc(tapCount) {
    const taps = [];
    if (tapCount <= 1) {
      taps.push({ x: 0, y: 0, w: 1 });
      return taps;
    }
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const maxRadius = 3;
    let totalW = 0;
    for (let i = 0; i < tapCount; i++) {
      const t = (i + 0.5) / tapCount;
      const r = maxRadius * Math.sqrt(t);
      const angle = i * goldenAngle;
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      const dist2 = x * x + y * y;
      const w = Math.exp(-0.5 * dist2);
      taps.push({ x, y, w });
      totalW += w;
    }
    if (totalW > 0) {
      for (const t of taps) t.w /= totalW;
    }
    return taps;
  }
  function generateBlurGLSL(taps, sampler, uvVar, pxToUvExpr) {
    if (taps.length === 1) {
      return `    return texture2D(${sampler}, ${uvVar});
`;
    }
    let code = "";
    for (const t of taps) {
      const ox = t.x.toFixed(6);
      const oy = t.y.toFixed(6);
      const w = t.w.toFixed(8);
      code += `    sum += texture2D(${sampler}, ${uvVar} + vec2(${ox}, ${oy}) * ${pxToUvExpr}) * ${w};
`;
    }
    return code;
  }
  function generateElementUtilsGLSL(tapCount = DEFAULT_BLUR_TAPS) {
    const taps = generateGaussianDisc(tapCount);
    const backdropBlurCode = generateBlurGLSL(taps, "uBackdrop", "uv", "pxToUv");
    const wallpaperBlurCode = generateBlurGLSL(taps, "uWallpaperSampler", "uv", "pxToUv");
    return (
      /* glsl */
      `
// Forward declarations \u2014 blendHue/rgb2hsv/hsv2rgb are defined later but used
// by sampleIndicatorBackdrop (which must come before sampleToggleBackdrop in
// the file for readability). GLSL ES 1.00 requires declaration before use.
vec3 rgb2hsv(vec3 c);
vec3 hsv2rgb(vec3 c);
vec3 hsl2rgb(vec3 c);
vec3 blendHue(vec3 dst, vec3 src);

float circleMap(float x) {
    return 1.0 - sqrt(1.0 - x * x);
}

// SDF-texture glass sampling (faithful to SdfShader.kt).
// Samples the clock_sdf texture at element-local coords.
// Returns vec4(intensity, maskAlpha, normalX, normalY); zeroes if outside.
//
// uSdfHighlightScale controls how far from the text edge the bevel highlight
// extends into the interior. Original hardcoded constant was 1.5; exposed as
// a uniform so the TextGlass page can tune it live via a slider.
//
// uSdfAaMin controls the coverage\u2192mask smoothstep lower bound. clock_sdf uses
// 0.5 (narrow AA); text SDF uses 0.0 (full Canvas2D AA gradient \u2192 smooth at
// all sizes, no aliasing on small text).
vec4 sampleSdfTexture(vec2 localPx) {
    vec2 uv = vec2(localPx.x / uOriginalSize.x,
                   localPx.y / uOriginalSize.y);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
        return vec4(0.0);
    }
    vec4 v = texture2D(uSdfTexSampler, uv);
    float sd = v.r * 2.0 - 1.0;
    float mask = smoothstep(uSdfAaMin, 1.0, v.a);
    if (mask <= 0.0) return vec4(0.0);
    if (mask < 1.0) sd = 0.0;
    vec2 normal = normalize(v.gb * 2.0 - 1.0);
    float intensity = circleMap(1.0 - min(1.0, -sd * uSdfHighlightScale));
    return vec4(intensity, mask, normal.x, normal.y);
}

// Convert a canvas-pixel coordinate (top-left origin) to scene-texture UV.
// The scene texture is the same size as the canvas, and is rendered with
// gl_FragCoord (bottom-left origin). So UV = (canvasPx.x / canvasW, 1 -
// canvasPx.y / canvasH). The Y flip happens here so the rest of the shader
// can work in top-left-origin canvas px.
//
// This is used by BOTH the ping-pong path and the per-element FBO path.
// In the PEF path, the element pass still samples the FULLSCREEN scene
// texture (uBackdrop = curTex or blurFboBTex), NOT a cropped region. The
// only PEF-specific work happens in element.ts's main(), where screenCoord
// is reconstructed from gl_FragCoord via uSceneRectOffset/uElFboSize. Once
// screenCoord is in canvas-px space, this function maps it to UV identically
// for both paths \u2014 keeping the shader's non-local reads (refraction offset,
// chromatic 7-tap spread, blur kernel) hitting real neighbor content.
vec2 sceneUv(vec2 canvasPx) {
    return vec2(canvasPx.x / uCanvasSize.x, 1.0 - canvasPx.y / uCanvasSize.y);
}

// Gaussian disc blur \u2014 ${tapCount} taps, dynamically generated in JS.
// Offsets are in units of radius (sigma = radius), scaled at runtime.
// radius < 0.5 falls back to single tap (no visible blur).
//
// When uSampleWallpaper > 0.5, samples the CLEAN wallpaper (uWallpaperSampler
// via coverUv) instead of the scene FBO (uBackdrop via sceneUv), AND applies
// the scrim (uScrimColor) to replicate the original's wallpaper+scrim composited
// LayerBackdrop. The scrim is applied INSIDE sampleBackdrop so EVERY sampling
// site \u2014 the initial backdrop sample, the refraction re-sample, and each
// chromatic-aberration channel \u2014 gets the same wallpaper+scrim composite.
// This fixes the "scrim not applied at edges" bug where the refraction band
// re-sampled the clean wallpaper (without scrim), making the edge brighter
// than the interior.
vec4 sampleBackdrop(vec2 canvasPx, float radius) {
    if (uSampleWallpaper > 0.5) {
        vec2 uv = coverUv(canvasPx);
        vec4 c;
        if (radius < 0.5) {
            c = texture2D(uWallpaperSampler, uv);
        } else {
            vec2 pxToUv = radius * canvasPxToUvScale();
            vec4 sum = vec4(0.0);
${wallpaperBlurCode}            c = sum;
        }
        // Apply scrim (SrcOver) so the backdrop = wallpaper+scrim, opaque.
        if (uScrimColor.a > 0.001) {
            c.rgb = uScrimColor.rgb * uScrimColor.a + c.rgb * (1.0 - uScrimColor.a);
            c.a = 1.0;
        }
        return c;
    }
    vec2 uv = sceneUv(canvasPx);
    // uBackdrop may be a bbox-sized texture (when blur ran in a bbox FBO via
    // cropAndBlurBackdrop). uBackdropBbox = (offsetX, offsetY, sizeX, sizeY)
    // in normalized UV [0,1] \u2014 the region of the fullscreen scene the bbox
    // texture covers. Map sceneUv into that region, clamp to avoid bleeding
    // at bbox edges. When uBackdropBbox.zw > 1.0 (sentinel = fullscreen),
    // the mapping is identity (uv unchanged).
    uv = (uv - uBackdropBbox.xy) / uBackdropBbox.zw;
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    if (radius < 0.5) {
        return texture2D(uBackdrop, uv);
    }
    // Backdrop is always the fullscreen scene texture (both ping-pong and
    // PEF paths), so blur offsets scale by the canvas size.
    vec2 pxToUv = radius / uCanvasSize;
    vec4 sum = vec4(0.0);
${backdropBlurCode}    return sum;
}

// Gaussian disc blur of the WALLPAPER (uWallpaperSampler via coverUv).
// Used by the SDF-texture glass path (LockScreen) \u2014 faithful to the original's
// blur(2dp) effect applied before the SDF shader.
vec4 sampleWallpaperBlurred(vec2 canvasPx, float radius) {
    vec2 uv = coverUv(canvasPx);
    if (radius < 0.5) {
        return texture2D(uWallpaperSampler, uv);
    }
    vec2 pxToUv = radius * canvasPxToUvScale();
    vec4 sum = vec4(0.0);
${wallpaperBlurCode}    return sum;
}

// --- Toggle knob CombinedBackdrop sampling (faithful to LiquidToggle.kt) ---
// The knob's backdrop is a CombinedBackdrop of:
//   1. Outer backdrop:
//      - LayerBackdrop (wallpaper) for t1 \u2192 sample uWallpaperSampler
//      - CanvasBackdrop (solid color) for t2 \u2192 use uSolidBackdropColor
//   2. Scaled trackBackdrop (track color rect, clipped to Capsule, scaled
//      by lerp(2/3, 0.75, pressProgress) x lerp(0, 0.75, pressProgress)
//      around the knob's center)
//
// This function samples the outer backdrop (wallpaper OR solid color) with blur,
// then composites the scaled track color on top using a rounded-rect SDF
// at the uTrackRect position (center + half-size + corner radius).
//
// The track color SDF is also blurred by approximating the blur as a
// smoothstep over uBlurRadius \u2014 this matches the original where the blur
// effect is applied to the CombinedBackdrop (outer + track color).
vec4 sampleToggleBackdrop(vec2 canvasPx, float radius) {
    // 1. Sample outer backdrop with blur.
    vec4 wp;
    if (uUseSolidBackdrop > 0.5) {
        // CanvasBackdrop case (t2): solid color fills the entire knob area.
        // Faithful to: rememberCanvasBackdrop { drawRect(backgroundColor) }
        // The drawRect fills the DrawScope (knob's bounds) with the color,
        // so every pixel of the knob's backdrop is the solid color.
        wp = uSolidBackdropColor;
    } else if (radius < 0.5) {
        // LayerBackdrop case (t1): sample wallpaper texture unscaled.
        // IMPORTANT: use coverUv (cover-fit) to match the wallpaper background
        // pass (WALLPAPER_FRAGMENT_SHADER). Using sceneUv (raw normalization)
        // here would sample the wrong texel when the wallpaper aspect ratio
        // differs from the canvas \u2014 causing the knob to see a shifted/misaligned
        // wallpaper that doesn't match what's displayed behind it.
        vec2 uv = coverUv(canvasPx);
        wp = texture2D(uWallpaperSampler, uv);
    } else {
        // LayerBackdrop case (t1) with blur: 9-tap poisson disc on wallpaper.
        // Use coverUv for the center sample, and convert the blur radius from
        // canvas px to UV-space using canvasPxToUvScale() (which accounts for
        // the cover-fit aspect ratio cropping).
        vec2 uv = coverUv(canvasPx);
        vec2 pxToUv = radius * canvasPxToUvScale();
        vec4 sum = vec4(0.0);
        float total = 0.0;
        sum += texture2D(uWallpaperSampler, uv) * 0.25; total += 0.25;
        sum += texture2D(uWallpaperSampler, uv + vec2( 1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2(-1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000,  1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000, -1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        wp = sum / total;
    }

    // 2. Composite scaled track color on top.
    // The track rect is centered at uTrackRect.xy with half-size uTrackRect.zw,
    // and corner radius uTrackCornerRadius. We compute the SDF of this
    // rounded rect at canvasPx, then apply a smoothstep for edge AA + blur.
    // If uTrackColor.a == 0.0 OR the track rect is degenerate (halfW or
    // halfH < 0.5px, which happens at rest when scaleY=0), skip compositing.
    // Faithful to original: scale(scaleX, 0) { drawRect() } draws nothing.
    if (uTrackColor.a > 0.001 && uTrackRect.z > 0.5 && uTrackRect.w > 0.5) {
        vec2 trackCenter = uTrackRect.xy;
        vec2 trackHalf = uTrackRect.zw;
        vec2 trackLocal = canvasPx - trackCenter;
        // sdRoundedRect expects centered coord (relative to center).
        // Use uniform corner radius = uTrackCornerRadius.
        float tr = uTrackCornerRadius;
        // Approximate the rounded-rect SDF (matches sdRoundedRect from SDF_GLSL).
        vec2 q = abs(trackLocal) - trackHalf + vec2(tr);
        float trackSd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - tr;
        // Blur the edge by uBlurRadius (approximate Gaussian edge feather).
        // Inside (trackSd < -radius) \u2192 mask=1; outside (trackSd > radius) \u2192 mask=0.
        // Use max(radius, 1.0) to guarantee at least 1px smoothstep for AA
        // \u2014 when fully pressed, blurRadius=0, but edges must still be smooth.
        float aaRadius = max(radius, 1.0);
        float mask = 1.0 - smoothstep(-aaRadius, aaRadius, trackSd);
        // Composite: srcOver (track color over outer backdrop).
        float a = mask * uTrackColor.a;
        wp.rgb = mix(wp.rgb, uTrackColor.rgb, a);
        wp.a = mix(wp.a, 1.0, a);
    }
    return wp;
}

// sampleIndicatorBackdrop \u2014 faithful to LiquidBottomTabs.kt indicator.
//
// Naming convention (used throughout the bottom-tabs code):
//   - \u5BB9\u5668 (Container)  = outer visible glass bar (64dp), Container Row in Kotlin
//   - \u6307\u793A\u5668 (Indicator) = selected sliding glass capsule (56dp), Indicator Box in Kotlin
//   - \u5185\u5C42\u80CC\u666F\u677F (Inner backdrop) = hidden 56dp glass captured by tabsBackdrop,
//     tinted blue by ColorFilter.tint(accentColor), sampled by the indicator
//   - \u6807\u7B7E\u5185\u5BB9 (Tab content) = icon + label inside each tab slot
//
// Original: indicator.drawBackdrop(backdrop = rememberCombinedBackdrop(backdrop, tabsBackdrop))
//   - backdrop (outer) = LayerBackdrop = wallpaper (sampled via coverUv)
//   - tabsBackdrop (inner) = hidden Row's 56dp glass, inset 4dp from the
//     indicator's draw area on all sides.
//
// Implementation (mirrors sampleToggleBackdrop):
//   1. Sample wallpaper (outer backdrop) with blur \u2014 same as toggle's outer.
//   2. Composite the scene FBO (uBackdrop = container glass + content)
//      inside an INSET capsule SDF (containerRect shrunk 4dp each side).
//      This is the "smaller background plate" refracted inside the indicator.
vec4 sampleIndicatorBackdrop(vec2 canvasPx, float radius) {
    // 1. Sample wallpaper (outer LayerBackdrop) via coverUv (cover-fit).
    vec4 wp;
    if (radius < 0.5) {
        vec2 uv = coverUv(canvasPx);
        wp = texture2D(uWallpaperSampler, uv);
    } else {
        vec2 uv = coverUv(canvasPx);
        vec2 pxToUv = radius * canvasPxToUvScale();
        vec4 sum = vec4(0.0);
        float total = 0.0;
        sum += texture2D(uWallpaperSampler, uv) * 0.25; total += 0.25;
        sum += texture2D(uWallpaperSampler, uv + vec2( 1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2(-1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000,  1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000, -1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        wp = sum / total;
    }

    // 2. \u5185\u5C42\u80CC\u666F\u677F (Inner backdrop) SDF \u2014 the hidden Row's 56dp glass capsule.
    //    Faithful to LiquidBottomTabs.kt: the hidden Row has NO layerBlock,
    //    so its glass does NOT scale with the container. Only panelOffset
    //    shifts it (translationX = panelOffset).
    vec2 capsuleHalf = max(uContainerRect.zw, vec2(0.0));
    float cr = max(uContainerCornerRadius, 0.0);
    // Center = rectCenter + panelOffset (NO container scale).
    vec2 scaledCenter = uContainerRect.xy + vec2(uIndicatorPanelOffset, 0.0);
    vec2 capsuleLocal = canvasPx - scaledCenter;
    vec2 cq = abs(capsuleLocal) - capsuleHalf + vec2(cr);
    float capsuleSd = length(max(cq, vec2(0.0))) + min(max(cq.x, cq.y), 0.0) - cr;
    // Mask: interpolate between 1.0 (at rest) and smoothstep (when pressed).
    // At rest (progress=0): mask=1.0 \u2014 no separate smoothstep transition at
    // the containerRect boundary, because it overlaps with the indicator's own
    // edge (both 56dp capsules). A second smoothstep here would reveal raw
    // wallpaper at the indicator edge, causing jagged aliasing. With mask=1.0,
    // the indicator always shows the glass scene inside its shape, and edgeAlpha
    // smoothly fades to transparent \u2014 matching the container glass behind it.
    // When pressed (progress=1): restore the original smoothstep mask for the
    // CombinedBackdrop clipping. Refraction displaces samples away from the
    // shared edge, so the smoothstep no longer causes jaggies; and the inner
    // backdrop capsule clip preserves the correct CombinedBackdrop visual
    // (scene inside capsule, wallpaper outside).
    float indicatorAaRadius = max(radius, 1.0);
    float smoothstepMask = 1.0 - smoothstep(-indicatorAaRadius, indicatorAaRadius, capsuleSd);
    float mask = mix(1.0, smoothstepMask, uIndicatorPressProgress);

    // 2b. \u5185\u5C42\u80CC\u666F\u677F shadow (Shadow.Default) \u2014 faithful to LiquidBottomTabs.kt
    //     hidden Row's drawBackdrop: shadow defaults to Shadow.Default when not specified.
    //     Shadow.Default: radius=24dp, offset=DpOffset(0, radius/6=4dp), color=Black@0.1, alpha=1.
    //     In the CombinedBackdrop, the shadow is composited between wallpaper (outer)
    //     and glass body (inner). Through the semi-transparent glass body, this shadow
    //     bleeds through near the capsule edges \u2014 most visible near the top edge where
    //     the shadow offset (0, +4dp) makes those pixels "outside" the shadow capsule
    //     (shadow capsule top = original top + 4dp, so original top is outside it).
    //     Implementation mirrors ShadowModifier.kt:
    //       1. Shift capsule by shadow offset \u2192 shadow shape SDF
    //       2. Gaussian falloff (MaskFilter.makeBlur sigma = radius directly)
    //       3. Mask inside original capsule (ShadowMaskPaint BlendMode.Clear)
    //       4. Darken wallpaper by Black@0.1 \xD7 shadowIntensity
    float shadowOffsetYpx = (24.0 / 6.0) * uDpr; // DpOffset(0, radius/6) in device px
    vec2 shadowLocal = capsuleLocal - vec2(0.0, shadowOffsetYpx);
    vec2 shadowCq2 = abs(shadowLocal) - capsuleHalf + vec2(cr);
    float shadowSd = length(max(shadowCq2, vec2(0.0))) + min(max(shadowCq2.x, shadowCq2.y), 0.0) - cr;
    // Shadow intensity: Gaussian falloff from shadow shape edge.
    // MaskFilter.makeBlur(FilterBlurMode.NORMAL, radius) takes sigma = radius directly.
    float shadowSigma = max(24.0 * uDpr, 1.0); // sigma = 24dp in device px
    float shadowIntensity = 0.5 * exp(-shadowSd * shadowSd / (2.0 * shadowSigma * shadowSigma));
    // Mask shadow inside the original capsule (ShadowMaskPaint BlendMode.Clear
    // removes shadow where the shape itself is drawn, so shadow only appears outside).
    shadowIntensity *= smoothstep(-1.0, 1.0, capsuleSd);
    // Darken wallpaper by Black@0.1 \xD7 shadowIntensity (SrcOver compositing).
    wp.rgb *= (1.0 - shadowIntensity * 0.1);

    // 3. Sample the GLASS LAYER FBO (wallpaper + container glass, NO tab text).
    //    This is a snapshot taken after the container glass is rendered but
    //    before tab-content is drawn \u2014 so it has no white/black text to bleed
    //    through. The blue tab text is drawn on top via fgTexture (step 4).
    vec2 sceneUv2 = sceneUv(canvasPx - vec2(uIndicatorPanelOffset, 0.0));
    vec4 scene = texture2D(uTabsGlassLayer, sceneUv2);

    // 4. Draw blue \u6807\u7B7E\u5185\u5BB9 (tab content: icons/labels) on top of the glass layer.
    //    Use each tab's fgTexture alpha as a hard mask (step) \u2014 pixels inside
    //    the icon/label shape become blue, everything else stays the glass
    //    layer's natural color. No white edges (hard replace, no mix).
    //    Faithful to LiquidBottomTabs.kt: the hidden Row's tab content gets
    //    LocalLiquidBottomTabScale = lerp(1, 1.2, pressProgress) + panelOffset
    //    (NOT the container scale \u2014 the hidden Row is a sibling of the
    //    container, not a child, so the container layerBlock doesn't apply).
    float contentScale = 1.0 + 0.2 * uIndicatorPressProgress;
    float tabMask = 0.0;
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uTabContentCount) break;
        vec4 r = uTabContentRects[i];
        if (r.z > 0.5 && r.w > 0.5) {
            // Tab content scales around its OWN center (not container center)
            // by contentScale, then shifts by panelOffset.
            vec2 tabCenter = r.xy + vec2(uIndicatorPanelOffset, 0.0);
            vec2 scaledHalf = r.zw * contentScale;
            vec2 localPx = canvasPx - (tabCenter - scaledHalf);
            vec2 uv = localPx / (scaledHalf * 2.0);
            if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
                float a = 0.0;
                if (i == 0) a = texture2D(uTabContentTex0, uv).a;
                else if (i == 1) a = texture2D(uTabContentTex1, uv).a;
                else if (i == 2) a = texture2D(uTabContentTex2, uv).a;
                else if (i == 3) a = texture2D(uTabContentTex3, uv).a;
                else if (i == 4) a = texture2D(uTabContentTex4, uv).a;
                else if (i == 5) a = texture2D(uTabContentTex5, uv).a;
                else if (i == 6) a = texture2D(uTabContentTex6, uv).a;
                else if (i == 7) a = texture2D(uTabContentTex7, uv).a;
                tabMask = max(tabMask, a);
            }
        }
    }
    // Use fgTexture alpha directly as the blue compositing factor. fgTexture
    // is LINEAR-filtered so its alpha has smooth AA edges \u2014 no smoothstep
    // threshold needed (which caused jaggies by hard-clipping the AA gradient).
    vec3 sceneColor = mix(scene.rgb, uIndicatorAccent.rgb, tabMask);

    // 5. Composite scene over wallpaper (SrcOver).
    //    At rest (mask\u22481.0): a \u2248 scene.a \u2014 glass scene composited at natural opacity.
    //    When pressed (mask=smoothstep): a = scene.a * mask \u2014 CombinedBackdrop clip.
    float a = scene.a * mask;
    vec3 resultRgb = mix(wp.rgb, sceneColor, a);

    // 6. \u5185\u5C42\u80CC\u666F\u677F rim highlight \u2014 faithful to LiquidBottomTabs.kt hidden Row:
    //    highlight = { Highlight.Default.copy(alpha = progress) }
    //    The HighlightModifier draws a STROKE (width=0.5dp, strokeWidth=2px)
    //    blurred by 0.25dp, clipped inside the capsule, colored by the
    //    DefaultHighlightShaderString AGSL shader:
    //      float2 grad = gradSdRoundedRect(centeredCoord, halfSize, gradRadius);
    //      float2 normal = float2(cos(angle), sin(angle));
    //      float d = dot(grad, normal);
    //      float intensity = pow(abs(d), falloff);
    //      return color * intensity;   // color = White(1.0), alpha=1*progress
    //    with angle=45\xB0, falloff=1, gradRadius = min(radius*1.5, min(halfW, halfH)).
    //    The stroke's outward half (capsuleSd > 0) is clipped, leaving the inner
    //    half. Final contribution = White(1.0) * intensity * strokeMask * progress,
    //    added with Plus blend (additive).
    //    NOTE: this is the SAME as the \u6307\u793A\u5668's own rim highlight (step 2f in
    //    post-passes) \u2014 both use Highlight.Default. The only difference is the
    //    SDF: here it's the \u5185\u5C42\u80CC\u666F\u677F capsule (inset 4dp), there it's the
    //    \u6307\u793A\u5668's own capsule. The shader math is identical.
    //
    //    The stroke mask is now sampled from a pre-rasterized Canvas2D texture
    //    (uInnerStrokeMask) instead of computed analytically (65-tap Gaussian
    //    convolution of a hard-edge stroke band). This gives browser-native Skia
    //    hardware coverage AA \u2014 identical quality to the outer indicator rim
    //    highlight. The Canvas2D pipeline does ctx.clip(path) \u2192 ctx.stroke(path)
    //    \u2192 ctx.filter=blur, which naturally removes the outer half and provides
    //    sub-pixel AA. No per-pixel SDF loops, no smoothstep clipAA needed.
    float highlightAlpha = uIndicatorPressProgress;
    if (highlightAlpha > 0.001) {
        // SDF gradient + Default highlight intensity (angle=45\xB0, falloff=1).
        // This part is identical to the AGSL DefaultHighlightShaderString.
        float indRadius = max(cr, 0.0);
        float indHalfMin = min(capsuleHalf.x, capsuleHalf.y);
        float gradRadius = min(indRadius * 1.5, indHalfMin);
        vec2 grad = gradSdRoundedRect(capsuleLocal, capsuleHalf, gradRadius);
        vec2 normal = vec2(0.70710678, 0.70710678); // cos(45\xB0), sin(45\xB0)
        float d = dot(grad, normal);
        float intensity = pow(abs(d), 1.0);

        // Sample the pre-rasterized Canvas2D stroke mask texture.
        // UV mapping: capsuleLocal (centered, -halfW..+halfW) \u2192 element-local
        // (0..2*halfW) by adding capsuleHalf \u2192 add margin offset \u2192 divide
        // by maskSize. This is the same convention as the outer indicator
        // stroke mask (STROKE_MASK_COMPOSITE_FRAGMENT_SHADER).
        vec2 innerLocal = capsuleLocal + capsuleHalf;
        vec2 innerMaskUv = (innerLocal + uInnerStrokeMaskOffset) / uInnerStrokeMaskSize;
        // Bounds check \u2014 discard samples outside the mask texture.
        float innerMask = 0.0;
        if (innerMaskUv.x >= 0.0 && innerMaskUv.x <= 1.0 &&
            innerMaskUv.y >= 0.0 && innerMaskUv.y <= 1.0) {
            innerMask = texture2D(uInnerStrokeMask, innerMaskUv).a;
        }

        // White(0.5) * intensity * innerMask * progress, Plus blend (additive).
        // Faithful to HighlightStyle.Default: color = White.copy(alpha=0.5f).
        // The AGSL shader uses this 0.5 alpha, NOT color.copy(alpha=1f).
        // Same fix as DEFAULT_HIGHLIGHT.alpha = 0.5 (was previously 1.0).
        // No clipAA needed \u2014 the Canvas2D clip(path) before stroke already removes
        // the outer half, and Skia hardware coverage provides AA.
        resultRgb += vec3(0.5) * intensity * innerMask * highlightAlpha;
    }

    return vec4(resultRgb, 1.0);
}

// Magnifier backdrop sampling \u2014 faithful to MagnifierContent.kt's
// onDrawBackdrop: withTransform({ scale(1.5); translate(top=-80dp) }, drawBackdrop).
// Zoom around the magnifier center, then offset Y toward cursor.
vec4 sampleMagnifier(vec2 canvasPx, float radius) {
    vec2 magCenter = uElementOffset + uElementSize * 0.5;
    vec2 zoomedCoord = magCenter + (canvasPx - magCenter) / uMagnifierZoom;
    vec2 cursorCoord = vec2(zoomedCoord.x, zoomedCoord.y + uMagnifierOffsetY);
    return sampleBackdrop(cursorCoord, radius);
}

// colorControls \u2014 exact port of ColorFilter.kt colorControlsColorFilter.
// saturation 1.5, brightness 0, contrast 1 -> pure saturation boost.
vec3 applyColorControls(vec3 c, float brightness, float contrast, float saturation) {
    float invSat = 1.0 - saturation;
    float r = 0.213 * invSat;
    float g = 0.715 * invSat;
    float b = 0.072 * invSat;
    float t = (0.5 - contrast * 0.5 + brightness) * 255.0;
    float cs = contrast * saturation;
    float cr = contrast * r;
    float cg = contrast * g;
    float cb = contrast * b;
    vec3 outc;
    outc.r = (cr + cs) * c.r + cg * c.g + cb * c.b + t / 255.0;
    outc.g = cr * c.r + (cg + cs) * c.g + cb * c.b + t / 255.0;
    outc.b = cr * c.r + cg * c.g + (cb + cs) * c.b + t / 255.0;
    return outc;
}

// --- HSV conversion + BlendMode.Hue ---------------------------
// Faithful port of Skia's BlendMode.Hue (non-separable blend).
// Hue blend: result takes hue from src, saturation+value from dst.
// Used by drawRect(tint, BlendMode.Hue) in onDrawSurface.
vec3 rgb2hsv(vec3 c) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float delta = maxC - minC;
    float v = maxC;
    float s = maxC < 1e-6 ? 0.0 : delta / maxC;
    float h = 0.0;
    if (delta > 1e-6) {
        if (maxC == c.r) {
            h = mod((c.g - c.b) / delta, 6.0);
        } else if (maxC == c.g) {
            h = (c.b - c.r) / delta + 2.0;
        } else {
            h = (c.r - c.g) / delta + 4.0;
        }
        h *= 60.0;
        if (h < 0.0) h += 360.0;
    }
    return vec3(h / 360.0, s, v);
}

vec3 hsv2rgb(vec3 c) {
    float h = c.x * 6.0;
    float s = c.y;
    float v = c.z;
    float i = floor(h);
    float f = h - i;
    float p = v * (1.0 - s);
    float q = v * (1.0 - s * f);
    float t = v * (1.0 - s * (1.0 - f));
    i = mod(i, 6.0);
    if (i < 1.0) return vec3(v, t, p);
    if (i < 2.0) return vec3(q, v, p);
    if (i < 3.0) return vec3(p, v, t);
    if (i < 4.0) return vec3(p, q, v);
    if (i < 5.0) return vec3(t, p, v);
    return vec3(v, p, q);
}

// HSL \u2192 RGB. Input: h in [0,1] (hue/360), s in [0,1], l in [0,1].
// Unlike HSV (where V=1 gives the pure hue color), HSL with L=1 gives
// WHITE and L=0 gives BLACK \u2014 so the 'lightness' slider behaves like a
// proper brightness control: 1 = white, 0.5 = pure color, 0 = black.
// L=0.5 + S=1 is the pure hue; S=0 makes it a grayscale by L.
vec3 hsl2rgb(vec3 c) {
    float h = c.x;
    float s = c.y;
    float l = c.z;
    if (s < 0.001) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    float r = clamp(abs(mod(h * 6.0 + 0.0, 6.0) - 3.0) - 1.0, 0.0, 1.0);
    float g = clamp(abs(mod(h * 6.0 + 2.0, 6.0) - 3.0) - 1.0, 0.0, 1.0);
    float b = clamp(abs(mod(h * 6.0 + 4.0, 6.0) - 3.0) - 1.0, 0.0, 1.0);
    r = p + (q - p) * r;
    g = p + (q - p) * g;
    b = p + (q - p) * b;
    return vec3(r, g, b);
}

// BlendMode.Hue: take hue from src, sat+val from dst.
vec3 blendHue(vec3 dst, vec3 src) {
    vec3 dh = rgb2hsv(dst);
    vec3 sh = rgb2hsv(src);
    return hsv2rgb(vec3(sh.x, dh.y, dh.z));
}
`
    );
  }
  var DEFAULT_BLUR_TAPS;
  var init_element_utils = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/element-utils.ts"() {
      "use strict";
      DEFAULT_BLUR_TAPS = 16;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/element.ts
  function generateElementFragmentShader(tapCount = DEFAULT_BLUR_TAPS) {
    const utilsGlsl = generateElementUtilsGLSL(tapCount);
    return (
      /* glsl */
      `
precision highp float;

${ELEMENT_UNIFORMS_GLSL}

${SDF_GLSL}

${COVER_GLSL}

${utilsGlsl}

void main() {
    // --- Coordinate reconstruction ---
    // Two paths: PEF (elFbo at BASELINE resolution) vs ping-pong (fullscreen).
    //
    // PEF path: elFbo is at baseline (origW*dpr + pad), NOT scaled by zoom.
    // gl_FragCoord ranges over [0, uElFboSize]. We compute:
    //   1. centeredOrigRot \u2014 un-rotated original-space coord (for SDF)
    //   2. screenCoord \u2014 rotated+scaled canvas position (for backdrop sampling)
    // The elFbo contains UN-ROTATED glass; rotation is applied at composite.
    // Backdrop sampling still needs the correct (rotated) screen position.
    //
    // Ping-pong path: fullscreen, rotation baked in shader (legacy).
    vec2 screenCoord;
    vec2 centeredOrigRot;  // un-rotated original-space coord for SDF
    vec2 elementCenter = uElementOffset + uElementSize * 0.5;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    float rot = uElementRotation;

    if (uUsePerElementFbo > 0.5) {
        // elFbo fragment \u2192 centered local coord (Y-down, elFbo px)
        vec2 fboCenter = uElFboSize * 0.5;
        vec2 localUp = gl_FragCoord.xy - fboCenter;  // Y-up (gl_FragCoord BL origin)
        vec2 localDown = vec2(localUp.x, -localUp.y);  // Y-down (top-left origin)
        // Scale elFbo px \u2192 original px (accounts for AA pad: elFbo > origSize)
        vec2 origScale = uOriginalSize / uElFboSize;
        centeredOrigRot = localDown * origScale;  // un-rotated original space
        // Map to screen for backdrop sampling. When rot\u22480 (common case), skip
        // rotateBy entirely (4 mul + cos/sin per fragment saved). When rot\u22600,
        // apply rotation to map local-space coord to screen-space sample point.
        if (abs(rot) > 0.001) {
            screenCoord = elementCenter + rotateBy(centeredOrigRot, rot) * layerScale;
        } else {
            screenCoord = elementCenter + centeredOrigRot * layerScale;
        }
    } else {
        // Ping-pong: fullscreen, rotation in shader (legacy path)
        screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
        vec2 centeredScreen = screenCoord - elementCenter;
        vec2 centeredOrig = centeredScreen / layerScale;
        if (abs(rot) > 0.001) {
            centeredOrigRot = rotateBy(centeredOrig, -rot);
        } else {
            centeredOrigRot = centeredOrig;
        }
    }

    // Content scale (non-uniform): when < 1.0, compress the backdrop UV toward
    // the element center. Faithful to LiquidToggle.kt / LiquidSlider.kt.
    vec2 contentScale = vec2(uContentScaleX, uContentScaleY);
    vec2 sampleCoord = screenCoord;
    if (uContentScaleX < 0.999 || uContentScaleY < 0.999) {
        sampleCoord = elementCenter + (screenCoord - elementCenter) * contentScale;
    }

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // --- SDF-texture glass path (faithful to SdfShader.kt) ---
    if (uUseSdfTexture > 0.5) {
        vec2 localPx = centeredOrigRot + uOriginalSize * 0.5;
        vec4 sdfData = sampleSdfTexture(localPx);
        if (sdfData.y <= 0.0) discard;
        float intensity = sdfData.x;
        float sdfMask = sdfData.y;
        vec2 normal = sdfData.zw;

        // --- Raw SDF debug render -----------------------------------
        // Bypass all glass effects and output the SDF texture's R channel
        // directly as grayscale. Inside (sd<0) \u2192 white, edge (sd=0) \u2192 0.5,
        // outside (sd>0) \u2192 black. The A channel is preserved for AA. This
        // makes SDF quality / padding / aliasing directly visible \u2014 useful
        // when tuning DPR-adapted generation or highlight scale.
        if (uSdfDebugMode > 0.5) {
            vec2 uv = vec2(localPx.x / uOriginalSize.x,
                           localPx.y / uOriginalSize.y);
            vec4 v = texture2D(uSdfTexSampler, uv);
            // Decode R back to [-1,1]: negative = inside, positive = outside.
            float sd = v.r * 2.0 - 1.0;
            // Map sd \u2208 [-1, 1] \u2192 gray \u2208 [1, 0] (inside white, outside black).
            float gray = clamp(0.5 - sd * 0.5, 0.0, 1.0);
            // Overlay the normal as a faint RGB tint (so gradient direction is
            // visible). Multiplied by 0.15 so it doesn't swamp the gray.
            vec3 normalTint = vec3(v.g * 2.0 - 1.0, v.b * 2.0 - 1.0, 0.0) * 0.15;
            vec3 dbg = vec3(gray) + normalTint;
            // Use the same AA range as the non-debug path so the debug view
            // shows the real edge quality (not a hard threshold).
            float mask = smoothstep(uSdfAaMin, 1.0, v.a);
            float coverage = mask * uEnterAlpha;
            gl_FragColor = vec4(dbg * coverage, coverage);
            return;
        }

        // Compute the refracted sampling coordinate (SDF displacement).
        // Normal inward refraction: sample the backdrop toward the text
        // center (screenCoord - offset), offset = intensity * uRefractionHeight * normal.
        // \u5411\u53CD\u6298\u5C04 (uSdfOuterRefraction): REVERSE the direction (sample
        // outward, away from text center via screenCoord + offset) AND DOUBLE
        // the distance (offset * 2). The offset magnitude and intensity field
        // are unchanged \u2014 only the sign flips and the distance scales by 2.
        vec2 refractedOffsetOrig = intensity * uRefractionHeight * normal;
        vec2 refractedOffsetScreen = refractedOffsetOrig * layerScale;
        float refractSign = 1.0;
        float refractDistMul = 1.0;
        if (uSdfOuterRefraction > 0.5) {
            refractSign = -1.0;   // flip direction: + becomes -, - becomes +
            refractDistMul = 2.0; // double the distance
        }
        vec2 refractedScreen = screenCoord - refractSign * refractDistMul * refractedOffsetScreen;

        // Faithful to SdfShader.kt: color = content.eval(refractedCoord) * v.a
        // The content is the wallpaper after colorControls + blur(2dp).
        // FAITHFUL ORDERING: the original's onDrawBackdrop draws the wallpaper
        // AND drawRect(White 0.25) into the same buffer, THEN applies the
        // RenderEffect chain (colorControls, blur, SDF shader). So the white
        // overlay is PART of the SDF shader content input, and colorControls
        // is applied to the COMBINED (wallpaper + white) buffer.
        // We replicate: mix white into raw wallpaper FIRST, then apply
        // colorControls \u2014 so colorControls darkens the white too (matching
        // the original where contrast=0.75, brightness=-0.1 dims the white).
        //
        // TWO BACKDROP PATHS (adapted to global 2-pass blur):
        //   1. uSampleWallpaper > 0.5 (default / global-blur-OFF):
        //      Sample the WALLPAPER directly (uWallpaperSampler via coverUv)
        //      with inline poisson-disc blur (uBlurRadius). Faithful to the
        //      original's LayerBackdrop + blur(2dp).
        //   2. uSampleWallpaper < 0.5 (global-blur-ON, resolveBackdropTex has
        //      pre-blurred the cover-fitted wallpaper into uBackdrop):
        //      Sample uBackdrop via sceneUv with NO inline blur (it's already
        //      blurred by the 2-pass Gaussian pipeline). This adapts the SDF
        //      glass to the global separable blur setting, so the TextGlass
        //      respects blurDownsample / blurTapCap / dynamicBlurDownsample
        //      just like every other glass element. The cover-fitted wallpaper
        //      was rendered into wallpaperBlurFbo (canvas-sized) then 2-pass
        //      blurred, so sceneUv(refractedScreen) maps correctly.
        vec4 content;
        if (uSampleWallpaper > 0.5) {
            content = sampleWallpaperBlurred(refractedScreen, uBlurRadius);
        } else {
            content = sampleBackdrop(refractedScreen, 0.0);
        }
        vec3 rawContent = content.rgb;
        // Mix in white overlay (White 0.25 SrcOver) on RAW wallpaper first.
        if (uSurfaceColor.a > 0.001) {
            rawContent = uSurfaceColor.rgb * uSurfaceColor.a + rawContent * (1.0 - uSurfaceColor.a);
        }
        // THEN apply colorControls to the combined buffer.
        vec3 contentColor = applyColorControls(rawContent, uBrightness, uContrast, uSaturation);
        // Multiply by sdfMask (v.a) \u2014 faithful to content * v.a.
        vec3 color = contentColor * sdfMask;

        // Edge matte helpers \u2014 computed PER LAYER so each can be tuned
        // independently via uSdfEdgeMatte{Bevel,Tint,Base}Params. The base
        // edge factor is intensity (1 at the text boundary, \u21920 interior).
        // Per-layer params (vec2 = range, min) shape that into the final
        // matte weight:
        //   edge = clamp(intensity / max(range, 0.001), 0, 1) * (1 - min) + min
        //   range (0..1): how far the matte extends inward. 1 = full fade
        //     across the whole intensity field (original behavior); 0.5 =
        //     full strength by intensity=0.5 then flat (narrower rim); small
        //     = very thin matte line.
        //   min (0..1): floor matte amount in the deep interior. 0 = interior
        //     clear; 0.3 = interior always \u226530% matte.
        // bit 0 = bevel (\u5149\u5F71), bit 1 = tint (\u67D3\u8272), bit 2 = base (\u6298\u5C04/\u5E95\u8272).
        // When the overall uSdfEdgeMatteEnabled is OFF, no matte is applied
        // regardless of the bitmask. Faithful to "\u54D1\u5149\u5C42\u53EF\u4EE5\u8C03\u662F\u5426\u4F5C\u7528\u4E8E\u67D0\u4E9B\u5C42"
        // + "\u7ED9\u54D1\u5149\u6BCF\u5C42\u52A0\u4E0A\u4F5C\u7528\u53C2\u6570\u8C03\u8282\uFF0C\u6BD4\u5982\u8303\u56F4\uFF0C\u6700\u5C0F\u503C".
        float matteStrength = 0.65;   // desaturate toward luminance
        float matteDarken = 0.18;     // darken
        bool matteOn = uSdfEdgeMatteEnabled > 0.5;
        // bit 0 (bevel/\u63D0\u4EAE): targets mod 2. The previous code used
        // (targets - 8.0 * floor(targets / 8.0)) which is targets mod 8 \u2014
        // that returns a non-zero value for ANY non-zero targets (1..7), so
        // the bevel matte was ALWAYS on whenever matteOn was true, regardless
        // of whether bit 0 was actually set. This made the bevel matte toggle
        // ineffective \u2014 turning off bit 0 (bevel) still left the bevel matte
        // active. Fixed to use targets mod 2 which correctly extracts ONLY
        // bit 0.
        float t1 = floor(uSdfEdgeMatteTargets / 1.0);  // = targets
        bool matteBevel = matteOn && (t1 - 2.0 * floor(t1 / 2.0)) >= 1.0;
        // bit 1 (tint): floor(targets/2) mod 2
        float t2 = floor(uSdfEdgeMatteTargets / 2.0);
        bool matteTint = matteOn && (t2 - 2.0 * floor(t2 / 2.0)) >= 1.0;
        // bit 2 (base): floor(targets/4) mod 2
        float t4 = floor(uSdfEdgeMatteTargets / 4.0);
        bool matteBase = matteOn && (t4 - 2.0 * floor(t4 / 2.0)) >= 1.0;
        // bit 3 (brighten/\u63D0\u4EAE): floor(targets/8) mod 2. The brighten layer
        // is the overall brightness increment (uBrightness from the \u63D0\u4EAE
        // slider). When matteBrighten is true, the edge is pulled back toward
        // the pre-brightness rawContent \u2014 i.e. the edge gets LESS brightening
        // than the interior, producing a matte rim on the brightness layer.
        float t8 = floor(uSdfEdgeMatteTargets / 8.0);
        bool matteBrighten = matteOn && (t8 - 2.0 * floor(t8 / 2.0)) >= 1.0;
        // Per-layer matte edge factor \u2014 shaped by (range, min) params.
        float matteEdgeBase = clamp(intensity / max(uSdfEdgeMatteBaseParams.x, 0.001), 0.0, 1.0)
            * (1.0 - uSdfEdgeMatteBaseParams.y) + uSdfEdgeMatteBaseParams.y;
        // Brighten layer edge factor \u2014 shaped by the BRIGHTEN layer's params.
        float matteEdgeBrighten = clamp(intensity / max(uSdfEdgeMatteBrightenParams.x, 0.001), 0.0, 1.0)
            * (1.0 - uSdfEdgeMatteBrightenParams.y) + uSdfEdgeMatteBrightenParams.y;
        // Bevel / tint edge factors computed where they're used (below).

        // --- Brighten layer matte (bit 3) ---
        // \u63D0\u4EAE\u54D1\u5149: the brighten (uBrightness) amount is ATTENUATED at the
        // edge by edgeFactor \xD7 strength. So the edge gets LESS brightening
        // than the interior \u2014 a PURE brightness cut at the rim, NOT
        // desaturation. We re-apply colorControls with an attenuated
        // brightness (full interior \u2192 0 at edge when s=1); contrast +
        // saturation stay fully applied everywhere (NO saturation cut).
        // Faithful to "\u4E3A\u4EC0\u4E48\u4F1A\u540C\u65F6\u524A\u51CF\u9971\u548C\u5EA6\u5C42" \u2014 fixed: only brightness is
        // cut, saturation + contrast untouched.
        if (matteBrighten) {
            float s = uSdfEdgeMatteBrightenStrength;
            float attBrightness = uBrightness * (1.0 - matteEdgeBrighten * s);
            vec3 attenuated = applyColorControls(rawContent, attBrightness, uContrast, uSaturation);
            color.rgb = attenuated * sdfMask;
        }

        // --- Base layer matte (bit 2) ---
        // Desaturate + darken the base refraction/body color at the edge.
        // Strength scales both the desaturate and darken amounts.
        if (matteBase) {
            float s = uSdfEdgeMatteBaseStrength;
            float lum = dot(color.rgb, vec3(0.213, 0.715, 0.072));
            color.rgb = mix(color.rgb, vec3(lum), matteEdgeBase * matteStrength * s);
            color.rgb *= 1.0 - matteEdgeBase * matteDarken * s;
        }

        // Bevel lighting \u2014 gated by uSdfBevelEnabled so the TextGlass "\u5149\u5F71"
        // toggle can turn the light/shadow layer off WITHOUT zeroing
        // uSdfHighlightScale (which would also kill the refraction, since
        // intensity drives both). When bevel is off, the glass still refracts
        // the backdrop using the thickness slider's value \u2014 only the edge
        // brightness highlight is removed. The base dim is handled separately
        // via uBrightness on the JS side.
        // The bevel highlight is always pure white (no dye) \u2014 the whole-glass
        // tint (uSdfGlassTintHue) is applied separately below and affects the
        // ENTIRE glass body, not just the bevel band.
        // Edge matte (bit 0): when matteBevel is true, TWO visible effects
        // happen at the bevel band's edge, BOTH scaled by bevelMatteS (the
        // per-layer strength slider) so the user can actually SEE the matte
        //\u8C03\u8282:
        //   1. Weaken the bevel brightening (less shiny highlight at edge).
        //   2. APPLY a desaturate + darken to the color at the edge \u2014 this
        //      produces the visible frosted/matte rim. Without this, a small
        //      bevel value (e.g. 0.32) makes the weakening nearly invisible,
        //      so the strength slider appeared to "do nothing". Now both
        //      effects are driven by the same strength so the slider is
        //      always visually responsive.
        // The edge factor is shaped by the BEVEL layer's (range, min) params.
        float matteEdgeBevel = clamp(intensity / max(uSdfEdgeMatteBevelParams.x, 0.001), 0.0, 1.0)
            * (1.0 - uSdfEdgeMatteBevelParams.y) + uSdfEdgeMatteBevelParams.y;
        // Bevel matte strength \u2014 scales BOTH the weakening and the matte rim.
        float bevelMatteS = uSdfEdgeMatteBevelStrength;
        if (uSdfBevelEnabled > 0.5) {
            float angleRad = uSdfLightAngle * 3.1415926 / 180.0;
            vec2 lightDir = vec2(cos(angleRad), sin(angleRad));
            float bevel1 = clamp(dot(normal, lightDir), 0.0, 1.0);
            float bevel1Amt = 0.5 * intensity * bevel1;
            if (matteBevel) {
                // (1) Weaken the bevel brightening at the edge.
                bevel1Amt *= 1.0 - matteEdgeBevel * (matteStrength + matteDarken) * bevelMatteS;
            }
            color.rgb *= 1.0 + bevel1Amt;
            float bevel2 = clamp(dot(normal, -lightDir), 0.0, 1.0);
            float bevel2Amt = 0.5 * bevel2 * min(1.0, smoothstep(1.0, 0.0, abs(intensity - 0.25) * 6.0));
            if (matteBevel) {
                bevel2Amt *= 1.0 - matteEdgeBevel * (matteStrength + matteDarken) * bevelMatteS;
            }
            color.rgb *= 1.0 + bevel2Amt;
            // (2) APPLY the matte rim: desaturate toward luminance + darken at
            // the edge. This is the VISIBLE matte effect on the bevel layer \u2014
            // without it the strength slider had no visible feedback when the
            // bevel value was small. Faithful to "\u6211\u8981\u80FD\u8C03\u63D0\u4EAE\u5C42\u7684\u54D1\u5149".
            if (matteBevel) {
                float lum = dot(color.rgb, vec3(0.213, 0.715, 0.072));
                color.rgb = mix(color.rgb, vec3(lum), matteEdgeBevel * matteStrength * bevelMatteS);
                color.rgb *= 1.0 - matteEdgeBevel * matteDarken * bevelMatteS;
            }
        }

        // Whole-glass tint (\u67D3\u8272) \u2014 gated by uSdfGlassTintEnabled master switch.
        // Two stages, both using the same hue:
        //   1. Color-mix filter (\u67D3\u8272\u524D\u6EE4\u955C): mixes the glass body toward the
        //      pure saturated hue color by uSdfGlassTintMix amount (SrcOver-
        //      style blend toward a solid color). This is a "color mix" filter
        //      \u2014 distinct from the hue-dye. 0 = skip; 1 = full color overlay.
        //   2. Hue-dye: applies BlendMode.Hue (Skia non-separable Hue blend) at
        //      uSdfGlassTintStrength (default 0.85, adjustable) \u2014 takes hue from
        //      the tint source, keeps the glass's own saturation + value. So a
        //      dyed glass still looks like glass (luminance/sat preserved) just
        //      tinted. The strength slider lets the user tune how strong the
        //      dye is (0 = no dye, 1 = full hue replacement).
        // Both stages apply to the ENTIRE glass body (not just the bevel band).
        // Independent of the \u5149\u5F71 (bevel) toggle.
        // Edge matte (bit 1): when matteTint is true, the tint's blend factor
        // is reduced at the edge \u2014 the rim keeps more of the desaturated base
        // color instead of the dyed hue, so the edge looks matte while the
        // interior stays fully dyed. The edge factor is shaped by the TINT
        // layer's (range, min) params.
        float matteEdgeTint = clamp(intensity / max(uSdfEdgeMatteTintParams.x, 0.001), 0.0, 1.0)
            * (1.0 - uSdfEdgeMatteTintParams.y) + uSdfEdgeMatteTintParams.y;
        // Tint matte strength \u2014 scales how much the tint is suppressed at edge.
        float tintMatteS = uSdfEdgeMatteTintStrength;
        if (uSdfGlassTintEnabled > 0.5) {
            vec3 tintSrc = hsl2rgb(vec3(uSdfGlassTintHue / 360.0, uSdfGlassTintSaturation, uSdfGlassTintLightness));
            // Stage 1: color-mix filter (before hue-dye).
            if (uSdfGlassTintMix > 0.001) {
                float mixAmt = uSdfGlassTintMix;
                if (matteTint) {
                    mixAmt *= 1.0 - matteEdgeTint * matteStrength * tintMatteS;
                }
                color.rgb = mix(color.rgb, tintSrc, mixAmt);
            }
            // Stage 2: hue-dye (BlendMode.Hue at uSdfGlassTintStrength).
            // The dye strength is now adjustable (default 0.85, matching the
            // original's hardcoded constant). 0 = no hue-dye; 1 = full hue
            // replacement. Faithful to "\u52A0\u4E00\u4E2A\u8C03\u67D3\u8272\u5F3A\u5EA6\u7684".
            vec3 hueBlended = blendHue(color, tintSrc);
            float tintMix = uSdfGlassTintStrength;
            if (matteTint) {
                tintMix *= 1.0 - matteEdgeTint * matteStrength * tintMatteS;
            }
            color.rgb = mix(color.rgb, hueBlended, tintMix);
        }

        // NOTE: the old unconditional edge-matte block (which applied a single
        // global desaturate+darken to the composited color) has been replaced
        // by the per-layer matte applications above (base / bevel / tint),
        // each gated by its bit in uSdfEdgeMatteTargets.

        // PREMULTIPLIED output: RGB = color * coverage, A = coverage.
        // 'color' already includes '* sdfMask' (line above), so we only need
        // to also factor in uEnterAlpha to keep RGB and A consistent.
        // Premultiplied storage is REQUIRED for the elFbo: its texture uses
        // LINEAR filtering, and bilinear interpolation of non-premultiplied
        // alpha darkens RGB at the coverage boundary (the classic
        // "non-premult + bilinear" artifact that produces a dark fringe).
        // The composite pass then uses premult SrcOver (ONE, ONE_MINUS_SRC_ALPHA).
        float sdfCoverage = sdfMask * uEnterAlpha;
        gl_FragColor = vec4(color * uEnterAlpha, sdfCoverage);
        return;
    }

    // SDF for refraction/highlight \u2014 sdShape() dispatches to the G2 SDF
    // texture (sampleClipSdf) when uUseContinuousSdf=1 AND
    // uNoContinuousSdfInRefraction=0, else the analytic sdRoundedRect.
    float sd = sdShape(centeredOrigRot, origHalfSize, origRadius);
    // Clip + edgeAA: alpha mask (browser-native AA) when capsule enabled.
    float edgeAlpha;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredOrigRot, origHalfSize, origRadius);
        if (mask < 0.01) discard;
        edgeAlpha = mask;
    } else {
        if (sd > 0.5) discard;
        edgeAlpha = 1.0 - smoothstep(-0.5, 0.5, sd);
    }

    // --- 1. Backdrop sample (before refraction) -------------------
    // Use sampleCoord (content-scaled) so the backdrop shrinks inward when
    // uContentScaleX/Y < 1.0 (toggle/slider knob press effect).
    vec4 backdrop;
    if (uIndicatorBackdrop > 0.5) {
        backdrop = sampleIndicatorBackdrop(screenCoord, uBlurRadius);
    } else if (uUseToggleBackdrop > 0.5) {
        backdrop = sampleToggleBackdrop(screenCoord, uBlurRadius);
    } else if (uUseMagnifier > 0.5) {
        backdrop = sampleMagnifier(screenCoord, uBlurRadius);
    } else {
        backdrop = sampleBackdrop(sampleCoord, uBlurRadius);
    }
    // colorControls: for backdropFbo+useSeparableBlur elements, cc was already
    // applied as a fullscreen pass BEFORE the 2-pass blur (uSkipColorControls=1),
    // matching the original's colorControls\u2192blur order. Skip here to avoid
    // double-applying. For inline-blur elements, apply here.
    vec3 color = (uSkipColorControls > 0.5) ? backdrop.rgb : applyColorControls(backdrop.rgb, uBrightness, uContrast, uSaturation);
    // Magnifier glass is always OPAQUE \u2014 faithful to the original which
    // samples rememberCombinedBackdrop (wallpaper + content + cursor all
    // composited onto the opaque wallpaper). The port's scene texture may
    // carry partial alpha (e.g. card 0.9), which would make the glass
    // translucent. Force alpha=1 for magnifier.
    float alpha = (uUseMagnifier > 0.5) ? 1.0 : backdrop.a;

    // --- 2. Lens refraction (SDF + circleMap) ---------------------
    // Faithful port of RoundedRectRefractionWithDispersionShaderString.
    // SDF/grad computed in ORIGINAL space; uRefractionHeight/Amount are in
    // original px (NOT scaled by layerScale \u2014 the original AGSL shader receives
    // the original size and the graphicsLayer scales the OUTPUT, not the params).
    // Early-out: if we're deeper than refractionHeight from the edge,
    // skip refraction entirely (the lens doesn't reach here).
    if (uRefractionHeight > 0.5 && (-sd) < uRefractionHeight) {
        float sdClamped = min(sd, 0.0);
        float d = circleMap(1.0 - (-sdClamped) / uRefractionHeight) * uRefractionAmount;

        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        // AGSL: normalize(grad + depthEffect * normalize(centeredCoord))
        vec2 depthVec = vec2(0.0);
        if (uDepthEffect > 0.5) {
            float dirLen = length(centeredOrigRot);
            if (dirLen > 1e-6) depthVec = centeredOrigRot / dirLen;
        }
        vec2 gradSum = grad + uDepthEffect * depthVec;
        float gradLen = length(gradSum);
        if (gradLen > 1e-6) grad = gradSum / gradLen;

        // Refraction offset in ORIGINAL space, then map to SCREEN space.
        //   offset_orig = d * grad          (original px)
        //   offset_screen = offset_orig * layerScale  (screen px, for sampling)
        // Faithful to: AGSL computes offset in original space, then graphicsLayer
        // scales the rendered output \u2014 so a pixel at original position p samples
        // the backdrop at p + offset_orig, and the result appears at screen
        // position center + p*layerScale. The backdrop sample position in screen
        // space is therefore center + (p + offset_orig)*layerScale
        // = screenCoord + offset_orig * layerScale.
        vec2 refractedOffsetOrig = d * grad;
        // Rotate the local-space offset BACK to screen space (by +rotation),
        // then scale by layerScale. Without the rotation, refraction points
        // in the wrong direction when the element is rotated.
        vec2 refractedOffsetScreen = rotateBy(refractedOffsetOrig, rot) * layerScale;
        vec2 refractedScreen = screenCoord + refractedOffsetScreen;
        vec2 refractedSampleCoord = refractedScreen;
        if (uIndicatorBackdrop < 0.5 && uUseToggleBackdrop < 0.5 &&
            (uContentScaleX < 0.999 || uContentScaleY < 0.999)) {
            refractedSampleCoord = elementCenter + (refractedScreen - elementCenter) * contentScale;
        }

        if (uChromaticAberration > 0.5) {
            // Faithful 7-path chromatic dispersion (ROYGBV + purple).
            // Original AGSL: dispersionIntensity = chromaticAberration * (cx*cy)/(hx*hy)
            //                dispersedCoord = d * grad * dispersionIntensity
            // 7 samples at dispersedCoord * {1, 2/3, 1/3, 0, -1/3, -2/3, -1}
            // with weighted channel accumulation.
            float dispersionIntensity = 1.0 * ((centeredOrigRot.x * centeredOrigRot.y) / (origHalfSize.x * origHalfSize.y));
            vec2 dispersedOffsetOrig = refractedOffsetOrig * dispersionIntensity;
            vec2 dispersedOffsetScreen = rotateBy(dispersedOffsetOrig, rot) * layerScale;

            // Sample helper \u2014 pick the right backdrop sampler.
            #define SAMPLE_DISPERSED(offset)                 (uIndicatorBackdrop > 0.5 ? sampleIndicatorBackdrop(refractedScreen + (offset), uBlurRadius) :                  uUseToggleBackdrop > 0.5 ? sampleToggleBackdrop(refractedScreen + (offset), uBlurRadius) :                  uUseMagnifier > 0.5 ? sampleMagnifier(refractedScreen + (offset), uBlurRadius) :                  sampleBackdrop(refractedSampleCoord + (offset), uBlurRadius))

            vec4 sRed    = SAMPLE_DISPERSED(+dispersedOffsetScreen);
            vec4 sOrange = SAMPLE_DISPERSED(+dispersedOffsetScreen * (2.0 / 3.0));
            vec4 sYellow = SAMPLE_DISPERSED(+dispersedOffsetScreen * (1.0 / 3.0));
            vec4 sGreen  = SAMPLE_DISPERSED(vec2(0.0));
            vec4 sCyan   = SAMPLE_DISPERSED(-dispersedOffsetScreen * (1.0 / 3.0));
            vec4 sBlue   = SAMPLE_DISPERSED(-dispersedOffsetScreen * (2.0 / 3.0));
            vec4 sPurple = SAMPLE_DISPERSED(-dispersedOffsetScreen);

            #undef SAMPLE_DISPERSED

            // Faithful channel weighting from the original AGSL shader.
            vec3 dispColor = vec3(0.0);
            float dispAlpha = 0.0;
            // red
            dispColor.r += sRed.r / 3.5;
            dispAlpha  += sRed.a / 7.0;
            // orange
            dispColor.r += sOrange.r / 3.5;
            dispColor.g += sOrange.g / 7.0;
            dispAlpha  += sOrange.a / 7.0;
            // yellow
            dispColor.r += sYellow.r / 3.5;
            dispColor.g += sYellow.g / 3.5;
            dispAlpha  += sYellow.a / 7.0;
            // green
            dispColor.g += sGreen.g / 3.5;
            dispAlpha  += sGreen.a / 7.0;
            // cyan
            dispColor.g += sCyan.g / 3.5;
            dispColor.b += sCyan.b / 3.0;
            dispAlpha  += sCyan.a / 7.0;
            // blue
            dispColor.b += sBlue.b / 3.0;
            dispAlpha  += sBlue.a / 7.0;
            // purple
            dispColor.r += sPurple.r / 7.0;
            dispColor.b += sPurple.b / 3.0;
            dispAlpha  += sPurple.a / 7.0;

            color = (uSkipColorControls > 0.5) ? dispColor : applyColorControls(dispColor, uBrightness, uContrast, uSaturation);
            // Magnifier chromatic aberration also forces opaque.
            alpha = (uUseMagnifier > 0.5) ? 1.0 : dispAlpha;
        } else {
            vec4 refracted;
            if (uIndicatorBackdrop > 0.5) {
                refracted = sampleIndicatorBackdrop(refractedScreen, uBlurRadius);
            } else if (uUseToggleBackdrop > 0.5) {
                refracted = sampleToggleBackdrop(refractedScreen, uBlurRadius);
            } else if (uUseMagnifier > 0.5) {
                refracted = sampleMagnifier(refractedScreen, uBlurRadius);
            } else {
                refracted = sampleBackdrop(refractedSampleCoord, uBlurRadius);
            }
            color = (uSkipColorControls > 0.5) ? refracted.rgb : applyColorControls(refracted.rgb, uBrightness, uContrast, uSaturation);
            // Magnifier refraction also forces opaque (see backdrop sample above).
            alpha = (uUseMagnifier > 0.5) ? 1.0 : refracted.a;
        }
    }

    // --- 3. onDrawSurface: tint (BlendMode.Hue + 0.75 alpha) -----
    // Faithful port of LiquidButton.kt onDrawSurface:
    //   drawRect(tint, blendMode = BlendMode.Hue)
    //   drawRect(tint.copy(alpha = 0.75f))
    // First pass: replace backdrop hue with tint hue (Hue blend, alpha = tint.a).
    // Second pass: overlay tint color at 0.75*alpha (SrcOver blend).
    if (uTintColor.a > 0.001) {
        vec3 hueBlended = blendHue(color, uTintColor.rgb);
        color = mix(color, hueBlended, uTintColor.a);
        color = mix(color, uTintColor.rgb, 0.75 * uTintColor.a);
    }

    // --- 4. onDrawSurface: surfaceColor (drawRect(surfaceColor)) --
    if (uSurfaceColor.a > 0.001) {
        color = mix(color, uSurfaceColor.rgb, uSurfaceColor.a);
    }

    // --- 5. Highlight (edge specular) -----------------------------
    // NOTE: The rim highlight is drawn as a SEPARATE pass (see
    // RIM_HIGHLIGHT_FRAGMENT_SHADER) with true Plus/SrcOver blend,
    // matching the original HighlightModifier.kt which records a separate
    // graphics layer. Doing it inline here would dim the highlight via the
    // element's edge AA, which is wrong \u2014 the highlight layer is composited
    // on top with its own blend mode.

    // --- 7. Edge anti-aliasing -----------------------------------
    // edgeAlpha was computed earlier (mask mode: direct coverage, analytic: smoothstep).
    //
    // PREMULTIPLIED output: RGB = color * coverage, A = coverage.
    // The elFbo texture uses LINEAR filtering; storing non-premultiplied
    // (color, coverage) causes bilinear interpolation between an edge texel
    // (color, 0.5) and the cleared-outside texel (0,0,0,0) to produce
    // ((1-t)*color, (1-t)*0.5) \u2014 RGB darkened by (1-t). The composite's
    // SrcOver blend then multiplies RGB by alpha AGAIN, squaring the
    // darkening \u2192 dark fringe at the glass edge.
    // Premultiplying here makes the linear filter mathematically correct:
    // lerp((color*a, a), (0,0,0,0), t) = ((1-t)*color*a, (1-t)*a), which
    // composites correctly with premult SrcOver (ONE, ONE_MINUS_SRC_ALPHA).
    float coverage = alpha * edgeAlpha * uEnterAlpha;
    gl_FragColor = vec4(color * coverage, coverage);
}
`
    );
  }
  var ELEMENT_FRAGMENT_SHADER;
  var init_element = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/element.ts"() {
      "use strict";
      init_sdf();
      init_element_uniforms();
      init_element_utils();
      ELEMENT_FRAGMENT_SHADER = generateElementFragmentShader(DEFAULT_BLUR_TAPS);
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/shadow.ts
  var SHADOW_FRAGMENT_SHADER, INNER_SHADOW_FRAGMENT_SHADER;
  var init_shadow = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/shadow.ts"() {
      "use strict";
      init_sdf();
      SHADOW_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uElementOffset;   // SCALED rect top-left (where the quad is drawn)
uniform vec2  uElementSize;     // SCALED size (includes graphicsLayer scale)
uniform vec4  uCornerRadii;     // SCALED corner radii
uniform float uShadowRadius;    // ORIGINAL px (NOT scaled \u2014 faithful to BlurMaskFilter at original size)
uniform vec2  uShadowOffset;    // ORIGINAL px (offsetX, offsetY; +Y = downward)
uniform vec4  uShadowColor;     // rgba
// --- ORIGINAL-SPACE SDF (faithful to graphicsLayer { scaleX, scaleY }) ---
// Same approach as the element shader: compute the shadow SDF in ORIGINAL
// space (shape is a correct capsule, not stretched), then the graphicsLayer
// scales the entire shadow layer by (scaleX, scaleY). The shadow offset is
// in ORIGINAL px; we multiply by uLayerScale to map it to screen space for
// the SDF evaluation (offset_screen = offset_orig * layerScale). The shadow
// radius (blur sigma) stays in ORIGINAL px because the Gaussian falloff is
// computed in original space \u2014 the graphicsLayer then stretches the blurred
// result, which is the faithful behavior (BlurMaskFilter blurs at original
// resolution, then graphicsLayer scales the blurred pixels).
uniform vec2  uOriginalSize;        // element size in px (ORIGINAL, unscaled)
uniform float uOriginalCornerRadius; // corner radius in px (ORIGINAL, unscaled)
uniform vec2  uLayerScale;          // (scaleX, scaleY) from graphicsLayer
uniform float uElementRotation;     // rotation in radians (graphicsLayer rotationZ)

${SDF_GLSL}

void main() {
    // Flip gl_FragCoord (bottom-left origin) to top-left origin, so +Y
    // points downward \u2014 matching CSS convention.
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    // elementCenter is the SAME for scaled and original rects (scaling is
    // around the center), so uElementOffset + uElementSize*0.5 gives the
    // correct center.
    vec2 elementCenter = uElementOffset + uElementSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    // Map to ORIGINAL space (guard against divide-by-zero).
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    // Un-rotate into local space so the shadow shape rotates with the element.
    // Also rotate the shadow offset into local space so it stays consistent.
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);
    vec2 shadowOffsetRot = rotateBy(uShadowOffset, -uElementRotation);

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // Shadow offset: defined in ORIGINAL px, applied in screen space.
    // The original draws the shadow at original size with this offset, then
    // graphicsLayer scales the whole layer \u2014 so the offset effectively
    // becomes offset_orig * layerScale in screen space. We map it back to
    // original space for the SDF: offset_orig = offset_screen / layerScale,
    // which cancels \u2014 so we use uShadowOffset directly in original space.
    vec2 shadowCenteredOrig = centeredOrigRot - shadowOffsetRot;
    float sd = sdShape(shadowCenteredOrig, origHalfSize, origRadius);
    // SDF of the element itself (not offset) \u2014 used to mask the shadow
    // inside the element so it doesn't bleed through the AA edge.
    float elementSd = sdShape(centeredOrigRot, origHalfSize, origRadius);

    // Shadow intensity: Gaussian falloff from the shadow shape's edge.
    // uShadowRadius is in ORIGINAL px (faithful to BlurMaskFilter at original
    // size). sigma = radius/3 matches the BlurMaskFilter spread.
    float sigma = max(uShadowRadius / 3.0, 1.0);
    float shadow = 0.5 * exp(-sd * sd / (2.0 * sigma * sigma));
    // Mask out the shadow inside the element (the element covers it).
    shadow *= smoothstep(-1.0, 1.0, elementSd);

    gl_FragColor = vec4(uShadowColor.rgb, uShadowColor.a * shadow);
}
`;
      INNER_SHADOW_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uElementOffset;
uniform vec2  uElementSize;
uniform vec4  uCornerRadii;
uniform float uInnerShadowRadius;
uniform float uInnerShadowAlpha;
uniform vec2  uInnerShadowOffset;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uElementOffset;
    vec2 halfSize = uElementSize * 0.5;
    vec2 centeredCoord = localCoord - halfSize;

    float radius = radiusAt(centeredCoord, uCornerRadii);
    float sd = sdShape(centeredCoord, halfSize, radius);
    if (sd > 0.5) discard;

    vec2 innerCentered = centeredCoord - uInnerShadowOffset;
    float innerSd = sdShape(innerCentered, halfSize, radius);
    float band = smoothstep(uInnerShadowRadius, 0.0, innerSd);
    band *= step(0.0, innerSd);
    gl_FragColor = vec4(0.0, 0.0, 0.0, band * uInnerShadowAlpha * 0.5);
}
`;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/highlight.ts
  var HIGHLIGHT_FRAGMENT_SHADER, TINT_FRAGMENT_SHADER, RIM_HIGHLIGHT_FRAGMENT_SHADER, HIGHLIGHT_STROKE_FRAGMENT_SHADER, HIGHLIGHT_COMPOSITE_FRAGMENT_SHADER, STROKE_MASK_COMPOSITE_FRAGMENT_SHADER;
  var init_highlight = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/highlight.ts"() {
      "use strict";
      init_sdf();
      HIGHLIGHT_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;       // element top-left in canvas px (top-left origin) \u2014 SCALED rect
uniform vec2  uSize;         // element size in canvas px \u2014 SCALED
uniform vec4  uCornerRadii;  // capsule radii (topLeft, topRight, bottomRight, bottomLeft) in px \u2014 SCALED
uniform vec4  uColor;        // rgba; usually white * (alpha = 0.15 * progress)
uniform float uRadius;       // glow radius in canvas px (= minDim * 1.5, SCALED space)
uniform vec2  uPosition;     // finger position in element-local px (top-left origin, SCALED space)
// --- ORIGINAL-SPACE SDF clip (faithful to graphicsLayer { scaleX, scaleY }) ---
// The press glow (InteractiveHighlight) is drawn INSIDE the graphicsLayer, so
// it is clipped to the ORIGINAL capsule shape, then scaled with the layer.
// The glow position + radius are in SCALED space (they track the finger in
// screen px), but the clip SDF is in original space so the capsule clip stays
// correct when the button is stretched.
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;

    // --- Capsule clip in ORIGINAL space (faithful to graphicsLayer clip) ---
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 origHalfSize = uOriginalSize * 0.5;
    float sd = sdShape(rotateBy(centeredOrig, -uElementRotation), origHalfSize, uOriginalCornerRadius);
    if (sd > 0.5) discard;
    float clipAlpha = 1.0 - smoothstep(-0.5, 0.5, sd);

    // Faithful AGSL port: smoothstep(radius, radius*0.5, dist) means
    // intensity = 1 at dist <= radius*0.5, fading to 0 at dist >= radius.
    // dist + uPosition are in SCALED local space (finger tracks screen px).
    float dist = distance(localCoord, uPosition);
    float intensity = smoothstep(uRadius, uRadius * 0.5, dist);

    // Premultiplied Plus-blend contribution. Renderer uses blendFunc(ONE, ONE)
    // so result.rgb = contribution + dst.rgb (clamped to 1).
    vec3 contribution = uColor.rgb * uColor.a * intensity * clipAlpha;
    gl_FragColor = vec4(contribution, 1.0);
}
`;
      TINT_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform vec4  uColor;
// --- ORIGINAL-SPACE SDF clip (faithful to graphicsLayer { scaleX, scaleY }) ---
// The white overlay (onDrawSurface drawRect) is drawn INSIDE the graphicsLayer,
// so it is clipped to the ORIGINAL capsule shape, then scaled with the layer.
// Computing the clip SDF in original space keeps the capsule clip correct when
// the button is stretched (no corner bleed, no stretched-clip artifacts).
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 origHalfSize = uOriginalSize * 0.5;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    // CLIP: for continuous-curvature (G2) elements, sample the R channel
    // (browser-native AA coverage) directly \u2014 this gives the most accurate
    // edge with NO exterior\u534A\u900F\u660E band. Using the G channel (SDF) with
    // smoothstep(-0.5, 0.5) leaves a ~1px half-transparent fringe OUTSIDE
    // the true shape edge (sd \u2208 [0, 0.5] is not discarded but has < 1
    // alpha), which lets the underlying glass body / shadow leak through
    // as a thin dark line ("capsule \u9ED1\u8FB9"). R coverage is 0 outside the
    // shape (browser AA only rasterizes the interior + edge), so the
    // fringe is eliminated and the clip is pixel-tight.
    // For G1 (analytic) elements, keep the SDF smoothstep \u2014 it's the
    // only shape source available.
    float clipAlpha;
    if (uUseContinuousSdf > 0.5) {
        clipAlpha = sampleClipMask(centeredOrigRot, origHalfSize, uOriginalCornerRadius);
    } else {
        float sd = sdRoundedRect(centeredOrigRot, origHalfSize, uOriginalCornerRadius);
        if (sd > 0.5) discard;
        clipAlpha = 1.0 - smoothstep(-0.5, 0.5, sd);
    }
    if (clipAlpha < 0.001) discard;

    gl_FragColor = vec4(uColor.rgb, uColor.a * clipAlpha);
}
`;
      RIM_HIGHLIGHT_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;          // element top-left in canvas px (top-left origin) \u2014 SCALED rect
uniform vec2  uSize;            // element size in canvas px \u2014 SCALED (includes graphicsLayer scale)
uniform vec4  uCornerRadii;     // (topLeft, topRight, bottomRight, bottomLeft) in px \u2014 SCALED
uniform vec4  uHighlightColor;  // rgb + 1.0
uniform float uHighlightAngle;  // radians
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;     // 0=Default, 1=Ambient, 2=Plain
uniform float uHighlightStrokeWidth;
uniform float uHighlightBlur;
// --- ORIGINAL-SPACE SDF (faithful to graphicsLayer { scaleX, scaleY }) ---
// Same approach as the element shader: compute SDF/stroke in ORIGINAL space
// (shape is correct, not stretched), so the highlight clip + stroke remain a
// correct capsule shape that is then scaled by graphicsLayer. Without this,
// a horizontally-stretched button would stretch the highlight clip too,
// making the stroke band uneven. See element.ts for the full rationale.
uniform vec2  uOriginalSize;        // element size in px (ORIGINAL, unscaled)
uniform float uOriginalCornerRadius; // corner radius in px (ORIGINAL, unscaled)
uniform vec2  uLayerScale;          // (scaleX, scaleY) from graphicsLayer
uniform float uElementRotation;     // rotation in radians (graphicsLayer rotationZ)

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    // elementCenter is the SAME for scaled and original rects (scaling is
    // around the center), so uOffset + uSize*0.5 gives the correct center.
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    // Map to ORIGINAL space (guard against divide-by-zero).
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    // Un-rotate into the element's local space so the SDF shape rotates.
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // SDF for stroke \u2014 analytic sdRoundedRect (matches the pre-capsule
    // highlight implementation). When capsule is OFF, this is the exact
    // shape. When capsule is ON, this is a close approximation (circular
    // arc vs G2 Bezier \u2014 the difference is sub-pixel within the 2px stroke
    // band, invisible in the highlight).
    float sd = sdRoundedRect(centeredOrigRot, origHalfSize, origRadius);

    // Outside the shape \u2014 clip (hard discard, matching pre-capsule behavior).
    if (sd > 0.0) discard;

    // Stroke mask \u2014 faithful to HighlightModifier.kt:
    //   paint.style = Stroke
    //   paint.strokeWidth = ceil(width.toPx()) * 2     // full stroke, centered on edge
    //   paint.blur(blurRadius.toPx())                   // BlurMaskFilter, Blur.NORMAL
    //   canvas.clipOutline(outline)                     // clip to inside the shape
    //   canvas.drawOutline(outline, paint)              // stroke centered on edge
    //
    // Implementation: first compute a HARD-EDGE stroke mask (1.0 inside the
    // stroke band, 0.0 outside), then convolve it with a Gaussian kernel by
    // sampling the SDF at multiple offsets along the gradient direction.
    // This mirrors the original's two-step process (draw stroke \u2192 blur),
    // rather than using an analytic erf approximation.
    //
    // The hard stroke band: sd in [-strokeHalf, +strokeHalf].
    // After clip (sd > 0 discarded by the outer if), only [-strokeHalf, 0] shows.
    //
    // Faithful to the original BlurMaskFilter:
    //   paint.blur(blurRadius.toPx())  \u2192  BlurMaskFilter(NORMAL, sigma=blurRadius_px)
    // In Skia/Android, BlurMaskFilter's radius param IS the Gaussian sigma
    // (not radius/3). blurRadius = width/2 = 0.25dp, so sigma = 0.25*dpr px.
    // uHighlightBlur is already in device px (set by the renderer as widthDp*dpr*0.5).
    float strokeHalf = uHighlightStrokeWidth * 0.5;
    float sigma = max(uHighlightBlur, 0.1);

    // Gaussian convolution of the hard stroke mask \u2014 3-tap (\u03C3-spaced).
    // The original's BlurMaskFilter has \u03C3 = blurRadius = 0.25dp \u2192 0.25px at
    // dpr=1. At this sub-pixel sigma, only 3 taps (at -\u03C3, 0, +\u03C3) are needed
    // \u2014 the Gaussian weight at \xB12\u03C3 is exp(-2) \u2248 0.14, negligible. This
    // replaces the old 65-tap loop (which computed 65 exp() calls per pixel,
    // ~650 cycles \u2014 the single biggest shader cost). 3 taps = 3 exp() = ~30
    // cycles, a 20\xD7 reduction with identical visual result at \u03C3=0.25.
    //   hardMask(sd) = 1.0 if |sd| < strokeHalf, else 0.0
    //   blurred(sd) = \u03A3 hardMask(sd - offset_k) * gauss(offset_k, \u03C3)
    // CLIP HALVING: the stroke is centered on sd=0; clip removes sd>0 (outer
    // half), so peak \u2248 0.5. We halve to match.
    float strokeMask = 0.0;
    float wSum = 0.0;
    for (int i = -1; i <= 1; i++) {
        float offset = float(i) * sigma;  // taps at -\u03C3, 0, +\u03C3
        float sampleSd = sd - offset;
        float hard = (abs(sampleSd) < strokeHalf) ? 1.0 : 0.0;
        float w = exp(-0.5 * (offset * offset) / (sigma * sigma));
        strokeMask += hard * w;
        wSum += w;
    }
    strokeMask /= wSum;
    strokeMask *= 0.5;  // clip halves the symmetric stroke at the edge

    if (uHighlightMode < 0.5) {
        // Default \u2014 shader returns color * intensity, Plus blend.
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        float d = dot(grad, normal);
        float intensity = pow(abs(d), uHighlightFalloff);
        vec3 c = uHighlightColor.rgb * intensity * strokeMask * uHighlightAlpha;
        gl_FragColor = vec4(c, 1.0);
    } else if (uHighlightMode < 1.5) {
        // Ambient \u2014 premultiplied SrcOver blend (renderer uses ONE, ONE_MINUS_SRC_ALPHA).
        // Faithful to AmbientHighlightShaderString:
        //   float d = dot(grad, normal);
        //   float intensity = pow(abs(d), falloff);
        //   float t = step(0.0, d);  \u2190 half-black-half-white split
        //   return half4(t, t, t, 1.0) * intensity;
        // Output is premultiplied: vec4(color.rgb * t * i, i).
        // Bright side: adds white light. Dark side: dims scene \u2192 3D sphere.
        // paint.color(0.38) is overridden by shader; alpha = 1.0 not 0.38.
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        float d = dot(grad, normal);
        float intensity = pow(abs(d), uHighlightFalloff);
        float t = step(0.0, d);  // 0 on dark side (d<0), 1 on bright side (d>=0)
        float i = intensity * strokeMask * uHighlightAlpha;
        gl_FragColor = vec4(uHighlightColor.rgb * t * i, i);
    } else {
        // Plain \u2014 even stroke, paint.color, Plus blend.
        vec3 c = uHighlightColor.rgb * strokeMask * uHighlightAlpha;
        gl_FragColor = vec4(c, 1.0);
    }
}
`;
      HIGHLIGHT_STROKE_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;          // element top-left (top-left origin) \u2014 SCALED
uniform vec2  uSize;            // element size \u2014 SCALED
uniform vec4  uCornerRadii;     // SCALED
uniform float uHighlightStrokeWidth;  // ceil(width*dpr)*2, device px
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;
// uCornerStyle, uUseContinuousSdf, uContinuousSdf, uContinuousSdfTexSize,
// uContinuousSdfElementSize are declared in SDF_GLSL (do NOT redeclare here).

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    float sd = sdShape(centeredOrigRot, origHalfSize, origRadius);

    // clipOutline \u2014 clip to INSIDE the shape. Outside (sd > 0) is discarded.
    float edgeAA;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredOrigRot, origHalfSize, origRadius);
        if (mask < 0.01) discard;
        edgeAA = mask;
    } else {
        if (sd > 0.0) discard;
        edgeAA = 1.0 - smoothstep(-0.5, 0.5, sd);
    }

    // Stroke band centered on the edge (sd = 0), with 0.5px coverage AA on
    // the inner boundary. The outer boundary (sd = +strokeHalf) is clipped
    // away by edgeAA above. Faithful to Skia Paint.Stroke's coverage AA.
    // The BlurMaskFilter pass (when sigma >= 0.5px) softens this further;
    // at sub-pixel sigma (0.25px) the blur is skipped and this 0.5px AA
    // is what matches the original's look (Skia's 0.25px blur is negligibly
    // soft \u2014 essentially just AA).
    float strokeHalf = uHighlightStrokeWidth * 0.5;
    float strokeAA = 1.0 - smoothstep(strokeHalf - 0.5, strokeHalf, abs(sd));

    gl_FragColor = vec4(0.0, 0.0, 0.0, strokeAA * edgeAA);
}
`;
      HIGHLIGHT_COMPOSITE_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform sampler2D uBlurredMask;   // the 2-pass-blurred stroke mask FBO
uniform vec2  uMaskTexSize;       // size of the mask FBO (= canvas size)
uniform vec4  uHighlightColor;    // rgb + 1.0
uniform float uHighlightAngle;
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;     // 0=Default, 1=Ambient, 2=Plain
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;
// uCornerStyle, uUseContinuousSdf, uContinuousSdf, uContinuousSdfTexSize,
// uContinuousSdfElementSize are declared in SDF_GLSL (do NOT redeclare here).

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);

    // Sample the blurred stroke mask at this pixel. The mask FBO covers the
    // full canvas (same size), so UV = gl_FragCoord / maskTexSize.
    // Mask FBO is Y-down (top-left origin, like our scene FBOs), so flip Y
    // to match the screenCoord convention.
    vec2 maskUv = vec2(gl_FragCoord.x / uMaskTexSize.x, gl_FragCoord.y / uMaskTexSize.y);
    float mask = texture2D(uBlurredMask, maskUv).a;
    if (mask < 0.001) discard;

    // Compute intensity from the SDF gradient (AGSL DefaultHighlightShaderString).
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);
    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // Faithful clip-after-blur: the original does clipOutline \u2192 stroke(blur),
    // but Skia applies clip at the canvas level AFTER the BlurMaskFilter
    // spreads alpha. So alpha that blurred OUTSIDE the shape is clipped away.
    // Our stroke shader clips before blur (discard sd>0), then blur spreads
    // alpha back outside \u2014 we must clip AGAIN here to match. Without this,
    // the highlight "leaks" outside the shape, making it brighter than the
    // original (which has zero contribution outside the clip region).
    float sd = sdShape(centeredOrigRot, origHalfSize, origRadius);
    float clipAA;
    if (uUseContinuousSdf > 0.5) {
        clipAA = sampleClipMask(centeredOrigRot, origHalfSize, origRadius);
    } else {
        clipAA = 1.0 - smoothstep(-0.5, 0.5, sd);
    }
    mask *= clipAA;
    if (mask < 0.001) discard;

    // Compute d (with sign) for Default + Ambient modes \u2014 needed for
    // Ambient's step(0,d) half-black-half-white split.
    float d = 0.0;  // signed dot(grad, normal) \u2014 0 for Plain mode
    float intensity;
    if (uHighlightMode < 1.5) {
        // Default + Ambient use the SDF gradient \xB7 normal.
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        d = dot(grad, normal);
        intensity = pow(abs(d), uHighlightFalloff);
    } else {
        // Plain \u2014 no directional intensity (even stroke).
        intensity = 1.0;
    }

    float a = mask * uHighlightAlpha;

    if (uHighlightMode < 0.5) {
        // Default \u2014 Plus blend. Output premultiplied rgb (alpha=1 so blendFunc
        // (ONE, ONE) adds rgb directly).
        vec3 c = uHighlightColor.rgb * intensity * a;
        gl_FragColor = vec4(c, 1.0);
    } else if (uHighlightMode < 1.5) {
        // Ambient \u2014 PREMULTIPLIED SrcOver blend (renderer uses ONE, ONE_MINUS_SRC_ALPHA).
        // Faithful to AmbientHighlightShaderString:
        //   float t = step(0.0, d);  \u2190 half-black-half-white split
        // Bright side (d>=0): t=1 \u2192 white highlight. Dark side (d<0): t=0 \u2192
        // black overlay that reduces scene brightness via premultiplied SrcOver \u2192 3D sphere.
        // Output is premultiplied: vec4(color.rgb * t * i, i).
        // IMPORTANT: paint.color = White(0.38) is overridden by the shader.
        // The 0.38 does NOT scale the output; layer alpha (Highlight.alpha) is the
        // only modulation. For Ambient highlight, alpha = 1.0 (not 0.38).
        float t = step(0.0, d);
        float i = intensity * a;
        gl_FragColor = vec4(uHighlightColor.rgb * t * i, i);
    } else {
        // Plain \u2014 Plus blend, no intensity.
        vec3 c = uHighlightColor.rgb * a;
        gl_FragColor = vec4(c, 1.0);
    }
}
`;
      STROKE_MASK_COMPOSITE_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform sampler2D uStrokeMask;
uniform vec2  uMaskOffset;
uniform vec2  uMaskSize;
uniform vec4  uHighlightColor;
uniform float uHighlightAngle;
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);

    // Map screen coord \u2192 element-local ORIGINAL space (un-scale, un-rotate).
    // The stroke mask is drawn in original space (origSizeX \xD7 origSizeY + margin).
    // elementCenter is the same in scaled and original space (scaling is around center).
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    // Mask UV: map original-space coord \u2192 mask texture UV.
    // The mask was drawn with translate(margin, margin), so mask (0,0) =
    // element-local (-margin). Element-local coord 0..origSize maps to
    // mask UV (0+margin)/maskSize .. (origSize+margin)/maskSize.
    // uMaskOffset = margin (scalar, passed as vec2 for convenience).
    // uMaskSize = (origSize + 2*margin).
    vec2 origHalfSize = uOriginalSize * 0.5;
    vec2 maskTexCoord = centeredOrigRot + origHalfSize;  // 0..origSize (element-local)
    vec2 maskUv = (maskTexCoord + uMaskOffset) / uMaskSize;
    if (maskUv.x < 0.0 || maskUv.x > 1.0 || maskUv.y < 0.0 || maskUv.y > 1.0) discard;
    float mask = texture2D(uStrokeMask, maskUv).a;
    if (mask < 0.001) discard;

    float origRadius = uOriginalCornerRadius;

    // Compute d (with sign) for Default + Ambient modes \u2014 needed for
    // Ambient's step(0,d) half-black-half-white split.
    float d = 0.0;  // signed dot(grad, normal) \u2014 0 for Plain mode
    float intensity;
    if (uHighlightMode < 1.5) {
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        d = dot(grad, normal);
        intensity = pow(abs(d), uHighlightFalloff);
    } else {
        intensity = 1.0;
    }

    float a = mask * uHighlightAlpha;
    if (uHighlightMode < 0.5) {
        gl_FragColor = vec4(uHighlightColor.rgb * intensity * a, 1.0);
    } else if (uHighlightMode < 1.5) {
        // Ambient \u2014 premultiplied SrcOver (renderer uses ONE, ONE_MINUS_SRC_ALPHA).
        // Faithful to AmbientHighlightShaderString:
        //   float t = step(0.0, d);  \u2190 bright/dark split
        // Bright side: t=1 \u2192 white highlight. Dark side: t=0 \u2192 dims scene.
        // Output is premultiplied: vec4(color.rgb * t * i, i).
        // paint.color(0.38) is overridden by shader; alpha should be 1.0 not 0.38.
        float t = step(0.0, d);
        float i = intensity * a;
        gl_FragColor = vec4(uHighlightColor.rgb * t * i, i);
    } else {
        gl_FragColor = vec4(uHighlightColor.rgb * a, 1.0);
    }
}
`;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/inner-shadow.ts
  var INNER_SHADOW_MASK_COMPOSITE_FRAGMENT_SHADER;
  var init_inner_shadow = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/inner-shadow.ts"() {
      "use strict";
      init_sdf();
      INNER_SHADOW_MASK_COMPOSITE_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;           // element top-left in canvas px (top-left origin) \u2014 SCALED rect
uniform vec2  uSize;             // element size in canvas px \u2014 SCALED
uniform vec4  uCornerRadii;      // (topLeft, topRight, bottomRight, bottomLeft) \u2014 SCALED
uniform sampler2D uInnerShadowMask; // Canvas2D-generated blurred ring mask
uniform vec2  uMaskOffset;       // margin in device px (for UV mapping: element-local \u2192 mask UV)
uniform vec2  uMaskSize;         // total mask size in device px (w+2*margin, h+2*margin)
uniform vec3  uInnerShadowColor; // shadow color RGB
uniform float uInnerShadowAlpha; // shadow alpha
// --- ORIGINAL-SPACE SDF clip (faithful to graphicsLayer { scaleX, scaleY }) ---
uniform vec2  uOriginalSize;        // element size in px (ORIGINAL, unscaled)
uniform float uOriginalCornerRadius; // corner radius in px (ORIGINAL, unscaled)
uniform vec2  uLayerScale;          // (scaleX, scaleY) from graphicsLayer
uniform float uElementRotation;     // rotation in radians (graphicsLayer rotationZ)

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);

    // Map screen coord \u2192 element-local ORIGINAL space (un-scale, un-rotate).
    // The inner shadow mask is drawn in original space (origSize + margin).
    // elementCenter is the same in scaled and original space (scaling is
    // around center).
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    // SDF for shape clip \u2014 faithful to InnerShadowModifier.kt's final
    // clipOutline call before drawLayer. The original uses Skia's
    // geometric clip with smooth AA (sub-pixel transition).
    // We replicate with smoothstep \u2014 NO hard discard.
    vec2 origHalfSize = uOriginalSize * 0.5;
    float sd = sdShape(centeredOrigRot, origHalfSize, uOriginalCornerRadius);

    // Smooth clipAlpha: 1.0 fully inside (sd \u2264 0), smoothly fading
    // across the boundary (sd 0\u21921.5), 0.0 outside (sd \u2265 1.5).
    // The 1.5px transition width matches Skia's clipOutline AA behavior
    // \u2014 pixels at the exact boundary (sd=0) retain FULL intensity, with
    // a gentle fade that removes outward blur leakage smoothly.
    // This is NOT a hard discard \u2014 it's a smooth clip that matches the
    // original's geometric clipOutline exactly.
    float clipAlpha = 1.0 - smoothstep(0.0, 1.5, sd);

    // Skip truly invisible pixels for performance (not a visual clip)
    if (clipAlpha < 0.004) discard;

    // Map to mask UV: original-space coord \u2192 mask texture UV.
    vec2 maskTexCoord = centeredOrigRot + origHalfSize;  // 0..origSize (element-local)
    vec2 maskUv = (maskTexCoord + uMaskOffset) / uMaskSize;

    // Sample the mask texture. CLAMP_TO_EDGE wrapping handles UV values
    // slightly outside (0..1) gracefully \u2014 returns transparent at edges.
    float mask = texture2D(uInnerShadowMask, maskUv).a;

    // Skip truly invisible pixels for performance (not a visual clip)
    // Threshold is very low to avoid cutting off faint but visible shadow edges.
    if (mask < 0.003) discard;

    // Premultiplied SrcOver composite: shadowColor \xD7 mask \xD7 shadowAlpha \xD7 clipAlpha.
    // clipAlpha provides smooth shape-boundary transition (faithful to original's
    // clipOutline AA). Output is premultiplied (rgb = color * alpha).
    // Renderer uses gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA) \u2014 premultiplied SrcOver.
    float a = mask * uInnerShadowAlpha * clipAlpha;
    gl_FragColor = vec4(uInnerShadowColor * a, a);
}
`;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/scene-bg.ts
  var VERTEX_SHADER, WALLPAPER_FRAGMENT_SHADER, COPY_FRAGMENT_SHADER, SOLID_FILL_FRAGMENT_SHADER, EL_FBO_CROP_FRAGMENT_SHADER, EL_FBO_COMPOSITE_FRAGMENT_SHADER, COLOR_CONTROLS_FRAGMENT_SHADER, SCENE_TINT_FRAGMENT_SHADER;
  var init_scene_bg = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/scene-bg.ts"() {
      "use strict";
      init_sdf();
      VERTEX_SHADER = /* glsl */
      `
attribute vec2 aPos;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
      WALLPAPER_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uBackdrop;
uniform vec2 uCanvasSize;
uniform vec2 uWallpaperSize;

${COVER_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 uv = coverUv(screenCoord);
    gl_FragColor = texture2D(uBackdrop, uv);
}
`;
      COPY_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uCanvasSize;

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uCanvasSize.x, gl_FragCoord.y / uCanvasSize.y);
    gl_FragColor = texture2D(uTexture, uv);
}
`;
      SOLID_FILL_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec4 uColor;

void main() {
    gl_FragColor = uColor;
}
`;
      EL_FBO_CROP_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uSrcOffset;   // region top-left in source texture (top-left origin, device px)
uniform vec2 uSrcSize;     // fullscreen source texture size (device px)
uniform vec2 uDstSize;     // destination (small) FBO size = region size (device px)

void main() {
    vec2 localTopLeft = vec2(gl_FragCoord.x, uDstSize.y - gl_FragCoord.y);
    vec2 srcTopLeft = uSrcOffset + localTopLeft;
    vec2 uv = vec2(srcTopLeft.x / uSrcSize.x, 1.0 - srcTopLeft.y / uSrcSize.y);
    gl_FragColor = texture2D(uTexture, uv);
}
`;
      EL_FBO_COMPOSITE_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uCanvasSize;     // bound FBO size in device px
uniform vec2 uElementCenter;  // element center (top-left origin, device px)
uniform vec2 uElementSize;    // SCALED element size (device px)
uniform float uRotation;      // element rotation in radians
uniform vec2 uSrcSize;        // elFbo texture size (baseline, device px)

// rotateBy \u2014 standard 2D rotation (counter-clockwise, math convention).
// Used consistently in Y-down (top-left origin) space \u2014 the Y-flip cancels
// because both element shader and composite use the same convention.
vec2 rotateBy(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

void main() {
    // gl_FragCoord: bottom-left origin. Convert to top-left origin (Y-down).
    vec2 fragTopLeft = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    // Offset from element center (Y-down, screen px)
    vec2 centered = fragTopLeft - uElementCenter;
    // Un-rotate: screen \u2192 local (undo the element's rotation).
    // When rot\u22480 (common case \u2014 all non-GP elements), skip rotateBy entirely
    // (4 mul + cos/sin per fragment saved). This makes the composite shader
    // as cheap as the old 1:1 blit for the vast majority of elements.
    vec2 localCentered;
    if (abs(uRotation) > 0.001) {
        localCentered = rotateBy(centered, -uRotation);
    } else {
        localCentered = centered;
    }
    // Un-scale: screen px \u2192 elFbo px (baseline). Ratio = srcSize / elementSize.
    vec2 srcCentered = localCentered * uSrcSize / uElementSize;
    // Bounds check: discard if outside elFbo
    vec2 halfSrc = uSrcSize * 0.5;
    if (abs(srcCentered.x) > halfSrc.x || abs(srcCentered.y) > halfSrc.y) discard;
    // Map to UV. elFbo texture: UV (0,0) = gl_FragCoord (0,0) = bottom-left.
    // srcCentered is Y-down (top-left origin). Flip Y for texture UV.
    vec2 uv = vec2(
        (srcCentered.x + halfSrc.x) / uSrcSize.x,
        (halfSrc.y - srcCentered.y) / uSrcSize.y
    );
    gl_FragColor = texture2D(uTexture, uv);
}
`;
      COLOR_CONTROLS_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uTexSize.x, gl_FragCoord.y / uTexSize.y);
    vec4 c = texture2D(uTexture, uv);
    float invSat = 1.0 - uSaturation;
    float r = 0.213 * invSat;
    float g = 0.715 * invSat;
    float b = 0.072 * invSat;
    float t = (0.5 - uContrast * 0.5 + uBrightness);
    float cs = uContrast * uSaturation;
    float cr = uContrast * r;
    float cg = uContrast * g;
    float cb = uContrast * b;
    vec3 outc;
    outc.r = (cr + cs) * c.r + cg * c.g + cb * c.b + t;
    outc.g = cr * c.r + (cg + cs) * c.g + cb * c.b + t;
    outc.b = cr * c.r + cg * c.g + (cb + cs) * c.b + t;
    gl_FragColor = vec4(outc, c.a);
}
`;
      SCENE_TINT_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uCanvasSize;
uniform vec3 uTintColor;   // rgb 0..1 (accentColor)

// ColorFilter.tint(color, blendMode = BlendMode.SrcIn):
//   result.rgb = src.rgb (the tint color)
//   result.a   = dst.a * src.a
// SrcIn replaces the destination's RGB with the tint color while
// preserving its alpha \u2014 opaque content becomes solid tint, transparent
// areas stay transparent. This matches Compose's ColorFilter.tint default.
void main() {
    vec2 uv = vec2(gl_FragCoord.x / uCanvasSize.x, gl_FragCoord.y / uCanvasSize.y);
    vec4 src = texture2D(uTexture, uv);
    gl_FragColor = vec4(uTintColor, src.a);
}
`;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/scene-fg.ts
  var FOREGROUND_FRAGMENT_SHADER, PLAIN_RECT_FRAGMENT_SHADER, PROGRESSIVE_BLUR_FRAGMENT_SHADER;
  var init_scene_fg = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/scene-fg.ts"() {
      "use strict";
      init_sdf();
      FOREGROUND_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uCanvasSize;
uniform vec2 uOffset;   // foreground texture top-left in canvas px (top-left origin) \u2014 SCALED rect
uniform vec2 uSize;     // foreground texture size in canvas px \u2014 SCALED
uniform vec4 uCornerRadii;  // capsule radii (topLeft, topRight, bottomRight, bottomLeft) in px \u2014 SCALED
uniform float uAlpha;   // global alpha multiplier (used for press fade)
// --- ORIGINAL-SPACE SDF clip (faithful to graphicsLayer { scaleX, scaleY }) ---
// The original wraps everything (text included) in a graphicsLayer clipped to
// the capsule shape, THEN scales the layer. So the clip shape is the ORIGINAL
// capsule, not the stretched one. We compute the clip SDF in original space so
// a stretched button keeps correct capsule clipping (no corner bleed). The
// texture UV still uses the scaled rect (uOffset/uSize) since the foreground
// texture is rendered at the element's scaled on-screen size.
uniform vec2  uOriginalSize;        // element size in px (ORIGINAL, unscaled)
uniform float uOriginalCornerRadius; // corner radius in px (ORIGINAL, unscaled)
uniform vec2  uLayerScale;          // (scaleX, scaleY) from graphicsLayer

${SDF_GLSL}

void main() {
    // gl_FragCoord is bottom-left origin in WebGL framebuffer space.
    // Flip Y to get top-left origin (matching CSS / 2D canvas convention).
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;
    // Scissor to the (scaled) foreground rectangle.
    if (localCoord.x < 0.0 || localCoord.x > uSize.x ||
        localCoord.y < 0.0 || localCoord.y > uSize.y) {
        discard;
    }

    // --- Capsule clip in ORIGINAL space (faithful to graphicsLayer clip) ---
    // elementCenter is the SAME for scaled and original rects (scaling is
    // around the center). Map screen coord \u2192 original space for the SDF so
    // the clip shape is the original capsule, not the stretched one.
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 origHalfSize = uOriginalSize * 0.5;
    float clipAlpha;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredOrig, origHalfSize, uOriginalCornerRadius);
        if (mask < 0.01) discard;
        clipAlpha = mask;
    } else {
        float sdClip = sdClipShape(centeredOrig, origHalfSize, uOriginalCornerRadius);
        if (sdClip > 0.5) discard;
        clipAlpha = 1.0 - smoothstep(-0.5, 0.5, sdClip);
    }

    // The texture is uploaded from a 2D canvas with UNPACK_FLIP_Y_WEBGL=false,
    // so texture row 0 (= v=0) is the TOP row of the source canvas. Combined
    // with the Y flip above, uv.y=0 corresponds to the top of the button rect
    // (which is what we want \u2014 text drawn at the middle of the source canvas
    // appears at the middle of the button).
    //
    // The texture is uploaded with UNPACK_PREMULTIPLY_ALPHA_WEBGL=true, so
    // c is already in premultiplied form (c.rgb <= c.a). We scale both
    // rgb and a by uAlpha * clipAlpha and output premultiplied rgba, paired
    // with blendFunc(ONE, ONE_MINUS_SRC_ALPHA) at the draw site.
    vec2 uv = localCoord / uSize;
    vec4 c = texture2D(uTexture, uv);
    float a = c.a * uAlpha * clipAlpha;
    gl_FragColor = vec4(c.rgb * uAlpha * clipAlpha, a);
}
`;
      PLAIN_RECT_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform vec4  uColor;       // rgba (premultiplied not required; alpha used as-is)

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;
    vec2 halfSize = uSize * 0.5;
    vec2 centeredCoord = localCoord - halfSize;

    float radius = radiusAt(centeredCoord, uCornerRadii);
    float alpha;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredCoord, halfSize, radius);
        if (mask < 0.01) discard;
        alpha = mask;
    } else {
        float sdClip = sdClipShape(centeredCoord, halfSize, radius);
        if (sdClip > 0.5) discard;
        alpha = 1.0 - smoothstep(-0.5, 0.5, sdClip);
    }
    gl_FragColor = vec4(uColor.rgb, uColor.a * alpha);
}
`;
      PROGRESSIVE_BLUR_FRAGMENT_SHADER = /* glsl */
      `
precision highp float;

uniform sampler2D uBackdrop;
uniform vec2  uCanvasSize;
uniform vec2  uWallpaperSize;
uniform vec2  uOffset;          // band top-left in canvas px (top-left origin)
uniform vec2  uSize;            // band size in canvas px
uniform float uBlurRadius;      // px in canvas space
uniform vec4  uTintColor;       // rgba
uniform float uTintIntensity;   // 0..1

${COVER_GLSL}

// 9-tap poisson disc \u2014 offsets are inlined because GLSL ES 1.00 (WebGL 1)
// does not support array constructors or const-array initializers.
// The offsets are normalized (unit disc), multiplied by step (radius in UV).
vec4 sampleBackdrop(vec2 canvasPx, float radius) {
    vec2 uvScale = canvasPxToUvScale();
    vec2 uv = coverUv(canvasPx);
    vec2 st = radius * uvScale;
    vec4 sum = vec4(0.0);
    sum += texture2D(uBackdrop, uv + vec2( 0.0000,  0.0000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.5000,  0.0000) * st);
    sum += texture2D(uBackdrop, uv + vec2(-0.5000,  0.0000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.0000,  0.5000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.0000, -0.5000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.3536,  0.3536) * st);
    sum += texture2D(uBackdrop, uv + vec2(-0.3536,  0.3536) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.3536, -0.3536) * st);
    sum += texture2D(uBackdrop, uv + vec2(-0.3536, -0.3536) * st);
    return sum / 9.0;
}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;
    // Outside the band \u2014 nothing to draw.
    if (localCoord.x < 0.0 || localCoord.x > uSize.x ||
        localCoord.y < 0.0 || localCoord.y > uSize.y) {
        discard;
    }

    // Alpha mask: opaque at top (coord.y = size.y, i.e. BOTTOM in top-left
    // origin = size.y in AGSL coord), transparent at bottom. Matches the
    // Kotlin smoothstep(size.y, size.y * 0.5, coord.y).
    float a = smoothstep(uSize.y, uSize.y * 0.5, localCoord.y);

    // Sample the (cover-fit) backdrop at the canvas pixel, blurred.
    vec4 blurred = sampleBackdrop(screenCoord, uBlurRadius);

    // Faithful to AlphaMask shader: mix(content * blurAlpha, tint * tintAlpha, tintIntensity)
    // This is PREMULTIPLIED (rgb already scaled by alpha). The renderer uses
    // premultiplied alpha blending for the progressive blur pass, so we output
    // premultiplied rgb with the mask alpha.
    vec3 premulRgb = mix(blurred.rgb * a, uTintColor.rgb * a, uTintIntensity);
    gl_FragColor = vec4(premulRgb, a);
}
`;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/separable-blur.ts
  function generateGaussianKernel1D(tapCount) {
    if (tapCount <= 1) return [{ offset: 0, weight: 1 }];
    const taps = [];
    const half = Math.floor(tapCount / 2);
    const maxOffset = 3;
    let totalW = 0;
    for (let i = 0; i < tapCount; i++) {
      const t = tapCount % 2 === 1 ? i - half : i - half + 0.5;
      const offset = t / half * maxOffset;
      const w = Math.exp(-0.5 * offset * offset);
      taps.push({ offset, weight: w });
      totalW += w;
    }
    if (totalW > 0) {
      for (const t of taps) t.weight /= totalW;
    }
    return taps;
  }
  function generateSeparableBlurShader(tapCount, direction) {
    const kernel = generateGaussianKernel1D(tapCount);
    const isH = direction === "horizontal";
    const dirVec = isH ? "vec2(1.0, 0.0)" : "vec2(0.0, 1.0)";
    let sampleCode = "";
    if (kernel.length === 1) {
      sampleCode = `    gl_FragColor = texture2D(uTexture, uv);
`;
    } else {
      sampleCode = `    vec3 rgbSum = vec3(0.0);
    float rgbW = 0.0;
`;
      for (const t of kernel) {
        const off = t.offset.toFixed(6);
        const w = t.weight.toFixed(8);
        sampleCode += `    { vec4 s = texture2D(uTexture, uv + ${dirVec} * ${off} * pxToUv); float aw = s.a * ${w}; rgbSum += s.rgb * aw; rgbW += aw; }
`;
      }
      sampleCode += `    float origA = texture2D(uTexture, uv).a;
    gl_FragColor = vec4(rgbW > 0.001 ? rgbSum / rgbW : vec3(0.0), origA);
`;
    }
    return (
      /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uRadius;

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uTexSize.x, gl_FragCoord.y / uTexSize.y);
    if (uRadius < 0.5) {
        gl_FragColor = texture2D(uTexture, uv);
        return;
    }
    vec2 pxToUv = vec2(uRadius / uTexSize.x, uRadius / uTexSize.y);
${sampleCode}}
`
    );
  }
  function computeBlur1DTapCount(blurRadiusPx) {
    if (blurRadiusPx < 0.5) return 1;
    const sigma = blurRadiusPx * 0.57735 + 0.5;
    const n = 2 * Math.ceil(3 * sigma) + 1;
    return Math.min(33, Math.max(1, n));
  }
  function generateHighlightBlurKernel1D(tapCount) {
    if (tapCount <= 1) return [{ offset: 0, weight: 1 }];
    const taps = [];
    const half = Math.floor(tapCount / 2);
    let totalW = 0;
    for (let i = 0; i < tapCount; i++) {
      const offset = i - half;
      const w = Math.exp(-0.5 * offset * offset);
      taps.push({ offset, weight: w });
      totalW += w;
    }
    if (totalW > 0) {
      for (const t of taps) t.weight /= totalW;
    }
    return taps;
  }
  function generateHighlightBlurShader(tapCount, direction) {
    const kernel = generateHighlightBlurKernel1D(tapCount);
    const isH = direction === "horizontal";
    const dirVec = isH ? "vec2(1.0, 0.0)" : "vec2(0.0, 1.0)";
    let sampleCode = "";
    if (kernel.length === 1) {
      sampleCode = `    gl_FragColor = texture2D(uTexture, uv);
`;
    } else {
      sampleCode = `    float aSum = 0.0;
`;
      for (const t of kernel) {
        const off = t.offset.toFixed(6);
        const w = t.weight.toFixed(8);
        sampleCode += `    aSum += texture2D(uTexture, uv + ${dirVec} * ${off} * pxToUv).a * ${w};
`;
      }
      sampleCode += `    gl_FragColor = vec4(0.0, 0.0, 0.0, aSum);
`;
    }
    return (
      /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uRadius;  // Gaussian sigma in pixels (Android BlurMaskFilter semantics)

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uTexSize.x, gl_FragCoord.y / uTexSize.y);
    if (uRadius < 0.01) {
        gl_FragColor = texture2D(uTexture, uv);
        return;
    }
    // pxToUv converts a pixel offset to a UV offset. offset (in \u03C3 units) *
    // sigma_px = pixel offset; / uTexSize = UV offset.
    vec2 pxToUv = vec2(uRadius / uTexSize.x, uRadius / uTexSize.y);
${sampleCode}}
`
    );
  }
  function computeHighlightBlurTapCount(sigmaPx) {
    if (sigmaPx < 0.01) return 1;
    const n = 2 * Math.ceil(3 * sigmaPx) + 1;
    return Math.min(33, Math.max(3, n));
  }
  var init_separable_blur = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/separable-blur.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/kawase-blur.ts
  function kawaseIterationsForRadius(radius, quality = 1) {
    let base;
    if (radius < 1.5) base = 2;
    else if (radius < 3) base = 3;
    else if (radius < 6) base = 4;
    else if (radius < 12) base = 6;
    else base = 8;
    const scaled = Math.round(base * quality);
    return Math.max(MIN_KAWASE_ITERS, Math.min(MAX_KAWASE_ITERS, scaled));
  }
  function generateKawaseBlurShader() {
    return (
      /* glsl */
      `precision highp float;
uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uRadius;      // target Gaussian \u03C3 (px) \u2014 Kawase accumulates to match
uniform float uIteration;   // current iteration index, 0-based
uniform float uTotalIters;  // total iteration count N
void main() {
    vec2 uv = vec2(gl_FragCoord.x / uTexSize.x, gl_FragCoord.y / uTexSize.y);
    vec2 pxToUv = vec2(1.0 / uTexSize.x, 1.0 / uTexSize.y);
    // d_max = radius \xD7 \u221A(6N / ((N+1)(2N+1))) \u2014 variance-matched to Gaussian \u03C3.
    // d_i = d_max \xD7 (i+1)/N.
    float N = uTotalIters;
    float dMax = uRadius * sqrt(6.0 * N / ((N + 1.0) * (2.0 * N + 1.0)));
    float d = dMax * (uIteration + 1.0) / N;
    vec2 off = vec2(d, d) * pxToUv;
    // 4 diagonal taps (Kawase original): equal weight 0.25 each.
    vec4 s1 = texture2D(uTexture, uv + off);
    vec4 s2 = texture2D(uTexture, uv - off);
    vec4 s3 = texture2D(uTexture, uv + vec2(off.x, -off.y));
    vec4 s4 = texture2D(uTexture, uv + vec2(-off.x, off.y));
    // Premul-aware: RGB weighted by sample alpha, alpha = center.
    float aw1 = s1.a, aw2 = s2.a, aw3 = s3.a, aw4 = s4.a;
    float awSum = aw1 + aw2 + aw3 + aw4;
    vec3 rgb = awSum > 0.001 ? (s1.rgb * aw1 + s2.rgb * aw2 + s3.rgb * aw3 + s4.rgb * aw4) / awSum : vec3(0.0);
    float origA = texture2D(uTexture, uv).a;
    gl_FragColor = vec4(rgb, origA);
}
`
    );
  }
  var MAX_KAWASE_ITERS, MIN_KAWASE_ITERS;
  var init_kawase_blur = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/kawase-blur.ts"() {
      "use strict";
      MAX_KAWASE_ITERS = 8;
      MIN_KAWASE_ITERS = 2;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/index.ts
  var init_shaders = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/shaders/index.ts"() {
      "use strict";
      init_sdf();
      init_element();
      init_shadow();
      init_highlight();
      init_inner_shadow();
      init_scene_bg();
      init_scene_fg();
      init_separable_blur();
      init_kawase_blur();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/gl-utils.ts
  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("Shader compile error: " + log);
    }
    return sh;
  }
  function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error("Program link error: " + log);
    }
    return p;
  }
  function wrapText(ctx, text, maxW) {
    const tokens = text.split(/\s+/).filter((t) => t.length > 0);
    const lines = [];
    let cur = "";
    for (const token of tokens) {
      const test = cur ? cur + " " + token : token;
      if (ctx.measureText(test).width <= maxW) {
        cur = test;
        continue;
      }
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      for (const ch of token) {
        const t = cur + ch;
        if (ctx.measureText(t).width <= maxW || !cur) {
          cur = t;
        } else {
          lines.push(cur);
          cur = ch;
        }
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function easeIn(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x1 = 0.42, y1 = 0, x2 = 1, y2 = 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const xs = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
      const dxs = 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
      if (Math.abs(xs - t) < 1e-3) break;
      if (Math.abs(dxs) < 1e-6) break;
      s -= (xs - t) / dxs;
      s = Math.max(0, Math.min(1, s));
    }
    return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  }
  var init_gl_utils = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/gl-utils.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/perf-monitor.ts
  var PerfMonitor;
  var init_perf_monitor = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/perf-monitor.ts"() {
      "use strict";
      PerfMonitor = class {
        constructor() {
          /** Master toggle. When false, all increment methods are no-ops. */
          this.enabled = false;
          this.gl = null;
          // --- Frame timing ring buffer ---
          this.HISTORY_SIZE = 240;
          this.frameTimes = new Float32Array(this.HISTORY_SIZE);
          this.frameTimeIdx = 0;
          this.frameTimeCount = 0;
          /** Timestamp of the previous frameEnd() call. Used to compute the frame
           *  INTERVAL (frame-to-frame), NOT the render duration. The render duration
           *  (frameEnd - frameStart) can be sub-millisecond for a fast render, which
           *  would inflate FPS to thousands. The interval between consecutive
           *  frameEnd calls reflects the true rendered frame rate (≈16.67ms = 60fps
           *  when rendering every rAF tick). */
          this.prevFrameEndTime = 0;
          this.totalFrames = 0;
          this.jank16Count = 0;
          this.jank33Count = 0;
          // --- Per-frame counters (in-progress frame) ---
          this.drawCalls = 0;
          this.glassElements = 0;
          this.perElementFboCount = 0;
          this.pingPongCount = 0;
          this.nonGlassElements = 0;
          this.blurPasses = 0;
          this.dirtyElements = 0;
          this.totalElements = 0;
          this.cachedElements = 0;
          // --- Last completed frame counters (captured at frameEnd) ---
          this.lastDrawCalls = 0;
          this.lastGlassElements = 0;
          this.lastPerElementFboCount = 0;
          this.lastPingPongCount = 0;
          this.lastNonGlassElements = 0;
          this.lastBlurPasses = 0;
          this.lastDirtyElements = 0;
          this.lastTotalElements = 0;
          this.lastCachedElements = 0;
          this.lastFrameTimeMs = 0;
          // --- Static GPU info (collected lazily on first frameStart) ---
          this.gpuInfoCollected = false;
          this.gpuVendor = "";
          this.gpuRenderer = "";
          this.maxTextureSize = 0;
          this.extensionCount = 0;
          /** Set by the renderer after probing WEBGL_debug_renderer_info.
           *  Surfaced in the snapshot so the overlay can warn the user that the
           *  baseline cost is CPU rasterization (not shader passes). */
          this.isSoftwareRenderer = false;
          // --- Canvas info (pushed by the renderer each frame) ---
          this.canvasCssW = 0;
          this.canvasCssH = 0;
          this.canvasDevW = 0;
          this.canvasDevH = 0;
          this.dpr = 0;
          this.deviceDpr = 0;
        }
        attachGl(gl) {
          this.gl = gl;
        }
        collectGpuInfo() {
          if (!this.gl || this.gpuInfoCollected) return;
          this.gpuInfoCollected = true;
          const gl = this.gl;
          const dbgExt = gl.getExtension("WEBGL_debug_renderer_info");
          try {
            this.gpuVendor = dbgExt ? String(gl.getParameter(dbgExt.UNMASKED_VENDOR_WEBGL) || "") : String(gl.getParameter(gl.VENDOR) || "");
            this.gpuRenderer = dbgExt ? String(gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) || "") : String(gl.getParameter(gl.RENDERER) || "");
            this.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
            const exts = gl.getSupportedExtensions() || [];
            this.extensionCount = exts.length;
          } catch {
          }
        }
        /** Called at the top of render(). Resets per-frame counters.
         *  NOTE: we no longer record a start timestamp here — the frame time is
         *  measured as the interval between consecutive frameEnd() calls, which
         *  reflects the true rendered frame rate rather than the render duration. */
        frameStart() {
          if (!this.enabled) return;
          this.collectGpuInfo();
          this.drawCalls = 0;
          this.glassElements = 0;
          this.perElementFboCount = 0;
          this.pingPongCount = 0;
          this.nonGlassElements = 0;
          this.blurPasses = 0;
          this.dirtyElements = 0;
          this.totalElements = 0;
          this.cachedElements = 0;
        }
        /** Called at the bottom of render(). Records the frame INTERVAL (time
         *  since the previous frameEnd) into the ring buffer + captures counters.
         *
         *  Why interval not duration: render duration = frameEnd - frameStart can
         *  be sub-millisecond (0.2ms) for a fast render → 1000/0.2 = 5000 FPS,
         *  which is meaningless. The interval between consecutive frameEnd calls
         *  reflects how often frames are actually produced: ≈16.67ms = 60fps when
         *  rendering every rAF tick, larger when frames are skipped.
         *
         *  Gap filtering: if the interval > 500ms, the page was likely idle
         *  (needsRedraw was false for a while) — this isn't a real frame-to-frame
         *  interval, so we skip recording it in the timing ring buffer (but still
         *  count the frame + capture its counters). This keeps avg/min/max clean. */
        frameEnd() {
          if (!this.enabled) return;
          const now = performance.now();
          const dt = this.prevFrameEndTime > 0 ? now - this.prevFrameEndTime : 0;
          this.prevFrameEndTime = now;
          if (dt > 0 && dt <= 500) {
            this.lastFrameTimeMs = dt;
            this.frameTimes[this.frameTimeIdx] = dt;
            this.frameTimeIdx = (this.frameTimeIdx + 1) % this.HISTORY_SIZE;
            if (this.frameTimeCount < this.HISTORY_SIZE) this.frameTimeCount++;
            if (dt > 16.67) this.jank16Count++;
            if (dt > 33.33) this.jank33Count++;
          }
          this.totalFrames++;
          this.lastDrawCalls = this.drawCalls;
          this.lastGlassElements = this.glassElements;
          this.lastPerElementFboCount = this.perElementFboCount;
          this.lastPingPongCount = this.pingPongCount;
          this.lastNonGlassElements = this.nonGlassElements;
          this.lastBlurPasses = this.blurPasses;
          this.lastDirtyElements = this.dirtyElements;
          this.lastTotalElements = this.totalElements;
          this.lastCachedElements = this.cachedElements;
        }
        // --- Counter increments (called from renderer methods).
        //     Single boolean check → ~zero overhead when disabled. ---
        incDrawCall(n = 1) {
          if (this.enabled) this.drawCalls += n;
        }
        incGlassElement() {
          if (this.enabled) this.glassElements++;
        }
        incPerElementFbo() {
          if (this.enabled) this.perElementFboCount++;
        }
        incPingPong() {
          if (this.enabled) this.pingPongCount++;
        }
        incNonGlass() {
          if (this.enabled) this.nonGlassElements++;
        }
        incBlurPass() {
          if (this.enabled) this.blurPasses++;
        }
        incDirty() {
          if (this.enabled) this.dirtyElements++;
        }
        incTotal() {
          if (this.enabled) this.totalElements++;
        }
        incCachedElement() {
          if (this.enabled) this.cachedElements++;
        }
        /** Reset all accumulated stats (timing + counters + jank). */
        reset() {
          this.frameTimes.fill(0);
          this.frameTimeIdx = 0;
          this.frameTimeCount = 0;
          this.prevFrameEndTime = 0;
          this.totalFrames = 0;
          this.jank16Count = 0;
          this.jank33Count = 0;
          this.lastFrameTimeMs = 0;
          this.lastDrawCalls = 0;
          this.lastGlassElements = 0;
          this.lastPerElementFboCount = 0;
          this.lastPingPongCount = 0;
          this.lastSkipPingPongCount = 0;
          this.lastNonGlassElements = 0;
          this.lastBlurPasses = 0;
          this.lastDirtyElements = 0;
          this.lastTotalElements = 0;
          this.lastCachedElements = 0;
        }
        getSnapshot() {
          const history = [];
          if (this.frameTimeCount > 0) {
            if (this.frameTimeCount < this.HISTORY_SIZE) {
              for (let i = 0; i < this.frameTimeCount; i++) history.push(this.frameTimes[i]);
            } else {
              for (let i = 0; i < this.HISTORY_SIZE; i++) {
                history.push(this.frameTimes[(this.frameTimeIdx + i) % this.HISTORY_SIZE]);
              }
            }
          }
          let sum = 0, mn = Infinity, mx = 0;
          for (const v of history) {
            sum += v;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          const n = history.length;
          const avg = n > 0 ? sum / n : 0;
          const last = this.lastFrameTimeMs;
          return {
            frameTimeMs: last,
            avgFrameTimeMs: avg,
            minFrameTimeMs: n > 0 ? mn : 0,
            maxFrameTimeMs: n > 0 ? mx : 0,
            fps: last > 0 ? 1e3 / last : 0,
            avgFps: avg > 0 ? 1e3 / avg : 0,
            jank16Count: this.jank16Count,
            jank33Count: this.jank33Count,
            totalFrames: this.totalFrames,
            drawCalls: this.lastDrawCalls,
            glassElements: this.lastGlassElements,
            perElementFboCount: this.lastPerElementFboCount,
            pingPongCount: this.lastPingPongCount,
            nonGlassElements: this.lastNonGlassElements,
            blurPasses: this.lastBlurPasses,
            dirtyElements: this.lastDirtyElements,
            totalElements: this.lastTotalElements,
            cachedElements: this.lastCachedElements,
            gpuVendor: this.gpuVendor,
            gpuRenderer: this.gpuRenderer,
            maxTextureSize: this.maxTextureSize,
            extensionCount: this.extensionCount,
            isSoftwareRenderer: this.isSoftwareRenderer,
            canvasCssW: this.canvasCssW,
            canvasCssH: this.canvasCssH,
            canvasDevW: this.canvasDevW,
            canvasDevH: this.canvasDevH,
            dpr: this.dpr,
            deviceDpr: this.deviceDpr,
            pixelsPerFrame: this.canvasDevW * this.canvasDevH,
            history,
            timestamp: performance.now()
          };
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-fbo.ts
  var fboMethods;
  var init_methods_fbo = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-fbo.ts"() {
      "use strict";
      init_shaders();
      fboMethods = {
        createFBO(w, h) {
          const gl = this.gl;
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const fb = gl.createFramebuffer();
          this.bindFbRaw(gl, gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          this.bindFbRaw(gl, gl.FRAMEBUFFER, null);
          return { fb, tex };
        },
        resizeFBOs(w, h, force = false) {
          if (!force && this.fboW === w && this.fboH === h && this.fboA && this.fboB) return;
          const gl = this.gl;
          if (this.fboA) gl.deleteFramebuffer(this.fboA);
          if (this.fboATex) gl.deleteTexture(this.fboATex);
          if (this.fboB) gl.deleteFramebuffer(this.fboB);
          if (this.fboBTex) gl.deleteTexture(this.fboBTex);
          const a = this.createFBO(w, h);
          const b = this.createFBO(w, h);
          this.fboA = a.fb;
          this.fboATex = a.tex;
          this.fboB = b.fb;
          this.fboBTex = b.tex;
          if (this.tabsBackdropFbo) gl.deleteFramebuffer(this.tabsBackdropFbo);
          if (this.tabsBackdropTex) gl.deleteTexture(this.tabsBackdropTex);
          const tb = this.createFBO(w, h);
          this.tabsBackdropFbo = tb.fb;
          this.tabsBackdropTex = tb.tex;
          this.tabsBackdropDirty = true;
          if (this.wallpaperBlurFbo) gl.deleteFramebuffer(this.wallpaperBlurFbo);
          if (this.wallpaperBlurTex) gl.deleteTexture(this.wallpaperBlurTex);
          if (this.blurFboA) gl.deleteFramebuffer(this.blurFboA);
          if (this.blurFboATex) gl.deleteTexture(this.blurFboATex);
          if (this.blurFboB) gl.deleteFramebuffer(this.blurFboB);
          if (this.blurFboBTex) gl.deleteTexture(this.blurFboBTex);
          if (this.dsBlurFboA) gl.deleteFramebuffer(this.dsBlurFboA);
          if (this.dsBlurFboATex) gl.deleteTexture(this.dsBlurFboATex);
          if (this.dsBlurFboB) gl.deleteFramebuffer(this.dsBlurFboB);
          if (this.dsBlurFboBTex) gl.deleteTexture(this.dsBlurFboBTex);
          for (const lvl of this.dsBlurLevels) {
            gl.deleteFramebuffer(lvl.fboA);
            gl.deleteTexture(lvl.texA);
            gl.deleteFramebuffer(lvl.fboB);
            gl.deleteTexture(lvl.texB);
          }
          this.dsBlurLevels = [];
          const rawDs = Math.max(1, this.blurDownsample);
          const ds = rawDs <= 1 ? 1 : Math.max(1, Math.min(rawDs * (this.dpr || 1), 64));
          this.effectiveBlurDownsample = ds;
          const ge = this.createFBO(w, h);
          const ba = this.createFBO(w, h);
          const bb = this.createFBO(w, h);
          this.wallpaperBlurFbo = ge.fb;
          this.wallpaperBlurTex = ge.tex;
          this.blurFboA = ba.fb;
          this.blurFboATex = ba.tex;
          this.blurFboB = bb.fb;
          this.blurFboBTex = bb.tex;
          const legacyW = Math.max(1, Math.floor(w / ds));
          const legacyH = Math.max(1, Math.floor(h / ds));
          const legacyA = this.createFBO(legacyW, legacyH);
          const legacyB = this.createFBO(legacyW, legacyH);
          this.dsBlurFboA = legacyA.fb;
          this.dsBlurFboATex = legacyA.tex;
          this.dsBlurFboB = legacyB.fb;
          this.dsBlurFboBTex = legacyB.tex;
          this.dsBlurFboW = legacyW;
          this.dsBlurFboH = legacyH;
          const levels = [];
          for (let d = 1; d <= ds; d *= 2) levels.push(d);
          for (const d of levels) {
            const lw = Math.max(1, Math.floor(w / d));
            const lh = Math.max(1, Math.floor(h / d));
            const la = this.createFBO(lw, lh);
            const lb = this.createFBO(lw, lh);
            this.dsBlurLevels.push({ ds: d, fboA: la.fb, texA: la.tex, fboB: lb.fb, texB: lb.tex, w: lw, h: lh });
          }
          if (this.highlightMaskFbo) gl.deleteFramebuffer(this.highlightMaskFbo);
          if (this.highlightMaskTex) gl.deleteTexture(this.highlightMaskTex);
          const hm = this.createFBO(w, h);
          this.highlightMaskFbo = hm.fb;
          this.highlightMaskTex = hm.tex;
          if (this.dialogBackdropFbo) gl.deleteFramebuffer(this.dialogBackdropFbo);
          if (this.dialogBackdropTex) gl.deleteTexture(this.dialogBackdropTex);
          const db = this.createFBO(w, h);
          this.dialogBackdropFbo = db.fb;
          this.dialogBackdropTex = db.tex;
          this.dialogBackdropKey = null;
          if (this.bgOnlyFbo) gl.deleteFramebuffer(this.bgOnlyFbo);
          if (this.bgOnlyTex) gl.deleteTexture(this.bgOnlyTex);
          const bg = this.createFBO(w, h);
          this.bgOnlyFbo = bg.fb;
          this.bgOnlyTex = bg.tex;
          const sizeChanged = this.fboW !== w || this.fboH !== h;
          this.fboW = w;
          this.fboH = h;
          if (sizeChanged) this.clearBackdropBlurCache();
        },
        /** Clear the backdrop blur cache: delete all cached GL textures + FBOs +
         *  empty the Map + pool. Called on resize (cover-fit changes) +
         *  loadWallpaper (content changes). Everything is deleted (not pooled)
         *  because resize may change fboW/fboH, making pooled tex the wrong size. */
        clearBackdropBlurCache() {
          const gl = this.gl;
          for (const entry of this.backdropBlurCache.values()) {
            gl.deleteTexture(entry.tex);
            gl.deleteFramebuffer(entry.fb);
          }
          this.backdropBlurCache.clear();
          for (const p of this.backdropBlurCacheFboPool) {
            gl.deleteTexture(p.tex);
            gl.deleteFramebuffer(p.fb);
          }
          this.backdropBlurCacheFboPool.length = 0;
          this.backdropBlurCacheSnapshots.length = 0;
          if (this.cacheCopyReadFbo) {
            gl.deleteFramebuffer(this.cacheCopyReadFbo);
            this.cacheCopyReadFbo = null;
          }
        },
        /** Evict oldest entries (Map insertion order) while the cache exceeds
         *  backdropBlurCacheMax. Evicted {fb, tex} are returned to the FBO pool
         *  (not deleted) so the next cache miss can reuse them without GL
         *  allocation. Called after every cache-miss insert in both the
         *  independent (wallpaper) and scene blur paths. */
        evictBackdropBlurCacheIfNeeded() {
          while (this.backdropBlurCache.size > this.backdropBlurCacheMax) {
            const oldest = this.backdropBlurCache.keys().next().value;
            if (!oldest) break;
            const oldEntry = this.backdropBlurCache.get(oldest);
            if (oldEntry) this.releaseCacheFBO(oldEntry);
            this.backdropBlurCache.delete(oldest);
          }
          while (this.backdropBlurCacheSnapshots.length > this.backdropBlurCacheMax) {
            this.backdropBlurCacheSnapshots.shift();
          }
        },
        /** Acquire a cache {fb, tex, w, h}. Reuses a size-matched entry from the
         *  pool if available (tex already has filtering/wrap set + correct size,
         *  so copyTexImage2D just overwrites pixels — no texImage2D reallocation);
         *  otherwise creates a fresh tex+fb via createFBO. */
        acquireCacheFBO(w, h) {
          const pool = this.backdropBlurCacheFboPool;
          for (let i = pool.length - 1; i >= 0; i--) {
            const p = pool[i];
            if (p.w === w && p.h === h) {
              pool.splice(i, 1);
              return p;
            }
          }
          const fresh = this.createFBO(w, h);
          return { fb: fresh.fb, tex: fresh.tex, w, h };
        },
        /** Return a cache {fb, tex, w, h} to the pool for reuse. No GL deletion. */
        releaseCacheFBO(entry) {
          this.backdropBlurCacheFboPool.push(entry);
        },
        /** Bind an FBO as the render target, set viewport to its size. */
        bindFBO(fb) {
          const gl = this.gl;
          this.bindFbRaw(gl, gl.FRAMEBUFFER, fb);
          gl.viewport(0, 0, this.fboW, this.fboH);
        },
        /** Fullscreen copy pass: copy src texture to the currently-bound FBO.
         *  Used for ping-pong blits (fboA → fboB) and the final blit to the
         *  default framebuffer (fboA → canvas). The caller must have already
         *  bound the destination FBO. */
        drawCopy(srcTex) {
          const gl = this.gl;
          gl.useProgram(this.copyProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocCp);
          gl.vertexAttribPointer(this.aPosLocCp, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.uniform1i(this.uCp["uTexture"], 0);
          gl.uniform2f(this.uCp["uCanvasSize"], this.fboW, this.fboH);
          gl.disable(gl.BLEND);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        },
        /** Fullscreen solid-color fill — used when backgroundColor is set
         *  (e.g. black for the Home page). The caller must have already bound
         *  the destination FBO. */
        drawSolidFill(r, g, b, a) {
          const gl = this.gl;
          gl.useProgram(this.solidFillProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocSf);
          gl.vertexAttribPointer(this.aPosLocSf, 2, gl.FLOAT, false, 0, 0);
          gl.uniform4f(this.uSf["uColor"], r, g, b, a);
          gl.disable(gl.BLEND);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        },
        /** Fullscreen colorControls pass — copies srcTex to the bound FBO applying
         *  brightness/contrast/saturation. Caller must bind the destination FBO. */
        drawColorControls(srcTex, brightness, contrast, saturation) {
          const gl = this.gl;
          gl.useProgram(this.colorControlsProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocCc);
          gl.vertexAttribPointer(this.aPosLocCc, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.uniform1i(this.uCc["uTexture"], 0);
          gl.uniform2f(this.uCc["uTexSize"], this.fboW, this.fboH);
          gl.uniform1f(this.uCc["uBrightness"], brightness);
          gl.uniform1f(this.uCc["uContrast"], contrast);
          gl.uniform1f(this.uCc["uSaturation"], saturation);
          gl.disable(gl.BLEND);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        },
        /** Ensure the per-element FBO (elFbo) + backdrop crop FBO + element blur
         *  ping-pong FBOs exist at (w,h) device px. Lazily recreated when the
         *  required size changes. Returns the actual size used.
         *
         *  No clamp: the caller already clamps bbox to the canvas (fboW/fboH), so
         *  the elFbo never exceeds the scene FBO size. The old MAX_ELEMENT_FBO_SIZE
         *  = 1024 clamp + the bbox>1024 fallback in renderGlassElement have been
         *  removed — all glass elements now unconditionally use the PEF path. */
        ensureElementFBO(w, h) {
          const cw = Math.max(1, Math.round(w));
          const ch = Math.max(1, Math.round(h));
          if (this.elFboW === cw && this.elFboH === ch && this.elFbo && this.backdropCropFbo && this.elBlurFboA && this.elBlurFboB) {
            return { w: cw, h: ch };
          }
          const gl = this.gl;
          if (this.elFbo) gl.deleteFramebuffer(this.elFbo);
          if (this.elFboTex) gl.deleteTexture(this.elFboTex);
          const ef = this.createFBO(cw, ch);
          this.elFbo = ef.fb;
          this.elFboTex = ef.tex;
          if (this.backdropCropFbo) gl.deleteFramebuffer(this.backdropCropFbo);
          if (this.backdropCropTex) gl.deleteTexture(this.backdropCropTex);
          const bc = this.createFBO(cw, ch);
          this.backdropCropFbo = bc.fb;
          this.backdropCropTex = bc.tex;
          if (this.elBlurFboA) gl.deleteFramebuffer(this.elBlurFboA);
          if (this.elBlurFboATex) gl.deleteTexture(this.elBlurFboATex);
          if (this.elBlurFboB) gl.deleteFramebuffer(this.elBlurFboB);
          if (this.elBlurFboBTex) gl.deleteTexture(this.elBlurFboBTex);
          const ba = this.createFBO(cw, ch);
          const bb = this.createFBO(cw, ch);
          this.elBlurFboA = ba.fb;
          this.elBlurFboATex = ba.tex;
          this.elBlurFboB = bb.fb;
          this.elBlurFboBTex = bb.tex;
          this.elFboW = cw;
          this.elFboH = ch;
          return { w: cw, h: ch };
        },
        /** Scissor-crop a region of srcTex (fullscreen scene FBO texture) into
         *  backdropCropFbo. If blurRadius > 0, also runs a 2-pass separable Gaussian
         *  on the cropped result (using elBlurFboA/B) and returns blurFboBTex;
         *  otherwise returns backdropCropTex.
         *  (srcX, srcY) is the region top-left in the SOURCE texture, TOP-LEFT
         *  origin, device px. (srcW, srcH) is the region size. The destination
         *  FBO (backdropCropFbo) is assumed to already be at least (srcW, srcH). */
        cropAndBlurBackdrop(srcTex, srcX, srcY, srcW, srcH, blurRadius) {
          const gl = this.gl;
          const dw = this.elFboW;
          const dh = this.elFboH;
          this.bindFbRaw(gl, gl.FRAMEBUFFER, this.backdropCropFbo);
          gl.viewport(0, 0, dw, dh);
          gl.disable(gl.BLEND);
          gl.useProgram(this.elFboCropProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocEc);
          gl.vertexAttribPointer(this.aPosLocEc, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.uniform1i(this.uEc["uTexture"], 0);
          gl.uniform2f(this.uEc["uSrcOffset"], srcX, srcY);
          gl.uniform2f(this.uEc["uSrcSize"], this.fboW, this.fboH);
          gl.uniform2f(this.uEc["uDstSize"], dw, dh);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          if (blurRadius < 0.5) {
            return this.backdropCropTex;
          }
          if (this.useKawaseBlur) {
            const iters = kawaseIterationsForRadius(blurRadius, this.kawaseQuality);
            const dMax = blurRadius * Math.sqrt(6 * iters / ((iters + 1) * (2 * iters + 1)));
            this.lastBlurStats = { type: "kawase", passes: iters, taps: 4 * iters, maxSample: dMax * Math.SQRT2 };
            this.ensureKawaseProgram();
            const kp = this.kawasePrograms;
            const savedFb = this.glStateCached(gl).fb;
            const savedScissor = this.glStateCached(gl).scissor;
            const savedBox = this.glStateCached(gl).box;
            this.scissorTestRaw(gl, false);
            gl.disable(gl.BLEND);
            let curSrc = this.backdropCropTex;
            for (let i = 0; i < iters; i++) {
              const writeFboA = i % 2 === 0;
              const dstFbo = writeFboA ? this.elBlurFboA : this.elBlurFboB;
              this.bindFbRaw(gl, gl.FRAMEBUFFER, dstFbo);
              gl.viewport(0, 0, dw, dh);
              gl.useProgram(kp.prog);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
              gl.enableVertexAttribArray(kp.aPos);
              gl.vertexAttribPointer(kp.aPos, 2, gl.FLOAT, false, 0, 0);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, curSrc);
              gl.uniform1i(kp.uTexture, 0);
              gl.uniform2f(kp.uTexSize, dw, dh);
              gl.uniform1f(kp.uRadius, blurRadius);
              gl.uniform1f(kp.uIteration, i);
              gl.uniform1f(kp.uTotalIters, iters);
              gl.drawArrays(gl.TRIANGLES, 0, 6);
              curSrc = writeFboA ? this.elBlurFboATex : this.elBlurFboBTex;
            }
            this.bindFbRaw(gl, gl.FRAMEBUFFER, savedFb);
            gl.viewport(0, 0, this.fboW, this.fboH);
            if (savedScissor) {
              this.scissorTestRaw(gl, true);
              this.scissorRaw(gl, savedBox[0], savedBox[1], savedBox[2], savedBox[3]);
            }
            const lastWroteA = (iters - 1) % 2 === 0;
            return lastWroteA ? this.elBlurFboATex : this.elBlurFboBTex;
          }
          let taps = computeBlur1DTapCount(blurRadius);
          taps = Math.min(taps, Math.max(1, this.blurTapCap | 0));
          this.lastBlurStats = { type: "gauss", passes: 2, taps, maxSample: 3 * blurRadius };
          return this.runBlurPasses(
            this.backdropCropTex,
            this.elBlurFboA,
            this.elBlurFboATex,
            this.elBlurFboB,
            this.elBlurFboBTex,
            dw,
            dh,
            blurRadius,
            taps,
            true
          );
        },
        /** Composite the per-element FBO texture onto the currently-bound (fullscreen)
         *  scene FBO at the element's SCALED + ROTATED on-screen position. The elFbo
         *  contains un-rotated glass at baseline resolution; this shader applies
         *  rotation + zoom + translation to place it on screen.
         *
         *  Caller should set scissor to the rotated AABB of the scaled element
         *  (sw*|cos|+sh*|sin| × sw*|sin|+sh*|cos|) + have blending enabled. */
        drawElFboComposite(srcTex, srcW, srcH, elementCenterX, elementCenterY, elementW, elementH, rotation) {
          const gl = this.gl;
          gl.useProgram(this.elFboCompositeProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocEf);
          gl.vertexAttribPointer(this.aPosLocEf, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.uniform1i(this.uEf["uTexture"], 0);
          gl.uniform2f(this.uEf["uCanvasSize"], this.fboW, this.fboH);
          gl.uniform2f(this.uEf["uElementCenter"], elementCenterX, elementCenterY);
          gl.uniform2f(this.uEf["uElementSize"], elementW, elementH);
          gl.uniform1f(this.uEf["uRotation"], rotation);
          gl.uniform2f(this.uEf["uSrcSize"], srcW, srcH);
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        },
        /** Intersect a scissor rect (device px, BL origin) with el.clipRect (CSS px,
         *  top-left origin). No-op when clipRect is absent. Used by the TextGlass
         *  scrollable sheet to clip content to the sheet card's visible bounds. */
        intersectClipScissor(el, scX, scY, scW, scH) {
          const clip = el.clipRect;
          if (!clip) return { x: scX, y: scY, w: scW, h: scH };
          const clipX = Math.round(clip.x * this.dpr);
          const clipY = Math.round((this.cssHeight - (clip.y + clip.h)) * this.dpr);
          const clipW = Math.round(clip.w * this.dpr);
          const clipH = Math.round(clip.h * this.dpr);
          const ix0 = Math.max(scX, clipX);
          const iy0 = Math.max(scY, clipY);
          const ix1 = Math.min(scX + scW, clipX + clipW);
          const iy1 = Math.min(scY + scH, clipY + clipH);
          return {
            x: ix0,
            y: iy0,
            w: Math.max(0, ix1 - ix0),
            h: Math.max(0, iy1 - iy0)
          };
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/continuous-curve.ts
  function solveCubicSingle(a, b, c, d) {
    const f = (3 * c / a - b * b / (a * a)) / 3;
    const g = (2 * b * b * b / (a * a * a) - 9 * b * c / (a * a) + 27 * d / a) / 27;
    const h = g * g / 4 + f * f * f / 27;
    const sqrtH = Math.sqrt(h);
    return Math.cbrt(-g / 2 + sqrtH) + Math.cbrt(-g / 2 - sqrtH) - b / (3 * a);
  }
  function solveDepressedQuarticSingle(p, q, r) {
    const b = -p / 2;
    const c = -r;
    const d = r * p / 2 - q * q / 8;
    const f = (3 * c - b * b) / 3;
    const g = (2 * b * b * b - 9 * b * c + 27 * d) / 27;
    const rVal = Math.sqrt(-f * f * f / 27);
    const phi = Math.acos(-g / (2 * rVal));
    const y = 2 * Math.sqrt(-f / 3) * Math.cos(phi / 3);
    const z = y - b / 3;
    const u = Math.sqrt(2 * z - p);
    return (u - Math.sqrt(u * u - 4 * (z + q / (2 * u)))) / 2;
  }
  function continuousCurvatureRoundedRectPath(ctx, w, h, radius) {
    const builder = new ContinuousCurvatureRoundedRectangleCornerBuilder();
    const r = radius;
    const tW = Math.max(0, Math.min(1, (w * 0.5 - r) / r));
    const tH = Math.max(0, Math.min(1, (h * 0.5 - r) / r));
    const p = builder.getCornerBezierPoints(tW, tH);
    if (p.length < 20) return new Path2D();
    const path = new Path2D();
    let x = w - r;
    let y = 0;
    path.moveTo(x + p[0] * r, y + p[1] * r);
    path.bezierCurveTo(x + p[2] * r, y + p[3] * r, x + p[4] * r, y + p[5] * r, x + p[6] * r, y + p[7] * r);
    path.bezierCurveTo(x + p[8] * r, y + p[9] * r, x + p[10] * r, y + p[11] * r, x + p[12] * r, y + p[13] * r);
    path.bezierCurveTo(x + p[14] * r, y + p[15] * r, x + p[16] * r, y + p[17] * r, x + p[18] * r, y + p[19] * r);
    x = w - r;
    y = h;
    path.lineTo(x + p[18] * r, y - p[19] * r);
    path.bezierCurveTo(x + p[16] * r, y - p[17] * r, x + p[14] * r, y - p[15] * r, x + p[12] * r, y - p[13] * r);
    path.bezierCurveTo(x + p[10] * r, y - p[11] * r, x + p[8] * r, y - p[9] * r, x + p[6] * r, y - p[7] * r);
    path.bezierCurveTo(x + p[4] * r, y - p[5] * r, x + p[2] * r, y - p[3] * r, x + p[0] * r, y - p[1] * r);
    x = r;
    y = h;
    path.lineTo(x - p[0] * r, y - p[1] * r);
    path.bezierCurveTo(x - p[2] * r, y - p[3] * r, x - p[4] * r, y - p[5] * r, x - p[6] * r, y - p[7] * r);
    path.bezierCurveTo(x - p[8] * r, y - p[9] * r, x - p[10] * r, y - p[11] * r, x - p[12] * r, y - p[13] * r);
    path.bezierCurveTo(x - p[14] * r, y - p[15] * r, x - p[16] * r, y - p[17] * r, x - p[18] * r, y - p[19] * r);
    x = r;
    y = 0;
    path.lineTo(x - p[18] * r, y + p[19] * r);
    path.bezierCurveTo(x - p[16] * r, y + p[17] * r, x - p[14] * r, y + p[15] * r, x - p[12] * r, y + p[13] * r);
    path.bezierCurveTo(x - p[10] * r, y + p[11] * r, x - p[8] * r, y + p[9] * r, x - p[6] * r, y + p[7] * r);
    path.bezierCurveTo(x - p[4] * r, y + p[5] * r, x - p[2] * r, y + p[3] * r, x - p[0] * r, y + p[1] * r);
    path.closePath();
    return path;
  }
  var SQRT_2, FRAC_PI_4, FRAC_1_SQRT_2, ContinuousCurvatureRoundedRectangleCornerBuilder;
  var init_continuous_curve = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/continuous-curve.ts"() {
      "use strict";
      SQRT_2 = 1.4142135623730951;
      FRAC_PI_4 = 0.7853981633974483;
      FRAC_1_SQRT_2 = 0.7071067811865476;
      ContinuousCurvatureRoundedRectangleCornerBuilder = class {
        constructor(extendedFraction = 2 / 3, arcFraction = 0.5) {
          this.extendedFraction = extendedFraction;
          this.arcFraction = arcFraction;
          this.theta = (1 - arcFraction) * FRAC_PI_4;
          this.cos = Math.cos(this.theta);
          this.sin = Math.sin(this.theta);
          this.cot = 1 / Math.tan(this.theta);
          this.cos2 = this.cos * this.cos;
          this.sin2 = this.sin * this.sin;
          this.cos3 = this.cos2 * this.cos;
          this.sin3 = this.sin2 * this.sin;
          const cos = this.cos;
          const sin = this.sin;
          const cot = this.cot;
          const cos2 = this.cos2;
          const sin2 = this.sin2;
          const cos3 = this.cos3;
          const sin3 = this.sin3;
          this.k0 = 27 * (SQRT_2 - 6 * cos + 6 * SQRT_2 * cos2 - 4 * cos3) * cot + 2 * sin * (-9 + 2 * (SQRT_2 - 2 * sin) * sin3 + 2 * SQRT_2 * cos * (9 + sin2) - 2 * cos2 * (9 + 2 * sin2));
          this.k1 = -81 * (-2 + SQRT_2 + 4 * (-1 + SQRT_2) * cos + 2 * (-2 + SQRT_2) * cos2) * cot - 4 * sin * (-9 + 9 * SQRT_2 + SQRT_2 * sin3 + (-2 + SQRT_2) * cos * (9 + sin2));
          this.k2 = 9 * (9 * (-4 + 3 * SQRT_2 + (-6 + 4 * SQRT_2) * cos) * cot + (-6 + 4 * SQRT_2) * sin);
          this.k3 = 27 * (10 - 7 * SQRT_2) * cot;
        }
        buildEvenCornerBezierPoints(t) {
          const k = this.extendedFraction * t;
          const kappa = solveCubicSingle(this.k3, this.k2, this.k1 + 8 * -k * this.sin3 * this.sin, this.k0);
          const x3 = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + this.sin) / kappa;
          const y3 = 1 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - this.cos) / kappa;
          const x2 = x3 - y3 * this.cot;
          const x1 = x2 - 1.5 * kappa * y3 * y3 / this.sin3;
          const x0 = -k;
          const x6 = 1 - y3;
          const y6 = 1 - x3;
          const y7 = 1 - x2;
          const y8 = 1 - x1;
          const y9 = 1 - x0;
          const a = 1.5 * kappa;
          const g = this.cos2 - this.sin2;
          const x36 = x6 - x3;
          const y36 = y6 - y3;
          const c = -(this.cos * y36 - this.sin * x36);
          const lambda = (-g + Math.sqrt(g * g - 4 * a * c)) / (2 * a);
          const x4 = x3 + lambda * this.cos;
          const y4 = y3 + lambda * this.sin;
          const x5 = x6 - lambda * this.sin;
          const y5 = y6 - lambda * this.cos;
          return [x0, 0, x1, 0, x2, 0, x3, y3, x4, y4, x5, y5, x6, y6, 1, y7, 1, y8, 1, y9];
        }
        buildUnevenCornerBezierPoints(tH, tV) {
          const kH = this.extendedFraction * tH;
          const kV = this.extendedFraction * tV;
          const kappa3 = solveCubicSingle(this.k3, this.k2, this.k1 + 8 * -kH * this.sin3 * this.sin, this.k0);
          const kappa6 = solveCubicSingle(this.k3, this.k2, this.k1 + 8 * -kV * this.sin3 * this.sin, this.k0);
          const x3 = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + this.sin) / kappa3;
          const y3 = 1 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - this.cos) / kappa3;
          const x2 = x3 - y3 * this.cot;
          const x1 = x2 - 1.5 * kappa3 * y3 * y3 / this.sin3;
          const x0 = -kH;
          const x3p = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + this.sin) / kappa6;
          const y3p = 1 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - this.cos) / kappa6;
          const x2p = x3p - y3p * this.cot;
          const x1p = x2p - 1.5 * kappa6 * y3p * y3p / this.sin3;
          const x0p = -kV;
          const x6 = 1 - y3p;
          const y6 = 1 - x3p;
          const y7 = 1 - x2p;
          const y8 = 1 - x1p;
          const y9 = 1 - x0p;
          const a = 1.5 * kappa3;
          const b = 1.5 * kappa6;
          const g = this.cos2 - this.sin2;
          const x36 = x6 - x3;
          const y36 = y6 - y3;
          const c = -(this.cos * y36 - this.sin * x36);
          const d = this.sin * y36 - this.cos * x36;
          const p = 2 * (d / b);
          const q = g * g * g / (a * b * b);
          const r = (a * d * d + c * g * g) / (a * b * b);
          const lambda6 = solveDepressedQuarticSingle(p, q, r);
          const lambda3 = (-d - b * lambda6 * lambda6) / g;
          const x4 = x3 + lambda3 * this.cos;
          const y4 = y3 + lambda3 * this.sin;
          const x5 = x6 - lambda6 * this.sin;
          const y5 = y6 - lambda6 * this.cos;
          return [x0, 0, x1, 0, x2, 0, x3, y3, x4, y4, x5, y5, x6, y6, 1, y7, 1, y8, 1, y9];
        }
        /** Returns 20 Bezier control point values (10 pairs) for one corner.
         *  tW = (w/2 - r) / r clamped to [0,1], tH = (h/2 - r) / r clamped to [0,1].
         *  These define 3 cubic Bezier segments forming the G2-continuous corner. */
        getCornerBezierPoints(tW, tV) {
          const i = tW === 0 ? 0 : tW === 1 ? 1 : -1;
          const j = tV === 0 ? 0 : tV === 1 ? 1 : -1;
          if (i >= 0 && j >= 0) {
            if (i === 0 && j === 0) return this.buildEvenCornerBezierPoints(0);
            if (i === 1 && j === 1) return this.buildEvenCornerBezierPoints(1);
            return this.buildUnevenCornerBezierPoints(i === 1 ? 1 : 0, j === 1 ? 1 : 0);
          }
          return this.buildUnevenCornerBezierPoints(
            Math.max(0, Math.min(1, tW)),
            Math.max(0, Math.min(1, tV))
          );
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/continuous-mask.ts
  function getMaskCacheEntries() {
    return Array.from(maskCache.entries()).map(([key, v]) => ({
      key,
      tex: v.tex,
      texSize: v.texSize
    }));
  }
  function generateContinuousCurvatureMask(w, h, radius, dpr = 1, quality = 1, skipSdf = false) {
    const devMaxDim = Math.max(w, h) * (dpr || 1);
    const target = devMaxDim * 2;
    let baseTexSize = 128;
    while (baseTexSize < target && baseTexSize < 1024) baseTexSize <<= 1;
    const texSize = Math.max(32, Math.ceil(baseTexSize * quality));
    const key = `${w},${h},${radius},${texSize},s${skipSdf ? 1 : 0}`;
    const cached = maskCache.get(key);
    if (cached) {
      maskCache.delete(key);
      maskCache.set(key, cached);
      if (capsuleSdfTimings.length >= TIMING_RING_SIZE) capsuleSdfTimings.shift();
      capsuleSdfTimings.push({
        timestamp: performance.now(),
        key,
        w,
        h,
        radius,
        texSize,
        cacheHit: true,
        stepCanvasSetup: 0,
        stepPathDraw: 0,
        stepGetImageData: 0,
        stepAlphaExtract: 0,
        stepInitArrays: 0,
        stepForwardPass: 0,
        stepBackwardPass: 0,
        stepPack: 0,
        stepTotal: 0
      });
      return { tex: cached.tex, texSize };
    }
    const t0 = performance.now();
    const maxDim = Math.max(w, h);
    const aspectW = w / maxDim;
    const aspectH = h / maxDim;
    const canvas = document.createElement("canvas");
    canvas.width = texSize;
    canvas.height = texSize;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, texSize, texSize);
    const t1 = performance.now();
    const margin = 4;
    const drawW = (texSize - 2 * margin) * aspectW;
    const drawH = (texSize - 2 * margin) * aspectH;
    const offsetX = (texSize - drawW) / 2;
    const offsetY = (texSize - drawH) / 2;
    const scale = drawW / w;
    const drawRadius = radius * scale;
    const path = continuousCurvatureRoundedRectPath(ctx, drawW, drawH, drawRadius);
    ctx.fillStyle = "white";
    ctx.translate(offsetX, offsetY);
    ctx.fill(path);
    ctx.translate(-offsetX, -offsetY);
    const t2 = performance.now();
    const imageData = ctx.getImageData(0, 0, texSize, texSize);
    const t3 = performance.now();
    const N = texSize * texSize;
    if (_alphaBuf.length < N) {
      _alphaBuf = new Uint8Array(N);
      _insideBuf = new Int32Array(N);
      _outsideBuf = new Int32Array(N);
      _texBuf = new Uint8Array(N * 4);
    }
    const alpha = _alphaBuf;
    const inside = _insideBuf;
    const outside = _outsideBuf;
    const INF = 2147483647;
    const data32 = new Uint32Array(imageData.data.buffer);
    for (let i = 0; i < N; i++) {
      const a = data32[i] >>> 24 & 255;
      alpha[i] = a;
      if (a > 128) {
        inside[i] = 0;
        outside[i] = INF;
      } else {
        inside[i] = INF;
        outside[i] = 0;
      }
    }
    const t4 = performance.now();
    const t5 = t4;
    let t6 = t5;
    let t7 = t5;
    if (!skipSdf) {
      const ts = texSize;
      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const idx = y * ts + x;
          let ins = inside[idx];
          let out = outside[idx];
          if (x > 0 && y > 1) {
            const k = idx - ts - 1 - ts;
            const v = 11;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x > 0) {
            const k = idx - 1;
            const v = 5;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x > 0 && y > 0) {
            const k = idx - ts - 1;
            const v = 7;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (y > 0) {
            const k = idx - ts;
            const v = 5;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x < ts - 1 && y > 0) {
            const k = idx - ts + 1;
            const v = 7;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x < ts - 2 && y > 0) {
            const k = idx - ts + 2;
            const v = 11;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          inside[idx] = ins;
          outside[idx] = out;
        }
      }
      t6 = performance.now();
      for (let y = ts - 1; y >= 0; y--) {
        for (let x = ts - 1; x >= 0; x--) {
          const idx = y * ts + x;
          let ins = inside[idx];
          let out = outside[idx];
          if (x < ts - 1 && y < ts - 2) {
            const k = idx + ts + 1 + ts;
            const v = 11;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x < ts - 1) {
            const k = idx + 1;
            const v = 5;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x < ts - 1 && y < ts - 1) {
            const k = idx + ts + 1;
            const v = 7;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (y < ts - 1) {
            const k = idx + ts;
            const v = 5;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x > 0 && y < ts - 1) {
            const k = idx + ts - 1;
            const v = 7;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          if (x > 1 && y < ts - 1) {
            const k = idx + ts - 2;
            const v = 11;
            const ti = inside[k] + v;
            if (ti < ins) ins = ti;
            const to = outside[k] + v;
            if (to < out) out = to;
          }
          inside[idx] = ins;
          outside[idx] = out;
        }
      }
      t7 = performance.now();
    }
    const refDist = drawRadius;
    const tex = _texBuf;
    const tex32 = new Uint32Array(tex.buffer);
    const ALPHA_OPAQUE = 4278190080;
    if (skipSdf) {
      for (let i = 0; i < N; i++) {
        tex32[i] = ALPHA_OPAQUE | alpha[i];
      }
    } else {
      for (let i = 0; i < N; i++) {
        const sd = (inside[i] - outside[i]) / 5;
        const normalized = sd / refDist > 1 ? 1 : sd / refDist < -1 ? -1 : sd / refDist;
        const g = (normalized * 0.5 + 0.5) * 255 + 0.5 | 0;
        tex32[i] = ALPHA_OPAQUE | g << 8 | alpha[i];
      }
    }
    const t8 = performance.now();
    const texCopy = tex.slice(0, N * 4);
    maskCache.set(key, { tex: texCopy, texSize });
    maskCacheBytes += texCopy.byteLength;
    while (maskCacheBytes > MAX_MASK_CACHE_BYTES && maskCache.size > 1) {
      const oldest = maskCache.keys().next().value;
      if (oldest === void 0) break;
      const old = maskCache.get(oldest);
      if (old) maskCacheBytes -= old.tex.byteLength;
      maskCache.delete(oldest);
    }
    if (capsuleSdfTimings.length >= TIMING_RING_SIZE) capsuleSdfTimings.shift();
    capsuleSdfTimings.push({
      timestamp: t8,
      key,
      w,
      h,
      radius,
      texSize,
      cacheHit: false,
      stepCanvasSetup: t1 - t0,
      stepPathDraw: t2 - t1,
      stepGetImageData: t3 - t2,
      stepAlphaExtract: t4 - t3,
      // now includes init (merged loop)
      stepInitArrays: 0,
      // merged — kept for overlay compat
      stepForwardPass: t6 - t5,
      stepBackwardPass: t7 - t6,
      stepPack: t8 - t7,
      stepTotal: t8 - t0
    });
    return { tex, texSize };
  }
  var maskCache, MAX_MASK_CACHE_BYTES, maskCacheBytes, _alphaBuf, _insideBuf, _outsideBuf, _texBuf, TIMING_RING_SIZE, capsuleSdfTimings;
  var init_continuous_mask = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/continuous-mask.ts"() {
      "use strict";
      init_continuous_curve();
      maskCache = /* @__PURE__ */ new Map();
      MAX_MASK_CACHE_BYTES = 32 * 1024 * 1024;
      maskCacheBytes = 0;
      _alphaBuf = new Uint8Array(128 * 128);
      _insideBuf = new Int32Array(128 * 128);
      _outsideBuf = new Int32Array(128 * 128);
      _texBuf = new Uint8Array(128 * 128 * 4);
      TIMING_RING_SIZE = 32;
      capsuleSdfTimings = [];
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-wallpaper.ts
  var wallpaperMethods;
  var init_methods_wallpaper = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-wallpaper.ts"() {
      "use strict";
      init_continuous_mask();
      wallpaperMethods = {
        /** Load the wallpaper image as a texture. */
        async loadWallpaper(src) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Failed to load wallpaper: " + src));
            img.src = src;
          });
          const gl = this.gl;
          if (this.wallpaperTexture) gl.deleteTexture(this.wallpaperTexture);
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          const isPOT = (w & w - 1) === 0 && (h & h - 1) === 0;
          if (isPOT) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          }
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.wallpaperTexture = tex;
          this.wallpaperSize = [w || 1, h || 1];
          this.wallpaperReady = true;
          this.clearBackdropBlurCache();
          this.wallpaperVersion++;
          this.markAllDirty();
          this.requestRender();
        },
        /** Load the SDF texture (clock_sdf) for LockScreen glass. */
        async loadSdfTexture(src) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Failed to load SDF texture: " + src));
            img.src = src;
          });
          const gl = this.gl;
          if (this.sdfTexture) gl.deleteTexture(this.sdfTexture);
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.sdfTexture = tex;
          this.sdfTextureSize = [img.naturalWidth || 1, img.naturalHeight || 1];
          this.sdfTextureReady = true;
          this.markAllDirty();
          this.requestRender();
        },
        /** Upload precomputed RGBA SDF-texture pixels directly (no Image load).
         *  DEPRECATED — kept as a thin wrapper around loadTextSdfTextureFromData
         *  for backward compatibility. New code should call loadTextSdfTextureFromData
         *  directly. This now writes to the SEPARATE textSdfTexture slot, NOT the
         *  shared sdfTexture (clock_sdf) slot. */
        loadSdfTextureFromData(data, w, h) {
          this.loadTextSdfTextureFromData(data, w, h);
        },
        /** Upload text-glass SDF pixels to the SEPARATE textSdfTexture slot.
         *  Does NOT touch sdfTexture (clock_sdf) — the lock screen's texture is
         *  preserved across TextGlass page visits. "把这个和锁屏sdf彻底分开". */
        loadTextSdfTextureFromData(data, w, h) {
          if (w < 1 || h < 1) return;
          const gl = this.gl;
          if (this.textSdfTexture) gl.deleteTexture(this.textSdfTexture);
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.textSdfTexture = tex;
          this.textSdfTextureSize = [w, h];
          this.textSdfTextureReady = true;
          this.markAllDirty();
          this.requestRender();
        },
        /** Generate + upload a continuous-curvature SDF texture for the dialog
         *  card's capsule shape. The texture is cached by (w, h, radius, dpr,
         *  capsuleSdfQuality); calling again with the same key is a no-op. The SDF
         *  encodes a G2-continuous Bezier rounded-rect path (faithful to
         *  kyant-shapes' ContinuousCurvatureRoundedRectangleCornerBuilder),
         *  normalized to [-1, 1] (negative inside, positive outside). Sampling it
         *  in the shader gives pixel-perfect squircle corners, vs the analytic
         *  sdRoundedRect which uses a circular arc approximation.
         *
         *  Texture format: RGBA, texSize² (chosen dynamically by
         *  generateContinuousCurvatureMask — 2× oversampling rounded up to POT,
         *  clamped [128,1024], then scaled by capsuleSdfQuality and Math.ceil'd),
         *  LINEAR filtering, CLAMP_TO_EDGE. The R channel holds the normalized
         *  SDF (decoded as sample*2 - 1 in the shader); G and B mirror R; A = 255. */
        loadContinuousSdf(w, h, radius) {
          const holeR = this.debugSdfHoleTopLeftR;
          const holeG = this.debugSdfHoleTopLeftG;
          const skipSdf = !!this.noContinuousSdf;
          const q = this.capsuleSdfQuality;
          const key = `${w},${h},${radius},${this.dpr},q${q},s${skipSdf ? 1 : 0},r${holeR ? 1 : 0},g${holeG ? 1 : 0}`;
          let entry = this.continuousSdfPool.get(key);
          if (!entry) {
            const genStart = performance.now();
            const { tex, texSize } = generateContinuousCurvatureMask(w, h, radius, this.dpr, this.capsuleSdfQuality, skipSdf);
            const genEnd = performance.now();
            const gl = this.gl;
            const texObj = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texObj);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            let uploadTex = tex;
            if (holeR || holeG) {
              uploadTex = tex.slice();
              const half = texSize >> 1;
              for (let row = 0; row < half; row++) {
                const rowBase = row * texSize * 4;
                for (let col = 0; col < half; col++) {
                  const idx = rowBase + col * 4;
                  if (holeR) uploadTex[idx] = 0;
                  if (holeG) uploadTex[idx + 1] = 0;
                }
              }
            }
            const uploadStart = performance.now();
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texSize, texSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, uploadTex);
            gl.finish();
            const uploadEnd = performance.now();
            if (holeR || holeG) {
              this._debugUploadedSdfTexMap.set(key, { tex: uploadTex.slice(), texSize });
            }
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            entry = { tex: texObj, texSize };
            this.continuousSdfPool.set(key, entry);
            this._lastCapsuleUploadMs = uploadEnd - uploadStart;
            this._lastCapsuleGenMs = genEnd - genStart;
            this._lastCapsuleKey = key;
            if (this.continuousSdfPool.size > 16) {
              const oldest = this.continuousSdfPool.keys().next().value;
              if (oldest) {
                const old = this.continuousSdfPool.get(oldest);
                if (old) gl.deleteTexture(old.tex);
                this.continuousSdfPool.delete(oldest);
              }
            }
          } else {
            this._lastCapsuleUploadMs = 0;
            this._lastCapsuleGenMs = 0;
            this._lastCapsuleKey = key + " (pool hit)";
          }
          this.continuousSdfTexture = entry.tex;
          this.continuousSdfTexSize = [entry.texSize, entry.texSize];
          this.continuousSdfKey = key;
        },
        /** Set canvas size (CSS pixels) + handle DPR.
         *  PERFORMANCE: DPR capped at 1.5 (was 2). On Retina displays (DPR=2),
         *  this reduces pixel count by 44% (4x → 2.25x) with minimal visual
         *  difference. The original Android app relies on hardware RenderEffect
         *  which is far cheaper per-pixel, so it can afford full DPR; our
         *  software shader pipeline cannot.
         */
        resize(cssW, cssH) {
          if (this.dpr <= 0) {
            this.dpr = Math.min(window.devicePixelRatio || 1, 3);
          }
          const w = Math.round(cssW * this.dpr);
          const h = Math.round(cssH * this.dpr);
          if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
            this.gl.viewport(0, 0, w, h);
            this.resizeFBOs(w, h);
          }
          for (const b of this.buttonConfigs) this.fgDirtyIds.add(b.id);
          this.cssWidth = cssW;
          this.cssHeight = cssH;
          if (this.elFboCache.size > 0) {
            const gl = this.gl;
            for (const e of this.elFboCache.values()) {
              gl.deleteFramebuffer(e.fb);
              gl.deleteTexture(e.tex);
            }
            this.elFboCache.clear();
          }
          this.markAllDirty();
          this.requestRender();
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-scroll.ts
  var scrollMethods;
  var init_methods_scroll = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-scroll.ts"() {
      "use strict";
      scrollMethods = {
        /** Total scrollable content height in CSS px (set by the React layer). */
        setContentHeight(h) {
          this.contentHeight = h;
          this.clampScrollY();
          this.requestRender();
        },
        /**
         * Set the scroll offset directly (CSS px, positive = scrolled down).
         * Used during touch drag — the scroll position follows the finger with
         * no spring lag. Inertia velocity is reset to 0 (the finger is in control).
         * The value is clamped to [0, maxScroll].
         */
        setScrollY(y) {
          this.scrollVelocity = 0;
          this.scrollY = this.clampScrollValue(y);
          this.requestRender();
        },
        /**
         * Apply an inertia impulse to the scroll (CSS px / s). Used on touch
         * release — the drag velocity becomes the initial scroll velocity,
         * then exponentially decays. The renderer's animation loop applies
         * `scrollY += scrollVelocity * dt` each frame and decays the velocity.
         * No spring rebound at edges — scrolling just stops at the boundary.
         */
        setScrollVelocity(v) {
          const MAX_VEL = 4e3;
          this.scrollVelocity = Math.max(-MAX_VEL, Math.min(MAX_VEL, v));
          this.startAnimation();
        },
        /** Get current scroll offset (CSS px). */
        getScrollY() {
          return this.scrollY;
        },
        /** Get current scroll velocity (CSS px / s, for inertia). */
        getScrollVelocity() {
          return this.scrollVelocity;
        },
        /** Clamp a scroll value to [0, maxScroll]. */
        clampScrollValue(y) {
          const max = Math.max(0, this.contentHeight - this.cssHeight);
          if (y < 0) return 0;
          if (y > max) return max;
          return y;
        },
        /** Clamp current scrollY in place (called when content size changes). */
        clampScrollY() {
          this.scrollY = this.clampScrollValue(this.scrollY);
        },
        /**
         * Set the background color override. If non-null, the renderer fills
         * the canvas with this color instead of drawing the wallpaper image.
         * Used for the Home page (black background) per the user's request.
         */
        setBackgroundColor(color) {
          if (this.backgroundColor === color) return;
          if (this.backgroundColor && color && this.backgroundColor[0] === color[0] && this.backgroundColor[1] === color[1] && this.backgroundColor[2] === color[2]) return;
          this.backgroundColor = color;
          this.markAllDirty();
          this.requestRender();
        },
        setGravityAngle(angleRad) {
          const THRESHOLD = 0.02;
          if (Math.abs(this.gravityAngle - angleRad) < THRESHOLD) return;
          this.gravityAngle = angleRad;
          this.markGravityDirty();
          this.requestRender();
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/velocity-tracker.ts
  var MAX_SAMPLES, VelocityTracker1D;
  var init_velocity_tracker = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/velocity-tracker.ts"() {
      "use strict";
      MAX_SAMPLES = 20;
      VelocityTracker1D = class {
        constructor() {
          this.samples = [];
        }
        resetTracking() {
          this.samples.length = 0;
        }
        addPosition(timeMillis, position) {
          this.samples.push({ t: timeMillis, p: position });
          if (this.samples.length > MAX_SAMPLES) {
            this.samples.shift();
          }
        }
        /**
         * Estimate velocity (units/second) at the latest sample using a
         * least-squares linear fit over samples within the last `windowMs`
         * (default 100ms, matching Compose's default cutoff).
         *
         * Returns 0 if fewer than 2 samples are in the window.
         */
        calculateVelocity(windowMs = 100) {
          const samples = this.samples;
          if (samples.length < 2) return 0;
          const now = samples[samples.length - 1].t;
          const cutoff = now - windowMs;
          let n = 0;
          let sumT = 0;
          let sumP = 0;
          let sumTT = 0;
          let sumTP = 0;
          for (let i = samples.length - 1; i >= 0; i--) {
            const s = samples[i];
            if (s.t < cutoff) break;
            const tt = (s.t - now) / 1e3;
            sumT += tt;
            sumP += s.p;
            sumTT += tt * tt;
            sumTP += tt * s.p;
            n++;
          }
          if (n < 2) return 0;
          const denom = n * sumTT - sumT * sumT;
          if (Math.abs(denom) < 1e-9) return 0;
          const b = (n * sumTP - sumT * sumP) / denom;
          return b;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-toggle.ts
  var toggleMethods;
  var init_methods_toggle = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-toggle.ts"() {
      "use strict";
      init_velocity_tracker();
      toggleMethods = {
        /** Ensure a toggle group state exists, initialized to the given fraction.
         *  pressedScale / valueRangeSpan are only applied on first creation
         *  (or, for non-default values, re-applied on existing groups so tabs
         *  always get 78/56 and the correct span even if setToggleTarget created
         *  the group first via the page.tsx toggleTargets sync). */
        ensureToggleState(groupId, initialFraction, pressedScale = 1.5, valueRangeSpan = 1) {
          let st = this.toggleStates.get(groupId);
          if (!st) {
            st = {
              fraction: initialFraction,
              fractionVelocity: 0,
              targetFraction: initialFraction,
              pressProgress: 0,
              pressVelocity: 0,
              targetPress: 0,
              scaleX: 1,
              scaleXVelocity: 0,
              targetScaleX: 1,
              scaleY: 1,
              scaleYVelocity: 0,
              targetScaleY: 1,
              velocity: 0,
              velocityVelocity: 0,
              targetVelocity: 0,
              isDragging: false,
              trackVelocityAfterRelease: false,
              velocityTracker: new VelocityTracker1D(),
              lastFractionForVelocity: initialFraction,
              lastFractionTime: 0,
              pressedScale,
              valueRangeSpan,
              panelOffset: 0,
              panelOffsetVelocity: 0,
              targetPanelOffset: 0
            };
            this.toggleStates.set(groupId, st);
          } else {
            if (pressedScale !== 1.5) st.pressedScale = pressedScale;
            if (valueRangeSpan !== 1) st.valueRangeSpan = valueRangeSpan;
          }
          return st;
        },
        /**
         * Set the toggle's target fraction (0..1). Animates with critically
         * damped spring. Also triggers a quick press-and-release cycle to
         * match the original `animateToValue` behavior (which calls press()
         * + animateTo + release()).
         *
         * Used for tap-to-toggle: the React layer flips `toggleOn`, then calls
         * this method with the new target.
         *
         * NOTE: If the target is unchanged (e.g. React re-renders after a drag
         * end and pushes the same target back), this is a no-op — we don't
         * re-trigger the press animation. This prevents a feedback loop where
         * drag-end → setState → useEffect → setToggleTarget would restart the
         * press animation that endToggleDrag just played.
         */
        setToggleTarget(groupId, target) {
          const st = this.ensureToggleState(groupId, target);
          if (st.isDragging) return;
          if (st.targetFraction === target) return;
          st.targetFraction = target;
          st.trackVelocityAfterRelease = false;
          st.targetVelocity = 0;
          st.velocity = 0;
          st.velocityVelocity = 0;
          st.velocityTracker.resetTracking();
          if (st.targetPress === 0) {
            st.targetPress = 1;
            st.targetScaleX = st.pressedScale;
            st.targetScaleY = st.pressedScale;
          }
          this.markGroupDirty(groupId);
          this.startAnimation();
        },
        /**
         * Begin a finger drag on a toggle group. Sets isDragging=true and
         * starts the press animation (scale → pressedScale, white overlay fades in).
         * The startFraction is recorded so drag deltas can be added to it.
         *
         * Faithful to DampedDragAnimation.press() which resets the VelocityTracker
         * (so samples from a previous gesture don't bleed into this one).
         */
        beginToggleDrag(groupId, startFraction) {
          const st = this.ensureToggleState(groupId, startFraction);
          st.isDragging = true;
          st.targetPress = 1;
          st.targetScaleX = st.pressedScale;
          st.targetScaleY = st.pressedScale;
          st.velocityTracker.resetTracking();
          st.targetVelocity = 0;
          st.velocity = 0;
          st.velocityVelocity = 0;
          this.markGroupDirty(groupId);
          this.startAnimation();
        },
        /**
         * Update the toggle's target fraction based on finger movement.
         * The new target is computed as `startFraction + (currentX - startX) / dragWidth`,
         * clamped to [0, 1]. The animated fraction then springs toward this
         * target with critically damped spec — so the knob tracks the finger
         * with a tiny smooth lag (matches the original's `updateValue(fraction)`
         * which animates toward the latest fraction state).
         *
         * VELOCITY TRACKING happens in the animation loop (methods-animation.ts),
         * NOT here. Faithful to DampedDragAnimation.kt: the tracker is fed
         * (time, valueAnimation.value) inside the valueAnimation.animateTo
         * block's per-frame callback (updateVelocity). The tracker uses a
         * least-squares fit (Compose VelocityTracker) rather than a spike-prone
         * ΔtargetFraction/Δt difference.
         */
        dragToggle(groupId, startFraction, currentX, startX, dragWidth) {
          const st = this.ensureToggleState(groupId, startFraction);
          if (!st.isDragging) return;
          const delta = (currentX - startX) / Math.max(1, dragWidth);
          const newTarget = Math.max(0, Math.min(1, startFraction + delta));
          st.targetFraction = newTarget;
          this.markGroupDirty(groupId);
          this.startAnimation();
        },
        /**
         * End a finger drag. Snaps the target to 0 or 1 based on the current
         * targetFraction (≥0.5 → 1, else 0). Returns the snapped value so the
         * React layer can sync its state.
         *
         * NOTE: We do NOT immediately release the press animation here. The
         * original `release()` waits for `value` to settle near `targetValue`
         * before animating press→0. Our animation loop's auto-release logic
         * handles this: when `isDragging === false` and `fraction` is within
         * 0.02 of `targetFraction`, it sets `targetPress = 0` and
         * `targetScaleX/Y = 1`. This gives a smooth "press stays until knob
         * settles, then releases" feel that matches the original.
         *
         * We also decay the velocity target to 0 (the drag is over).
         */
        endToggleDrag(groupId) {
          const st = this.toggleStates.get(groupId);
          if (!st) return 0;
          st.isDragging = false;
          const finalTarget = st.targetFraction >= 0.5 ? 1 : 0;
          st.targetFraction = finalTarget;
          st.trackVelocityAfterRelease = true;
          this.markGroupDirty(groupId);
          this.startAnimation();
          return finalTarget;
        },
        /**
         * End a finger drag on a SLIDER group. Unlike toggle (which snaps to 0/1),
         * a slider is a continuous (stepless) control — faithful to LiquidSlider.kt's
         * `onDragStopped = { if (didDrag) onValueChange(targetValue) }` which returns
         * the continuous targetValue WITHOUT snapping.
         *
         * Returns the continuous target fraction (0..1) so the React layer can sync
         * its state. The press animation auto-releases when the fraction settles.
         */
        endSliderDrag(groupId) {
          const st = this.toggleStates.get(groupId);
          if (!st) return 0;
          st.isDragging = false;
          const finalTarget = st.targetFraction;
          st.trackVelocityAfterRelease = true;
          this.markGroupDirty(groupId);
          this.startAnimation();
          return finalTarget;
        },
        /** Read the current animated fraction (0..1) for a toggle group. */
        getToggleFraction(groupId) {
          return this.toggleStates.get(groupId)?.fraction ?? 0;
        },
        /**
         * Set the fraction to an absolute value during a slider drag. Used by the
         * slider track drag handler so the knob jumps to the finger position and
         * follows it (absolute positioning, like a tap but continuous). This matches
         * the original LiquidSlider.kt track tap-to-position behavior, extended to
         * drag for better usability on a small knob.
         *
         * Unlike setToggleTarget (which no-ops during isDragging), this directly
         * sets targetFraction so it works mid-drag.
         */
        setSliderDragPosition(groupId, fraction) {
          const st = this.toggleStates.get(groupId);
          if (!st) return;
          const clamped = Math.max(0, Math.min(1, fraction));
          if (st.targetFraction !== clamped) {
            st.targetFraction = clamped;
            this.markGroupDirty(groupId);
            this.startAnimation();
          }
        },
        /** Read the current target fraction (0..1) for a toggle group. */
        getToggleTarget(groupId) {
          return this.toggleStates.get(groupId)?.targetFraction ?? 0;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/spring.ts
  function springStep1D(current, velocity, target, dt) {
    const x0 = current - target;
    const v0 = velocity;
    const decay = Math.exp(-SPRING_DAMPING_RATIO * SPRING_OMEGA_N * dt);
    const cosWd = Math.cos(SPRING_OMEGA_D * dt);
    const sinWd = Math.sin(SPRING_OMEGA_D * dt);
    const offset = x0 * decay * cosWd + (v0 + SPRING_DAMPING_RATIO * SPRING_OMEGA_N * x0) / SPRING_OMEGA_D * decay * sinWd;
    const b0 = (v0 + SPRING_DAMPING_RATIO * SPRING_OMEGA_N * x0) / SPRING_OMEGA_D;
    const newVel = -SPRING_DAMPING_RATIO * SPRING_OMEGA_N * offset + decay * (-x0 * SPRING_OMEGA_D * sinWd + b0 * SPRING_OMEGA_D * cosWd);
    return { current: target + offset, velocity: newVel };
  }
  function springStepCritical(current, velocity, target, dt, omegaN) {
    const x0 = current - target;
    const v0 = velocity;
    const decay = Math.exp(-omegaN * dt);
    const offset = x0 * decay + (v0 + omegaN * x0) * dt * decay;
    const newVel = -omegaN * x0 * decay + (v0 + omegaN * x0) * (decay - omegaN * dt * decay);
    return { current: target + offset, velocity: newVel };
  }
  function springStepUnderdamped(current, velocity, target, dt, omegaN, dampingRatio) {
    const x0 = current - target;
    const v0 = velocity;
    const omegaD = omegaN * Math.sqrt(1 - dampingRatio * dampingRatio);
    const decay = Math.exp(-dampingRatio * omegaN * dt);
    const cosWd = Math.cos(omegaD * dt);
    const sinWd = Math.sin(omegaD * dt);
    const offset = x0 * decay * cosWd + (v0 + dampingRatio * omegaN * x0) / omegaD * decay * sinWd;
    const b0 = (v0 + dampingRatio * omegaN * x0) / omegaD;
    const newVel = -dampingRatio * omegaN * offset + decay * (-x0 * omegaD * sinWd + b0 * omegaD * cosWd);
    return { current: target + offset, velocity: newVel };
  }
  var DP, SPRING_K, SPRING_DAMPING_RATIO, SPRING_OMEGA_N, SPRING_OMEGA_D, SPRING_THRESHOLD, TOGGLE_VALUE_K, TOGGLE_VALUE_OMEGA_N, TOGGLE_SCALE_X_K, TOGGLE_SCALE_X_DAMPING_RATIO, TOGGLE_SCALE_X_OMEGA_N, TOGGLE_SCALE_X_OMEGA_D, TOGGLE_SCALE_Y_K, TOGGLE_SCALE_Y_DAMPING_RATIO, TOGGLE_SCALE_Y_OMEGA_N, TOGGLE_SCALE_Y_OMEGA_D, TOGGLE_VELOCITY_K, TOGGLE_VELOCITY_DAMPING_RATIO, TOGGLE_VELOCITY_OMEGA_N, TOGGLE_VELOCITY_OMEGA_D;
  var init_spring = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/spring.ts"() {
      "use strict";
      DP = 1;
      SPRING_K = 300;
      SPRING_DAMPING_RATIO = 0.5;
      SPRING_OMEGA_N = Math.sqrt(SPRING_K);
      SPRING_OMEGA_D = SPRING_OMEGA_N * Math.sqrt(1 - SPRING_DAMPING_RATIO * SPRING_DAMPING_RATIO);
      SPRING_THRESHOLD = 3e-3;
      TOGGLE_VALUE_K = 1e3;
      TOGGLE_VALUE_OMEGA_N = Math.sqrt(TOGGLE_VALUE_K);
      TOGGLE_SCALE_X_K = 250;
      TOGGLE_SCALE_X_DAMPING_RATIO = 0.6;
      TOGGLE_SCALE_X_OMEGA_N = Math.sqrt(TOGGLE_SCALE_X_K);
      TOGGLE_SCALE_X_OMEGA_D = TOGGLE_SCALE_X_OMEGA_N * Math.sqrt(1 - TOGGLE_SCALE_X_DAMPING_RATIO * TOGGLE_SCALE_X_DAMPING_RATIO);
      TOGGLE_SCALE_Y_K = 250;
      TOGGLE_SCALE_Y_DAMPING_RATIO = 0.7;
      TOGGLE_SCALE_Y_OMEGA_N = Math.sqrt(TOGGLE_SCALE_Y_K);
      TOGGLE_SCALE_Y_OMEGA_D = TOGGLE_SCALE_Y_OMEGA_N * Math.sqrt(1 - TOGGLE_SCALE_Y_DAMPING_RATIO * TOGGLE_SCALE_Y_DAMPING_RATIO);
      TOGGLE_VELOCITY_K = 300;
      TOGGLE_VELOCITY_DAMPING_RATIO = 0.5;
      TOGGLE_VELOCITY_OMEGA_N = Math.sqrt(TOGGLE_VELOCITY_K);
      TOGGLE_VELOCITY_OMEGA_D = TOGGLE_VELOCITY_OMEGA_N * Math.sqrt(1 - TOGGLE_VELOCITY_DAMPING_RATIO * TOGGLE_VELOCITY_DAMPING_RATIO);
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-tabs.ts
  var tabsMethods;
  var init_methods_tabs = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-tabs.ts"() {
      "use strict";
      init_renderer();
      init_spring();
      tabsMethods = {
        /**
         * Set the tab indicator's target index. Animates with critically
         * damped spring. Also triggers a quick press-and-release cycle.
         */
        setTabSelected(groupId, tabIndex, tabsCount) {
          const st = this.ensureToggleState(
            groupId,
            tabIndex,
            LiquidGlassRenderer.TAB_PRESSED_SCALE,
            tabsCount - 1
            // valueRangeSpan — faithful to DampedDragAnimation valueRange 0..(tabsCount-1)
          );
          if (st.isDragging) return;
          if (st.targetFraction === tabIndex) return;
          st.targetFraction = tabIndex;
          st.trackVelocityAfterRelease = false;
          st.targetVelocity = 0;
          st.velocity = 0;
          st.velocityVelocity = 0;
          st.velocityTracker.resetTracking();
          if (st.targetPress === 0) {
            st.targetPress = 1;
            st.targetScaleX = st.pressedScale;
            st.targetScaleY = st.pressedScale;
          }
          this.markGroupDirty(groupId);
          this.startAnimation();
        },
        /**
         * Begin a finger drag on the tab indicator. Sets isDragging=true and
         * starts the press animation (scale → 78/56).
         */
        beginTabDrag(groupId, startTabIndex, tabsCount) {
          const st = this.ensureToggleState(
            groupId,
            startTabIndex,
            LiquidGlassRenderer.TAB_PRESSED_SCALE,
            tabsCount - 1
            // valueRangeSpan — faithful to DampedDragAnimation valueRange 0..(tabsCount-1)
          );
          st.isDragging = true;
          st.targetPress = 1;
          st.targetScaleX = st.pressedScale;
          st.targetScaleY = st.pressedScale;
          st.velocityTracker.resetTracking();
          st.targetVelocity = 0;
          st.velocity = 0;
          st.velocityVelocity = 0;
          this.markGroupDirty(groupId);
          this.startAnimation();
        },
        /**
         * Update the tab indicator's target based on finger movement.
         * newTarget = startTabIndex + (currentX - startX) / tabWidth, clamped to [0, tabsCount-1].
         * Also updates panelOffset: 4dp * sign(fraction) * EaseOut(|fraction|).
         *
         * VELOCITY TRACKING happens in the animation loop (methods-animation.ts),
         * faithful to DampedDragAnimation.updateVelocity() which feeds (time, value)
         * to the VelocityTracker inside the valueAnimation.animateTo block.
         */
        dragTab(groupId, startTabIndex, currentX, startX, tabWidth, tabsCount) {
          const st = this.ensureToggleState(
            groupId,
            startTabIndex,
            LiquidGlassRenderer.TAB_PRESSED_SCALE,
            tabsCount - 1
            // valueRangeSpan — faithful to DampedDragAnimation valueRange 0..(tabsCount-1)
          );
          if (!st.isDragging) return;
          const delta = (currentX - startX) / Math.max(1, tabWidth);
          const newTarget = Math.max(0, Math.min(tabsCount - 1, startTabIndex + delta));
          st.targetFraction = newTarget;
          const maxWidth = tabWidth * tabsCount;
          const offsetFraction = Math.max(-1, Math.min(1, (currentX - startX) / Math.max(1, maxWidth)));
          const easeOut = 1 - Math.pow(1 - Math.abs(offsetFraction), 2);
          st.targetPanelOffset = 4 * DP * Math.sign(offsetFraction) * easeOut;
          this.markGroupDirty(groupId);
          this.startAnimation();
        },
        /**
         * End a finger drag. Snaps to nearest tab index. Returns the snapped index.
         * panelOffset springs back to 0 (spring(1f, 300f) — critically damped).
         */
        endTabDrag(groupId, tabsCount) {
          const st = this.toggleStates.get(groupId);
          if (!st) return 0;
          st.isDragging = false;
          const finalTarget = Math.round(st.targetFraction);
          const clamped = Math.max(0, Math.min(tabsCount - 1, finalTarget));
          st.targetFraction = clamped;
          st.velocityTracker.resetTracking();
          st.trackVelocityAfterRelease = false;
          st.targetVelocity = 0;
          st.targetPanelOffset = 0;
          this.markGroupDirty(groupId);
          this.startAnimation();
          return clamped;
        },
        /** Read the current animated tab fraction (0..tabsCount-1). */
        getTabFraction(groupId) {
          return this.toggleStates.get(groupId)?.fraction ?? 0;
        },
        /** Read the current target tab index. */
        getTabTarget(groupId) {
          return this.toggleStates.get(groupId)?.targetFraction ?? 0;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-elements.ts
  function elementCacheSignature(el) {
    return JSON.stringify([
      el.rect.w,
      el.rect.h,
      el.cornerRadius,
      el.blurRadius,
      el.useSeparableBlur,
      el.scrimColor,
      el.surfaceColor,
      el.tintColor,
      el.independentBackdrop,
      el.sampleWallpaper,
      el.chromaticAberration,
      el.outerShadow,
      el.highlight,
      el.isMagnifier,
      el.isSdfTexture,
      el.enterProgress,
      el.enterSafeProgress,
      el.enterStretchFactor,
      el.useGravityAngle,
      el.elementRotation,
      el.backdropFbo,
      el.brightness,
      el.contrast,
      el.saturation,
      el.useContinuousSdf,
      el.isToggleKnob,
      el.isToggleTrack,
      el.isSliderFill,
      el.isBottomTabContainer,
      el.isBottomTabContent,
      el.isBottomTabIndicator,
      el.sceneBlurRadius,
      // Refraction params (refractionHeight / refractionAmount / depthEffect)
      // are baked into the elFbo by the element pass shader — changing them
      // WITHOUT invalidating the cache returns the stale baked elFbo. This was
      // the root cause of "GP refraction sliders don't refresh the glass body":
      // the catalog rebuilds gp-square with new refraction params, but the
      // signature matched → cache HIT → stale texture composited.
      el.refractionHeight,
      el.refractionAmount,
      el.depthEffect
      // NOTE: cornerStyle is a GLOBAL renderer field (this.cornerStyle), not
      // per-element — its change is handled by the context.tsx effect that
      // calls markAllDirty(). layerScale is derived at render time from
      // element state, not stored on the config. Both deliberately excluded.
      // elementScaleX/Y are also deliberately excluded — they only affect the
      // composite-time visual scale (elFbo stays at baseline resolution), so
      // zoom changes don't need to invalidate the baked glass body.
    ]);
  }
  var elementMethods;
  var init_methods_elements = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-elements.ts"() {
      "use strict";
      elementMethods = {
        /** Set the element list. Triggers foreground re-raster for changed elements. */
        setElements(configs) {
          this.setButtons(configs);
        },
        /** Set the element list (legacy name; same as setElements). */
        setButtons(configs) {
          const prevIds = new Set(this.buttonConfigs.map((b) => b.id));
          const nextIds = new Set(configs.map((b) => b.id));
          for (const id of nextIds) if (!prevIds.has(id)) this.fgDirtyIds.add(id);
          for (const next of configs) {
            const prev = this.buttonConfigs.find((b) => b.id === next.id);
            if (!prev) continue;
            const eq4 = (a, b) => {
              if (!a || !b) return a === b;
              if (a.length !== b.length) return false;
              for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
              return true;
            };
            const prevTextIcon = prev.text?.icon;
            const nextTextIcon = next.text?.icon;
            const textIconChanged = !!prevTextIcon !== !!nextTextIcon || prevTextIcon && nextTextIcon && (prevTextIcon.path !== nextTextIcon.path || prevTextIcon.size !== nextTextIcon.size || !eq4(prevTextIcon.color, nextTextIcon.color));
            const prevBtnIcon = prev.icon;
            const nextBtnIcon = next.icon;
            const btnIconChanged = !!prevBtnIcon !== !!nextBtnIcon || prevBtnIcon && nextBtnIcon && (prevBtnIcon.path !== nextBtnIcon.path || prevBtnIcon.size !== nextBtnIcon.size || !eq4(prevBtnIcon.color, nextBtnIcon.color));
            const pt = prev.text;
            const nt = next.text;
            const textPropsChanged = !!pt !== !!nt || pt && nt && (!eq4(pt.color, nt.color) || pt.halo !== nt.halo || pt.fontSizePx !== nt.fontSizePx || pt.fontWeight !== nt.fontWeight || pt.align !== nt.align || pt.wrap !== nt.wrap || pt.paddingPx !== nt.paddingPx || pt.valign !== nt.valign || pt.maxLines !== nt.maxLines);
            if (prev.label !== next.label || !eq4(prev.labelColor, next.labelColor) || prev.showChevron !== next.showChevron || prev.rect.w !== next.rect.w || prev.rect.h !== next.rect.h || next.text && prev.text && prev.text.content !== next.text.content || next.text && !prev.text || !next.text && prev.text || textIconChanged || btnIconChanged || textPropsChanged) {
              this.fgDirtyIds.add(next.id);
            }
          }
          for (const id of prevIds) {
            if (!nextIds.has(id)) {
              this.buttonStates.delete(id);
              const tex = this.fgTextures.get(id);
              if (tex) {
                this.gl.deleteTexture(tex);
                this.fgTextures.delete(id);
              }
              this.fgDirtyIds.delete(id);
              this.deleteElFboCacheEntry(id);
            }
          }
          for (const c of configs) {
            if (!this.buttonStates.has(c.id)) {
              const initValue = 0;
              this.buttonStates.set(c.id, {
                pressProgress: 0,
                pressVelocity: 0,
                targetPress: 0,
                dragX: 0,
                dragY: 0,
                dragVx: 0,
                dragVy: 0,
                targetDragX: 0,
                targetDragY: 0,
                startDragX: 0,
                startDragY: 0,
                interactiveValue: initValue,
                interactiveVelocity: 0,
                targetInteractiveValue: initValue
              });
            }
          }
          const prevSigMap = /* @__PURE__ */ new Map();
          for (const p of this.buttonConfigs) prevSigMap.set(p.id, elementCacheSignature(p));
          for (const next of configs) {
            const prevSig = prevSigMap.get(next.id);
            if (prevSig !== void 0 && prevSig !== elementCacheSignature(next)) {
              this.markElementDirty(next.id);
            }
          }
          const hadIndicator = this.buttonConfigs.some((b) => b.isBottomTabIndicator);
          const hasIndicator = configs.some((b) => b.isBottomTabIndicator);
          if (!hadIndicator && hasIndicator) {
            this.pendingExtraRenders = 1;
          }
          this.buttonConfigs = configs;
          this.requestRender();
        },
        /**
         * Set the interactive value (0..1 for toggle/slider; integer index for
         * tabbar) for an element. The renderer springs `interactiveValue` toward
         * this target so motion looks animated, not snapped.
         */
        setInteractiveValue(id, value) {
          const st = this.buttonStates.get(id);
          if (!st) return;
          if (st.targetInteractiveValue !== value) {
            st.targetInteractiveValue = value;
            this.markElementDirty(id);
            this.startAnimation();
            this.requestRender();
          }
        },
        /**
         * Set the pressed state for a button. `position` is the finger position
         * in canvas CSS pixels (top-left origin). When pressed=true, the position
         * is recorded as the drag start; subsequent calls with pressed=true update
         * the drag target. When pressed=false, the drag target springs back to
         * the start position.
         *
         * FAITHFUL TO InteractiveHighlight.kt:
         *   - onDragStart: positionAnimation.snapTo(down.position)  // instant snap
         *   - onDrag:      positionAnimation.snapTo(change.position) // instant snap
         *   - onDragEnd:   positionAnimation.animateTo(startPosition, springSpec) // spring back
         *
         * So during a drag the position FOLLOWS the finger instantly (no spring
         * lag); only on release does the spring kick in to return to start.
         */
        setPressed(id, pressed, position) {
          const st = this.buttonStates.get(id);
          if (!st) return;
          if (pressed) {
            const btn = this.buttonConfigs.find((b) => b.id === id);
            if (btn && position) {
              const localX = position.x - btn.rect.x;
              const localY = position.y - btn.rect.y;
              if (st.targetPress === 0) {
                st.startDragX = localX;
                st.startDragY = localY;
                st.dragX = localX;
                st.dragY = localY;
                st.dragVx = 0;
                st.dragVy = 0;
              }
              st.dragX = localX;
              st.dragY = localY;
              st.dragVx = 0;
              st.dragVy = 0;
              st.targetDragX = localX;
              st.targetDragY = localY;
            }
            st.targetPress = 1;
          } else {
            st.targetPress = 0;
            st.targetDragX = st.startDragX;
            st.targetDragY = st.startDragY;
          }
          this.markElementDirty(id);
          this.startAnimation();
        },
        /**
         * Update the drag position while pressed (without changing press state).
         * Used for pointermove during a drag.
         *
         * FAITHFUL TO InteractiveHighlight.kt: positionAnimation.snapTo(change.position)
         * — the position FOLLOWS the finger instantly with no spring lag. Only
         * on release (setPressed false) does the spring kick in to return to start.
         */
        setDragPosition(id, position) {
          const st = this.buttonStates.get(id);
          if (!st || st.targetPress === 0) return;
          const btn = this.buttonConfigs.find((b) => b.id === id);
          if (!btn) return;
          const localX = position.x - btn.rect.x;
          const localY = position.y - btn.rect.y;
          st.dragX = localX;
          st.dragY = localY;
          st.dragVx = 0;
          st.dragVy = 0;
          st.targetDragX = localX;
          st.targetDragY = localY;
          this.markElementDirty(id);
          this.requestRender();
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-animation.ts
  var animationMethods;
  var init_methods_animation = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-animation.ts"() {
      "use strict";
      init_spring();
      animationMethods = {
        /**
         * Spring-based animation loop. Matches InteractiveHighlight.kt's
         * spring(0.5f, 300f) spec — underdamped, with a small overshoot on
         * release. Uses real wall-clock dt for frame-rate-independent timing.
         */
        startAnimation() {
          if (this.animRafId !== null) return;
          let lastTime = performance.now();
          const tick = () => {
            const now = performance.now();
            const dt = Math.min((now - lastTime) / 1e3, 0.05);
            lastTime = now;
            let stillAnimating = false;
            for (const [id, st] of this.buttonStates.entries()) {
              let elementDirty = false;
              const pDelta = Math.abs(st.targetPress - st.pressProgress);
              if (pDelta > SPRING_THRESHOLD || Math.abs(st.pressVelocity) > SPRING_THRESHOLD) {
                const r = springStep1D(
                  st.pressProgress,
                  st.pressVelocity,
                  st.targetPress,
                  dt
                );
                st.pressProgress = r.current;
                st.pressVelocity = r.velocity;
                stillAnimating = true;
                elementDirty = true;
              } else {
                st.pressProgress = st.targetPress;
                st.pressVelocity = 0;
              }
              if (Math.abs(st.targetDragX - st.dragX) > SPRING_THRESHOLD || Math.abs(st.dragVx) > SPRING_THRESHOLD) {
                const r = springStep1D(st.dragX, st.dragVx, st.targetDragX, dt);
                st.dragX = r.current;
                st.dragVx = r.velocity;
                stillAnimating = true;
                elementDirty = true;
              } else {
                st.dragX = st.targetDragX;
                st.dragVx = 0;
              }
              if (Math.abs(st.targetDragY - st.dragY) > SPRING_THRESHOLD || Math.abs(st.dragVy) > SPRING_THRESHOLD) {
                const r = springStep1D(st.dragY, st.dragVy, st.targetDragY, dt);
                st.dragY = r.current;
                st.dragVy = r.velocity;
                stillAnimating = true;
                elementDirty = true;
              } else {
                st.dragY = st.targetDragY;
                st.dragVy = 0;
              }
              const iDelta = Math.abs(st.targetInteractiveValue - st.interactiveValue);
              if (iDelta > SPRING_THRESHOLD || Math.abs(st.interactiveVelocity) > SPRING_THRESHOLD) {
                const r = springStep1D(
                  st.interactiveValue,
                  st.interactiveVelocity,
                  st.targetInteractiveValue,
                  dt
                );
                st.interactiveValue = r.current;
                st.interactiveVelocity = r.velocity;
                stillAnimating = true;
                elementDirty = true;
              } else {
                st.interactiveValue = st.targetInteractiveValue;
                st.interactiveVelocity = 0;
              }
              if (elementDirty) this.markElementDirty(id);
            }
            for (const [groupId, tg] of this.toggleStates) {
              let groupDirty = false;
              if (tg.targetPress === 1 && !tg.isDragging && Math.abs(tg.targetFraction - tg.fraction) < 0.02) {
                tg.targetPress = 0;
                tg.targetScaleX = 1;
                tg.targetScaleY = 1;
                groupDirty = true;
                this.startAnimation();
              }
              const fDelta = Math.abs(tg.targetFraction - tg.fraction);
              if (fDelta > SPRING_THRESHOLD || Math.abs(tg.fractionVelocity) > SPRING_THRESHOLD) {
                const r = springStepCritical(
                  tg.fraction,
                  tg.fractionVelocity,
                  tg.targetFraction,
                  dt,
                  TOGGLE_VALUE_OMEGA_N
                );
                tg.fraction = r.current;
                tg.fractionVelocity = r.velocity;
                if (tg.trackVelocityAfterRelease || tg.isDragging) {
                  const nowMs = performance.now();
                  tg.velocityTracker.addPosition(nowMs, tg.fraction);
                  const tracked = tg.velocityTracker.calculateVelocity();
                  const span = tg.valueRangeSpan || 1;
                  tg.targetVelocity = tracked / span;
                }
                stillAnimating = true;
                groupDirty = true;
              } else {
                tg.fraction = tg.targetFraction;
                tg.fractionVelocity = 0;
                if (!tg.isDragging) {
                  tg.targetVelocity = 0;
                  tg.trackVelocityAfterRelease = false;
                  tg.velocityTracker.resetTracking();
                }
              }
              const ppDelta = Math.abs(tg.targetPress - tg.pressProgress);
              if (ppDelta > SPRING_THRESHOLD || Math.abs(tg.pressVelocity) > SPRING_THRESHOLD) {
                const r = springStepCritical(
                  tg.pressProgress,
                  tg.pressVelocity,
                  tg.targetPress,
                  dt,
                  TOGGLE_VALUE_OMEGA_N
                );
                tg.pressProgress = r.current;
                tg.pressVelocity = r.velocity;
                stillAnimating = true;
                groupDirty = true;
              } else {
                tg.pressProgress = tg.targetPress;
                tg.pressVelocity = 0;
              }
              const sx = Math.abs(tg.targetScaleX - tg.scaleX);
              if (sx > SPRING_THRESHOLD || Math.abs(tg.scaleXVelocity) > SPRING_THRESHOLD) {
                const r = springStepUnderdamped(
                  tg.scaleX,
                  tg.scaleXVelocity,
                  tg.targetScaleX,
                  dt,
                  TOGGLE_SCALE_X_OMEGA_N,
                  TOGGLE_SCALE_X_DAMPING_RATIO
                );
                tg.scaleX = r.current;
                tg.scaleXVelocity = r.velocity;
                stillAnimating = true;
                groupDirty = true;
              } else {
                tg.scaleX = tg.targetScaleX;
                tg.scaleXVelocity = 0;
              }
              const sy = Math.abs(tg.targetScaleY - tg.scaleY);
              if (sy > SPRING_THRESHOLD || Math.abs(tg.scaleYVelocity) > SPRING_THRESHOLD) {
                const r = springStepUnderdamped(
                  tg.scaleY,
                  tg.scaleYVelocity,
                  tg.targetScaleY,
                  dt,
                  TOGGLE_SCALE_Y_OMEGA_N,
                  TOGGLE_SCALE_Y_DAMPING_RATIO
                );
                tg.scaleY = r.current;
                tg.scaleYVelocity = r.velocity;
                stillAnimating = true;
                groupDirty = true;
              } else {
                tg.scaleY = tg.targetScaleY;
                tg.scaleYVelocity = 0;
              }
              const vDelta = Math.abs(tg.targetVelocity - tg.velocity);
              if (vDelta > SPRING_THRESHOLD || Math.abs(tg.velocityVelocity) > SPRING_THRESHOLD) {
                const r = springStepUnderdamped(
                  tg.velocity,
                  tg.velocityVelocity,
                  tg.targetVelocity,
                  dt,
                  TOGGLE_VELOCITY_OMEGA_N,
                  TOGGLE_VELOCITY_DAMPING_RATIO
                );
                tg.velocity = r.current;
                tg.velocityVelocity = r.velocity;
                stillAnimating = true;
                groupDirty = true;
              } else {
                tg.velocity = tg.targetVelocity;
                tg.velocityVelocity = 0;
              }
              const poDelta = Math.abs(tg.targetPanelOffset - tg.panelOffset);
              if (poDelta > SPRING_THRESHOLD || Math.abs(tg.panelOffsetVelocity) > SPRING_THRESHOLD) {
                const r = springStepCritical(
                  tg.panelOffset,
                  tg.panelOffsetVelocity,
                  tg.targetPanelOffset,
                  dt,
                  Math.sqrt(300)
                  // ω_n = sqrt(k) = sqrt(300) ≈ 17.32
                );
                tg.panelOffset = r.current;
                tg.panelOffsetVelocity = r.velocity;
                stillAnimating = true;
                groupDirty = true;
              } else {
                tg.panelOffset = tg.targetPanelOffset;
                tg.panelOffsetVelocity = 0;
              }
              if (groupDirty) this.markGroupDirty(groupId);
            }
            if (Math.abs(this.scrollVelocity) > 0.5) {
              const SCROLL_DECAY = 4;
              const newScrollY = this.scrollY + this.scrollVelocity * dt;
              const clamped = this.clampScrollValue(newScrollY);
              if (clamped !== newScrollY) {
                this.scrollY = clamped;
                this.scrollVelocity = 0;
              } else {
                this.scrollY = clamped;
                this.scrollVelocity *= Math.exp(-SCROLL_DECAY * dt);
              }
              stillAnimating = true;
            } else {
              this.scrollVelocity = 0;
            }
            if (stillAnimating) {
              this.requestRender();
              this.animRafId = requestAnimationFrame(tick);
            } else {
              this.requestRender();
              this.animRafId = null;
            }
          };
          this.animRafId = requestAnimationFrame(tick);
        },
        requestRender() {
          this.needsRedraw = true;
          if (this.rafId !== null) return;
          this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.render();
          });
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-raster.ts
  var rasterMethods;
  var init_methods_raster = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-raster.ts"() {
      "use strict";
      init_gl_utils();
      rasterMethods = {
        rasterizeForeground(cfg) {
          if (cfg.kind === "text" && cfg.text) {
            this.rasterizeText(cfg);
            return;
          }
          if (cfg.kind !== "button" && !cfg.label && !cfg.icon) {
            this.fgDirtyIds.delete(cfg.id);
            return;
          }
          const dpr = this.dpr;
          const w = Math.max(1, Math.round(cfg.rect.w * dpr));
          const h = Math.max(1, Math.round(cfg.rect.h * dpr));
          if (this.fgCanvas.width !== w) this.fgCanvas.width = w;
          if (this.fgCanvas.height !== h) this.fgCanvas.height = h;
          const ctx = this.fgCtx;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.scale(dpr, dpr);
          const cssW = cfg.rect.w;
          const cssH = cfg.rect.h;
          if (cfg.icon) {
            const iconSize = cfg.icon.size;
            const ic = cfg.icon.color;
            ctx.save();
            ctx.translate(cssW / 2 - iconSize / 2, cssH / 2 - iconSize / 2);
            const vp = cfg.icon.viewport ?? 24;
            ctx.scale(iconSize / vp, iconSize / vp);
            const p = new Path2D(cfg.icon.path);
            ctx.fillStyle = `rgba(${Math.round(ic[0] * 255)}, ${Math.round(
              ic[1] * 255
            )}, ${Math.round(ic[2] * 255)}, ${ic[3]})`;
            ctx.fill(p);
            ctx.restore();
            this.uploadForegroundTexture(cfg.id);
            this.fgDirtyIds.delete(cfg.id);
            return;
          }
          const fontPx = cfg.labelFontSizePx ?? cssH * (15 / 48);
          const fontFamily = '"Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
          ctx.font = `600 ${fontPx}px ${fontFamily}`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          const colorStr = `rgba(${Math.round(cfg.labelColor[0] * 255)}, ${Math.round(
            cfg.labelColor[1] * 255
          )}, ${Math.round(cfg.labelColor[2] * 255)}, ${cfg.labelColor[3]})`;
          const haloIsLight = cfg.labelColor[0] + cfg.labelColor[1] + cfg.labelColor[2] < 1.5;
          ctx.save();
          ctx.shadowColor = haloIsLight ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.15)";
          ctx.shadowBlur = haloIsLight ? fontPx * 0.12 : fontPx * 0.05;
          ctx.fillStyle = colorStr;
          ctx.fillText(cfg.label, cssW / 2, cssH / 2 + 0.5);
          ctx.restore();
          if (cfg.showChevron) {
            const chevronSize = fontPx * 0.93;
            const labelWidth = ctx.measureText(cfg.label).width;
            const cx = cssW / 2 + labelWidth / 2 + fontPx * 0.53 + chevronSize / 2;
            const cy = cssH / 2;
            ctx.save();
            ctx.strokeStyle = colorStr;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = fontPx * 0.107;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(cx - chevronSize * 0.3, cy - chevronSize * 0.4);
            ctx.lineTo(cx + chevronSize * 0.2, cy);
            ctx.lineTo(cx - chevronSize * 0.3, cy + chevronSize * 0.4);
            ctx.stroke();
            ctx.restore();
          }
          this.uploadForegroundTexture(cfg.id);
          this.fgDirtyIds.delete(cfg.id);
        },
        /* ---------------------------------------------------------------- *
         * Text-element rasterizer — draws an arbitrary text label (with
         * optional word wrap) to the foreground texture. Used for section
         * titles, dialog body text, slider value labels, etc.
         * ---------------------------------------------------------------- */
        rasterizeText(cfg) {
          if (!cfg.text) return;
          const dpr = this.dpr;
          const w = Math.max(1, Math.round(cfg.rect.w * dpr));
          const h = Math.max(1, Math.round(cfg.rect.h * dpr));
          if (this.fgCanvas.width !== w) this.fgCanvas.width = w;
          if (this.fgCanvas.height !== h) this.fgCanvas.height = h;
          const ctx = this.fgCtx;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.scale(dpr, dpr);
          const t = cfg.text;
          const cssW = cfg.rect.w;
          const cssH = cfg.rect.h;
          const fontFamily = '"Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
          ctx.font = `${t.fontWeight} ${t.fontSizePx}px ${fontFamily}`;
          ctx.letterSpacing = (t.letterSpacingPx ?? 0) + "px";
          ctx.textBaseline = "middle";
          const pad = t.paddingPx ?? 0;
          let halo = "none";
          if (t.halo === "light") halo = "light";
          else if (t.halo === "dark") halo = "dark";
          else if (t.halo === "auto" || t.halo === void 0) {
            const bright = t.color[0] + t.color[1] + t.color[2];
            halo = bright < 1.5 ? "light" : "dark";
          }
          if (halo === "light") {
            ctx.shadowColor = "rgba(255,255,255,0.55)";
            ctx.shadowBlur = t.fontSizePx * 0.16;
          } else if (halo === "dark") {
            ctx.shadowColor = "rgba(0,0,0,0.28)";
            ctx.shadowBlur = t.fontSizePx * 0.1;
          } else {
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
          }
          const colorStr = `rgba(${Math.round(t.color[0] * 255)}, ${Math.round(
            t.color[1] * 255
          )}, ${Math.round(t.color[2] * 255)}, ${t.color[3]})`;
          ctx.fillStyle = colorStr;
          let textYOffset = 0;
          if (t.icon) {
            const iconDrawSize = t.icon.size;
            const iconLayoutSize = t.icon.layoutSize ?? iconDrawSize;
            const gap = t.content ? 2 : 0;
            const totalBlockH = iconLayoutSize + gap + (t.content ? t.fontSizePx : 0);
            const blockTop = cssH / 2 - totalBlockH / 2;
            const iconCx = cssW / 2;
            const iconCy = blockTop + iconLayoutSize / 2;
            ctx.save();
            ctx.translate(iconCx - iconDrawSize / 2, iconCy - iconDrawSize / 2);
            const vp = t.icon.viewport ?? 24;
            ctx.scale(iconDrawSize / vp, iconDrawSize / vp);
            const p = new Path2D(t.icon.path);
            const ic = t.icon.color;
            ctx.fillStyle = `rgba(${Math.round(ic[0] * 255)}, ${Math.round(
              ic[1] * 255
            )}, ${Math.round(ic[2] * 255)}, ${ic[3]})`;
            ctx.fill(p);
            ctx.restore();
            textYOffset = (iconLayoutSize + gap) / 2;
          }
          if (t.align === "center") {
            ctx.textAlign = "center";
            if (t.wrap) {
              let lines = wrapText(ctx, t.content, cssW - pad * 2);
              if (t.maxLines != null && lines.length > t.maxLines) {
                lines = lines.slice(0, t.maxLines);
              }
              const lineH = t.fontSizePx * 1.35;
              const totalH = lineH * lines.length;
              let y;
              if (t.valign === "top") {
                y = lineH / 2 + textYOffset;
              } else if (t.valign === "bottom") {
                y = cssH - totalH + lineH / 2 + textYOffset;
              } else {
                y = cssH / 2 - totalH / 2 + lineH / 2 + textYOffset;
              }
              for (const line of lines) {
                ctx.fillText(line, cssW / 2, y);
                y += lineH;
              }
            } else {
              ctx.fillText(t.content, cssW / 2, cssH / 2 + 0.5 + textYOffset);
            }
          } else if (t.align === "left") {
            ctx.textAlign = "left";
            if (t.wrap) {
              let lines = wrapText(ctx, t.content, cssW - pad * 2);
              if (t.maxLines != null && lines.length > t.maxLines) {
                lines = lines.slice(0, t.maxLines);
              }
              const lineH = t.fontSizePx * 1.35;
              const totalH = lineH * lines.length;
              let y;
              if (t.valign === "top") {
                y = lineH / 2 + textYOffset;
              } else if (t.valign === "bottom") {
                y = cssH - totalH + lineH / 2 + textYOffset;
              } else {
                y = cssH / 2 - totalH / 2 + lineH / 2 + textYOffset;
              }
              for (const line of lines) {
                ctx.fillText(line, pad, y);
                y += lineH;
              }
            } else {
              ctx.fillText(t.content, pad, cssH / 2 + 0.5 + textYOffset);
            }
          } else {
            ctx.textAlign = "right";
            ctx.fillText(t.content, cssW - pad, cssH / 2 + 0.5 + textYOffset);
          }
          this.uploadForegroundTexture(cfg.id);
          this.fgDirtyIds.delete(cfg.id);
        },
        uploadForegroundTexture(id) {
          const gl = this.gl;
          let tex = this.fgTextures.get(id);
          if (!tex) {
            tex = gl.createTexture();
            this.fgTextures.set(id, tex);
          }
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fgCanvas);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-geometry.ts
  function computeScissorMarginCss(el, layerScale, toggles) {
    const FLOOR_CSS = 3;
    if (!el.outerShadow || el.outerShadow.radius <= 0.5 || !toggles.outerShadow) {
      return FLOOR_CSS;
    }
    const radius = el.outerShadow.radius;
    const maxOffset = Math.max(Math.abs(el.outerShadow.offsetX), Math.abs(el.outerShadow.offsetY));
    const shadowReachCss = (radius + maxOffset) * layerScale;
    return Math.max(FLOOR_CSS, shadowReachCss + 2);
  }
  function inflatedOutputRect(el, x, y, w, h, togglePressProgress = 0) {
    const mod = el.isToggleKnob || el.isBottomTabIndicator ? Math.max(0, Math.min(1, togglePressProgress)) : 1;
    let blur = (el.blurRadius || 0) * mod;
    let shadow = 0;
    if (el.outerShadow && el.outerShadow.alpha * mod >= 0.15) {
      shadow = (el.outerShadow.radius + Math.max(Math.abs(el.outerShadow.offsetX), Math.abs(el.outerShadow.offsetY))) * mod;
    }
    if (el.isToggleKnob) {
      blur = (el.blurRadius || 0) * (1 - mod) * 0 + 8 * (1 - mod);
    }
    const m = Math.max(blur, shadow, 3) + 4;
    let rx = x - m, ry = y - m, rw = w + 2 * m, rh = h + 2 * m;
    const rot = el.elementRotation ?? 0;
    if (Math.abs(rot) > 1e-3) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const cosA = Math.abs(Math.cos(rot));
      const sinA = Math.abs(Math.sin(rot));
      const rotW = rw * cosA + rh * sinA;
      const rotH = rw * sinA + rh * cosA;
      rx = cx - rotW / 2;
      ry = cy - rotH / 2;
      rw = rotW;
      rh = rotH;
    }
    return { x: rx, y: ry, w: rw, h: rh };
  }
  function shadowBboxCss(el, x, y, w, h, layerScaleX, layerScaleY, toggles) {
    if (!el.outerShadow || el.outerShadow.radius <= 0.5) return null;
    if (!toggles.outerShadow) return null;
    const r = el.outerShadow.radius;
    const ox = el.outerShadow.offsetX;
    const oy = el.outerShadow.offsetY;
    const left = Math.max(0, r - ox) * layerScaleX;
    const right = Math.max(0, r + ox) * layerScaleX;
    const top = Math.max(0, r - oy) * layerScaleY;
    const bottom = Math.max(0, r + oy) * layerScaleY;
    return {
      x: x - left,
      y: y - top,
      w: w + left + right,
      h: h + top + bottom
    };
  }
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  var init_methods_render_glass_geometry = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-geometry.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-transform.ts
  function computeElementTransform(el, st, r) {
    const isButton = el.kind === "button";
    const p = st?.pressProgress ?? 0;
    const PRESS_SCALE_RATIO = -0.03;
    let scale = 1;
    let translationX = 0;
    let translationY = 0;
    let scaleX = 1;
    let scaleY = 1;
    if (el.enterProgress != null) {
      const raw = el.enterProgress;
      const derived = raw < 0 ? (1 - Math.exp(-Math.abs(raw))) * -1 : raw <= 1 ? raw : 1 + (1 - Math.exp(-(raw - 1)));
      const enterTransFrom = el.enterTranslateFrom != null ? el.enterTranslateFrom : 48 * DP;
      translationY += -enterTransFrom * (1 - derived);
      if (el.enterStretchFactor != null && derived > 1) {
        translationY += el.enterStretchFactor * (derived - 1) * 32 * DP;
      }
      const sFactor = 1 + 0.1 * Math.max(0, derived - 1);
      scaleX /= sFactor;
      scaleY *= sFactor;
    }
    if (isButton && el.isInteractive && st) {
      const width = el.rect.w;
      const height = el.rect.h;
      const maxDim = Math.max(width, height);
      const minDim = Math.min(width, height);
      const maxOffset = minDim;
      const initialDerivative = 0.05;
      const maxDragScale = PRESS_SCALE_RATIO;
      const freezeMove = !!el.noPressScale || !!el.noPressMove;
      const freezeStretch = !!el.noPressScale || !!el.noPressStretch;
      scale = el.noPressScale ? 1 : 1 + PRESS_SCALE_RATIO * p;
      const dx = st.dragX - st.startDragX;
      const dy = st.dragY - st.startDragY;
      translationX += freezeMove ? 0 : maxOffset * Math.tanh(initialDerivative * dx / maxOffset);
      translationY += freezeMove ? 0 : maxOffset * Math.tanh(initialDerivative * dy / maxOffset);
      const offsetAngle = Math.atan2(dy, dx);
      const whCap = Math.min(width / height, 1);
      const hwCap = Math.min(height / width, 1);
      const stretchX = Math.min(maxDragScale * Math.abs(Math.cos(offsetAngle) * dx / maxDim) * whCap, 0.22);
      const stretchY = Math.min(maxDragScale * Math.abs(Math.sin(offsetAngle) * dy / maxDim) * hwCap, 0.22);
      scaleX = freezeStretch ? scale : scale + stretchX;
      scaleY = freezeStretch ? scale : scale + stretchY;
    } else if (el.enterProgress == null) {
      scaleX = scale;
      scaleY = scale;
    }
    let toggleXOffset = 0;
    let toggleScaleX = 1;
    let toggleScaleY = 1;
    let togglePressProgress = 0;
    if (el.isToggleKnob) {
      const tg = this.toggleStates.get(el.isToggleKnob.groupId);
      if (tg) {
        toggleXOffset = tg.fraction * el.isToggleKnob.dragWidth;
        toggleScaleX = tg.scaleX;
        toggleScaleY = tg.scaleY;
        togglePressProgress = tg.pressProgress;
        const divisor = el.isToggleKnob.velocityDivisor ?? 50;
        const vel = tg.velocity / divisor;
        const velX = Math.max(-0.2, Math.min(0.2, vel * 0.75));
        const velY = Math.max(-0.2, Math.min(0.2, vel * 0.25));
        toggleScaleX = toggleScaleX / (1 - velX);
        toggleScaleY = toggleScaleY * (1 - velY);
      }
    }
    scaleX *= toggleScaleX;
    scaleY *= toggleScaleY;
    if (el.isBottomTabContainer) {
      const tg = this.toggleStates.get(el.isBottomTabContainer.groupId);
      if (tg) {
        const containerScale = 1 + 16 * DP / el.rect.w * tg.pressProgress;
        scaleX *= containerScale;
        scaleY *= containerScale;
        translationX += tg.panelOffset;
        togglePressProgress = tg.pressProgress;
      }
    }
    if (false) {
      const tg = this.toggleStates.get(el.isBottomTabContent.groupId);
      if (tg) {
        const containerW = el.isBottomTabContent.containerWidth ?? el.rect.w;
        const containerScale = 1 + 16 * DP / containerW * tg.pressProgress;
        scaleX *= containerScale;
        const contentScale = 1 + 0.2 * tg.pressProgress;
        scaleX *= contentScale;
        scaleY *= containerScale * contentScale;
        translationX += tg.panelOffset;
      }
    }
    if (el.isBottomTabIndicator) {
      const tg = this.toggleStates.get(el.isBottomTabIndicator.groupId);
      if (tg) {
        toggleXOffset += tg.fraction * el.isBottomTabIndicator.dragWidth;
        toggleXOffset += tg.panelOffset;
        const indScaleX = tg.scaleX;
        const indScaleY = tg.scaleY;
        const vel = tg.velocity / 10;
        const velX = Math.max(-0.2, Math.min(0.2, vel * 0.75));
        const velY = Math.max(-0.2, Math.min(0.2, vel * 0.25));
        const finalIndScaleX = indScaleX / (1 - velX);
        const finalIndScaleY = indScaleY * (1 - velY);
        scaleX *= finalIndScaleX;
        scaleY *= finalIndScaleY;
        togglePressProgress = Math.max(togglePressProgress, tg.pressProgress);
      }
    }
    if (el.elementScaleX != null) scaleX *= el.elementScaleX;
    if (el.elementScaleY != null) scaleY *= el.elementScaleY;
    const cx = r.x + el.rect.w / 2 + translationX + toggleXOffset;
    const cy = r.y + el.rect.h / 2 + translationY;
    const sw = el.rect.w * scaleX;
    const sh = el.rect.h * scaleY;
    const sx = cx - sw / 2;
    const sy = cy - sh / 2;
    const cornerRadius = el.cornerRadius * Math.min(scaleX, scaleY);
    const radii = [
      cornerRadius,
      cornerRadius,
      cornerRadius,
      cornerRadius
    ];
    const eligibleForDirect = el.independentBackdrop || el.directBackdropSample && this.directBackdropSample;
    const independent = !!(eligibleForDirect && !this.backgroundColor && this.wallpaperTexture);
    return {
      sx,
      sy,
      sw,
      sh,
      radii,
      scaleX,
      scaleY,
      isButton,
      p,
      togglePressProgress,
      translationX,
      translationY,
      independent
    };
  }
  var init_methods_render_glass_transform = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-transform.ts"() {
      "use strict";
      init_spring();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-backdrop.ts
  function shouldUseSeparableBlur(el, state) {
    if (el.isToggleKnob || el.isBottomTabIndicator) return false;
    if (el.blurRadius < 0.5) return false;
    if (el.sampleWallpaper) return false;
    if (el.isSdfTexture && !el.isSdfTexture.useSeparableBlur) return false;
    return true;
  }
  function buildGlassRenderState(args) {
    const { el, st, transform, usePerElementFbo, sceneRectOffsetX, sceneRectOffsetY, elFboW, elFboH } = args;
    const {
      sx,
      sy,
      sw,
      sh,
      radii,
      scaleX,
      scaleY,
      isButton,
      p,
      togglePressProgress,
      independent
    } = transform;
    return {
      el,
      st,
      isButton,
      p,
      sx,
      sy,
      sw,
      sh,
      radii,
      togglePressProgress,
      // For toggle knobs + bottom-tab indicators, the rim highlight alpha is
      // modulated by pressProgress (faithful to Highlight.Default.copy(alpha=progress)).
      elHighlightAlpha: el.isToggleKnob || el.isBottomTabIndicator ? (el.highlight ? el.highlight.alpha : 0) * togglePressProgress : el.highlight ? el.highlight.alpha : 0,
      // Faithful to ControlCenterContent.kt: alpha = EaseIn.transform(safeProgress)
      // where safeProgress = safeEnterProgressAnimation.value (clamped 0..1).
      // EaseIn = CubicBezierEasing(0.42, 0, 1, 1). Use enterSafeProgress if
      // available, else fall back to clamped enterProgress.
      enterAlpha: el.enterProgress != null ? easeIn(
        el.enterSafeProgress != null ? Math.max(0, Math.min(1, el.enterSafeProgress)) : Math.max(0, Math.min(1, el.enterProgress))
      ) : 1,
      layerScaleX: scaleX,
      layerScaleY: scaleY,
      layerScale: Math.min(scaleX, scaleY),
      // ORIGINAL geometry (unscaled) for the element-pass SDF. The shader
      // computes SDF/refraction in original space, then maps the refraction
      // offset to screen space via uLayerScale — faithful to the original
      // which shades at original size then scales via graphicsLayer.
      origW: el.rect.w,
      origH: el.rect.h,
      origCornerRadius: el.cornerRadius,
      elementRotation: el.elementRotation ?? 0,
      independent,
      usePerElementFbo,
      sceneRectOffsetX,
      sceneRectOffsetY,
      elFboW,
      elFboH
    };
  }
  function resolveBackdropTex(state, curTex, outFbo) {
    const { el, independent, sx, sy, sw, sh, layerScale } = state;
    if (independent && shouldUseSeparableBlur(el, state) && this.quickToggles.backdropBlur) {
      const gl = this.gl;
      const blurRadiusPx = el.blurRadius * layerScale * this.dpr;
      const cssRadius = el.blurRadius * layerScale;
      const qRadius = Math.round(cssRadius * 10) / 10;
      const cacheKey = this.useBlurCache ? `wallpaper_${qRadius}_${this.useKawaseBlur ? "k" : "g"}` : null;
      const entry = cacheKey ? this.backdropBlurCache.get(cacheKey) : void 0;
      let blurred;
      let cacheHit = false;
      if (entry) {
        blurred = entry.tex;
        cacheHit = true;
        this.lastBlurStats = { type: entry.blurType, passes: 0, taps: 0, maxSample: 0, w: entry.w, h: entry.h, progMs: 0, stateMs: 0, drawMs: 0 };
      } else if (!cacheKey) {
        blurred = this.blurTexture(this.wallpaperBlurTex, blurRadiusPx);
      } else {
        if (this._blurCacheMissesThisFrame >= this.blurCacheMissesPerFrame) {
          return { backdropTex: curTex, didBlur: false };
        }
        this._blurCacheMissesThisFrame++;
        const t0 = performance.now();
        const blurResult = this.blurTexture(this.wallpaperBlurTex, blurRadiusPx);
        const t1 = performance.now();
        const progMs = this.lastBlurStats?.progMs ?? 0;
        const stateMs = this.lastBlurStats?.stateMs ?? 0;
        const drawMs = this.lastBlurStats?.drawMs ?? t1 - t0;
        const blurW = this.lastBlurStats?.w ?? this.dsBlurFboW ?? this.fboW;
        const blurH = this.lastBlurStats?.h ?? this.dsBlurFboH ?? this.fboH;
        const cacheFbo = this.acquireCacheFBO(blurW, blurH);
        const gl2 = this.gl;
        const savedFb = this.glStateCached(gl2).fb;
        const savedScissor = this.glStateCached(gl2).scissor;
        const savedBox = this.glStateCached(gl2).box;
        this.scissorTestRaw(gl2, false);
        if (!this.cacheCopyReadFbo) this.cacheCopyReadFbo = gl2.createFramebuffer();
        this.bindFbRaw(gl2, gl2.FRAMEBUFFER, this.cacheCopyReadFbo);
        gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, blurResult, 0);
        gl2.activeTexture(gl2.TEXTURE0);
        gl2.bindTexture(gl2.TEXTURE_2D, null);
        gl2.bindTexture(gl2.TEXTURE_2D, cacheFbo.tex);
        gl2.copyTexImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, 0, 0, blurW, blurH, 0);
        if (this.showBlurCacheCheckerboard) {
          this.bindFbRaw(gl2, gl2.FRAMEBUFFER, cacheFbo.fb);
          gl2.viewport(0, 0, blurW, blurH);
          const cellSize = Math.max(8, Math.floor(blurW / 20));
          this.scissorTestRaw(gl2, true);
          gl2.clearColor(0, 0, 0, 0);
          for (let cy = 0; cy < blurH; cy += cellSize) {
            for (let cx = 0; cx < blurW; cx += cellSize) {
              if ((Math.floor(cx / cellSize) + Math.floor(cy / cellSize)) % 2 !== 0) {
                this.scissorRaw(gl2, cx, cy, Math.min(cellSize, blurW - cx), Math.min(cellSize, blurH - cy));
                gl2.clear(gl2.COLOR_BUFFER_BIT);
              }
            }
          }
          this.scissorTestRaw(gl2, false);
        }
        const t2 = performance.now();
        const blurMs = t1 - t0;
        const copyMs = t2 - t1;
        let readPixelsMs = 0;
        let scanMs = 0;
        let snapW = 0, snapH = 0;
        let snapBuf = new Uint8Array(0);
        let snapNZ = 0;
        let minX = 0, minY = 0, maxX = 0, maxY = 0;
        if (this.showBlurCachePreview) {
          snapW = blurW;
          snapH = blurH;
          const ta = performance.now();
          snapBuf = new Uint8Array(snapW * snapH * 4);
          const tr0 = performance.now();
          this.bindFbRaw(gl2, gl2.FRAMEBUFFER, cacheFbo.fb);
          gl2.readPixels(0, 0, snapW, snapH, gl2.RGBA, gl2.UNSIGNED_BYTE, snapBuf);
          const tr1 = performance.now();
          for (let y = 0; y < snapH; y++) {
            for (let x = 0; x < snapW; x++) {
              const i = (y * snapW + x) * 4;
              if (snapBuf[i] + snapBuf[i + 1] + snapBuf[i + 2] + snapBuf[i + 3] > 0) {
                snapNZ++;
                if (x < minX || snapNZ === 1) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY || snapNZ === 1) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          const ts = performance.now();
          readPixelsMs = tr1 - tr0;
          scanMs = ts - tr1 + (tr0 - ta);
        }
        this.backdropBlurCacheSnapshots.push({
          key: snapW > 0 ? `${cacheKey} [${minX},${minY}-${maxX},${maxY}]` : cacheKey,
          w: snapW,
          h: snapH,
          rgba: snapBuf,
          nonZero: snapNZ,
          progMs,
          stateMs,
          drawMs,
          copyMs,
          readPixelsMs,
          scanMs,
          totalMs: progMs + stateMs + drawMs + copyMs + readPixelsMs + scanMs
        });
        this.bindFBO(savedFb);
        if (savedScissor) {
          this.scissorTestRaw(gl2, true);
          this.scissorRaw(gl2, savedBox[0], savedBox[1], savedBox[2], savedBox[3]);
        }
        this.backdropBlurCache.set(cacheKey, {
          fb: cacheFbo.fb,
          tex: cacheFbo.tex,
          w: blurW,
          h: blurH,
          blurType: this.lastBlurStats?.type ?? "gauss"
        });
        this.evictBackdropBlurCacheIfNeeded();
        blurred = cacheFbo.tex;
      }
      if (this.showBlurDebug) {
        const s = this.lastBlurStats;
        this.debugBlurRegions.push({
          x: sx,
          y: sy,
          w: sw,
          h: sh,
          radius: blurRadiusPx,
          ds: this.effectiveBlurDownsample,
          blurW: this.dsBlurFboW,
          blurH: this.dsBlurFboH,
          blurType: s?.type ?? "gauss",
          passes: s?.passes ?? 0,
          taps: s?.taps ?? 0,
          maxSample: s?.maxSample ?? 0,
          cached: cacheHit
        });
      }
      this.perfMonitor.incBlurPass();
      this.perfMonitor.incDrawCall(3);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.bindFBO(outFbo);
      gl.viewport(0, 0, this.fboW, this.fboH);
      const passState = { ...state, independent: false };
      return { backdropTex: blurred, passState, didBlur: true };
    }
    if (independent) {
      return { backdropTex: curTex, didBlur: false };
    }
    if (shouldUseSeparableBlur(el, state) && this.quickToggles.backdropBlur) {
      const blurRadiusPx = el.blurRadius * layerScale * this.dpr;
      let backdropSrc;
      if (el.backdropFbo && this.dialogBackdropTex) {
        backdropSrc = this.dialogBackdropTex;
      } else if (this.quickToggles.isolateBackdrop && this.bgOnlyTex) {
        backdropSrc = this.bgOnlyTex;
      } else {
        backdropSrc = curTex;
      }
      const canCacheSceneBlur = this.useBlurCache && backdropSrc === curTex && !el.backdropFbo;
      const isScrolling = this.scrollY !== this._lastBlurCacheScrollY;
      this._lastBlurCacheScrollY = this.scrollY;
      const cssRadius = el.blurRadius * layerScale;
      const qRadius = Math.round(cssRadius * 10) / 10;
      const sceneCacheKey = canCacheSceneBlur && !isScrolling ? `scene_${el.id}_${qRadius}_${this.useKawaseBlur ? "k" : "g"}` : null;
      let blurred;
      let cacheHit = false;
      if (sceneCacheKey) {
        const entry = this.backdropBlurCache.get(sceneCacheKey);
        if (entry) {
          blurred = entry.tex;
          cacheHit = true;
          this.lastBlurStats = { type: entry.blurType, passes: 0, taps: 0, maxSample: 0, w: entry.w, h: entry.h, progMs: 0, stateMs: 0, drawMs: 0 };
        } else {
          if (this._blurCacheMissesThisFrame >= this.blurCacheMissesPerFrame) {
            return { backdropTex: backdropSrc, didBlur: false };
          }
          this._blurCacheMissesThisFrame++;
          const sT0 = performance.now();
          blurred = this.blurTexture(backdropSrc, blurRadiusPx);
          const sT1 = performance.now();
          const sProgMs = this.lastBlurStats?.progMs ?? 0;
          const sStateMs = this.lastBlurStats?.stateMs ?? 0;
          const sDrawMs = this.lastBlurStats?.drawMs ?? sT1 - sT0;
          const blurW = this.lastBlurStats?.w ?? this.dsBlurFboW ?? this.fboW;
          const blurH = this.lastBlurStats?.h ?? this.dsBlurFboH ?? this.fboH;
          const cacheFbo = this.acquireCacheFBO(blurW, blurH);
          const gl2 = this.gl;
          const savedFb = this.glStateCached(gl2).fb;
          const savedSc = this.glStateCached(gl2).scissor;
          const savedBox = this.glStateCached(gl2).box;
          this.scissorTestRaw(gl2, false);
          if (!this.cacheCopyReadFbo) this.cacheCopyReadFbo = gl2.createFramebuffer();
          this.bindFbRaw(gl2, gl2.FRAMEBUFFER, this.cacheCopyReadFbo);
          gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, blurred, 0);
          gl2.activeTexture(gl2.TEXTURE0);
          gl2.bindTexture(gl2.TEXTURE_2D, null);
          gl2.bindTexture(gl2.TEXTURE_2D, cacheFbo.tex);
          gl2.copyTexImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, 0, 0, blurW, blurH, 0);
          if (this.showBlurCacheCheckerboard) {
            this.bindFbRaw(gl2, gl2.FRAMEBUFFER, cacheFbo.fb);
            gl2.viewport(0, 0, blurW, blurH);
            const cellSize = Math.max(8, Math.floor(blurW / 20));
            this.scissorTestRaw(gl2, true);
            gl2.clearColor(0, 0, 0, 0);
            for (let cy = 0; cy < blurH; cy += cellSize) {
              for (let cx = 0; cx < blurW; cx += cellSize) {
                if ((Math.floor(cx / cellSize) + Math.floor(cy / cellSize)) % 2 !== 0) {
                  this.scissorRaw(gl2, cx, cy, Math.min(cellSize, blurW - cx), Math.min(cellSize, blurH - cy));
                  gl2.clear(gl2.COLOR_BUFFER_BIT);
                }
              }
            }
            this.scissorTestRaw(gl2, false);
          }
          const sT2 = performance.now();
          const sCopyMs = sT2 - sT1;
          let sReadPixelsMs = 0;
          let sScanMs = 0;
          let sSnapW = 0, sSnapH = 0;
          let sBuf = new Uint8Array(0);
          let sNZ = 0;
          let sMinX = 0, sMinY = 0, sMaxX = 0, sMaxY = 0;
          if (this.showBlurCachePreview) {
            sSnapW = blurW;
            sSnapH = blurH;
            const sTa = performance.now();
            sBuf = new Uint8Array(sSnapW * sSnapH * 4);
            const sTr0 = performance.now();
            this.bindFbRaw(gl2, gl2.FRAMEBUFFER, cacheFbo.fb);
            gl2.readPixels(0, 0, sSnapW, sSnapH, gl2.RGBA, gl2.UNSIGNED_BYTE, sBuf);
            const sTr1 = performance.now();
            for (let y = 0; y < sSnapH; y++) {
              for (let x = 0; x < sSnapW; x++) {
                const i = (y * sSnapW + x) * 4;
                if (sBuf[i] + sBuf[i + 1] + sBuf[i + 2] + sBuf[i + 3] > 0) {
                  sNZ++;
                  if (x < sMinX || sNZ === 1) sMinX = x;
                  if (x > sMaxX) sMaxX = x;
                  if (y < sMinY || sNZ === 1) sMinY = y;
                  if (y > sMaxY) sMaxY = y;
                }
              }
            }
            const sTs = performance.now();
            sReadPixelsMs = sTr1 - sTr0;
            sScanMs = sTs - sTr1 + (sTr0 - sTa);
          }
          this.backdropBlurCacheSnapshots.push({
            key: sSnapW > 0 ? `${sceneCacheKey} [${sMinX},${sMinY}-${sMaxX},${sMaxY}]` : sceneCacheKey,
            w: sSnapW,
            h: sSnapH,
            rgba: sBuf,
            nonZero: sNZ,
            progMs: sProgMs,
            stateMs: sStateMs,
            drawMs: sDrawMs,
            copyMs: sCopyMs,
            readPixelsMs: sReadPixelsMs,
            scanMs: sScanMs,
            totalMs: sProgMs + sStateMs + sDrawMs + sCopyMs + sReadPixelsMs + sScanMs
          });
          this.bindFbRaw(gl2, gl2.FRAMEBUFFER, savedFb);
          if (savedSc) {
            this.scissorTestRaw(gl2, true);
            this.scissorRaw(gl2, savedBox[0], savedBox[1], savedBox[2], savedBox[3]);
          }
          this.backdropBlurCache.set(sceneCacheKey, {
            fb: cacheFbo.fb,
            tex: cacheFbo.tex,
            w: blurW,
            h: blurH,
            blurType: this.lastBlurStats?.type ?? "gauss"
          });
          this.evictBackdropBlurCacheIfNeeded();
          blurred = cacheFbo.tex;
        }
      } else {
        if (this.useBlurCache && this._blurCacheMissesThisFrame >= this.blurCacheMissesPerFrame) {
          return { backdropTex: backdropSrc, didBlur: false };
        }
        if (this.useBlurCache) this._blurCacheMissesThisFrame++;
        blurred = this.blurTexture(backdropSrc, blurRadiusPx);
      }
      if (this.showBlurDebug) {
        const s = this.lastBlurStats;
        this.debugBlurRegions.push({
          x: sx,
          y: sy,
          w: sw,
          h: sh,
          radius: blurRadiusPx,
          ds: this.effectiveBlurDownsample,
          blurW: this.dsBlurFboW,
          blurH: this.dsBlurFboH,
          blurType: s?.type ?? "gauss",
          passes: s?.passes ?? 0,
          taps: s?.taps ?? 0,
          maxSample: s?.maxSample ?? 0,
          cached: cacheHit
        });
      }
      this.perfMonitor.incBlurPass();
      this.perfMonitor.incDrawCall(2);
      const gl = this.gl;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.bindFBO(outFbo);
      gl.viewport(0, 0, this.fboW, this.fboH);
      const passState = el.backdropFbo ? { ...state, el: { ...el, backdropFbo: false } } : state;
      return { backdropTex: blurred, passState, didBlur: true };
    }
    if (this.quickToggles.isolateBackdrop && this.bgOnlyTex && !el.backdropFbo) {
      return { backdropTex: this.bgOnlyTex, didBlur: false };
    }
    return { backdropTex: curTex, didBlur: false };
  }
  var init_methods_render_glass_backdrop = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-backdrop.ts"() {
      "use strict";
      init_gl_utils();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pingpong.ts
  function renderGlassElement(el, st, curFbo, curTex, otherFbo, otherTex, r) {
    const gl = this.gl;
    const t = computeElementTransform.call(this, el, st, r);
    const { sx, sy, sw, sh, scaleX, scaleY, togglePressProgress } = t;
    if (this.quickToggles.perElementFbo) {
      this.perfMonitor.incGlassElement();
      this.perfMonitor.incPerElementFbo();
      const elDirty = this.allDirty || this.dirtyElementIds.has(el.id);
      return this.renderGlassElementPerFbo(el, st, curFbo, curTex, otherFbo, otherTex, {
        sx,
        sy,
        sw,
        sh,
        radii: t.radii,
        scaleX,
        scaleY,
        isButton: t.isButton,
        p: t.p,
        togglePressProgress,
        independent: t.independent,
        translationX: t.translationX,
        translationY: t.translationY,
        elDirty
      });
    }
    this._dbgLastGlassCacheHit = false;
    if (this.showDirtyMarkers) {
      this.debugCacheMissLog.push({ id: el.id, reason: "ping_pong", x: sx, y: sy, w: sw, h: sh });
    }
    this.dirtyRectsThisFrame.push({
      ...inflatedOutputRect(el, sx, sy, sw, sh, togglePressProgress),
      source: `pingpong:${el.id}`
    });
    this.perfMonitor.incGlassElement();
    this.perfMonitor.incPingPong();
    this.bindFBO(otherFbo);
    this.drawCopy(curTex);
    this.perfMonitor.incDrawCall();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const MARGIN_CSS = computeScissorMarginCss(el, Math.min(scaleX, scaleY), this.quickToggles);
    const scissorX = Math.max(0, Math.round((sx - MARGIN_CSS) * this.dpr));
    const scissorY = Math.max(0, Math.round((this.cssHeight - (sy + sh + MARGIN_CSS)) * this.dpr));
    const scissorW = Math.min(this.fboW - scissorX, Math.round((sw + 2 * MARGIN_CSS) * this.dpr));
    const scissorH = Math.min(this.fboH - scissorY, Math.round((sh + 2 * MARGIN_CSS) * this.dpr));
    const clip = this.intersectClipScissor(el, scissorX, scissorY, scissorW, scissorH);
    this.scissorTestRaw(gl, true);
    this.scissorRaw(gl, clip.x, clip.y, clip.w, clip.h);
    if (this.showPefBbox) {
      const pxX = scissorX / this.dpr;
      const pxY = (this.fboH - scissorY - scissorH) / this.dpr;
      this.debugPefBboxes.push({
        x: pxX,
        y: pxY,
        w: scissorW / this.dpr,
        h: scissorH / this.dpr,
        fbo: false
      });
    }
    const state = buildGlassRenderState({
      el,
      st,
      transform: t,
      usePerElementFbo: false,
      sceneRectOffsetX: 0,
      sceneRectOffsetY: 0,
      elFboW: 0,
      elFboH: 0
    });
    this.renderGlassShadowPass(state);
    const backdrop = resolveBackdropTex.call(this, state, curTex, otherFbo);
    this.renderGlassElementPass(backdrop.passState ?? state, backdrop.backdropTex, backdrop.backdropBbox);
    this.renderGlassPostPasses(state);
    this.scissorTestRaw(gl, false);
    return {
      curFbo: otherFbo,
      curTex: otherTex,
      otherFbo: curFbo,
      otherTex: curTex
    };
  }
  var init_methods_render_glass_pingpong = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pingpong.ts"() {
      "use strict";
      init_methods_render_glass_geometry();
      init_methods_render_glass_transform();
      init_methods_render_glass_backdrop();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-geometry.ts
  function computeElFboGeometry(el, sx, sy, sw, sh, layerScale) {
    const scissorMarginCss = computeScissorMarginCss(el, layerScale, this.quickToggles);
    const ELFBO_PAD_DEVICE = 2;
    const elFboMarginCss = (ELFBO_PAD_DEVICE + 1) / this.dpr;
    const rawBx0 = Math.round((sx - scissorMarginCss) * this.dpr);
    const rawBy0Top = Math.round((sy - scissorMarginCss) * this.dpr);
    const bx0 = Math.max(0, Math.min(this.fboW, rawBx0));
    const by0Top = Math.max(0, Math.min(this.fboH, rawBy0Top));
    const bboxW = Math.max(
      0,
      Math.min(this.fboW - bx0, Math.round((sw + 2 * scissorMarginCss) * this.dpr))
    );
    const bboxH = Math.max(
      0,
      Math.min(this.fboH - by0Top, Math.round((sh + 2 * scissorMarginCss) * this.dpr))
    );
    const bboxScissorY = Math.max(0, this.fboH - by0Top - bboxH);
    const elFboRectW = Math.max(1, Math.round((el.rect.w + 2 * elFboMarginCss) * this.dpr));
    const elFboRectH = Math.max(1, Math.round((el.rect.h + 2 * elFboMarginCss) * this.dpr));
    const rawEx0 = Math.round((sx - elFboMarginCss) * this.dpr);
    const rawEy0Top = Math.round((sy - elFboMarginCss) * this.dpr);
    const ex0 = rawEx0;
    const ey0Top = rawEy0Top;
    const scissorX = Math.max(0, Math.min(this.fboW, rawEx0));
    const scissorYTop = Math.max(0, Math.min(this.fboH, rawEy0Top));
    const scissorW = Math.max(0, Math.min(this.fboW - scissorX, elFboRectW));
    const scissorH = Math.max(0, Math.min(this.fboH - scissorYTop, elFboRectH));
    const elFboScissorY = Math.max(0, this.fboH - scissorYTop - scissorH);
    const sceneOffsetX = rawEx0;
    const sceneOffsetY = rawEy0Top;
    return {
      bx0,
      by0Top,
      bboxW,
      bboxH,
      bboxScissorY,
      elFboRectW,
      elFboRectH,
      ex0,
      ey0Top,
      scissorX,
      scissorYTop,
      scissorW,
      scissorH,
      elFboScissorY,
      sceneOffsetX,
      sceneOffsetY,
      scissorMarginCss
    };
  }
  var init_methods_render_glass_pef_geometry = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-geometry.ts"() {
      "use strict";
      init_methods_render_glass_geometry();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-cache-flags.ts
  function computeCacheFlags(el) {
    const cacheable = !!(this.wallpaperTexture && !el.backdropFbo);
    const positionInvariant = !!(el.isToggleKnob?.solidBackdropColor && !el.backdropFbo);
    const scrollInvariant = !!(el.isToggleKnob && !el.isToggleKnob.solidBackdropColor && !el.isToggleKnob.trackColorOff && // slider knob (not toggle knob)
    this.backgroundColor && // solid-bg page (no wallpaper)
    !el.backdropFbo);
    return { cacheable, positionInvariant, scrollInvariant };
  }
  var init_methods_render_glass_pef_cache_flags = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-cache-flags.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-cache-resolve.ts
  function resolveElFboCache(el, state, geom, flags) {
    const { sx, sy, sw, sh, togglePressProgress, independent } = state;
    const { elFboRectW, elFboRectH, sceneOffsetX, sceneOffsetY } = geom;
    const { cacheable, positionInvariant, scrollInvariant } = flags;
    const gl = this.gl;
    if (!cacheable) {
      if (this.showDirtyMarkers) {
        const ncReason = !this.wallpaperTexture ? "non_cacheable:no_wp" : el.backdropFbo ? "non_cacheable:backdropFbo" : "non_cacheable:unknown";
        this.debugCacheMissLog.push({ id: el.id, reason: ncReason, x: sx, y: sy, w: sw, h: sh });
      }
      const ensured = this.ensureElementFBO(elFboRectW, elFboRectH);
      return {
        cacheHit: false,
        cacheWrite: false,
        renderFbo: this.elFbo,
        renderTex: this.elFboTex,
        elFboW: ensured.w,
        elFboH: ensured.h
      };
    }
    const entry = this.elFboCache.get(el.id);
    let missReason = null;
    const skipPosition = positionInvariant || scrollInvariant;
    if (!entry) {
      missReason = "no_entry";
    } else if (entry.w !== elFboRectW || entry.h !== elFboRectH) {
      missReason = "size_mismatch";
    } else if (!skipPosition && (entry.ex0 !== sceneOffsetX || entry.ey0Top !== sceneOffsetY)) {
      missReason = "position_mismatch";
    } else if (!entry.valid) {
      missReason = "invalidated";
    } else if (entry.wallpaperVersion !== this.wallpaperVersion) {
      missReason = "wallpaper_version";
    } else if (entry.dpr !== this.dpr) {
      missReason = "dpr";
    } else if (!positionInvariant && !independent) {
      const myRect = inflatedOutputRect(el, sx, sy, sw, sh, togglePressProgress);
      const overlap = this.dirtyRectsThisFrame.find(
        (r) => rectsOverlap(r, myRect) && !(scrollInvariant && r.source === "scroll")
      );
      if (overlap) {
        missReason = `backdrop_overlap:${overlap.source}`;
      }
    }
    if (missReason && this.showDirtyMarkers) {
      this.debugCacheMissLog.push({ id: el.id, reason: missReason, x: sx, y: sy, w: sw, h: sh });
    }
    if (entry && missReason === null) {
      if (positionInvariant || scrollInvariant) {
        entry.ex0 = sceneOffsetX;
        entry.ey0Top = sceneOffsetY;
      }
      this.perfMonitor.incCachedElement();
      return {
        cacheHit: true,
        cacheWrite: false,
        renderFbo: entry.fb,
        renderTex: entry.tex,
        elFboW: entry.w,
        elFboH: entry.h
      };
    }
    if (!entry) {
      const created = this.createFBO(elFboRectW, elFboRectH);
      this.elFboCache.set(el.id, {
        fb: created.fb,
        tex: created.tex,
        w: elFboRectW,
        h: elFboRectH,
        ex0: sceneOffsetX,
        ey0Top: sceneOffsetY,
        valid: false,
        wallpaperVersion: this.wallpaperVersion,
        dpr: this.dpr
      });
    } else if (entry.w !== elFboRectW || entry.h !== elFboRectH) {
      gl.deleteFramebuffer(entry.fb);
      gl.deleteTexture(entry.tex);
      const created = this.createFBO(elFboRectW, elFboRectH);
      entry.fb = created.fb;
      entry.tex = created.tex;
      entry.w = elFboRectW;
      entry.h = elFboRectH;
    }
    const e = this.elFboCache.get(el.id);
    e.ex0 = sceneOffsetX;
    e.ey0Top = sceneOffsetY;
    e.valid = false;
    e.wallpaperVersion = this.wallpaperVersion;
    e.dpr = this.dpr;
    return {
      cacheHit: false,
      cacheWrite: true,
      renderFbo: e.fb,
      renderTex: e.tex,
      elFboW: e.w,
      elFboH: e.h
    };
  }
  var init_methods_render_glass_pef_cache_resolve = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-cache-resolve.ts"() {
      "use strict";
      init_methods_render_glass_geometry();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-cache.ts
  var init_methods_render_glass_pef_cache = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef-cache.ts"() {
      "use strict";
      init_methods_render_glass_pef_geometry();
      init_methods_render_glass_pef_cache_flags();
      init_methods_render_glass_pef_cache_resolve();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef.ts
  function renderGlassElementPerFbo(el, st, curFbo, curTex, otherFbo, otherTex, computed) {
    const gl = this.gl;
    const layerScale = Math.min(computed.scaleX, computed.scaleY);
    const geom = computeElFboGeometry.call(this, el, computed.sx, computed.sy, computed.sw, computed.sh, layerScale);
    const rot = el.elementRotation ?? 0;
    const rotCosAbs = Math.abs(Math.cos(rot));
    const rotSinAbs = Math.abs(Math.sin(rot));
    const m = geom.scissorMarginCss;
    const fullW = computed.sw + 2 * m;
    const fullH = computed.sh + 2 * m;
    const rotBboxW = fullW * rotCosAbs + fullH * rotSinAbs;
    const rotBboxH = fullW * rotSinAbs + fullH * rotCosAbs;
    const bboxCx = computed.sx + computed.sw / 2;
    const bboxCy = computed.sy + computed.sh / 2;
    const rotScX = Math.max(0, Math.min(this.fboW, Math.round((bboxCx - rotBboxW / 2) * this.dpr)));
    const rotScY = Math.max(0, Math.min(this.fboH, Math.round((this.cssHeight - (bboxCy + rotBboxH / 2)) * this.dpr)));
    const rotScW = Math.max(0, Math.min(this.fboW - rotScX, Math.round(rotBboxW * this.dpr)));
    const rotScH = Math.max(0, Math.min(this.fboH - rotScY, Math.round(rotBboxH * this.dpr)));
    if (this.showPefBbox) {
      this.debugPefBboxes.push({
        x: geom.ex0 / this.dpr,
        y: geom.ey0Top / this.dpr,
        w: geom.elFboRectW / this.dpr,
        h: geom.elFboRectH / this.dpr,
        fbo: true
      });
    }
    const flags = computeCacheFlags.call(this, el);
    let state = buildGlassRenderState({
      el,
      st,
      transform: computed,
      usePerElementFbo: true,
      sceneRectOffsetX: geom.sceneOffsetX,
      sceneRectOffsetY: geom.sceneOffsetY,
      elFboW: 0,
      // overwritten after cache resolution
      elFboH: 0
    });
    const cache = resolveElFboCache.call(this, el, state, geom, flags);
    state = { ...state, elFboW: cache.elFboW, elFboH: cache.elFboH };
    const shadowClip = this.intersectClipScissor(el, rotScX, rotScY, rotScW, rotScH);
    this.bindFBO(curFbo);
    this.scissorTestRaw(gl, true);
    this.scissorRaw(gl, shadowClip.x, shadowClip.y, shadowClip.w, shadowClip.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.renderGlassShadowPass(state);
    if (!cache.cacheHit) {
      this.dirtyRectsThisFrame.push({
        ...inflatedOutputRect(el, computed.sx, computed.sy, computed.sw, computed.sh, computed.togglePressProgress),
        source: `glass:${el.id}`
      });
      const backdrop = resolveBackdropTex.call(this, state, curTex, cache.renderFbo);
      this.bindFbRaw(gl, gl.FRAMEBUFFER, cache.renderFbo);
      gl.viewport(0, 0, cache.elFboW, cache.elFboH);
      this.scissorTestRaw(gl, false);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      this.renderGlassElementPass(backdrop.passState ?? state, backdrop.backdropTex, backdrop.backdropBbox);
      if (cache.cacheWrite) {
        const e = this.elFboCache.get(el.id);
        if (e) e.valid = true;
      }
    }
    const elemCx = bboxCx;
    const elemCy = bboxCy;
    const compAabbW = computed.sw * rotCosAbs + computed.sh * rotSinAbs;
    const compAabbH = computed.sw * rotSinAbs + computed.sh * rotCosAbs;
    const compScX = Math.max(0, Math.min(this.fboW, Math.round((elemCx - compAabbW / 2) * this.dpr)));
    const compScY = Math.max(0, Math.min(this.fboH, Math.round((this.cssHeight - (elemCy + compAabbH / 2)) * this.dpr)));
    const compScW = Math.max(0, Math.min(this.fboW - compScX, Math.round(compAabbW * this.dpr)));
    const compScH = Math.max(0, Math.min(this.fboH - compScY, Math.round(compAabbH * this.dpr)));
    const compClip = this.intersectClipScissor(el, compScX, compScY, compScW, compScH);
    this.bindFBO(curFbo);
    this.scissorTestRaw(gl, true);
    this.scissorRaw(gl, compClip.x, compClip.y, compClip.w, compClip.h);
    this.drawElFboComposite(
      cache.renderTex,
      cache.elFboW,
      cache.elFboH,
      elemCx * this.dpr,
      elemCy * this.dpr,
      // element center (device px, top-left origin)
      computed.sw * this.dpr,
      computed.sh * this.dpr,
      // SCALED element size (device px)
      rot
    );
    const postClip = this.intersectClipScissor(el, rotScX, rotScY, rotScW, rotScH);
    this.scissorRaw(gl, postClip.x, postClip.y, postClip.w, postClip.h);
    this.renderGlassPostPasses(state);
    this.scissorTestRaw(gl, false);
    this._dbgLastGlassCacheHit = cache.cacheHit;
    if (this.showPefPassDebug) {
      const cssEx0 = geom.ex0 / this.dpr;
      const cssEy0 = geom.ey0Top / this.dpr;
      const cssEw = geom.elFboRectW / this.dpr;
      const cssEh = geom.elFboRectH / this.dpr;
      const cssBx0 = geom.bx0 / this.dpr;
      const cssBy0 = geom.by0Top / this.dpr;
      const cssBw = geom.bboxW / this.dpr;
      const cssBh = geom.bboxH / this.dpr;
      this.debugPefPasses.push({
        id: el.id,
        cacheHit: cache.cacheHit,
        missReason: cache.cacheHit ? null : "MISS",
        composite: { x: cssEx0, y: cssEy0, w: cssEw, h: cssEh },
        postPass: { x: cssBx0, y: cssBy0, w: cssBw, h: cssBh },
        isBottomTabIndicator: !!el.isBottomTabIndicator,
        togglePressProgress: state.togglePressProgress,
        elHighlightAlpha: state.elHighlightAlpha
      });
    }
    return { curFbo, curTex, otherFbo, otherTex };
  }
  var init_methods_render_glass_pef = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-pef.ts"() {
      "use strict";
      init_methods_render_glass_geometry();
      init_methods_render_glass_backdrop();
      init_methods_render_glass_pef_cache();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-shadow.ts
  function renderGlassShadowPass(state) {
    const gl = this.gl;
    const { el, sx, sy, sw, sh, radii } = state;
    if (!el.outerShadow || el.outerShadow.radius <= 0.5) return;
    if (!this.quickToggles.outerShadow) return;
    let shadowAlpha = el.outerShadow.alpha;
    if (el.isBottomTabIndicator) {
      shadowAlpha *= state.togglePressProgress;
    }
    if (this.showShadowBbox) {
      const bbox = shadowBboxCss(el, sx, sy, sw, sh, state.layerScaleX, state.layerScaleY, this.quickToggles);
      if (bbox) {
        this.debugShadowBboxes.push({
          ...bbox,
          alpha: shadowAlpha,
          skipped: shadowAlpha <= 1e-3,
          r: el.outerShadow.radius,
          ox: el.outerShadow.offsetX,
          oy: el.outerShadow.offsetY
        });
      }
    }
    if (shadowAlpha <= 1e-3) return;
    gl.useProgram(this.shadowProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aPosLocSh);
    gl.vertexAttribPointer(this.aPosLocSh, 2, gl.FLOAT, false, 0, 0);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.uSh["uCanvasSize"], this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uSh["uElementOffset"], sx * this.dpr, sy * this.dpr);
    gl.uniform2f(this.uSh["uElementSize"], sw * this.dpr, sh * this.dpr);
    gl.uniform4f(
      this.uSh["uCornerRadii"],
      radii[0] * this.dpr,
      radii[1] * this.dpr,
      radii[2] * this.dpr,
      radii[3] * this.dpr
    );
    gl.uniform2f(this.uSh["uOriginalSize"], state.origW * this.dpr, state.origH * this.dpr);
    gl.uniform1f(this.uSh["uOriginalCornerRadius"], state.origCornerRadius * this.dpr);
    gl.uniform2f(this.uSh["uLayerScale"], state.layerScaleX, state.layerScaleY);
    gl.uniform1f(this.uSh["uElementRotation"], state.elementRotation);
    gl.uniform1f(this.uSh["uCornerStyle"], this.cornerStyle);
    gl.uniform1f(this.uSh["uShadowRadius"], el.outerShadow.radius * this.dpr);
    gl.uniform2f(
      this.uSh["uShadowOffset"],
      el.outerShadow.offsetX * this.dpr,
      el.outerShadow.offsetY * this.dpr
    );
    gl.uniform4f(
      this.uSh["uShadowColor"],
      el.outerShadow.color[0],
      el.outerShadow.color[1],
      el.outerShadow.color[2],
      shadowAlpha
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  var init_methods_render_glass_shadow = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-shadow.ts"() {
      "use strict";
      init_methods_render_glass_geometry();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass.ts
  var glassRenderMethods;
  var init_methods_render_glass = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass.ts"() {
      "use strict";
      init_methods_render_glass_pingpong();
      init_methods_render_glass_pef();
      init_methods_render_glass_shadow();
      init_methods_render_glass_geometry();
      glassRenderMethods = {
        renderGlassElement,
        renderGlassElementPerFbo,
        renderGlassShadowPass
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render.ts
  var renderMethods;
  var init_methods_render = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render.ts"() {
      "use strict";
      init_methods_render_glass();
      renderMethods = {
        render() {
          if (!this.needsRedraw) return;
          this.needsRedraw = false;
          this.dirtyRectsThisFrame.length = 0;
          this.debugCacheMissLog.length = 0;
          this.debugDirtySourceLog.length = 0;
          this._blurCacheMissesThisFrame = 0;
          if (this.allDirty || this.scrollY !== this.lastRenderedScrollY) {
            this.dirtyRectsThisFrame.push({
              x: 0,
              y: 0,
              w: this.cssWidth,
              h: this.cssHeight,
              source: this.allDirty ? "all_dirty" : "scroll"
            });
          }
          this.lastRenderedScrollY = this.scrollY;
          this.perfMonitor.canvasCssW = this.cssWidth;
          this.perfMonitor.canvasCssH = this.cssHeight;
          this.perfMonitor.canvasDevW = this.canvas.width;
          this.perfMonitor.canvasDevH = this.canvas.height;
          this.perfMonitor.dpr = this.dpr;
          this.perfMonitor.deviceDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
          this.perfMonitor.frameStart();
          this.debugPefBboxes.length = 0;
          this.debugBlurRegions.length = 0;
          this.debugShadowBboxes.length = 0;
          this.debugDirtyMarkers.length = 0;
          this.debugCullRects.length = 0;
          this.debugPefPasses.length = 0;
          this.debugPlainRects.length = 0;
          if (!this.wallpaperReady && !this.backgroundColor) {
            this.perfMonitor.frameEnd();
            return;
          }
          const gl = this.gl;
          this.resizeFBOs(this.canvas.width, this.canvas.height);
          for (const cfg of this.buttonConfigs) {
            if (this.fgDirtyIds.has(cfg.id)) {
              this.rasterizeForeground(cfg);
            }
          }
          this.renderBackground();
          this.perfMonitor.incDrawCall();
          if (this.buttonConfigs.length === 0) {
            this.bindFBO(null);
            this.drawCopy(this.fboATex);
            this.perfMonitor.incDrawCall();
            this.perfMonitor.frameEnd();
            return;
          }
          const sceneBlurEl = this.buttonConfigs.find((e) => (e.sceneBlurRadius ?? 0) >= 0.5);
          if (sceneBlurEl) {
            const r = sceneBlurEl.sceneBlurRadius * this.dpr;
            const blurred = this.blurTexture(this.fboATex, r);
            this.bindFBO(this.fboA);
            this.drawCopy(blurred);
            this.perfMonitor.incBlurPass();
            this.perfMonitor.incDrawCall(2);
          }
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          const isolate = this.quickToggles.isolateBackdrop;
          if (isolate && this.bgOnlyFbo && this.bgOnlyTex) {
            this.bindFBO(this.bgOnlyFbo);
            this.gl.viewport(0, 0, this.fboW, this.fboH);
            this.drawCopy(this.fboATex);
            this.gl.enable(this.gl.BLEND);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
          }
          const scrollY = this.scrollY;
          const CULL_MARGIN = 120;
          const cullMarginFor = (el) => Math.max(CULL_MARGIN, el.rect.h);
          const effRect = (el) => {
            const y = el.scroll ? el.rect.y - scrollY : el.rect.y;
            return { x: el.rect.x, y, w: el.rect.w, h: el.rect.h };
          };
          let curFbo = this.fboA;
          let curTex = this.fboATex;
          let otherFbo = this.fboB;
          let otherTex = this.fboBTex;
          for (const el of this.buttonConfigs) {
            if (el.renderOnTop) continue;
            const y = el.scroll ? el.rect.y - scrollY : el.rect.y;
            const margin = cullMarginFor(el);
            const culled = y + el.rect.h < -margin || y > this.cssHeight + margin;
            if (this.showCullDebug) {
              this.debugCullRects.push({
                id: el.id,
                x: el.rect.x,
                y,
                w: el.rect.w,
                h: el.rect.h,
                margin,
                culled,
                scroll: !!el.scroll,
                viewportH: this.cssHeight,
                pass: "main"
              });
            }
            if (culled) continue;
            const r = effRect(el);
            const st = this.buttonStates.get(el.id);
            const dirty = this.allDirty || this.dirtyElementIds.has(el.id);
            this.perfMonitor.incTotal();
            if (dirty) this.perfMonitor.incDirty();
            if (this.renderNonGlassElement(el, r, st, curFbo)) {
              if (this.showDirtyMarkers) {
                this.debugDirtyMarkers.push({ x: r.x, y: r.y, w: r.w, h: r.h, dirty });
              }
              if (dirty) this.dirtyRectsThisFrame.push({
                ...inflatedOutputRect(el, r.x, r.y, r.w, r.h),
                source: `nonglass:${el.id}`
              });
              if (isolate && this.bgOnlyFbo) {
                this.renderNonGlassElement(el, r, st, this.bgOnlyFbo);
              }
              continue;
            }
            if (el.backdropFbo && el.scrimColor) {
              this.renderDialogBackdrop(el.scrimColor, el.brightness, el.contrast, el.saturation);
            }
            if (el.useContinuousSdf) {
              this.loadContinuousSdf(el.rect.w, el.rect.h, el.cornerRadius);
            }
            const result = this.renderGlassElement(el, st, curFbo, curTex, otherFbo, otherTex, r);
            curFbo = result.curFbo;
            curTex = result.curTex;
            otherFbo = result.otherFbo;
            otherTex = result.otherTex;
            if (this.showDirtyMarkers) {
              this.debugDirtyMarkers.push({ x: r.x, y: r.y, w: r.w, h: r.h, dirty: !this._dbgLastGlassCacheHit });
            }
            if (el.isBottomTabContainer && this.tabsBackdropFbo && this.tabsBackdropTex) {
              this.bindFBO(this.tabsBackdropFbo);
              this.gl.clearColor(0, 0, 0, 0);
              this.gl.clear(this.gl.COLOR_BUFFER_BIT);
              this.drawCopy(curTex);
              this.bindFBO(curFbo);
              this.gl.enable(this.gl.BLEND);
              this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
            }
          }
          for (const el of this.buttonConfigs) {
            if (!el.renderOnTop) continue;
            const y = el.scroll ? el.rect.y - scrollY : el.rect.y;
            const margin = cullMarginFor(el);
            const culled = y + el.rect.h < -margin || y > this.cssHeight + margin;
            if (this.showCullDebug) {
              this.debugCullRects.push({
                id: el.id,
                x: el.rect.x,
                y,
                w: el.rect.w,
                h: el.rect.h,
                margin,
                culled,
                scroll: !!el.scroll,
                viewportH: this.cssHeight,
                pass: "onTop"
              });
            }
            if (culled) continue;
            const r = effRect(el);
            const st = this.buttonStates.get(el.id);
            const dirty = this.allDirty || this.dirtyElementIds.has(el.id);
            this.perfMonitor.incTotal();
            if (dirty) this.perfMonitor.incDirty();
            if (this.renderNonGlassElement(el, r, st, curFbo)) {
              if (this.showDirtyMarkers) {
                this.debugDirtyMarkers.push({ x: r.x, y: r.y, w: r.w, h: r.h, dirty });
              }
              if (dirty) this.dirtyRectsThisFrame.push({
                ...inflatedOutputRect(el, r.x, r.y, r.w, r.h),
                source: `nonglass:${el.id}`
              });
              if (isolate && this.bgOnlyFbo) {
                this.renderNonGlassElement(el, r, st, this.bgOnlyFbo);
              }
              continue;
            }
            const result = this.renderGlassElement(el, st, curFbo, curTex, otherFbo, otherTex, r);
            curFbo = result.curFbo;
            curTex = result.curTex;
            otherFbo = result.otherFbo;
            otherTex = result.otherTex;
            if (this.showDirtyMarkers) {
              this.debugDirtyMarkers.push({ x: r.x, y: r.y, w: r.w, h: r.h, dirty: !this._dbgLastGlassCacheHit });
            }
          }
          this.bindFBO(null);
          this.drawCopy(curTex);
          this.perfMonitor.incDrawCall();
          if (this._pendingEdgeScan) {
            this._debugFlushPendingEdgeScan();
          }
          this.dirtyElementIds.clear();
          this.allDirty = false;
          if (this.pendingExtraRenders > 0) {
            this.pendingExtraRenders--;
            for (const el of this.buttonConfigs) {
              if (el.isBottomTabIndicator) {
                this.markGroupDirty(el.isBottomTabIndicator.groupId);
              }
            }
            this.requestRender();
          }
          this.perfMonitor.frameEnd();
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-background.ts
  var backgroundMethods;
  var init_methods_render_background = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-background.ts"() {
      "use strict";
      backgroundMethods = {
        /** Helper to set SDF uniforms (canvasSize + offset + size + cornerRadii)
         *  for any of the SDF-using programs. */
        setSdfUniforms(u, aPosLoc, r, cornerRadius) {
          const gl = this.gl;
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(aPosLoc);
          gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
          gl.uniform2f(u["uCanvasSize"], this.canvas.width, this.canvas.height);
          gl.uniform2f(u["uOffset"], r.x * this.dpr, r.y * this.dpr);
          gl.uniform2f(u["uSize"], r.w * this.dpr, r.h * this.dpr);
          gl.uniform4f(
            u["uCornerRadii"],
            cornerRadius * this.dpr,
            cornerRadius * this.dpr,
            cornerRadius * this.dpr,
            cornerRadius * this.dpr
          );
        },
        /** Render wallpaper or solid background color into fboA.
         *  Also renders into wallpaperBlurFbo so it's always clean wallpaper
         *  (never composited with elements) — used by the blur cache. */
        renderBackground() {
          const gl = this.gl;
          this.bindFBO(this.fboA);
          gl.disable(gl.BLEND);
          if (this.backgroundColor) {
            const [r, g, b] = this.backgroundColor;
            this.drawSolidFill(r, g, b, 1);
          } else {
            gl.useProgram(this.wallpaperProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(this.aPosLocWp);
            gl.vertexAttribPointer(this.aPosLocWp, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
            gl.uniform1i(this.uWp["uBackdrop"], 0);
            gl.uniform2f(this.uWp["uCanvasSize"], this.canvas.width, this.canvas.height);
            gl.uniform2f(this.uWp["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            if (this.wallpaperBlurFbo) {
              this.bindFbRaw(gl, gl.FRAMEBUFFER, this.wallpaperBlurFbo);
              gl.viewport(0, 0, this.fboW, this.fboH);
              this.scissorTestRaw(gl, false);
              gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
          }
        },
        /** Render wallpaper+scrim+colorControls into dialogBackdropFbo as ONE OPAQUE
         *  layer (alpha=1), replicating the original's LayerBackdrop (wallpaper+scrim)
         *  with colorControls applied — matching the original's colorControls→blur→lens
         *  effects order. The dialog card (backdropFbo + useSeparableBlur) 2-pass blurs
         *  this FBO then does lens refraction.
         *
         *  Order: wallpaper (opaque) → scrim (glBlendFuncSeparate, correct alpha) →
         *  colorControls (fullscreen pass). Cached by scrim+cc params. */
        renderDialogBackdrop(scrim, brightness, contrast, saturation) {
          const key = `${scrim.join(",")}|${brightness},${contrast},${saturation}`;
          if (this.dialogBackdropKey === key) return;
          this.dialogBackdropKey = key;
          const gl = this.gl;
          this.bindFBO(this.dialogBackdropFbo);
          gl.disable(gl.BLEND);
          if (this.backgroundColor) {
            const [r, g, b] = this.backgroundColor;
            this.drawSolidFill(r, g, b, 1);
          } else {
            gl.useProgram(this.wallpaperProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(this.aPosLocWp);
            gl.vertexAttribPointer(this.aPosLocWp, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
            gl.uniform1i(this.uWp["uBackdrop"], 0);
            gl.uniform2f(this.uWp["uCanvasSize"], this.canvas.width, this.canvas.height);
            gl.uniform2f(this.uWp["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
          }
          if (scrim[3] > 1e-3) {
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this.drawSolidFill(scrim[0], scrim[1], scrim[2], scrim[3]);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          }
          this.bindFBO(this.blurFboA);
          this.drawColorControls(this.dialogBackdropTex, brightness, contrast, saturation);
          this.bindFBO(this.dialogBackdropFbo);
          this.drawCopy(this.blurFboATex);
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass.ts
  var nonGlassMethods;
  var init_methods_render_nonglass = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass.ts"() {
      "use strict";
      init_spring();
      nonGlassMethods = {
        /** Render a non-glass element (plain-rect / progressive-blur / text).
         *  Returns true if the element was handled (caller should `continue`).
         *  Returns false for glass elements (caller should run the ping-pong path).
         *
         *  Extracted verbatim from methods-render.ts — only the dispatcher /
         *  branch-routing glue lives here; each branch's body was moved to its
         *  own methods-render-nonglass-*.ts module. */
        renderNonGlassElement(el, r, st, curFbo) {
          let r2 = r;
          if (el.enterProgress != null) {
            const raw = el.enterProgress;
            const derived = raw < 0 ? (1 - Math.exp(-Math.abs(raw))) * -1 : raw <= 1 ? raw : 1 + (1 - Math.exp(-(raw - 1)));
            const ty = -48 * DP * (1 - derived);
            const stretch = el.enterStretchFactor != null && derived > 1 ? el.enterStretchFactor * (derived - 1) * 32 * DP : 0;
            r2 = { x: r.x, y: r.y + ty + stretch, w: r.w, h: r.h };
          }
          if (el.kind === "plain-rect" && el.plainRect) {
            return this.renderPlainRectElement(el, r, r2, curFbo);
          }
          if (el.kind === "progressive-blur" && el.progressiveBlur) {
            return this.renderProgressiveBlurElement(el, r2, curFbo);
          }
          if (el.kind === "text") {
            return this.renderTextElement(el, r2, st, curFbo);
          }
          return false;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-diagnose.ts
  function diagnosePlainRect(skipped, skipReason, finalAlpha, w, h, blendEnabled) {
    if (skipped) return { verdict: "SKIPPED", detail: skipReason ?? "unknown" };
    if (!isFinite(finalAlpha) || finalAlpha <= 0) {
      return { verdict: "INVISIBLE", detail: `finalAlpha=${finalAlpha} (colorA*enterA)` };
    }
    if (w <= 0 || h <= 0) {
      return { verdict: "DEGENERATE", detail: `rect ${w.toFixed(1)}x${h.toFixed(1)} \u2264 0` };
    }
    if (!blendEnabled) {
      return { verdict: "NO_OP", detail: "BLEND disabled by prior element" };
    }
    return { verdict: "OK", detail: `finalAlpha=${finalAlpha.toFixed(3)}` };
  }
  var init_methods_render_diagnose = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-diagnose.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass-plain-rect.ts
  var nonGlassPlainRectMethods;
  var init_methods_render_nonglass_plain_rect = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass-plain-rect.ts"() {
      "use strict";
      init_gl_utils();
      init_methods_render_diagnose();
      nonGlassPlainRectMethods = {
        /** plain-rect branch of renderNonGlassElement — see interface doc above.
         *  Extracted verbatim from methods-render.ts. */
        renderPlainRectElement(el, r, r2, curFbo) {
          const gl = this.gl;
          const baseC = el.isToggleTrack ? null : el.plainRect.color;
          if (baseC && baseC[3] <= 0) {
            if (this.showPlainRectDebug && curFbo !== this.bgOnlyFbo) {
              const col = el.plainRect.color;
              const sp0 = el.enterSafeProgress != null ? Math.max(0, Math.min(1, el.enterSafeProgress)) : el.enterProgress != null ? Math.max(0, Math.min(1, el.enterProgress)) : 1;
              const ea = el.enterProgress != null ? easeIn(sp0) : 1;
              const fa = col[3] * ea;
              const blendOn = this.gl.isEnabled(this.gl.BLEND);
              const reason = `color alpha=${col[3]} \u2264 0`;
              const dg = diagnosePlainRect(true, reason, fa, r2.w, r2.h, blendOn);
              this.debugPlainRects.push({
                id: el.id,
                x: r2.x,
                y: r2.y,
                w: r2.w,
                h: r2.h,
                origH: el.rect.h,
                colorR: col[0],
                colorG: col[1],
                colorB: col[2],
                colorA: col[3],
                enterProgress: el.enterProgress ?? null,
                enterSafeProgress: el.enterSafeProgress ?? null,
                enterA: ea,
                finalAlpha: fa,
                skipped: true,
                skipReason: reason,
                drawn: false,
                blendEnabled: blendOn,
                curFboIsA: curFbo === this.fboA,
                diagnosis: dg.verdict,
                diagnosisDetail: dg.detail
              });
            }
            return true;
          }
          this.bindFBO(curFbo);
          let clipEnabled = false;
          if (el.clipRect) {
            const cx0 = Math.max(0, Math.round(r2.x * this.dpr));
            const cy0 = Math.max(0, Math.round((this.cssHeight - (r2.y + r2.h)) * this.dpr));
            const cw = Math.min(this.fboW - cx0, Math.round(r2.w * this.dpr));
            const ch = Math.min(this.fboH - cy0, Math.round(r2.h * this.dpr));
            const clip = this.intersectClipScissor(el, cx0, cy0, cw, ch);
            this.scissorTestRaw(gl, true);
            this.scissorRaw(gl, clip.x, clip.y, clip.w, clip.h);
            clipEnabled = true;
          }
          let c;
          if (el.isToggleTrack) {
            const tg = this.toggleStates.get(el.isToggleTrack.groupId);
            const f = tg ? tg.fraction : 0;
            const off = el.isToggleTrack.offColor;
            const on = el.isToggleTrack.onColor;
            c = [
              off[0] + (on[0] - off[0]) * f,
              off[1] + (on[1] - off[1]) * f,
              off[2] + (on[2] - off[2]) * f,
              off[3] + (on[3] - off[3]) * f
            ];
          } else {
            c = el.plainRect.color;
          }
          let fillRect = r2;
          if (el.isSliderFill) {
            const sf = this.toggleStates.get(el.isSliderFill.groupId);
            const fraction = sf ? sf.fraction : 0;
            const fillW = Math.max(el.isSliderFill.minW, el.isSliderFill.trackW * fraction);
            fillRect = { x: r.x, y: r.y, w: fillW, h: r.h };
          }
          gl.useProgram(this.plainRectProgram);
          this.setSdfUniforms(this.uPr, this.aPosLocPr, fillRect, el.cornerRadius);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          const enterA = el.enterProgress != null ? (() => {
            const sp = el.enterSafeProgress != null ? Math.max(0, Math.min(1, el.enterSafeProgress)) : Math.max(0, Math.min(1, el.enterProgress));
            return easeIn(sp);
          })() : 1;
          gl.uniform4f(this.uPr["uColor"], c[0], c[1], c[2], c[3] * enterA);
          gl.uniform1f(this.uPr["uCornerStyle"], this.cornerStyle);
          if (el.useContinuousSdf) {
            this.loadContinuousSdf(r2.w, r2.h, el.cornerRadius);
          }
          if (el.useContinuousSdf && this.continuousSdfTexture) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.continuousSdfTexture);
            gl.uniform1i(this.uPr["uContinuousSdf"], 2);
            gl.uniform1f(this.uPr["uUseContinuousSdf"], 1);
            gl.uniform2f(this.uPr["uContinuousSdfTexSize"], this.continuousSdfTexSize[0], this.continuousSdfTexSize[1]);
            gl.uniform2f(this.uPr["uContinuousSdfElementSize"], r2.w * this.dpr, r2.h * this.dpr);
          } else {
            gl.uniform1f(this.uPr["uUseContinuousSdf"], 0);
          }
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          if (clipEnabled) this.scissorTestRaw(gl, false);
          this.perfMonitor.incNonGlass();
          this.perfMonitor.incDrawCall();
          if (this.showPlainRectDebug && curFbo !== this.bgOnlyFbo) {
            const fa = c[3] * enterA;
            const blendOn = this.gl.isEnabled(this.gl.BLEND);
            const dg = diagnosePlainRect(false, null, fa, fillRect.w, fillRect.h, blendOn);
            this.debugPlainRects.push({
              id: el.id,
              x: fillRect.x,
              y: fillRect.y,
              w: fillRect.w,
              h: fillRect.h,
              origH: el.rect.h,
              colorR: c[0],
              colorG: c[1],
              colorB: c[2],
              colorA: c[3],
              enterProgress: el.enterProgress ?? null,
              enterSafeProgress: el.enterSafeProgress ?? null,
              enterA,
              finalAlpha: fa,
              skipped: false,
              skipReason: null,
              drawn: true,
              blendEnabled: blendOn,
              curFboIsA: curFbo === this.fboA,
              diagnosis: dg.verdict,
              diagnosisDetail: dg.detail
            });
          }
          return true;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass-text.ts
  var nonGlassTextMethods;
  var init_methods_render_nonglass_text = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass-text.ts"() {
      "use strict";
      init_spring();
      init_gl_utils();
      nonGlassTextMethods = {
        /** text branch of renderNonGlassElement — see interface doc above.
         *  Extracted verbatim from methods-render.ts. */
        renderTextElement(el, r2, st, curFbo) {
          const gl = this.gl;
          this.bindFBO(curFbo);
          let drawRect = r2;
          let fgScaleX = 1;
          let fgScaleY = 1;
          if (false) {
            const tg = this.toggleStates.get(el.isBottomTabContent.groupId);
            if (tg) {
              const containerW = el.isBottomTabContent.containerWidth ?? el.rect.w * 4;
              const containerScale = 1 + 16 * DP2 / containerW * tg.pressProgress;
              fgScaleX = containerScale;
              fgScaleY = containerScale;
              const pivotX = el.isBottomTabContent.containerCenterX ?? el.rect.x + el.rect.w / 2;
              const pivotY = el.isBottomTabContent.containerCenterY ?? el.rect.y + el.rect.h / 2;
              const tabCenterX = el.rect.x + el.rect.w / 2;
              const tabCenterY = el.rect.y + el.rect.h / 2;
              const cx = pivotX + (tabCenterX - pivotX) * containerScale + tg.panelOffset;
              const cy = pivotY + (tabCenterY - pivotY) * containerScale;
              const sw = el.rect.w * fgScaleX;
              const sh = el.rect.h * fgScaleY;
              drawRect = { x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh };
            }
          }
          const pText = st?.pressProgress ?? 0;
          let clipEnabled = false;
          if (el.clipRect) {
            const cx0 = Math.max(0, Math.round(drawRect.x * this.dpr));
            const cy0 = Math.max(0, Math.round((this.cssHeight - (drawRect.y + drawRect.h)) * this.dpr));
            const cw = Math.min(this.fboW - cx0, Math.round(drawRect.w * this.dpr));
            const ch = Math.min(this.fboH - cy0, Math.round(drawRect.h * this.dpr));
            const clip = this.intersectClipScissor(el, cx0, cy0, cw, ch);
            this.scissorTestRaw(gl, true);
            this.scissorRaw(gl, clip.x, clip.y, clip.w, clip.h);
            clipEnabled = true;
          }
          if (el.isInteractive && pText > 1e-3) {
            const pressTint = el.pressTintColor;
            gl.useProgram(this.tintProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(this.aPosLocTn);
            gl.vertexAttribPointer(this.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
            if (pressTint) {
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            } else {
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            }
            gl.uniform2f(this.uTn["uCanvasSize"], this.canvas.width, this.canvas.height);
            gl.uniform2f(this.uTn["uOffset"], drawRect.x * this.dpr, drawRect.y * this.dpr);
            gl.uniform2f(this.uTn["uSize"], drawRect.w * this.dpr, drawRect.h * this.dpr);
            gl.uniform4f(this.uTn["uCornerRadii"], 0, 0, 0, 0);
            gl.uniform2f(this.uTn["uOriginalSize"], drawRect.w * this.dpr, drawRect.h * this.dpr);
            gl.uniform1f(this.uTn["uOriginalCornerRadius"], 0);
            gl.uniform2f(this.uTn["uLayerScale"], 1, 1);
            if (pressTint) {
              gl.uniform4f(this.uTn["uColor"], pressTint[0], pressTint[1], pressTint[2], 0.1 * pText);
            } else {
              gl.uniform4f(this.uTn["uColor"], 1, 1, 1, 0.1 * pText);
            }
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          }
          const fgTex = this.fgTextures.get(el.id);
          if (fgTex) {
            gl.useProgram(this.foregroundProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(this.aPosLocFg);
            gl.vertexAttribPointer(this.aPosLocFg, 2, gl.FLOAT, false, 0, 0);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fgTex);
            gl.uniform1i(this.uFg["uTexture"], 0);
            gl.uniform2f(this.uFg["uCanvasSize"], this.canvas.width, this.canvas.height);
            gl.uniform2f(this.uFg["uOffset"], drawRect.x * this.dpr, drawRect.y * this.dpr);
            gl.uniform2f(this.uFg["uSize"], drawRect.w * this.dpr, drawRect.h * this.dpr);
            gl.uniform4f(
              this.uFg["uCornerRadii"],
              el.cornerRadius * this.dpr,
              el.cornerRadius * this.dpr,
              el.cornerRadius * this.dpr,
              el.cornerRadius * this.dpr
            );
            gl.uniform2f(this.uFg["uOriginalSize"], el.rect.w * this.dpr, el.rect.h * this.dpr);
            gl.uniform1f(this.uFg["uOriginalCornerRadius"], el.cornerRadius * this.dpr);
            gl.uniform2f(this.uFg["uLayerScale"], fgScaleX, fgScaleY);
            gl.uniform1f(this.uFg["uCornerStyle"], this.cornerStyle);
            gl.uniform1f(this.uFg["uUseContinuousSdf"], 0);
            gl.uniform1f(this.uFg["uAlpha"], el.enterProgress != null ? (() => {
              const sp = el.enterSafeProgress != null ? Math.max(0, Math.min(1, el.enterSafeProgress)) : Math.max(0, Math.min(1, el.enterProgress));
              return easeIn(sp);
            })() : 1);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          }
          this.perfMonitor.incNonGlass();
          this.perfMonitor.incDrawCall();
          if (clipEnabled) this.scissorTestRaw(gl, false);
          return true;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass-progressive-blur.ts
  var nonGlassProgressiveBlurMethods;
  var init_methods_render_nonglass_progressive_blur = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-nonglass-progressive-blur.ts"() {
      "use strict";
      nonGlassProgressiveBlurMethods = {
        /** progressive-blur branch of renderNonGlassElement — see interface doc above.
         *  Extracted verbatim from methods-render.ts. */
        renderProgressiveBlurElement(el, r2, curFbo) {
          const gl = this.gl;
          this.bindFBO(curFbo);
          gl.useProgram(this.progressiveBlurProgram);
          this.setSdfUniforms(this.uPb, this.aPosLocPb, r2, el.cornerRadius);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
          gl.uniform1i(this.uPb["uBackdrop"], 0);
          gl.uniform2f(this.uPb["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
          gl.uniform1f(this.uPb["uBlurRadius"], el.progressiveBlur.blurRadius * this.dpr);
          const tc = el.progressiveBlur.tintColor;
          gl.uniform4f(this.uPb["uTintColor"], tc[0], tc[1], tc[2], tc[3]);
          gl.uniform1f(this.uPb["uTintIntensity"], el.progressiveBlur.tintIntensity);
          gl.uniform1f(this.uPb["uFlip"], el.progressiveBlur.flip ? 1 : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          this.perfMonitor.incNonGlass();
          this.perfMonitor.incDrawCall();
          return true;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass-context.ts
  function createElementPassContext(el) {
    return {
      elRefractionHeight: el.refractionHeight,
      elRefractionAmount: el.refractionAmount,
      elBlurRadius: el.blurRadius,
      elHighlightAlpha: el.highlight ? el.highlight.alpha : 0,
      elSurfaceAlpha: el.surfaceColor[3],
      elContentScaleX: 1,
      elContentScaleY: 1,
      useToggleBackdrop: 0,
      useSolidBackdrop: 0,
      solidR: 1,
      solidG: 1,
      solidB: 1,
      solidA: 1,
      trackColorR: 0,
      trackColorG: 0,
      trackColorB: 0,
      trackColorA: 0,
      trackCenterX: 0,
      trackCenterY: 0,
      trackHalfW: 0,
      trackHalfH: 0,
      trackCornerRadius: 0,
      useIndicatorBackdrop: 0,
      containerRectX: 0,
      containerRectY: 0,
      containerHalfW: 0,
      containerHalfH: 0,
      containerCornerRadius: 0,
      indicatorAccentR: 0,
      indicatorAccentG: 0,
      indicatorAccentB: 0,
      indicatorAccentA: 0
    };
  }
  var init_methods_render_glass_element_pass_context = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass-context.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass-toggle.ts
  function applyToggleKnobBackdrop(renderer, state, ctx) {
    const { el, sx, sy, sw, sh, togglePressProgress } = state;
    if (!el.isToggleKnob) return;
    const progress = togglePressProgress;
    ctx.elRefractionHeight = el.refractionHeight * progress;
    ctx.elRefractionAmount = el.refractionAmount * progress;
    ctx.elBlurRadius = 8 * (1 - progress);
    ctx.elHighlightAlpha = (el.highlight?.alpha ?? 0) * progress;
    ctx.elSurfaceAlpha = 0;
    const isSlider = el.isToggleKnob.velocityDivisor === 10;
    const xEnd = isSlider ? 1 : 0.75;
    const yEnd = isSlider ? 1 : 0.75;
    ctx.elContentScaleX = 2 / 3 + (xEnd - 2 / 3) * progress;
    ctx.elContentScaleY = 0 + (yEnd - 0) * progress;
    if (el.isToggleKnob.trackColorOff && el.isToggleKnob.trackColorOn && el.isToggleKnob.trackW && el.isToggleKnob.trackH) {
      const tg = renderer.toggleStates.get(el.isToggleKnob.groupId);
      const fraction = tg ? tg.fraction : 0;
      const off = el.isToggleKnob.trackColorOff;
      const on = el.isToggleKnob.trackColorOn;
      ctx.trackColorR = off[0] + (on[0] - off[0]) * fraction;
      ctx.trackColorG = off[1] + (on[1] - off[1]) * fraction;
      ctx.trackColorB = off[2] + (on[2] - off[2]) * fraction;
      ctx.trackColorA = off[3] + (on[3] - off[3]) * fraction;
      const knobCenterX = (sx + sw / 2) * renderer.dpr;
      const knobCenterY = (sy + sh / 2) * renderer.dpr;
      const trackOrigX = el.isToggleKnob.trackOriginalX ?? el.rect.x;
      const trackOrigY_raw = el.isToggleKnob.trackOriginalY ?? el.rect.y;
      const trackOrigY = el.scroll ? trackOrigY_raw - renderer.scrollY : trackOrigY_raw;
      const trackOrigCenterX = (trackOrigX + el.isToggleKnob.trackW / 2) * renderer.dpr;
      const trackOrigCenterY = (trackOrigY + el.isToggleKnob.trackH / 2) * renderer.dpr;
      const trackScaleX = 2 / 3 + (xEnd - 2 / 3) * progress;
      const trackScaleY = 0 + (yEnd - 0) * progress;
      ctx.trackCenterX = knobCenterX + (trackOrigCenterX - knobCenterX) * trackScaleX;
      ctx.trackCenterY = knobCenterY + (trackOrigCenterY - knobCenterY) * trackScaleY;
      const trackW = el.isToggleKnob.trackW * renderer.dpr;
      const trackH = el.isToggleKnob.trackH * renderer.dpr;
      ctx.trackHalfW = trackW * trackScaleX * 0.5;
      ctx.trackHalfH = trackH * trackScaleY * 0.5;
      ctx.trackCornerRadius = trackH * 0.5 * Math.min(trackScaleX, trackScaleY);
      ctx.useToggleBackdrop = 1;
      if (el.isToggleKnob.solidBackdropColor) {
        const sd = el.isToggleKnob.solidBackdropColor;
        ctx.solidR = sd[0];
        ctx.solidG = sd[1];
        ctx.solidB = sd[2];
        ctx.solidA = sd[3];
        ctx.useSolidBackdrop = 1;
      }
      ctx.elContentScaleX = 1;
      ctx.elContentScaleY = 1;
    }
  }
  var init_methods_render_glass_element_pass_toggle = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass-toggle.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass-indicator.ts
  function applyIndicatorBackdrop(renderer, state, ctx) {
    const gl = renderer.gl;
    const { el, sx, sy, sw, sh, togglePressProgress } = state;
    if (!el.isBottomTabIndicator) {
      gl.uniform1f(renderer.uEl["uIndicatorPressProgress"], 0);
      gl.uniform1f(renderer.uEl["uIndicatorPanelOffset"], 0);
      gl.uniform1f(renderer.uEl["uDpr"], renderer.dpr);
      gl.uniform2f(renderer.uEl["uContainerCenter"], 0, 0);
      gl.uniform1f(renderer.uEl["uContainerScale"], 1);
      gl.uniform1f(renderer.uEl["uTabContentCount"], 0);
      gl.uniform2f(renderer.uEl["uInnerStrokeMaskOffset"], 1, 1);
      gl.uniform2f(renderer.uEl["uInnerStrokeMaskSize"], 1, 1);
      return;
    }
    const progress = togglePressProgress;
    ctx.elRefractionHeight = el.refractionHeight * progress;
    ctx.elRefractionAmount = el.refractionAmount * progress;
    ctx.elBlurRadius = 0;
    ctx.elHighlightAlpha = (el.highlight?.alpha ?? 0) * progress;
    if (el.isBottomTabIndicator.accentColor && el.isBottomTabIndicator.containerRect) {
      const ac = el.isBottomTabIndicator.accentColor;
      const cr = el.isBottomTabIndicator.containerRect;
      ctx.indicatorAccentR = ac[0];
      ctx.indicatorAccentG = ac[1];
      ctx.indicatorAccentB = ac[2];
      ctx.indicatorAccentA = 1;
      ctx.containerRectX = (cr.x + cr.w / 2) * renderer.dpr;
      ctx.containerRectY = (cr.y + cr.h / 2) * renderer.dpr;
      ctx.containerHalfW = cr.w / 2 * renderer.dpr;
      ctx.containerHalfH = cr.h / 2 * renderer.dpr;
      ctx.containerCornerRadius = cr.h / 2 * renderer.dpr;
      ctx.useIndicatorBackdrop = 1;
    }
    const tg = renderer.toggleStates.get(el.isBottomTabIndicator.groupId);
    gl.uniform1f(renderer.uEl["uIndicatorPressProgress"], tg ? tg.pressProgress : 0);
    gl.uniform1f(renderer.uEl["uIndicatorPanelOffset"], tg ? tg.panelOffset * renderer.dpr : 0);
    gl.uniform1f(renderer.uEl["uDpr"], renderer.dpr);
    const ccx = el.isBottomTabIndicator.containerCenterX ?? 0;
    const ccy = el.isBottomTabIndicator.containerCenterY ?? 0;
    const cw = el.isBottomTabIndicator.containerWidth ?? el.rect.w;
    const cScale = tg ? 1 + 16 * DP / cw * tg.pressProgress : 1;
    gl.uniform2f(renderer.uEl["uContainerCenter"], ccx * renderer.dpr, ccy * renderer.dpr);
    gl.uniform1f(renderer.uEl["uContainerScale"], cScale);
    const ids = el.isBottomTabIndicator.tabContentIds ?? [];
    const rects = el.isBottomTabIndicator.tabContentRects ?? [];
    const n = Math.min(ids.length, rects.length, 8);
    let boundCount = 0;
    for (let i = 0; i < 8; i++) {
      if (i < n) {
        const tex = renderer.fgTextures.get(ids[i]);
        if (tex) {
          gl.activeTexture(gl.TEXTURE3 + boundCount);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(renderer.uEl[`uTabContentTex${boundCount}`], 3 + boundCount);
          const r = rects[i];
          gl.uniform4f(
            renderer.uEl[`uTabContentRects[${boundCount}]`],
            (r.x + r.w / 2) * renderer.dpr,
            (r.y + r.h / 2) * renderer.dpr,
            r.w / 2 * renderer.dpr,
            r.h / 2 * renderer.dpr
          );
          boundCount++;
        }
      }
    }
    for (let i = boundCount; i < 8; i++) {
      gl.uniform4f(renderer.uEl[`uTabContentRects[${i}]`], 0, 0, 0, 0);
    }
    gl.uniform1f(renderer.uEl["uTabContentCount"], boundCount);
    if (renderer.tabsBackdropTex) {
      gl.activeTexture(gl.TEXTURE11);
      gl.bindTexture(gl.TEXTURE_2D, renderer.tabsBackdropTex);
      gl.uniform1i(renderer.uEl["uTabsGlassLayer"], 11);
    }
    generateInnerStrokeMask(renderer, ctx);
  }
  function generateInnerStrokeMask(renderer, ctx) {
    const gl = renderer.gl;
    const innerW = 2 * ctx.containerHalfW;
    const innerH = 2 * ctx.containerHalfH;
    const innerR = ctx.containerCornerRadius;
    const widthPx = Math.min(0.5 * renderer.dpr, Math.min(innerW, innerH) * 0.5);
    const strokeWidthDevice = Math.max(1, Math.ceil(widthPx) * 2);
    const blurPx = Math.max(0, 0.25 * renderer.dpr);
    const strokeMargin = Math.ceil(strokeWidthDevice) + 4;
    const maskW = Math.max(1, Math.ceil(innerW + 2 * strokeMargin));
    const maskH = Math.max(1, Math.ceil(innerH + 2 * strokeMargin));
    const deviceDpr = window.devicePixelRatio || 1;
    const SS = Math.min(2, Math.max(1, Math.floor(deviceDpr / renderer.dpr)));
    const canvasW = maskW * SS;
    const canvasH = maskH * SS;
    const maskKey = [
      "inner-rr",
      innerW.toFixed(3),
      innerH.toFixed(3),
      innerR.toFixed(3),
      strokeWidthDevice,
      blurPx.toFixed(3),
      strokeMargin,
      maskW,
      maskH,
      `ss${SS}`
      // cache key includes supersample factor
    ].join(":");
    let mask = renderer.strokeMaskCache.get(maskKey);
    if (!mask) {
      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx2d = canvas.getContext("2d", { alpha: true });
      if (!ctx2d) throw new Error("2D canvas not supported");
      const tex = gl.createTexture();
      if (!tex) throw new Error("WebGL texture allocation failed");
      mask = { tex, canvas, ctx: ctx2d, w: maskW, h: maskH, ready: false };
      renderer.strokeMaskCache.set(maskKey, mask);
      if (renderer.strokeMaskCache.size > 32) {
        const oldestKey = renderer.strokeMaskCache.keys().next().value;
        if (oldestKey && oldestKey !== maskKey) {
          const oldest = renderer.strokeMaskCache.get(oldestKey);
          if (oldest) gl.deleteTexture(oldest.tex);
          renderer.strokeMaskCache.delete(oldestKey);
        }
      }
    }
    if (!mask.ready) {
      const smCtx = mask.ctx;
      smCtx.clearRect(0, 0, canvasW, canvasH);
      smCtx.save();
      smCtx.scale(SS, SS);
      smCtx.translate(strokeMargin, strokeMargin);
      const r = Math.min(innerR, innerW / 2, innerH / 2);
      const path = new Path2D();
      path.moveTo(r, 0);
      path.lineTo(innerW - r, 0);
      path.arcTo(innerW, 0, innerW, r, r);
      path.lineTo(innerW, innerH - r);
      path.arcTo(innerW, innerH, innerW - r, innerH, r);
      path.lineTo(r, innerH);
      path.arcTo(0, innerH, 0, innerH - r, r);
      path.lineTo(0, r);
      path.arcTo(0, 0, r, 0, r);
      path.closePath();
      smCtx.clip(path);
      smCtx.lineWidth = strokeWidthDevice;
      smCtx.strokeStyle = "rgba(255,255,255,1)";
      smCtx.lineJoin = "round";
      smCtx.lineCap = "round";
      smCtx.filter = blurPx > 0.01 ? `blur(${blurPx}px)` : "none";
      smCtx.stroke(path);
      smCtx.filter = "none";
      smCtx.restore();
      gl.bindTexture(gl.TEXTURE_2D, mask.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask.canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      mask.ready = true;
    }
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, mask.tex);
    gl.uniform1i(renderer.uEl["uInnerStrokeMask"], 12);
    gl.uniform2f(renderer.uEl["uInnerStrokeMaskOffset"], strokeMargin, strokeMargin);
    gl.uniform2f(renderer.uEl["uInnerStrokeMaskSize"], mask.w, mask.h);
  }
  var init_methods_render_glass_element_pass_indicator = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass-indicator.ts"() {
      "use strict";
      init_spring();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass.ts
  var glassElementPassMethods;
  var init_methods_render_glass_element_pass = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-element-pass.ts"() {
      "use strict";
      init_methods_render_glass_element_pass_context();
      init_methods_render_glass_element_pass_toggle();
      init_methods_render_glass_element_pass_indicator();
      init_methods_render_glass_backdrop();
      glassElementPassMethods = {
        /** Step 2b: Element pass — refraction + vibrancy + tint + highlight.
         *  Samples `curTex` (the scene built up so far) to compute refraction
         *  of the actual colors behind the glass (track color, card background,
         *  other glass elements), not just the wallpaper.
         *
         *  Orchestration only — the toggle-knob CombinedBackdrop and the
         *  bottom-tab-indicator CombinedBackdrop (+ tab content textures +
         *  inner stroke mask) live in their own files. The shading uniforms
         *  (refraction / blur / tint / highlight / SDF / magnifier) are set
         *  here from the `ElementPassContext` the helpers populated. */
        renderGlassElementPass(state, curTex, backdropBbox) {
          const gl = this.gl;
          const { el, sx, sy, sw, sh, radii, togglePressProgress, layerScale } = state;
          gl.useProgram(this.elementProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocEl);
          gl.vertexAttribPointer(this.aPosLocEl, 2, gl.FLOAT, false, 0, 0);
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, curTex);
          gl.uniform1i(this.uEl["uBackdrop"], 0);
          if (this.wallpaperTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
            gl.uniform1i(this.uEl["uWallpaperSampler"], 1);
          }
          gl.uniform2f(this.uEl["uCanvasSize"], this.canvas.width, this.canvas.height);
          gl.uniform2f(this.uEl["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
          gl.uniform2f(this.uEl["uElementOffset"], sx * this.dpr, sy * this.dpr);
          gl.uniform2f(this.uEl["uElementSize"], sw * this.dpr, sh * this.dpr);
          if (backdropBbox) {
            const cw = this.canvas.width;
            const ch = this.canvas.height;
            const u0 = backdropBbox.x / cw;
            const u1 = (backdropBbox.x + backdropBbox.w) / cw;
            const v1 = 1 - backdropBbox.y / ch;
            const v0 = 1 - (backdropBbox.y + backdropBbox.h) / ch;
            gl.uniform4f(this.uEl["uBackdropBbox"], u0, v0, u1 - u0, v1 - v0);
          } else {
            gl.uniform4f(this.uEl["uBackdropBbox"], 0, 0, 1, 1);
          }
          gl.uniform4f(
            this.uEl["uCornerRadii"],
            radii[0] * this.dpr,
            radii[1] * this.dpr,
            radii[2] * this.dpr,
            radii[3] * this.dpr
          );
          gl.uniform2f(this.uEl["uOriginalSize"], state.origW * this.dpr, state.origH * this.dpr);
          gl.uniform1f(this.uEl["uOriginalCornerRadius"], state.origCornerRadius * this.dpr);
          gl.uniform2f(this.uEl["uLayerScale"], state.layerScaleX, state.layerScaleY);
          gl.uniform1f(this.uEl["uElementRotation"], el.elementRotation ?? 0);
          gl.uniform1f(this.uEl["uUsePerElementFbo"], state.usePerElementFbo ? 1 : 0);
          if (state.usePerElementFbo) {
            gl.uniform2f(this.uEl["uSceneRectOffset"], state.sceneRectOffsetX, state.sceneRectOffsetY);
            gl.uniform2f(this.uEl["uElFboSize"], state.elFboW, state.elFboH);
          }
          const ctx = createElementPassContext(el);
          applyToggleKnobBackdrop(this, state, ctx);
          applyIndicatorBackdrop(this, state, ctx);
          gl.uniform1f(this.uEl["uUseToggleBackdrop"], ctx.useToggleBackdrop);
          gl.uniform1f(this.uEl["uUseSolidBackdrop"], ctx.useSolidBackdrop);
          gl.uniform4f(this.uEl["uSolidBackdropColor"], ctx.solidR, ctx.solidG, ctx.solidB, ctx.solidA);
          gl.uniform4f(
            this.uEl["uTrackColor"],
            ctx.trackColorR,
            ctx.trackColorG,
            ctx.trackColorB,
            ctx.trackColorA
          );
          gl.uniform4f(
            this.uEl["uTrackRect"],
            ctx.trackCenterX,
            ctx.trackCenterY,
            ctx.trackHalfW,
            ctx.trackHalfH
          );
          gl.uniform1f(this.uEl["uTrackCornerRadius"], ctx.trackCornerRadius);
          gl.uniform1f(this.uEl["uIndicatorBackdrop"], ctx.useIndicatorBackdrop);
          gl.uniform4f(
            this.uEl["uContainerRect"],
            ctx.containerRectX,
            ctx.containerRectY,
            ctx.containerHalfW,
            ctx.containerHalfH
          );
          gl.uniform1f(this.uEl["uContainerCornerRadius"], ctx.containerCornerRadius);
          gl.uniform4f(
            this.uEl["uIndicatorAccent"],
            ctx.indicatorAccentR,
            ctx.indicatorAccentG,
            ctx.indicatorAccentB,
            ctx.indicatorAccentA
          );
          gl.uniform1f(this.uEl["uInsetPx"], 4 * this.dpr);
          const qsRefractionH = this.quickToggles.refraction ? ctx.elRefractionHeight : 0;
          const qsRefractionA = this.quickToggles.refraction ? ctx.elRefractionAmount : 0;
          gl.uniform1f(this.uEl["uRefractionHeight"], qsRefractionH * this.dpr);
          gl.uniform1f(this.uEl["uRefractionAmount"], qsRefractionA * this.dpr);
          gl.uniform1f(this.uEl["uDepthEffect"], el.depthEffect ? 1 : 0);
          gl.uniform1f(
            this.uEl["uChromaticAberration"],
            el.chromaticAberration && this.quickToggles.chromatic ? 1 : 0
          );
          const useSampleWallpaper = el.sampleWallpaper || state.independent;
          const inlineBlurRadius = shouldUseSeparableBlur(el, state) ? 0 : ctx.elBlurRadius;
          gl.uniform1f(this.uEl["uBlurRadius"], inlineBlurRadius * layerScale * this.dpr);
          gl.uniform1f(this.uEl["uSaturation"], el.saturation);
          gl.uniform1f(this.uEl["uBrightness"], el.brightness);
          gl.uniform1f(this.uEl["uContrast"], el.contrast);
          gl.uniform1f(this.uEl["uContentScaleX"], ctx.elContentScaleX);
          gl.uniform1f(this.uEl["uContentScaleY"], ctx.elContentScaleY);
          gl.uniform4f(
            this.uEl["uTintColor"],
            el.tintColor[0],
            el.tintColor[1],
            el.tintColor[2],
            el.tintColor[3]
          );
          gl.uniform4f(
            this.uEl["uSurfaceColor"],
            el.surfaceColor[0],
            el.surfaceColor[1],
            el.surfaceColor[2],
            ctx.elSurfaceAlpha
          );
          if (el.highlight) {
            gl.uniform3f(
              this.uEl["uHighlightColor"],
              el.highlight.color[0],
              el.highlight.color[1],
              el.highlight.color[2]
            );
            gl.uniform1f(this.uEl["uHighlightAngle"], el.highlight.angle);
            gl.uniform1f(this.uEl["uHighlightFalloff"], el.highlight.falloff);
            gl.uniform1f(this.uEl["uHighlightAlpha"], ctx.elHighlightAlpha);
            gl.uniform1f(this.uEl["uHighlightMode"], el.highlight.mode);
            const elMinDimPx = Math.min(state.origW, state.origH) * this.dpr;
            const elWidthPx = Math.min(el.highlight.widthDp * this.dpr, elMinDimPx * 0.5);
            const elBlurPx = (el.highlight.blurRadiusDp ?? el.highlight.widthDp / 2) * this.dpr;
            const elStrokeWidth = el.highlight.aa !== false ? Math.ceil(elWidthPx) * 2 : Math.max(1, elWidthPx) * 2;
            gl.uniform1f(this.uEl["uHighlightStrokeWidth"], elStrokeWidth);
            gl.uniform1f(this.uEl["uHighlightBlur"], elBlurPx);
          } else {
            gl.uniform1f(this.uEl["uHighlightAlpha"], 0);
            gl.uniform1f(this.uEl["uHighlightMode"], 0);
            gl.uniform1f(this.uEl["uHighlightStrokeWidth"], 0);
            gl.uniform1f(this.uEl["uHighlightBlur"], 0);
          }
          const sdfSource = el.isSdfTexture?.textureSource ?? "clock";
          const sdfTex = sdfSource === "text" ? this.textSdfTexture : this.sdfTexture;
          const sdfTexSize = sdfSource === "text" ? this.textSdfTextureSize : this.sdfTextureSize;
          if (el.isSdfTexture && sdfTex) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, sdfTex);
            gl.uniform1i(this.uEl["uSdfTexSampler"], 2);
            gl.uniform1f(this.uEl["uUseSdfTexture"], 1);
            gl.uniform2f(this.uEl["uSdfTexSize"], sdfTexSize[0], sdfTexSize[1]);
            gl.uniform1f(
              this.uEl["uSdfLightAngle"],
              el.useGravityAngle ? this.gravityAngle * 180 / Math.PI : el.isSdfTexture.lightAngle
            );
            gl.uniform1f(
              this.uEl["uRefractionHeight"],
              (this.quickToggles.refraction ? el.isSdfTexture.refractionHeight : 0) * this.dpr
            );
            gl.uniform1f(
              this.uEl["uSdfHighlightScale"],
              el.isSdfTexture.highlightScale ?? 1.5
            );
            gl.uniform1f(
              this.uEl["uSdfBevelEnabled"],
              el.isSdfTexture.bevelEnabled ?? true ? 1 : 0
            );
            gl.uniform1f(
              this.uEl["uSdfGlassTintHue"],
              el.isSdfTexture.glassTintHue ?? 0
            );
            gl.uniform1f(
              this.uEl["uSdfGlassTintEnabled"],
              el.isSdfTexture.glassTintEnabled ?? false ? 1 : 0
            );
            gl.uniform1f(
              this.uEl["uSdfGlassTintMix"],
              el.isSdfTexture.glassTintMix ?? 0
            );
            gl.uniform1f(
              this.uEl["uSdfGlassTintStrength"],
              el.isSdfTexture.glassTintStrength ?? 0.85
            );
            gl.uniform1f(
              this.uEl["uSdfGlassTintSaturation"],
              el.isSdfTexture.glassTintSaturation ?? 1
            );
            gl.uniform1f(
              this.uEl["uSdfGlassTintLightness"],
              el.isSdfTexture.glassTintLightness ?? 1
            );
            gl.uniform1f(
              this.uEl["uSdfEdgeMatteEnabled"],
              el.isSdfTexture.edgeMatteEnabled ?? false ? 1 : 0
            );
            gl.uniform1f(
              this.uEl["uSdfEdgeMatteTargets"],
              el.isSdfTexture.edgeMatteTargets ?? 7
            );
            const bevelP = el.isSdfTexture.edgeMatteBevelParams ?? [1, 0];
            gl.uniform2f(this.uEl["uSdfEdgeMatteBevelParams"], bevelP[0], bevelP[1]);
            const tintP = el.isSdfTexture.edgeMatteTintParams ?? [1, 0];
            gl.uniform2f(this.uEl["uSdfEdgeMatteTintParams"], tintP[0], tintP[1]);
            const baseP = el.isSdfTexture.edgeMatteBaseParams ?? [1, 0];
            gl.uniform2f(this.uEl["uSdfEdgeMatteBaseParams"], baseP[0], baseP[1]);
            const brightenP = el.isSdfTexture.edgeMatteBrightenParams ?? [1, 0];
            gl.uniform2f(this.uEl["uSdfEdgeMatteBrightenParams"], brightenP[0], brightenP[1]);
            gl.uniform1f(this.uEl["uSdfEdgeMatteBevelStrength"], el.isSdfTexture.edgeMatteBevelStrength ?? 1);
            gl.uniform1f(this.uEl["uSdfEdgeMatteTintStrength"], el.isSdfTexture.edgeMatteTintStrength ?? 1);
            gl.uniform1f(this.uEl["uSdfEdgeMatteBaseStrength"], el.isSdfTexture.edgeMatteBaseStrength ?? 1);
            gl.uniform1f(this.uEl["uSdfEdgeMatteBrightenStrength"], el.isSdfTexture.edgeMatteBrightenStrength ?? 1);
            gl.uniform1f(
              this.uEl["uSdfDebugMode"],
              el.isSdfTexture.debugMode ? 1 : 0
            );
            gl.uniform1f(
              this.uEl["uSdfOuterRefraction"],
              el.isSdfTexture.outerRefraction ?? false ? 1 : 0
            );
            gl.uniform1f(
              this.uEl["uSdfAaMin"],
              el.isSdfTexture.aaMin ?? 0.5
            );
          } else {
            gl.uniform1f(this.uEl["uUseSdfTexture"], 0);
            gl.uniform1f(this.uEl["uSdfHighlightScale"], 1.5);
            gl.uniform1f(this.uEl["uSdfBevelEnabled"], 1);
            gl.uniform1f(this.uEl["uSdfGlassTintHue"], 0);
            gl.uniform1f(this.uEl["uSdfGlassTintEnabled"], 0);
            gl.uniform1f(this.uEl["uSdfGlassTintMix"], 0);
            gl.uniform1f(this.uEl["uSdfGlassTintStrength"], 0.85);
            gl.uniform1f(this.uEl["uSdfGlassTintSaturation"], 1);
            gl.uniform1f(this.uEl["uSdfGlassTintLightness"], 1);
            gl.uniform1f(this.uEl["uSdfEdgeMatteEnabled"], 0);
            gl.uniform1f(this.uEl["uSdfEdgeMatteTargets"], 7);
            gl.uniform2f(this.uEl["uSdfEdgeMatteBevelParams"], 1, 0);
            gl.uniform2f(this.uEl["uSdfEdgeMatteTintParams"], 1, 0);
            gl.uniform2f(this.uEl["uSdfEdgeMatteBaseParams"], 1, 0);
            gl.uniform2f(this.uEl["uSdfEdgeMatteBrightenParams"], 1, 0);
            gl.uniform1f(this.uEl["uSdfEdgeMatteBevelStrength"], 1);
            gl.uniform1f(this.uEl["uSdfEdgeMatteTintStrength"], 1);
            gl.uniform1f(this.uEl["uSdfEdgeMatteBaseStrength"], 1);
            gl.uniform1f(this.uEl["uSdfEdgeMatteBrightenStrength"], 1);
            gl.uniform1f(this.uEl["uSdfDebugMode"], 0);
            gl.uniform1f(this.uEl["uSdfOuterRefraction"], 0);
            gl.uniform1f(this.uEl["uSdfAaMin"], 0.5);
            if (this.dummyTex) {
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.dummyTex);
            }
          }
          if (el.useContinuousSdf && this.continuousSdfTexture) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.continuousSdfTexture);
            gl.uniform1i(this.uEl["uContinuousSdf"], 2);
            gl.uniform1f(this.uEl["uUseContinuousSdf"], 1);
            gl.uniform2f(
              this.uEl["uContinuousSdfTexSize"],
              this.continuousSdfTexSize[0],
              this.continuousSdfTexSize[1]
            );
            gl.uniform2f(
              this.uEl["uContinuousSdfElementSize"],
              state.origW * this.dpr,
              state.origH * this.dpr
            );
          } else {
            gl.uniform1f(this.uEl["uUseContinuousSdf"], 0);
            if (this.dummyTex && !el.isSdfTexture) {
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.dummyTex);
            }
          }
          gl.uniform1f(
            this.uEl["uNoContinuousSdfInRefraction"],
            el.useContinuousSdf && !this.noContinuousSdf ? 0 : 1
          );
          gl.uniform1f(this.uEl["uEnterAlpha"], state.enterAlpha);
          gl.uniform1f(this.uEl["uCornerStyle"], this.cornerStyle);
          if (el.isMagnifier) {
            gl.uniform1f(this.uEl["uUseMagnifier"], 1);
            gl.uniform1f(this.uEl["uMagnifierZoom"], el.isMagnifier.zoom);
            gl.uniform1f(this.uEl["uMagnifierOffsetY"], el.isMagnifier.sampleOffsetY * this.dpr);
          } else {
            gl.uniform1f(this.uEl["uUseMagnifier"], 0);
          }
          gl.uniform1f(
            this.uEl["uSkipColorControls"],
            el.backdropFbo && shouldUseSeparableBlur(el, state) ? 1 : 0
          );
          gl.uniform1f(this.uEl["uSampleWallpaper"], useSampleWallpaper ? 1 : 0);
          if (el.scrimColor) {
            gl.uniform4f(
              this.uEl["uScrimColor"],
              el.scrimColor[0],
              el.scrimColor[1],
              el.scrimColor[2],
              el.scrimColor[3]
            );
          } else {
            gl.uniform4f(this.uEl["uScrimColor"], 0, 0, 0, 0);
          }
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          state.elHighlightAlpha = ctx.elHighlightAlpha;
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/inner-shadow-mask.ts
  function buildPath(w, h, radius, useG2) {
    if (useG2) {
      const dummyCanvas = new OffscreenCanvas(1, 1);
      const dummyCtx = dummyCanvas.getContext("2d");
      return continuousCurvatureRoundedRectPath(dummyCtx, w, h, radius);
    }
    const path = new Path2D();
    if (typeof path.roundRect === "function") {
      path.roundRect(0, 0, w, h, radius);
    } else {
      const r = Math.min(radius, w / 2, h / 2);
      path.moveTo(r, 0);
      path.lineTo(w - r, 0);
      path.arcTo(w, 0, w, r, r);
      path.lineTo(w, h - r);
      path.arcTo(w, h, w - r, h, r);
      path.lineTo(r, h);
      path.arcTo(0, h, 0, h - r, r);
      path.lineTo(0, r);
      path.arcTo(0, 0, r, 0, r);
      path.closePath();
    }
    return path;
  }
  function createCanvas(w, h) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { alpha: true });
    return { canvas, ctx };
  }
  function generateInnerShadowMask(params) {
    const { w, h, radius, offsetX, offsetY, blurSigma, margin, useG2, supersample: SS } = params;
    const maskW = Math.max(1, Math.ceil(w + 2 * margin));
    const maskH = Math.max(1, Math.ceil(h + 2 * margin));
    const canvasW = maskW * SS;
    const canvasH = maskH * SS;
    const { canvas: tempCanvas, ctx: tCtx } = createCanvas(canvasW, canvasH);
    const { canvas: outputCanvas, ctx: oCtx } = createCanvas(canvasW, canvasH);
    tCtx.save();
    tCtx.scale(SS, SS);
    tCtx.translate(margin, margin);
    const path = buildPath(w, h, radius, useG2);
    tCtx.clip(path);
    tCtx.globalCompositeOperation = "source-over";
    tCtx.fillStyle = "white";
    tCtx.fill(path);
    tCtx.globalCompositeOperation = "destination-out";
    tCtx.save();
    tCtx.translate(offsetX, offsetY);
    tCtx.fill(path);
    tCtx.restore();
    tCtx.globalCompositeOperation = "source-over";
    tCtx.restore();
    if (blurSigma > 0.01) {
      oCtx.filter = `blur(${blurSigma * SS}px)`;
    } else {
      oCtx.filter = "none";
    }
    oCtx.drawImage(tempCanvas, 0, 0);
    oCtx.filter = "none";
    return { canvas: outputCanvas, maskW, maskH, margin };
  }
  var init_inner_shadow_mask = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/inner-shadow-mask.ts"() {
      "use strict";
      init_continuous_curve();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/inner-shadow-cache.ts
  function buildMaskKey(shadowIndex, params) {
    return [
      "is",
      shadowIndex,
      params.useG2 ? "g2" : "rr",
      params.w.toFixed(3),
      params.h.toFixed(3),
      params.radius.toFixed(3),
      params.offsetX.toFixed(3),
      params.offsetY.toFixed(3),
      params.blurSigma.toFixed(3),
      params.margin,
      Math.ceil(params.w + 2 * params.margin),
      // maskW
      Math.ceil(params.h + 2 * params.margin),
      // maskH
      `ss${params.supersample}`
    ].join(":");
  }
  function getOrCreateMaskEntry(cache, gl, key, maskW, maskH) {
    let entry = cache.get(key);
    if (entry) return entry;
    const tex = gl.createTexture();
    if (!tex) throw new Error("WebGL texture allocation failed");
    entry = { tex, w: maskW, h: maskH, ready: false };
    cache.set(key, entry);
    if (cache.size > MAX_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey && oldestKey !== key) {
        const oldest = cache.get(oldestKey);
        if (oldest) gl.deleteTexture(oldest.tex);
        cache.delete(oldestKey);
      }
    }
    return entry;
  }
  function uploadMaskTexture(gl, entry, result) {
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, result.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    entry.ready = true;
  }
  function destroyCache(gl, cache) {
    for (const entry of cache.values()) {
      gl.deleteTexture(entry.tex);
    }
    cache.clear();
  }
  var MAX_CACHE_SIZE;
  var init_inner_shadow_cache = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/inner-shadow-cache.ts"() {
      "use strict";
      MAX_CACHE_SIZE = 32;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes-inner-shadow.ts
  function renderGlassInnerShadowPass(renderer, state) {
    const gl = renderer.gl;
    const { el, sx, sy, sw, sh, radii, togglePressProgress } = state;
    if (!el.innerShadow || !renderer.quickToggles.innershadow) return;
    const origSizeX = state.origW * renderer.dpr;
    const origSizeY = state.origH * renderer.dpr;
    const origRadius = state.origCornerRadius * renderer.dpr;
    const layerScaleX = state.layerScaleX;
    const layerScaleY = state.layerScaleY;
    drawInnerShadowPass(renderer, state, el.innerShadow, 0);
    function drawInnerShadowPass(r, st, shadowCfg, shadowIndex) {
      const progress = st.el.isToggleKnob || st.el.isBottomTabIndicator ? togglePressProgress : 1;
      const shadowAlpha = shadowCfg.alpha * progress * st.enterAlpha;
      const shadowRadius = shadowCfg.radius * progress;
      const shadowOffsetX = shadowCfg.offsetX * progress;
      const shadowOffsetY = shadowCfg.offsetY * progress;
      if (shadowAlpha <= 1e-3 || shadowRadius <= 0.5) return;
      const blurSigma = shadowRadius * r.dpr;
      const margin = Math.ceil(blurSigma * 3) + 2;
      const maskW = Math.max(1, Math.ceil(origSizeX + 2 * margin));
      const maskH = Math.max(1, Math.ceil(origSizeY + 2 * margin));
      const deviceDpr = window.devicePixelRatio || 1;
      const SS = Math.min(2, Math.max(1, Math.floor(deviceDpr / r.dpr)));
      const useG2 = !!st.el.useContinuousSdf;
      const offsetXDp = shadowOffsetX * r.dpr;
      const offsetYDp = shadowOffsetY * r.dpr;
      const maskParams = {
        w: origSizeX,
        h: origSizeY,
        radius: origRadius,
        offsetX: offsetXDp,
        offsetY: offsetYDp,
        blurSigma,
        margin,
        useG2,
        supersample: SS
      };
      const key = buildMaskKey(shadowIndex, maskParams);
      const entry = getOrCreateMaskEntry(r.innerShadowMaskCache, gl, key, maskW, maskH);
      if (!entry.ready) {
        const result = generateInnerShadowMask(maskParams);
        uploadMaskTexture(gl, entry, result);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(r.innerShadowMaskCompositeProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.quadBuffer);
      gl.enableVertexAttribArray(r.aPosLocIs);
      gl.vertexAttribPointer(r.aPosLocIs, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(r.uIs["uCanvasSize"], r.canvas.width, r.canvas.height);
      gl.uniform2f(r.uIs["uOffset"], sx * r.dpr, sy * r.dpr);
      gl.uniform2f(r.uIs["uSize"], sw * r.dpr, sh * r.dpr);
      gl.uniform4f(
        r.uIs["uCornerRadii"],
        radii[0] * r.dpr,
        radii[1] * r.dpr,
        radii[2] * r.dpr,
        radii[3] * r.dpr
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.uniform1i(r.uIs["uInnerShadowMask"], 0);
      gl.uniform2f(r.uIs["uMaskOffset"], margin, margin);
      gl.uniform2f(r.uIs["uMaskSize"], entry.w, entry.h);
      const color = shadowCfg.color ?? [0, 0, 0];
      gl.uniform3f(r.uIs["uInnerShadowColor"], color[0], color[1], color[2]);
      gl.uniform1f(r.uIs["uInnerShadowAlpha"], shadowAlpha);
      gl.uniform2f(r.uIs["uOriginalSize"], origSizeX, origSizeY);
      gl.uniform1f(r.uIs["uOriginalCornerRadius"], origRadius);
      gl.uniform2f(r.uIs["uLayerScale"], layerScaleX, layerScaleY);
      gl.uniform1f(r.uIs["uElementRotation"], st.elementRotation);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }
  var init_methods_render_glass_post_passes_inner_shadow = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes-inner-shadow.ts"() {
      "use strict";
      init_inner_shadow_mask();
      init_inner_shadow_cache();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes-glow.ts
  function renderGlassGlowAndOverlays(renderer, state) {
    const gl = renderer.gl;
    const { el, st, isButton, p, sx, sy, sw, sh, radii, togglePressProgress } = state;
    const origSizeX = state.origW * renderer.dpr;
    const origSizeY = state.origH * renderer.dpr;
    const origRadius = state.origCornerRadius * renderer.dpr;
    const layerScaleX = state.layerScaleX;
    const layerScaleY = state.layerScaleY;
    const bindTintContinuousSdf = () => {
      if (el.useContinuousSdf && renderer.continuousSdfTexture) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, renderer.continuousSdfTexture);
        gl.uniform1i(renderer.uTn["uContinuousSdf"], 2);
        gl.uniform1f(renderer.uTn["uUseContinuousSdf"], 1);
        gl.uniform2f(
          renderer.uTn["uContinuousSdfTexSize"],
          renderer.continuousSdfTexSize[0],
          renderer.continuousSdfTexSize[1]
        );
        gl.uniform2f(
          renderer.uTn["uContinuousSdfElementSize"],
          state.origW * renderer.dpr,
          state.origH * renderer.dpr
        );
      } else {
        gl.uniform1f(renderer.uTn["uUseContinuousSdf"], 0);
      }
    };
    const isContainer = !!el.isBottomTabContainer;
    const glowP = isButton ? p : isContainer ? togglePressProgress : 0;
    if (isButton && el.isInteractive && st && p > 1e-3 || isContainer && togglePressProgress > 1e-3) {
      gl.useProgram(renderer.tintProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.quadBuffer);
      gl.enableVertexAttribArray(renderer.aPosLocTn);
      gl.vertexAttribPointer(renderer.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.uniform2f(renderer.uTn["uCanvasSize"], renderer.canvas.width, renderer.canvas.height);
      gl.uniform2f(renderer.uTn["uOffset"], sx * renderer.dpr, sy * renderer.dpr);
      gl.uniform2f(renderer.uTn["uSize"], sw * renderer.dpr, sh * renderer.dpr);
      gl.uniform4f(
        renderer.uTn["uCornerRadii"],
        radii[0] * renderer.dpr,
        radii[1] * renderer.dpr,
        radii[2] * renderer.dpr,
        radii[3] * renderer.dpr
      );
      gl.uniform2f(renderer.uTn["uOriginalSize"], origSizeX, origSizeY);
      gl.uniform1f(renderer.uTn["uOriginalCornerRadius"], origRadius);
      gl.uniform2f(renderer.uTn["uLayerScale"], layerScaleX, layerScaleY);
      gl.uniform1f(renderer.uTn["uElementRotation"], state.elementRotation);
      gl.uniform1f(renderer.uTn["uCornerStyle"], renderer.cornerStyle);
      bindTintContinuousSdf();
      gl.uniform4f(renderer.uTn["uColor"], 1, 1, 1, 0.08 * glowP);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.useProgram(renderer.highlightProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.quadBuffer);
      gl.enableVertexAttribArray(renderer.aPosLocHl);
      gl.vertexAttribPointer(renderer.aPosLocHl, 2, gl.FLOAT, false, 0, 0);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform2f(renderer.uHl["uCanvasSize"], renderer.canvas.width, renderer.canvas.height);
      gl.uniform2f(renderer.uHl["uOffset"], sx * renderer.dpr, sy * renderer.dpr);
      gl.uniform2f(renderer.uHl["uSize"], sw * renderer.dpr, sh * renderer.dpr);
      gl.uniform4f(
        renderer.uHl["uCornerRadii"],
        radii[0] * renderer.dpr,
        radii[1] * renderer.dpr,
        radii[2] * renderer.dpr,
        radii[3] * renderer.dpr
      );
      gl.uniform2f(renderer.uHl["uOriginalSize"], origSizeX, origSizeY);
      gl.uniform1f(renderer.uHl["uOriginalCornerRadius"], origRadius);
      gl.uniform2f(renderer.uHl["uLayerScale"], layerScaleX, layerScaleY);
      gl.uniform1f(renderer.uHl["uElementRotation"], state.elementRotation);
      gl.uniform1f(renderer.uHl["uCornerStyle"], renderer.cornerStyle);
      gl.uniform4f(renderer.uHl["uColor"], 1, 1, 1, 0.15 * glowP);
      const minDim = Math.min(sw, sh) * renderer.dpr;
      gl.uniform1f(renderer.uHl["uRadius"], minDim * 1.5);
      let px, py;
      if (isContainer) {
        const tg = renderer.toggleStates.get(el.isBottomTabContainer.groupId);
        const tabsCount = el.isBottomTabContainer.tabsCount ?? 4;
        const tabW = el.rect.w / tabsCount;
        const fraction = tg ? tg.fraction : 0;
        const indCenterX = (fraction + 0.5) * tabW;
        const scaleToLocal = sw / el.rect.w;
        px = Math.max(0, Math.min(sw, indCenterX * scaleToLocal)) * renderer.dpr;
        py = sh / 2 * renderer.dpr;
      } else {
        px = Math.max(0, Math.min(sw, st.dragX * state.layerScaleX)) * renderer.dpr;
        py = Math.max(0, Math.min(sh, st.dragY * state.layerScaleY)) * renderer.dpr;
      }
      gl.uniform2f(renderer.uHl["uPosition"], px, py);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (el.isToggleKnob && togglePressProgress < 0.999) {
      const whiteAlpha = 1 * (1 - togglePressProgress);
      gl.useProgram(renderer.tintProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.quadBuffer);
      gl.enableVertexAttribArray(renderer.aPosLocTn);
      gl.vertexAttribPointer(renderer.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(renderer.uTn["uCanvasSize"], renderer.canvas.width, renderer.canvas.height);
      gl.uniform2f(renderer.uTn["uOffset"], sx * renderer.dpr, sy * renderer.dpr);
      gl.uniform2f(renderer.uTn["uSize"], sw * renderer.dpr, sh * renderer.dpr);
      gl.uniform4f(
        renderer.uTn["uCornerRadii"],
        radii[0] * renderer.dpr,
        radii[1] * renderer.dpr,
        radii[2] * renderer.dpr,
        radii[3] * renderer.dpr
      );
      gl.uniform2f(renderer.uTn["uOriginalSize"], origSizeX, origSizeY);
      gl.uniform1f(renderer.uTn["uOriginalCornerRadius"], origRadius);
      gl.uniform2f(renderer.uTn["uLayerScale"], layerScaleX, layerScaleY);
      gl.uniform1f(renderer.uTn["uElementRotation"], state.elementRotation);
      gl.uniform1f(renderer.uTn["uCornerStyle"], renderer.cornerStyle);
      bindTintContinuousSdf();
      gl.uniform4f(renderer.uTn["uColor"], 1, 1, 1, whiteAlpha);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (el.isBottomTabIndicator && el.isBottomTabIndicator.dimColor) {
      const dc = el.isBottomTabIndicator.dimColor;
      const prog = togglePressProgress;
      gl.useProgram(renderer.tintProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.quadBuffer);
      gl.enableVertexAttribArray(renderer.aPosLocTn);
      gl.vertexAttribPointer(renderer.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(renderer.uTn["uCanvasSize"], renderer.canvas.width, renderer.canvas.height);
      gl.uniform2f(renderer.uTn["uOffset"], sx * renderer.dpr, sy * renderer.dpr);
      gl.uniform2f(renderer.uTn["uSize"], sw * renderer.dpr, sh * renderer.dpr);
      gl.uniform4f(
        renderer.uTn["uCornerRadii"],
        radii[0] * renderer.dpr,
        radii[1] * renderer.dpr,
        radii[2] * renderer.dpr,
        radii[3] * renderer.dpr
      );
      gl.uniform2f(renderer.uTn["uOriginalSize"], origSizeX, origSizeY);
      gl.uniform1f(renderer.uTn["uOriginalCornerRadius"], origRadius);
      gl.uniform2f(renderer.uTn["uLayerScale"], layerScaleX, layerScaleY);
      gl.uniform1f(renderer.uTn["uElementRotation"], state.elementRotation);
      gl.uniform1f(renderer.uTn["uCornerStyle"], renderer.cornerStyle);
      bindTintContinuousSdf();
      gl.uniform4f(renderer.uTn["uColor"], dc[0], dc[1], dc[2], 0.1 * (1 - prog));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.uniform4f(renderer.uTn["uColor"], 0, 0, 0, 0.03 * prog);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }
  var init_methods_render_glass_post_passes_glow = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes-glow.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes-rim-highlight.ts
  function renderGlassRimHighlight(renderer, state) {
    const gl = renderer.gl;
    const { el, sx, sy, sw, sh, radii, togglePressProgress, elHighlightAlpha } = state;
    if (!el.highlight || el.highlight.alpha <= 1e-3 || !renderer.quickToggles.highlight) return;
    const origSizeX = state.origW * renderer.dpr;
    const origSizeY = state.origH * renderer.dpr;
    const origRadius = state.origCornerRadius * renderer.dpr;
    const layerScaleX = state.layerScaleX;
    const layerScaleY = state.layerScaleY;
    const rimAlpha = el.isToggleKnob || el.isBottomTabIndicator ? elHighlightAlpha : el.highlight.alpha;
    const paintAlpha = el.highlight.mode === 1 ? 0.38 : 1;
    const finalAlpha = rimAlpha * state.enterAlpha * paintAlpha;
    if (finalAlpha <= 1e-3) return;
    const widthPx = Math.min(
      el.highlight.widthDp * renderer.dpr,
      Math.min(origSizeX, origSizeY) * 0.5
    );
    const strokeWidthDevice = el.highlight.aa !== false ? Math.max(1, Math.ceil(widthPx) * 2) : Math.max(1, Math.round(widthPx) * 2);
    const blurPx = Math.max(0, (el.highlight.blurRadiusDp ?? el.highlight.widthDp / 2) * renderer.dpr);
    const strokeMargin = Math.ceil(strokeWidthDevice) + 4;
    const maskW = Math.max(1, Math.ceil(origSizeX + 2 * strokeMargin));
    const maskH = Math.max(1, Math.ceil(origSizeY + 2 * strokeMargin));
    const deviceDpr = window.devicePixelRatio || 1;
    const SS = Math.min(2, Math.max(1, Math.floor(deviceDpr / renderer.dpr)));
    const canvasW = maskW * SS;
    const canvasH = maskH * SS;
    const useG2 = !!el.useContinuousSdf;
    const maskKey = [
      useG2 ? "g2" : "rr",
      origSizeX.toFixed(3),
      origSizeY.toFixed(3),
      origRadius.toFixed(3),
      strokeWidthDevice,
      blurPx.toFixed(3),
      strokeMargin,
      maskW,
      maskH,
      `ss${SS}`
      // cache key includes supersample factor
    ].join(":");
    let mask = renderer.strokeMaskCache.get(maskKey);
    if (!mask) {
      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx2d = canvas.getContext("2d", { alpha: true });
      if (!ctx2d) throw new Error("2D canvas not supported");
      const tex = gl.createTexture();
      if (!tex) throw new Error("WebGL texture allocation failed");
      mask = { tex, canvas, ctx: ctx2d, w: maskW, h: maskH, ready: false };
      renderer.strokeMaskCache.set(maskKey, mask);
      if (renderer.strokeMaskCache.size > 32) {
        const oldestKey = renderer.strokeMaskCache.keys().next().value;
        if (oldestKey && oldestKey !== maskKey) {
          const oldest = renderer.strokeMaskCache.get(oldestKey);
          if (oldest) gl.deleteTexture(oldest.tex);
          renderer.strokeMaskCache.delete(oldestKey);
        }
      }
    }
    if (!mask.ready) {
      const smCtx = mask.ctx;
      smCtx.clearRect(0, 0, canvasW, canvasH);
      smCtx.save();
      smCtx.scale(SS, SS);
      smCtx.translate(strokeMargin, strokeMargin);
      let path;
      if (useG2) {
        path = continuousCurvatureRoundedRectPath(smCtx, origSizeX, origSizeY, origRadius);
      } else {
        path = new Path2D();
        const r = Math.min(origRadius, origSizeX / 2, origSizeY / 2);
        path.moveTo(r, 0);
        path.lineTo(origSizeX - r, 0);
        path.arcTo(origSizeX, 0, origSizeX, r, r);
        path.lineTo(origSizeX, origSizeY - r);
        path.arcTo(origSizeX, origSizeY, origSizeX - r, origSizeY, r);
        path.lineTo(r, origSizeY);
        path.arcTo(0, origSizeY, 0, origSizeY - r, r);
        path.lineTo(0, r);
        path.arcTo(0, 0, r, 0, r);
        path.closePath();
      }
      smCtx.clip(path);
      smCtx.lineWidth = strokeWidthDevice;
      smCtx.strokeStyle = "rgba(255,255,255,1)";
      smCtx.lineJoin = "round";
      smCtx.lineCap = "round";
      smCtx.filter = blurPx > 0.01 ? `blur(${blurPx}px)` : "none";
      smCtx.stroke(path);
      smCtx.filter = "none";
      smCtx.restore();
      gl.bindTexture(gl.TEXTURE_2D, mask.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask.canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      mask.ready = true;
    }
    gl.enable(gl.BLEND);
    if (el.highlight.mode === 1) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    gl.useProgram(renderer.strokeMaskCompositeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.quadBuffer);
    gl.enableVertexAttribArray(renderer.aPosLocSm);
    gl.vertexAttribPointer(renderer.aPosLocSm, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(renderer.uSm["uCanvasSize"], renderer.canvas.width, renderer.canvas.height);
    gl.uniform2f(renderer.uSm["uOffset"], sx * renderer.dpr, sy * renderer.dpr);
    gl.uniform2f(renderer.uSm["uSize"], sw * renderer.dpr, sh * renderer.dpr);
    gl.uniform4f(
      renderer.uSm["uCornerRadii"],
      radii[0] * renderer.dpr,
      radii[1] * renderer.dpr,
      radii[2] * renderer.dpr,
      radii[3] * renderer.dpr
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mask.tex);
    gl.uniform1i(renderer.uSm["uStrokeMask"], 0);
    gl.uniform2f(renderer.uSm["uMaskOffset"], strokeMargin, strokeMargin);
    gl.uniform2f(renderer.uSm["uMaskSize"], mask.w, mask.h);
    gl.uniform4f(
      renderer.uSm["uHighlightColor"],
      el.highlight.color[0],
      el.highlight.color[1],
      el.highlight.color[2],
      1
    );
    gl.uniform1f(
      renderer.uSm["uHighlightAngle"],
      el.useGravityAngle ? renderer.gravityAngle : el.highlight.angle
    );
    gl.uniform1f(renderer.uSm["uHighlightFalloff"], el.highlight.falloff);
    gl.uniform1f(renderer.uSm["uHighlightAlpha"], finalAlpha);
    gl.uniform1f(renderer.uSm["uHighlightMode"], el.highlight.mode);
    gl.uniform2f(renderer.uSm["uOriginalSize"], origSizeX, origSizeY);
    gl.uniform1f(renderer.uSm["uOriginalCornerRadius"], origRadius);
    gl.uniform2f(renderer.uSm["uLayerScale"], layerScaleX, layerScaleY);
    gl.uniform1f(renderer.uSm["uElementRotation"], state.elementRotation);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  var init_methods_render_glass_post_passes_rim_highlight = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes-rim-highlight.ts"() {
      "use strict";
      init_continuous_curve();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes.ts
  var glassPostPassMethods;
  var init_methods_render_glass_post_passes = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-render-glass-post-passes.ts"() {
      "use strict";
      init_methods_render_glass_post_passes_inner_shadow();
      init_methods_render_glass_post_passes_glow();
      init_methods_render_glass_post_passes_rim_highlight();
      glassPostPassMethods = {
        /** Steps 2b–2f: Inner shadow, press glow, white overlay, foreground, rim highlight.
         *  These all composite on top of the glass body (already drawn to
         *  otherFbo by renderGlassElementPass).
         *
         *  Orchestration only — the inner-shadow pass, the press-glow + white-overlay
         *  + indicator-dim overlays, and the rim-highlight pass each live in their
         *  own file. Only the foreground (label/icon) pass is small enough to keep
         *  inline here. */
        renderGlassPostPasses(state) {
          const gl = this.gl;
          const { el, st, isButton, p, sx, sy, sw, sh, radii } = state;
          const origSizeX = state.origW * this.dpr;
          const origSizeY = state.origH * this.dpr;
          const origRadius = state.origCornerRadius * this.dpr;
          const layerScaleX = state.layerScaleX;
          const layerScaleY = state.layerScaleY;
          renderGlassInnerShadowPass(this, state);
          renderGlassGlowAndOverlays(this, state);
          if (isButton && (el.label || el.icon)) {
            const fgTex = this.fgTextures.get(el.id);
            if (fgTex) {
              gl.useProgram(this.foregroundProgram);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
              gl.enableVertexAttribArray(this.aPosLocFg);
              gl.vertexAttribPointer(this.aPosLocFg, 2, gl.FLOAT, false, 0, 0);
              gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, fgTex);
              gl.uniform1i(this.uFg["uTexture"], 0);
              gl.uniform2f(this.uFg["uCanvasSize"], this.canvas.width, this.canvas.height);
              gl.uniform2f(this.uFg["uOffset"], sx * this.dpr, sy * this.dpr);
              gl.uniform2f(this.uFg["uSize"], sw * this.dpr, sh * this.dpr);
              gl.uniform4f(
                this.uFg["uCornerRadii"],
                radii[0] * this.dpr,
                radii[1] * this.dpr,
                radii[2] * this.dpr,
                radii[3] * this.dpr
              );
              gl.uniform2f(this.uFg["uOriginalSize"], origSizeX, origSizeY);
              gl.uniform1f(this.uFg["uOriginalCornerRadius"], origRadius);
              gl.uniform2f(this.uFg["uLayerScale"], layerScaleX, layerScaleY);
              gl.uniform1f(this.uFg["uCornerStyle"], this.cornerStyle);
              if (el.useContinuousSdf && this.continuousSdfTexture) {
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, this.continuousSdfTexture);
                gl.uniform1i(this.uFg["uContinuousSdf"], 2);
                gl.uniform1f(this.uFg["uUseContinuousSdf"], 1);
                gl.uniform2f(
                  this.uFg["uContinuousSdfTexSize"],
                  this.continuousSdfTexSize[0],
                  this.continuousSdfTexSize[1]
                );
                gl.uniform2f(
                  this.uFg["uContinuousSdfElementSize"],
                  state.origW * this.dpr,
                  state.origH * this.dpr
                );
              } else {
                gl.uniform1f(this.uFg["uUseContinuousSdf"], 0);
              }
              gl.uniform1f(this.uFg["uAlpha"], 1 - 0.15 * p);
              gl.drawArrays(gl.TRIANGLES, 0, 6);
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
          }
          renderGlassRimHighlight(this, state);
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-dirty.ts
  var dirtyTrackingMethods;
  var init_methods_dirty = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-dirty.ts"() {
      "use strict";
      dirtyTrackingMethods = {
        markElementDirty(id) {
          this.dirtyElementIds.add(id);
          const entry = this.elFboCache.get(id);
          if (entry) entry.valid = false;
          if (this.showDirtyMarkers) {
            const stack = new Error().stack ?? "";
            const lines = stack.split("\n");
            let source = "unknown";
            for (let i = 2; i < lines.length; i++) {
              const ln = lines[i].trim();
              if (!ln) continue;
              if (ln.includes("markElementDirty") || ln.includes("markGroupDirty") || ln.includes("markAllDirty")) continue;
              const m = ln.match(/at\s+(\S+)\s+\(/);
              source = m ? m[1] : ln.slice(0, 60);
              break;
            }
            this.debugDirtySourceLog.push({ id, source });
          }
        },
        markAllDirty() {
          this.allDirty = true;
          this.dirtyElementIds.clear();
          for (const entry of this.elFboCache.values()) entry.valid = false;
        },
        markGroupDirty(groupId) {
          for (const el of this.buttonConfigs) {
            if (el.isBottomTabContainer?.groupId === groupId) continue;
            if (el.isToggleKnob?.groupId === groupId || el.isToggleTrack?.groupId === groupId || el.isSliderFill?.groupId === groupId || el.isBottomTabContent?.groupId === groupId || el.isBottomTabIndicator?.groupId === groupId) {
              this.markElementDirty(el.id);
            }
          }
        },
        markGravityDirty() {
          for (const el of this.buttonConfigs) {
            if (el.useGravityAngle) this.markElementDirty(el.id);
          }
        },
        hasDirtyElements() {
          return this.allDirty || this.dirtyElementIds.size > 0;
        },
        deleteElFboCacheEntry(id) {
          const entry = this.elFboCache.get(id);
          if (!entry) return;
          const gl = this.gl;
          gl.deleteFramebuffer(entry.fb);
          gl.deleteTexture(entry.tex);
          this.elFboCache.delete(id);
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-debug.ts
  function analyzeEdgeScan(scan) {
    const { pixels, dpr } = scan;
    const N = pixels.length;
    if (N < 4) {
      return {
        edgeIdx: 0,
        edgeOffsetCss: 0,
        transitionHalfW: 0,
        rgbInside: 0,
        rgbOutside: 0,
        minRgbInTransition: 0,
        blackFringeDetected: false,
        hasNearBlackPx: false,
        canvasOpaque: true,
        verdict: "Scan too short (element not found or off-screen)."
      };
    }
    const lum = new Float32Array(N);
    let opaqueCount = 0;
    for (let i = 0; i < N; i++) {
      const p = pixels[i];
      lum[i] = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
      if (p.a >= 250) opaqueCount++;
    }
    const canvasOpaque = opaqueCount > N * 0.9;
    let maxGrad = 0;
    let edgeIdx = Math.floor(N / 2);
    for (let i = 2; i < N - 2; i++) {
      const g = Math.abs(lum[i + 1] - lum[i - 1]);
      if (g > maxGrad) {
        maxGrad = g;
        edgeIdx = i;
      }
    }
    const edgeOffsetCss = pixels[edgeIdx].offset;
    const transitionHalfW = Math.max(3, Math.floor(N / 8));
    const zoneStart = Math.max(0, edgeIdx - transitionHalfW);
    const zoneEnd = Math.min(N - 1, edgeIdx + transitionHalfW);
    const insideStart = Math.max(0, zoneStart - 3);
    const insideEnd = Math.max(insideStart, zoneStart - 1);
    let rgbInside = 0, insideCount = 0;
    for (let i = insideStart; i <= insideEnd; i++) {
      rgbInside += lum[i];
      insideCount++;
    }
    rgbInside = insideCount > 0 ? rgbInside / insideCount : lum[0];
    const outsideStart = Math.min(N - 1, zoneEnd + 1);
    const outsideEnd = Math.min(N - 1, zoneEnd + 3);
    let rgbOutside = 0, outsideCount = 0;
    for (let i = outsideStart; i <= outsideEnd; i++) {
      rgbOutside += lum[i];
      outsideCount++;
    }
    rgbOutside = outsideCount > 0 ? rgbOutside / outsideCount : lum[N - 1];
    let minRgbInTransition = 255;
    let hasNearBlackPx = false;
    for (let i = zoneStart; i <= zoneEnd; i++) {
      const l = lum[i];
      if (l < minRgbInTransition) minRgbInTransition = l;
      if (l < 30) hasNearBlackPx = true;
    }
    const threshold = 25;
    const blackFringeDetected = maxGrad > 10 && // only flag if there's a real edge (not a flat region)
    minRgbInTransition < Math.min(rgbInside, rgbOutside) - threshold && minRgbInTransition < 100;
    let verdict;
    if (blackFringeDetected && hasNearBlackPx) {
      verdict = `\u26A0 BLACK FRINGE: RGB dips to ${minRgbInTransition.toFixed(0)} at edge (inside=${rgbInside.toFixed(0)}, outside=${rgbOutside.toFixed(0)}). Near-black pixels in transition zone \u2192 premult-alpha leak or refraction reads outside FBO.`;
    } else if (blackFringeDetected) {
      verdict = `\u26A0 DARK EDGE: RGB dips to ${minRgbInTransition.toFixed(0)} at edge (inside=${rgbInside.toFixed(0)}, outside=${rgbOutside.toFixed(0)}). Edge is darker than both sides.`;
    } else if (hasNearBlackPx && maxGrad > 10) {
      verdict = `\u26A0 NEAR-BLACK PX at edge: min RGB ${minRgbInTransition.toFixed(0)} (inside=${rgbInside.toFixed(0)}, outside=${rgbOutside.toFixed(0)}). Investigate.`;
    } else if (maxGrad <= 10) {
      verdict = `~ Flat scan (no sharp edge detected). Max gradient ${maxGrad.toFixed(1)}. Element may be off-screen or uniformly colored.`;
    } else {
      verdict = `\u2713 Clean edge. Transition RGB ${minRgbInTransition.toFixed(0)} is between inside ${rgbInside.toFixed(0)} and outside ${rgbOutside.toFixed(0)}. No black fringe.`;
    }
    return {
      edgeIdx,
      edgeOffsetCss,
      transitionHalfW,
      rgbInside,
      rgbOutside,
      minRgbInTransition,
      blackFringeDetected,
      hasNearBlackPx,
      canvasOpaque,
      verdict
    };
  }
  var debugMethods;
  var init_methods_debug = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-debug.ts"() {
      "use strict";
      init_continuous_mask();
      debugMethods = {
        /** Request an edge scan. Sets _pendingEdgeScan + calls requestRender().
         *  The actual readPixels happens at the end of the next render() frame
         *  (while the drawing buffer is still valid, before the browser composites
         *  and clears it). The overlay polls _edgeScanResult for the result. */
        debugReadEdgeScanline(halfRangeCss = 20) {
          this._pendingEdgeScan = { halfRangeCss };
          this.requestRender();
        },
        /** Cycle the scan target to the next useContinuousSdf element. Returns
         *  the new target index (0-based, modulo the element count). */
        debugCycleEdgeScanTarget() {
          const candidates = this.buttonConfigs.filter(
            (e) => e.useContinuousSdf && e.rect.w > 0 && e.rect.h > 0
          );
          if (candidates.length === 0) return 0;
          this._edgeScanTargetIdx = (this._edgeScanTargetIdx + 1) % candidates.length;
          this._pendingEdgeScan = { halfRangeCss: 20 };
          this.requestRender();
          return this._edgeScanTargetIdx;
        },
        /** Clear any pending + completed edge scan (toggle OFF). Clears
         *  _pendingEdgeScan so an in-flight request doesn't repopulate the result
         *  next frame, drops _edgeScanResult so the overlay's next poll sees null,
         *  and bumps _edgeScanCounter so the overlay's lastConsumedScanId is stale
         *  (a subsequent new scan will have a fresh scanId the overlay will pick
         *  up). No requestRender — clearing is purely state, no draw needed. */
        debugClearEdgeScan() {
          this._pendingEdgeScan = null;
          this._edgeScanResult = null;
          this._edgeScanCounter++;
        },
        /** Called from the render loop (methods-render.ts) right after the final
         *  drawCopy to the default framebuffer. If a scan is pending, reads a 2D
         *  patch around the target capsule element's TOP-RIGHT CORNER (the 45°
         *  point on the corner arc), extracts a diagonal through the arc edge,
         *  analyzes it, and stores the result in _edgeScanResult.
         *
         *  WHY THE CORNER (not the straight edge): the black-edge artifact only
         *  appears on curved (non-straight) edges. The straight edge maps to the
         *  middle of the SDF texture where coverage (R) and SDF (G) are both flat
         *  and clean — no fringe. The corner maps to the high-curvature region of
         *  the SDF texture where the chamfer distance transform has the most error,
         *  causing R (coverage) and G (SDF) to potentially misalign → black fringe.
         *
         *  MUST be called while the default framebuffer is still bound and the
         *  drawing buffer is valid (i.e. synchronously after drawCopy, within
         *  the same rAF tick). */
        _debugFlushPendingEdgeScan() {
          const pending = this._pendingEdgeScan;
          if (!pending) return;
          this._pendingEdgeScan = null;
          const candidates = this.buttonConfigs.filter((e) => e.useContinuousSdf && e.rect.w > 0 && e.rect.h > 0).map((e) => {
            const minDim = Math.min(e.rect.w, e.rect.h);
            const isCapsule = e.cornerRadius >= minDim / 2 - 0.5;
            return { el: e, isCapsule };
          }).sort((a, b) => Number(b.isCapsule) - Number(a.isCapsule));
          if (candidates.length === 0) {
            this._edgeScanCounter++;
            this._edgeScanResult = {
              scanId: this._edgeScanCounter,
              elementId: "(none)",
              targetIdx: 0,
              targetCount: 0,
              isCapsule: false,
              rect: { x: 0, y: 0, w: 0, h: 0 },
              cornerRadius: 0,
              dpr: this.dpr || 1,
              cornerCenter: { x: 0, y: 0 },
              cornerPoint45: { x: 0, y: 0 },
              patchCssX: 0,
              patchCssY: 0,
              patchDevSize: 0,
              halfRange: pending.halfRangeCss,
              patch: new Uint8Array(0),
              pixels: [],
              sdfProfile: null,
              sdfTexSize: 0,
              analysis: {
                edgeIdx: 0,
                edgeOffsetCss: 0,
                transitionHalfW: 0,
                rgbInside: 0,
                rgbOutside: 0,
                minRgbInTransition: 0,
                blackFringeDetected: false,
                hasNearBlackPx: false,
                canvasOpaque: true,
                verdict: "No useContinuousSdf element found on screen."
              }
            };
            return;
          }
          const targetIdx = this._edgeScanTargetIdx % candidates.length;
          const picked = candidates[targetIdx];
          const el = picked.el;
          const { rect, cornerRadius: r } = el;
          const dpr = this.dpr || 1;
          const gl = this.gl;
          const halfRangeCss = pending.halfRangeCss;
          const sqrt2 = Math.SQRT2;
          const cornerCx = rect.x + rect.w - r;
          const cornerCy = rect.y + r;
          const p45x = cornerCx + r / sqrt2;
          const p45y = cornerCy - r / sqrt2;
          const patchCssX = p45x - halfRangeCss;
          const patchCssY = p45y - halfRangeCss;
          const patchCssSize = halfRangeCss * 2;
          const patchDevSize = Math.max(1, Math.round(patchCssSize * dpr));
          const patchDevX = Math.round(patchCssX * dpr);
          const patchDevYTop = Math.round(patchCssY * dpr);
          const clampedW = Math.min(patchDevSize, this.canvas.width - patchDevX);
          const clampedH = Math.min(patchDevSize, this.canvas.height - patchDevYTop);
          if (clampedW <= 0 || clampedH <= 0) return;
          const readY = this.canvas.height - (patchDevYTop + clampedH);
          const clampedReadY = Math.max(0, Math.min(this.canvas.height - clampedH, readY));
          this.bindFbRaw(gl, gl.FRAMEBUFFER, null);
          const buf = new Uint8Array(clampedW * clampedH * 4);
          gl.readPixels(patchDevX, clampedReadY, clampedW, clampedH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          const patch = new Uint8Array(clampedW * clampedH * 4);
          for (let row = 0; row < clampedH; row++) {
            const srcRow = clampedH - 1 - row;
            patch.set(
              buf.subarray(srcRow * clampedW * 4, (srcRow + 1) * clampedW * 4),
              row * clampedW * 4
            );
          }
          const diagN = Math.min(clampedW, clampedH);
          const pixels = [];
          for (let i = 0; i < diagN; i++) {
            const col = clampedW - 1 - i;
            const row = i;
            const idx = (row * clampedW + col) * 4;
            const offset = (diagN / 2 - i) / dpr;
            pixels.push({
              offset,
              r: patch[idx],
              g: patch[idx + 1],
              b: patch[idx + 2],
              a: patch[idx + 3]
            });
          }
          this._edgeScanCounter++;
          let sdfProfile = null;
          let sdfTexSize = 0;
          const maskEntries = getMaskCacheEntries();
          const elW = rect.w;
          const elH = rect.h;
          const elR = Math.round(r);
          const matchedEntry = maskEntries.find((e) => {
            const parts = e.key.split(",");
            return Math.round(parseFloat(parts[0])) === Math.round(elW) && Math.round(parseFloat(parts[1])) === Math.round(elH) && Math.round(parseFloat(parts[2])) === elR;
          });
          if (matchedEntry) {
            sdfTexSize = matchedEntry.texSize;
            const texData = matchedEntry.tex;
            const ts = matchedEntry.texSize;
            const elementSizeX = elW * dpr;
            const elementSizeY = elH * dpr;
            const maxDim = Math.max(elementSizeX, elementSizeY);
            const margin = 4;
            const scale = (ts - 2 * margin) / maxDim;
            const elementCenterX = rect.x + rect.w / 2;
            const elementCenterY = rect.y + rect.h / 2;
            sdfProfile = [];
            for (let i = 0; i < diagN; i++) {
              const col = clampedW - 1 - i;
              const row = i;
              const patchCanvasX = patchCssX + col / dpr;
              const patchCanvasY = patchCssY + row / dpr;
              const centeredOrigX = (patchCanvasX - elementCenterX) * dpr;
              const centeredOrigY = (patchCanvasY - elementCenterY) * dpr;
              const texX = ts / 2 + centeredOrigX * scale;
              const texY = ts / 2 + centeredOrigY * scale;
              const u = texX / ts;
              const v = texY / ts;
              const fx = texX;
              const fy = texY;
              const ix = Math.floor(fx);
              const iy = Math.floor(fy);
              const fracX = fx - ix;
              const fracY = fy - iy;
              const clamp = (v2) => Math.max(0, Math.min(ts - 1, v2));
              const i00 = (clamp(iy) * ts + clamp(ix)) * 4;
              const i10 = (clamp(iy) * ts + clamp(ix + 1)) * 4;
              const i01 = (clamp(iy + 1) * ts + clamp(ix)) * 4;
              const i11 = (clamp(iy + 1) * ts + clamp(ix + 1)) * 4;
              const w00 = (1 - fracX) * (1 - fracY);
              const w10 = fracX * (1 - fracY);
              const w01 = (1 - fracX) * fracY;
              const w11 = fracX * fracY;
              const rVal = texData[i00] * w00 + texData[i10] * w10 + texData[i01] * w01 + texData[i11] * w11;
              const gVal = texData[i00 + 1] * w00 + texData[i10 + 1] * w10 + texData[i01 + 1] * w01 + texData[i11 + 1] * w11;
              const offset = (diagN / 2 - i) / dpr;
              sdfProfile.push({ r: rVal, g: gVal, offset });
            }
          }
          const base = {
            scanId: this._edgeScanCounter,
            elementId: el.id,
            targetIdx,
            targetCount: candidates.length,
            isCapsule: picked.isCapsule,
            rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
            cornerRadius: r,
            dpr,
            cornerCenter: { x: cornerCx, y: cornerCy },
            cornerPoint45: { x: p45x, y: p45y },
            patchCssX,
            patchCssY,
            patchDevSize: clampedW,
            // use clampedW (== clampedH for square patches)
            halfRange: halfRangeCss,
            patch,
            pixels,
            sdfProfile,
            sdfTexSize
          };
          this._edgeScanResult = { ...base, analysis: analyzeEdgeScan(base) };
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-uniforms.ts
  var uniformMethods;
  var init_methods_uniforms = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-uniforms.ts"() {
      "use strict";
      uniformMethods = {
        cacheUniforms() {
          const gl = this.gl;
          const elNames = [
            "uBackdrop",
            "uWallpaperSampler",
            "uTabsBackdropSampler",
            "uCanvasSize",
            "uWallpaperSize",
            "uElementOffset",
            "uElementSize",
            "uBackdropBbox",
            "uCornerRadii",
            "uRefractionHeight",
            "uRefractionAmount",
            "uDepthEffect",
            "uChromaticAberration",
            "uBlurRadius",
            "uSaturation",
            "uBrightness",
            "uContrast",
            "uTintColor",
            "uSurfaceColor",
            "uHighlightColor",
            "uHighlightAngle",
            "uHighlightFalloff",
            "uHighlightAlpha",
            "uHighlightMode",
            "uHighlightStrokeWidth",
            "uHighlightBlur",
            "uContentScaleX",
            "uContentScaleY",
            "uUseToggleBackdrop",
            "uUseSolidBackdrop",
            "uSolidBackdropColor",
            "uTrackColor",
            "uTrackRect",
            "uTrackCornerRadius",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uIndicatorBackdrop",
            "uContainerRect",
            "uContainerCornerRadius",
            "uIndicatorAccent",
            "uInsetPx",
            "uIndicatorPressProgress",
            "uIndicatorPanelOffset",
            "uDpr",
            "uContainerCenter",
            "uContainerScale",
            "uTabContentTex0",
            "uTabContentTex1",
            "uTabContentTex2",
            "uTabContentTex3",
            "uTabContentTex4",
            "uTabContentTex5",
            "uTabContentTex6",
            "uTabContentTex7",
            "uTabContentRects[0]",
            "uTabContentRects[1]",
            "uTabContentRects[2]",
            "uTabContentRects[3]",
            "uTabContentRects[4]",
            "uTabContentRects[5]",
            "uTabContentRects[6]",
            "uTabContentRects[7]",
            "uTabContentCount",
            "uTabsGlassLayer",
            "uSdfTexSampler",
            "uUseSdfTexture",
            "uSdfTexSize",
            "uSdfLightAngle",
            "uEnterAlpha",
            "uSdfHighlightScale",
            "uSdfBevelEnabled",
            "uSdfGlassTintHue",
            "uSdfGlassTintEnabled",
            "uSdfGlassTintMix",
            "uSdfGlassTintStrength",
            "uSdfGlassTintSaturation",
            "uSdfGlassTintLightness",
            "uSdfEdgeMatteEnabled",
            "uSdfEdgeMatteTargets",
            "uSdfEdgeMatteBevelParams",
            "uSdfEdgeMatteTintParams",
            "uSdfEdgeMatteBaseParams",
            "uSdfEdgeMatteBrightenParams",
            "uSdfEdgeMatteBevelStrength",
            "uSdfEdgeMatteTintStrength",
            "uSdfEdgeMatteBaseStrength",
            "uSdfEdgeMatteBrightenStrength",
            "uSdfDebugMode",
            "uSdfOuterRefraction",
            "uSdfAaMin",
            "uUsePerElementFbo",
            "uSceneRectOffset",
            "uElFboSize",
            "uBackdropRect",
            "uCornerStyle",
            "uSkipColorControls",
            "uUseMagnifier",
            "uMagnifierZoom",
            "uMagnifierOffsetY",
            "uElementRotation",
            "uContinuousSdf",
            "uUseContinuousSdf",
            "uContinuousSdfTexSize",
            "uContinuousSdfElementSize",
            "uNoContinuousSdfInRefraction",
            "uInnerStrokeMask",
            "uInnerStrokeMaskOffset",
            "uInnerStrokeMaskSize"
          ];
          for (const n of elNames) this.uEl[n] = gl.getUniformLocation(this.elementProgram, n);
          const shNames = [
            "uCanvasSize",
            "uElementOffset",
            "uElementSize",
            "uCornerRadii",
            "uShadowRadius",
            "uShadowOffset",
            "uShadowColor",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation",
            "uCornerStyle"
          ];
          for (const n of shNames) this.uSh[n] = gl.getUniformLocation(this.shadowProgram, n);
          const wpNames = ["uBackdrop", "uCanvasSize", "uWallpaperSize"];
          for (const n of wpNames) this.uWp[n] = gl.getUniformLocation(this.wallpaperProgram, n);
          const fgNames = [
            "uTexture",
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uAlpha",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uCornerStyle",
            "uUseContinuousSdf",
            "uContinuousSdf",
            "uContinuousSdfTexSize",
            "uContinuousSdfElementSize"
          ];
          for (const n of fgNames) this.uFg[n] = gl.getUniformLocation(this.foregroundProgram, n);
          const hlNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uColor",
            "uRadius",
            "uPosition",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation",
            "uCornerStyle"
          ];
          for (const n of hlNames) this.uHl[n] = gl.getUniformLocation(this.highlightProgram, n);
          const tnNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uColor",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation",
            "uCornerStyle"
          ];
          for (const n of tnNames) this.uTn[n] = gl.getUniformLocation(this.tintProgram, n);
          const rmNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uHighlightColor",
            "uHighlightAngle",
            "uHighlightFalloff",
            "uHighlightAlpha",
            "uHighlightMode",
            "uHighlightStrokeWidth",
            "uHighlightBlur",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation",
            "uCornerStyle",
            "uUseContinuousSdf",
            "uContinuousSdf",
            "uContinuousSdfTexSize",
            "uContinuousSdfElementSize"
          ];
          for (const n of rmNames) this.uRm[n] = gl.getUniformLocation(this.rimHighlightProgram, n);
          const hsNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uHighlightStrokeWidth",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation",
            "uCornerStyle",
            "uUseContinuousSdf",
            "uContinuousSdf",
            "uContinuousSdfTexSize",
            "uContinuousSdfElementSize"
          ];
          for (const n of hsNames) this.uHs[n] = gl.getUniformLocation(this.highlightStrokeProgram, n);
          const hcNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uBlurredMask",
            "uMaskTexSize",
            "uHighlightColor",
            "uHighlightAngle",
            "uHighlightFalloff",
            "uHighlightAlpha",
            "uHighlightMode",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation",
            "uCornerStyle",
            "uUseContinuousSdf",
            "uContinuousSdf",
            "uContinuousSdfTexSize",
            "uContinuousSdfElementSize"
          ];
          for (const n of hcNames) this.uHc[n] = gl.getUniformLocation(this.highlightCompositeProgram, n);
          const smNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uStrokeMask",
            "uMaskOffset",
            "uMaskSize",
            "uHighlightColor",
            "uHighlightAngle",
            "uHighlightFalloff",
            "uHighlightAlpha",
            "uHighlightMode",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation"
          ];
          for (const n of smNames) this.uSm[n] = gl.getUniformLocation(this.strokeMaskCompositeProgram, n);
          const isNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uInnerShadowMask",
            "uMaskOffset",
            "uMaskSize",
            "uInnerShadowColor",
            "uInnerShadowAlpha",
            "uOriginalSize",
            "uOriginalCornerRadius",
            "uLayerScale",
            "uElementRotation"
          ];
          for (const n of isNames) this.uIs[n] = gl.getUniformLocation(this.innerShadowMaskCompositeProgram, n);
          const prNames = [
            "uCanvasSize",
            "uOffset",
            "uSize",
            "uCornerRadii",
            "uColor",
            "uCornerStyle",
            "uUseContinuousSdf",
            "uContinuousSdf",
            "uContinuousSdfTexSize",
            "uContinuousSdfElementSize"
          ];
          for (const n of prNames) this.uPr[n] = gl.getUniformLocation(this.plainRectProgram, n);
          const pbNames = [
            "uBackdrop",
            "uCanvasSize",
            "uWallpaperSize",
            "uOffset",
            "uSize",
            "uBlurRadius",
            "uTintColor",
            "uTintIntensity",
            "uFlip"
          ];
          for (const n of pbNames) this.uPb[n] = gl.getUniformLocation(this.progressiveBlurProgram, n);
          const cpNames = ["uTexture", "uCanvasSize"];
          for (const n of cpNames) this.uCp[n] = gl.getUniformLocation(this.copyProgram, n);
          const sfNames = ["uColor"];
          for (const n of sfNames) this.uSf[n] = gl.getUniformLocation(this.solidFillProgram, n);
          const ccNames = ["uTexture", "uTexSize", "uBrightness", "uContrast", "uSaturation"];
          for (const n of ccNames) this.uCc[n] = gl.getUniformLocation(this.colorControlsProgram, n);
          const stNames = ["uTexture", "uCanvasSize", "uTintColor"];
          for (const n of stNames) this.uSt[n] = gl.getUniformLocation(this.sceneTintProgram, n);
          const efNames = ["uTexture", "uCanvasSize", "uElementCenter", "uElementSize", "uRotation", "uSrcSize"];
          for (const n of efNames) this.uEf[n] = gl.getUniformLocation(this.elFboCompositeProgram, n);
          const ecNames = ["uTexture", "uSrcOffset", "uSrcSize", "uDstSize"];
          for (const n of ecNames) this.uEc[n] = gl.getUniformLocation(this.elFboCropProgram, n);
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-blur.ts
  function compileBlurPair(gl, tapCount, genShader, errLabel) {
    const mk = (dir) => {
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, genShader(tapCount, dir));
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(errLabel + " (taps=" + tapCount + "," + dir + "): " + log);
      }
      return p;
    };
    const hProg = mk("horizontal");
    const vProg = mk("vertical");
    const uH = {
      uTexture: gl.getUniformLocation(hProg, "uTexture"),
      uTexSize: gl.getUniformLocation(hProg, "uTexSize"),
      uRadius: gl.getUniformLocation(hProg, "uRadius")
    };
    const uV = {
      uTexture: gl.getUniformLocation(vProg, "uTexture"),
      uTexSize: gl.getUniformLocation(vProg, "uTexSize"),
      uRadius: gl.getUniformLocation(vProg, "uRadius")
    };
    return { hProg, vProg, uH, uV, aPosH: 0, aPosV: 0 };
  }
  var blurMethods;
  var init_methods_blur = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-blur.ts"() {
      "use strict";
      init_shaders();
      init_gl_utils();
      blurMethods = {
        /** Lazy-compile horizontal + vertical blur programs for a 1D tap count. */
        ensureBlurPrograms(tapCount) {
          if (this.blurPrograms.has(tapCount)) return;
          this.blurPrograms.set(tapCount, compileBlurPair(this.gl, tapCount, generateSeparableBlurShader, "Blur program link error"));
        },
        /** Pick the downsampled blur FBO level for a given radius.
         *
         *  - dynamicBlurDownsample OFF: returns the MAX-ds level (legacy behavior —
         *    every blur renders into the smallest buffer, maximum speed, lowest
         *    quality for small radii).
         *  - dynamicBlurDownsample ON: picks usedDs = clamp(2^floor(log2(R/6)), 1,
         *    maxLevelDs). Small radii (R≈6px) → ds=1 (full-res, crisp); large radii
         *    (R≈48px+) → ds=maxLevelDs (fast). Falls back to max-ds if the pool is
         *    empty or radius is degenerate.
         *
         *  The returned level's fboA/fboB are sized floor(fboW/level.ds) ×
         *  floor(fboH/level.ds); callers scale radius by 1/level.ds. */
        pickDsBlurLevel(radius) {
          if (!this.dynamicBlurDownsample || this.dsBlurLevels.length === 0) {
            return {
              ds: this.effectiveBlurDownsample || 1,
              fboA: this.dsBlurFboA,
              texA: this.dsBlurFboATex,
              fboB: this.dsBlurFboB,
              texB: this.dsBlurFboBTex,
              w: this.dsBlurFboW || this.fboW,
              h: this.dsBlurFboH || this.fboH
            };
          }
          const levels = this.dsBlurLevels;
          const r = Math.max(0.5, radius);
          const maxDs = levels[levels.length - 1].ds;
          let usedDs = 1;
          if (r >= 6) {
            const exp = Math.floor(Math.log2(r / 6));
            usedDs = Math.pow(2, exp);
          }
          if (usedDs > maxDs) usedDs = maxDs;
          if (usedDs < 1) usedDs = 1;
          for (let i = levels.length - 1; i >= 0; i--) {
            if (levels[i].ds <= usedDs) return levels[i];
          }
          return levels[0];
        },
        /** Shared 2-pass H→V separable blur driver. Renders srcTex blurred by
         *  `radius` px (in the dst FBO's coordinate space — caller has already
         *  scaled to downsampled space if needed) into dstFboA then dstFboB;
         *  returns dstTexB. Saves/restores FBO binding + scissor (enable bit AND
         *  box — the old code only saved the enable bit, leaving the box clobbered).
         *  Disables scissor + blend during the passes (the downsampled FBO coords
         *  don't match the caller's full-res scissor rect — disabling is the fix
         *  for the old "only a small block is normal" downsample bug). */
        runBlurPasses(srcTex, dstFboA, dstTexA, dstFboB, dstTexB, w, h, radius, tapCount, glassMode) {
          const gl = this.gl;
          const tProg0 = performance.now();
          if (glassMode) {
            this.ensureBlurPrograms(tapCount);
          } else {
            this.ensureHighlightBlurPrograms(tapCount);
          }
          const entry = (glassMode ? this.blurPrograms : this.highlightBlurPrograms).get(tapCount);
          const tProg1 = performance.now();
          const tState0 = performance.now();
          const savedFb = this.glStateCached(gl).fb;
          const savedScissor = this.glStateCached(gl).scissor;
          const savedBox = this.glStateCached(gl).box;
          this.scissorTestRaw(gl, false);
          gl.disable(gl.BLEND);
          const tState1 = performance.now();
          const tH0 = performance.now();
          this.bindFbRaw(gl, gl.FRAMEBUFFER, dstFboA);
          gl.viewport(0, 0, w, h);
          gl.useProgram(entry.hProg);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(entry.aPosH);
          gl.vertexAttribPointer(entry.aPosH, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.uniform1i(entry.uH["uTexture"], 0);
          gl.uniform2f(entry.uH["uTexSize"], w, h);
          gl.uniform1f(entry.uH["uRadius"], radius);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          const tH1 = performance.now();
          const tV0 = performance.now();
          this.bindFbRaw(gl, gl.FRAMEBUFFER, dstFboB);
          gl.viewport(0, 0, w, h);
          gl.useProgram(entry.vProg);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(entry.aPosV);
          gl.vertexAttribPointer(entry.aPosV, 2, gl.FLOAT, false, 0, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, dstTexA);
          gl.uniform1i(entry.uV["uTexture"], 0);
          gl.uniform2f(entry.uV["uTexSize"], w, h);
          gl.uniform1f(entry.uV["uRadius"], radius);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          const tV1 = performance.now();
          const tR0 = performance.now();
          this.bindFbRaw(gl, gl.FRAMEBUFFER, savedFb);
          gl.viewport(0, 0, this.fboW, this.fboH);
          if (savedScissor) {
            this.scissorTestRaw(gl, true);
            this.scissorRaw(gl, savedBox[0], savedBox[1], savedBox[2], savedBox[3]);
          }
          const tR1 = performance.now();
          if (this.lastBlurStats) {
            this.lastBlurStats.progMs = tProg1 - tProg0;
            this.lastBlurStats.stateMs = tState1 - tState0 + (tR1 - tR0);
            this.lastBlurStats.drawMs = tH1 - tH0 + (tV1 - tV0);
          }
          return dstTexB;
        },
        /** Blur a source texture by `radius` px. If bbox (srcX/Y/W/H) is given,
         *  crops srcTex to that region and blurs in a bbox-sized FBO (cheap —
         *  fragment work scales with bbox area, not fullscreen). If no bbox,
         *  blurs the full srcTex in the fullscreen dsBlur FBO (used by scene-wide
         *  blur where the "bbox" IS the full screen).
         *
         *  Dispatches to Kawase (2D diagonal) or Gaussian (separable H+V) based
         *  on useKawaseBlur. No 0.6 clamp: radius < 0.5 returns srcTex. */
        blurTexture(srcTex, radius, bbox) {
          if (bbox) {
            this.ensureElementFBO(bbox.w, bbox.h);
            return this.cropAndBlurBackdrop(srcTex, bbox.x, bbox.y, bbox.w, bbox.h, radius);
          }
          if (this.useKawaseBlur) return this.kawaseBlurTexture(srcTex, radius);
          const lvl = this.pickDsBlurLevel(radius);
          const ds = lvl.ds;
          const dsRadius = ds > 1 ? radius / ds : radius;
          if (dsRadius < 0.5) {
            this.lastBlurStats = { type: "gauss", passes: 0, taps: 0, maxSample: 0, w: lvl.w, h: lvl.h, progMs: 0, stateMs: 0, drawMs: 0 };
            return srcTex;
          }
          let taps = computeBlur1DTapCount(dsRadius);
          taps = Math.min(taps, Math.max(1, this.blurTapCap | 0));
          this.lastBlurStats = { type: "gauss", passes: 2, taps, maxSample: 3 * dsRadius, w: lvl.w, h: lvl.h, progMs: 0, stateMs: 0, drawMs: 0 };
          return this.runBlurPasses(
            srcTex,
            lvl.fboA,
            lvl.texA,
            lvl.fboB,
            lvl.texB,
            lvl.w,
            lvl.h,
            dsRadius,
            taps,
            true
          );
        },
        /** Lazy-compile the Kawase blur program (single 2D program, not H+V pair).
         *  Kawase is NOT separable — one pass per iteration samples 4 diagonal
         *  points. One program serves all iterations via uIteration/uTotalIters. */
        ensureKawaseProgram() {
          if (this.kawasePrograms) return;
          const gl = this.gl;
          const fs = compileShader(gl, gl.FRAGMENT_SHADER, generateKawaseBlurShader());
          const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
          const p = gl.createProgram();
          gl.attachShader(p, vs);
          gl.attachShader(p, fs);
          gl.bindAttribLocation(p, 0, "aPos");
          gl.linkProgram(p);
          gl.deleteShader(vs);
          gl.deleteShader(fs);
          if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(p);
            gl.deleteProgram(p);
            throw new Error("Kawase program link error: " + log);
          }
          this.kawasePrograms = {
            prog: p,
            uTexture: gl.getUniformLocation(p, "uTexture"),
            uTexSize: gl.getUniformLocation(p, "uTexSize"),
            uRadius: gl.getUniformLocation(p, "uRadius"),
            uIteration: gl.getUniformLocation(p, "uIteration"),
            uTotalIters: gl.getUniformLocation(p, "uTotalIters"),
            aPos: 0
          };
        },
        /** Kawase blur: N iterations of 2D 4-tap diagonal, ping-pong between
         *  fboA and fboB. Each iter is ONE pass (not H+V — Kawase is not separable).
         *  Iter 0: srcTex → fboA. Iter 1: texA → fboB. Iter 2: texB → fboA. ...
         *  Result ends in the buffer that the last iter wrote to.
         *
         *  radius < 0.5 → return srcTex (no blur). */
        kawaseBlurTexture(srcTex, radius) {
          const lvl = this.pickDsBlurLevel(radius);
          const ds = lvl.ds;
          const dsRadius = ds > 1 ? radius / ds : radius;
          if (dsRadius < 0.5) {
            this.lastBlurStats = { type: "kawase", passes: 0, taps: 0, maxSample: 0, w: lvl.w, h: lvl.h, progMs: 0, stateMs: 0, drawMs: 0 };
            return srcTex;
          }
          const iters = kawaseIterationsForRadius(dsRadius, this.kawaseQuality);
          const dMax = dsRadius * Math.sqrt(6 * iters / ((iters + 1) * (2 * iters + 1)));
          this.lastBlurStats = { type: "kawase", passes: iters, taps: 4 * iters, maxSample: dMax * Math.SQRT2, w: lvl.w, h: lvl.h, progMs: 0, stateMs: 0, drawMs: 0 };
          const tProg0 = performance.now();
          this.ensureKawaseProgram();
          const kp = this.kawasePrograms;
          const tProg1 = performance.now();
          const tState0 = performance.now();
          const gl = this.gl;
          const w = lvl.w, h = lvl.h;
          const savedFb = this.glStateCached(gl).fb;
          const savedScissor = this.glStateCached(gl).scissor;
          const savedBox = this.glStateCached(gl).box;
          this.scissorTestRaw(gl, false);
          gl.disable(gl.BLEND);
          const tState1 = performance.now();
          const tDraw0 = performance.now();
          let curSrc = srcTex;
          for (let i = 0; i < iters; i++) {
            const writeFboA = i % 2 === 0;
            const dstFbo = writeFboA ? lvl.fboA : lvl.fboB;
            this.bindFbRaw(gl, gl.FRAMEBUFFER, dstFbo);
            gl.viewport(0, 0, w, h);
            gl.useProgram(kp.prog);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.enableVertexAttribArray(kp.aPos);
            gl.vertexAttribPointer(kp.aPos, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, curSrc);
            gl.uniform1i(kp.uTexture, 0);
            gl.uniform2f(kp.uTexSize, w, h);
            gl.uniform1f(kp.uRadius, dsRadius);
            gl.uniform1f(kp.uIteration, i);
            gl.uniform1f(kp.uTotalIters, iters);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            curSrc = writeFboA ? lvl.texA : lvl.texB;
          }
          const tDraw1 = performance.now();
          const tR0 = performance.now();
          this.bindFbRaw(gl, gl.FRAMEBUFFER, savedFb);
          gl.viewport(0, 0, this.fboW, this.fboH);
          if (savedScissor) {
            this.scissorTestRaw(gl, true);
            this.scissorRaw(gl, savedBox[0], savedBox[1], savedBox[2], savedBox[3]);
          }
          const tR1 = performance.now();
          this.lastBlurStats.progMs = tProg1 - tProg0;
          this.lastBlurStats.stateMs = tState1 - tState0 + (tR1 - tR0);
          this.lastBlurStats.drawMs = tDraw1 - tDraw0;
          const lastWroteA = (iters - 1) % 2 === 0;
          return lastWroteA ? lvl.texA : lvl.texB;
        },
        /** Lazy-compile highlight blur programs (alpha-blurring, sigma semantics).
         *  Separate from ensureBlurPrograms because the shader is different
         *  (blurs alpha, no early-return, integer-σ-spaced taps). */
        ensureHighlightBlurPrograms(tapCount) {
          if (this.highlightBlurPrograms.has(tapCount)) return;
          this.highlightBlurPrograms.set(tapCount, compileBlurPair(this.gl, tapCount, generateHighlightBlurShader, "Highlight blur program link error"));
        },
        /** 2-pass Gaussian blur on a highlight stroke MASK (alpha only).
         *  Faithful to Android BlurMaskFilter(NORMAL, sigma):
         *    - sigma = blurRadiusPx (the Android radius param IS sigma)
         *    - convolves the mask's ALPHA with a Gaussian kernel
         *    - sub-pixel sigma (0.25px) still blurs (no 0.5 early-return)
         *  No 0.05 clamp: sigma < 0.01 returns srcTex (no blur). */
        blurHighlightMask(srcTex, sigmaPx) {
          const lvl = this.pickDsBlurLevel(sigmaPx);
          const ds = lvl.ds;
          const dsSigma = ds > 1 ? sigmaPx / ds : sigmaPx;
          if (dsSigma < 0.01) return srcTex;
          let taps = computeHighlightBlurTapCount(dsSigma);
          taps = Math.min(taps, Math.max(3, this.blurTapCap | 0));
          return this.runBlurPasses(
            srcTex,
            lvl.fboA,
            lvl.texA,
            lvl.fboB,
            lvl.texB,
            lvl.w,
            lvl.h,
            dsSigma,
            taps,
            false
          );
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-dispose.ts
  var disposeMethods;
  var init_methods_dispose = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/methods-dispose.ts"() {
      "use strict";
      init_inner_shadow_cache();
      disposeMethods = {
        dispose() {
          if (this.rafId !== null) cancelAnimationFrame(this.rafId);
          this.rafId = null;
          if (this.animRafId !== null) cancelAnimationFrame(this.animRafId);
          this.animRafId = null;
          const gl = this.gl;
          if (this.wallpaperTexture) gl.deleteTexture(this.wallpaperTexture);
          for (const tex of this.fgTextures.values()) gl.deleteTexture(tex);
          this.fgTextures.clear();
          for (const entry of this.strokeMaskCache.values()) gl.deleteTexture(entry.tex);
          this.strokeMaskCache.clear();
          destroyCache(gl, this.innerShadowMaskCache);
          if (this.fboA) gl.deleteFramebuffer(this.fboA);
          if (this.fboATex) gl.deleteTexture(this.fboATex);
          if (this.fboB) gl.deleteFramebuffer(this.fboB);
          if (this.fboBTex) gl.deleteTexture(this.fboBTex);
          this.fboA = this.fboB = null;
          this.fboATex = this.fboBTex = null;
          if (this.tabsBackdropFbo) gl.deleteFramebuffer(this.tabsBackdropFbo);
          if (this.tabsBackdropTex) gl.deleteTexture(this.tabsBackdropTex);
          this.tabsBackdropFbo = null;
          this.tabsBackdropTex = null;
          if (this.wallpaperBlurFbo) gl.deleteFramebuffer(this.wallpaperBlurFbo);
          if (this.wallpaperBlurTex) gl.deleteTexture(this.wallpaperBlurTex);
          if (this.blurFboA) gl.deleteFramebuffer(this.blurFboA);
          if (this.blurFboATex) gl.deleteTexture(this.blurFboATex);
          if (this.blurFboB) gl.deleteFramebuffer(this.blurFboB);
          if (this.blurFboBTex) gl.deleteTexture(this.blurFboBTex);
          if (this.dsBlurFboA) gl.deleteFramebuffer(this.dsBlurFboA);
          if (this.dsBlurFboATex) gl.deleteTexture(this.dsBlurFboATex);
          if (this.dsBlurFboB) gl.deleteFramebuffer(this.dsBlurFboB);
          if (this.dsBlurFboBTex) gl.deleteTexture(this.dsBlurFboBTex);
          for (const lvl of this.dsBlurLevels) {
            gl.deleteFramebuffer(lvl.fboA);
            gl.deleteTexture(lvl.texA);
            gl.deleteFramebuffer(lvl.fboB);
            gl.deleteTexture(lvl.texB);
          }
          this.dsBlurLevels = [];
          this.wallpaperBlurFbo = this.blurFboA = this.blurFboB = this.dsBlurFboA = this.dsBlurFboB = null;
          this.wallpaperBlurTex = this.blurFboATex = this.blurFboBTex = this.dsBlurFboATex = this.dsBlurFboBTex = null;
          if (this.highlightMaskFbo) gl.deleteFramebuffer(this.highlightMaskFbo);
          if (this.highlightMaskTex) gl.deleteTexture(this.highlightMaskTex);
          this.highlightMaskFbo = null;
          this.highlightMaskTex = null;
          if (this.dialogBackdropFbo) gl.deleteFramebuffer(this.dialogBackdropFbo);
          if (this.dialogBackdropTex) gl.deleteTexture(this.dialogBackdropTex);
          this.dialogBackdropFbo = null;
          this.dialogBackdropTex = null;
          this.dialogBackdropKey = null;
          if (this.bgOnlyFbo) gl.deleteFramebuffer(this.bgOnlyFbo);
          if (this.bgOnlyTex) gl.deleteTexture(this.bgOnlyTex);
          this.bgOnlyFbo = null;
          this.bgOnlyTex = null;
          if (this.elFbo) gl.deleteFramebuffer(this.elFbo);
          if (this.elFboTex) gl.deleteTexture(this.elFboTex);
          this.elFbo = null;
          this.elFboTex = null;
          this.elFboW = this.elFboH = 0;
          if (this.backdropCropFbo) gl.deleteFramebuffer(this.backdropCropFbo);
          if (this.backdropCropTex) gl.deleteTexture(this.backdropCropTex);
          this.backdropCropFbo = null;
          this.backdropCropTex = null;
          if (this.elBlurFboA) gl.deleteFramebuffer(this.elBlurFboA);
          if (this.elBlurFboATex) gl.deleteTexture(this.elBlurFboATex);
          if (this.elBlurFboB) gl.deleteFramebuffer(this.elBlurFboB);
          if (this.elBlurFboBTex) gl.deleteTexture(this.elBlurFboBTex);
          this.elBlurFboA = this.elBlurFboB = null;
          this.elBlurFboATex = this.elBlurFboBTex = null;
          for (const e of this.elFboCache.values()) {
            gl.deleteFramebuffer(e.fb);
            gl.deleteTexture(e.tex);
          }
          this.elFboCache.clear();
          for (const { hProg, vProg } of this.blurPrograms.values()) {
            gl.deleteProgram(hProg);
            gl.deleteProgram(vProg);
          }
          this.blurPrograms.clear();
          for (const { hProg, vProg } of this.highlightBlurPrograms.values()) {
            gl.deleteProgram(hProg);
            gl.deleteProgram(vProg);
          }
          this.highlightBlurPrograms.clear();
          if (this.kawasePrograms) {
            gl.deleteProgram(this.kawasePrograms.prog);
            this.kawasePrograms = null;
          }
          for (const entry of this.backdropBlurCache.values()) {
            gl.deleteTexture(entry.tex);
            gl.deleteFramebuffer(entry.fb);
          }
          this.backdropBlurCache.clear();
          for (const p of this.backdropBlurCacheFboPool) {
            gl.deleteTexture(p.tex);
            gl.deleteFramebuffer(p.fb);
          }
          this.backdropBlurCacheFboPool.length = 0;
          if (this.cacheCopyReadFbo) {
            gl.deleteFramebuffer(this.cacheCopyReadFbo);
            this.cacheCopyReadFbo = null;
          }
          if (this.sdfTexture) gl.deleteTexture(this.sdfTexture);
          this.sdfTexture = null;
          if (this.textSdfTexture) gl.deleteTexture(this.textSdfTexture);
          this.textSdfTexture = null;
          for (const { tex } of this.continuousSdfPool.values()) gl.deleteTexture(tex);
          this.continuousSdfPool.clear();
          this.continuousSdfTexture = null;
          this.continuousSdfKey = null;
          this._debugUploadedSdfTexMap.clear();
          gl.deleteProgram(this.elementProgram);
          gl.deleteProgram(this.shadowProgram);
          gl.deleteProgram(this.wallpaperProgram);
          gl.deleteProgram(this.foregroundProgram);
          gl.deleteProgram(this.highlightProgram);
          gl.deleteProgram(this.tintProgram);
          gl.deleteProgram(this.rimHighlightProgram);
          gl.deleteProgram(this.highlightStrokeProgram);
          gl.deleteProgram(this.highlightCompositeProgram);
          gl.deleteProgram(this.strokeMaskCompositeProgram);
          gl.deleteProgram(this.innerShadowMaskCompositeProgram);
          gl.deleteProgram(this.plainRectProgram);
          gl.deleteProgram(this.progressiveBlurProgram);
          gl.deleteProgram(this.copyProgram);
          gl.deleteProgram(this.solidFillProgram);
          gl.deleteProgram(this.colorControlsProgram);
          gl.deleteProgram(this.sceneTintProgram);
          gl.deleteProgram(this.elFboCompositeProgram);
          gl.deleteProgram(this.elFboCropProgram);
          gl.deleteBuffer(this.quadBuffer);
        }
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/index.ts
  var LiquidGlassRenderer;
  var init_renderer = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/renderer/index.ts"() {
      "use strict";
      "use client";
      init_shaders();
      init_gl_utils();
      init_perf_monitor();
      init_methods_fbo();
      init_methods_wallpaper();
      init_methods_scroll();
      init_methods_toggle();
      init_methods_tabs();
      init_methods_elements();
      init_methods_animation();
      init_methods_raster();
      init_methods_render();
      init_methods_render_background();
      init_methods_render_nonglass();
      init_methods_render_nonglass_plain_rect();
      init_methods_render_nonglass_text();
      init_methods_render_nonglass_progressive_blur();
      init_methods_render_glass();
      init_methods_render_glass_element_pass();
      init_methods_render_glass_post_passes();
      init_methods_dirty();
      init_methods_debug();
      init_methods_uniforms();
      init_methods_blur();
      init_methods_dispose();
      LiquidGlassRenderer = class {
        constructor(canvas) {
          this.wallpaperTexture = null;
          this.wallpaperReady = false;
          this.wallpaperSize = [1, 1];
          this.dpr = 0;
          // 0 = not yet set; resize() sets default cap on first call
          this.buttonConfigs = [];
          this.buttonStates = /* @__PURE__ */ new Map();
          /** Toggle group state — keyed by groupId. Faithful port of DampedDragAnimation.kt. */
          this.toggleStates = /* @__PURE__ */ new Map();
          this.scrollY = 0;
          this.scrollVelocity = 0;
          this.contentHeight = 0;
          this.cssWidth = 0;
          this.cssHeight = 0;
          this.wheelTarget = null;
          this.backgroundColor = null;
          /** PERFORMANCE: Dirty flag — set by any state change that requires a redraw.
           *  render() checks this and early-exits if false, avoiding redundant
           *  full-scene re-render when requestAnimationFrame fires but nothing changed. */
          this.needsRedraw = true;
          /** Event-driven per-element dirty tracking. Instead of hashing every
           *  element's visual state each frame, dirty status is marked at the source:
           *  setters (setPressed, setInteractiveValue, setScrollY, ...) and the spring
           *  animation tick call markElementDirty(id) / markAllDirty(). The render loop
           *  reads this set to count dirty elements (for the perf monitor) and to draw
           *  debug markers, then clears it. When nothing is dirty AND needsRedraw is
           *  false, no render happens at all (the rAF doesn't fire).
           *
           *  allDirty: set by global changes (wallpaper loaded, quickToggles flipped,
           *  element list rebuilt). Makes every element count as dirty for one frame. */
          this.dirtyElementIds = /* @__PURE__ */ new Set();
          this.allDirty = true;
          /** Debug overlay: when true, draw a colored border (green=clean, red=dirty)
           *  + a blinking red dot on dirty elements. The dot flashes ~30Hz and the
           *  whole overlay disappears when idle. Toggled from the perf-monitor
           *  overlay. */
          this.showDirtyMarkers = false;
          /** Debug overlay data — the dirty status of each element this frame,
           *  pushed during render() for the overlay to read. "dirty" here means
           *  "this element actually re-rasterized its glass body this frame"
           *  (cache MISS), NOT merely "was event-marked dirty". With the event-
           *  driven + signature-diff cache scheme, an element can be re-rasterized
           *  without being in dirtyElementIds (e.g. position changed → elFboCache
           *  position check misses → re-rasterize). The marker reflects the TRUE
           *  GPU work, which is what the user wants to see during optimization.
           *
           *  LIFECYCLE: cleared at the start of each render(), repopulated during
           *  the element loop, then CONSUMED (length=0) by the overlay's rAF after
           *  drawing. This means the list is non-empty only on rAF ticks that
           *  immediately follow a render — idle frames see an empty list and draw
           *  nothing, which is how the "no stale red when idle" behavior works. */
          this.debugDirtyMarkers = [];
          /** Internal scratch slot — set by renderGlassElementPerFbo to indicate
           *  whether the just-rendered glass element hit its elFboCache (true =
           *  cached, no glass-body re-raster). Read by the render() main loop to
           *  populate debugDirtyMarkers. Only valid between renderGlassElement()
           *  return and the next element's render. */
          this._dbgLastGlassCacheHit = false;
          /** Frame-local list of screen-space rects (CSS px, top-left origin) whose
           *  curFbo pixels changed this frame. Any element that actually re-rasterizes
           *  (glass cache MISS, dirty non-glass redraw, ping-pong path) pushes its
           *  inflated output rect here. Non-independent glass elements check this list
           *  in their elFboCache hit test — if no dirty rect overlaps the element's
           *  backdrop sampling region, the cached glass body is still valid and can be
           *  composited without re-rasterizing the backdrop blur. This is SPATIAL, not
           *  global: a tab bar animating on the left does NOT invalidate a static bar
           *  on the right, because their rects don't overlap.
           *
           *  Each entry carries a `source` tag identifying WHO pushed it:
           *    'all_dirty'      — markAllDirty() fired (global invalidation)
           *    'scroll'         — scrollY changed (scrolling elements moved)
           *    'glass:<id>'     — glass element <id> cache-missed (re-rasterized)
           *    'nonglass:<id>'  — non-glass element <id> was event-dirty
           *    'pingpong:<id>'  — glass element <id> on ping-pong path (PEF off)
           *  This source is surfaced in the debugCacheMissLog reason as
           *  `backdrop_overlap:<source>` so you can see EXACTLY which element or
           *  global event caused a non-independent element to miss its cache. */
          this.dirtyRectsThisFrame = [];
          /** Last frame's scrollY — when it changes, scrolling elements move and every
           *  non-independent element whose backdrop overlaps them must re-rasterize.
           *  Represented by pushing a full-screen rect into dirtyRectsThisFrame. */
          this.lastRenderedScrollY = 0;
          /** Debug trace: per-element cache MISS reason, populated during render when
           *  showDirtyMarkers is on. Each entry = { id, reason, x, y } so the overlay
           *  can draw the reason text next to the element's bbox. Reasons:
           *    'no_entry'           — first render, cache not yet populated
           *    'size_mismatch'      — w/h changed (scroll/scale moved elFboRect)
           *    'position_mismatch'  — ex0/ey0Top changed (element moved)
           *    'invalidated'        — entry.valid=false (markElementDirty/markAllDirty)
           *    'wallpaper_version'  — wallpaper reloaded
           *    'dpr'                — devicePixelRatio changed
           *    'backdrop_overlap:<source>' — a dirtyRect overlaps this element's
           *      backdrop. <source> identifies WHO pushed the overlapping rect:
           *      all_dirty / scroll / glass:<id> / nonglass:<id> / pingpong:<id>
           *    'non_cacheable'      — cacheable=false (no wallpaper / backdropFbo / SDF)
           *    'ping_pong'          — PEF toggle off, ping-pong path (never cached) */
          this.debugCacheMissLog = [];
          /** Debug trace: who called markElementDirty, populated when showDirtyMarkers
           *  is on. Each entry = { id, source } where source is the caller's caller
           *  function name (best-effort via stack parse). Helps answer "why is this
           *  element dirty every frame when nothing changed?" */
          this.debugDirtySourceLog = [];
          // --- Scene FBO ping-pong infrastructure ---
          // See render() for the full ping-pong pipeline description.
          this.fboA = null;
          this.fboATex = null;
          this.fboB = null;
          this.fboBTex = null;
          this.fboW = 0;
          this.fboH = 0;
          // --- tabsBackdrop FBO (indicator's hidden tinted layer) ---
          // Faithful to LiquidBottomTabs.kt: the indicator's backdrop is
          //   rememberCombinedBackdrop(backdrop, tabsBackdrop)
          // where tabsBackdrop is a HIDDEN Row (alpha=0) that captures the container
          // glass + tab content with ColorFilter.tint(accentColor). We render the
          // current scene (container+tabs already drawn) into this FBO, apply a blue
          // tint pass, then the indicator shader samples it as the second backdrop
          // layer (composited over wallpaper).
          this.tabsBackdropFbo = null;
          this.tabsBackdropTex = null;
          this.tabsBackdropDirty = true;
          // --- Separable 2-pass blur infrastructure (Glass Playground only) ---
          // wallpaperBlurFbo: element pass renders here (refraction on CLEAR backdrop,
          // uBlurRadius=0) for useSeparableBlur elements. Transparent background;
          // the element shader's discard leaves only the glass shape's refracted content.
          // blurFboA/blurFboB: FULL-RES scratch ping-pong. Used by the dialog backdrop
          //   colorControls pass (methods-render.ts) which needs a full-res temp buffer
          //   (bindFBO + drawColorControls both assume fboW×fboH). NOT used by
          //   blurTexture — must stay full-res to avoid the downsample viewport
          //   mismatch that broke dialog backdrops (only a small corner was written,
          //   the rest stayed transparent).
          // dsBlurFboA/dsBlurFboB: LEGACY downsampled ping-pong pair, sized
          //   floor(fboW/effectiveDs) × floor(fboH/effectiveDs) (RAW ds, NOT pow2-
          //   clamped). Used by the OFF path of blurTexture/blurHighlightMask (and as
          //   the empty-pool fallback) so OFF matches the pre-dynamic OLD behavior
          //   exactly. The ON path uses the dsBlurLevels pool instead. Half-res pixels
          //   are ds× wider, so radius is scaled by 1/ds to preserve the visual blur
          //   radius while cutting fragment invocations by ds².
          this.wallpaperBlurFbo = null;
          this.wallpaperBlurTex = null;
          this.blurFboA = null;
          this.blurFboATex = null;
          this.blurFboB = null;
          this.blurFboBTex = null;
          this.dsBlurFboA = null;
          this.dsBlurFboATex = null;
          this.dsBlurFboB = null;
          this.dsBlurFboBTex = null;
          // --- Highlight mask FBO (3-pass faithful highlight) ---
          // Pass 1: HIGHLIGHT_STROKE_FRAGMENT_SHADER renders the clipped stroke alpha
          //   mask here (transparent surround, alpha=1 in the stroke band).
          // Pass 2: blurHighlightMask(highlightMaskTex, sigma) → dsBlurFboB (2-pass
          //   Gaussian, faithful to Skia BlurMaskFilter NORMAL).
          // Pass 3: HIGHLIGHT_COMPOSITE_FRAGMENT_SHADER samples dsBlurFboB, multiplies
          //   by intensity+color, blends into the scene FBO.
          this.highlightMaskFbo = null;
          this.highlightMaskTex = null;
          // --- Dialog backdrop FBO ---
          // Holds wallpaper+scrim+colorControls as one opaque layer for the dialog
          // card's 2-pass blur path. Rendered by renderDialogBackdrop; the dialog card
          // (backdropFbo=true + useSeparableBlur) samples this via 2-pass blur.
          this.dialogBackdropFbo = null;
          this.dialogBackdropTex = null;
          /** Cache key for dialogBackdropFbo (scrim+cc params) — skip re-render if unchanged. */
          this.dialogBackdropKey = null;
          /** "Background-only" FBO — a parallel scene buffer that contains ONLY
           *  wallpaper + non-glass elements (never glass). When the
           *  `isolateBackdrop` quick-toggle is on, glass elements sample THIS
           *  texture instead of curTex, so they don't refract other glass — only
           *  the wallpaper + non-glass UI behind them. Lazily created in
           *  renderGlassElement when isolateBackdrop is first enabled; resized
           *  with the main FBOs. */
          this.bgOnlyFbo = null;
          this.bgOnlyTex = null;
          /** Blur shader variants keyed by 1D tap count (H + V programs each). */
          this.blurPrograms = /* @__PURE__ */ new Map();
          /** Highlight blur programs — separate from blurPrograms because these blur
           *  ALPHA (mask), use Android BlurMaskFilter sigma semantics (uRadius=sigma),
           *  and support sub-pixel sigma (no 0.5 early-return). */
          this.highlightBlurPrograms = /* @__PURE__ */ new Map();
          /** Kawase blur program (single 2D program — not separable, no H+V pair).
           *  One program serves all iterations via uIteration/uTotalIters uniforms.
           *  Lazily compiled by ensureKawaseProgram. Used when useKawaseBlur is on. */
          this.kawasePrograms = null;
          /** Use Kawase blur (4-tap tent-filter, N iterations) instead of the
           *  Gaussian separable path. Kawase is cheaper for large radii. Set from
           *  CatalogState.useKawaseBlur via use-renderer-prop-sync. Default true. */
          this.useKawaseBlur = true;
          /** Blur cache toggle. When true (default), resolveBackdropTex caches
           *  blurred backdrop textures (per-radius for wallpaper, per-element+radius
           *  for scene) so repeated frames at the same radius hit the cache (0 blur
           *  cost). When false, the cache lookup + store are skipped — every frame
           *  re-blurs from scratch. Toggling off also clears the existing cache. */
          this.useBlurCache = true;
          /** Kawase quality multiplier [0, 1], default 1.0 (full base iter count).
           *  Scales the iteration count (from kawaseIterationsForRadius) before
           *  clamping to [2, 8]. 0 = min iters (fastest), 1 = base iter count.
           *  Set from CatalogState.kawaseQuality. */
          this.kawaseQuality = 1;
          /** Gravity angle for glass highlight direction, in RADIANS. Updated live via
           *  setGravityAngle (no catalog rebuild). Default 45° = 0.785 rad.
           *  Elements with useGravityAngle=true read this at render time. */
          this.gravityAngle = 45 * Math.PI / 180;
          /** Max 1D taps per blur pass (1..33). Lower = faster, Higher = better quality.
           *  Set from CatalogState.blurTapCap. Default 9. */
          this.blurTapCap = 9;
          /** Blur downsample factor (float, slider range 1–8). Higher = much faster
           *  but lower quality. Set from CatalogState.blurDownsample. The downsampled
           *  blur FBOs (dsBlurFboA/dsBlurFboB) are sized floor(fboW/effectiveDs) ×
           *  floor(fboH/effectiveDs) where effectiveDs = blurDownsample × dpr. */
          this.blurDownsample = 4;
          /** Actual device-px size of dsBlurFboA/dsBlurFboB (= floor(fboW/effectiveBlurDownsample)).
           *  Set by resizeFBOs. blurTexture/blurHighlightMask viewport + uTexSize use
           *  THIS (not fboW/fboH) so the blur renders into the downsampled FBO. */
          this.dsBlurFboW = 0;
          this.dsBlurFboH = 0;
          /** DPR-adapted effective downsample factor = blurDownsample × dpr, clamped
           *  to [1, 64]. Set by resizeFBOs. blurTexture/blurHighlightMask use THIS
           *  (not the raw blurDownsample) to scale radius — otherwise radius/ds and
           *  the blur FBO size (which uses effectiveDs) mismatch → wrong visual radius.
           *
           *  Why adapt to DPR: blurDownsample (slider, range 1–8) is the user's
           *  quality choice relative to CSS (display) pixels. On a DPR=2 device,
           *  fboW = CSS×2, so raw ds=1 would produce blurFbo = CSS (already full
           *  display res — no actual quality loss). To make the same slider position
           *  produce the same VISUAL quality across devices, the blur FBO must be
           *  sized relative to CSS pixels: effectiveDs = rawDs × dpr →
           *  blurFbo = fboW / (rawDs×dpr) = CSS / rawDs. Now ds=4 always gives
           *  blurFbo = CSS/4 regardless of DPR.
           *
           *  Max clamp 64: prevents absurdly tiny FBOs at extreme slider (8) ×
           *  high DPR (8+) = 64. No min clamp — the slider min (1, full-res) is the
           *  floor and DPR ≥ 1 so effectiveDs ≥ 1 always. */
          this.effectiveBlurDownsample = 4;
          /** Dynamic blur downsample toggle (Settings). When ON, blurTexture/
           *  blurHighlightMask pick the downsample factor PER CALL based on the blur
           *  radius: small radii use a low-ds (high-quality) buffer, large radii use a
           *  high-ds (fast) buffer. This keeps small-radius glass crisp (no half-res
           *  pixelation) while still cutting fragment invocations on big blurs.
           *
           *  Implementation: a small pool of dsBlurFboA/B pairs at power-of-two ds
           *  levels {1, 2, 4, ..., largestPow2 ≤ effectiveBlurDownsample} is created in
           *  resizeFBOs. pickDsBlurLevel(radius) selects the level:
           *    usedDs = clamp(2^floor(log2(radius / 6)), 1, maxLevelDs)
           *  so radius=6px → ds=1, 12px → ds=2, 24px → ds=4, 48px → ds=8.
           *
           *  When OFF (default), the legacy behavior is used: every blur call renders
           *  into the SINGLE legacy dsBlurFboA/B pair with ds = effectiveBlurDownsample
           *  (RAW value, including non-pow2 like 6/12 — matches OLD exactly, so OFF
           *  never silently rounds the ds up to a pow2). */
          this.dynamicBlurDownsample = false;
          /** Pool of downsampled blur FBO pairs at power-of-two ds levels, populated
           *  by resizeFBOs. Index 0 is always ds=1 (full-res, largest), last index is
           *  the max pow2 ds (≤ effectiveBlurDownsample, smallest). blurTexture/
           *  blurHighlightMask pick from this pool ONLY when dynamicBlurDownsample is
           *  ON. When OFF, they bypass the pool and use the separate legacy
           *  dsBlurFboA/B pair below (sized at RAW effectiveDs, not pow2-clamped) so
           *  the buffer resolution + radius scaling match the pre-dynamic OLD path. */
          this.dsBlurLevels = [];
          /** Corner style: 0 = circular, 1 = continuous (squircle). Set from
           *  CatalogState.capsuleShape. Default 1 (Continuous, matching original). */
          this.cornerStyle = 1;
          /** Capsule SDF texture quality coefficient [0.25, 1.0]. Scales the base
           *  texSize (2× oversampling rounded up to POT, clamped [128,1024]) by this
           *  factor, then Math.ceil'd. Default 0.5 (halves texSize). When this
           *  changes, context.tsx clears the GPU pool + CPU maskCache + marks all
           *  elFbos dirty so new textures are generated at the new resolution.
           *  See generateContinuousCurvatureMask + loadContinuousSdf. */
          this.capsuleSdfQuality = 0.5;
          /** "Disable smooth-corner SDF" toggle (Settings) — controls ONLY the G
           *  channel (refraction SDF), NOT the R channel (clip/edgeAA coverage).
           *  When true (default): generate an R-only texture — skip the G-channel
           *  chamfer distance transform (forward + backward passes, the most
           *  CPU-expensive part of generateContinuousCurvatureMask). The texture is
           *  still generated, uploaded, and bound; uUseContinuousSdf=1.0 so
           *  sampleClipMask (clip + edgeAA, reads R) still gets pixel-perfect G2
           *  Bezier corners. The shader's uNoContinuousSdfInRefraction=1 forces
           *  sdShape (refraction/lens, reads G) to use analytic sdRoundedRect, so the
           *  skipped G is never sampled. Saves ~half the per-element SDF generation
           *  CPU on large elements (512²/1024²) while keeping capsule-shape corners.
           *  When false: full R+G texture; sdShape samples G for G2 curvature in the
           *  refraction/lens body (when capsuleShape is ON). loadContinuousSdf reads
           *  this flag to pass skipSdf to generateContinuousCurvatureMask + include
           *  it in the pool key. The GPU texture pool + CPU mask cache are cleared by
           *  context.tsx when the toggle flips (either direction) since the skipSdf
           *  flag changes the cache key. */
          this.noContinuousSdf = true;
          /** "Direct backdrop sample" toggle (Settings, default true). When true,
           *  glass elements that use the LayerBackdrop semantic in the original
           *  Android source (buttons, glass shapes, back/theme buttons — i.e. those
           *  with `independentBackdrop` set, OR eligible elements when this flag is
           *  on) sample the CLEAN wallpaper directly instead of the accumulated scene
           *  (curTex). computeElementTransform ORs this flag into the `independent`
           *  computation so toggling is live (no catalog rebuild needed).
           *
           *  Benefits: elFbo cache HIT every frame on static pages (the
           *  backdrop_overlap cache-miss check is skipped for independent elements),
           *  no invalidation cascade when one glass element moves, lower GPU/CPU
           *  usage. Matches the original where LayerBackdrop = wallpaper via
           *  RenderEffect (glass elements don't refract each other).
           *
           *  Elements with their own backdrop semantics are NOT affected:
           *    - CombinedBackdrop (toggle/slider knob, bottom-tab indicator) — they
           *      have shouldUseSeparableBlur()=false and sample wallpaper+track inline.
           *    - sampleWallpaper elements (dialog card, magnifier) — explicit flag.
           *    - backdropFbo elements — use their own dialogBackdropTex.
           *  On solid-background pages (Home/Settings/About), `independent` is forced
           *  false anyway (no wallpaper to sample), so this flag is a no-op there. */
          this.directBackdropSample = true;
          /** Per-element FBO optimization toggle (Settings). When true, each glass
           *  element renders into a small bbox-sized FBO instead of a fullscreen
           *  ping-pong blit. See methods-render-glass.ts.
           *  NOTE: this field is seeded from CatalogState.usePerElementFbo and also
           *  mirrored into quickToggles.perElementFbo (the live runtime gate) by
           *  context.tsx. The render path checks quickToggles.perElementFbo, not
           *  this field, so the perf-monitor toggle can override it live. */
          this.usePerElementFbo = false;
          /** Quick power-saving toggles — exposed live via the performance monitor
           *  overlay (NOT persisted to settings). Each flag gates a specific heavy
           *  GPU path so the user can isolate cost during a power-consumption
           *  investigation. When a flag is `false`, that path is skipped entirely
           *  for every element on the next frame (requestRender is called by the
           *  overlay when a flag flips so needsRedraw is set).
           *
           *  - highlight:     skip the Canvas2D mask + 3-pass highlight composite
           *                   (rim/stroke/blur). This is one of the most expensive
           *                   per-element paths due to per-frame Canvas2D rasterization.
           *  - backdropBlur:  skip the 2-pass separable Gaussian on the backdrop
           *                   (useSeparableBlur elements with blurRadius >= 0.5).
           *                   Saves 2 fullscreen-equivalent blur passes per element.
           *  - chromatic:     force uChromaticAberration=0 in the element pass
           *                   (removes the extra RGB-channel texture samples).
           *  - refraction:    force uRefractionHeight=0 and uRefractionAmount=0
           *                   (the lens distortion offset disappears, glass becomes
           *                   a flat tinted layer — much cheaper shader math).
           *  - outerShadow:   skip the outer drop-shadow pass entirely.
           *  - innershadow:   skip the inner shadow pass (Canvas2D ring-mask
           *                   generation + composite). The mask is cached, but the
           *                   composite draw still costs a fullscreen-equivalent pass.
           *  - perElementFbo: sole runtime gate for the per-element FBO path.
           *                   Seeded from CatalogState.usePerElementFbo (settings)
           *                   via context.tsx on mount + when settings changes.
           *                   The perf-monitor toggle can override it live — when
           *                   false, all glass elements fall back to the legacy
           *                   fullscreen ping-pong blit. Default false (matches the
           *                   settings default).
           *
           *  All flags default to `true` (full quality) EXCEPT perElementFbo which
           *  defaults to `false` to match the settings default. */
          this.quickToggles = {
            highlight: true,
            backdropBlur: true,
            chromatic: true,
            refraction: true,
            outerShadow: true,
            innershadow: true,
            perElementFbo: false,
            isolateBackdrop: false
          };
          /** True when the WebGL context is backed by a SOFTWARE rasterizer
           *  (SwiftShader / llvmpipe / Mesa softpipe / Apple software renderer).
           *  On software renderers every draw call burns CPU (not GPU), and the
           *  browser's "GPU process" is actually a heavy CPU process that stays
           *  alive as long as the context exists. This is the single biggest
           *  hidden power cost and is completely unaffected by the quickToggles
           *  (which only skip shader passes, not the context's existence).
           *  Detected lazily on first render via WEBGL_debug_renderer_info. */
          this.isSoftwareRenderer = false;
          /** Debug: when true, the renderer collects each glass element's PEF
           *  bbox (CSS px, top-left origin) into `debugPefBboxes` during render.
           *  The React overlay reads this array to draw visible rectangles over
           *  the canvas. CONSUME-AFTER-DRAW: the overlay clears the list after
           *  drawing it, so the data survives the async gap between render and the
           *  overlay's rAF tick. Only populated when this flag is true. */
          this.showPefBbox = false;
          this.debugPefBboxes = [];
          /** Debug: when true, the renderer collects each blurTexture call's element
           *  rect (CSS px, top-left origin) + radius + downsample into
           *  `debugBlurRegions` during render. The React overlay reads this to draw
           *  rectangles marking where backdrop blur was computed. Useful for diagnosing
           *  downsample / scissor / coverage bugs. CONSUME-AFTER-DRAW: the overlay
           *  clears the list after drawing it. Only populated when this flag is true. */
          this.showBlurDebug = false;
          this.debugBlurRegions = [];
          /** Last blur call's stats, written by blurTexture/kawaseBlurTexture so
           *  callers (e.g. the blur debug overlay push in render-glass-backdrop)
           *  can read what actually happened (type, pass count, tap count, farthest
           *  sample distance) without re-deriving it. Null until the first blur call.
           *  maxSample = the farthest tap distance from center (Gaussian: 3σ;
           *  Kawase: radius, the ±2d at the last iter). */
          this.lastBlurStats = null;
          /** Backdrop blur cache for the independent path (wallpaperBlurFbo).
           *  When independent=true, the backdrop is static cover-fit wallpaper —
           *  same radius → same blur result. Key = `wallpaper_${qRadius}_${type}`
           *  where qRadius = CSS px radius quantized to 0.1 (NOT × dpr).
           *  Cross-element + cross-frame: multiple elements at the same radius
           *  share one blurred wallpaper texture.
           *  Invalidated on resize (cover-fit ratio changes) + loadWallpaper. */
          this.backdropBlurCache = /* @__PURE__ */ new Map();
          /** Pool of freed cache FBOs ({fb, tex, w, h}). On cache miss we acquire
           *  from here (reusing a size-matched tex+fb, avoiding gl.createTexture /
           *  gl.createFramebuffer + texImage2D allocation cost); on LRU eviction we
           *  release back here instead of deleting. clearBackdropBlurCache (resize /
           *  loadWallpaper) deletes everything since sizes may change. */
          this.backdropBlurCacheFboPool = [];
          /** Lazy-created persistent read FBO for copyTexImage2D in the cache path.
           *  Reused across all cache-miss copies (independent + scene) to avoid the
           *  ~0.5-1ms per-miss cost of createFramebuffer + deleteFramebuffer + the
           *  driver-side object allocation they trigger. Created on first use;
           *  deleted in dispose + clearBackdropBlurCache (resize/loadWallpaper). */
          this.cacheCopyReadFbo = null;
          /** Hard cap on the number of cached backdrop blur textures. When exceeded,
           *  the oldest entry (Map insertion order) is evicted + returned to the
           *  FBO pool. Each cached texture is ~fboW*fboH*4 bytes, so this bounds VRAM.
           *  Applies to BOTH the independent (wallpaper_*) and scene (scene_*) paths.
           *  Default 64. */
          this.backdropBlurCacheMax = 64;
          /** Per-frame counter of cache-miss blur operations. Reset to 0 at the start
           *  of each render(). When >= blurCacheMissesPerFrame, further cache misses
           *  this frame fall back to didBlur=false (no separable blur, shader uses
           *  inline poisson) so a frame with N simultaneous misses doesn't pay
           *  N × full-screen 2-pass blur — only 1 does, the rest are deferred to
           *  subsequent frames (progressive cache fill). */
          this._blurCacheMissesThisFrame = 0;
          /** Max cache-miss blurs allowed per frame. 1 = strictest (smoothest but
           *  slowest cache fill); higher = faster fill but bigger spikes. */
          this.blurCacheMissesPerFrame = 1;
          /** Tracks scrollY between frames — scene blur cache disabled when scrolling. */
          this._lastBlurCacheScrollY = 0;
          /** Debug: when true, cached blur textures are masked with a checkerboard
           *  pattern (even cells keep blur content, odd cells cleared to transparent).
           *  This lets you visually compare blur vs no-blur in the live render. */
          this.showBlurCacheCheckerboard = false;
          /** Debug: when true, cache miss reads full-resolution texture for the
           *  debug overlay preview. When false, only reads 64×64 center (cheap). */
          this.showBlurCachePreview = false;
          /** Debug: snapshot of each cache entry's center pixels, taken at cache-miss
           *  time (when the texture is first created). Stored as {key, w, h, rgba}
           *  so the overlay can render without touching GL state. */
          this.backdropBlurCacheSnapshots = [];
          /** Debug: when true, the renderer collects each glass element's SHADOW
           *  bbox (the TRUE per-direction reach of the shadow shape on screen,
           *  computed by shadowBboxCss from outerShadow.radius + offsetX/Y +
           *  layerScaleX/Y) into `debugShadowBboxes` during render. The shadow
           *  bbox is DYNAMIC — it shrinks at rest when the indicator's
           *  pressProgress=0 (shadow alpha → 0 → pass skipped) and grows during
           *  drag/press. Unlike the scissor margin (uniform conservative), this
           *  reflects the actual shadow geometry: offset directionality means
           *  left/right/top/bottom reaches differ. This lets you visualize exactly
           *  how much screen area each shadow rasterizes into, which is the basis
           *  for the inflatedOutputRect overlap test.
           *  CONSUME-AFTER-DRAW: the overlay clears the list after drawing it.
           *  Only populated when this flag is true. */
          this.showShadowBbox = false;
          this.debugShadowBboxes = [];
          /** Debug probe: when true, the capsule SDF texture uploaded to the GPU has
           *  its R channel (coverage) zeroed in the TOP-LEFT QUADRANT of the SOURCE
           *  IMAGE (Canvas2D space: row < texSize/2 && col < texSize/2). Due to
           *  UNPACK_FLIP_Y=true on upload + the Y-down convention of
           *  centeredOrigRot in the element shader, this image-top-left region
           *  maps to the element's BOTTOM-LEFT quadrant on screen.
           *
           *  PURPOSE: prove whether the glass body's clip edge actually comes from
           *  sampling this SDF texture. If ON → the bottom-left corner of every
           *  capsule glass element should become transparent (sampleClipMask
           *  returns 0 → `mask < 0.01 discard`), confirming the SDF texture IS
           *  the clip source. If nothing changes, the clip edge is coming from
           *  somewhere else (analytic sdRoundedRect, scissor, elFbo composite
           *  bounds, …).
           *
           *  The挖0 happens on a COPY at GPU upload time — the CPU maskCache
           *  (continuous-mask.ts) is NEVER touched, so other elements + the cache
           *  hit-rate are unaffected. The GPU texture pool key includes this flag
           *  so toggling creates a fresh pool entry instantly (no eviction of the
           *  clean texture). Independent of debugSdfHoleTopLeftG — both can be ON
           *  at once to test both channels simultaneously. */
          this.debugSdfHoleTopLeftR = false;
          /** Debug probe: same as debugSdfHoleTopLeftR but zeroes the G channel
           *  (SDF) instead of R (coverage). Tests whether highlight / rim-stroke
           *  shapes that use sampleClipSdf are actually fed by this texture.
           *  Independent of debugSdfHoleTopLeftR. */
          this.debugSdfHoleTopLeftG = false;
          /** Debug: when true, the renderer records each element's CULL decision
           *  (made in methods-render.ts's two element loops) into `debugCullRects`
           *  during render. The React overlay draws each element's effective
           *  viewport rect (after scroll offset) + the cull margin that was applied
           *  (max(120, h)) + a KEPT/CULL label, so you can see EXACTLY why an
           *  element was or wasn't skipped this frame.
           *
           *  WHY THIS EXISTS: the "element disappeared before sliding off screen"
           *  symptom is frequently blamed on the cull logic, but the cull margin
           *  (max(120, h)) is deliberately generous — a 300px card stays rendered
           *  until it's FULLY off-screen + 300px beyond. This overlay proves
           *  whether the cull logic is actually the culprit: if a disappearing
           *  element still shows a green KEPT rect, the bug is elsewhere (PEF
           *  composite position, scissor rect, elFbo cache, etc.).
           *
           *  CONSUME-AFTER-DRAW: NO — structural overlay (persists across idle
           *  frames like showPefBbox). The renderer clears + repopulates it at the
           *  start of each actual render; idle frames leave the last render's data
           *  intact so the overlay stays visible. */
          this.showCullDebug = false;
          this.debugCullRects = [];
          /** Debug: when true, records each glass element's PEF step execution into
           *  `debugPefPasses` during render. The overlay draws, per glass element:
           *    - BLUE rect  = Step 4 composite rect (elFbo → curFbo blit area)
           *    - YELLOW rect = Step 5 post-pass scissor (shadow bbox)
           *    - RED badge  = cache HIT (Step 3 skipped → element-shader highlight /
           *      indicator backdrop NOT rendered this frame; only cached tex composited)
           *    - GREEN badge = cache MISS (Step 3 ran → full re-raster incl. highlight)
           *
           *  WHY: symptoms "highlight disappears" + "bottom-tab indicator content
           *  layer missing on first frame" both ONLY happen with PEF on. Root cause
           *  hypothesis: the element shader (renderGlassElementPass = Step 3) renders
           *  the refraction-embedded highlight AND the indicator's sampleIndicator
           *  Backdrop content layer INTO the elFbo. On PEF cache HIT, Step 3 is
           *  skipped → the cached elFbo tex (from a previous frame) is composited
           *  as-is. If the cached tex was rasterized when highlight.alpha=0 or
           *  pressProgress=0 (at rest), the highlight / indicator content baked
           *  into the cache is empty, and it NEVER refreshes until cache is
           *  invalidated. This overlay lets you verify: when highlight visually
           *  disappears, check if the element shows a RED (HIT) badge — if so,
           *  the cache is serving a stale tex without the highlight.
           *
           *  CONSUME-AFTER-DRAW: NO — structural overlay (persists across idle
           *  frames). Cleared + repopulated each render. */
          this.showPefPassDebug = false;
          this.debugPefPasses = [];
          /** Debug: when true, records each plain-rect element's RENDER DECISION
           *  (made in renderNonGlassElement) into `debugPlainRects` during render.
           *  The overlay draws each plain-rect's effective viewport rect color-coded
           *  by verdict, plus a detail info panel for settings-card-rendering-bg.
           *
           *  WHY THIS EXISTS: the "settings card background mysteriously disappears"
           *  symptom. The card bg is a plain-rect (NOT glass — it does NOT go through
           *  PEF / elFboCache / element-pass shader / uEnterAlpha). So the
           *  disappearance must be one of:
           *    1. SKIPPED    — color alpha ≤ 0 (palette.toggleCardBg alpha→0 or NaN)
           *                    → renderNonGlassElement early-returns before drawArrays.
           *    2. INVISIBLE  — finalAlpha = colorA * enterA ≤ 0. Two sub-causes:
           *                    (a) enterProgress leaked from ControlCenter page →
           *                        enterA=0 → uColor.a=0 (card draws fully transparent).
           *                    (b) color alpha is NaN (NaN≤0 is false → not SKIPPED,
           *                        but NaN*enterA=NaN → uColor.a=NaN→0 in GL).
           *    3. DEGENERATE — rect w/h ≤ 0 (cardBgEl.rect.h = nextY-cardStartY ≤ 0
           *                    due to a layout / scrollY / conditional-skip bug in
           *                    build-settings.ts). setSdfUniforms gets a 0-size quad.
           *    4. NO_OP      — BLEND disabled by a prior element (progressive-blur /
           *                    blurTexture) and not restored → drawArrays writes
           *                    nothing (plain-rect branch only sets blendFunc, never
           *                    re-enables BLEND).
           *    5. (else)     — drawn OK; the disappearance is elsewhere (ping-pong
           *                    blit curFbo/curTex desync, or a later opaque element
           *                    covering the card). curFboIsA is recorded as a clue.
           *
           *  CONSUME-AFTER-DRAW: NO — structural overlay (persists across idle
           *  frames like showCullDebug). The renderer clears + repopulates it at the
           *  start of each actual render; idle frames leave the last render's data
           *  intact so the overlay stays visible. */
          this.showPlainRectDebug = false;
          this.debugPlainRects = [];
          /** Performance monitor — frame timing + per-frame render counters +
           *  GPU info. When `perfMonitor.enabled === false` (default), every
           *  increment is a no-op. Toggled on by the Settings "Performance
           *  monitor" switch via the perfMonitorEnabled prop in context.tsx. */
          this.perfMonitor = new PerfMonitor();
          // ---- GL 状态影子（热路径不再 getParameter：ANGLE+D3D11 上单次约 7ms 驱动同步）----
          this._glFb = null;
          this._glScissorOn = false;
          this._glScissorBox = null;
          this._glStateInit = false;
          // --- Per-element FBO infrastructure (used when usePerElementFbo=true) ---
          // elFbo: the element's glass body is rendered here (transparent; the element
          // shader's discard leaves only the glass shape). Capped to 1024 device px.
          // Lazily (re)created by ensureElementFBO when the element's device-px bbox
          // size changes.
          this.elFbo = null;
          this.elFboTex = null;
          this.elFboW = 0;
          this.elFboH = 0;
          /** Per-element CACHED elFbo. Only INDEPENDENT elements (backdrop = static
           *  wallpaper via uSampleWallpaper=1) can be cached across frames — non-
           *  independent elements sample curTex (the accumulation buffer) which
           *  changes whenever an earlier element draws, so their backdrop is never
           *  stable across frames and caching would produce stale visuals.
           *
           *  Cache key: element.id. Entry validity is gated by:
           *    - entry.valid (set false by any global state change)
           *    - geometry match (elFboRectW/H + ex0/ey0Top — covers scroll, layerScale,
           *      translation, enterProgress)
           *    - entry.wallpaperVersion === this.wallpaperVersion (wallpaper reload)
           *    - entry.dpr === this.dpr
           *
           *  When all match AND the element is not dirty this frame, the render loop
           *  SKIPS shadow + element pass + blur + post passes, and just composites
           *  the cached tex onto curFbo. The cached tex contains the FULL element
           *  (shadow + glass body + foreground + highlight) with alpha, so SrcOver
           *  compositing is correct. */
          this.elFboCache = /* @__PURE__ */ new Map();
          /** Monotonically incremented each time the wallpaper texture is (re)loaded.
           *  Compared against each elFboCache entry's stored wallpaperVersion to
           *  invalidate cached independent elements when the backdrop they sampled
           *  has changed. */
          this.wallpaperVersion = 0;
          // backdropCropFbo: a scissor-cropped copy of curFbo covering the element's
          // bbox (+ blur margin). The element pass samples THIS (small) texture for
          // refraction/blur instead of doing a fullscreen blit.
          this.backdropCropFbo = null;
          this.backdropCropTex = null;
          // elBlurFboA/B: ping-pong for the 2-pass separable Gaussian on the cropped
          // backdrop (when useSeparableBlur). Same capped size as elFbo.
          this.elBlurFboA = null;
          this.elBlurFboATex = null;
          this.elBlurFboB = null;
          this.elBlurFboBTex = null;
          // SDF texture (clock_sdf) for LockScreen glass
          this.sdfTexture = null;
          this.sdfTextureReady = false;
          this.sdfTextureSize = [1, 1];
          // SEPARATE SDF texture slot for TextGlass (user-typed text SDF).
          // This is intentionally NOT the same slot as sdfTexture (clock_sdf) so
          // that generating a text SDF on the TextGlass page NEVER overwrites the
          // lock screen's clock_sdf texture. Previously both shared one slot,
          // which required a fragile reload-clock_sdf-on-LockScreen-entry hack
          // and could still flash the wrong texture during page transitions.
          // "把这个和锁屏sdf彻底分开" — completely separated.
          this.textSdfTexture = null;
          this.textSdfTextureReady = false;
          this.textSdfTextureSize = [1, 1];
          // Continuous-curvature mask texture pool: each unique (w,h,radius,dpr) gets
          // its own texture. The currently-bound one is in continuousSdfTexture.
          this.continuousSdfPool = /* @__PURE__ */ new Map();
          this.continuousSdfTexture = null;
          // texSize is dynamic (128/256/512/1024, chosen by generateContinuousCurvatureMask
          // based on element device-px size — 2× oversampling rounded up to POT).
          // Updated each loadContinuousSdf() call.
          this.continuousSdfTexSize = [128, 128];
          this.continuousSdfKey = null;
          /** 1×1 dummy texture (fully transparent black) bound to unused sampler
           *  units in the element pass. WebGL1 requires ALL sampler uniforms declared
           *  in a shader to point to texture units with a COMPLETE texture — even if
           *  the shader's current code path (via a uniform branch) never samples them.
           *  Without this, elements that render AFTER an element which bound a texture
           *  to a now-stale unit (e.g. toggle knob binding TEXTURE2 to the SDF texture,
           *  then the back button not rebinding it) get GL_INVALID_OPERATION from
           *  drawArrays → the glass body silently renders as empty/transparent.
           *  This is the root cause of the "back button background disappears on
           *  toggle/slider pages" bug. */
          this.dummyTex = null;
          // --- Capsule SDF profiling (debug layer) ---
          // Last generation's timings (ms). 0 when pool hit (no generation/upload).
          this._lastCapsuleGenMs = 0;
          // CPU: generateContinuousCurvatureMask total
          this._lastCapsuleUploadMs = 0;
          // GPU: texImage2D + gl.finish() sync
          this._lastCapsuleKey = "";
          /** Debug: a SNAPSHOT of the exact pixel bytes uploaded to the GPU in the
           *  last texImage2D call for a capsule SDF texture. This INCLUDES any
           * 挖0 applied by the debugSdfHoleTopLeftR/G probes (the挖0 happens on a
           *  copy at upload time — the CPU maskCache stays clean). The overlay's
           *  "Pack images" view reads this when a probe is active so the user can
           *  SEE the挖0'd region in the visualization, instead of the clean cache.
           *  null until the first upload, and cleared on pool hit (no upload that
           *  frame). Stays null if no probe is active (overlay reads the clean
           *  maskCache directly in that case — same data, less memory). */
          this._debugUploadedSdfTexMap = /* @__PURE__ */ new Map();
          /** Edge scan probe — pending request. Set by debugReadEdgeScanline(),
           *  consumed by _debugFlushPendingEdgeScan() at the end of render().
           *  Null when no scan is pending. */
          this._pendingEdgeScan = null;
          /** Edge scan probe — last completed result. The overlay polls this.
           *  Null until the first scan completes. Bumped with a new scanId on
           *  each completed scan so the overlay can detect fresh results. */
          this._edgeScanResult = null;
          /** Monotonic counter for edge scan results. */
          this._edgeScanCounter = 0;
          /** Index into the useContinuousSdf element list to scan next. Cycled by
           *  debugCycleEdgeScanTarget() — lets the user step through multiple
           *  capsule elements on the same page. */
          this._edgeScanTargetIdx = 0;
          this.fgTextures = /* @__PURE__ */ new Map();
          this.fgDirtyIds = /* @__PURE__ */ new Set();
          /** Canvas2D stroke-mask cache for rim highlight. Keyed by exact geometry
           *  (element size + corner radius + stroke width + path style at current dpr).
           *  The mask is independent of highlight angle/alpha/press progress, so it can
           *  be reused across frames without a resolution ceiling or UV mismatch. */
          this.strokeMaskCache = /* @__PURE__ */ new Map();
          /** Canvas2D inner-shadow-mask cache. Keyed by exact geometry
           *  (element size + corner radius + offset + blur sigma + path style).
           *  Two entries per element (shadow1 + shadow2). */
          this.innerShadowMaskCache = /* @__PURE__ */ new Map();
          this.rafId = null;
          this.animRafId = null;
          /** Bottom-tabs first-entry double-render counter.
           *  When >0, render() will — at the end of the frame — mark all bottom-tab
           *  indicator groups dirty (invalidating their elFbo cache) and request one
           *  more render, then decrement. This forces the indicator to re-rasterize
           *  on the second frame with a now-stable tabsBackdropTex (captured during
           *  the first frame), fixing the "first frame missing indicator content
           *  layer" PEF-only symptom without making indicators permanently
           *  non-cacheable. Set by setButtons when navigating TO a bottom-tabs page. */
          this.pendingExtraRenders = 0;
          // Program uniform locations (cached)
          this.uEl = {};
          this.uSh = {};
          this.uWp = {};
          this.uFg = {};
          this.uHl = {};
          this.uTn = {};
          this.uRm = {};
          this.uHs = {};
          this.uHc = {};
          this.uSm = {};
          this.uIs = {};
          this.uPr = {};
          this.uPb = {};
          this.uCp = {};
          this.uSf = {};
          this.uCc = {};
          this.uSt = {};
          this.uEf = {};
          this.uEc = {};
          this.canvas = canvas;
          const gl = canvas.getContext("webgl", {
            premultipliedAlpha: false,
            alpha: false,
            antialias: false,
            preserveDrawingBuffer: false,
            powerPreference: "low-power"
          });
          if (!gl) throw new Error("WebGL not supported");
          this.gl = gl;
          this.elementProgram = createProgram(gl, VERTEX_SHADER, ELEMENT_FRAGMENT_SHADER);
          this.shadowProgram = createProgram(gl, VERTEX_SHADER, SHADOW_FRAGMENT_SHADER);
          this.wallpaperProgram = createProgram(gl, VERTEX_SHADER, WALLPAPER_FRAGMENT_SHADER);
          this.foregroundProgram = createProgram(gl, VERTEX_SHADER, FOREGROUND_FRAGMENT_SHADER);
          this.highlightProgram = createProgram(gl, VERTEX_SHADER, HIGHLIGHT_FRAGMENT_SHADER);
          this.tintProgram = createProgram(gl, VERTEX_SHADER, TINT_FRAGMENT_SHADER);
          this.rimHighlightProgram = createProgram(gl, VERTEX_SHADER, RIM_HIGHLIGHT_FRAGMENT_SHADER);
          this.highlightStrokeProgram = createProgram(gl, VERTEX_SHADER, HIGHLIGHT_STROKE_FRAGMENT_SHADER);
          this.highlightCompositeProgram = createProgram(gl, VERTEX_SHADER, HIGHLIGHT_COMPOSITE_FRAGMENT_SHADER);
          this.strokeMaskCompositeProgram = createProgram(gl, VERTEX_SHADER, STROKE_MASK_COMPOSITE_FRAGMENT_SHADER);
          this.innerShadowMaskCompositeProgram = createProgram(gl, VERTEX_SHADER, INNER_SHADOW_MASK_COMPOSITE_FRAGMENT_SHADER);
          this.plainRectProgram = createProgram(gl, VERTEX_SHADER, PLAIN_RECT_FRAGMENT_SHADER);
          this.progressiveBlurProgram = createProgram(gl, VERTEX_SHADER, PROGRESSIVE_BLUR_FRAGMENT_SHADER);
          this.copyProgram = createProgram(gl, VERTEX_SHADER, COPY_FRAGMENT_SHADER);
          this.solidFillProgram = createProgram(gl, VERTEX_SHADER, SOLID_FILL_FRAGMENT_SHADER);
          this.colorControlsProgram = createProgram(gl, VERTEX_SHADER, COLOR_CONTROLS_FRAGMENT_SHADER);
          this.sceneTintProgram = createProgram(gl, VERTEX_SHADER, SCENE_TINT_FRAGMENT_SHADER);
          this.elFboCompositeProgram = createProgram(gl, VERTEX_SHADER, EL_FBO_COMPOSITE_FRAGMENT_SHADER);
          this.elFboCropProgram = createProgram(gl, VERTEX_SHADER, EL_FBO_CROP_FRAGMENT_SHADER);
          this.quadBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
            gl.STATIC_DRAW
          );
          this.aPosLocEl = gl.getAttribLocation(this.elementProgram, "aPos");
          this.aPosLocSh = gl.getAttribLocation(this.shadowProgram, "aPos");
          this.aPosLocWp = gl.getAttribLocation(this.wallpaperProgram, "aPos");
          this.aPosLocFg = gl.getAttribLocation(this.foregroundProgram, "aPos");
          this.aPosLocHl = gl.getAttribLocation(this.highlightProgram, "aPos");
          this.aPosLocTn = gl.getAttribLocation(this.tintProgram, "aPos");
          this.aPosLocRm = gl.getAttribLocation(this.rimHighlightProgram, "aPos");
          this.aPosLocHs = gl.getAttribLocation(this.highlightStrokeProgram, "aPos");
          this.aPosLocHc = gl.getAttribLocation(this.highlightCompositeProgram, "aPos");
          this.aPosLocSm = gl.getAttribLocation(this.strokeMaskCompositeProgram, "aPos");
          this.aPosLocIs = gl.getAttribLocation(this.innerShadowMaskCompositeProgram, "aPos");
          this.aPosLocPr = gl.getAttribLocation(this.plainRectProgram, "aPos");
          this.aPosLocPb = gl.getAttribLocation(this.progressiveBlurProgram, "aPos");
          this.aPosLocCp = gl.getAttribLocation(this.copyProgram, "aPos");
          this.aPosLocSf = gl.getAttribLocation(this.solidFillProgram, "aPos");
          this.aPosLocCc = gl.getAttribLocation(this.colorControlsProgram, "aPos");
          this.aPosLocSt = gl.getAttribLocation(this.sceneTintProgram, "aPos");
          this.aPosLocEf = gl.getAttribLocation(this.elFboCompositeProgram, "aPos");
          this.aPosLocEc = gl.getAttribLocation(this.elFboCropProgram, "aPos");
          this.fgCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
          const fgCtx = this.fgCanvas?.getContext("2d", { alpha: true });
          if (!fgCtx) throw new Error("2D canvas not supported");
          this.fgCtx = fgCtx;
          this.dummyTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, this.dummyTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.cacheUniforms();
          this.perfMonitor.attachGl(gl);
          this.detectSoftwareRenderer();
          this.perfMonitor.isSoftwareRenderer = this.isSoftwareRenderer;
        }
        glStateCached(gl) {
          if (!this._glStateInit) {
            this._glFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            this._glScissorOn = gl.isEnabled(gl.SCISSOR_TEST);
            this._glScissorBox = gl.getParameter(gl.SCISSOR_BOX);
            this._glStateInit = true;
          }
          return { fb: this._glFb, scissor: this._glScissorOn, box: this._glScissorBox };
        }
        bindFbRaw(gl, target, fb) {
          gl.bindFramebuffer(target, fb);
          if (target !== gl.READ_FRAMEBUFFER) this._glFb = fb;
        }
        scissorRaw(gl, x, y, w, h) {
          gl.scissor(x, y, w, h);
          this._glScissorBox = [x, y, w, h];
        }
        scissorTestRaw(gl, on) {
          if (on) gl.enable(gl.SCISSOR_TEST);
          else gl.disable(gl.SCISSOR_TEST);
          this._glScissorOn = on;
        }
        get _debugLastUploadedSdfTex() {
          const arr = Array.from(this._debugUploadedSdfTexMap.values());
          return arr.length ? arr[arr.length - 1].tex : null;
        }
        get _debugLastUploadedSdfKey() {
          const arr = Array.from(this._debugUploadedSdfTexMap.keys());
          return arr.length ? arr[arr.length - 1] : "";
        }
        get _debugLastUploadedSdfTexSize() {
          const arr = Array.from(this._debugUploadedSdfTexMap.values());
          return arr.length ? arr[arr.length - 1].texSize : 0;
        }
        /** Clear the GPU-side capsule SDF texture pool + reset binding. The CPU-side
         *  mask cache (continuous-mask.ts) must be cleared separately via
         *  clearMaskCache(). Next render re-generates textures on demand. */
        clearCapsuleSdfPool() {
          const gl = this.gl;
          for (const { tex } of this.continuousSdfPool.values()) gl.deleteTexture(tex);
          this.continuousSdfPool.clear();
          this.continuousSdfTexture = null;
          this.continuousSdfKey = null;
          this._lastCapsuleGenMs = 0;
          this._lastCapsuleUploadMs = 0;
          this._lastCapsuleKey = "";
          this._debugUploadedSdfTexMap.clear();
        }
        /** Clear the Canvas2D stroke-mask cache (highlight rim + inner-shadow
         *  masks). Deletes the WebGL textures + drops the HTMLCanvasElement refs
         *  so they can be GC'd. Next render re-rasterizes masks on demand via
         *  Canvas2D stroke(). Provided for the debug overlay's "clr masks" button
         *  so the user can force fresh mask generation to inspect the highlight
         *  stroke shape. Returns the number of entries evicted. */
        clearStrokeMaskCache() {
          const gl = this.gl;
          const n = this.strokeMaskCache.size;
          for (const entry of this.strokeMaskCache.values()) gl.deleteTexture(entry.tex);
          this.strokeMaskCache.clear();
          return n;
        }
        static {
          /** The pressed scale for bottom tabs indicator (78f/56f in Kotlin). */
          this.TAB_PRESSED_SCALE = 78 / 56;
        }
        /** Probe WEBGL_debug_renderer_info (if available) and set
         *  isSoftwareRenderer. The unmasked renderer string contains markers like
         *  "SwiftShader", "llvmpipe", "softpipe", "Apple Software", "Microsoft
         *  Basic Render Driver", "Mesa software" that identify CPU rasterizers. */
        detectSoftwareRenderer() {
          const gl = this.gl;
          try {
            const dbgExt = gl.getExtension("WEBGL_debug_renderer_info");
            const rendererStr = dbgExt ? String(gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) || "") : String(gl.getParameter(gl.RENDERER) || "");
            const r = rendererStr.toLowerCase();
            this.isSoftwareRenderer = r.includes("swiftshader") || r.includes("llvmpipe") || r.includes("softpipe") || r.includes("swrast") || r.includes("software") || r.includes("basic render") || r.includes("mesa software") || r.includes("apple software");
          } catch {
          }
        }
        /**
         * Returns true iff ANY of the 7 debug overlay flags is on. Used by the
         * overlay rAF loop in context.tsx to decide whether to keep ticking at
         * 60Hz or stop + switch to a 250ms poll. When all flags are off, the rAF
         * stops entirely so the browser compositor can enter deep idle — this is
         * the difference between ~0.3W and ~0.05W idle power on mobile.
         *
         * NOTE: the perf-monitor overlay's quick-toggles (perElementFbo,
         * isolateBackdrop, noContinuousSdf, sampleWallpaper, etc.) do NOT count
         * as "debug overlays" here — they affect rendering output, not the 2D
         * overlay canvas. The overlay canvas only draws when one of these 7
         * structural/show* flags is on.
         */
        anyDebugOverlayOn() {
          return this.showPefBbox || this.showBlurDebug || this.showShadowBbox || this.showCullDebug || this.showPlainRectDebug || this.showPefPassDebug || this.showDirtyMarkers;
        }
        // cacheUniforms, ensureBlurPrograms, pickDsBlurLevel, blurTexture,
        // ensureHighlightBlurPrograms, blurHighlightMask, and dispose are
        // defined in methods-uniforms.ts / methods-blur.ts / methods-dispose.ts
        // and merged onto the prototype via Object.assign below.
      };
      Object.assign(
        LiquidGlassRenderer.prototype,
        fboMethods,
        wallpaperMethods,
        scrollMethods,
        toggleMethods,
        tabsMethods,
        elementMethods,
        animationMethods,
        rasterMethods,
        renderMethods,
        backgroundMethods,
        nonGlassMethods,
        nonGlassPlainRectMethods,
        nonGlassTextMethods,
        nonGlassProgressiveBlurMethods,
        glassRenderMethods,
        glassElementPassMethods,
        glassPostPassMethods,
        dirtyTrackingMethods,
        debugMethods,
        uniformMethods,
        blurMethods,
        disposeMethods
      );
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/control-center-anim.ts
  var init_control_center_anim = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/control-center-anim.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/constants.ts
  var DP3, BUTTON_HEIGHT, BUTTON_HORIZONTAL_PADDING, TEXT_FONT_SIZE_PX, SUBTITLE_FONT_SIZE_PX, TITLE_FONT_SIZE_PX, GLASS_PARAMS, DEFAULT_HIGHLIGHT, DEFAULT_SHADOW, FLIGHT_ICON_PATH, SLIDER_TRACK_H, SLIDER_KNOB_W, SLIDER_KNOB_H, SLIDER_HIT_H, TG_SHEET_X, TG_SHEET_RADIUS, TG_INNER_PAD, TG_TOGGLE_BTN_SIZE;
  var init_constants = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/constants.ts"() {
      "use strict";
      DP3 = 1;
      BUTTON_HEIGHT = 48 * DP3;
      BUTTON_HORIZONTAL_PADDING = 16 * DP3;
      TEXT_FONT_SIZE_PX = 15 * DP3;
      SUBTITLE_FONT_SIZE_PX = 15 * DP3;
      TITLE_FONT_SIZE_PX = 28 * DP3;
      GLASS_PARAMS = {
        refractionHeight: 12 * DP3,
        refractionAmount: -24 * DP3,
        depthEffect: false,
        chromaticAberration: false,
        blurRadius: 2 * DP3,
        saturation: 1.5,
        brightness: 0,
        contrast: 1
      };
      DEFAULT_HIGHLIGHT = {
        mode: 0,
        color: [1, 1, 1],
        angle: 45 * Math.PI / 180,
        falloff: 1,
        alpha: 0.5,
        // faithful to HighlightStyle.Default: color = White.copy(alpha = 0.5f)
        widthDp: 0.5
      };
      DEFAULT_SHADOW = {
        radius: 24 * DP3,
        alpha: 0.1,
        offsetX: 0,
        offsetY: 24 / 6 * DP3,
        color: [0, 0, 0]
      };
      FLIGHT_ICON_PATH = "M400 552 L147 653 q-24 10 -45.5 -4.5 T80 608 v-22 q0 -12 5.5 -23 t15.5 -18 l299 -209 v-176 q0 -33 23.5 -56.5 T480 80 q33 0 56.5 23.5 T560 160 v176 l299 209 q10 7 15.5 18 t5.5 23 v22 q0 26 -21.5 40.5 T813 653 L560 552 v144 l103 72 q8 6 12.5 14.5 T680 801 v24 q0 20 -16.5 32.5 T627 864 l-147 -44 l-147 44 q-20 6 -36.5 -6.5 T280 825 v-24 q0 -10 4.5 -18.5 T297 768 l103 -72 v-144 Z";
      SLIDER_TRACK_H = 6 * DP3;
      SLIDER_KNOB_W = 40 * DP3;
      SLIDER_KNOB_H = 24 * DP3;
      SLIDER_HIT_H = 48 * DP3;
      TG_SHEET_X = 16 * DP3;
      TG_SHEET_RADIUS = 32 * DP3;
      TG_INNER_PAD = 24 * DP3;
      TG_TOGGLE_BTN_SIZE = 56 * DP3;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/palettes.ts
  var LIGHT_PALETTE, DARK_PALETTE, TOGGLE_ACCENT, TOGGLE_TRACK, SLIDER_ACCENT, SLIDER_TRACK, DIALOG_CONTAINER, DIALOG_ACCENT, DIALOG_DIM;
  var init_palettes = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/palettes.ts"() {
      "use strict";
      init_constants();
      LIGHT_PALETTE = {
        homeContentColor: [0, 0, 0, 1],
        homeSubtitleColor: [0 / 255, 136 / 255, 255 / 255, 1],
        homeTextHalo: "dark",
        toggleAccent: [52 / 255, 199 / 255, 89 / 255],
        toggleTrackOff: [120 / 255, 120 / 255, 120 / 255, 0.2],
        toggleCardBg: [1, 1, 1, 1],
        sliderAccent: [0 / 255, 136 / 255, 255 / 255],
        sliderTrackOff: [120 / 255, 120 / 255, 120 / 255, 0.2],
        sliderCardBg: [1, 1, 1, 1],
        tabsContentColor: [1, 1, 1, 0.92],
        tabsAccent: [0 / 255, 136 / 255, 255 / 255],
        tabsContainer: [250 / 255, 250 / 255, 250 / 255, 0.4],
        tabsTextHalo: "dark",
        dialogContentColor: [0, 0, 0, 1],
        dialogAccent: [0 / 255, 136 / 255, 255 / 255, 1],
        dialogContainer: [250 / 255, 250 / 255, 250 / 255, 0.6],
        dialogDim: [41 / 255, 41 / 255, 58 / 255, 0.23],
        dialogBlurRadius: 16 * DP3,
        dialogBrightness: 0.2,
        magnifierContentColor: [0, 0, 0, 1],
        magnifierAccent: [0 / 255, 136 / 255, 255 / 255, 1],
        magnifierCardBg: [1, 1, 1, 0.9],
        controlCenterAccent: [0 / 255, 136 / 255, 255 / 255, 1],
        progressiveContentColor: [0, 0, 0, 1],
        progressiveTint: [1, 1, 1, 1],
        progressiveTextHalo: "dark",
        adaptiveContentColor: [0, 0, 0, 1],
        backIconColor: [0, 0, 0, 1],
        buttonSurface: [1, 1, 1, 0.3]
      };
      DARK_PALETTE = {
        homeContentColor: [1, 1, 1, 1],
        homeSubtitleColor: [0 / 255, 136 / 255, 255 / 255, 1],
        homeTextHalo: "light",
        toggleAccent: [48 / 255, 209 / 255, 88 / 255],
        toggleTrackOff: [120 / 255, 120 / 255, 128 / 255, 0.36],
        toggleCardBg: [18 / 255, 18 / 255, 18 / 255, 1],
        sliderAccent: [0 / 255, 145 / 255, 255 / 255],
        sliderTrackOff: [120 / 255, 120 / 255, 128 / 255, 0.36],
        sliderCardBg: [18 / 255, 18 / 255, 18 / 255, 1],
        tabsContentColor: [1, 1, 1, 1],
        tabsAccent: [0 / 255, 145 / 255, 255 / 255],
        tabsContainer: [18 / 255, 18 / 255, 18 / 255, 0.4],
        tabsTextHalo: "light",
        dialogContentColor: [1, 1, 1, 1],
        dialogAccent: [0 / 255, 145 / 255, 255 / 255, 1],
        dialogContainer: [18 / 255, 18 / 255, 18 / 255, 0.4],
        dialogDim: [18 / 255, 18 / 255, 18 / 255, 0.56],
        dialogBlurRadius: 8 * DP3,
        dialogBrightness: 0,
        magnifierContentColor: [1, 1, 1, 1],
        magnifierAccent: [0 / 255, 145 / 255, 255 / 255, 1],
        magnifierCardBg: [18 / 255, 18 / 255, 18 / 255, 0.9],
        controlCenterAccent: [0 / 255, 145 / 255, 255 / 255, 1],
        progressiveContentColor: [1, 1, 1, 1],
        progressiveTint: [128 / 255, 128 / 255, 128 / 255, 1],
        progressiveTextHalo: "light",
        adaptiveContentColor: [1, 1, 1, 1],
        backIconColor: [1, 1, 1, 1],
        buttonSurface: [18 / 255, 18 / 255, 18 / 255, 0.4]
      };
      TOGGLE_ACCENT = LIGHT_PALETTE.toggleAccent;
      TOGGLE_TRACK = LIGHT_PALETTE.toggleTrackOff;
      SLIDER_ACCENT = LIGHT_PALETTE.sliderAccent;
      SLIDER_TRACK = LIGHT_PALETTE.sliderTrackOff;
      DIALOG_CONTAINER = LIGHT_PALETTE.dialogContainer;
      DIALOG_ACCENT = LIGHT_PALETTE.dialogAccent;
      DIALOG_DIM = LIGHT_PALETTE.dialogDim;
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/text-utils.ts
  var init_text_utils = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/text-utils.ts"() {
      "use strict";
      init_constants();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/types.ts
  var draggingGroups, DEFAULT_CATALOG_STATE;
  var init_types = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/types.ts"() {
      "use strict";
      init_control_center_anim();
      init_palettes();
      init_constants();
      init_text_utils();
      draggingGroups = /* @__PURE__ */ new Set();
      DEFAULT_CATALOG_STATE = {
        toggleOn: false,
        sliderValue: 50,
        selectedTab: 0,
        selectedTab2: 0,
        cornerRadiusFrac: 0.5,
        blurRadiusDp: 0,
        refractionHeightFrac: 0.2,
        refractionAmountFrac: 0.2,
        chromaticAberration: 0,
        magnifierX: 0,
        magnifierY: 0,
        lockScreenOffsetX: 0,
        lockScreenOffsetY: 0,
        controlCenterActive: 0,
        controlCenterEnter: 1,
        controlCenterSafeEnter: 1,
        gpSheetExpanded: true,
        gpOffsetX: 0,
        gpOffsetY: 0,
        gpZoom: 1,
        gpRotation: 0,
        algOffsetX: 0,
        algOffsetY: 0,
        adaptiveLuminance: 0.5,
        customDpr: 0,
        globalSeparableBlur: true,
        blurTapCap: 9,
        blurDownsample: 1,
        dynamicBlurDownsample: false,
        capsuleShape: true,
        noContinuousSdf: true,
        capsuleSdfQuality: 0.5,
        liveDpr: null,
        liveTapCap: null,
        liveBlurDownsample: null,
        liveCapsuleSdfQuality: null,
        liveKawaseQuality: null,
        hideOverlayButtons: false,
        locale: "zh",
        pageTransition: true,
        showFps: false,
        showPerfMonitor: false,
        highlightAa: true,
        usePerElementFbo: true,
        useKawaseBlur: true,
        useBlurCache: true,
        kawaseQuality: 1,
        directBackdropSample: true,
        perfProgress: null,
        perfStatusText: "",
        perfDone: false,
        perfResultDpr: 0,
        perfGlassAngle: 0,
        perfRoundTrigger: 0,
        perfProgressFrac: 0,
        perfProgressFracAnimated: 0,
        perfDeformMul: 0,
        perfExitProgress: 0,
        textGlassText: "Glass",
        textGlassAspect: 3,
        textGlassTexH: 280,
        textGlassOffsetX: 0,
        textGlassOffsetY: 0,
        textGlassFontSize: 90,
        textGlassQuality: 2,
        textGlassFontWeight: 1e3,
        textGlassFontIdx: 1,
        textGlassSheetExpanded: true,
        textGlassSheetScroll: 0,
        textGlassHighlightScale: 1.7,
        textGlassSaturation: 2,
        textGlassLightingEnabled: true,
        textGlassBrighten: 0.44,
        textGlassGlassTintHue: 240,
        textGlassGlassTintEnabled: false,
        textGlassGlassTintMix: 0,
        textGlassGlassTintStrength: 0.85,
        textGlassGlassTintSaturation: 1,
        textGlassGlassTintLightness: 1,
        textGlassEdgeMatte: true,
        textGlassEdgeMatteTargets: 8,
        textGlassEdgeMatteBevelRange: 1,
        textGlassEdgeMatteTintRange: 1,
        textGlassEdgeMatteBaseRange: 1,
        textGlassEdgeMatteBrightenRange: 0.5,
        textGlassEdgeMatteBevelMin: 0,
        textGlassEdgeMatteTintMin: 0,
        textGlassEdgeMatteBaseMin: 0,
        textGlassEdgeMatteBrightenMin: 0,
        textGlassEdgeMatteBevelStrength: 1,
        textGlassEdgeMatteTintStrength: 1,
        textGlassEdgeMatteBaseStrength: 1,
        textGlassEdgeMatteBrightenStrength: 1.3,
        textGlassBlurRadius: 0,
        textGlassOuterRefraction: false,
        textGlassRawSdf: false,
        textGlassAdvanced: false,
        textGlassGravity: false,
        textGlassHighlightAngle: 45
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-drag.ts
  function makeDragInteractions(opts) {
    const {
      groupId,
      trackX,
      dragW,
      rendererRef,
      onValueChange,
      onLiveValue,
      getFraction,
      beginDrag,
      drag,
      endDrag,
      setTarget,
      count,
      snap,
      liveUpdate = false,
      onTapJump = true,
      didDragThreshold = 3
    } = opts;
    if (!dragStates.has(groupId)) dragStates.set(groupId, { fraction: 0, x: 0, didDrag: false });
    const ds = dragStates.get(groupId);
    const fracFromPos = (px) => Math.max(0, Math.min(1, (px - trackX) / dragW));
    const applySnap = (f) => snap ? snap(f) : f;
    return {
      onTap: (pos) => {
        if (!onTapJump) return;
        const f = applySnap(fracFromPos(pos.x));
        const r = rendererRef?.current;
        if (r) setTarget(r, groupId, f, count);
        onValueChange(f);
      },
      onDragStart: (pos) => {
        const r = rendererRef?.current;
        if (!r) return;
        draggingGroups.add(groupId);
        ds.fraction = getFraction(r, groupId);
        ds.x = pos.x;
        ds.didDrag = false;
        beginDrag(r, groupId, ds.fraction, count);
      },
      onDrag: (pos) => {
        const r = rendererRef?.current;
        if (!r) return;
        if (Math.abs(pos.x - ds.x) > didDragThreshold) ds.didDrag = true;
        drag(r, groupId, ds.fraction, pos.x, ds.x, dragW, count);
        const f = getFraction(r, groupId);
        if (onLiveValue) onLiveValue(f);
        if (liveUpdate) {
          onValueChange(f);
        }
      },
      onDragEnd: () => {
        const r = rendererRef?.current;
        if (!r) return;
        const rawF = endDrag(r, groupId, count);
        const snappedF = applySnap(rawF);
        if (snap && count == null) setTarget(r, groupId, snappedF, count);
        onValueChange(snappedF);
        draggingGroups.delete(groupId);
      }
    };
  }
  function makeTabDragInteractions(groupId, tabWidth, tabsCount, onSelect, rendererRef) {
    if (!dragStates.has(groupId)) dragStates.set(groupId, { fraction: 0, x: 0, didDrag: false });
    const ds = dragStates.get(groupId);
    return {
      onTap: () => {
      },
      onDragStart: (pos) => {
        const r = rendererRef?.current;
        if (!r) return;
        draggingGroups.add(groupId);
        ds.fraction = r.getTabTarget(groupId);
        ds.x = pos.x;
        ds.didDrag = false;
        r.beginTabDrag(groupId, ds.fraction, tabsCount);
      },
      onDrag: (pos) => {
        const r = rendererRef?.current;
        if (!r) return;
        if (Math.abs(pos.x - ds.x) > 3) ds.didDrag = true;
        r.dragTab(groupId, ds.fraction, pos.x, ds.x, tabWidth, tabsCount);
      },
      onDragEnd: () => {
        const r = rendererRef?.current;
        if (!r) return;
        const finalIndex = r.endTabDrag(groupId, tabsCount);
        if (ds.didDrag) {
          onSelect(finalIndex);
        }
        draggingGroups.delete(groupId);
      }
    };
  }
  var dragStates, sliderDragBindings;
  var init_helpers_drag = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-drag.ts"() {
      "use strict";
      init_types();
      dragStates = /* @__PURE__ */ new Map();
      sliderDragBindings = {
        getFraction: (r, id) => r.getToggleFraction(id),
        beginDrag: (r, id, f) => r.beginToggleDrag(id, f),
        drag: (r, id, sf, cx, sx, dw) => r.dragToggle(id, sf, cx, sx, dw),
        endDrag: (r, id) => r.endSliderDrag(id),
        setTarget: (r, id, f) => r.setToggleTarget(id, f)
      };
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-elements.ts
  function makeButton(id, rect, spec, scroll = true) {
    return {
      id,
      kind: "button",
      rect,
      ...GLASS_PARAMS,
      cornerRadius: rect.h / 2,
      tintColor: spec.tintColor,
      surfaceColor: spec.surfaceColor,
      highlight: { ...DEFAULT_HIGHLIGHT },
      outerShadow: { ...DEFAULT_SHADOW },
      label: spec.label,
      labelColor: spec.labelColor,
      labelFontSizePx: spec.labelFontSizePx,
      showChevron: false,
      isInteractive: true,
      scroll,
      // Buttons use the NON-independent backdrop path so they pick up the
      // separable 2-pass Gaussian blur (useSeparableBlur, set globally in
      // catalog/index.ts). On solid-background pages `independent` is forced
      // false anyway (backgroundColor is set), so this only changes wallpaper
      // pages: there, buttons now sample the scene FBO (curTex) instead of the
      // raw wallpaper. Enable the `isolateBackdrop` quick-toggle to make them
      // sample the wallpaper snapshot (bgOnlyTex) instead — faithful to the
      // original LayerBackdrop, with separableBlur quality.
      independentBackdrop: false,
      // Mark as LayerBackdrop-eligible: when the renderer's directBackdropSample
      // toggle is ON (default), computeElementTransform treats this button as
      // independent (sampling the clean wallpaper) — matching the original
      // Android source where buttons use LayerBackdrop via RenderEffect. This
      // gives elFbo cache HIT every frame on static pages (no backdrop_overlap).
      directBackdropSample: true
    };
  }
  function makeText(id, rect, text, opts = {}, scroll = true) {
    return {
      id,
      kind: "text",
      rect,
      cornerRadius: 0,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: false,
      pressTintColor: opts.pressTintColor,
      scroll,
      text: {
        content: text,
        color: opts.color ?? [0, 0, 0, 1],
        fontSizePx: opts.fontSizePx ?? TEXT_FONT_SIZE_PX,
        fontWeight: opts.fontWeight ?? 400,
        align: opts.align ?? "left",
        wrap: opts.wrap ?? false,
        paddingPx: opts.paddingPx ?? 16,
        valign: opts.valign,
        maxLines: opts.maxLines,
        halo: opts.halo ?? "auto",
        icon: opts.icon
      }
    };
  }
  function makePlainRect(id, rect, color, cornerRadius = 0, scroll = true) {
    return {
      id,
      kind: "plain-rect",
      rect,
      cornerRadius,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: false,
      scroll,
      plainRect: { color }
    };
  }
  function makeGlassShape(id, rect, opts = {}, scroll = true) {
    return {
      id,
      kind: "glass-shape",
      rect,
      cornerRadius: opts.cornerRadius ?? rect.h / 2,
      refractionHeight: opts.refractionHeight ?? 12 * DP3,
      refractionAmount: opts.refractionAmount ?? -24 * DP3,
      depthEffect: opts.depthEffect ?? false,
      chromaticAberration: opts.chromaticAberration ?? false,
      blurRadius: opts.blurRadius ?? 2 * DP3,
      saturation: opts.saturation ?? 1.5,
      brightness: opts.brightness ?? 0,
      contrast: opts.contrast ?? 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: opts.surfaceColor ?? [0, 0, 0, 0],
      highlight: opts.highlight !== void 0 ? opts.highlight : { ...DEFAULT_HIGHLIGHT },
      outerShadow: opts.outerShadow !== void 0 ? opts.outerShadow : { ...DEFAULT_SHADOW },
      // faithful to drawBackdrop default: shadow = Shadow.Default
      label: "",
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: false,
      scroll,
      innerShadow: opts.innerShadow ?? null,
      // Most glass-shapes sample the wallpaper directly (matching the original's
      // LayerBackdrop). Ignored on solid-background pages (Home/Settings/About).
      // Override to false for elements that need the scene FBO (tab indicator,
      // dialog card, magnifier, etc.).
      independentBackdrop: true
    };
  }
  var init_helpers_elements = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-elements.ts"() {
      "use strict";
      init_types();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-slider.ts
  function makeLiquidSlider(idPrefix, trackX, trackY, trackW, groupId, trackColor, accentColor, rendererRef, onValueChange, scroll = true, liveUpdate = false, initFraction = 0, snap, onLiveValue) {
    const elements = [];
    const interactions = {};
    const dragW = trackW - SLIDER_KNOB_W / 2;
    const knobBaseX = trackX - SLIDER_KNOB_W / 4;
    const knobY = trackY + (SLIDER_TRACK_H - SLIDER_KNOB_H) / 2;
    const knobX = knobBaseX;
    const trackEl = makePlainRect(`${idPrefix}-track`, { x: trackX, y: trackY, w: trackW, h: SLIDER_TRACK_H }, trackColor, SLIDER_TRACK_H / 2);
    trackEl.hitRect = { x: trackX, y: trackY + (SLIDER_TRACK_H - SLIDER_HIT_H) / 2, w: trackW, h: SLIDER_HIT_H };
    trackEl.scroll = scroll;
    elements.push(trackEl);
    const fillW = Math.max(SLIDER_TRACK_H, initFraction * trackW);
    const fillEl = makePlainRect(`${idPrefix}-fill`, { x: trackX, y: trackY, w: fillW, h: SLIDER_TRACK_H }, [...accentColor, 1], SLIDER_TRACK_H / 2);
    fillEl.isSliderFill = { groupId, trackX, trackW, knobW: SLIDER_KNOB_W, minW: 0 };
    fillEl.scroll = scroll;
    elements.push(fillEl);
    const knobEl = makeGlassShape(
      `${idPrefix}-knob`,
      { x: knobX, y: knobY, w: SLIDER_KNOB_W, h: SLIDER_KNOB_H },
      {
        cornerRadius: SLIDER_KNOB_H / 2,
        refractionHeight: 10 * DP3,
        refractionAmount: -14 * DP3,
        blurRadius: 8 * DP3,
        saturation: 1,
        surfaceColor: [0, 0, 0, 0],
        highlight: { mode: 1, color: [1, 1, 1], angle: Math.PI / 4, falloff: 1, alpha: 1, widthDp: 0.5 / 1.5, blurRadiusDp: 0.25 / 1.5 },
        outerShadow: { radius: 4 * DP3, alpha: 0.05, offsetX: 0, offsetY: 4 / 6 * DP3, color: [0, 0, 0] },
        innerShadow: { radius: 4 * DP3, alpha: 0.3, offsetX: 0, offsetY: 4 * DP3 },
        // 0.15 was too faint; 0.3 matches visual intent
        chromaticAberration: true
      },
      scroll
    );
    knobEl.isToggleKnob = { groupId, dragWidth: dragW, velocityDivisor: 10 };
    knobEl.hitRect = { x: knobX, y: knobY + (SLIDER_KNOB_H - SLIDER_HIT_H) / 2, w: SLIDER_KNOB_W, h: SLIDER_HIT_H };
    elements.push(knobEl);
    const interact = makeDragInteractions({
      groupId,
      trackX,
      dragW,
      rendererRef,
      onValueChange,
      onLiveValue,
      ...sliderDragBindings,
      snap,
      liveUpdate
    });
    interactions[`${idPrefix}-track`] = interact;
    interactions[`${idPrefix}-knob`] = interact;
    return { elements, interactions };
  }
  var init_helpers_slider = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-slider.ts"() {
      "use strict";
      init_types();
      init_helpers_drag();
      init_helpers_elements();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-settings-toggle.ts
  var init_helpers_settings_toggle = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-settings-toggle.ts"() {
      "use strict";
      init_types();
      init_helpers_drag();
      init_helpers_elements();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-buttons.ts
  function makeBackButton(onBack, palette, scroll = false) {
    const size = 56 * DP3;
    const iconSize = 32 * DP3;
    const element = {
      id: "__back__",
      kind: "button",
      rect: { x: 16, y: 16, w: size, h: size },
      ...GLASS_PARAMS,
      cornerRadius: size / 2,
      // circular
      tintColor: [0, 0, 0, 0],
      surfaceColor: palette.buttonSurface,
      // Use the separable-blur backdrop path (see makeButton). The previous
      // independentBackdrop=true was for elFbo caching, but `cacheable` no
      // longer depends on `independent` (see methods-render-glass.ts), so this
      // is safe. Non-independent buttons still cache-hit when idle; they miss
      // on backdrop_overlap (scroll / overlapping element changes), same as
      // the dialog card and bottom-tab container.
      independentBackdrop: false,
      // LayerBackdrop-eligible (see makeButton): when directBackdropSample is
      // ON (default), samples the clean wallpaper — original LayerBackdrop
      // behavior, elFbo cache HIT every frame on static pages.
      directBackdropSample: true,
      highlight: null,
      // no edge highlight on the back button
      outerShadow: { ...DEFAULT_SHADOW },
      // faithful to drawBackdrop default: Shadow.Default
      label: "",
      // no text label — icon replaces it
      labelColor: palette.backIconColor,
      showChevron: false,
      isInteractive: true,
      scroll,
      icon: {
        path: ARROW_BACK_ICON_PATH,
        size: iconSize,
        color: palette.backIconColor
      }
    };
    return {
      element,
      interaction: { onTap: () => onBack() }
    };
  }
  var ARROW_BACK_ICON_PATH;
  var init_helpers_buttons = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-buttons.ts"() {
      "use strict";
      init_types();
      ARROW_BACK_ICON_PATH = "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-layout.ts
  function applyVerticalCenter(elements, contentTop, contentHeight, H) {
    const contentSize = contentHeight - contentTop;
    if (contentSize >= H) return contentHeight;
    const yOffset = Math.max(0, (H - contentSize) / 2 - contentTop);
    if (yOffset <= 0) return contentHeight;
    for (const el of elements) {
      if (el.id === "__back__" || el.id === "__theme__") continue;
      if (el.scroll === false && el.id !== "__pickimage__") continue;
      el.rect = { ...el.rect, y: el.rect.y + yOffset };
      if (el.hitRect) {
        el.hitRect = { ...el.hitRect, y: el.hitRect.y + yOffset };
      }
      if (el.isToggleKnob && el.isToggleKnob.trackOriginalY != null) {
        el.isToggleKnob.trackOriginalY += yOffset;
      }
      if (el.isBottomTabIndicator && el.isBottomTabIndicator.containerRect) {
        el.isBottomTabIndicator.containerRect = {
          ...el.isBottomTabIndicator.containerRect,
          y: el.isBottomTabIndicator.containerRect.y + yOffset
        };
      }
      if (el.isBottomTabContent && el.isBottomTabContent.containerCenterY != null) {
        el.isBottomTabContent.containerCenterY += yOffset;
      }
      if (el.isBottomTabIndicator && el.isBottomTabIndicator.containerCenterY != null) {
        el.isBottomTabIndicator.containerCenterY += yOffset;
      }
      if (el.isBottomTabIndicator && el.isBottomTabIndicator.tabContentRects) {
        el.isBottomTabIndicator.tabContentRects = el.isBottomTabIndicator.tabContentRects.map((r) => ({
          ...r,
          y: r.y + yOffset
        }));
      }
    }
    return contentHeight + yOffset;
  }
  var init_helpers_layout = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers-layout.ts"() {
      "use strict";
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers.ts
  var init_helpers = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/helpers.ts"() {
      "use strict";
      init_helpers_drag();
      init_helpers_elements();
      init_helpers_slider();
      init_helpers_settings_toggle();
      init_helpers_buttons();
      init_helpers_layout();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/build-bottom-tabs.ts
  function buildBottomTabs(W, H, onBack, state, setState, rendererRef = null, palette = LIGHT_PALETTE) {
    const elements = [];
    const interactions = {};
    const back = makeBackButton(onBack, palette);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const TABS_PAD = 220 * DP3;
    const TABS_W = W - 2 * TABS_PAD;
    const iconColor = palette.tabsContentColor;
    const containerColor = [1, 1, 1, 0.06];
    const accentT = palette.tabsAccent;
    const CONTAINER_H = 64 * DP3;
    const GLASS_H = 56 * DP3;
    const GLASS_PAD = 4 * DP3;
    const containerX = TABS_PAD;
    const containerW = TABS_W;
    const containerR = CONTAINER_H / 2;
    const glassX = TABS_PAD + GLASS_PAD;
    const glassW = TABS_W - 2 * GLASS_PAD;
    const glassR = GLASS_H / 2;
    function buildTabBar(idPrefix, tabsCount, selectedTab, onSelect, y) {
      const tabW = glassW / tabsCount;
      const glassY = y + GLASS_PAD;
      const containerEl = makeGlassShape(
        `${idPrefix}-container`,
        { x: containerX, y, w: containerW, h: CONTAINER_H },
        {
          cornerRadius: containerR,
          // 32dp capsule
          refractionHeight: 32 * DP3,
          refractionAmount: -32 * DP3,
          blurRadius: 6 * DP3,
          saturation: 1.8,
          surfaceColor: containerColor,
          // 容器 uses default Highlight.Default (alpha=0.5, width=0.5dp).
          // The original Container Row doesn't pass highlight= → uses DefaultHighlight.
          // Shadow defaults to Shadow.Default (24dp, Black@0.1).
          highlight: { ...DEFAULT_HIGHLIGHT, alpha: 0.5 },
          depthEffect: true
        }
      );
      containerEl.isBottomTabContainer = { groupId: idPrefix, tabsCount };
      containerEl.independentBackdrop = true;
      if (state.capsuleShape) containerEl.useContinuousSdf = true;
      elements.push(containerEl);
      const dragInteractions = makeTabDragInteractions(idPrefix, tabW, tabsCount, onSelect, rendererRef);
      for (let i = 0; i < tabsCount; i++) {
        const id = `${idPrefix}-tab-${i}`;
        const tabEl = makeText(
          id,
          { x: glassX + tabW * i, y: glassY, w: tabW, h: GLASS_H },
          `Tab ${i + 1}`,
          {
            color: palette.tabsContentColor,
            fontSizePx: 12,
            fontWeight: 400,
            align: "center",
            paddingPx: 0,
            halo: palette.tabsTextHalo,
            icon: { path: FLIGHT_ICON_PATH, size: 24, layoutSize: 28, color: iconColor, viewport: 960 }
          }
        );
        tabEl.isBottomTabContent = {
          groupId: idPrefix,
          // Container center = scale origin for the whole bar. Tab content
          // scales around this point (not its own center), matching the
          // original where container is the parent and its transform applies
          // uniformly to all children.
          containerCenterX: containerX + containerW / 2,
          containerCenterY: y + CONTAINER_H / 2,
          containerWidth: containerW
        };
        elements.push(tabEl);
        interactions[id] = {
          onTap: () => onSelect(i),
          onDragStart: dragInteractions.onDragStart,
          onDrag: dragInteractions.onDrag,
          onDragEnd: dragInteractions.onDragEnd
        };
      }
      interactions[`${idPrefix}-container`] = dragInteractions;
      const indicatorEl = makeGlassShape(
        `${idPrefix}-indicator`,
        // Indicator glass x = TABS_PAD + 4dp. The renderer adds fraction*tabW
        // via toggleXOffset (isBottomTabIndicator.dragWidth = tabW).
        { x: TABS_PAD + GLASS_PAD, y: glassY, w: tabW, h: GLASS_H },
        {
          cornerRadius: glassR,
          refractionHeight: 10 * DP3,
          refractionAmount: -14 * DP3,
          // Faithful to original: indicator has NO blur and NO vibrancy (only
          // lens when pressed). The original indicator's effects block contains
          // ONLY lens — no vibrancy(), no blur().
          blurRadius: 0,
          saturation: 1,
          // Indicator surface is TRANSPARENT (no tint, no surface color).
          // Faithful to LiquidBottomTabs.kt: the indicator's onDrawSurface is
          //   drawRect(dimColor 0.1, alpha=1-progress)  (dim at rest, clear pressed)
          //   drawRect(Black 0.03*progress)             (slight darken when pressed)
          // This dim overlay is handled by the isBottomTabIndicator dimColor path
          // in post-passes. The indicator is NOT blue — it's transparent glass
          // that refracts the content beneath. (The original's blue appearance
          // comes from CombinedBackdrop with a hidden tinted layer, which we
          // don't replicate — the indicator shows the scene as-is.)
          tintColor: [0, 0, 0, 0],
          surfaceColor: [0, 0, 0, 0],
          // Faithful to original: highlight = Highlight.Default.copy(alpha=progress).
          // alpha=0 at rest (no edge highlight), max=0.5 when pressed (Default style alpha).
          highlight: { ...DEFAULT_HIGHLIGHT, alpha: 0.5 },
          // Outer shadow: Shadow.Default.copy(alpha=pressProgress) — faithful to
          //   shadow = { val progress = dampedDragAnimation.pressProgress; Shadow(alpha = progress) }
          // At rest (progress=0): shadow alpha=0 → invisible. When pressed: Shadow.Default visible.
          // The renderer modulates this by state.togglePressProgress in renderGlassShadowPass.
          outerShadow: { ...DEFAULT_SHADOW },
          // InnerShadow(radius=8dp*progress, alpha=progress) — offset=(0, radius).
          // alpha=0.3: previous 0.15/0.2 were too faint; 0.3 was previously "too heavy"
          // but that was due to a radius/sigma bug, now fixed.
          innerShadow: { radius: 8 * DP3, alpha: 0.3, offsetX: 0, offsetY: 8 * DP3 },
          chromaticAberration: true
        }
      );
      indicatorEl.independentBackdrop = false;
      indicatorEl.isBottomTabIndicator = {
        groupId: idPrefix,
        dragWidth: tabW,
        dimColor: palette.backIconColor,
        // CombinedBackdrop: faithful to LiquidBottomTabs.kt 指示器's
        //   rememberCombinedBackdrop(backdrop, tabsBackdrop)
        // - backdrop (outer) = LayerBackdrop (wallpaper)
        // - tabsBackdrop (inner) = 内层背景板 (hidden Row's 56dp glass),
        //   inset 4dp on all sides relative to the 指示器.
        // The 指示器 samples wallpaper (outer) + the scene FBO (容器
        // glass + content) composited inside an inset capsule SDF.
        accentColor: [...accentT],
        // containerRect = the 内层背景板 capsule (hidden Row's 56dp glass),
        // inset 4dp on all sides from the 容器. Faithful to LiquidBottomTabs.kt:
        //   hidden Row = height(56dp).fillMaxWidth().padding(horizontal=4dp)
        //   drawBackdrop paints 56dp × (TABS_W - 8dp) = 56dp × glassW.
        containerRect: { x: glassX - GLASS_PAD, y: glassY, w: glassW + 2 * GLASS_PAD, h: GLASS_H },
        // Container center + width — the indicator scales around the container
        // center (like tab-content), matching the original parent-child transform.
        containerCenterX: containerX + containerW / 2,
        containerCenterY: y + CONTAINER_H / 2,
        containerWidth: containerW,
        // Tab content IDs + rects — for the blue tint mask. The renderer looks
        // up each tab's fgTexture (icon+label alpha) and uses it to tint only
        // the opaque icon/label pixels blue inside the indicator.
        tabContentIds: Array.from({ length: tabsCount }, (_, i) => `${idPrefix}-tab-${i}`),
        tabContentRects: Array.from({ length: tabsCount }, (_, i) => ({
          x: glassX + tabW * i,
          y: glassY,
          w: tabW,
          h: GLASS_H
        }))
      };
      if (state.capsuleShape) indicatorEl.useContinuousSdf = true;
      elements.push(indicatorEl);
    }
    buildTabBar("tabs3", 3, state.selectedTab, (i) => setState({ selectedTab: i }), 0);
    buildTabBar("tabs6", 6, state.selectedTab2, (i) => setState({ selectedTab2: i }), CONTAINER_H + 32);
    const contentHeight = 2 * CONTAINER_H + 32;
    const finalHeight = applyVerticalCenter(elements, 0, contentHeight, H);
    return { elements, interactions, contentHeight: finalHeight };
  }
  var init_build_bottom_tabs = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/catalog/build-bottom-tabs.ts"() {
      "use strict";
      init_types();
      init_helpers();
    }
  });

  // ../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/context/velocity.ts
  function localPos(e, canvasRef) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function computeReleaseVelocity(samples) {
    if (samples.length < 2) return 0;
    const now = samples[samples.length - 1].t;
    const cutoff = now - 100;
    let oldest = samples[samples.length - 1];
    for (let i = samples.length - 1; i >= 0; i--) {
      if (samples[i].t < cutoff) break;
      oldest = samples[i];
    }
    const dt = (now - oldest.t) / 1e3;
    if (dt < 1e-3) return 0;
    const dy = samples[samples.length - 1].y - oldest.y;
    return -dy / dt;
  }
  var init_velocity = __esm({
    "../liquid-glass-webgl/liquid-glass-webgl-main/src/components/liquid-glass/context/velocity.ts"() {
      "use strict";
    }
  });

  // src/entry.ts
  var require_entry = __commonJS({
    "src/entry.ts"() {
      init_renderer();
      init_build_bottom_tabs();
      init_types();
      init_helpers();
      init_velocity();
      init_helpers_drag();
      init_helpers_slider();
      var canvas = document.getElementById("c");
      var avatarWrap = document.getElementById("avatarWrap");
      var avatarImg = document.getElementById("avatarImg");
      var portInput = document.getElementById("portInput");
      var codeInput = document.getElementById("codeInput");
      var offlineInput = document.getElementById("offlineInput");
      var W = window.innerWidth;
      var H = window.innerHeight;
      var renderer = new LiquidGlassRenderer(canvas);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      renderer.resize(W, H);
      renderer.gl && (() => {
        const gl = renderer.gl;
        const orig = gl.scissor.bind(gl);
        gl.scissor = (x, y, w, h) => orig(x, y, Math.max(0, w), Math.max(0, h));
      })();
      var palette = LIGHT_PALETTE;
      var state = { ...DEFAULT_CATALOG_STATE, capsuleShape: true };
      var rendererRef = { current: renderer };
      var canvasRef = { current: canvas };
      var elements = [];
      var interactions = {};
      var M_FROST = { refractionHeight: 0, refractionAmount: 0, blurRadius: 7, saturation: 0.9, brightness: 0.04 };
      var M_THICK = { refractionHeight: 0, refractionAmount: 0, blurRadius: 12, saturation: 0.8, brightness: 0.02 };
      var M_LIQUID = { refractionHeight: 12, refractionAmount: -14, blurRadius: 8, saturation: 1.35, brightness: 0.04 };
      var FS = {
        largeTitle: 26,
        title1: 22,
        title2: 17,
        title3: 15,
        headline: 13,
        body: 13,
        callout: 12,
        subheadline: 11
      };
      function trackFor(size) {
        if (size >= 20) return -0.45;
        if (size >= 17) return -0.43;
        if (size >= 15) return -0.23;
        if (size >= 13) return -0.08;
        if (size >= 12) return 0;
        return 0.06;
      }
      var BLACK = [0, 0, 0, 1];
      var WHITE = [1, 1, 1, 1];
      var customVersionNames = {};
      try { customVersionNames = JSON.parse(localStorage.getItem("customVersionNames") || "{}"); } catch (e) { customVersionNames = {}; }
      function saveCustomVersionNames() {
        try { localStorage.setItem("customVersionNames", JSON.stringify(customVersionNames)); } catch (e) {}
      }
      var ICON_GEAR = "M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z";
      var ICON_BACK = "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z";
      var CLEAR = [0, 0, 0, 0];
      var PINK = [233 / 255, 30 / 255, 99 / 255, 1];
      var BLUE = [0 / 255, 122 / 255, 255 / 255, 1];
      function postStr(action) {
        const cw = window.chrome?.webview;
        if (cw) cw.postMessage(action);
        else console.log("[post]", action);
      }
      function post(obj) {
        const cw = window.chrome?.webview;
        if (cw) cw.postMessage(JSON.stringify(obj));
        else console.log("[post]", JSON.stringify(obj));
      }
      var hasWebView = () => !!window.chrome?.webview;
      var pendingAvatarUuid = "";
      var live = {
        playerName: "",
        premium: false,
        hasAccount: false,
        bgUrl: "",
        appVersion: "",
        currentVersion: "\u672A\u9009\u62E9\u7248\u672C",
        selectedVersionId: "",
        skinId: "",
        versions: [],
        avatarDataUri: "",
        ready: false
      };
      function onBg(url) {
        if (!url) return;
        live.bgUrl = url;
        renderer.loadWallpaper(url).then(() => renderer.requestRender()).catch(() => {
        });
      }
      window.onBackgroundLoaded = (d) => {
        const url = typeof d === "string" ? d : d?.url || d?.path || "";
        if (d && typeof d === "object" && d.dataUri) live.bgDataUri = d.dataUri;
        onBg(url);
      };
      window.onAvatarFetched = (d) => {
        const uri = d?.dataUri || d?.url || "";
        if (d?.uuid && pendingAvatarUuid && d.uuid !== pendingAvatarUuid) return;
        if (uri) {
          live.avatarDataUri = uri;
          avatarImg.src = uri;
        } else if (!d?.uuid) {
          live.avatarDataUri = "";
          avatarImg.src = "steve.png";
        }
      };
      window.onGlobalConfigLoaded = (d) => {
        const cfg = typeof d === "string" ? safeParse(d) : d;
        if (!cfg) return;
        if (cfg.playerName) {
          live.playerName = cfg.playerName;
          rebuildSoft();
        }
        if (typeof cfg.premium === "boolean") {
          live.premium = cfg.premium;
          rebuildSoft();
        }
        if (cfg.backgroundUrl) onBg(cfg.backgroundUrl);
      };
      window.onInstalledVersions = (d) => {
        let names = [];
        let loaderMap = {};
        if (Array.isArray(d)) {
          names = d;
        } else if (d && Array.isArray(d.versions)) {
          names = d.versions;
          loaderMap = d.loaderMap || {};
        }
        live.versions = names.map((n) => ({ id: n, name: n, loader: loaderMap[n] || "", loaderVersion: "" }));
        if (!live.selectedVersionId || !names.includes(live.selectedVersionId)) {
          live.selectedVersionId = names[0] || "";
        }
        const cur = live.versions.find((v) => v.id === live.selectedVersionId);
        live.currentVersion = cur ? [cur.name, cur.loader].filter(Boolean).join("  ") : "";
        rebuildSoft();
      };
      window.onAppVersion = (d) => {
        live.appVersion = typeof d === "string" ? d : d?.version || "";
      };
      window.onMsLoginSuccess = (d) => {
        if (!d || !d.ok) return;
        try {
          const accounts = JSON.parse(localStorage.getItem("accounts") || "[]");
          const idx = accounts.findIndex((a) => a.name === d.name);
          if (idx >= 0) {
            accounts[idx].type = "microsoft";
            accounts[idx].uuid = d.uuid;
            localStorage.setItem("currentAccount", String(idx));
          } else {
            accounts.push({ name: d.name, type: "microsoft", uuid: d.uuid });
            localStorage.setItem("currentAccount", String(accounts.length - 1));
          }
          localStorage.setItem("accounts", JSON.stringify(accounts));
        } catch (e) {
          console.warn("[ms] save account failed", e);
        }
        modal = null;
        accountPanelOpen = false;
        msUserCode = "";
        msStatus = "";
        live.hasAccount = true;
        loadAccount();
        build(true);
      };
      window.onMsLoginDeviceCode = (d) => {
        if (d && d.ok) {
          msUserCode = d.userCode || "";
          msUri = d.verificationUri || "";
          msStatus = "";
        } else {
          msStatus = d && d.error || "\u83B7\u53D6\u9A8C\u8BC1\u7801\u5931\u8D25";
        }
        if (modal === "mslogin") build();
      };
      window.onMsLoginFailed = (d) => {
        msStatus = d && d.error || "\u767B\u5F55\u5931\u8D25";
        if (modal === "mslogin") build();
      };
      window.onMsAccounts = (d) => {
        const list = Array.isArray(d) ? d : d?.accounts || [];
        if (!list.length) return;
        try {
          const accounts = JSON.parse(localStorage.getItem("accounts") || "[]");
          let changed = false;
          for (const a of list) {
            if (!a || !a.name) continue;
            const i = accounts.findIndex((x) => x.name === a.name);
            if (i >= 0) {
              if (accounts[i].type !== "microsoft" || accounts[i].uuid !== a.uuid) {
                accounts[i].type = "microsoft";
                accounts[i].uuid = a.uuid || "";
                changed = true;
              }
            } else {
              accounts.push({ name: a.name, type: "microsoft", uuid: a.uuid || "" });
              changed = true;
            }
          }
          if (changed) {
            localStorage.setItem("accounts", JSON.stringify(accounts));
            if (!localStorage.getItem("currentAccount")) {
              localStorage.setItem("currentAccount", String(accounts.length - 1));
            }
            loadAccount();
            build(true);
          }
        } catch (e) {
          console.warn("[ms] sync accounts failed", e);
        }
      };
      window.onSystemMemory = () => {
      };
      function safeParse(s) {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      }
      function loadAccount() {
        try {
          const accounts = JSON.parse(localStorage.getItem("accounts") || "[]");
          const raw = localStorage.getItem("currentAccount");
          let idx = raw === "null" || raw === null ? null : parseInt(raw);
          if (idx === null && accounts.length) idx = 0;
          if (idx !== null && (idx < 0 || idx >= accounts.length)) idx = accounts.length ? 0 : null;
          const acc = idx !== null ? accounts[idx] : null;
          if (!acc) {
            live.hasAccount = false;
            return;
          }
          live.hasAccount = true;
          if (acc.name) live.playerName = acc.name;
          live.premium = acc.type === "microsoft";
          if (acc.uuid) {
            pendingAvatarUuid = acc.uuid;
            post({ action: "fetch_avatar", uuid: acc.uuid });
          } else {
            pendingAvatarUuid = "";
            live.avatarDataUri = "";
            avatarImg.src = "steve.png";
          }
          try {
            const sv = localStorage.getItem("selectedVersion");
            if (sv) live.selectedVersionId = sv;
          } catch {
          }
        } catch (e) {
          console.warn("[account] read failed", e);
          live.hasAccount = false;
        }
      }
      function rebuildSoft() {
        if (!live.ready) return;
        build();
      }
      var page = "home";
      var modal = null;
      var expanded = false;
      var pageEls = [];
      var panelEls = [];
      var modalEls = [];
      var playedEnter = /* @__PURE__ */ new Set();
      var TAB_GROUP = "tabs6";
      var TAB_COUNT = 6;
      function onTabSelect(patch) {
        const i = typeof patch === "number" ? patch : patch?.selectedTab2;
        if (typeof i !== "number" || state.selectedTab2 === i) return;
        state.selectedTab2 = i;
        renderer.setTabSelected(TAB_GROUP, i, TAB_COUNT);
        const next = i === 1 ? "online" : i === 2 ? "download" : i === 5 ? "about" : i === 3 ? "skin" : "home";
        if (next !== page) {
          page = next;
          modal = null;
          dlPanel = null;
          dl.picked = false;
          if (next === "download") loadMcVersions();
          build();
          animateEnter(pageEls, 380);
          renderer.setTabSelected(TAB_GROUP, i, TAB_COUNT);
        }
      }
      function cropSkinHead(imgUrl) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          if (!imgUrl.startsWith("data:")) img.crossOrigin = "anonymous";
          img.onload = () => {
            try {
              const scale = img.width >= 128 ? 2 : 1;
              const unit = 8 * scale;
              const OUT = 128;
              const faceSize = 112;
              const faceOffset = (OUT - faceSize) / 2;
              const cv = document.createElement("canvas");
              cv.width = OUT;
              cv.height = OUT;
              const ctx = cv.getContext("2d");
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, 8 * scale, 8 * scale, unit, unit, faceOffset, faceOffset, faceSize, faceSize);
              if (img.width >= 64) {
                const hatSize = Math.round(faceSize * 1.125);
                const offsetX = (OUT - hatSize) / 10;
                const offsetY = faceOffset + faceSize - hatSize + 10;
                ctx.drawImage(img, 40 * scale, 8 * scale, unit, unit, offsetX, offsetY, hatSize, hatSize);
              }
              resolve(cv.toDataURL("image/png"));
            } catch (e) {
              reject(e);
            }
          };
          img.onerror = reject;
          img.src = imgUrl;
        });
      }
      function syncExpandSvgPos() {
        const btn = elements.find((e) => e.id === "expand-btn");
        const svg = document.querySelector("#svgLayer svg");
        if (!svg) return;
        if (!btn) {
          svg.style.display = "none";
          return;
        }
        svg.style.display = "block";
        svg.style.left = btn.rect.x + btn.rect.w / 2 - 9 + "px";
        svg.style.top = btn.rect.y + btn.rect.h / 2 - 9 + "px";
      }
      function placeExpandSvg(rect, rotated) {
        const layer = document.getElementById("svgLayer");
        if (!layer) return;
        let svg = layer.querySelector("svg");
        if (!rect) {
          if (svg) svg.style.display = "none";
          return;
        }
        if (!svg) {
          layer.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z" fill="rgba(0,0,0,0.78)"/></svg>';
          svg = layer.querySelector("svg");
        }
        svg.style.display = "block";
        svg.style.left = rect.x + rect.w / 2 - 9 + "px";
        svg.style.top = rect.y + rect.h / 2 - 9 + "px";
        svg.style.transform = rotated ? "rotate(-90deg)" : "rotate(0deg)";
      }
      function placeAvatar(r, radius) {
        avatarWrap.style.left = r.x + "px";
        avatarWrap.style.top = r.y + "px";
        avatarWrap.style.width = r.w + "px";
        avatarWrap.style.height = r.h + "px";
        avatarWrap.style.borderRadius = radius + "px";
      }
      var AVATAR = 72;
      var CAP_W = 240;
      var CAP_H = 42;
      var START_H = 58;
      var BTN_D = 34;
      var CHEVRON_DOWN = "M4 8h16l-8 9z";
      var PANEL_W = 400;
      var versionPanelOpen = false;
      var versionSettingsOpen = false;
      var versionSettingsId = "";
      var versionSettingsTab = "mods";
      var vsetFiles = [];
      var vsetLoading = false;
      var vsetScrollY = 0;
      var vsetTargetScroll = 0;
      var vsetMaxScroll = 0;
      var vsetListTop = 0;
      var vsetListH = 0;
      var vsetAnim = 0;
      var vsetItems = [];
      var vsetIconData = [];
      var vsetPendingDeleteFile = "";
      var vsetJavaLoaded = false;
      var vsetJavaPath = "";
      var vsetDeleteConfirm = false;
      var listScrollY = 0;
      var targetScrollY = 0;
      var scrollAnim = 0;
      var selectedCategory = "all";
      var accountPanelOpen = false;
      var dlPanel = null;
      var msUserCode = "";
      var msUri = "";
      var msStatus = "";
      var panelListTop = 0;
      var panelListH = 0;
      var panelMaxScroll = 0;
      var listItems = [];
      function layoutHome() {
        const panelOpen = versionPanelOpen || accountPanelOpen;
        const availW = panelOpen ? W - PANEL_W - 48 : W;
        const cx = availW / 2;
        if (!live.hasAccount) {
          const btnW = 300, btnH = 56, gap = 14;
          const totalH2 = AVATAR + 18 + 26 + 18 + btnH + gap + btnH;
          let y2 = (H - totalH2) / 2 - 40;
          const avatar2 = { x: cx - AVATAR / 2, y: y2, w: AVATAR, h: AVATAR };
          y2 += AVATAR + 18;
          const hint = { x: cx - btnW / 2, y: y2, w: btnW, h: 26 };
          y2 += 26 + 18;
          const offlineBtn = { x: cx - btnW / 2, y: y2, w: btnW, h: btnH };
          y2 += btnH + gap;
          const msBtn = { x: cx - btnW / 2, y: y2, w: btnW, h: btnH };
          return { avatar: avatar2, hint, nameCap: null, expandBtn: null, verCap: null, offlineBtn, msBtn };
        }
        const totalH = AVATAR + 22 + CAP_H + 16 + START_H;
        let y = (H - totalH) / 2 - 40;
        const avatar = { x: cx - AVATAR / 2, y, w: AVATAR, h: AVATAR };
        y += AVATAR + 22;
        const nameCap = { x: cx - CAP_W / 2, y, w: CAP_W, h: CAP_H };
        const expandBtn = { x: nameCap.x + nameCap.w - BTN_D - 6, y: nameCap.y + (CAP_H - BTN_D) / 2, w: BTN_D, h: BTN_D };
        y += CAP_H + 16;
        const startBtn = { x: cx - CAP_W / 2, y, w: CAP_W, h: START_H };
        return { avatar, nameCap, expandBtn, startBtn, verChip: null, verCap: null, hint: null, offlineBtn: null, msBtn: null };
      }
      function updateLaunchRing(btn, pct) {
        const svg = document.getElementById("launchRingSvg");
        const rect = document.getElementById("launchRingRect");
        if (!svg || !rect) return;
        
        // 如果当前不在主页，或者没在启动，直接隐藏并返回
        if (typeof page !== "undefined" && page !== "home") {
          svg.style.display = "none";
          return;
        }
        
        const barH = 9;
        const barW = btn.w + 40;
        const barX = btn.x - 20;
        const barY = btn.y - 6;
        
        svg.style.display = "block";
        svg.setAttribute("width", barW);
        svg.setAttribute("height", barH);
        svg.style.left = barX + "px";
        svg.style.top = barY + "px";
        svg.style.transition = "opacity 0.3s ease";
        svg.style.opacity = "1";
        
        rect.setAttribute("x", 0);
        rect.setAttribute("y", 0);
        rect.setAttribute("width", barW);
        rect.setAttribute("height", barH);
        rect.setAttribute("rx", barH / 2);
        rect.setAttribute("ry", barH / 2);
        rect.setAttribute("stroke-linejoin", "round");
        rect.setAttribute("stroke-width", 0);
        rect.setAttribute("stroke", "none");
        rect.setAttribute("fill", "rgba(255,255,255,0.95)");
        rect.setAttribute("style", "filter: drop-shadow(0 0 4px rgba(255,255,255,0.4));");
        
        const p = Math.max(0, Math.min(1, pct / 100));
        const actualP = p <= 0.01 ? 0 : p;
        rect.setAttribute("transform-origin", "left center");
        rect.style.transform = "scaleX(" + actualP + ")";
        rect.style.transition = "transform 0.2s ease-out";
      }
      function buildHome() {
        const L = layoutHome();
        const els = [];
        const inter = {};
        if (!live.hasAccount) {
          const hint = makeText("no-account", L.hint, "\u672A\u767B\u5F55", {
            color: [1, 1, 1, 0.94],
            fontSizePx: 15,
            letterSpacingPx: trackFor(15),
            fontWeight: 700,
            align: "center",
            paddingPx: 0
          }, false);
          const offlineBtn = makeButton("btn-offline", L.offlineBtn, {
            label: "\u6DFB\u52A0\u79BB\u7EBF\u8D26\u6237",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: BLACK
          }, false);
          offlineBtn.noPressMove = true;
          const msBtn = makeButton("btn-ms", L.msBtn, {
            label: "\u6DFB\u52A0\u6B63\u7248\u8D26\u6237",
            tintColor: BLUE,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: WHITE
          }, false);
          msBtn.noPressMove = true;
          els.push(hint, offlineBtn, msBtn);
          inter["btn-offline"] = { onTap: () => openModal("offline") };
          inter["btn-ms"] = { onTap: () => startMsLogin() };
          placeAvatar(L.avatar, 0);
          placeExpandSvg(null, false);
          return { els, inter };
        }
        const nameGlass = makeButton("name-cap", L.nameCap, {
          label: "",
          tintColor: CLEAR,
          surfaceColor: [1, 1, 1, 0.12],
          labelColor: BLACK
        }, false);
        nameGlass.noPressMove = true;
        const nameText = makeText("name-text", {
          x: L.nameCap.x,
          y: L.nameCap.y,
          w: L.nameCap.w - BTN_D - 14,
          h: L.nameCap.h
        }, live.playerName, { color: WHITE, fontSizePx: 17, letterSpacingPx: trackFor(17), fontWeight: 700, align: "center", paddingPx: 0 }, false);
        nameText.isInteractive = false;
        const expandBtn = makeButton("expand-btn", L.expandBtn, {
          label: "",
          tintColor: CLEAR,
          surfaceColor: [1, 1, 1, 0.22],
          labelColor: BLACK
        }, false);
        expandBtn.cornerRadius = BTN_D / 2;
        expandBtn.noPressStretch = true;
        els.push(nameGlass, nameText, expandBtn);
        placeExpandSvg(L.expandBtn, versionPanelOpen);
        const startBtn = makeButton("btn-start", L.startBtn, {
          label: "",
          tintColor: BLUE,
          surfaceColor: [1, 1, 1, 0.12],
          labelColor: WHITE
        }, false);
        startBtn.noPressMove = true;
        const startTitle = makeText("start-title", {
          x: L.startBtn.x,
          y: L.startBtn.y + 7,
          w: L.startBtn.w,
          h: 28
        }, "\u5F00\u59CB\u6E38\u620F", {
          color: WHITE,
          fontSizePx: 17,
          letterSpacingPx: trackFor(17),
          fontWeight: 700,
          align: "center",
          paddingPx: 0
        }, false);
        startTitle.isInteractive = false;
        const startVer = makeText("start-ver", {
          x: L.startBtn.x,
          y: L.startBtn.y + 33,
          w: L.startBtn.w,
          h: 19
        }, live.currentVersion || "\u672A\u9009\u62E9\u7248\u672C", {
          color: [1, 1, 1, 0.78],
          fontSizePx: 11,
          letterSpacingPx: trackFor(11),
          fontWeight: 600,
          align: "center",
          paddingPx: 0
        }, false);
        startVer.isInteractive = false;
        if (window.launching.on) {
          const pctNum = Math.max(0, Math.min(100, window.launching.percent));
          // 调用更新，此时已经变成直线
          updateLaunchRing(L.startBtn, pctNum);
          
          const pctDom = document.getElementById("launchPctDom");
          const msgDom = document.getElementById("launchMsgDom");
          if (pctDom) {
            pctDom.style.display = "block";
            pctDom.style.left = L.startBtn.x + "px";
            pctDom.style.top = (L.startBtn.y + 28) + "px";
            pctDom.style.width = L.startBtn.w + "px";
            pctDom.textContent = Math.round(window.launching.percent) + "%";
          }
          if (msgDom) {
            msgDom.style.display = "block";
            msgDom.style.left = L.startBtn.x + "px";
            msgDom.style.top = (L.startBtn.y + 58) + "px";
            msgDom.style.width = L.startBtn.w + "px";
            msgDom.textContent = window.launching.message || "正在启动…";
          }
          
          // 不 push startBtn 和 startTitle 和 startVer，让它们隐藏
          
          const cancelH = 34;
          const fullW = L.startBtn.w;
          const cancelBtn = makeButton("launch-cancel", { x: L.startBtn.x, y: L.startBtn.y + L.startBtn.h + 36, w: fullW, h: cancelH }, {
            label: "取消启动",
            labelFontSizePx: 12,
            tintColor: [1, 0.3, 0.3, 0.35],
            surfaceColor: [1, 0.3, 0.3, 0.55],
            labelColor: WHITE
          }, false);
          if (!launching._cancelShown) {
            launching._cancelShown = true;
            cancelBtn.enterProgress = 0;
            requestAnimationFrame(() => {
              const t0 = performance.now();
              const fade = () => {
                const t = Math.min(1, (performance.now() - t0) / 350);
                cancelBtn.enterProgress = t;
                renderer.setElements(elements);
                renderer.requestRender();
                if (t < 1) requestAnimationFrame(fade);
                else cancelBtn.enterProgress = null;
              };
              requestAnimationFrame(fade);
            });
          }
          els.push(cancelBtn);
          inter["launch-cancel"] = { onTap: () => {
            post({ action: "cancel_launch" });
            window.launching.on = false;
            launching._cancelShown = false;
            launching.percent = 0;
            launching.message = "";
            const svg = document.getElementById("launchRingSvg");
            if (svg) svg.style.display = "none";
            build(true);
          } };
        } else {
          const svg = document.getElementById("launchRingSvg");
          if (svg) svg.style.display = "none";
          const pctDom = document.getElementById("launchPctDom");
          const msgDom = document.getElementById("launchMsgDom");
          if (pctDom) pctDom.style.display = "none";
          if (msgDom) msgDom.style.display = "none";
          els.push(startBtn, startTitle, startVer);
        }
        if (expanded) {
        }
        placeAvatar(L.avatar, 0);
        return {
          els,
          inter: {
            "name-cap": { onTap: () => {
              accountPanelOpen = true;
              versionPanelOpen = false;
              build(true);
            } },
            "expand-btn": { onTap: () => {
              versionPanelOpen = !versionPanelOpen;
              accountPanelOpen = false;
              listScrollY = 0;
              targetScrollY = 0;
              build(true);
            } },
            "btn-start": { onTap: () => launchGame() },
            ...inter
          }
        };
      }
      window.launching = { on: false, percent: 0, message: "" };
      var launchBreathToken = 0;
      function startLaunchBreath() {}
      window._launchFakeInterval = 0;
      window._launchUiRaf = 0;
      
      window.onLaunchProgress = (d) => {
        const launching = window.launching;
        console.log("[launch-progress]", JSON.stringify(d));
        if (!d) return;
        // 启动游戏时，强制把下载状态重置为 idle（避免误触发 onDownloadProgress）
        if (dl.phase === "installing") {
          dl.phase = "idle";
          dl.percent = 0;
          dl.message = "";
        }
        // 取消 / 失败：重置
        if (d.cancelled || d.failed) {
          if (_launchFakeInterval) { clearInterval(_launchFakeInterval); _launchFakeInterval = 0; }
          launchBreathToken++;
          launching.on = false;
          launching._cancelShown = false;
          launching.percent = 0;
          launching.message = "";
          const svg = document.getElementById("launchRingSvg");
          if (svg) svg.style.display = "none";
          build(true);
          return;
        }
        launching.on = true;
        const rawPct = typeof d.percent === "number" ? d.percent : parseFloat(d.percent);
        launching.percent = isNaN(rawPct) ? 0 : Math.max(0, Math.min(100, rawPct));
        if (d.message) launching.message = String(d.message);
        // 98% 后模拟爬行
        if (launching.percent >= 98 && launching.percent < 100 && !_launchFakeInterval) {
          _launchFakeInterval = setInterval(() => {
            if (!launching.on) { clearInterval(_launchFakeInterval); _launchFakeInterval = 0; return; }
            if (launching.percent < 99.9) {
              launching.percent = Math.min(99.9, launching.percent + 0.05);
              const Lh = layoutHome();
              if (Lh.startBtn) updateLaunchRing(Lh.startBtn, launching.percent);
              for (const el of elements) {
                if (el.id === "launch-pct" && el.text) el.text.content = launching.percent.toFixed(1) + "%";
                else if (el.id === "launch-msg" && el.text) el.text.content = "游戏初始化中…";
              }
              renderer.setElements(elements);
              renderer.requestRender();
            }
          }, 100);
        }
        if (launching.percent >= 100) {
          if (_launchFakeInterval) { clearInterval(_launchFakeInterval); _launchFakeInterval = 0; }
        }
        if (!_launchUiRaf) {
          _launchUiRaf = requestAnimationFrame(() => {
            _launchUiRaf = 0;
            const Lh = layoutHome();
            if (Lh.startBtn) updateLaunchRing(Lh.startBtn, launching.percent);
            
            const pctDom = document.getElementById("launchPctDom");
            const msgDom = document.getElementById("launchMsgDom");
            if (pctDom && pctDom.style.display !== "none") {
              pctDom.textContent = Math.round(launching.percent) + "%";
            }
            if (msgDom && msgDom.style.display !== "none") {
              msgDom.textContent = launching.message || "正在启动…";
            }
          });
        }
        if (d.done) {
          if (_launchFakeInterval) { clearInterval(_launchFakeInterval); _launchFakeInterval = 0; }
          setTimeout(() => {
            launchBreathToken++;
            launching.on = false;
            launching._cancelShown = false;
            launching.percent = 0;
            launching.message = "";
            // 游戏启动完成后，确保下载状态也重置
            if (dl.phase === "installing") {
              dl.phase = "idle";
              dl.percent = 0;
            }
            build(true);
          }, 1600);
        }
      };
      function launchGame() {
        if (!live.hasAccount) {
          openModal("offline");
          return;
        }
        const vid = live.selectedVersionId;
        if (!vid) {
          console.log("[launch] no version selected");
          return;
        }
        window.launching.on = true;
        window.launching._cancelShown = false;
        window.launching.percent = 0;
        window.launching.message = "\u6B63\u5728\u51C6\u5907\u2026";
        build(true);
        startLaunchBreath();
        post({ action: "launch_mc", versionId: vid, username: live.playerName, skinId: skAppliedId() || live.skinId || "" });
      }
      var segIndOf = (id) => elements.find((e) => e.id === id + "-ind");
      function applySegPress(id, pressed) {
        const ind = segIndOf(id);
        if (!ind) return;
        if (!ind._base) {
          ind._base = { x: ind.rect.x, y: ind.rect.y, w: ind.rect.w, h: ind.rect.h, ref: ind.refractionAmount, rh: ind.refractionHeight };
        }
        const b = ind._base;
        if (pressed) {
          const s = 1.1;
          const w = b.w * s, h = b.h * s;
          ind.rect.x = b.x + (b.w - w) / 2;
          ind.rect.y = b.y + (b.h - h) / 2;
          ind.rect.w = w;
          ind.rect.h = h;
          ind.refractionAmount = b.ref * 1.9;
          ind.refractionHeight = b.rh * 1.5;
        } else {
          ind.rect.x = b.x;
          ind.rect.y = b.y;
          ind.rect.w = b.w;
          ind.rect.h = b.h;
          ind.refractionAmount = b.ref;
          ind.refractionHeight = b.rh;
        }
        pushElements();
      }
      var startSegPress = (id) => applySegPress(id, true);
      var stopSegPress = (id) => applySegPress(id, false);
      var segIndicatorX = /* @__PURE__ */ new Map();
      var listEnterPending = false;
      function svgDataUri(paths, stroke) {
        const c = stroke || "#ffffff";
        let body = "";
        for (const p of paths) {
          if (p.t === "path") body += '<path d="' + p.d + '"/>';
          else if (p.t === "circle") body += '<circle cx="' + p.cx + '" cy="' + p.cy + '" r="' + p.r + '"/>';
          else if (p.t === "rect") body += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="' + (p.rx || 0) + '"/>';
          else if (p.t === "line") body += '<line x1="' + p.x1 + '" y1="' + p.y1 + '" x2="' + p.x2 + '" y2="' + p.y2 + '"/>';
          else if (p.t === "polyline") body += '<polyline points="' + p.points + '"/>';
        }
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
        return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
      }
      const VSVG = {
        mods: [
          { t: "path", d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" },
          { t: "path", d: "m3.3 7 8.7 5 8.7-5" },
          { t: "path", d: "M12 22V12" }
        ],
        resourcepacks: [
          { t: "rect", x: 3, y: 3, w: 18, h: 18, rx: 2 },
          { t: "path", d: "M3 9h18" },
          { t: "path", d: "M9 21V9" }
        ],
        shaderpacks: [
          { t: "circle", cx: 12, cy: 12, r: 4 },
          { t: "path", d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" }
        ],
        setting: [
          { t: "circle", cx: 12, cy: 12, r: 3 },
          { t: "path", d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" }
        ],
        trash: [
          { t: "polyline", points: "3 6 5 6 21 6" },
          { t: "path", d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" },
          { t: "line", x1: 10, y1: 11, x2: 10, y2: 17 },
          { t: "line", x1: 14, y1: 11, x2: 14, y2: 17 }
        ],
        question: [
          { t: "circle", cx: 12, cy: 12, r: 9 },
          { t: "path", d: "M9.1 9.2a2.9 2.9 0 1 1 4.4 2.6c-.9.5-1.5 1.1-1.5 2.2" },
          { t: "path", d: "M12 17.3h.01" }
        ]
      };
      const VSVG_URL = {};
      for (const k in VSVG) VSVG_URL[k] = svgDataUri(VSVG[k], "#ffffff");
      const VSVG_URL_BLUE = {};
      for (const k in VSVG) VSVG_URL_BLUE[k] = svgDataUri(VSVG[k], "#2b87ff");
      var VSET_TABS = [
        { key: "mods", icon: "mods", tip: "模组管理" },
        { key: "resourcepacks", icon: "resourcepacks", tip: "材质包管理" },
        { key: "shaderpacks", icon: "shaderpacks", tip: "光影管理" },
        { key: "setting", icon: "setting", tip: "版本设置" },
        { key: "delete", icon: "trash", tip: "版本删除" }
      ];
      function buildVersionSettings(px, py, ph) {
        ph = ph + 30;
        const els = [];
        const inter = {};
        const sp0 = document.getElementById("vsetSpin");
        if (sp0) sp0.style.display = "none";
        const nameInput = document.getElementById("vsetNameInput");
        if (nameInput) nameInput.style.display = "none";
        const pw = PANEL_W + 60;
        px = W - pw - 20;
        const cur = (live.versions || []).find((v) => (v.id || v.name || "") === versionSettingsId) || {};
        const vname = cur.name || versionSettingsId || "未知版本";
        els.push(makeGlassShape("ver-panel", { x: px, y: py, w: pw, h: ph }, {
          cornerRadius: 32, refractionHeight: 18, refractionAmount: -26,
          blurRadius: 4, saturation: 1.7, brightness: 0.05, surfaceColor: [1, 1, 1, 0.12]
        }, false));
        const backR = { x: px + 14, y: py + 12, w: 32, h: 32 };
        const backIco = makeText("vset-back-ico", backR, "", {
          icon: { path: ICON_BACK, size: 20, viewport: 24, color: [1, 1, 1, 0.85] },
          align: "center", paddingPx: 0
        }, false);
        backIco.isInteractive = true;
        els.push(backIco);
        inter["vset-back-ico"] = { onTap: () => { 
          versionSettingsOpen = false; 
          const ni = document.getElementById("vsetNameInput");
          if (ni) ni.style.display = "none";
          build(); 
        } };
        els.push(makeText("vset-title", { x: px + 54, y: py + 14, w: pw - 110, h: 30 }, "版本设置 · " + vname, {
          color: WHITE, fontSizePx: 18, letterSpacingPx: trackFor(18), fontWeight: 700, align: "left", paddingPx: 0
        }, false));
        const closeR = { x: px + pw - 54, y: py + 10, w: 38, h: 38 };
        els.push(makeButton("vset-close", closeR, {
          label: "", tintColor: [1, 0.3, 0.3, 0.35], surfaceColor: [1, 0.3, 0.3, 0.5], labelColor: WHITE
        }, false));
        els.push(makeText("vset-close-ico", closeR, "", {
          icon: { path: ICON_CLOSE, size: 20, viewport: 24, color: [1, 1, 1, 0.92] }, align: "center"
        }, false));
        inter["vset-close"] = { onTap: () => { 
          versionSettingsOpen = false; 
          versionPanelOpen = false; 
          const ni = document.getElementById("vsetNameInput");
          if (ni) ni.style.display = "none";
          build(); 
        } };
        const tabH = 40;
        const tabY = py + 56;
        {
          const seg = buildTabCapsule({
            prefix: "vset-tabs",
            x: px + 16, y: tabY, w: pw - 32, h: tabH,
            indicatorInset: 8,
            items: VSET_TABS.map((t) => ({ key: t.key, tip: t.tip })),
            activeKey: versionSettingsTab,
            onSelect: (k, i) => {
              versionSettingsTab = k;
              vsetFiles = [];
              vsetLoading = false;
              vsetPendingDeleteFile = "";
              vsetDeleteConfirm = false;
              vsetScrollY = 0;
              vsetTargetScroll = 0;
              vsetJavaLoaded = false;
              vsetJavaPath = "";
              // 切换 Tab 时强制隐藏名字输入框
              const ni = document.getElementById("vsetNameInput");
              if (ni) ni.style.display = "none";
              build();
              try { renderer.setTabSelected("vset-tabs", i, VSET_TABS.length); } catch (e) {}
            }
          });
          els.push(...seg.els);
          Object.assign(inter, seg.inter);
        }
        const cellW = (pw - 32) / VSET_TABS.length;
        VSET_TABS.forEach((t, i) => {
          const iw = 22, ih = 22;
          pendingIcons.push({
            src: versionSettingsTab === t.key ? VSVG_URL_BLUE[t.icon] : VSVG_URL[t.icon],
            rect: { x: px + 16 + i * cellW + cellW / 2 - iw / 2, y: tabY + (tabH - ih) / 2, w: iw, h: ih }
          });
        });
        const bodyY = tabY + tabH + 22;
        const bodyH = py + ph - bodyY - 16;
        els.push(makeGlassShape("vset-body", { x: px + 16, y: bodyY, w: pw - 32, h: bodyH }, {
          cornerRadius: 20, refractionHeight: 10, refractionAmount: -14,
          blurRadius: 3, saturation: 1.4, brightness: 0.03, surfaceColor: [1, 1, 1, 0.08]
        }, false));
        const tabLabel = (VSET_TABS.find((t) => t.key === versionSettingsTab) || {}).tip || "";
        const isFileTab = ["mods", "resourcepacks", "shaderpacks"].includes(versionSettingsTab);
        vsetIconData = [];
        if (versionSettingsTab === "delete") {
          const hintY = bodyY + bodyH / 2 - 70;
          els.push(makeText("vset-del-hint", { x: px + 16, y: hintY, w: pw - 32, h: 30 }, "确定要删除整个版本文件夹吗？", {
            color: [1, 1, 1, 0.82], fontSizePx: 15, fontWeight: 700, align: "center", paddingPx: 0
          }, false));
          els.push(makeText("vset-del-sub", { x: px + 16, y: hintY + 34, w: pw - 32, h: 26 }, "此操作不可恢复，将删除该版本的所有文件", {
            color: [1, 1, 1, 0.42], fontSizePx: 12, align: "center", paddingPx: 0
          }, false));
          const delBigR = { x: px + pw / 2 - 90, y: hintY + 74, w: 180, h: 44 };
          els.push(makeButton("vset-del-version", delBigR, {
            label: "删除此版本", labelFontSizePx: 14,
            tintColor: [1, 0.3, 0.3, 0.4], surfaceColor: [1, 0.3, 0.3, 0.88], labelColor: WHITE
          }, false));
          inter["vset-del-version"] = { onTap: () => { vsetDeleteConfirm = true; build(); } };
          if (vsetDeleteConfirm) {
            const okR = { x: px + pw / 2 - 150, y: hintY + 134, w: 140, h: 44 };
            els.push(makeButton("vset-del-ok", okR, {
              label: "确认删除", labelFontSizePx: 14,
              tintColor: [1, 0.2, 0.2, 0.5], surfaceColor: [1, 0.2, 0.2, 0.95], labelColor: WHITE
            }, false));
            const cancelR = { x: px + pw / 2 + 10, y: hintY + 134, w: 140, h: 44 };
            els.push(makeButton("vset-del-cancel", cancelR, {
              label: "取消", labelFontSizePx: 14,
              tintColor: [1, 1, 1, 0.18], surfaceColor: [1, 1, 1, 0.24], labelColor: WHITE
            }, false));
            inter["vset-del-ok"] = { onTap: () => {
              vsetDeleteConfirm = false;
              post({ action: "delete_version", versionId: versionSettingsId });
            } };
            inter["vset-del-cancel"] = { onTap: () => { vsetDeleteConfirm = false; build(); } };
          }
        } else if (versionSettingsTab === "setting") {
          const sx = px + 30;
          const sw = pw - 60;
          const contentH = 42 + 78 + 50 + 42 + 42 + 44;
          let sy = bodyY + Math.max(10, (bodyH - contentH) / 2);
          if (!vsetJavaLoaded) {
            vsetJavaLoaded = true;
            post({ action: "load_version_config", versionId: versionSettingsId });
          }
          const gs = (id, r, color, cr) => {
            const g = makeGlassShape(id, r, {
              cornerRadius: cr == null ? 14 : cr, refractionHeight: 8, refractionAmount: -12,
              blurRadius: 3, saturation: 1.4, brightness: 0.03, surfaceColor: color
            }, false);
            els.push(g);
            return g;
          };
          // Row1: 名称 + 保存
          gs("vset-name-bg", { x: sx, y: sy, w: sw - 78, h: 36 }, [1, 1, 1, 0.1]);
          if (nameInput) {
            nameInput.style.display = "block";
            nameInput.style.opacity = "1";
            nameInput.style.left = (sx + 14) + "px";
            nameInput.style.top = (sy + 7) + "px";
            nameInput.style.width = (sw - 78 - 28) + "px";
            nameInput.style.height = "22px";
            nameInput.value = (typeof customVersionNames !== "undefined" && customVersionNames[versionSettingsId]) || "";
          }
          els.push(makeButton("vset-name-save", { x: sx + sw - 70, y: sy, w: 70, h: 36 }, {
            label: "保存", labelFontSizePx: 12, tintColor: [0.2, 0.52, 1, 0.35], surfaceColor: [0.2, 0.52, 1, 0.85], labelColor: WHITE
          }, false));
          sy += 42;
          // Row2: 图标方块 + 两个按钮
          gs("vset-icon-box", { x: sx, y: sy, w: 70, h: 70 }, [1, 1, 1, 0.12], 16);
          const iconSrc = (typeof customVersionNames !== "undefined" && customVersionNames["icon_" + versionSettingsId]) || "grass_block.png";
          pendingIcons.push({ src: iconSrc, rect: { x: sx + 12, y: sy + 12, w: 46, h: 46 } });
          els.push(makeButton("vset-icon-pick", { x: sx + 78, y: sy, w: sw - 78, h: 33 }, {
            label: "保存图片", labelFontSizePx: 12, tintColor: [1, 1, 1, 0.16], surfaceColor: [1, 1, 1, 0.24], labelColor: WHITE
          }, false));
          els.push(makeButton("vset-icon-reset", { x: sx + 78, y: sy + 37, w: sw - 78, h: 33 }, {
            label: "恢复", labelFontSizePx: 12, tintColor: [1, 0.3, 0.3, 0.2], surfaceColor: [1, 0.3, 0.3, 0.4], labelColor: WHITE
          }, false));
          sy += 78;
          // Row3: 滑块
          try {
            if (window.__addSlider) {
              const curScale = (customVersionNames["scale_" + versionSettingsId] || 1);
              const s = window.__addSlider({
                id: "vset-scale", x: sx + 10, y: sy + 12, w: sw - 20,
                value: Math.max(0, Math.min(1, (curScale - 0.5) / 1.5)),
                onChange: (f) => {
                  const sc = 0.5 + f * 1.5;
                  customVersionNames["scale_" + versionSettingsId] = sc;
                  saveCustomVersionNames();
                  build();
                }
              });
              if (s && s.elements) { els.push(...s.elements); Object.assign(inter, s.interactions || {}); }
            }
          } catch (e) {}
          sy += 50;
          // Row4: Java 路径条
          gs("vset-java-bg", { x: sx, y: sy, w: sw, h: 36 }, [1, 1, 1, 0.1]);
          els.push(makeText("vset-java-path", { x: sx + 14, y: sy, w: sw - 28, h: 36 }, vsetJavaPath || "未指定（使用全局）", {
            color: [1, 1, 1, vsetJavaPath ? 0.85 : 0.55], fontSizePx: 12, align: "left", paddingPx: 0
          }, false));
          sy += 42;
          // Row5: 三个按钮
          const bw = (sw - 16) / 3;
          els.push(makeButton("vset-java-reset", { x: sx, y: sy, w: bw, h: 34 }, {
            label: "恢复全局", labelFontSizePx: 11, tintColor: [1, 0.3, 0.3, 0.25], surfaceColor: [1, 0.3, 0.3, 0.5], labelColor: WHITE
          }, false));
          els.push(makeButton("vset-java-exe", { x: sx + bw + 8, y: sy, w: bw, h: 34 }, {
            label: "选择EXE", labelFontSizePx: 11, tintColor: [1, 1, 1, 0.16], surfaceColor: [1, 1, 1, 0.24], labelColor: WHITE
          }, false));
          els.push(makeButton("vset-java-dir", { x: sx + (bw + 8) * 2, y: sy, w: bw, h: 34 }, {
            label: "选择目录", labelFontSizePx: 11, tintColor: [1, 1, 1, 0.16], surfaceColor: [1, 1, 1, 0.24], labelColor: WHITE
          }, false));
          sy += 42;
          // Row6: 导出条
          gs("vset-mrpack-bg", { x: sx, y: sy, w: sw, h: 44 }, [1, 1, 1, 0.1], 22);
          els.push(makeText("vset-mrpack-txt", { x: sx + 18, y: sy, w: sw - 110, h: 44 }, "导出整合包 mrpack", {
            color: [1, 1, 1, 0.9], fontSizePx: 13, fontWeight: 700, align: "left", paddingPx: 0
          }, false));
          els.push(makeButton("vset-mrpack-export", { x: sx + sw - 82, y: sy + 5, w: 72, h: 34 }, {
            label: "导出", labelFontSizePx: 12, tintColor: [1, 1, 1, 0.18], surfaceColor: [1, 1, 1, 0.3], labelColor: WHITE
          }, false));
          // ---- 名称保存 ----
          inter["vset-name-save"] = { onTap: () => {
            const v = nameInput ? nameInput.value.trim() : "";
            if (!v) return;
            customVersionNames[versionSettingsId] = v;
            saveCustomVersionNames();
            window.showToast("已重命名：" + v);
          } };
          // ---- 图标选择 ----
          inter["vset-icon-pick"] = { onTap: () => {
            post({ action: "pick_version_icon", versionId: versionSettingsId });
          } };
          // ---- 恢复默认图标 ----
          inter["vset-icon-reset"] = { onTap: () => {
            delete customVersionNames["icon_" + versionSettingsId];
            saveCustomVersionNames();
            build();
            window.showToast("已恢复默认图标");
          } };
          // ---- Java：恢复全局 ----
          inter["vset-java-reset"] = { onTap: () => {
            post({ action: "clear_version_java", versionId: versionSettingsId });
          } };
          // ---- Java：选择 EXE ----
          inter["vset-java-exe"] = { onTap: () => {
            post({ action: "pick_java_for_version", versionId: versionSettingsId });
          } };
          // ---- Java：选择目录 ----
          inter["vset-java-dir"] = { onTap: () => {
            post({ action: "pick_java_folder_for_version", versionId: versionSettingsId });
          } };
          // ---- 导出 mrpack ----
          inter["vset-mrpack-export"] = { onTap: () => {
            post({ action: "export_mrpack", versionId: versionSettingsId });
            window.showToast("正在导出 mrpack…");
          } };
        } else if (!isFileTab) {
          els.push(makeText("vset-body-hint", { x: px + 16, y: bodyY, w: pw - 32, h: bodyH }, tabLabel + "（待接入）", {
            color: [1, 1, 1, 0.45], fontSizePx: 14, letterSpacingPx: trackFor(14), fontWeight: 600, align: "center", paddingPx: 0
          }, false));
        } else if (vsetLoading) {
          els.push(makeText("vset-loading", { x: px + 16, y: bodyY, w: pw - 32, h: bodyH }, "正在扫描资源…", {
            color: [1, 1, 1, 0.45], fontSizePx: 14, align: "center", paddingPx: 0
          }, false));
          const sp = document.getElementById("vsetSpin");
          if (sp) {
            sp.style.display = "block";
            sp.style.left = (px + pw / 2 - 15) + "px";
            sp.style.top = (bodyY + bodyH / 2 - 38) + "px";
          }
        } else if (!vsetFiles.length) {
          els.push(makeText("vset-empty", { x: px + 16, y: bodyY, w: pw - 32, h: bodyH }, "还没有文件", {
            color: [1, 1, 1, 0.4], fontSizePx: 14, align: "center", paddingPx: 0
          }, false));
        } else {
          const clipR = { x: px + 26, y: bodyY + 10, w: pw - 52, h: bodyH - 20 };
          const rowH = 56, rowGap = 8;
          const contentH = vsetFiles.length * (rowH + rowGap) - rowGap;
          vsetMaxScroll = Math.max(0, contentH - clipR.h);
          if (vsetScrollY > vsetMaxScroll) vsetScrollY = vsetMaxScroll;
          if (vsetTargetScroll > vsetMaxScroll) vsetTargetScroll = vsetMaxScroll;
          vsetListTop = clipR.y;
          vsetListH = clipR.h;
          vsetItems = [];
          vsetFiles.forEach((f, i) => {
            const baseY = clipR.y + i * (rowH + rowGap);
            const ry = baseY - vsetScrollY;
            const rr = { x: clipR.x, y: ry, w: clipR.w, h: rowH };
            const rowGlass = makeGlassShape("vset-file-" + i, rr, {
              cornerRadius: 14, refractionHeight: 8, refractionAmount: -12,
              blurRadius: 3, saturation: 1.4, brightness: 0.03,
              surfaceColor: f.disabled ? [1, 1, 1, 0.05] : [1, 1, 1, 0.1]
            }, false);
            rowGlass.clipRect = { ...clipR };
            els.push(rowGlass);
            const iconR = { x: rr.x + 10, y: rr.y + (rowH - 38) / 2, w: 38, h: 38 };
            const iconSrc = f.icon || VSVG_URL.question;
            vsetIconData.push({ src: iconSrc, x: iconR.x, baseY: baseY + (rowH - 38) / 2, w: 38, h: 38 });
            const nmTxt = makeText("vset-file-n-" + i, { x: iconR.x + 48, y: rr.y, w: rr.w - 48 - 90, h: rowH }, f.displayName || f.fileName, {
              color: [1, 1, 1, f.disabled ? 0.45 : 0.9], fontSizePx: 13, fontWeight: 600, align: "left", paddingPx: 0
            }, false);
            nmTxt.clipRect = { ...clipR };
            els.push(nmTxt);
            const isPending = vsetPendingDeleteFile && vsetPendingDeleteFile === f.fileName;
            const rowItems = [rowGlass, nmTxt];
            if (isPending) {
              const cancelR = { x: rr.x + rr.w - 150, y: rr.y + (rowH - 30) / 2, w: 52, h: 30 };
              const cancelBtn = makeButton("vset-file-cancel-" + i, cancelR, {
                label: "取消", labelFontSizePx: 11,
                tintColor: [1, 1, 1, 0.18], surfaceColor: [1, 1, 1, 0.22], labelColor: [1, 1, 1, 0.9]
              }, false);
              cancelBtn.clipRect = { ...clipR };
              els.push(cancelBtn);
              const okR = { x: rr.x + rr.w - 90, y: rr.y + (rowH - 30) / 2, w: 76, h: 30 };
              const okBtn = makeButton("vset-file-ok-" + i, okR, {
                label: "确认删除", labelFontSizePx: 11,
                tintColor: [1, 0.3, 0.3, 0.4], surfaceColor: [1, 0.3, 0.3, 0.85], labelColor: WHITE
              }, false);
              okBtn.clipRect = { ...clipR };
              els.push(okBtn);
              rowItems.push(cancelBtn, okBtn);
              inter["vset-file-cancel-" + i] = { onTap: () => { vsetPendingDeleteFile = ""; build(); } };
              inter["vset-file-ok-" + i] = { onTap: () => {
                post({ action: "delete_file", versionId: versionSettingsId, folderType: versionSettingsTab, fileName: f.fileName });
                vsetPendingDeleteFile = "";
              } };
            } else {
              const metaTxt = makeText("vset-file-m-" + i, { x: rr.x + rr.w - 160, y: rr.y, w: 64, h: rowH }, (f.disabled ? "已禁用" : "已启用"), {
                color: [1, 1, 1, 0.4], fontSizePx: 10, align: "right", paddingPx: 0
              }, false);
              metaTxt.clipRect = { ...clipR };
              els.push(metaTxt);
              rowItems.push(metaTxt);
              const tglR = { x: rr.x + rr.w - 90, y: rr.y + (rowH - 30) / 2, w: 48, h: 30 };
              const tglBtn = makeButton("vset-file-tg-" + i, tglR, {
                label: f.disabled ? "启用" : "禁用", labelFontSizePx: 10,
                tintColor: f.disabled ? [0.2, 0.65, 1, 0.32] : [1, 1, 1, 0.16],
                surfaceColor: f.disabled ? [0.2, 0.65, 1, 0.72] : [1, 1, 1, 0.22],
                labelColor: [1, 1, 1, 0.92]
              }, false);
              tglBtn.clipRect = { ...clipR };
              els.push(tglBtn);
              const delR = { x: rr.x + rr.w - 38, y: rr.y + (rowH - 30) / 2, w: 30, h: 30 };
              const delBtn = makeButton("vset-file-del-" + i, delR, {
                label: "", tintColor: [1, 0.3, 0.3, 0.28], surfaceColor: [1, 0.3, 0.3, 0.5], labelColor: WHITE
              }, false);
              delBtn.clipRect = { ...clipR };
              els.push(delBtn);
              const delIco = makeText("vset-file-del-i-" + i, delR, "", {
                icon: { path: ICON_CLOSE, size: 13, viewport: 24, color: [1, 1, 1, 0.92] },
                align: "center", paddingPx: 0
              }, false);
              delIco.clipRect = { ...clipR };
              delIco.isInteractive = false;
              els.push(delIco);
              rowItems.push(tglBtn, delBtn, delIco);
              inter["vset-file-tg-" + i] = { onTap: () => {
                post({ action: "toggle_file", versionId: versionSettingsId, folderType: versionSettingsTab, fileName: f.fileName });
              }, tip: f.disabled ? "启用" : "禁用" };
              inter["vset-file-del-" + i] = { onTap: () => {
                vsetPendingDeleteFile = f.fileName;
                build();
              }, tip: "删除" };
            }
            vsetItems.push({ baseY, els: rowItems.map((el) => ({ el, dy: el.rect.y - (baseY - vsetScrollY) })) });
          });
        }
        if (isFileTab && !vsetLoading && !vsetFiles._loaded) {
          vsetLoading = true;
          vsetFiles = [];
          post({ action: "list_files", versionId: versionSettingsId, folderType: versionSettingsTab });
          setTimeout(() => { build(); }, 0);
        }
        return { els, inter };
      }
      function buildVersionPanel() {
        listItems = [];
        const px = W - PANEL_W - 20;
        const py = 70;
        const ph = H - py - 120;
        const els = [];
        const inter = {};
        if (versionSettingsOpen) return buildVersionSettings(px, py, ph);
        els.push(makeGlassShape("ver-panel", { x: px, y: py, w: PANEL_W, h: ph }, {
          cornerRadius: 32,
          refractionHeight: 18,
          refractionAmount: -26,
          blurRadius: 4,
          saturation: 1.7,
          brightness: 0.05,
          surfaceColor: [1, 1, 1, 0.12]
        }, false));
        els.push(makeText("ver-title", { x: px + 22, y: py + 14, w: 200, h: 34 }, "\u9009\u62E9\u7248\u672C", {
          color: WHITE,
          fontSizePx: 22,
          letterSpacingPx: trackFor(22),
          fontWeight: 700,
          align: "left",
          paddingPx: 0
        }, false));
        const closeR = { x: px + PANEL_W - 54, y: py + 10, w: 38, h: 38 };
        els.push(makeButton("ver-close", closeR, {
          label: "",
          tintColor: [1, 0.3, 0.3, 0.35],
          surfaceColor: [1, 0.3, 0.3, 0.5],
          labelColor: WHITE
        }, false));
        els.push(makeText("ver-close-ico", closeR, "", {
          icon: { path: ICON_CLOSE, size: 20, viewport: 24, color: [1, 1, 1, 0.92] },
          align: "center"
        }, false));
        inter["ver-close"] = { onTap: () => {
          versionPanelOpen = false;
          build(true);
        } };
        const CATS = [
          { key: "all", src: "gzt.png", tip: "全部" },
          { key: "vanilla", src: "grass_block.png", tip: "原版" },
          { key: "forge", src: "forge.png", tip: "Forge" },
          { key: "fabric", src: "fabirc.png", tip: "Fabric" },
          { key: "neoforge", src: "neoforge.png", tip: "NeoForge" },
          { key: "modpack", src: "zhb.png", tip: "整合包" }
        ];
        const catW = 48, catH = 40;
        const catY = py + 56;
        {
          const seg = buildTabCapsule({
            prefix: "ver-cats",
            x: px + 16,
            y: catY,
            w: PANEL_W - 32,
            h: catH,
            indicatorInset: 8,
            items: CATS.map((c) => ({ key: c.key, tip: c.tip })),
            activeKey: selectedCategory || "",
            onSelect: (k, i) => {
              selectedCategory = selectedCategory === k ? null : k;
              listScrollY = 0;
              targetScrollY = 0;
              listEnterPending = true;
              build();
              try {
                renderer.setTabSelected("ver-cats", i, CATS.length);
              } catch (e) {
              }
            }
          });
          els.push(...seg.els);
          Object.assign(inter, seg.inter);
        }
        const catCell = (PANEL_W - 32) / CATS.length;
        CATS.forEach((c, i) => {
          const iw = c.key === "vanilla" ? 36 : 22;
          const ih = c.key === "vanilla" ? 34 : 20;
          pendingIcons.push({ src: c.src, rect: { x: px + 16 + i * catCell + catCell / 2 - iw / 2, y: catY + (catH - ih) / 2, w: iw, h: ih } });
        });
        const listY = py + 102;
        const listBottom = py + ph - 16;
        const itemH = 52, itemGap = 8;
        const filtered = live.versions.filter((v) => {
          if (!selectedCategory || selectedCategory === "all") return true;
          const l = (v.loader || "").toLowerCase();
          if (selectedCategory === "vanilla") return !l || l === "vanilla";
          if (selectedCategory === "modpack") return !!v.isModpack || l === "modpack";
          return l === selectedCategory;
        });
        const contentH = filtered.length * (itemH + itemGap) - itemGap;
        panelListTop = listY;
        panelListH = Math.floor((listBottom - listY + itemGap) / (itemH + itemGap)) * (itemH + itemGap) - itemGap;
        panelMaxScroll = Math.max(0, contentH - panelListH);
        if (listScrollY > panelMaxScroll) listScrollY = panelMaxScroll;
        const clip = { x: px + 10, y: listY - 6, w: PANEL_W - 20, h: panelListH + 12 };
        if (!filtered.length) {
          els.push(makeText("ver-empty", { x: px + 22, y: listY + 20, w: PANEL_W - 44, h: 30 }, selectedCategory ? "\u8FD9\u4E2A\u5206\u7C7B\u4E0B\u6CA1\u6709\u7248\u672C" : "\u8FD8\u6CA1\u626B\u63CF\u5230\u7248\u672C", {
            color: [0, 0, 0, 0.45],
            fontSizePx: 15,
            letterSpacingPx: trackFor(15),
            fontWeight: 600,
            align: "center",
            paddingPx: 0
          }, false));
        }
        filtered.forEach((v, i) => {
          const baseY = listY + i * (itemH + itemGap);
          const r = { x: px + 22, y: baseY - listScrollY, w: PANEL_W - 44, h: itemH };
          const vid = v.id || v.name || "";
          const isSel = vid === live.selectedVersionId;
          const nm = (typeof customVersionNames !== "undefined" && customVersionNames[vid]) || v.name || vid;
          const glass = makeGlassShape("ver-item-" + i, r, {
            cornerRadius: itemH / 2,
            refractionHeight: 14,
            refractionAmount: -20,
            blurRadius: 4,
            saturation: 1.6,
            brightness: 0.05,
            surfaceColor: isSel ? [0, 0.478, 1, 0.92] : [1, 1, 1, 0.12]
          }, false);
          glass.clipRect = { ...clip };
          els.push(glass);
          const nameTxt = makeText("ver-item-t-" + i, { x: r.x + 18, y: r.y, w: r.w - 132, h: itemH }, nm, {
            color: WHITE,
            fontSizePx: 17,
            letterSpacingPx: trackFor(17),
            fontWeight: 700,
            align: "left",
            paddingPx: 0,
            halo: "dark"
          }, false);
          nameTxt.clipRect = { ...clip };
          nameTxt.isInteractive = false;
          els.push(nameTxt);
          const rowEls = [glass, nameTxt];
          const gearR = { x: r.x + r.w - 52, y: r.y + (itemH - 34) / 2, w: 34, h: 34 };
          const gearTxt = makeText("ver-gear-" + i, gearR, "", {
            icon: { path: ICON_GEAR, size: 24, viewport: 24, color: [1, 1, 1, isSel ? 1 : 0.8] },
            align: "center",
            paddingPx: 0
          }, false);
          gearTxt.clipRect = { ...clip };
          gearTxt.isInteractive = false;
          els.push(gearTxt);
          rowEls.push(gearTxt);
          listItems.push({ baseY, els: rowEls.map((el) => ({ el, dy: el.rect.y - (baseY - listScrollY) })) });
          inter["ver-item-" + i] = { onTap: () => selectVersion(v) };
          inter["ver-gear-" + i] = { onTap: () => {
            versionSettingsOpen = true;
            versionSettingsId = vid;
            versionSettingsTab = "mods";
            build();
          }, tip: "版本设置" };
        });
        return { els, inter };
      }
      var ABOUT_HERO = { x: 24, y: 62, w: 1012, h: 276 };
      var ABOUT_DEV = { x: 24, y: 364, w: 500, h: 92 };
      var ABOUT_TH = { x: 536, y: 364, w: 500, h: 92 };
      var THANKS = [
        { src: "easy.png", tip: "EasyTier \xB7 \u8054\u673A\u677F\u5757" },
        { src: "bangbang93.jpg", tip: "BMCLAPI \xB7 \u4E0B\u8F7D\u955C\u50CF\u6E90" },
        { src: "modrith.svg", tip: "Modrinth \xB7 \u8D44\u6E90\u641C\u7D22\u4E0E\u4E0B\u8F7D", logo: true },
        { src: "forge.svg", tip: "Forge \xB7 \u5B89\u88C5\u5668\u4E0E\u52A0\u8F7D\u5668", logo: true },
        { src: "ceshi.png", tip: "\u5F00\u53D1\u6D4B\u8BD5\u4EBA\u5458" },
        { src: "ceshi2.png", tip: "\u5F00\u53D1\u6D4B\u8BD5\u4EBA\u5458" }
      ];
      var TH_ITEM = 78;
      var TH_STEP = 92;
      var aboutScrollX = 0;
      var aboutMarqueeToken = 0;
      var aboutHover = false;
      function buildAbout() {
        const els = [];
        const inter = {};
        const CARD = 26;
        els.push(makeText(
          "ab-name",
          { x: ABOUT_HERO.x, y: ABOUT_HERO.y + 168, w: ABOUT_HERO.w, h: 40 },
          "Minecraft illusion Launcher",
          {
            color: WHITE,
            fontSizePx: 26,
            letterSpacingPx: trackFor(26),
            fontWeight: 700,
            align: "center",
            paddingPx: 0,
            halo: "dark"
          },
          false
        ));
        els.push(makeText(
          "ab-ver",
          { x: ABOUT_HERO.x, y: ABOUT_HERO.y + 206, w: ABOUT_HERO.w, h: 22 },
          "v" + (live.appVersion || "0.1.3") + "  \xB7  Liquid Glass",
          {
            color: [1, 1, 1, 0.8],
            fontSizePx: 13,
            letterSpacingPx: trackFor(13),
            fontWeight: 600,
            align: "center",
            paddingPx: 0
          },
          false
        ));
        els.push(makeText("ab-dev-title", { x: ABOUT_DEV.x, y: ABOUT_DEV.y - 22, w: ABOUT_DEV.w, h: 20 }, "\u5F00\u53D1\u4EBA\u5458", {
          color: WHITE,
          fontSizePx: 12,
          letterSpacingPx: trackFor(12),
          fontWeight: 700,
          align: "center",
          paddingPx: 0,
          halo: "dark"
        }, false));
        els.push(makeGlassShape("ab-dev", ABOUT_DEV, {
          cornerRadius: ABOUT_DEV.h / 2,
          refractionHeight: 12,
          refractionAmount: -18,
          blurRadius: 7,
          saturation: 1.4,
          brightness: 0.04,
          surfaceColor: [1, 1, 1, 0.13]
        }, false));
        const pill = { x: ABOUT_DEV.x + 100, y: ABOUT_DEV.y + 12, w: 176, h: 28 };
        els.push(makeGlassShape("ab-dev-pill", pill, {
          cornerRadius: 16,
          refractionHeight: 12,
          refractionAmount: -18,
          blurRadius: 4,
          saturation: 1.6,
          brightness: 0.05,
          surfaceColor: [1, 1, 1, 0.18]
        }, false));
        els.push(makeText("ab-dev-namet", pill, "MCillusion50", {
          color: WHITE,
          fontSizePx: 15,
          letterSpacingPx: trackFor(15),
          fontWeight: 700,
          align: "center",
          paddingPx: 0,
          halo: "dark"
        }, false));
        els.push(makeText(
          "ab-dev-intro",
          { x: ABOUT_DEV.x + 100, y: ABOUT_DEV.y + 42, w: 380, h: 18 },
          "\u5E7B\u5883\u542F\u52A8\u5668\u6838\u5FC3\u5F00\u53D1\u4EBA\u5458",
          {
            color: [1, 1, 1, 0.82],
            fontSizePx: 12,
            letterSpacingPx: trackFor(12),
            fontWeight: 600,
            align: "left",
            paddingPx: 0
          },
          false
        ));
        els.push(makeText(
          "ab-dev-qq",
          { x: ABOUT_DEV.x + 100, y: ABOUT_DEV.y + 61, w: 380, h: 18 },
          "QQ\uFF1A3145797265",
          {
            color: [1, 1, 1, 0.64],
            fontSizePx: 12,
            letterSpacingPx: trackFor(12),
            fontWeight: 600,
            align: "left",
            paddingPx: 0
          },
          false
        ));
        els.push(makeText("ab-thanks-title", { x: ABOUT_TH.x, y: ABOUT_TH.y - 22, w: ABOUT_TH.w, h: 20 }, "\u7279\u522B\u9E23\u8C22", {
          color: WHITE,
          fontSizePx: 12,
          letterSpacingPx: trackFor(12),
          fontWeight: 700,
          align: "center",
          paddingPx: 0,
          halo: "dark"
        }, false));
        els.push(makeGlassShape("ab-thanks", ABOUT_TH, {
          cornerRadius: ABOUT_TH.h / 2,
          refractionHeight: 12,
          refractionAmount: -18,
          blurRadius: 7,
          saturation: 1.4,
          brightness: 0.04,
          surfaceColor: [1, 1, 1, 0.13]
        }, false));
        els.push(makeGlassShape("ab-bar", { x: 24, y: 468, w: 1012, h: 46 }, {
          cornerRadius: 23,
          refractionHeight: 12,
          refractionAmount: -18,
          blurRadius: 6,
          saturation: 1.5,
          brightness: 0.05,
          surfaceColor: [1, 1, 1, 0.1]
        }, false));
        const BTN_DEFS = [
          ["ab-b1", "\u95EE\u9898\u53CD\u9988", "https://github.com/MCillusion50/IllusionLauncher/issues"],
          ["ab-b2", "GitHub", "https://github.com/MCillusion50/IllusionLauncher"],
          ["ab-b3", "\u5E2E\u52A9\u6587\u6863", "https://github.com/MCillusion50/IllusionLauncher#readme"],
          ["ab-b4", "\u68C0\u67E5\u66F4\u65B0", "https://github.com/MCillusion50/IllusionLauncher/releases/latest"]
        ];
        for (let i = 0; i < BTN_DEFS.length; i++) {
          const id = BTN_DEFS[i][0], label = BTN_DEFS[i][1], url = BTN_DEFS[i][2];
          const r = { x: 32 + i * 251, y: 474, w: 243, h: 34 };
          els.push(makeGlassShape(id, r, {
            cornerRadius: 17,
            refractionHeight: 10,
            refractionAmount: -16,
            blurRadius: 4,
            saturation: 1.5,
            brightness: 0.06,
            surfaceColor: [1, 1, 1, 0.16]
          }, true));
          els.push(makeText(id + "-t", r, label, {
            color: WHITE,
            fontSizePx: 13,
            letterSpacingPx: trackFor(13),
            fontWeight: 700,
            align: "center",
            paddingPx: 0,
            halo: "dark"
          }, false));
          inter[id] = { onTap: () => {
            try {
              window.open(url, "_blank");
            } catch {
            }
          } };
        }
        return { els, inter };
      }
      function ensureAboutImg(id, src, cls, parent) {
        const layer = parent || document.getElementById("aboutLayer");
        if (!layer) return null;
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement("img");
          el.id = id;
          el.draggable = false;
          if (cls) el.className = cls;
          layer.appendChild(el);
        }
        if (el.getAttribute("data-src") !== src) {
          el.setAttribute("data-src", src);
          el.src = src;
        }
        return el;
      }
      function placeAboutImg(el, x, y, w, h) {
        if (!el) return;
        el.style.left = x + "px";
        el.style.top = y + "px";
        el.style.width = w + "px";
        el.style.height = h + "px";
      }
      function layoutThanks() {
        const clip = document.getElementById("ab-th-clip");
        if (!clip) return;
        const cycle = TH_STEP * THANKS.length;
        for (let i = 0; i < THANKS.length * 2; i++) {
          const t = THANKS[i % THANKS.length];
          const el = ensureAboutImg("ab-th-" + i, t.src, t.logo ? "is-logo thanks-circle" : "thanks-circle", clip);
          if (!el) continue;
          let off = i * TH_STEP + aboutScrollX;
          off = (off % cycle + cycle) % cycle;
          const relX = 18 + off - TH_STEP;
          placeAboutImg(el, relX, 7, TH_ITEM, TH_ITEM);
          el.style.borderRadius = "50%";
          el.style.background = "transparent";
          el.setAttribute("data-tip", t.tip);
          el.style.display = relX < -TH_ITEM || relX > ABOUT_TH.w ? "none" : "block";
        }
      }
      function startAboutMarquee() {
        const token = ++aboutMarqueeToken;
        const step = () => {
          if (token !== aboutMarqueeToken) return;
          const layer = document.getElementById("aboutLayer");
          if (!layer || !layer.classList.contains("on")) return;
          if (!aboutHover) {
            aboutScrollX -= 0.45;
            layoutThanks();
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
      var ringGLReady = false;
      var ringBgStarted = false;
      async function initRingBackground(RG) {
        if (ringBgStarted) return;
        ringBgStarted = true;
        const ready = () => {
          try {
            RG.setScreen(window.innerWidth, window.innerHeight);
            RG.draw(window.innerWidth / 2, ABOUT_HERO.y + 30 + 64, 128);
          } catch (e) {
          }
        };
        const du = live.bgDataUri;
        if (du) {
          RG.setBackground(du, ready);
          return;
        }
        const urls = [live.bgUrl, "bg.jpg"].filter(Boolean);
        for (const u of urls) {
          try {
            const res = await fetch(u, { mode: "cors" });
            if (!res.ok) continue;
            const blob = await res.blob();
            RG.setBackground(URL.createObjectURL(blob), ready);
            return;
          } catch (e) {
          }
        }
      }
      function drawAboutRing() {
        const cv = document.getElementById("ab-ring-gl");
        const RG = window.RingGlass;
        if (!cv || !RG) return;
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth, h = window.innerHeight;
        const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
        if (cv.width !== pw || cv.height !== ph) {
          cv.width = pw;
          cv.height = ph;
        }
        const size = 128;
        const cx = w / 2;
        const cy = ABOUT_HERO.y + 30 + size / 2;
        if (!ringGLReady) {
          if (!RG.init(cv)) return;
          ringGLReady = true;
          initRingBackground(RG);
          setTimeout(() => {
            try {
              RG.setScreen(window.innerWidth, window.innerHeight);
              RG.draw(cx, cy, size);
            } catch (e) {
            }
          }, 800);
        }
        RG.setScreen(w, h);
        RG.draw(cx, cy, size);
        const rOut = size * 0.45 + 2;
        const rIn = size * 0.28;
        const m = `radial-gradient(circle ${rOut}px at 50% ${cy}px, transparent ${rIn}px, #000 ${rIn + 2.5}px)`;
        cv.style.webkitMask = m;
        cv.style.mask = m;
      }
      function syncAboutLayer() {
        const layer = document.getElementById("aboutLayer");
        const wave = document.getElementById("waveLayer");
        if (!layer || !wave) return;
        const show = page === "about" && !modal;
        if (!show) {
          layer.classList.remove("on");
          wave.classList.remove("on");
          aboutMarqueeToken++;
          return;
        }
        layer.classList.add("on");
        drawAboutRing();
        const outline = document.getElementById("ab-hero-outline");
        if (outline) {
          outline.style.left = ABOUT_HERO.x + "px";
          outline.style.top = ABOUT_HERO.y + "px";
          outline.style.width = ABOUT_HERO.w + "px";
          outline.style.height = ABOUT_HERO.h + "px";
        }
        const ring = document.getElementById("ab-ring");
        if (ring) {
          const rw = 138;
          ring.style.width = rw + "px";
          ring.style.height = rw + "px";
          ring.style.left = Math.round((window.innerWidth - rw) / 2) + "px";
          ring.style.top = ABOUT_HERO.y + 30 + "px";
        }
        const av = ensureAboutImg("ab-avatar", "made.png", "thanks-circle");
        placeAboutImg(av, ABOUT_DEV.x + 6, ABOUT_DEV.y + 6, 80, 80);
        const clip = document.getElementById("ab-th-clip");
        if (clip) {
          clip.style.left = ABOUT_TH.x + "px";
          clip.style.top = ABOUT_TH.y + "px";
          clip.style.width = ABOUT_TH.w + "px";
          clip.style.height = ABOUT_TH.h + "px";
          clip.style.borderRadius = ABOUT_TH.h / 2 + "px";
        }
        wave.style.left = ABOUT_HERO.x + "px";
        wave.style.top = ABOUT_HERO.y + 228 + "px";
        wave.style.width = ABOUT_HERO.w + "px";
        wave.style.height = "46px";
        wave.classList.add("on");
        layoutThanks();
        startAboutMarquee();
      }
      (() => {
        const tip = document.getElementById("aboutTip");
        if (!tip) return;
        document.addEventListener("mouseover", (ev) => {
          const t = ev.target;
          if (!t || t.tagName !== "IMG" || !t.id.startsWith("ab-th-")) return;
          const text = t.getAttribute("data-tip") || "";
          if (!text) return;
          aboutHover = true;
          tip.textContent = text;
          tip.style.opacity = "1";
        });
        document.addEventListener("mousemove", (ev) => {
          if (!tip || tip.style.opacity !== "1") return;
          tip.style.left = ev.clientX + 12 + "px";
          tip.style.top = ev.clientY + 16 + "px";
        });
        document.addEventListener("mouseout", (ev) => {
          const t = ev.target;
          if (!t || t.tagName !== "IMG" || !t.id.startsWith("ab-th-")) return;
          aboutHover = false;
          tip.style.opacity = "0";
        });
      })();
      function buildAccountPanel() {
        const px = W - PANEL_W - 20;
        const py = 70;
        const ph = H - py - 120;
        const els = [];
        const inter = {};
        els.push(makeGlassShape("acc-panel", { x: px, y: py, w: PANEL_W, h: ph }, {
          cornerRadius: 32,
          refractionHeight: 18,
          refractionAmount: -26,
          blurRadius: 4,
          saturation: 1.7,
          brightness: 0.05,
          surfaceColor: [1, 1, 1, 0.12]
        }, false));
        els.push(makeText("acc-title", { x: px + 22, y: py + 14, w: 240, h: 34 }, "\u9009\u62E9\u8D26\u6237", {
          color: WHITE,
          fontSizePx: 22,
          letterSpacingPx: trackFor(22),
          fontWeight: 700,
          align: "left",
          paddingPx: 0
        }, false));
        const closeR = { x: px + PANEL_W - 54, y: py + 10, w: 38, h: 38 };
        els.push(makeButton("acc-close", closeR, {
          label: "",
          tintColor: [1, 0.3, 0.3, 0.35],
          surfaceColor: [1, 0.3, 0.3, 0.5],
          labelColor: WHITE
        }, false));
        els.push(makeText("acc-close-ico", closeR, "", {
          icon: { path: ICON_CLOSE, size: 20, viewport: 24, color: [1, 1, 1, 0.92] },
          align: "center"
        }, false));
        inter["acc-close"] = { onTap: () => {
          accountPanelOpen = false;
          build(true);
        } };
        let accounts = [];
        let currentIdx = -1;
        try {
          accounts = JSON.parse(localStorage.getItem("accounts") || "[]");
          const raw = localStorage.getItem("currentAccount");
          currentIdx = raw === "null" || raw === null ? -1 : parseInt(raw);
        } catch {
        }
        const listY = py + 64;
        const itemH = 54, itemGap = 8;
        if (!accounts.length) {
          els.push(makeText("acc-empty", { x: px + 22, y: listY + 20, w: PANEL_W - 44, h: 30 }, "\u8FD8\u6CA1\u6709\u8D26\u6237", {
            color: [0, 0, 0, 0.45],
            fontSizePx: 15,
            letterSpacingPx: trackFor(15),
            fontWeight: 600,
            align: "center",
            paddingPx: 0
          }, false));
        }
        accounts.forEach((a, i) => {
          const r = { x: px + 22, y: listY + i * (itemH + itemGap), w: PANEL_W - 44, h: itemH };
          if (r.y + itemH > py + ph - 80) return;
          const isSel = i === currentIdx;
          els.push(makeGlassShape("acc-item-" + i, r, {
            cornerRadius: itemH / 2,
            refractionHeight: 14,
            refractionAmount: -20,
            blurRadius: 4,
            saturation: 1.6,
            brightness: 0.05,
            surfaceColor: isSel ? [0, 0.478, 1, 0.92] : [1, 1, 1, 0.12]
          }, false));
          els.push(makeText("acc-item-n-" + i, { x: r.x + 18, y: r.y + 5, w: r.w - 100, h: 24 }, a.name || "\u672A\u547D\u540D", {
            color: WHITE,
            fontSizePx: 15,
            letterSpacingPx: trackFor(15),
            fontWeight: 700,
            align: "left",
            paddingPx: 0,
            halo: "dark"
          }, false));
          els.push(makeText(
            "acc-item-t-" + i,
            { x: r.x + 18, y: r.y + 28, w: 120, h: 20 },
            a.type === "microsoft" ? "\u6B63\u7248" : "\u79BB\u7EBF",
            {
              color: [1, 1, 1, isSel ? 0.85 : 0.6],
              fontSizePx: 11,
              letterSpacingPx: trackFor(11),
              fontWeight: 600,
              align: "left",
              paddingPx: 0
            },
            false
          ));
          const delR = { x: r.x + r.w - 62, y: r.y + (itemH - 26) / 2, w: 46, h: 26 };
          els.push(makeGlassShape("acc-del-" + i, delR, {
            cornerRadius: 13,
            refractionHeight: 0,
            refractionAmount: 0,
            blurRadius: 3,
            saturation: 1.2,
            brightness: 0,
            surfaceColor: [1, 0.24, 0.2, isSel ? 0.3 : 0.2]
          }, false));
          els.push(makeText("acc-del-t-" + i, { x: delR.x, y: delR.y, w: delR.w, h: delR.h }, "\u5220\u9664", {
            color: [1, 0.45, 0.4, 1],
            fontSizePx: 11,
            letterSpacingPx: trackFor(11),
            fontWeight: 700,
            align: "center",
            paddingPx: 0
          }, false));
          inter["acc-del-" + i] = { onTap: () => deleteAccount(i) };
          inter["acc-item-" + i] = { onTap: () => selectAccount(i) };
        });
        const addR = { x: px + 22, y: py + ph - 64, w: PANEL_W - 44, h: 46 };
        els.push(makeButton("acc-add", addR, {
          label: "\u6DFB\u52A0\u8D26\u6237",
          tintColor: CLEAR,
          surfaceColor: [1, 1, 1, 0.12],
          labelColor: WHITE
        }, false));
        inter["acc-add"] = { onTap: () => {
          accountPanelOpen = false;
          openModal("offline");
        } };
        return { els, inter };
      }
      function selectAccount(i) {
        try {
          localStorage.setItem("currentAccount", String(i));
        } catch {
        }
        live.avatarDataUri = "";
        loadAccount();
        accountPanelOpen = false;
        build(true);
      }
      function deleteAccount(i) {
        let arr = [];
        try {
          arr = JSON.parse(localStorage.getItem("accounts") || "[]");
        } catch {
          arr = [];
        }
        if (!Array.isArray(arr) || i < 0 || i >= arr.length) return;
        arr.splice(i, 1);
        try {
          localStorage.setItem("accounts", JSON.stringify(arr));
          const cur = parseInt(localStorage.getItem("currentAccount") || "-1", 10);
          let next = cur;
          if (cur === i) next = arr.length ? 0 : -1;
          else if (cur > i) next = cur - 1;
          localStorage.setItem("currentAccount", String(next));
        } catch {
        }
        live.avatarDataUri = "";
        loadAccount();
        build(true);
      }
      function selectVersion(v) {
        live.selectedVersionId = v.id || v.name || "";
        live.currentVersion = [v.name || v.id, v.loader].filter(Boolean).join("  ");
        versionPanelOpen = false;
        try {
          localStorage.setItem("selectedVersion", live.selectedVersionId);
        } catch {
        }
        build(true);
      }
      var room = {
        mode: "idle",
        code: "",
        address: "",
        error: "",
        busyText: ""
      };
      var GREEN = [52 / 255, 199 / 255, 89 / 255, 1];
      function layoutOnline() {
        const AV = 88;
        const cx = W / 2;
        const btnW = 200;
        const btnH = 56;
        const gap = 16;
        const avatarR = { x: cx - AV / 2, y: H / 2 - 224, w: AV, h: AV };
        const rowY = H / 2 - 8;
        return {
          avatarR,
          rowY,
          leftR: { x: cx - gap / 2 - btnW, y: rowY, w: btnW, h: btnH },
          rightR: { x: cx + gap / 2, y: rowY, w: btnW, h: btnH },
          wideR: { x: cx - 160, y: rowY, w: 320, h: btnH },
          codeR: { x: cx - 200, y: H / 2 - 118, w: 400, h: 44 },
          hintR: { x: cx - 200, y: H / 2 - 66, w: 400, h: 22 }
        };
      }
      function buildOnline() {
        const L = layoutOnline();
        const els = [];
        const inter = {};
        placeAvatar(L.avatarR, 0);
        placeExpandSvg(null, false);
        // 头像下方：账户类型胶囊 + 名字
        {
          const tagW = 92, tagH = 28;
          const tagY = L.avatarR.y + L.avatarR.h + 14;
          const tagR = { x: W / 2 - tagW / 2, y: tagY, w: tagW, h: tagH };
          const isPremium = !!live.premium;
          els.push(makeGlassShape("online-acc-tag", tagR, {
            cornerRadius: tagH / 2,
            refractionHeight: 8,
            refractionAmount: -12,
            blurRadius: 4,
            saturation: 1.6,
            brightness: 0.05,
            surfaceColor: isPremium ? [0.2, 0.52, 1, 0.28] : [1, 1, 1, 0.16]
          }, false));
          els.push(makeText("online-acc-tag-t", tagR, isPremium ? "正版账户" : "离线账户", {
            color: WHITE,
            fontSizePx: 11,
            letterSpacingPx: trackFor(11),
            fontWeight: 700,
            align: "center",
            paddingPx: 0,
            halo: "dark"
          }, false));
          const nameW = Math.max(120, (live.playerName || "Player").length * 16 + 40);
          const nameH = 32;
          const nameR = { x: W / 2 - nameW / 2, y: tagY + tagH + 8, w: nameW, h: nameH };
          els.push(makeGlassShape("online-name-bg", nameR, {
            cornerRadius: nameH / 2,
            refractionHeight: 8,
            refractionAmount: -12,
            blurRadius: 4,
            saturation: 1.6,
            brightness: 0.05,
            surfaceColor: [1, 1, 1, 0.14]
          }, false));
          els.push(makeText("online-name", nameR, live.playerName || "Player", {
            color: WHITE,
            fontSizePx: 14,
            letterSpacingPx: trackFor(14),
            fontWeight: 800,
            align: "center",
            paddingPx: 0,
            halo: "dark"
          }, false));
        }
        if (room.mode === "idle") {
          const createBtn = makeButton("btn-create", L.leftR, {
            label: "\u521B\u5EFA\u623F\u95F4",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: WHITE
          }, false);
          const joinBtn = makeButton("btn-join", L.rightR, {
            label: "\u52A0\u5165\u623F\u95F4",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: WHITE
          }, false);
          createBtn.noPressMove = true;
          joinBtn.noPressMove = true;
          els.push(createBtn, joinBtn);
          inter["btn-create"] = { onTap: () => openModal("create") };
          inter["btn-join"] = { onTap: () => openModal("join") };
          if (room.error) {
            els.push(makeText("room-err", { x: W / 2 - 200, y: L.rowY + 76, w: 400, h: 24 }, room.error, {
              color: PINK,
              fontSizePx: 13,
              letterSpacingPx: trackFor(13),
              fontWeight: 600,
              align: "center",
              paddingPx: 0
            }, false));
          }
        } else if (room.mode === "busy") {
          const cap = makeGlassShape("room-busy", L.wideR, {
            cornerRadius: 28,
            refractionHeight: 12,
            refractionAmount: -18,
            blurRadius: 3,
            saturation: 1.6,
            brightness: 0.06,
            surfaceColor: [1, 1, 1, 0.28]
          }, false);
          const txt = makeText("room-busy-t", L.wideR, room.busyText || "\u8BF7\u7A0D\u5019\u2026", {
            color: BLACK,
            fontSizePx: 15,
            letterSpacingPx: trackFor(15),
            fontWeight: 600,
            align: "center",
            paddingPx: 0
          }, false);
          els.push(cap, txt);
        } else if (room.mode === "hosting") {
          els.push(makeText("room-code", L.codeR, room.code, {
            color: WHITE,
            fontSizePx: 26,
            letterSpacingPx: trackFor(26),
            fontWeight: 700,
            align: "center",
            paddingPx: 0
          }, false));
          els.push(makeText("room-hint", L.hintR, "\u628A\u623F\u7801\u53D1\u7ED9\u670B\u53CB\uFF0C\u4ED6\u4EEC\u5C31\u80FD\u52A0\u5165", {
            color: [1, 1, 1, 0.75],
            fontSizePx: 12,
            letterSpacingPx: trackFor(12),
            fontWeight: 500,
            align: "center",
            paddingPx: 0
          }, false));
          const copyBtn = makeButton("room-copy", L.leftR, {
            label: "\u590D\u5236\u623F\u7801",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: BLACK
          }, false);
          const closeBtn = makeButton("room-close", L.rightR, {
            label: "\u5173\u95ED\u623F\u95F4",
            tintColor: [1, 1, 1, 0.06],
            surfaceColor: [1, 1, 1, 0.24],
            labelColor: PINK
          }, false);
          copyBtn.noPressMove = true;
          closeBtn.noPressMove = true;
          els.push(copyBtn, closeBtn);
          inter["room-copy"] = {
            onTap: () => {
              navigator.clipboard.writeText(room.code).catch(() => {
              });
              room.busyText = "\u623F\u7801\u5DF2\u590D\u5236";
              window.showToast("复制成功", "房间码已复制");
            }
          };
          inter["room-close"] = { onTap: () => post({ action: "close_room" }) };
        } else if (room.mode === "joined") {
          els.push(makeText("room-addr", L.codeR, room.address, {
            color: WHITE,
            fontSizePx: 22,
            letterSpacingPx: trackFor(22),
            fontWeight: 700,
            align: "center",
            paddingPx: 0
          }, false));
          els.push(makeText("room-hint", L.hintR, "\u5728\u6E38\u620F\u91CC\u7528\u300C\u76F4\u63A5\u8FDE\u63A5\u300D\u8F93\u5165\u8FD9\u4E2A\u5730\u5740", {
            color: [1, 1, 1, 0.75],
            fontSizePx: 12,
            letterSpacingPx: trackFor(12),
            fontWeight: 500,
            align: "center",
            paddingPx: 0
          }, false));
          const copyBtn = makeButton("room-copy", L.leftR, {
            label: "\u590D\u5236\u5730\u5740",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: BLACK
          }, false);
          const leaveBtn = makeButton("room-leave", L.rightR, {
            label: "\u65AD\u5F00\u8FDE\u63A5",
            tintColor: [1, 1, 1, 0.06],
            surfaceColor: [1, 1, 1, 0.24],
            labelColor: PINK
          }, false);
          copyBtn.noPressMove = true;
          leaveBtn.noPressMove = true;
          els.push(copyBtn, leaveBtn);
          inter["room-copy"] = { onTap: () => {
            navigator.clipboard.writeText(room.address).catch(() => {
            });
          } };
          inter["room-leave"] = { onTap: () => post({ action: "leave_room" }) };
        }
        return { els, inter };
      }
      var DL_SECTIONS = [
        { key: "game", label: "\u6E38\u620F\u4E0B\u8F7D" },
        { key: "hall", label: "\u8D44\u6E90\u5927\u5385" },
        { key: "thread", label: "\u7EBF\u7A0B\u4E0B\u8F7D" }
      ];
      var dlSection = "game";
      var dl = {
        mcVersions: [],
        category: "release",
        mcVersion: "",
        versionUrl: "",
        picked: false,
        loader: "vanilla",
        loaderVersions: [],
        loaderVersion: "",
        phase: "idle",
        percent: 0,
        message: "",
        lastMessage: "",
        logs: [],
        error: "",
        fetched: false,
        speed: 0,
        lastMb: 0,
        lastMbAt: 0,
        sizeText: "",
        // iOS26 版新增：版本下拉 / 缓动进度
        ddOpen: false,
        ddScroll: 0,
        ddMax: 0,
        ddRect: { x: 0, y: 0, w: 0, h: 0 },
        visPct: 0,
        lastKey: "",
        trackW: 0
      };
      window.dl = dl;
      var dlScrollY = 0;
      var dlTargetScroll = 0;
      var dlMaxScroll = 0;
      var dlListTop = 0;
      var dlListH = 0;
      var dlListX = 0;
      var dlListW = 0;
      var dlAnim = 0;
      var dlVel = 0;
      var dlBuiltIdx = -1;
      var dlItems = [];
      function pushElements() {
        renderer.setElements(elements);
        const sel = renderer.setTabSelected;
        if (typeof sel === "function") sel.call(renderer, TAB_GROUP, state.selectedTab2, TAB_COUNT);
        renderer.requestRender();
      }
      function applyDlScroll() {
        for (const it of dlItems) {
          for (const item of it.els) item.el.rect.y = it.baseY - dlScrollY + item.dy;
        }
        pushElements();
      }
      function animateDlScroll() {
        dlScrollY += dlVel;
        dlVel *= 0.9;
        if (dlScrollY <= 0) {
          dlScrollY = 0;
          dlVel = 0;
        }
        if (dlScrollY >= dlMaxScroll) {
          dlScrollY = dlMaxScroll;
          dlVel = 0;
        }
        if (Math.abs(dlVel) < 0.3) {
          dlVel = 0;
          dlAnim = 0;
          build();
          return;
        }
        if (Math.floor(dlScrollY / DL_PITCH) !== dlBuiltIdx) build();
        else applyDlScroll();
        dlAnim = requestAnimationFrame(animateDlScroll);
      }
      var LOADERS = [
        { key: "vanilla", label: "\u539F\u7248" },
        { key: "forge", label: "Forge" },
        { key: "fabric", label: "Fabric" },
        { key: "neoforge", label: "NeoForge" }
      ];
      async function loadMcVersions() {
        if (dl.fetched) return;
        const urls = [
          "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
          "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json"
        ];
        for (const u of urls) {
          try {
            const r = await fetch(u);
            if (!r.ok) continue;
            const j = await r.json();
            const arr = j && j.versions || [];
            dl.mcVersions = arr.map((v) => ({ id: v.id, type: v.type, url: v.url, releaseTime: v.releaseTime || "" }));
            dl.fetched = true;
            if (!dl.mcVersion && dl.mcVersions.length) {
              const first = dl.mcVersions.find((v) => v.type === "release") || dl.mcVersions[0];
              dl.mcVersion = first.id;
              dl.versionUrl = first.url;
            }
            if (page === "download") build(true);
            return;
          } catch {
          }
        }
        dl.error = "\u83B7\u53D6\u6E38\u620F\u7248\u672C\u5217\u8868\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC";
        if (page === "download") build();
      }
      function requestLoaderVersions() {
        if (dl.loader === "vanilla") return;
        dl.loaderVersions = [];
        dl.loaderVersion = "";
        post({ action: "get_loader_versions", loader: dl.loader, versionId: dl.mcVersion, mcVersion: dl.mcVersion });
      }
      function selectLoader(key) {
        if (dl.loader === key) return;
        dl.loader = key;
        dl.loaderVersions = [];
        dl.loaderVersion = "";
        dl.phase = "idle";
        dl.error = "";
        dl.logs = [];
        dl.percent = 0;
        dlPanel = "install";
        build();
        if (!playedEnter.has("install")) {
          playedEnter.add("install");
          animateEnter(panelEls, 300);
        }
        if (key !== "vanilla") requestLoaderVersions();
      }
      function startDownload() {
        if (!dl.mcVersion) return;
        if (dl.loader !== "vanilla" && !dl.loaderVersion) {
          dl.error = "\u8BF7\u5148\u9009\u62E9\u52A0\u8F7D\u5668\u7248\u672C";
          build(true);
          return;
        }
        dl.phase = "installing";
        dl.percent = 0;
        dl.visPct = 0;
        dl.speed = 0;
        dl.logs = [];
        dl.lastKey = "";
        dl.ddOpen = false;
        dl.message = "\u51C6\u5907\u4E2D\u2026";
        dl.error = "";
        build(true);
        post({
          action: "download_mc",
          versionId: dl.mcVersion,
          versionUrl: dl.versionUrl,
          loader: dl.loader,
          loaderVersion: dl.loaderVersion
        });
      }
      function showVsetDropGlow(on) {
        const g = document.getElementById("vsetDropGlow");
        if (!g) return;
        if (!on) { g.style.display = "none"; return; }
        const pw = PANEL_W + 60;
        const px = W - pw - 20;
        const py = 70;
        const ph = H - py - 120;
        const bodyY = py + 56 + 40 + 22;
        g.style.left = (px + 16) + "px";
        g.style.top = bodyY + "px";
        g.style.width = (pw - 32) + "px";
        g.style.height = (py + ph - bodyY - 16) + "px";
        g.style.display = "block";
      }
      document.addEventListener("dragover", (e) => {
        if (versionSettingsOpen && ["mods", "resourcepacks", "shaderpacks"].includes(versionSettingsTab)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          showVsetDropGlow(true);
        }
      });
      document.addEventListener("dragleave", (e) => {
        if (!e.relatedTarget) showVsetDropGlow(false);
      });
      document.addEventListener("drop", (e) => {
        showVsetDropGlow(false);
        if (!versionSettingsOpen) return;
        if (!["mods", "resourcepacks", "shaderpacks"].includes(versionSettingsTab)) return;
        if (!window.chrome || !window.chrome.webview || !window.chrome.webview.postMessageWithAdditionalObjects) return;
        const files = Array.from(e.dataTransfer.files || []);
        if (!files.length) return;
        e.preventDefault();
        e.stopPropagation();
        window.chrome.webview.postMessageWithAdditionalObjects("file_drop_mods", files);
      });
      window.onHostDrop = (data) => {
        if (!data || !Array.isArray(data.paths)) return;
        if (!versionSettingsOpen) return;
        if (!["mods", "resourcepacks", "shaderpacks"].includes(versionSettingsTab)) return;
        const allowed = versionSettingsTab === "mods" ? [".jar"] : [".zip"];
        const okPaths = [];
        let rejected = 0;
        for (const raw of data.paths) {
          const cleaned = String(raw).replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "").trim();
          const lower = cleaned.toLowerCase();
          if (allowed.some((ext) => lower.endsWith(ext))) okPaths.push(cleaned);
          else rejected++;
        }
        if (!okPaths.length) return;
        window._pendingModImport = true;
        post({ action: "import_files", versionId: versionSettingsId, folderType: versionSettingsTab, paths: okPaths });
        vsetLoading = true;
        build();
      };
      window.onVersionConfigLoaded = (data) => {
        if (!data || data.versionId !== versionSettingsId) return;
        const cfg = data.config || {};
        vsetJavaPath = cfg.javaPath || "";
        build();
      };
      window.onVersionJavaUpdated = (data) => {
        if (!data || !data.ok) return;
        if (data.versionId !== versionSettingsId) return;
        vsetJavaPath = data.javaPath || "";
        build();
      };
      window.onVersionIconPicked = (data) => {
        if (!data || !data.url) return;
        customVersionNames["icon_" + versionSettingsId] = data.url;
        saveCustomVersionNames();
        build();
      };
      window.onVersionDeleted = (versionId) => {
        if (versionId === versionSettingsId) {
          versionSettingsOpen = false;
          vsetFiles = [];
          vsetLoading = false;
          vsetDeleteConfirm = false;
        }
        build();
        postStr("scan_versions");
        window.showToast("已删除版本", versionId);
      };
      window.onDeleteFailed = (versionId, error) => {
        vsetDeleteConfirm = false;
        build();
      };
      window.onFileList = (data) => {
        if (!data) return;
        if (!versionSettingsOpen) return;
        if (data.versionId !== versionSettingsId) return;
        if (data.folderType !== versionSettingsTab) return;
        vsetLoading = false;
        vsetFiles = data.files || [];
        vsetFiles._loaded = true;
        build();
      };
      window.onFileChanged = () => {
        if (window._pendingModImport) {
          window._pendingModImport = false;
          window.showToast("导入成功", "模组已导入");
        }
        if (!versionSettingsOpen) return;
        if (!["mods", "resourcepacks", "shaderpacks"].includes(versionSettingsTab)) return;
        vsetLoading = true;
        vsetFiles = [];
        build();
        post({ action: "list_files", versionId: versionSettingsId, folderType: versionSettingsTab });
      };
      window.onFileToast = (data) => {
        if (data && data.title) {
          try { window.showToast(data.title, data.message); } catch (e) {}
        }
      };
      window.onLoaderVersions = (d) => {
        if (d && d.ok) {
          dl.loaderVersions = d.versions || [];
          if (dl.loaderVersions.length) dl.loaderVersion = dl.loaderVersions[0];
          dl.error = "";
        } else {
          dl.error = d && d.error || "\u83B7\u53D6\u52A0\u8F7D\u5668\u7248\u672C\u5931\u8D25";
        }
        if (page === "download") build(true);
      };
      window.onDownloadBusyStart = () => {
        window.__downloadBusy = true;
      };
      window.onDownloadBusyEnd = () => {
        window.__downloadBusy = false;
      };
      window.onDownloadProgress = (d) => {
        if (!d) return;
        const pct = typeof d.percent === "number" ? d.percent : dl.percent;
        dl.percent = pct;
        const firstTick = dl.phase !== "installing" && dl.phase !== "done";
        if (firstTick && pct > 0) window.showToast("开始下载", (dl.mcVersion || "") + " 正在下载中…");
        if (d.done && pct >= 100) window.showToast("下载完成", (dl.mcVersion || "") + " 已安装");
        if (d.message) {
          dl.message = d.message;
          const mb = /([\d.]+)\s*MB\s*\/\s*([\d.]+)\s*MB/i.exec(d.message);
          if (mb) {
            const doneMb = parseFloat(mb[1]);
            const totalMb = parseFloat(mb[2]);
            const now = performance.now();
            if (dl.lastMbAt > 0 && now - dl.lastMbAt > 200) {
              const inst = (doneMb - dl.lastMb) / ((now - dl.lastMbAt) / 1e3);
              if (inst > 0 && inst < 500) dl.speed = dl.speed > 0 ? dl.speed * 0.6 + inst * 0.4 : inst;
            }
            dl.lastMb = doneMb;
            dl.lastMbAt = now;
            dl.sizeText = totalMb > 0 ? doneMb.toFixed(0) + " / " + totalMb.toFixed(0) + " MB" : "";
          }
        }
        if (!d.done && /失败|错误|取消/.test(d.message || "")) {
          dl.phase = "idle";
          dl.speed = 0;
          dl.error = d.message;
          if (page === "download" && !modal) build();
          return;
        }
        if (d.done) {
          dl.phase = "done";
          dl.percent = 100;
          dl.speed = 0;
          if (page === "download" && !modal) build();
          startProgressAnim();
          postStr("scan_versions");
          return;
        }
        if (firstTick) {
          dl.phase = "installing";
          if (page === "download" && !modal) build();
          startProgressAnim();
          return;
        }
        dl.phase = "installing";
        if (page === "download" && !modal) {
          const spdDom = document.getElementById("dlSpeedDom");
          if (spdDom && spdDom.style.display !== "none") {
            spdDom.textContent = dl.speed > 0 ? dl.speed.toFixed(1) + " Mb/s" : (dl.phase === "done" ? "已完成" : "");
          }
          const msgDom = document.getElementById("dlMsgDom");
          if (msgDom && msgDom.style.display !== "none") {
            msgDom.textContent = dl.message || "准备中…";
          }
          let touched = true;
          if (touched) {
            pushElements();
          }
          startProgressAnim();
        }
      };
      function filteredDlVersions() {
        return dl.mcVersions.filter((v) => {
          if (dl.category === "release") return v.type === "release";
          if (dl.category === "snapshot") return v.type === "snapshot";
          return v.type === "old_beta" || v.type === "old_alpha";
        });
      }
      var DL_PAD = 64;
      var DL_GAP = 24;
      var DL_TOP = 140;
      var DL_MAX_W = 1240;
      var DL_ROW_H = 48;
      var DL_ROW_GAP = 8;
      var DL_PITCH = DL_ROW_H + DL_ROW_GAP;
      function buildTabCapsule(cfg) {
        const els = [];
        const inter = {};
        const items = cfg.items;
        const n = items.length;
        if (!n) return { els, inter };
        const GLASS_PAD = 4;
        const GLASS_H = cfg.h;
        const CONTAINER_H = GLASS_H + GLASS_PAD * 2;
        const containerW = cfg.w;
        const containerX = cfg.x;
        const containerY = cfg.y - GLASS_PAD;
        const glassX = containerX + GLASS_PAD;
        const glassY = containerY + GLASS_PAD;
        const glassW = containerW - GLASS_PAD * 2;
        const tabW = glassW / n;
        const R = GLASS_H / 2;
        const prefix = cfg.prefix;
        const idx = Math.max(0, items.findIndex((it) => it.key === cfg.activeKey));
        const tabRects = items.map((_, i) => ({ x: glassX + tabW * i, y: glassY, w: tabW, h: GLASS_H }));
        const centerX = containerX + containerW / 2;
        const centerY = containerY + CONTAINER_H / 2;
        const fs1 = cfg.fontSize || 15;
        const bg = makeGlassShape(prefix + "-bg", { x: glassX, y: glassY, w: glassW, h: GLASS_H }, {
          cornerRadius: R,
          refractionHeight: 10,
          refractionAmount: -18,
          blurRadius: 6,
          saturation: 1.8,
          surfaceColor: [1, 1, 1, 0.13]
        }, false);
        bg.isBottomTabContainer = { groupId: prefix, tabsCount: n };
        bg.independentBackdrop = true;
        bg.useContinuousSdf = true;
        els.push(bg);
        const indInset = cfg.indicatorInset || 0;
        const indHalf = indInset / 2;
        const ind = makeGlassShape(prefix + "-indicator", { x: glassX + indHalf, y: glassY + indHalf, w: tabW - indInset, h: GLASS_H - indInset }, {
          cornerRadius: (GLASS_H - indInset) / 2,
          refractionHeight: 20,
          refractionAmount: -20,
          blurRadius: 0,
          saturation: 1,
          tintColor: [0, 0, 0, 0],
          surfaceColor: [0, 0, 0, 0],
          chromaticAberration: false
        }, false);
        ind.independentBackdrop = true;
        ind.isBottomTabIndicator = {
          groupId: prefix,
          dragWidth: tabW,
          dimColor: [1, 1, 1, 0.1],
          accentColor: [1, 1, 1, 1],
          containerRect: { x: glassX - GLASS_PAD, y: glassY, w: glassW + GLASS_PAD * 2, h: GLASS_H },
          containerCenterX: centerX,
          containerCenterY: centerY,
          containerWidth: containerW,
          tabContentIds: [],
          tabContentRects: tabRects
        };
        els.push(ind);
        const dragRaw = cfg.locked ? null : makeTabDragInteractions(prefix, tabW, n, (i) => {
          const it = items[i];
          if (!it) return;
          cfg.onSelect(it.key, i);
        }, { current: renderer });
        const drag = dragRaw;
        items.forEach((it, i) => {
          const on = i === idx;
          if (it.label) {
            const t = makeText(prefix + "-tab-" + i, tabRects[i], it.label, {
              color: on ? [0.17, 0.53, 1, 1] : [1, 1, 1, 0.72],
              fontSizePx: fs1,
              letterSpacingPx: trackFor(fs1),
              fontWeight: 600,
              align: "center",
              paddingPx: 0
            }, false);
            t.isBottomTabContent = {
              groupId: prefix,
              containerCenterX: centerX,
              containerCenterY: centerY,
              containerWidth: containerW
            };
            els.push(t);
          } else {
            const hit = makePlainRect(prefix + "-tab-" + i, tabRects[i], [0, 0, 0, 0], 0, false);
            hit.isInteractive = true;
            els.push(hit);
          }
          if (!cfg.locked) {
            const tap = () => cfg.onSelect(it.key, i);
            inter[prefix + "-tab-" + i] = drag ? { ...drag, onTap: tap } : { onTap: tap };
            if (it.tip) inter[prefix + "-tab-" + i].tip = it.tip;
          }
        });
        if (drag) inter[prefix + "-bg"] = { ...drag };
        return { els, inter };
      }
      var tdUrlValue = "";
      var tdSavePath = "";
      var tdConns = 32;
      var tdChunkMb = 1;
      var tdRunning = false;
      var tdPct = 0;
      var tdDownloaded = 0;
      var tdTotal = 0;
      var tdSpeed = 0;
      var tdErr = "";
      var tdDonePath = "";
      var Td = { url: { x: 0, y: 0, w: 0, h: 0 }, conns: { x: 0, y: 0, w: 0, h: 0 }, chunk: { x: 0, y: 0, w: 0, h: 0 } };
      function tdEl(id) {
        return document.getElementById(id);
      }
      function tdShowInput(id, r) {
        const el = tdEl(id);
        if (!el) return;
        if (!r || r.w < 8) {
          el.style.display = "none";
          return;
        }
        el.style.display = "block";
        el.style.left = r.x + "px";
        el.style.top = r.y + "px";
        el.style.width = r.w + "px";
        el.style.height = r.h + "px";
        el.style.lineHeight = r.h + "px";
      }
      function syncTdInputs() {
        const on = page === "download" && dlSection === "thread" && !modal;
        tdShowInput("tdUrl", on ? Td.url : null);
        const numOn = on && !tdRunning;
        tdShowInput("tdConns", numOn ? Td.conns : null);
        tdShowInput("tdChunk", numOn ? Td.chunk : null);
      }
      function tdBindInputs() {
        const u = tdEl("tdUrl");
        if (u && !u.dataset.bound) {
          u.dataset.bound = "1";
          u.addEventListener("input", () => {
            tdUrlValue = u.value.trim();
          });
          u.addEventListener("keydown", (e) => {
            if (e.key === "Enter") tdStart();
          });
        }
        const c = tdEl("tdConns");
        if (c && !c.dataset.bound) {
          c.dataset.bound = "1";
          c.addEventListener("input", () => {
            const v = Math.round(Number(c.value) || 0);
            tdConns = Math.min(256, Math.max(1, v || 96));
          });
          c.addEventListener("blur", () => {
            c.value = String(tdConns);
          });
        }
        const k = tdEl("tdChunk");
        if (k && !k.dataset.bound) {
          k.dataset.bound = "1";
          k.addEventListener("input", () => {
            const v = Math.round(Number(k.value) || 0);
            tdChunkMb = Math.min(64, Math.max(1, v || 1));
          });
          k.addEventListener("blur", () => {
            k.value = String(tdChunkMb);
          });
        }
      }
      function tdStart() {
        if (tdRunning) return;
        if (!tdUrlValue) {
          tdErr = "\u8BF7\u5148\u7C98\u8D34\u4E0B\u8F7D\u76F4\u94FE";
          build();
          return;
        }
        if (!tdSavePath) {
          tdErr = "\u8BF7\u5148\u9009\u62E9\u5B58\u653E\u8DEF\u5F84";
          build();
          return;
        }
        tdRunning = true;
        tdErr = "";
        tdDonePath = "";
        tdPct = 0;
        tdSpeed = 0;
        tdDownloaded = 0;
        tdTotal = 0;
        build();
        post({ action: "td_start", url: tdUrlValue, savePath: tdSavePath, conns: tdConns, chunkMb: tdChunkMb });
      }
      function buildThreadSection(L) {
        const els = [];
        const inter = {};
        const pad = 26;
        const x = L.leftX + pad;
        const w = L.leftW - pad * 2;
        let y = L.top + pad;
        tdBindInputs();
        els.push(makeText("td-title", { x, y, w, h: 30 }, "\u591A\u7EBF\u7A0B\u4E0B\u8F7D", {
          color: [1, 1, 1, 1],
          fontSizePx: 22,
          letterSpacingPx: trackFor(22),
          fontWeight: 800,
          align: "left",
          paddingPx: 0
        }, false));
        y += 44;
        els.push(makeGlassShape("td-url-bg", { x, y, w, h: 46 }, {
          cornerRadius: 23,
          refractionHeight: 10,
          refractionAmount: -12,
          blurRadius: 6,
          saturation: 1.2,
          surfaceColor: [1, 1, 1, 0.1]
        }, false));
        Td.url = { x: x + 18, y: y + 13, w: w - 36, h: 20 };
        y += 58;
        els.push(makeGlassShape("td-path-bg", { x, y, w, h: 46 }, {
          cornerRadius: 23,
          refractionHeight: 10,
          refractionAmount: -12,
          blurRadius: 6,
          saturation: 1.2,
          surfaceColor: [1, 1, 1, 0.1]
        }, false));
        els.push(makeText("td-path-label", { x: x + 18, y: y + 14, w: 130, h: 20 }, "\u6587\u4EF6\u5B58\u653E\u8DEF\u5F84", {
          color: [1, 1, 1, 1],
          fontSizePx: 13,
          letterSpacingPx: trackFor(13),
          fontWeight: 600,
          align: "left",
          paddingPx: 0
        }, false));
        const pathName = tdSavePath ? tdSavePath.split(/[\\/]/).pop() || tdSavePath : "\u672A\u9009\u62E9";
        els.push(makeText("td-path-val", { x: x + 150, y: y + 14, w: w - 168, h: 20 }, pathName, {
          color: [1, 1, 1, tdSavePath ? 0.9 : 0.5],
          fontSizePx: 12,
          letterSpacingPx: trackFor(12),
          fontWeight: 500,
          align: "right",
          paddingPx: 0
        }, false));
        inter["td-path-bg"] = { onTap: () => post({ action: "td_pick_save" }) };
        y += 58;
        const halfW = Math.round((w - 12) / 2);
        const pillH = 46;
        els.push(makeGlassShape("td-conns-bg", { x, y, w: halfW, h: pillH }, {
          cornerRadius: 23,
          refractionHeight: 8,
          refractionAmount: -10,
          blurRadius: 4,
          saturation: 1.1,
          surfaceColor: [1, 1, 1, 0.08]
        }, false));
        els.push(makeText("td-conns-label", { x: x + 16, y: y + 14, w: 70, h: 20 }, "\u5E76\u53D1\u6570", {
          color: [1, 1, 1, 0.95],
          fontSizePx: 13,
          letterSpacingPx: trackFor(13),
          fontWeight: 600,
          align: "left",
          paddingPx: 0
        }, false));
        Td.conns = { x: x + halfW - 68, y: y + 13, w: 52, h: 20 };
        const x2 = x + halfW + 12;
        els.push(makeGlassShape("td-chunk-bg", { x: x2, y, w: halfW, h: pillH }, {
          cornerRadius: 23,
          refractionHeight: 8,
          refractionAmount: -10,
          blurRadius: 4,
          saturation: 1.1,
          surfaceColor: [1, 1, 1, 0.08]
        }, false));
        els.push(makeText("td-chunk-label", { x: x2 + 16, y: y + 14, w: 92, h: 20 }, "\u5206\u7247(MB)", {
          color: [1, 1, 1, 0.95],
          fontSizePx: 13,
          letterSpacingPx: trackFor(13),
          fontWeight: 600,
          align: "left",
          paddingPx: 0
        }, false));
        Td.chunk = { x: x2 + halfW - 68, y: y + 13, w: 52, h: 20 };
        y += pillH + 14;
        if (tdRunning || tdPct > 0 || tdErr || tdDonePath) {
          const barW = w;
          els.push(makePlainRect("td-bar-bg", { x, y: y + 2, w: barW, h: 6 }, [1, 1, 1, 0.16], 3, false));
          const fillW = Math.max(0, Math.min(barW, Math.round(barW * tdPct / 100)));
          if (fillW > 0) {
            els.push(makePlainRect("td-bar-fill", { x, y: y + 2, w: fillW, h: 6 }, [0.04, 0.52, 1, 1], 3, false));
          }
          let status = "";
          if (tdErr) status = tdErr;
          else if (tdRunning) status = (tdPct > 0 ? tdPct.toFixed(1) + "%" : "\u8FDE\u63A5\u4E2D\u2026") + (tdSpeed > 0 ? "   \xB7   " + (tdSpeed / 1048576).toFixed(2) + " MB/s" : "");
          else if (tdDonePath) status = "\u5DF2\u5B8C\u6210 \xB7 " + (tdDonePath.split(/[\\/]/).pop() || "");
          els.push(makeText("td-status", { x, y: y + 14, w, h: 18 }, status, {
            color: tdErr ? [1, 0.5, 0.5, 1] : [1, 1, 1, 0.7],
            fontSizePx: 12,
            letterSpacingPx: trackFor(12),
            fontWeight: 500,
            align: "left",
            paddingPx: 0
          }, false));
          y += 42;
        }
        const btnH = 46;
        const bW = Math.round((w - 14) / 2);
        els.push(makeButton("td-start", { x, y, w: bW, h: btnH }, {
          label: tdRunning ? "\u4E0B\u8F7D\u4E2D\u2026" : "\u5F00\u59CB\u4E0B\u8F7D",
          tintColor: [0, 0.478, 1, tdRunning ? 0.16 : 0.34],
          surfaceColor: [0, 0.478, 1, tdRunning ? 0.35 : 0.9],
          labelColor: [1, 1, 1, tdRunning ? 0.7 : 1],
          labelFontSizePx: 15
        }, false));
        if (!tdRunning) inter["td-start"] = { onTap: () => tdStart() };
        els.push(makeButton("td-cancel", { x: x + bW + 14, y, w: bW, h: btnH }, {
          label: "\u53D6\u6D88",
          tintColor: [1, 1, 1, 0.14],
          surfaceColor: [1, 1, 1, 0.16],
          labelColor: [1, 1, 1, 0.95],
          labelFontSizePx: 15
        }, false));
        inter["td-cancel"] = {
          onTap: () => {
            if (tdRunning) post({ action: "cancel_download" });
            tdRunning = false;
            tdErr = "";
            tdDonePath = "";
            tdPct = 0;
            tdSpeed = 0;
            build();
          }
        };
        return { els, inter };
      }
      function dlLayout() {
        const contentW = Math.min(W - DL_PAD * 2, DL_MAX_W);
        const leftX = Math.round((W - contentW) / 2);
        const rightW = PANEL_W;
        const leftW = contentW - rightW - DL_GAP;
        return {
          leftX,
          leftW,
          rightX: leftX + leftW + DL_GAP,
          rightW,
          top: DL_TOP,
          h: H - DL_TOP - 120
        };
      }
      var LOADER_ICONS = {
        vanilla: "grass_block.png",
        forge: "forge.png",
        fabric: "fabirc.png",
        neoforge: "neoforge.png"
      };
      var progressRaf = 0;
      function applyProgressVisual() {
        const pct = dl.visPct;
        for (const el of elements) {
          if (el.id === "inst-fg" && dl.trackW) {
            el.rect.w = Math.max(2, Math.min(1, pct / 100) * dl.trackW);
          }
        }
        pushElements();
        const pctDom = document.getElementById("dlPctDom");
        if (pctDom && pctDom.style.display !== "none") {
          pctDom.textContent = dl.phase === "done" ? "100%" : Math.round(pct) + "%";
        }
      }
      function startProgressAnim() {
        if (progressRaf) return;
        const step = () => {
          const diff = dl.percent - dl.visPct;
          if (Math.abs(diff) < 0.25) {
            dl.visPct = dl.percent;
            applyProgressVisual();
            progressRaf = 0;
            return;
          }
          dl.visPct += diff * 0.16;
          applyProgressVisual();
          progressRaf = requestAnimationFrame(step);
        };
        progressRaf = requestAnimationFrame(step);
      }
      function buildDownload() {
        const L = dlLayout();
        const els = [];
        const inter = {};
        const locked = dl.phase === "installing";
        placeExpandSvg(null, false);
        {
          const sec = buildTabCapsule({
            prefix: "dl-sec",
            x: L.leftX,
            y: 74,
            w: 284,
            h: 44,
            indicatorInset: 8,
            items: DL_SECTIONS,
            activeKey: dlSection,
            locked,
            onSelect: (k, i) => {
              if (dlSection === k) return;
              dlSection = k;
              build();
              try {
                renderer.setTabSelected("dl-sec", i, DL_SECTIONS.length);
              } catch (e) {
              }
            }
          });
          els.push(...sec.els);
          Object.assign(inter, sec.inter);
        }
        const cardX = L.leftX;
        const cardY = L.top;
        const cardW = L.leftW;
        const cardH = L.h;
        if (dlSection === "thread") {
          els.push(makeGlassShape("dl-card", { x: L.leftX, y: L.top, w: L.leftW, h: L.h }, {
            cornerRadius: 28,
            ...M_LIQUID,
            surfaceColor: [1, 1, 1, 0.1]
          }, false));
          const t = buildThreadSection(L);
          els.push(...t.els);
          Object.assign(inter, t.inter);
          syncTdInputs();
          return { els, inter };
        }
        if (dlSection !== "game") {
          const cardX2 = L.leftX;
          const cardY2 = L.top;
          const cardW2 = L.leftW;
          const cardH2 = L.h;
          els.push(makeGlassShape("dl-card", { x: cardX2, y: cardY2, w: cardW2, h: cardH2 }, {
            cornerRadius: 28,
            ...M_LIQUID,
            surfaceColor: [1, 1, 1, 0.1]
          }, false));
          els.push(makeText("dl-ph-t", { x: cardX2, y: cardY2 + Math.round(cardH2 / 2) - 30, w: cardW2, h: 34 }, "\u8D44\u6E90\u5927\u5385", {
            color: [1, 1, 1, 0.92],
            fontSizePx: 22,
            letterSpacingPx: trackFor(22),
            fontWeight: 700,
            align: "center",
            paddingPx: 0
          }, false));
          els.push(makeText("dl-ph-s", { x: cardX2, y: cardY2 + Math.round(cardH2 / 2) + 10, w: cardW2, h: 22 }, "\u5206\u533A\u5DF2\u5C31\u4F4D \xB7 \u7B49\u4F60\u753B\u8349\u56FE", {
            color: [1, 1, 1, 0.5],
            fontSizePx: 13,
            letterSpacingPx: trackFor(13),
            fontWeight: 500,
            align: "center",
            paddingPx: 0
          }, false));
          syncTdInputs();
          return { els, inter };
        }
        syncTdInputs();
        els.push(makeGlassShape("dl-card", { x: cardX, y: cardY, w: cardW, h: cardH }, {
          cornerRadius: 28,
          ...M_LIQUID,
          surfaceColor: [1, 1, 1, 0.1]
        }, false));
        const CATS = [
          { key: "release", label: "\u6B63\u5F0F\u7248" },
          { key: "snapshot", label: "\u5FEB\u7167\u7248" },
          { key: "old", label: "\u8FDC\u53E4\u7248" }
        ];
        const pillY = cardY + 18;
        {
          const seg = buildTabCapsule({
            prefix: "dl-cats",
            x: cardX + 18,
            y: pillY + 4,
            w: 78 * CATS.length,
            h: 32,
            indicatorInset: 6,
            items: CATS.map((c) => ({ key: c.key, label: c.label })),
            activeKey: dl.category,
            locked,
            fontSize: 13,
            onSelect: (k, i) => {
              dl.category = k;
              dlScrollY = 0;
              dlTargetScroll = 0;
              listEnterPending = true;
              build();
              try {
                renderer.setTabSelected("dl-cats", i, CATS.length);
              } catch (e) {
              }
            }
          });
          els.push(...seg.els);
          Object.assign(inter, seg.inter);
        }
        const clearR = { x: cardX + cardW - 56, y: pillY - 3, w: 38, h: 38 };
        els.push(makeButton("dl-clear", clearR, {
          label: "",
          tintColor: [1, 0.3, 0.3, 0.35],
          surfaceColor: [1, 0.3, 0.3, 0.5],
          labelColor: WHITE
        }, false));
        els.push(makeText("dl-clear-i", clearR, "", {
          icon: { path: ICON_CLOSE, size: 20, viewport: 24, color: [1, 1, 1, locked ? 0.4 : 0.92] },
          align: "center",
          paddingPx: 0
        }, false));
        if (!locked) {
          inter["dl-clear"] = { onTap: () => {
            dlPanel = null;
            dl.picked = false;
            build(true);
          } };
        }
        const listX = cardX + 14;
        const listW = cardW - 28;
        const listTop = pillY + 32 + 16;
        const listH = Math.floor((cardY + cardH - 18 - listTop + DL_ROW_GAP) / DL_PITCH) * DL_PITCH - DL_ROW_GAP;
        dlListTop = listTop;
        dlListH = listH;
        dlListX = listX;
        dlListW = listW;
        const items = filteredDlVersions();
        if (!dl.fetched && !dl.error) {
          els.push(makeText("dl-state", { x: listX + 8, y: listTop + 14, w: listW - 16, h: 22 }, "\u6B63\u5728\u83B7\u53D6\u7248\u672C\u5217\u8868\u2026", {
            color: [0, 0, 0, 0.5],
            fontSizePx: 13,
            letterSpacingPx: trackFor(13),
            fontWeight: 500,
            align: "left",
            paddingPx: 0
          }, false));
        } else if (dl.error) {
          els.push(makeText("dl-state", { x: listX + 8, y: listTop + 14, w: listW - 16, h: 22 }, dl.error, {
            color: [0.78, 0.16, 0.16, 0.82],
            fontSizePx: 13,
            letterSpacingPx: trackFor(13),
            fontWeight: 500,
            align: "left",
            paddingPx: 0
          }, false));
        } else if (!items.length) {
          els.push(makeText("dl-state", { x: listX + 8, y: listTop + 14, w: listW - 16, h: 22 }, "\u8FD9\u4E2A\u5206\u7C7B\u4E0B\u6CA1\u6709\u7248\u672C", {
            color: [0, 0, 0, 0.5],
            fontSizePx: 13,
            letterSpacingPx: trackFor(13),
            fontWeight: 500,
            align: "left",
            paddingPx: 0
          }, false));
        }
        dlMaxScroll = Math.max(0, items.length * DL_PITCH - DL_ROW_GAP - listH);
        if (dlScrollY > dlMaxScroll) dlScrollY = dlMaxScroll;
        if (dlTargetScroll > dlMaxScroll) dlTargetScroll = dlMaxScroll;
        const clip = { x: listX - 4, y: listTop, w: listW + 8, h: listH };
        dlBuiltIdx = Math.floor(dlScrollY / DL_PITCH);
        const first = Math.max(0, Math.floor(dlScrollY / DL_PITCH) - 2);
        const visibleRows = Math.ceil(listH / DL_PITCH) + 4;
        const last = Math.min(items.length - 1, first + visibleRows);
        dlItems = [];
        for (let i = first; i <= last; i++) {
          const v = items[i];
          if (!v) continue;
          const baseY = listTop + i * DL_PITCH;
          const y = baseY - dlScrollY;
          if (y + DL_ROW_H < listTop - DL_PITCH || y > listTop + listH + DL_PITCH) continue;
          const r = { x: listX, y, w: listW, h: DL_ROW_H };
          const cur = dl.mcVersion === v.id && dl.picked;
          const glass = makeGlassShape("dl-item-" + i, r, {
            cornerRadius: DL_ROW_H / 2,
            refractionHeight: 14,
            refractionAmount: -20,
            blurRadius: 4,
            saturation: 1.6,
            brightness: 0.05,
            surfaceColor: cur ? [1, 1, 1, 0.62] : [1, 1, 1, locked ? 0.08 : 0.12]
          }, false);
          glass.clipRect = { ...clip };
          els.push(glass);
          const txt = makeText("dl-item-t-" + i, { x: r.x + 26, y: r.y, w: listW - 150, h: DL_ROW_H }, v.id, {
            color: cur ? [1, 1, 1, 1] : [1, 1, 1, locked ? 0.5 : 1],
            fontSizePx: FS.title3,
            letterSpacingPx: trackFor(FS.title3),
            fontWeight: 800,
            align: "left",
            paddingPx: 0
          }, false);
          txt.clipRect = { ...clip };
          txt.isInteractive = false;
          els.push(txt);
          const getR = { x: r.x + listW - 100, y: r.y + 9, w: 84, h: 30 };
          const getBtn = makeButton("dl-get-" + i, getR, {
            label: "\u83B7\u53D6",
            tintColor: CLEAR,
            surfaceColor: [0, 0.478, 1, 0.9],
            labelColor: [1, 1, 1, locked ? 0.6 : 1],
            labelFontSizePx: 15
          }, false);
          getBtn.noPressMove = true;
          getBtn.clipRect = { ...clip };
          els.push(getBtn);
          const rowTop = baseY - dlScrollY;
          dlItems.push({
            baseY,
            els: [
              { el: glass, dy: glass.rect.y - rowTop },
              { el: txt, dy: txt.rect.y - rowTop },
              { el: getBtn, dy: getBtn.rect.y - rowTop }
            ]
          });
          if (!locked) inter["dl-get-" + i] = { onTap: () => pickDlVersion(v) };
        }
        return { els, inter };
      }
      function pickDlVersion(v) {
        if (dl.phase === "installing") return;
        dl.mcVersion = v.id;
        dl.versionUrl = v.url;
        dl.picked = true;
        dl.phase = "idle";
        dl.logs = [];
        dl.percent = 0;
        dl.visPct = 0;
        dl.speed = 0;
        dl.lastMb = 0;
        dl.lastMbAt = 0;
        dl.message = "";
        dl.lastMessage = "";
        dl.lastKey = "";
        dl.error = "";
        dl.ddOpen = false;
        dl.ddScroll = 0;
        dlPanel = "install";
        build();
        if (!playedEnter.has("install")) {
          playedEnter.add("install");
          animateEnter(panelEls, 300);
        }
        if (dl.loader !== "vanilla") requestLoaderVersions();
      }
      function cancelDownload() {
        post({ action: "cancel_download" });
        dl.phase = "idle";
        dl.speed = 0;
        dl.message = "\u5DF2\u53D6\u6D88";
        dl.percent = 0;
        dl.visPct = 0;
        dl.logs = [];
        dl.lastKey = "";
        build();
      }
      function buildInstallPanel() {
        const L = dlLayout();
        const px = L.rightX;
        const py = L.top;
        const pw = L.rightW;
        const ph = L.h;
        const els = [];
        const inter = {};
        const locked = dl.phase === "installing";
        const ddLayer = [];
        els.push(makeGlassShape("inst-panel", { x: px, y: py, w: pw, h: ph }, {
          cornerRadius: 32,
          ...M_LIQUID,
          surfaceColor: [1, 1, 1, 0.12]
        }, false));
        els.push(makeText("inst-title", { x: px + 24, y: py + 18, w: pw - 100, h: 26 }, dl.mcVersion || "\u672A\u9009\u62E9\u7248\u672C", {
          color: WHITE,
          fontSizePx: FS.title2,
          letterSpacingPx: trackFor(FS.title2),
          fontWeight: 700,
          align: "left",
          paddingPx: 0,
          halo: "dark"
        }, false));
        const closeR = { x: px + pw - 56, y: py + 10, w: 38, h: 38 };
        els.push(makeButton("inst-close", closeR, {
          label: "",
          tintColor: [1, 0.3, 0.3, 0.35],
          surfaceColor: [1, 0.3, 0.3, 0.5],
          labelColor: WHITE
        }, false));
        els.push(makeText("inst-close-i", closeR, "", {
          icon: { path: ICON_CLOSE, size: 20, viewport: 24, color: [1, 1, 1, locked ? 0.4 : 0.92] },
          align: "center",
          paddingPx: 0
        }, false));
        if (!locked) inter["inst-close"] = { onTap: () => {
          dlPanel = null;
          dl.picked = false;
          build(true);
        } };
        const ldW = pw - 48;
        const ldH = 64;
        const ldY = py + 58;
        const ldPad = 4;
        const cellW = (ldW - ldPad * 2) / LOADERS.length;
        els.push(makeGlassShape("inst-ld-bar", { x: px + 24, y: ldY, w: ldW, h: ldH }, {
          cornerRadius: ldH / 2,
          refractionHeight: 10,
          refractionAmount: -14,
          blurRadius: 6,
          saturation: 1.3,
          surfaceColor: [1, 1, 1, locked ? 0.12 : 0.2]
        }, false));
        const activeLdIdx = LOADERS.findIndex((l) => l.key === dl.loader);
        if (activeLdIdx >= 0) {
          const targetX = px + 24 + ldPad + activeLdIdx * cellW;
          const prevX = segIndicatorX.get("inst-ld");
          const indRect = { x: prevX !== void 0 ? prevX : targetX, y: ldY + ldPad, w: cellW, h: ldH - ldPad * 2 };
          els.push(makeGlassShape("inst-ld-ind", indRect, {
            cornerRadius: (ldH - ldPad * 2) / 2,
            refractionHeight: 8,
            refractionAmount: -12,
            blurRadius: 0,
            saturation: 1,
            surfaceColor: [1, 1, 1, locked ? 0.5 : 0.72],
            chromaticAberration: true,
            innerShadow: { radius: 5, alpha: 0.22, offsetX: 0, offsetY: 5 },
            outerShadow: null
          }, false));
          segIndicatorX.set("inst-ld", targetX);
          if (prevX !== void 0 && Math.abs(prevX - targetX) > 0.5) {
            const t0 = performance.now();
            const dur = 220;
            const fromX = prevX, toX = targetX;
            const step = () => {
              const p = Math.min(1, (performance.now() - t0) / dur);
              const k = 1 - Math.pow(1 - p, 3);
              const cur = elements.find((e) => e.id === "inst-ld-ind");
              if (cur) {
                cur.rect.x = fromX + (toX - fromX) * k;
                pushElements();
              }
              if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }
        }
        LOADERS.forEach((l, i) => {
          const cx = px + 24 + ldPad + i * cellW;
          const on = dl.loader === l.key;
          if (LOADER_ICONS[l.key]) {
            pendingIcons.push({
              src: LOADER_ICONS[l.key],
              rect: { x: cx + (cellW - 26) / 2, y: ldY + 9, w: 26, h: 26 }
            });
          }
          els.push(makeText("inst-ld-t-" + i, { x: cx, y: ldY + 38, w: cellW, h: 18 }, l.label, {
            color: on ? [1, 1, 1, locked ? 0.5 : 1] : [1, 1, 1, locked ? 0.3 : 0.7],
            fontSizePx: FS.headline,
            letterSpacingPx: trackFor(FS.headline),
            fontWeight: 700,
            align: "center",
            paddingPx: 0
          }, false));
          if (!locked) inter["inst-ld-" + i] = { onTap: () => selectLoader(l.key) };
        });
        if (!locked) {
          const idxAt = (pxx) => Math.max(0, Math.min(LOADERS.length - 1, Math.floor((pxx - (px + 24 + ldPad)) / cellW)));
          inter["inst-ld-bar"] = {
            onTap: (pos) => selectLoader(LOADERS[idxAt(pos.x)].key),
            onDrag: (pos) => {
              const ind = elements.find((e) => e.id === "inst-ld-ind");
              if (!ind) return;
              const minX = px + 24 + ldPad;
              const maxX = px + 24 + ldW - ldPad - cellW;
              ind.rect.x = Math.max(minX, Math.min(maxX, pos.x - cellW / 2));
              segIndicatorX.set("inst-ld", ind.rect.x);
              pushElements();
            },
            onDragEnd: (pos) => selectLoader(LOADERS[idxAt(pos.x)].key)
          };
        }
        let y = py + 136;
        if (dl.loader !== "vanilla") {
          els.push(makeText("inst-lver-h", { x: px + 24, y, w: 200, h: 16 }, "\u52A0\u8F7D\u5668\u7248\u672C", {
            color: [0, 0, 0, 0.5],
            fontSizePx: FS.subheadline,
            letterSpacingPx: trackFor(FS.subheadline),
            fontWeight: 700,
            align: "left",
            paddingPx: 0
          }, false));
          y += 20;
          const pillR = { x: px + 24, y, w: pw - 48, h: 38 };
          const cur = dl.loaderVersion || (dl.loaderVersions.length ? dl.loaderVersions[0] : "");
          els.push(makeGlassShape("inst-lv-pill", pillR, {
            cornerRadius: 19,
            ...M_FROST,
            surfaceColor: dl.ddOpen ? [1, 1, 1, 0.82] : [1, 1, 1, 0.46]
          }, false));
          els.push(makeText(
            "inst-lv-cur",
            { x: pillR.x + 18, y: pillR.y, w: pillR.w - 60, h: pillR.h },
            dl.loaderVersions.length ? cur : "\u6B63\u5728\u83B7\u53D6\u2026",
            {
              color: [0, 0, 0, locked ? 0.45 : 0.92],
              fontSizePx: FS.title3,
              letterSpacingPx: trackFor(FS.title3),
              fontWeight: 700,
              align: "left",
              paddingPx: 0
            },
            false
          ));
          els.push(makeText("inst-lv-chev", { x: pillR.x + pillR.w - 36, y: pillR.y, w: 24, h: pillR.h }, "", {
            icon: { path: CHEVRON_DOWN, size: 10, viewport: 24, color: [0, 0, 0, locked ? 0.3 : 0.55] },
            align: "center",
            paddingPx: 0
          }, false));
          if (!locked && dl.loaderVersions.length) {
            inter["inst-lv-pill"] = { onTap: () => {
              dl.ddOpen = !dl.ddOpen;
              dl.ddScroll = 0;
              build();
            } };
          }
          if (dl.ddOpen && dl.loaderVersions.length) {
            const rowH = 36;
            const padY = 6;
            const ddX = pillR.x;
            const ddW = pillR.w;
            const ddY = pillR.y + pillR.h + 6;
            const rows = Math.min(4, dl.loaderVersions.length);
            const ddH = rows * rowH + padY * 2;
            dl.ddRect = { x: ddX, y: ddY, w: ddW, h: ddH };
            const maxScroll = Math.max(0, dl.loaderVersions.length * rowH - rows * rowH);
            dl.ddMax = maxScroll;
            if (dl.ddScroll > maxScroll) dl.ddScroll = maxScroll;
            if (dl.ddScroll < 0) dl.ddScroll = 0;
            ddLayer.push(makeGlassShape("inst-dd-bg", { x: ddX, y: ddY, w: ddW, h: ddH }, {
              cornerRadius: 18,
              refractionHeight: 0,
              refractionAmount: 0,
              blurRadius: 16,
              saturation: 1.4,
              brightness: 0.02,
              surfaceColor: [1, 1, 1, 0.28]
            }, false));
            const clip = { x: ddX + 6, y: ddY + padY, w: ddW - 12, h: ddH - padY * 2 };
            const firstRow = Math.max(0, Math.floor(dl.ddScroll / rowH));
            const lastRow = Math.min(dl.loaderVersions.length - 1, firstRow + rows + 1);
            for (let i = firstRow; i <= lastRow; i++) {
              const lv = dl.loaderVersions[i];
              if (!lv) continue;
              const ry = ddY + padY + i * rowH - dl.ddScroll;
              const on = lv === cur;
              if (on) {
                const hl = makePlainRect("inst-dd-hl-" + i, { x: ddX + 6, y: ry + 1, w: ddW - 12, h: rowH - 2 }, [0, 0.478, 1, 1], 10, false);
                hl.clipRect = { ...clip };
                ddLayer.push(hl);
              }
              const lab = makeText("inst-dd-r-" + i, { x: ddX + 18, y: ry, w: ddW - 36, h: rowH }, lv, {
                color: on ? WHITE : [1, 1, 1, 0.88],
                fontSizePx: FS.title3,
                letterSpacingPx: trackFor(FS.title3),
                fontWeight: 600,
                align: "left",
                paddingPx: 0,
                halo: "dark"
              }, false);
              lab.clipRect = { ...clip };
              lab.isInteractive = true;
              ddLayer.push(lab);
              inter["inst-dd-r-" + i] = {
                onTap: () => {
                  dl.loaderVersion = lv;
                  dl.ddOpen = false;
                  dl.ddScroll = 0;
                  build();
                }
              };
            }
          }
          y += 38 + 16;
        }
        dl.trackW = pw - 48;
        const barX = px + 24;
        const blockH = 132;
        const freeTop = y;
        const freeBottom = py + ph - 70;
        const baseY = freeTop + Math.max(6, (freeBottom - freeTop - blockH) / 2);
        if (dl.phase === "idle") {
          els.push(makeText(
            "inst-empty",
            { x: barX, y: baseY + 10, w: dl.trackW, h: 60 },
            "\u9009\u62E9\u52A0\u8F7D\u5668\u540E\u70B9\u300C\u5F00\u59CB\u4E0B\u8F7D\u300D",
            {
              color: [0, 0, 0, 0.32],
              fontSizePx: FS.callout,
              letterSpacingPx: trackFor(FS.callout),
              fontWeight: 600,
              align: "center",
              paddingPx: 0
            },
            false
          ));
        } else {
          const done = dl.phase === "done";
          const barY = baseY + 50;
          const barH = 7;
          // 纯 Canvas 画进度条，文字全部改用 DOM
          els.push(makePlainRect("inst-bar-bg", { x: barX, y: barY, w: dl.trackW, h: barH }, [1, 1, 1, 0.18], barH / 2, false));
          const fw = Math.max(barH, Math.min(1, dl.visPct / 100) * dl.trackW);
          els.push(makePlainRect("inst-fg", { x: barX, y: barY, w: fw, h: barH }, done ? [0.3, 0.9, 0.5, 1] : [1, 1, 1, 0.95], barH / 2, false));
          
          // 刷新 DOM 文字
          const pctDom = document.getElementById("dlPctDom");
          const speedDom = document.getElementById("dlSpeedDom");
          const msgDom = document.getElementById("dlMsgDom");
          
          if (pctDom) {
            pctDom.style.display = "block";
            pctDom.style.left = barX + "px";
            pctDom.style.top = (barY - 32) + "px";
            pctDom.style.width = "auto";
            pctDom.style.textAlign = "left";
            pctDom.style.fontSize = "20px";
            pctDom.textContent = done ? "100%" : Math.round(dl.visPct) + "%";
            pctDom.style.color = done ? "#4ade80" : "#ffffff";
          }
          if (speedDom) {
            speedDom.style.display = "block";
            speedDom.style.left = barX + "px";
            speedDom.style.top = (barY - 32) + "px";
            speedDom.style.width = dl.trackW + "px";
            speedDom.style.textAlign = "right";
            speedDom.style.fontSize = "14px";
            speedDom.textContent = dl.speed > 0 ? dl.speed.toFixed(1) + " Mb/s" : (done ? "已完成" : "");
          }
          if (msgDom) {
            msgDom.style.display = "block";
            msgDom.style.left = barX + "px";
            msgDom.style.top = (barY + 16) + "px";
            msgDom.style.width = dl.trackW + "px";
            msgDom.style.textAlign = "center";
            msgDom.style.fontSize = "13px";
            msgDom.textContent = dl.message || "准备中…";
          }
        }
        const goR = { x: px + 24, y: py + ph - 62, w: pw - 48, h: 46 };
        const canInstall = dl.picked && !locked && dl.phase !== "done" && (dl.loader === "vanilla" || !!dl.loaderVersion);
        els.push(makeButton("inst-go", goR, {
          label: locked ? "\u7ED3\u675F\u4E0B\u8F7D" : dl.phase === "done" ? "\u91CD\u65B0\u4E0B\u8F7D" : "\u5F00\u59CB\u4E0B\u8F7D",
          tintColor: locked ? [1, 1, 1, 0.24] : canInstall || dl.phase === "done" ? BLUE : [1, 1, 1, 0.2],
          surfaceColor: [1, 1, 1, 0.12],
          labelColor: locked ? [0, 0, 0, 0.7] : canInstall || dl.phase === "done" ? WHITE : [0, 0, 0, 0.45]
        }, false));
        els[els.length - 1].noPressMove = true;
        inter["inst-go"] = {
          onTap: () => {
            if (locked) {
              cancelDownload();
              return;
            }
            if (canInstall) startDownload();
          }
        };
        els.push(...ddLayer);
        window.__pendingDdEnter = ddLayer;
        return { els, inter };
      }
      function startCreateRoom(port) {
        const str = port != null ? String(port) : portInput.value || "";
        const parsed = parseInt(str.trim(), 10);
        const minecraftPort = Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 25565;
        room.mode = "busy";
        room.busyText = "\u6B63\u5728\u521B\u5EFA\u623F\u95F4\u2026";
        room.error = "";
        build(true);
        post({ action: "create_room", playerName: live.playerName, minecraftPort });
      }
      function startJoinRoom(code) {
        room.mode = "busy";
        room.busyText = "\u6B63\u5728\u52A0\u5165\u623F\u95F4\u2026";
        room.error = "";
        build(true);
        post({ action: "join_room", playerName: live.playerName, roomCode: code });
      }
      window.onCreateRoomResult = (d) => {
        if (d && d.ok) window.showToast("创建房间成功", "房间码：" + (d.code || ""));
        if (d && d.ok) {
          room.mode = "hosting";
          room.code = d.roomCode || "";
          room.error = "";
        } else {
          room.mode = "idle";
          room.error = d && d.error || "\u521B\u5EFA\u623F\u95F4\u5931\u8D25";
        }
        build(true);
      };
      window.onJoinRoomResult = (d) => {
        if (d && d.ok) window.showToast("加入房间成功", d.address || "");
        if (d && d.ok) {
          room.mode = "joined";
          room.address = d.address || "";
          room.error = "";
        } else {
          room.mode = "idle";
          room.error = d && d.error || "\u52A0\u5165\u623F\u95F4\u5931\u8D25";
        }
        build(true);
      };
      window.onCloseRoomResult = () => {
        window.showToast("已关闭房间");
        room.mode = "idle";
        room.code = "";
        build(true);
      };
      window.onLeaveRoomResult = () => {
        room.mode = "idle";
        room.address = "";
        build(true);
      };
      function layoutModal() {
        const w = 400, h = 252;
        const r = { x: (W - w) / 2, y: (H - h) / 2, w, h };
        const btnW = (r.w - 60 - 12) / 2;
        return {
          card: r,
          title: { x: r.x + 30, y: r.y + 24, w: r.w - 100, h: 40 },
          desc: { x: r.x + 30, y: r.y + 66, w: r.w - 60, h: 20 },
          field: { x: r.x + 30, y: r.y + 98, w: r.w - 60, h: 48 },
          action: { x: r.x + 30, y: r.y + 160, w: r.w - 60, h: 48 },
          actionL: { x: r.x + 30, y: r.y + 160, w: btnW, h: 48 },
          actionR: { x: r.x + 30 + btnW + 12, y: r.y + 160, w: btnW, h: 48 },
          close: { x: r.x + r.w - 58, y: r.y + 12, w: 38, h: 38 }
        };
      }
      function buildModal() {
        const L = layoutModal();
        const isCreate = modal === "create";
        const isOffline = modal === "offline";
        const isMs = modal === "mslogin";
        const dual = isOffline || isMs;
        const TITLES = {
          create: "\u521B\u5EFA\u623F\u95F4",
          join: "\u52A0\u5165\u623F\u95F4",
          offline: "\u6DFB\u52A0\u8D26\u6237",
          mslogin: "\u5FAE\u8F6F\u767B\u5F55"
        };
        const DESCS = {
          create: "\u586B\u597D\u7AEF\u53E3\uFF0C\u628A\u623F\u7801\u53D1\u7ED9\u670B\u53CB\u5C31\u884C",
          join: "\u8F93\u5165\u670B\u53CB\u7ED9\u4F60\u7684\u623F\u95F4\u53F7\u7801",
          offline: "\u8F93\u5165\u4E00\u4E2A\u7528\u6237\u540D\uFF0C\u4EC5\u4FDD\u5B58\u5728\u672C\u5730",
          mslogin: "\u6D4F\u89C8\u5668\u6253\u5F00\u9A8C\u8BC1\u9875\u9762\uFF0C\u8F93\u5165\u4E0B\u9762\u7684\u9A8C\u8BC1\u7801"
        };
        const els = [];
        const card = makeGlassShape("modal-card", L.card, {
          cornerRadius: 30,
          refractionHeight: 18,
          refractionAmount: -26,
          blurRadius: 4,
          saturation: 1.7,
          brightness: 0.05,
          surfaceColor: [1, 1, 1, 0.16]
        }, false);
        const title = makeText("modal-title", L.title, TITLES[modal] || "", {
          color: WHITE,
          fontSizePx: 26,
          letterSpacingPx: trackFor(26),
          fontWeight: 700,
          align: "left",
          paddingPx: 0
        }, false);
        const desc = makeText("modal-desc", L.desc, DESCS[modal] || "", {
          color: [1, 1, 1, 0.7],
          fontSizePx: 13,
          letterSpacingPx: trackFor(13),
          fontWeight: 500,
          align: "left",
          paddingPx: 0
        }, false);
        const fieldCap = makeGlassShape("modal-field", L.field, {
          cornerRadius: 24,
          refractionHeight: 10,
          refractionAmount: -14,
          blurRadius: 4,
          saturation: 1.5,
          brightness: 0.05,
          surfaceColor: [1, 1, 1, 0.12]
        }, false);
        const closeBtn = makeButton("modal-close", L.close, {
          label: "",
          tintColor: [1, 0.3, 0.3, 0.35],
          surfaceColor: [1, 0.3, 0.3, 0.5],
          labelColor: WHITE
        }, false);
        closeBtn.cornerRadius = 17;
        const closeIcon = makeText("modal-close-icon", L.close, "", {
          icon: { path: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z", size: 20, viewport: 24, color: [1, 1, 1, 0.92] },
          align: "center"
        }, false);
        els.push(card, title, desc, closeBtn, closeIcon);
        for (const el of [portInput, codeInput, offlineInput]) el.style.display = "none";
        const inter = {
          "modal-close": { onTap: () => closeModal() }
        };
        if (isMs) {
          const codeText = msUserCode || msStatus || "\u6B63\u5728\u83B7\u53D6\u9A8C\u8BC1\u7801\u2026";
          const codeId = "modal-code-" + codeText.length + "-" + (msUserCode ? "c" : "") + codeText.slice(0, 4).replace(/\W/g, "");
          els.push(makeText(codeId, L.field, codeText, {
            color: BLACK,
            fontSizePx: msUserCode ? 26 : 15,
            fontWeight: 700,
            align: "center",
            paddingPx: 0
          }, false));
          const bL = makeButton("modal-copy", L.actionL, {
            label: "\u590D\u5236\u9A8C\u8BC1\u7801",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.4],
            labelColor: BLACK
          }, false);
          const bR = makeButton("modal-open", L.actionR, {
            label: "\u6253\u5F00\u9A8C\u8BC1\u9875",
            tintColor: BLUE,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: WHITE
          }, false);
          els.push(bL, bR);
          inter["modal-copy"] = {
            onTap: () => {
              if (!msUserCode) return;
              navigator.clipboard.writeText(msUserCode).catch(() => {
              });
              msStatus = "\u5DF2\u590D\u5236\u9A8C\u8BC1\u7801";
              build();
            }
          };
          inter["modal-open"] = {
            onTap: () => {
              if (!msUri) return;
              window.open(msUri, "_blank");
            }
          };
          return { els, inter };
        }
        els.push(fieldCap);
        if (dual) {
          const bL = makeButton("modal-offline", L.actionL, {
            label: "\u6DFB\u52A0\u79BB\u7EBF\u8D26\u6237",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.4],
            labelColor: BLACK
          }, false);
          const bR = makeButton("modal-ms", L.actionR, {
            label: "\u6DFB\u52A0\u6B63\u7248\u8D26\u6237",
            tintColor: BLUE,
            surfaceColor: [1, 1, 1, 0.12],
            labelColor: WHITE
          }, false);
          els.push(bL, bR);
          inter["modal-offline"] = { onTap: () => submitOffline() };
          inter["modal-ms"] = { onTap: () => startMsLogin() };
        } else {
          const actionBtn = makeButton("modal-action", L.action, {
            label: isCreate ? "\u521B\u5EFA\u623F\u95F4" : "\u52A0\u5165\u623F\u95F4",
            tintColor: BLUE,
            surfaceColor: [1, 1, 1, 0.1],
            labelColor: WHITE
          }, false);
          els.push(actionBtn);
          inter["modal-action"] = { onTap: () => submitModal() };
        }
        const input = isCreate ? portInput : isOffline ? offlineInput : codeInput;
        for (const el of [portInput, codeInput, offlineInput]) if (el !== input) el.style.display = "none";
        input.style.display = "block";
        input.style.left = L.field.x + "px";
        input.style.top = L.field.y + "px";
        input.style.width = L.field.w + "px";
        input.style.height = L.field.h + "px";
        if (isCreate && !input.value) input.value = "25565";
        return { els, inter };
      }
      function openModal(m) {
        modal = m;
        build();
        animateEnter(modalEls, 280, { translateFrom: 0, scaleFrom: 0.86, spring: SPRING_SNAPPY });
        if (m === "create") {
          portInput.value = "25565";
          portInput.focus();
          portInput.setSelectionRange(5, 5);
        } else if (m === "offline") {
          offlineInput.value = live.playerName || "";
          offlineInput.focus();
        } else {
          readClipboard();
          codeInput.focus();
        }
      }
      function closeModal() {
        modal = null;
        for (const el of [portInput, codeInput, offlineInput]) {
          el.style.display = "none";
          el.blur();
        }
        build();
      }
      function submitOffline() {
        const name = (offlineInput.value || "").trim();
        if (!name) return;
        try {
          const accounts = JSON.parse(localStorage.getItem("accounts") || "[]");
          accounts.push({ name, type: "offline", uuid: "" });
          localStorage.setItem("accounts", JSON.stringify(accounts));
          localStorage.setItem("currentAccount", String(accounts.length - 1));
        } catch (e) {
          console.warn("[account] save failed", e);
        }
        accountPanelOpen = true;
        modal = null;
        loadAccount();
        live.avatarDataUri = "";
        avatarImg.src = "steve.png";
        build(true);
      }
      function startMsLogin() {
        msUserCode = "";
        msUri = "";
        msStatus = "\u6B63\u5728\u83B7\u53D6\u9A8C\u8BC1\u7801\u2026";
        accountPanelOpen = false;
        modal = "mslogin";
        build(true);
        post({ action: "ms_login_start" });
      }
      function submitModal() {
        if (modal === "create") {
          closeModal();
          startCreateRoom();
          return;
        } else if (modal === "offline") {
          const name = (offlineInput.value || "").trim();
          if (!name) return;
          try {
            const accounts = JSON.parse(localStorage.getItem("accounts") || "[]");
            accounts.push({ name, type: "offline", uuid: "" });
            localStorage.setItem("accounts", JSON.stringify(accounts));
            localStorage.setItem("currentAccount", String(accounts.length - 1));
          } catch (e) {
            console.warn("[account] save failed", e);
          }
          closeModal();
          loadAccount();
          build();
          if (!live.avatarDataUri) avatarImg.src = "steve.png";
          return;
        } else {
          const code = (codeInput.value || "").trim();
          if (!code) return;
          closeModal();
          startJoinRoom(code);
          return;
        }
        closeModal();
      }
      async function readClipboard() {
        try {
          const t = await navigator.clipboard.readText();
          if (t && t.trim() && t.trim().length <= 16) codeInput.value = t.trim();
        } catch {
        }
      }
      function shiftGroup(els, groupId, targetY) {
        const grp = els.filter((e) => e.id.startsWith(groupId));
        const container = grp.find((e) => e.id === `${groupId}-container`);
        if (!container) return;
        const dy = targetY - container.rect.y;
        for (const el of grp) {
          el.rect.y += dy;
          if (el.hitRect) el.hitRect.y += dy;
          if (el.clipRect) el.clipRect.y += dy;
          const ind = el.isBottomTabIndicator;
          if (ind) {
            ind.containerRect.y += dy;
            ind.containerCenterY += dy;
            ind.tabContentRects.forEach((r) => r.y += dy);
          }
        }
      }
      var TAB_LABELS = ["\u4E3B\u9875", "\u8054\u673A", "\u4E0B\u8F7D", "\u76AE\u80A4", "\u8BBE\u7F6E", "\u5173\u4E8E"];
      var TAB_ICONS = [
        "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
        "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
        "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
        "M12,2C6.49,2,2,6.49,2,12s4.49,10,10,10c1.38,0,2.5-1.12,2.5-2.5c0-0.61-0.23-1.2-0.64-1.67c-0.08-0.1-0.13-0.21-0.13-0.33 c0-0.28,0.22-0.5,0.5-0.5H16c3.31,0,6-2.69,6-6C22,6.04,17.51,2,12,2z M17.5,13c-0.83,0-1.5-0.67-1.5-1.5c0-0.83,0.67-1.5,1.5-1.5 s1.5,0.67,1.5,1.5C19,12.33,18.33,13,17.5,13z M14.5,9C13.67,9,13,8.33,13,7.5C13,6.67,13.67,6,14.5,6S16,6.67,16,7.5 C16,8.33,15.33,9,14.5,9z M5,11.5C5,10.67,5.67,10,6.5,10S8,10.67,8,11.5C8,12.33,7.33,13,6.5,13S5,12.33,5,11.5z M11,7.5 C11,8.33,10.33,9,9.5,9S8,8.33,8,7.5C8,6.67,8.67,6,9.5,6S11,6.67,11,7.5z",
        "M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z",
        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
      ];
      function buildTabs() {
        const tabRes = buildBottomTabs(W, H, () => {
        }, state, onTabSelect, rendererRef, palette);
        const tabs = tabRes.elements.filter((e) => e.id.startsWith(TAB_GROUP));
        shiftGroup(tabs, TAB_GROUP, H - 64 - 28);
        tabs.forEach((el) => {
          const m = /-tab-(\d+)$/.exec(el.id);
          if (!m || !el.text) return;
          const i = +m[1];
          el.text.content = TAB_LABELS[i] ?? el.text.content;
          if (el.text.icon) {
            el.text.icon.path = TAB_ICONS[i] ?? el.text.icon.path;
            el.text.icon.viewport = 24;
          }
        });
        return { tabs, inter: tabRes.interactions };
      }
      var TB_H = 48;
      var TB_BTN_D = 32;
      var TB_BTN_GAP = 8;
      var ICON_MIN = "M5 11h14v2.4H5z";
      var ICON_ROCKET = "M9.19,6.35c-2.04,2.29-3.44,5.58-3.57,5.89L2,10.69l4.05-4.05c0.47-0.47,1.15-0.68,1.81-0.55L9.19,6.35L9.19,6.35z M11.17,17c0,0,3.74-1.55,5.89-3.7c5.4-5.4,4.5-9.62,4.21-10.57c-0.95-0.3-5.17-1.19-10.57,4.21C8.55,9.09,7,12.83,7,12.83 L11.17,17z M17.65,14.81c-2.29,2.04-5.58,3.44-5.89,3.57L13.31,22l4.05-4.05c0.47-0.47,0.68-1.15,0.55-1.81L17.65,14.81 L17.65,14.81z M9,18c0,0.83-0.34,1.58-0.88,2.12C6.94,21.3,2,22,2,22s0.7-4.94,1.88-6.12C4.42,15.34,5.17,15,6,15 C7.66,15,9,16.34,9,18z M13,9c0-1.1,0.9-2,2-2s2,0.9,2,2s-0.9,2-2,2S13,10.1,13,9z";
      var ICON_CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";
      function buildTitlebar() {
        const out = [];
        const shadeH = 20;
        const seg = 16;
        for (let i = 0; i < seg; i++) {
          const t = i / seg;
          const a = 0.15 * (1 - t);
          const r = makePlainRect("tb-shade-" + i, { x: 0, y: TB_H + shadeH / seg * i, w: W, h: shadeH / seg + 0.5 }, [0, 0, 0, a], 0, false);
          out.push(r);
        }
        const label = makeText("tb-logo", { x: 20, y: 0, w: W - 240, h: TB_H }, "Minecraft illusion Launcher", {
          color: [1, 1, 1, 0.98],
          fontSizePx: 17,
          fontWeight: 800,
          align: "left",
          valign: "center",
          paddingPx: 0
        }, false);
        label.isInteractive = false;
        out.push(label);
        const btnY = (TB_H - TB_BTN_D) / 2;
        const totalW = TB_BTN_D * 3 + TB_BTN_GAP * 2;
        const startX = (W - totalW) / 2;
        const actions = [
          ["minimize", ICON_MIN, 24, [1, 1, 1, 1]],
          ["optimize_memory", ICON_ROCKET, 24, [1, 1, 1, 1]],
          ["close", ICON_CLOSE, 24, [1, 1, 1, 1]]
        ];
        actions.forEach(([action, path, vp, color], i) => {
          const bx = startX + i * (TB_BTN_D + TB_BTN_GAP);
          const rect = { x: bx, y: btnY, w: TB_BTN_D, h: TB_BTN_D };
          const btn = makeButton("tb-btn-" + action, rect, {
            label: "",
            tintColor: CLEAR,
            surfaceColor: [1, 1, 1, 0.14],
            labelColor: BLACK
          }, false);
          btn.noPressMove = true;
          out.push(btn);
          const ic = makeText("tb-btn-ic-" + action, rect, "", {
            icon: { path, size: 14, viewport: vp, color },
            align: "center"
          }, false);
          ic.isInteractive = false;
          out.push(ic);
        });
        return out;
      }
      var pendingIcons = [];
      var prevIconKeys = /* @__PURE__ */ new Set();
      var iconNewFlags = [];
      function placeIcons(list, offsetX = 0) {
        const layer = document.getElementById("iconLayer");
        if (!layer) return;
        layer.innerHTML = "";
        const nextKeys = /* @__PURE__ */ new Set();
        iconNewFlags = [];
        for (const it of list) {
          const key = it.src + "@" + Math.round(it.rect.x) + "@" + Math.round(it.rect.y);
          nextKeys.add(key);
          const isNewIcon = !prevIconKeys.has(key);
          iconNewFlags.push(isNewIcon);
          const dx = isNewIcon ? offsetX : 0;
          const img = document.createElement("img");
          img.src = it.src;
          img.style.cssText = `position:fixed;left:${it.rect.x + dx}px;top:${it.rect.y}px;width:${it.rect.w}px;height:${it.rect.h}px;object-fit:contain;image-rendering:pixelated;pointer-events:none;`;
          layer.appendChild(img);
        }
        prevIconKeys = nextKeys;
      }
      function build(animate = false) {
        const isDlInstall = page === "download" && dlSection === "game" && dlPanel === "install";
        const showDlText = isDlInstall && dl.phase === "installing";
        const dPct = document.getElementById("dlPctDom");
        const dSpd = document.getElementById("dlSpeedDom");
        const dMsg = document.getElementById("dlMsgDom");
        if (dPct) dPct.style.display = showDlText ? "block" : "none";
        if (dSpd) dSpd.style.display = showDlText ? "block" : "none";
        if (dMsg) dMsg.style.display = showDlText ? "block" : "none";
        const __ni = document.getElementById("vsetNameInput");
        // 只要不是 设置面板的 setting 选项，直接隐藏
        if (__ni && !(versionSettingsOpen && versionSettingsTab === "setting" && page === "home")) {
          __ni.style.display = "none";
          __ni.style.opacity = "0";
        } else if (__ni && versionSettingsOpen && versionSettingsTab === "setting" && page === "home") {
          // 如果在正确的界面，让它在 buildVersionSettings 里自己控制显示
        }
        if (page !== "home" || !window.launching.on) {
          const p = document.getElementById("launchPctDom");
          const m = document.getElementById("launchMsgDom");
          const s = document.getElementById("launchRingSvg");
          if (p) p.style.display = "none";
          if (m) m.style.display = "none";
          if (s) s.style.display = "none";
        } else if (page === "home" && window.launching.on) {
          // 确保在主页且启动中时，DOM 是被正确设置为显示的
          // 具体显示逻辑在 buildHome 里处理，这里不用管
        }
        const prev = animate ? captureRects() : null;
        const prevAvatar = animate ? { left: parseFloat(avatarWrap.style.left) || 0, top: parseFloat(avatarWrap.style.top) || 0 } : null;
        pendingIcons.length = 0;
        const pageRes = page === "home" ? buildHome() : page === "online" ? buildOnline() : page === "about" ? buildAbout() : page === "skin" ? buildSkin() : buildDownload();
        const panelRes = page === "home" ? versionPanelOpen ? buildVersionPanel() : accountPanelOpen ? buildAccountPanel() : { els: [], inter: {} } : page === "download" ? dlPanel === "install" ? buildInstallPanel() : { els: [], inter: {} } : { els: [], inter: {} };
        const modalRes = modal ? buildModal() : { els: [], inter: {} };
        const { tabs, inter: tabInter } = buildTabs();
        if (!modal) {
          portInput.style.display = "none";
          codeInput.style.display = "none";
          offlineInput.style.display = "none";
        }
        avatarWrap.style.display = modal || page === "download" || page === "about" || page === "skin" ? "none" : "block";
        elements = [
          ...modal ? [] : pageRes.els,
          ...modal ? [] : panelRes.els,
          ...modalRes.els,
          ...tabs,
          ...buildTitlebar()
        ];
        pageEls = pageRes.els;
        syncAboutLayer();
        syncSkinLayer();
        syncTdInputs();
        panelEls = panelRes.els;
        modalEls = modalRes.els;
        interactions = {
          ...pageRes.inter,
          ...panelRes.inter,
          ...modalRes.inter,
          "tb-btn-minimize": { onTap: () => postStr("minimize") },
          "tb-btn-optimize_memory": { onTap: () => postStr("optimize_memory") },
          "tb-btn-close": { onTap: () => postStr("close") },
          ...tabInter
        };
        const SLIDE_DIST = PANEL_W + 90;
        const targets = /* @__PURE__ */ new Map();
        for (const el of elements) targets.set(el.id, { x: el.rect.x, y: el.rect.y, w: el.rect.w, h: el.rect.h });
        const iconTargets = pendingIcons.map((p) => ({ x: p.rect.x, y: p.rect.y }));
        const avatarTo = { left: parseFloat(avatarWrap.style.left) || 0, top: parseFloat(avatarWrap.style.top) || 0 };
        if (prev) {
          for (const el of elements) {
            const f = prev[el.id];
            if (f) {
              el.rect.x = f.x;
              el.rect.y = f.y;
              el.rect.w = f.w;
              el.rect.h = f.h;
            } else if (/^(ver-|acc-)/.test(el.id)) {
              el.rect.x = (targets.get(el.id)?.x ?? el.rect.x) + SLIDE_DIST;
            }
          }
          if (prevAvatar && avatarWrap.style.display !== "none") {
            avatarWrap.style.left = prevAvatar.left + "px";
            avatarWrap.style.top = prevAvatar.top + "px";
          }
        }
        placeIcons(pendingIcons, prev ? SLIDE_DIST : 0);
        if (window.__pendingDdEnter && window.__pendingDdEnter.length) {
          const dd = window.__pendingDdEnter;
          window.__pendingDdEnter = null;
          try { animateEnter(dd, 160, { translateFrom: 8 }); } catch (e) {}
        }
        try { renderVsetIcons(); } catch (e) {}
        syncExpandSvgPos();
        renderer.setElements(elements);
        window.__liquidElCount = elements.length;
        window.__lgRenderer = renderer;
        renderer.setContentHeight(H);
        const _sel = renderer.setTabSelected;
        if (typeof _sel === "function") _sel.call(renderer, TAB_GROUP, state.selectedTab2, TAB_COUNT);
        renderer.requestRender();
        if (prev) startTween(targets, iconTargets, avatarTo, prev, prevAvatar, SLIDE_DIST);
        if (listEnterPending) {
          listEnterPending = false;
          runListEnterAnimation();
        }
      }
      var tweenToken = 0;
      function runListEnterAnimation() {
        const listEls = elements.filter((e) => /^(ver-item-|dl-item-|dl-get-)/.test(e.id));
        if (!listEls.length) return;
        const base = listEls.slice().sort((a, b) => a.rect.y - b.rect.y);
        const token = ++tweenToken;
        const t0 = performance.now();
        const dur = 260;
        const stagger = 14;
        for (const el of base) {
          el.enterProgress = 0;
          el.enterSafeProgress = 0;
        }
        const step = () => {
          if (token !== tweenToken) return;
          const now = performance.now();
          let done = true;
          base.forEach((el, i) => {
            const p = Math.max(0, Math.min(1, (now - t0 - i * stagger) / dur));
            const k = 1 - Math.pow(1 - p, 3);
            el.enterProgress = k;
            el.enterSafeProgress = k;
            if (p < 1) done = false;
          });
          renderer.setElements(elements);
          renderer.requestRender();
          if (done) {
            for (const el of base) {
              el.enterProgress = null;
              el.enterSafeProgress = null;
            }
            pushElements();
          } else {
            requestAnimationFrame(step);
          }
        };
        requestAnimationFrame(step);
      }
      function captureRects() {
        const m = {};
        for (const el of elements) m[el.id] = { x: el.rect.x, y: el.rect.y, w: el.rect.w, h: el.rect.h };
        return m;
      }
      function startTween(targets, iconTargets, avatarTo, prev, prevAvatar, slideDist, dur = 460) {
        const token = ++tweenToken;
        const iconEls = Array.from(document.querySelectorAll("#iconLayer img"));
        const t0 = performance.now();
        const step = () => {
          if (token !== tweenToken) return;
          const p = Math.min(1, (performance.now() - t0) / dur);
          const k = 1 - Math.pow(1 - p, 5);
          for (const el of elements) {
            const t = targets.get(el.id);
            if (!t) continue;
            const f = prev[el.id];
            if (f) {
              el.rect.x = f.x + (t.x - f.x) * k;
              el.rect.y = f.y + (t.y - f.y) * k;
              el.rect.w = f.w + (t.w - f.w) * k;
              el.rect.h = f.h + (t.h - f.h) * k;
            } else if (/^(ver-|acc-)/.test(el.id)) {
              el.rect.x = t.x + (1 - k) * slideDist;
              el.rect.y = t.y;
              el.rect.w = t.w;
              el.rect.h = t.h;
            }
          }
          if (prevAvatar && avatarWrap.style.display !== "none") {
            avatarWrap.style.left = prevAvatar.left + (avatarTo.left - prevAvatar.left) * k + "px";
            avatarWrap.style.top = prevAvatar.top + (avatarTo.top - prevAvatar.top) * k + "px";
          }
          iconEls.forEach((img, idx) => {
            const t = iconTargets[idx];
            if (!t) return;
            const extra = iconNewFlags[idx] ? (1 - k) * slideDist : 0;
            img.style.left = t.x + extra + "px";
            img.style.top = t.y + "px";
          });
          syncExpandSvgPos();
          pushElements();
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
      function makeSpringEase(response, damping) {
        const w0 = 2 * Math.PI / response;
        if (damping >= 1) return (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
        const wd = w0 * Math.sqrt(1 - damping * damping);
        const A = damping * w0 / wd;
        return (t) => 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + A * Math.sin(wd * t));
      }
      var SPRING_GENTLE = makeSpringEase(0.55, 0.825);
      var SPRING_SNAPPY = makeSpringEase(0.3, 0.8);
      function animateEnter(els, dur = 380, opts = {}) {
        const list = els.filter((e) => e && !/^(tabs6-|tb-)/.test(e.id));
        if (!list.length) return;
        const token = ++tweenToken;
        const t0 = performance.now();
        const htmlEls = [];
        if (avatarWrap && avatarWrap.style.display !== "none") htmlEls.push(avatarWrap);
        document.querySelectorAll("#iconLayer img").forEach((n) => htmlEls.push(n));
        const svgLayerEl = document.getElementById("svgLayer");
        if (svgLayerEl) htmlEls.push(svgLayerEl);
        document.querySelectorAll(".glass-input").forEach((n) => {
          const hi = n;
          if (hi.style.display !== "none") htmlEls.push(hi);
        });
        for (const id of ["skin3d", "skinImgs", "aboutLayer", "waveLayer", "ab-ring-gl"]) {
          const node = document.getElementById(id);
          if (node && node.style.display !== "none") htmlEls.push(node);
        }
        const spring = opts.spring || SPRING_GENTLE;
        const scaleFrom = opts.scaleFrom;
        const HTML_DY = opts.translateFrom != null ? opts.translateFrom : 48;
        const applyHtml = (k) => {
          const dy = -HTML_DY * (1 - k);
          for (const h of htmlEls) {
            h.style.opacity = String(k);
            h.style.transform = `translateY(${dy.toFixed(1)}px)`;
          }
        };
        for (const el of list) {
          el.enterProgress = 0;
          el.enterSafeProgress = 0;
          if (opts.translateFrom != null) el.enterTranslateFrom = opts.translateFrom;
          if (scaleFrom != null) {
            el.elementScaleX = scaleFrom;
            el.elementScaleY = scaleFrom;
          }
        }
        applyHtml(0);
        const step = () => {
          if (token !== tweenToken) return;
          const elapsed = performance.now() - t0;
          const kv = spring(elapsed / 1e3);
          const k = Math.min(1, Math.max(0, kv));
          for (const el of list) {
            el.enterProgress = kv;
            el.enterSafeProgress = k;
            if (scaleFrom != null) {
              const s = scaleFrom + (1 - scaleFrom) * k;
              el.elementScaleX = s;
              el.elementScaleY = s;
            }
          }
          applyHtml(k);
          pushElements();
          if (elapsed < dur) {
            requestAnimationFrame(step);
          } else {
            for (const el of list) {
              el.enterProgress = null;
              el.enterSafeProgress = null;
              el.enterTranslateFrom = void 0;
              if (scaleFrom != null) {
                el.elementScaleX = null;
                el.elementScaleY = null;
              }
            }
            for (const h of htmlEls) {
              h.style.opacity = "";
              h.style.transform = "";
            }
            pushElements();
          }
        };
        requestAnimationFrame(step);
      }
      build();
      var gestures = /* @__PURE__ */ new Map();
      var findEl = (id) => id ? elements.find((e) => e.id === id) : void 0;
      var _toastTimer = 0;
      window.showToast = function(title, message, duration) {
        const el = document.getElementById("globalToast");
        if (!el) return;
        let text = title || "";
        if (message) text += " · " + message;
        el.textContent = text;
        el.style.display = "block";
        el.style.opacity = "0";
        el.style.transform = "translateX(-50%) scaleX(0.05)";
        void el.offsetWidth;
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "translateX(-50%) scaleX(1)";
        });
        if (_toastTimer) clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => {
          el.style.opacity = "0";
          el.style.transform = "translateX(-50%) scaleX(0.05)";
          setTimeout(() => { if (el.style.opacity === "0") el.style.display = "none"; }, 420);
        }, duration || 2200);
      };
      window.hideToast = function() {
        const el = document.getElementById("globalToast");
        if (el) { el.style.opacity = "0"; setTimeout(() => { el.style.display = "none"; }, 250); }
      };
      function showGlobalTip(text, cx, cy) {
        const tip = document.getElementById("aboutTip");
        if (!tip) return;
        if (!text) { tip.style.opacity = "0"; return; }
        if (tip.textContent !== text) tip.textContent = text;
        tip.style.opacity = "1";
        const w = tip.offsetWidth || 80;
        const h = tip.offsetHeight || 28;
        let left = cx - w / 2;
        let top = cy - h - 14;
        if (left < 8) left = 8;
        if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
        if (top < 8) top = cy + 20;
        tip.style.left = left + "px";
        tip.style.top = top + "px";
      }
      function hitTest(x, y, scrollY) {
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          if (el.clipRect) {
            const cr = el.clipRect;
            if (x < cr.x || x > cr.x + cr.w || y < cr.y || y > cr.y + cr.h) continue;
          }
          const hr = el.hitRect ?? el.rect;
          if (!hr) continue;
          const vy = el.scroll ? hr.y - scrollY : hr.y;
          if (x >= hr.x && x <= hr.x + hr.w && y >= vy && y <= vy + hr.h) {
            const has = !!interactions[el.id];
            if (!has && !el.isInteractive) continue;
            return el;
          }
        }
        return null;
      }
      function isButtonLike(el) {
        if (!el) return false;
        const it = interactions[el.id];
        if (!it) return false;
        const hasDrag = !!it.onDrag;
        if (el.kind === "button" || el.kind === "text") return el.isInteractive;
        if (el.kind === "glass-shape" && el.isInteractive && !hasDrag && !!it.onTap) return true;
        return false;
      }
      canvas.addEventListener("pointerdown", (e) => {
        const { x, y } = localPos(e, canvasRef);
        const scrollY = renderer.getScrollY();
        const hit = hitTest(x, y, scrollY);
        if (!hit && y < 56) {
          postStr("drag");
          return;
        }
        const hasDrag = !!(hit && interactions[hit.id]?.onDrag);
        gestures.set(e.pointerId, {
          pressedId: hit ? hit.id : null,
          startX: x,
          startY: y,
          startClientY: e.clientY,
          startScrollY: scrollY,
          dragStarted: false,
          mode: "pending",
          hasDrag,
          velocitySamples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
          x,
          y
        });
        if (hit && (hit.id === "ver-cats" || hit.id === "dl-cats")) startSegPress(hit.id);
        if (hit && isButtonLike(hit)) {
          renderer.setPressed(hit.id, true, { x, y });
          renderer.requestRender();
        }
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
        }
      });
      canvas.addEventListener("pointermove", (e) => {
        const gs = gestures.get(e.pointerId);
        if (!gs) return;
        const { x, y } = localPos(e, canvasRef);
        gs.x = x;
        gs.y = y;
        gs.velocitySamples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
        if (gs.velocitySamples.length > 20) gs.velocitySamples.shift();
        const dx = x - gs.startX, dy = y - gs.startY;
        const absDx = Math.abs(dx), absDy = Math.abs(dy);
        if (gs.mode === "pending") {
          if (gs.pressedId) {
            const el0 = findEl(gs.pressedId);
            if (el0?.kind === "button" && el0.isInteractive) renderer.setDragPosition(gs.pressedId, { x, y });
          }
          if (absDx < 4 && absDy < 4) return;
          const el = findEl(gs.pressedId);
          const hasDrag = !!(el && interactions[el.id]?.onDrag);
          const isBtn = el?.kind === "button" && el?.isInteractive;
          if (hasDrag) {
            gs.mode = "drag";
            gs.dragStarted = true;
            interactions[el.id]?.onDragStart?.({ x, y });
          } else if (isBtn) {
            if (gs.pressedId) renderer.setDragPosition(gs.pressedId, { x, y });
          } else if (absDy > absDx + 2 && absDy >= 14) {
            gs.mode = "scroll";
            renderer.setScrollY(gs.startScrollY - (e.clientY - gs.startClientY));
            return;
          }
        }
        if (gs.mode === "scroll") {
          renderer.setScrollY(gs.startScrollY - (e.clientY - gs.startClientY));
          return;
        }
        if (gs.mode === "drag") {
          const el = findEl(gs.pressedId);
          if (!el) return;
          if (el.kind === "button" && el.isInteractive) renderer.setDragPosition(el.id, { x, y });
          interactions[el.id]?.onDrag?.({ x, y }, { x: dx, y: dy });
        }
      });
      function endGesture(e) {
        const gs = gestures.get(e.pointerId);
        if (!gs) {
          try {
            canvas.releasePointerCapture(e.pointerId);
          } catch {
          }
          ;
          return;
        }
        const mode = gs.mode, id = gs.pressedId;
        if (id) stopSegPress(id);
        if (id && isButtonLike(findEl(id))) {
          renderer.setPressed(id, false);
          renderer.requestRender();
        }
        if (mode === "scroll") {
          const v = computeReleaseVelocity(gs.velocitySamples);
          if (Math.abs(v) > 50) renderer.setScrollVelocity(v);
        }
        if (id) {
          const { x, y } = localPos(e, canvasRef);
          if (gs.dragStarted) interactions[id]?.onDragEnd?.({ x, y }, { x: 0, y: 0 });
          else if (mode === "pending" || mode === "drag") interactions[id]?.onTap?.({ x, y });
        }
        gestures.delete(e.pointerId);
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
        }
      }
      canvas.addEventListener("pointerup", endGesture);
      canvas.addEventListener("pointerleave", endGesture);
      canvas.addEventListener("pointercancel", endGesture);
      canvas.addEventListener("mousemove", (e) => {
        if (gestures.size > 0) return;
        const { x, y } = localPos(e, canvasRef);
        const scrollY = renderer.getScrollY();
        const hit = hitTest(x, y, scrollY);
        let cur = "default";
        if (hit) {
          const it = interactions[hit.id];
          if (it?.onDrag) cur = "grab";
          else if (isButtonLike(hit) || it?.onTap) cur = "pointer";
        }
        if (!hit && y < 56) cur = "default";
        if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
        showGlobalTip(hit ? interactions[hit.id]?.tip : "", e.clientX, e.clientY);
      });
      canvas.addEventListener("wheel", (e) => {
        const { x, y } = localPos(e, canvasRef);
        if (page === "download" && dl.ddOpen && dl.ddMax > 0 && x >= dl.ddRect.x && x <= dl.ddRect.x + dl.ddRect.w && y >= dl.ddRect.y && y <= dl.ddRect.y + dl.ddRect.h) {
          e.preventDefault();
          dl.ddScroll = Math.max(0, Math.min(dl.ddMax, dl.ddScroll + e.deltaY));
          build();
          return;
        }
        if (page === "download" && dlMaxScroll > 0 && x >= dlListX && x <= dlListX + dlListW && y >= dlListTop - 6 && y <= dlListTop + dlListH + 6) {
          e.preventDefault();
          dlVel = Math.max(-26, Math.min(26, dlVel + e.deltaY * 0.08));
          if (!dlAnim) dlAnim = requestAnimationFrame(animateDlScroll);
          return;
        }
        if (page === "skin" && skMaxScroll > 0 && x >= skGridArea.x - 8 && x <= skGridArea.x + skGridArea.w + 8 && y >= skGridArea.y - 8 && y <= skGridArea.y + skGridArea.h + 8) {
          e.preventDefault();
          skScroll = Math.max(0, Math.min(skMaxScroll, skScroll + e.deltaY));
          build();
          return;
        }
        if (versionPanelOpen && versionSettingsOpen && vsetMaxScroll > 0) {
          const vpw = PANEL_W + 60;
          const vpx = W - vpw - 20;
          if (x < vpx || x > W - 20) return;
          if (y < vsetListTop - 6 || y > vsetListTop + vsetListH + 6) return;
          e.preventDefault();
          vsetTargetScroll = Math.max(0, Math.min(vsetMaxScroll, vsetTargetScroll + e.deltaY));
          if (!vsetAnim) vsetAnim = requestAnimationFrame(vsetAnimateScroll);
          return;
        }
        if (!versionPanelOpen || panelMaxScroll <= 0) return;
        if (x < W - PANEL_W - 20 || x > W - 20) return;
        if (y < panelListTop - 6 || y > panelListTop + panelListH + 6) return;
        e.preventDefault();
        targetScrollY = Math.max(0, Math.min(panelMaxScroll, targetScrollY + e.deltaY));
        if (!scrollAnim) scrollAnim = requestAnimationFrame(animateScroll);
      }, { passive: false });
      function renderVsetIcons() {
        const layer = document.getElementById("vsetIconLayer");
        if (!layer) return;
        if (!versionSettingsOpen || vsetLoading) { layer.innerHTML = ""; return; }
        const top = vsetListTop;
        const bottom = vsetListTop + vsetListH;
        const parts = [];
        for (const ic of vsetIconData) {
          const y = ic.baseY - vsetScrollY;
          if (y < top - 2 || y + ic.h > bottom + 2) continue;
          parts.push('<img src="' + ic.src + '" style="position:absolute;left:' + ic.x + 'px;top:' + y + 'px;width:' + ic.w + 'px;height:' + ic.h + 'px;object-fit:contain;image-rendering:pixelated;">');
        }
        layer.innerHTML = parts.join("");
      }
      function vsetUpdateIcons() {
        const layer = document.getElementById("vsetIconLayer");
        if (!layer) return;
        const kids = layer.children;
        if (kids.length !== vsetIconData.length) { renderVsetIcons(); return; }
        const top = vsetListTop;
        const bottom = vsetListTop + vsetListH;
        for (let i = 0; i < vsetIconData.length; i++) {
          const ic = vsetIconData[i];
          const img = kids[i];
          const y = ic.baseY - vsetScrollY;
          if (y + ic.h < top - 4 || y > bottom + 4) {
            if (img.style.display !== "none") img.style.display = "none";
            continue;
          }
          if (img.style.display === "none") img.style.display = "";
          img.style.top = y + "px";
        }
      }
      function vsetApplyScroll() {
        for (const it of vsetItems) {
          for (const item of it.els) item.el.rect.y = it.baseY - vsetScrollY + item.dy;
        }
        pushElements();
        vsetUpdateIcons();
      }
      function vsetAnimateScroll() {
        const diff = vsetTargetScroll - vsetScrollY;
        if (Math.abs(diff) < 0.4) {
          vsetScrollY = vsetTargetScroll;
          vsetApplyScroll();
          vsetAnim = 0;
          return;
        }
        vsetScrollY += diff * 0.18;
        vsetApplyScroll();
        vsetAnim = requestAnimationFrame(vsetAnimateScroll);
      }
      function applyScroll() {
        for (const it of listItems) {
          for (const item of it.els) item.el.rect.y = it.baseY - listScrollY + item.dy;
        }
        pushElements();
      }
      function animateScroll() {
        const diff = targetScrollY - listScrollY;
        if (Math.abs(diff) < 0.4) {
          listScrollY = targetScrollY;
          applyScroll();
          scrollAnim = 0;
          return;
        }
        listScrollY += diff * 0.12;
        applyScroll();
        scrollAnim = requestAnimationFrame(animateScroll);
      }
      (async () => {
        await renderer.loadWallpaper("bg.jpg").catch((e) => console.error(e));
        if (hasWebView()) {
          live.ready = true;
          build();
          renderer.requestRender();
          postStr("get_background");
          post({ action: "load_global_config" });
          postStr("scan_versions");
          post({ action: "get_version" });
          loadAccount();
          post({ action: "get_ms_accounts" });
          if (!live.avatarDataUri) avatarImg.src = "steve.png";
          console.log("[liquidui] webview mode, requesting data");
        } else {
          try {
            const head = await cropSkinHead("avatar-test.png");
            avatarImg.src = head;
          } catch (e) {
            console.error("[avatar] crop failed", e);
          }
          live.ready = true;
          build();
          renderer.requestRender();
          console.log("[liquidui] preview mode");
        }
      })();
      window.addEventListener("resize", () => {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        renderer.resize(W, H);
        build();
        renderer.requestRender();
      });
      window.__renderer = renderer;
      window.__elements = () => elements;
      window.__goto = (p) => {
        page = p;
        state.selectedTab2 = p === "online" ? 1 : p === "download" ? 2 : 0;
        build();
        renderer.setTabSelected(TAB_GROUP, state.selectedTab2, TAB_COUNT);
      };
      window.__openModal = (m) => {
        if (m) openModal(m);
      };
      var SK_TABS = [
        { key: "import", label: "\u5BFC\u5165" },
        { key: "skin", label: "\u76AE\u80A4" },
        { key: "cape", label: "\u62AB\u98CE" }
      ];
      var SK_USE_H = 34;
      var skTab = "skin";
      var skScroll = 0;
      var skMaxScroll = 0;
      var skGridArea = { x: 0, y: 0, w: 0, h: 0 };
      var skList = [];
      var skLoaded = false;
      var skListReq = false;
      var skSelId = "";
      var skPrevCount = 0;
      var skViewer = null;
      var skViewerSkin = "";
      var skErr = "";
      var skDiagLine = "";
      var skInitTries = 0;
      var skThumbs = {};
      var skThumbBusy = {};
      var capeList = [];
      var capeLoaded = false;
      var capeLoading = false;
      var capeErr = "";
      var capeSelId = "";
      var capePendingId = "";
      var capePendingPrev = null;
      var skViewerCape = "";
      var skConfirmId = "";
      var skConfirmKind = "";
      var skToast = "";
      var skToastTimer = null;
      var skModalEls = [];
      var skModalShown = false;
      var skGridEls = [];
      var skGridEnterPending = false;
      var skTileRects = [];
      function skLayout() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cardW = Math.min(860, Math.round(vw * 0.75));
        const cardH = Math.round(cardW / 2);
        const top = 48;
        const bottom = vh - 92;
        const cx = Math.round((vw - cardW) / 2);
        const cy = Math.round(top + (bottom - top - cardH) / 2);
        const PAD = 26;
        const segH = 40;
        const segW = 78 * SK_TABS.length;
        const btnD = 40;
        const leftW = Math.round(cardW * 0.3);
        const leftH = cardH - PAD * 2;
        const rightX = cx + PAD + leftW + 22;
        const rightW = cx + cardW - PAD - rightX;
        const segX = cx + cardW - PAD - btnD - 8 - segW;
        const gridY = cy + PAD + segH + 16;
        const gridH = cy + cardH - PAD - gridY;
        const useY = cy + PAD + leftH - 12 - SK_USE_H;
        const canvasTop = cy + PAD + SK_USE_H + 12;
        const viewH = leftH - (SK_USE_H + 12) * 2;
        const gap = 14;
        const cols = 4;
        const tileW = Math.floor((rightW - gap * (cols - 1)) / cols);
        const tileH = skTab === "cape" ? Math.round(tileW * 1.6) : tileW;
        return {
          cardW,
          cardH,
          cx,
          cy,
          PAD,
          segX,
          segW,
          segH,
          btnD,
          leftW,
          leftH,
          canvasTop,
          viewH,
          useY,
          rightX,
          rightW,
          gridY,
          gridH,
          gap,
          cols,
          tileW,
          tileH
        };
      }
      function skItems() {
        return skTab === "cape" ? capeList : skList;
      }
      function skSelKey() {
        return skTab === "cape" ? capeSelId : skSelId;
      }
      function skSetSelKey(id) {
        if (skTab === "cape") capeSelId = id;
        else skSelId = id;
      }
      function skSelectedItem() {
        const list = skItems();
        if (!list.length) return null;
        return list.find((x) => x.id === skSelKey()) || list[0];
      }
      function skAppliedId() {
        try {
          const map = JSON.parse(localStorage.getItem("appliedSkinByUser") || "{}");
          return map[live.playerName] || "";
        } catch (e) {
          return "";
        }
      }
      function skSetApplied(id) {
        try {
          const map = JSON.parse(localStorage.getItem("appliedSkinByUser") || "{}");
          map[live.playerName] = id;
          localStorage.setItem("appliedSkinByUser", JSON.stringify(map));
        } catch (e) {
        }
      }
      function skTexUri(it) {
        if (!it) return "";
        if (it.dataUri) return it.dataUri;
        if (it.thumb) return it.thumb;
        if (it.fileName) return "https://skins.local/" + it.fileName;
        if (it.id) return "https://skins.local/" + it.id + ".png";
        return "";
      }
      function skUpdateDiag() {
        const n = skList.length;
        let texN = 0;
        for (const x of skList) if (skTexUri(x)) texN++;
        const sv = !!window.skinview3d;
        const v = !!skViewer;
        const bad = n > 0 && (texN < n || !sv || !v || !!skErr);
        const line = bad ? "\u8BCA\u65AD n=" + n + " \u7EB9\u7406=" + texN + " sv=" + (sv ? 1 : 0) + " v=" + (v ? 1 : 0) + (skErr ? " " + skErr : "") : "";
        if (line !== skDiagLine) {
          skDiagLine = line;
          if (page === "skin") build();
        }
      }
      function buildSkin() {
        const L = skLayout();
        const els = [];
        const inter = {};
        placeExpandSvg(null, false);
        els.push(makeGlassShape("sk-card", { x: L.cx, y: L.cy, w: L.cardW, h: L.cardH }, {
          cornerRadius: 30,
          refractionHeight: 10,
          refractionAmount: -14,
          blurRadius: 6,
          saturation: 1.3,
          surfaceColor: [1, 1, 1, 0.07]
        }, false));
        els.push(makeGlassShape("sk-preview", { x: L.cx + L.PAD, y: L.cy + L.PAD, w: L.leftW, h: L.leftH }, {
          cornerRadius: 22,
          ...M_FROST,
          surfaceColor: [1, 1, 1, 0.1]
        }, false));
        const seg = buildTabCapsule({
          prefix: "sk-seg",
          x: L.segX,
          y: L.cy + L.PAD,
          w: L.segW,
          h: L.segH,
          items: SK_TABS.map((t) => ({ key: t.key, label: t.label })),
          activeKey: skTab,
          onSelect: (k, i) => {
            if (k === "import") {
              post({ action: "import_skin" });
              build();
              return;
            }
            skTab = k;
            skScroll = 0;
            skGridEnterPending = true;
            build();
            try {
              renderer.setTabSelected("sk-seg", i, SK_TABS.length);
            } catch (e) {
            }
          }
        });
        els.push(...seg.els);
        Object.assign(inter, seg.inter);
        const closeR = { x: L.cx + L.cardW - L.PAD - L.btnD, y: L.cy + L.PAD, w: L.btnD, h: L.btnD };
        els.push(makeButton("sk-close", closeR, {
          label: "",
          tintColor: [1, 1, 1, 0.12],
          surfaceColor: [1, 1, 1, 0.18],
          labelColor: [1, 1, 1, 1]
        }, false));
        const closeIco = makeText("sk-close-i", closeR, "", {
          icon: { path: ICON_CLOSE, size: 18, viewport: 24, color: [1, 1, 1, 0.92] },
          align: "center",
          paddingPx: 0
        }, false);
        closeIco.isInteractive = false;
        els.push(closeIco);
        const item = skSelectedItem();
        const isCapeTab = skTab === "cape";
        const capeActive = !!(item && String(item.state || "").toUpperCase() === "ACTIVE");
        const skinActive = !!(item && !isCapeTab && item.id === skAppliedId());
        const active = isCapeTab ? capeActive : skinActive;
        const canUse = !!item && !active;
        const useW = 132;
        const useR = { x: L.cx + L.PAD + Math.round((L.leftW - useW) / 2), y: L.useY, w: useW, h: SK_USE_H };
        els.push(makeButton("sk-use", useR, {
          label: isCapeTab ? capeActive ? "\u62AB\u98CE\u4F7F\u7528\u4E2D" : "\u4F7F\u7528\u6B64\u62AB\u98CE" : skinActive ? "\u76AE\u80A4\u4F7F\u7528\u4E2D" : "\u4F7F\u7528\u6B64\u76AE\u80A4",
          tintColor: canUse ? [0, 0.478, 1, 0.3] : [1, 1, 1, 0.1],
          surfaceColor: canUse ? [0, 0.478, 1, 0.9] : [1, 1, 1, 0.16],
          labelColor: [1, 1, 1, canUse ? 1 : 0.66],
          labelFontSizePx: FS.footnote
        }, false));
        if (canUse) {
          inter["sk-use"] = { onTap: () => skUseApply() };
        }
        skGridArea = { x: L.rightX, y: L.gridY, w: L.rightW, h: L.gridH };
        const items = skItems();
        if (!capeLoaded && !capeLoading) {
          capeLoading = true;
          post({ action: "get_capes", username: live.playerName });
        }
        const gridStart = els.length;
        const skHint = (t) => {
          els.push(makeText("sk-hint", { x: L.rightX, y: L.gridY + 6, w: L.rightW, h: 22 }, t, {
            color: [1, 1, 1, 0.55],
            fontSizePx: FS.callout,
            letterSpacingPx: trackFor(FS.callout),
            fontWeight: 500,
            align: "left",
            paddingPx: 0
          }, false));
          skGridEls = els.slice(gridStart);
          skMaxScroll = 0;
          return { els, inter };
        };
        if (isCapeTab) {
          if (capeErr) return skHint("\u62AB\u98CE\u8BFB\u53D6\u5931\u8D25\uFF1A" + capeErr);
          if (!capeLoaded) return skHint("\u6B63\u5728\u4ECE Mojang \u8BFB\u53D6\u62AB\u98CE\u2026");
          if (!items.length) return skHint("\u8FD9\u4E2A\u8D26\u53F7\u6CA1\u6709\u53EF\u7528\u62AB\u98CE");
        } else {
          if (!skLoaded) return skHint("\u6B63\u5728\u8BFB\u53D6\u76AE\u80A4\u5E93\u2026");
          if (!items.length) return skHint("\u8FD8\u6CA1\u6709\u76AE\u80A4\uFF0C\u70B9\u4E0A\u65B9\u300C\u5BFC\u5165\u300D\u6DFB\u52A0 PNG");
        }
        const rows = Math.ceil(items.length / L.cols);
        const contentH = rows * L.tileH + (rows - 1) * L.gap;
        skMaxScroll = Math.max(0, contentH - L.gridH);
        if (skScroll > skMaxScroll) skScroll = skMaxScroll;
        const selId = item && item.id || "";
        const clip = { x: L.rightX - 4, y: L.gridY - 4, w: L.rightW + 8, h: L.gridH + 8 };
        skTileRects.length = 0;
        for (let i = 0; i < items.length; i++) {
          const col = i % L.cols;
          const row = Math.floor(i / L.cols);
          const x = L.rightX + col * (L.tileW + L.gap);
          const y = L.gridY + row * (L.tileH + L.gap) - skScroll;
          if (y + L.tileH < L.gridY - L.gap || y > L.gridY + L.gridH + L.gap) continue;
          skTileRects.push({ id: items[i].id, x, y, w: L.tileW, h: L.tileH });
          const on = items[i].id === selId;
          const tile = makePlainRect(
            "sk-tile-" + i,
            { x, y, w: L.tileW, h: L.tileH },
            [1, 1, 1, on ? 0.26 : 0.1],
            0,
            false
          );
          tile.clipRect = { ...clip };
          els.push(tile);
          inter["sk-tile-" + i] = {
            onTap: () => {
              const it = items[i];
              if (!it) return;
              if (it.id === skSelKey()) return;
              skSetSelKey(it.id);
              build();
            }
          };
        }
        skGridEls = els.slice(gridStart);
        if (skConfirmKind) {
          const isUp = skConfirmKind === "upload";
          const W2 = window.innerWidth;
          const H2 = window.innerHeight;
          skModalEls = [];
          const scrim = makePlainRect("sk-scrim", { x: -140, y: -140, w: W2 + 280, h: H2 + 280 }, [0, 0, 0, 0.42], 0, false);
          els.push(scrim);
          skModalEls.push(scrim);
          inter["sk-scrim"] = { onTap: () => {
            skConfirmId = "";
            skConfirmKind = "";
            build();
          } };
          const pw = 344;
          const ph = 152;
          const px = Math.round((W2 - pw) / 2);
          const py = Math.round((H2 - ph) / 2);
          const panel = makeGlassShape("sk-confirm", { x: px, y: py, w: pw, h: ph }, {
            cornerRadius: 24,
            ...M_THICK,
            surfaceColor: [1, 1, 1, 0.34]
          }, false);
          els.push(panel);
          skModalEls.push(panel);
          const title = makeText(
            "sk-confirm-t",
            { x: px + 20, y: py + 24, w: pw - 40, h: 20 },
            isUp ? "\u540C\u65F6\u4E0A\u4F20\u5230\u6B63\u7248\u8D26\u53F7\uFF1F" : "\u5220\u9664\u8FD9\u4E2A\u76AE\u80A4\uFF1F",
            {
              color: [1, 1, 1, 1],
              fontSizePx: 15,
              letterSpacingPx: trackFor(15),
              fontWeight: 600,
              align: "center",
              paddingPx: 0
            },
            false
          );
          els.push(title);
          skModalEls.push(title);
          const sub = makeText(
            "sk-confirm-s",
            { x: px + 18, y: py + 50, w: pw - 36, h: 18 },
            isUp ? "\u6E38\u620F\u5185\u76AE\u80A4\u7531 Mojang \u4E0B\u53D1\uFF0C\u4E0A\u4F20\u540E\u624D\u751F\u6548" : "\u5220\u9664\u540E\u65E0\u6CD5\u6062\u590D",
            {
              color: [1, 1, 1, 0.62],
              fontSizePx: 12,
              letterSpacingPx: trackFor(12),
              fontWeight: 400,
              align: "center",
              paddingPx: 0
            },
            false
          );
          els.push(sub);
          skModalEls.push(sub);
          const bw = Math.round((pw - 56) / 2);
          const by = py + ph - 54;
          const noBtn = makeButton("sk-confirm-no", { x: px + 20, y: by, w: bw, h: 36 }, {
            label: "\u53D6\u6D88",
            surfaceColor: [1, 1, 1, 0.22],
            tintColor: [1, 1, 1, 0.16],
            labelColor: [1, 1, 1, 1],
            labelFontSizePx: 13
          }, false);
          els.push(noBtn);
          skModalEls.push(noBtn);
          const yesBtn = makeButton("sk-confirm-yes", { x: px + 36 + bw, y: by, w: bw, h: 36 }, {
            label: isUp ? "\u4E0A\u4F20" : "\u5220\u9664",
            surfaceColor: isUp ? [0, 0.478, 1, 0.92] : [1, 0.27, 0.23, 0.92],
            tintColor: isUp ? [0, 0.478, 1, 0.3] : [1, 0.27, 0.23, 0.3],
            labelColor: [1, 1, 1, 1],
            labelFontSizePx: 13
          }, false);
          els.push(yesBtn);
          skModalEls.push(yesBtn);
          inter["sk-confirm-no"] = { onTap: () => {
            skConfirmId = "";
            skConfirmKind = "";
            build();
          } };
          inter["sk-confirm-yes"] = {
            onTap: () => {
              const id = skConfirmId;
              const kind = skConfirmKind;
              skConfirmId = "";
              skConfirmKind = "";
              if (!id) return;
              if (kind === "upload") {
                skToastShow("\u6B63\u5728\u4E0A\u4F20\u5230 Mojang\u2026");
                post({ action: "upload_skin_to_mojang", username: live.playerName, skinId: id, variant: "classic" });
              } else {
                if (skAppliedId() === id) skSetApplied("");
                post({ action: "delete_skin", id });
                window.showToast("已删除该皮肤");
              }
              build();
            }
          };
        }
        if (skToast) {
          els.push(makeText("sk-toast", { x: L.rightX, y: L.gridY + L.gridH - 26, w: L.rightW, h: 20 }, skToast, {
            color: [1, 1, 1, 0.85],
            fontSizePx: FS.callout,
            letterSpacingPx: trackFor(FS.callout),
            fontWeight: 500,
            align: "left",
            paddingPx: 0
          }, false));
        }
        if (skDiagLine) {
          els.push(makeText("sk-diag", { x: L.cx + L.PAD, y: L.cy + L.cardH - L.PAD - 14, w: L.cardW - L.PAD * 2, h: 14 }, skDiagLine, {
            color: [1, 0.55, 0.55, 0.95],
            fontSizePx: 11,
            letterSpacingPx: 0,
            fontWeight: 600,
            align: "left",
            paddingPx: 0
          }, false));
        }
        return { els, inter };
      }
      function syncSkinImgs(L) {
        const box = document.getElementById("skinImgs");
        if (!box) return;
        const items = skItems();
        if (page !== "skin" || modal || skConfirmId || !items.length) {
          box.classList.remove("on");
          while (box.firstChild) box.removeChild(box.firstChild);
          return;
        }
        box.classList.add("on");
        box.style.left = L.rightX + "px";
        box.style.top = L.gridY + "px";
        box.style.width = L.rightW + "px";
        box.style.height = L.gridH + "px";
        const selId = (skSelectedItem() || {}).id || "";
        const keep = /* @__PURE__ */ new Set();
        for (let i = 0; i < items.length; i++) {
          const col = i % L.cols;
          const row = Math.floor(i / L.cols);
          const x = L.rightX + col * (L.tileW + L.gap) - L.rightX;
          const y = L.gridY + row * (L.tileH + L.gap) - skScroll - L.gridY;
          if (y + L.tileH < -L.gap || y > L.gridH + L.gap) continue;
          keep.add(i);
          let cell = box.querySelector('div[data-i="' + i + '"]');
          if (!cell) {
            cell = document.createElement("div");
            cell.className = "sk-cell";
            cell.dataset.i = String(i);
            box.appendChild(cell);
          }
          cell.style.left = x + "px";
          cell.style.top = y + "px";
          cell.style.width = L.tileW + "px";
          cell.style.height = L.tileH + "px";
          cell.classList.toggle("on", items[i].id === selId);
          if (skTab === "cape") {
            cell.classList.remove("head");
            cell.classList.add("cape");
            const ctex = items[i].thumb || items[i].dataUri || "";
            if (ctex && cell.dataset.tex !== ctex.slice(-64)) {
              cell.dataset.tex = ctex.slice(-64);
              cell.style.backgroundImage = 'url("' + ctex + '")';
            }
            continue;
          }
          const id = items[i].id;
          const tex = skTexUri(items[i]);
          const thumb = skThumbs[id];
          if (thumb) {
            cell.classList.add("head");
            if (cell.dataset.tex !== thumb) {
              cell.dataset.tex = thumb;
              cell.style.backgroundImage = 'url("' + thumb + '")';
            }
          } else {
            cell.classList.remove("head");
            if (tex && cell.dataset.tex !== tex.slice(-64)) {
              cell.dataset.tex = tex.slice(-64);
              cell.style.backgroundImage = 'url("' + tex + '")';
            }
            if (tex && !skThumbBusy[id]) {
              skThumbBusy[id] = true;
              cropSkinHead(tex).then((u) => {
                skThumbBusy[id] = false;
                if (!u) return;
                skThumbs[id] = u;
                if (page === "skin" && skTab === "skin") syncSkinImgs(skLayout());
              }).catch(() => {
                skThumbBusy[id] = false;
              });
            }
          }
        }
        for (const el of Array.from(box.children)) {
          const i = Number(el.dataset.i || -1);
          if (!keep.has(i)) el.remove();
        }
      }
      function skBodySkinUri() {
        if (skTab === "skin") {
          const u = skTexUri(skSelectedItem());
          if (u) return u;
        }
        const applied = skAppliedId();
        const hit = applied ? skList.find((x) => x.id === applied) : null;
        return skTexUri(hit || skList[0]);
      }
      function ensureSkViewer() {
        const cv = document.getElementById("skin3d");
        const SV = window.skinview3d;
        const retry = () => {
          if (skViewer || skInitTries >= 3) return;
          skInitTries++;
          setTimeout(() => {
            if (page === "skin" && !modal) ensureSkViewer();
          }, 150);
        };
        if (!cv) {
          skErr = "\u65E0canvas";
          skUpdateDiag();
          return;
        }
        if (!SV) {
          skErr = "\u65E0skinview3d";
          retry();
          skUpdateDiag();
          return;
        }
        const w = Math.max(1, Math.round(parseFloat(cv.style.width) || 240));
        const h = Math.max(1, Math.round(parseFloat(cv.style.height) || 280));
        if (!skViewer) {
          try {
            skViewer = new SV.SkinViewer({ canvas: cv, width: w, height: h });
            if (SV.IdleAnimation) skViewer.animation = new SV.IdleAnimation();
            else if (SV.WalkingAnimation) skViewer.animation = new SV.WalkingAnimation();
            const Lz = skLayout();
            const z = 0.82 * (Lz.leftH / Math.max(1, Lz.viewH));
            skViewer.zoom = Math.min(0.9, Math.max(0.62, z));
            if (skViewer.controls) {
              skViewer.controls.enableRotate = true;
              skViewer.controls.enableZoom = false;
              skViewer.controls.enablePan = false;
            }
            const rd = skViewer.renderer;
            if (rd && rd.setClearColor) rd.setClearColor(0, 0);
            try {
              skViewer.setSize(w, h);
            } catch (e) {
            }
          } catch (e) {
            skErr = "init:" + (e && e.message ? e.message : e);
            retry();
            skUpdateDiag();
            return;
          }
        } else if (skViewer.setSize) {
          try {
            skViewer.setSize(w, h);
          } catch (e) {
          }
        }
        const it = skSelectedItem();
        const uri = skBodySkinUri();
        if (uri && uri !== skViewerSkin) {
          skViewerSkin = uri;
          try {
            const p = skViewer.loadSkin(uri);
            if (p && p.catch) p.catch((e) => {
              skErr = "tex:" + (e && e.message ? e.message : e);
              skUpdateDiag();
            });
          } catch (e) {
            skErr = "tex:" + (e && e.message ? e.message : e);
          }
        }
        let capeUri = "";
        if (skTab === "cape") {
          capeUri = it && (it.dataUri || it.thumb) || "";
        } else {
          const act = capeList.find((c) => String(c.state || "").toUpperCase() === "ACTIVE");
          capeUri = act ? act.dataUri || act.thumb || "" : "";
        }
        if (capeUri !== skViewerCape) {
          skViewerCape = capeUri;
          try {
            const p = skViewer.loadCape(capeUri || null);
            if (p && p.catch) p.catch(() => {
            });
          } catch (e) {
          }
        }
        skUpdateDiag();
      }
      function skUseRefreshAvatar(tex) {
        if (!tex) return;
        cropSkinHead(tex).then((head) => {
          if (!head) return;
          live.avatarDataUri = head;
          const img = document.getElementById("avatarImg");
          if (img) img.src = head;
        }).catch(() => {
        });
      }
      function skUseApply() {
        const it = skSelectedItem();
        if (!it) return;
        if (skTab === "cape") {
          capeErr = "";
          const prev = capeList.map((c) => ({ id: c.id, state: c.state }));
          capeList = capeList.map((c) => ({ ...c, state: c.id === it.id ? "ACTIVE" : "INACTIVE" }));
          capePendingId = it.id;
          capePendingPrev = prev;
          build();
          renderer.requestRender();
          post({ action: "set_cape", username: live.playerName, capeId: it.id });
          window.showToast("已使用该披风");
          return;
        }
        skSetApplied(it.id);
        post({ action: "apply_skin", id: it.id, username: live.playerName });
        skUseRefreshAvatar(skTexUri(it));
        window.showToast("已使用该皮肤");
        if (live.premium) {
          skConfirmKind = "upload";
          skConfirmId = it.id;
        } else {
          skToastShow("\u5DF2\u5E94\u7528\uFF08\u79BB\u7EBF\u8D26\u53F7\u53EA\u80FD\u672C\u5730\u8BB0\u5F55\uFF09");
        }
        build();
      }
      function skToastShow(msg) {
        skToast = msg;
        if (skToastTimer) clearTimeout(skToastTimer);
        skToastTimer = setTimeout(() => {
          skToast = "";
          skToastTimer = null;
          if (page === "skin") build();
        }, 4e3);
        if (page === "skin") build();
      }
      function skTileAt(x, y) {
        for (const r of skTileRects) {
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
        }
        return null;
      }
      window.addEventListener("contextmenu", (e) => {
        if (page !== "skin" || modal) return;
        if (skConfirmId) {
          e.preventDefault();
          skConfirmId = "";
          skConfirmKind = "";
          build();
          return;
        }
        if (skTab !== "skin") return;
        const hit = skTileAt(e.clientX, e.clientY);
        if (!hit || !hit.id) return;
        e.preventDefault();
        skSelId = hit.id;
        skConfirmId = hit.id;
        skConfirmKind = "delete";
        build();
      });
      function syncSkinLayer() {
        if (skConfirmKind && skModalEls.length) {
          if (!skModalShown) {
            skModalShown = true;
            animateEnter(skModalEls, 260, { translateFrom: 6, scaleFrom: 0.9, spring: SPRING_SNAPPY });
          }
        } else if (!skConfirmKind) {
          skModalShown = false;
        }
        if (skGridEnterPending && page === "skin" && !skConfirmKind) {
          skGridEnterPending = false;
          const list = skGridEls.slice();
          const imgs = document.getElementById("skinImgs");
          const cv3 = document.getElementById("skin3d");
          if (imgs) list.push(imgs);
          if (cv3) list.push(cv3);
          if (list.length) animateEnter(list, 240, { translateFrom: 8, scaleFrom: 0.97, spring: SPRING_SNAPPY });
        }
        const layer = document.getElementById("skinLayer");
        const cv = document.getElementById("skin3d");
        const box = document.getElementById("skinImgs");
        if (!layer || !cv) return;
        if (page !== "skin" || modal || skConfirmId) {
          layer.classList.remove("on");
          if (box) box.classList.remove("on");
          return;
        }
        const L = skLayout();
        layer.classList.add("on");
        cv.style.left = L.cx + L.PAD + "px";
        cv.style.top = L.canvasTop + "px";
        cv.style.width = L.leftW + "px";
        cv.style.height = L.viewH + "px";
        requestAnimationFrame(ensureSkViewer);
        syncSkinImgs(L);
        if (!skLoaded && !skListReq) {
          skListReq = true;
          post({ action: "list_skins" });
        }
      }
      window.onUpdateInfo = (info) => {
        if (!info || !info.ok) {
          window.showToast("检查更新失败", info && info.error || "网络异常");
          return;
        }
        if (info.hasUpdate) {
          window.showToast("发现新版本", "当前 v" + info.current + " → v" + info.latest);
        } else {
          window.showToast("目前为最新版本", "当前 v" + (info.current || ""));
        }
      };
      window.onSkinLibrary = (d) => {
        const list = Array.isArray(d) ? d : d && (d.skins || d.items) || [];
        const grew = list.length > skPrevCount;
        if (grew) window.showToast("已导入该皮肤");
        skList = list;
        skPrevCount = list.length;
        skConfirmId = "";
        const cur = skAppliedId();
        if (cur && !skList.some((x) => x.id === cur)) skSetApplied("");
        skLoaded = true;
        skListReq = false;
        const applied = skAppliedId();
        if (grew && skList.length) {
          skSelId = skList[skList.length - 1].id;
        } else if (!skSelId || !skList.some((x) => x.id === skSelId)) {
          skSelId = applied && skList.some((x) => x.id === applied) ? applied : skList[0] ? skList[0].id : "";
        }
        if (page === "skin") {
          build();
          renderer.requestRender();
        }
      };
      window.onSkinApplied = (d) => {
        if (!d || !d.ok) return;
        const id = d.id || skSelId;
        if (id) skSetApplied(id);
        const it = skList.find((x) => x.id === id);
        const tex = skTexUri(it);
        if (tex) {
          cropSkinHead(tex).then((head) => {
            if (!head) return;
            live.avatarDataUri = head;
            const img = document.getElementById("avatarImg");
            if (img) img.src = head;
          }).catch(() => {
          });
        }
        if (page === "skin") {
          build();
          renderer.requestRender();
        }
      };
      window.onSkinUploadResult = (d) => {
        if (d && d.ok) skToastShow("\u5DF2\u4E0A\u4F20\u5230\u6B63\u7248\u8D26\u53F7\uFF0C\u8FDB\u6E38\u620F\u5C31\u80FD\u770B\u5230");
        else skToastShow("\u4E0A\u4F20\u5931\u8D25\uFF1A" + (d && d.error || "\u672A\u77E5\u9519\u8BEF"));
      };
      window.onCapesLoaded = (d) => {
        capeLoading = false;
        capeLoaded = true;
        if (!d || !d.ok) {
          capeErr = d && (d.error || d.message) || "\u8BFB\u53D6\u5931\u8D25";
        } else {
          capeErr = "";
          capeList = d.capes || [];
          const act = capeList.find((c) => String(c.state || "").toUpperCase() === "ACTIVE");
          if (!capeSelId || !capeList.some((c) => c.id === capeSelId)) {
            capeSelId = act ? act.id : capeList[0] ? capeList[0].id : "";
          }
        }
        if (page === "skin") {
          build();
          renderer.requestRender();
        }
      };
      window.onCapeSet = (d) => {
        if (!d || !d.ok) {
          if (capePendingPrev) {
            const prev = capePendingPrev;
            capeList = capeList.map((c) => {
              const p = prev.find((x) => x.id === c.id);
              return p ? { ...c, state: p.state } : c;
            });
          }
          capePendingPrev = null;
          capePendingId = "";
          capeErr = d && (d.error || d.message) || "\u5207\u6362\u62AB\u98CE\u5931\u8D25";
          if (page === "skin") build();
          return;
        }
        capePendingPrev = null;
        capePendingId = "";
        capeErr = "";
        if (page === "skin") {
          build();
          renderer.requestRender();
        }
      };
      function addSlider(opt) {
        return makeLiquidSlider(
          opt.id,
          opt.x,
          opt.y,
          opt.w,
          opt.id + "-group",
          opt.trackColor || [1, 1, 1, 0.18],
          opt.accentColor || [0.2, 0.52, 1],
          { current: renderer },
          (v) => {
            if (opt.onChange) opt.onChange(v);
          },
          opt.scroll !== false,
          true,
          opt.value == null ? 0.5 : opt.value,
          opt.snap,
          (v) => {
            if (opt.onLive) opt.onLive(v);
          }
        );
      }
      window.__makeLiquidSlider = makeLiquidSlider;
      window.__addSlider = addSlider;
    }
  });
  require_entry();
})();
