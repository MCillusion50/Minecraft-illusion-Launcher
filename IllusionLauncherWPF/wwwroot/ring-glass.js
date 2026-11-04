/* 自动生成：从老 UI index.html 抽取的液态玻璃 shader（含 u_isRing 环形支持）
 * 生成脚本：build/probe-webgl/build-ring.mjs
 * 用法：RingGlass.init(canvas) → setScreen(w,h) → setBackground(url) → draw(cx, cy, size, opts)
 * 注意：canvas 必须覆盖全屏（透明），shader 用屏幕归一化坐标，只绘制环所在的那块 quad。
 */
(function () {
  var VS = "\r\n\t\t\t\t\tprecision highp float;\r\n\t\t\t\t\tattribute vec2 a_position;\r\n\t\t\t\t\tuniform vec2 u_resolution;\r\n\t\t\t\t\tuniform vec2 u_mousePos;\r\n\t\t\t\t\tuniform vec2 u_glassSize;\r\n\t\t\t\t\tvarying vec2 v_screenTexCoord;\r\n\t\t\t\t\tvarying vec2 v_shapeCoord;\r\n\t\t\t\t\tvoid main() {\r\n\t\t\t\t\tvec2 screenPos = u_mousePos + a_position * u_glassSize;\r\n\t\t\t\t\tvec2 clip = (screenPos / u_resolution) * 2.0 - 1.0;\r\n\t\t\t\t\tgl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);\r\n\t\t\t\t\tv_screenTexCoord = screenPos / u_resolution;\r\n\t\t\t\t\tv_screenTexCoord.y = 1.0 - v_screenTexCoord.y;\r\n\t\t\t\t\tv_shapeCoord = a_position;\r\n\t\t\t\t\t}\r\n\t\t\t\t\t";
  var FS = "\r\n\t\t\t\t\tprecision highp float;\r\n\t\t\t\t\tuniform sampler2D u_backgroundTexture;\r\n\t\t\t\t\tuniform vec2 u_resolution;\r\n\t\t\t\t\tuniform vec2 u_glassSize;\r\n\t\t\t\t\tuniform float u_cornerRadius;\r\n\t\t\t\t\tuniform float u_ior;\r\n\t\t\t\t\tuniform float u_glassThickness;\r\n\t\t\t\t\tuniform float u_normalStrength;\r\n\t\t\t\t\tuniform float u_displacementScale;\r\n\r\n\t\t\t\t\tuniform float u_dispersion;\r\n\t\t\t\t\tuniform float u_heightTransitionWidth;\r\n\t\t\t\t\tuniform float u_sminSmoothing;\r\n\t\t\t\t\tuniform int u_showNormals;\r\n\t\t\t\t\tuniform float u_blurRadius;\r\n\t\t\t\t\tuniform vec4 u_overlayColor;\r\n\t\t\t\t\tuniform float u_highlightWidth;\r\n\t\t\t\t\tuniform int u_isRing;\r\n\t\t\t\t\tuniform vec2 u_rippleCenter;\r\n\t\t\t\t\tuniform float u_rippleProgress;\r\n\t\t\t\t\tuniform float u_rippleDir;\r\n\t\t\t\t\tuniform float u_bgReady; // ⭐ 新增：背景是否加载完毕\r\n\t\t\t\t\tuniform float u_rippleActive;\r\n\r\n\t\t\t\t\tvarying vec2 v_screenTexCoord;\r\n\t\t\t\t\tvarying vec2 v_shapeCoord;\r\n\r\n\t\t\t\t\tfloat smin_poly(float a, float b, float k) { if (k <= 0.0) return min(a, b); float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }\r\n\t\t\t\t\tfloat smax_poly(float a, float b, float k) { if (k <= 0.0) return max(a, b); float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }\r\n\r\n\t\t\t\t\tfloat sdRoundedBoxSmooth(vec2 p, vec2 b, float r, float k) {\r\n\t\t\t\t\tif (k <= 0.0) { vec2 q = abs(p) - b + r; return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r; }\r\n\t\t\t\t\t\tvec2 q = abs(p) - b + r;\r\n\t\t\t\t\t\tfloat tA = smax_poly(q.x, q.y, k);\r\n\t\t\t\t\t\tfloat tB = smin_poly(tA, 0.0, k * 0.5);\r\n\t\t\t\t\t\tvec2 ql = vec2(smax_poly(q.x, 0.0, k), smax_poly(q.y, 0.0, k));\r\n\t\t\t\t\t\treturn tB + length(ql) - r;\r\n\t\t\t\t\t\t}\r\n\r\n\t\t\t\t\t\tfloat sdRing(vec2 p, float outer, float inner, float k) {\r\n\t\t\t\t\t\tfloat d = length(p);\r\n\t\t\t\t\t\treturn max(d - outer, inner - d);\r\n\t\t\t\t\t\t}\r\n\r\n\t\t\t\t\t\tfloat hFromSDF(vec2 p, vec2 b, float r, float k, float w) {\r\n\t\t\t\t\t\tfloat d;\r\n\t\t\t\t\t\tif (u_isRing == 1) {\r\n\t\t\t\t\t\td = sdRing(p, u_glassSize.x * 0.45, u_glassSize.x * 0.3400, k);\r\n\t\t\t\t\t\t} else {\r\n\t\t\t\t\t\td = sdRoundedBoxSmooth(p, b, r, k);\r\n\t\t\t\t\t\t}\r\n\t\t\t\t\t\tfloat nd = d / w;\r\n\t\t\t\t\t\treturn clamp(1.0 - (1.0 / (1.0 + exp(-nd * 6.0))), 0.0, 1.0);\r\n\t\t\t\t\t\t}\r\n\r\n\t\t\t\t\t\tvec4 glassColor(vec2 sc, vec2 pc, out float sd) {\r\n\t\t\t\t\t\tvec2 hs = u_glassSize / 2.0;\r\n\t\t\t\t\t\tfloat r = min(u_cornerRadius, min(u_glassSize.x, u_glassSize.y) / 2.0);\r\n\r\n\t\t\t\t\t\tif (u_isRing == 1) {\r\n\t\t\t\t\t\tsd = sdRing(pc, u_glassSize.x * 0.45, u_glassSize.x * 0.3400, u_sminSmoothing);\r\n\t\t\t\t\t\t} else {\r\n\t\t\t\t\t\tsd = sdRoundedBoxSmooth(pc, hs, r, u_sminSmoothing);\r\n\t\t\t\t\t\t}\r\n\r\n\t\t\t\t\t\tvec2 ns = vec2(1.0 / u_glassSize.x, 1.0 / u_glassSize.y);\r\n\t\t\t\t\t\tfloat nx1 = ns.x * 0.75, ny1 = ns.y * 0.75;\r\n\t\t\t\t\t\tfloat nx2 = ns.x * 1.5, ny2 = ns.y * 1.5;\r\n\t\t\t\t\t\tfloat a1 = hFromSDF((sc + vec2(nx1, 0.0)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat a2 = hFromSDF((sc - vec2(nx1, 0.0)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat a3 = hFromSDF((sc + vec2(nx2, 0.0)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat a4 = hFromSDF((sc - vec2(nx2, 0.0)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat gx1 = (a1 - a2) / (2.0 * nx1 * u_glassSize.x);\r\n\t\t\t\t\t\tfloat gx2 = (a3 - a4) / (2.0 * nx2 * u_glassSize.x);\r\n\t\t\t\t\t\tfloat dx = mix(gx1, gx2, 0.5);\r\n\t\t\t\t\t\tfloat b1 = hFromSDF((sc + vec2(0.0, ny1)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat b2 = hFromSDF((sc - vec2(0.0, ny1)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat b3 = hFromSDF((sc + vec2(0.0, ny2)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat b4 = hFromSDF((sc - vec2(0.0, ny2)) * u_glassSize, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat gy1 = (b1 - b2) / (2.0 * ny1 * u_glassSize.y);\r\n\t\t\t\t\t\tfloat gy2 = (b3 - b4) / (2.0 * ny2 * u_glassSize.y);\r\n\t\t\t\t\t\tfloat dy = mix(gy1, gy2, 0.5);\r\n\r\n\t\t\t\t\t\tvec3 n = normalize(vec3(-dx * u_normalStrength, -dy * u_normalStrength, 1.0));\r\n\t\t\t\t\t\tif (u_showNormals == 1) return vec4(n * 0.5 + 0.5, 1.0);\r\n\t\t\t\t\t\tvec3 inc = normalize(vec3(0.0, 0.0, -1.0));\r\n\t\t\t\t\t\tvec3 inG = refract(inc, n, 1.0 / u_ior);\r\n\t\t\t\t\t\tvec3 outG = refract(inG, -n, u_ior);\r\n\r\n\t\t\t\t\t\tvec2 offPx = outG.xy * u_glassThickness;\r\n\t\t\t\t\t\tvec2 off = (offPx / u_resolution) * u_displacementScale;\r\n\r\n\t\t\t\t\t\tfloat disp = u_dispersion;\r\n\t\t\t\t\t\tvec2 tcR = clamp(v_screenTexCoord + off * (1.0 + disp), 0.001, 0.999);\r\n\t\t\t\t\t\tvec2 tcG = clamp(v_screenTexCoord + off, 0.001, 0.999);\r\n\t\t\t\t\t\tvec2 tcB = clamp(v_screenTexCoord + off * (1.0 - disp), 0.001, 0.999);\r\n\r\n\t\t\t\t\t\tvec4 cR = texture2D(u_backgroundTexture, tcR);\r\n\t\t\t\t\t\tvec4 cG = texture2D(u_backgroundTexture, tcG);\r\n\t\t\t\t\t\tvec4 cB = texture2D(u_backgroundTexture, tcB);\r\n\t\t\t\t\t\tvec4 c = vec4(cR.r, cG.g, cB.b, 1.0);\r\n\r\n\t\t\t\t\t\tfloat hv = hFromSDF(pc, hs, r, u_sminSmoothing, u_heightTransitionWidth);\r\n\t\t\t\t\t\tfloat hd = abs(sd);\r\n\r\n\r\n\t\t\t\t\t\tfloat ha = max(0.0, 1.0 - smoothstep(0.0, u_highlightWidth, hd));\r\n\t\t\t\t\t\tfloat df = (n.x * n.y + 1.0) * 0.5;\r\n\r\n\t\t\t\t\t\t// ⭐ 计算距离\r\n\t\t\t\t\t\tvec2 screenPos = gl_FragCoord.xy;\r\n\t\t\t\t\t\tvec2 clickPos = vec2(u_rippleCenter.x, u_resolution.y - u_rippleCenter.y);\r\n\t\t\t\t\t\tfloat dist = distance(screenPos, clickPos);\r\n\r\n\t\t\t\t\t\tfloat maxRadius = length(u_resolution);\r\n\t\t\t\t\t\tfloat currentRadius = u_rippleProgress * maxRadius;\r\n\r\n\t\t\t\t\t\t// ⭐ 空心环的参数\r\n\t\t\t\t\t\tfloat ringThickness = 5.0; // 光圈的粗细（像素）\r\n\t\t\t\t\t\tfloat glowWidth = 1.0;     // 光晕的范围\r\n\r\n\t\t\t\t\t\t// 计算距离当前光圈中心的差值\r\n\t\t\t\t\t\tfloat ringDist = dist - currentRadius;\r\n\r\n\t\t\t\t\t\t// 只有在 [ -ringThickness, glowWidth ] 之间才有发光\r\n\t\t\t\t\t\tfloat ringGlow = 0.0;\r\n\t\t\t\t\t\tif (ringDist > -ringThickness && ringDist < glowWidth) {\r\n\t\t\t\t\t\t\t// 用 smoothstep 画出中间亮、两边暗的发光带\r\n\t\t\t\t\t\t\tfloat intensity = smoothstep(-ringThickness, 0.0, ringDist) * smoothstep(glowWidth, 0.0, ringDist);\r\n\t\t\t\t\t\t\tringGlow = intensity * 1.5; // 1.5 是发光强度，可改\r\n\t\t\t\t\t\t}\r\n\r\n\t\t\t\t\t\t\t\t\t\t\t// ⭐ 判断底色是黑是白\r\n\t\t\t\t\t\tfloat mixFactor = 0.0; // 0 = 白色，1 = 黑色\r\n\r\n\t\t\t\t\t\tif (u_rippleActive < 0.5) {\r\n\t\t\t\t\t\t\tmixFactor = (u_rippleDir > 0.0) ? 1.0 : 0.0;\r\n\t\t\t\t\t\t} else {\r\n\t\t\t\t\t\t\tif (u_rippleDir > 0.0) {\r\n\t\t\t\t\t\t\t\t// 变黑：圈内变黑，圈外保持白\r\n\t\t\t\t\t\t\t\tmixFactor = smoothstep(currentRadius, currentRadius - 10.0, dist);\r\n\t\t\t\t\t\t\t} else {\r\n\t\t\t\t\t\t\t\t// 变白：圈内变白，圈外保持黑（光圈从外向内收缩，吃掉黑色）\r\n\t\t\t\t\t\t\t\tmixFactor = smoothstep(currentRadius - 10.0, currentRadius, dist);\r\n\t\t\t\t\t\t\t}\r\n\t\t\t\t\t\t}\r\n\r\n\t\t\t\t\t\tvec4 lightBase = mix(c, vec4(1.0), hv * 0.12);\r\n\t\t\t\t\t\tvec4 lightColor = mix(lightBase, vec4(1.0), ha * df);\r\n\r\n\t\t\t\t\t\tvec4 darkBase = mix(c, vec4(0.05, 0.05, 0.08, 1.0), hv * 0.65);\r\n\t\t\t\t\t\tvec4 darkColor = mix(darkBase, vec4(0.3, 0.3, 0.35, 1.0), ha * df);\r\n\r\n\t\t\t\t\t\t// 混合最终底色\r\n\t\t\t\t\t\tvec4 finalColor = mix(lightColor, darkColor, mixFactor);\r\n\r\n\t\t\t\t\t\t// ⭐ 叠加发光边缘\r\n\t\t\t\t\t\tvec4 glowColor = vec4(1.0, 1.0, 1.0, 1.0); // 默认白光\r\n\t\t\t\t\t\tif (u_rippleDir > 0.0) {\r\n\t\t\t\t\t\t\t// 变黑时，边缘是绿色光（或者你可以改成你喜欢的颜色）\r\n\t\t\t\t\t\t\tglowColor = vec4(0.5, 1.0, 0.6, 1.0); \r\n\t\t\t\t\t\t} else {\r\n\t\t\t\t\t\t\t// 变白时，边缘是冷白光\r\n\t\t\t\t\t\t\tglowColor = vec4(1.0, 1.0, 1.0, 1.0);\r\n\t\t\t\t\t\t}\r\n\t\t\t\t\t\t\r\n\t\t\t\t\t\t// 把发光叠加上去\r\n\t\t\t\t\t\tfinalColor.rgb += glowColor.rgb * ringGlow;\r\n\r\n\t\t\t\t\t\treturn finalColor;\r\n\t\t\t\t\t} // 👈 这个 } 是 glassColor 函数的结束，千万别删\r\n\t\t\t\t\t\t\r\n\r\n\t\t\t\t\t\tvoid main() {\r\n\r\n\t\t\t\t\t\tvec4 total = vec4(0.0);\r\n\t\t\t\t\t\tfloat totalA = 0.0;\r\n\t\t\t\t\t\tconst int S = 2;\r\n\t\t\t\t\t\tfloat sw = 1.0 / float(S * S);\r\n\t\t\t\t\t\tfor (int sy = 0; sy < S; sy++) {\r\n\t\t\t\t\t\t\tfor (int sx = 0; sx < S; sx++) {\r\n\t\t\t\t\t\t\t\tvec2 so = (vec2(float(sx), float(sy)) + 0.5) / float(S) - 0.5;\r\n\t\t\t\t\t\t\t\tvec2 sc = v_shapeCoord + so * vec2(1.0 / u_glassSize.x, 1.0 / u_glassSize.y) * 2.0;\r\n\t\t\t\t\t\t\t\tvec2 pc = sc * u_glassSize;\r\n\t\t\t\t\t\t\t\tfloat sd;\r\n\t\t\t\t\t\t\t\tvec4 c = glassColor(sc, pc, sd);\r\n\t\t\t\t\t\t\t\tfloat a = 1.0 - smoothstep(-1.0, 1.0, sd);\r\n\t\t\t\t\t\t\t\ttotal += c * a * sw;\r\n\t\t\t\t\t\t\t\ttotalA += a * sw;\r\n\t\t\t\t\t\t\t}\r\n\t\t\t\t\t\t}\r\n\t\t\t\t\t\tif (totalA < 0.001) discard;\r\n\t\t\t\t\t\tgl_FragColor = vec4(total.rgb / max(totalA, 0.001), totalA);\r\n\t\t\t\t\t}\r\n";

  var gl = null, prog = null, quadBuf = null, bgTex = null;
  var U = {};
  var scrW = 1080, scrH = 720;
  var hasBg = false;

  // ———— 可调参数（厚度 / 折射 / 模糊） ————
  var P = {
    ior: 2.5,                  // 老 UI isIndicator 分支的同款值
    glassThickness: 20,        // 像素级厚度
    normalStrength: 30,        // 法线强度（老 UI 就是 30）
    displacementScale: 15,     // 位移放大（老 UI 就是 15）
    dispersion: 0.05,          // 环的固定色散值
    heightTransitionWidth: 1.0,
    sminSmoothing: 20,
    blurRadius: 0,             // 无模糊
    highlightWidth: 1.5,
    overlay: [1, 1, 1, 1],     // 老 UI 环用 alpha=1
    ring: 1,
    showNormals: 0
  };

  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[ring] shader error:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  function init(canvas) {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) { console.error('[ring] no webgl'); return false; }
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[ring] link error:', gl.getProgramInfoLog(prog));
      return false;
    }
    gl.useProgram(prog);

    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var names = ["u_resolution","u_mousePos","u_glassSize","u_cornerRadius","u_ior","u_glassThickness","u_normalStrength","u_displacementScale","u_dispersion","u_heightTransitionWidth","u_sminSmoothing","u_showNormals","u_blurRadius","u_overlayColor","u_highlightWidth","u_isRing","u_rippleCenter","u_rippleProgress","u_rippleActive","u_rippleDir","u_bgReady","u_backgroundTexture"];
    for (var i = 0; i < names.length; i++) U[names[i]] = gl.getUniformLocation(prog, names[i]);

    bgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([130, 130, 140, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return true;
  }

  function setScreen(w, h) { scrW = w; scrH = h; }

  function setBackground(url, onReady) {
    if (!gl || !url) return;
    var img = new Image();
    img.onload = function () {
      try {
        gl.bindTexture(gl.TEXTURE_2D, bgTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        hasBg = true;
        if (onReady) onReady();
      } catch (err) {
        console.error('[ring] texImage2D 失败（跨域污染？）', err);
      }
    };
    img.onerror = function () { console.warn('[ring] bg load fail', url); };
    img.src = url;
  }

  function u1f(n, v) { if (U[n]) gl.uniform1f(U[n], v); }
  function u1i(n, v) { if (U[n]) gl.uniform1i(U[n], v); }
  function u2f(n, a, b) { if (U[n]) gl.uniform2f(U[n], a, b); }
  function u4f(n, a, b, c, d) { if (U[n]) gl.uniform4f(U[n], a, b, c, d); }

  // cx, cy = 环中心的屏幕坐标（CSS px）；size = 环外径（CSS px）
  function draw(cx, cy, size, opts) {
    if (!gl) return;
    var p = {};
    for (var k in P) p[k] = P[k];
    if (opts) for (var k2 in opts) p[k2] = opts[k2];

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);

    u2f('u_resolution', scrW, scrH);
    u2f('u_mousePos', cx, cy);
    u2f('u_glassSize', size, size);
    u1f('u_cornerRadius', (opts && opts.cornerRadius != null) ? opts.cornerRadius : size * 0.5);
    u1f('u_ior', p.ior);
    u1f('u_glassThickness', p.glassThickness);
    u1f('u_normalStrength', p.normalStrength);
    u1f('u_displacementScale', p.displacementScale);
    u1f('u_dispersion', p.dispersion);
    u1f('u_heightTransitionWidth', p.heightTransitionWidth);
    u1f('u_sminSmoothing', p.sminSmoothing);
    u1i('u_showNormals', p.showNormals ? 1 : 0);
    u1f('u_blurRadius', p.blurRadius);
    u4f('u_overlayColor', p.overlay[0], p.overlay[1], p.overlay[2], p.overlay[3]);
    u1f('u_highlightWidth', p.highlightWidth);
    u1i('u_isRing', p.ring ? 1 : 0);
    u2f('u_rippleCenter', 0, 0);
    u1f('u_rippleProgress', 0);
    u1i('u_rippleActive', 0);
    u2f('u_rippleDir', 0, 0);
    u1i('u_bgReady', hasBg ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    if (U['u_backgroundTexture']) gl.uniform1i(U['u_backgroundTexture'], 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function setParams(o) { for (var k in o) P[k] = o[k]; }
  function params() { var o = {}; for (var k in P) o[k] = P[k]; return o; }

  window.RingGlass = { init: init, setScreen: setScreen, setBackground: setBackground, draw: draw, setParams: setParams, params: params };
})();
