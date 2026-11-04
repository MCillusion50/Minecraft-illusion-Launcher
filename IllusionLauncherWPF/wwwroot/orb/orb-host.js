// Siri 玻璃球：封装 zq52xy/glass-voice-orb-study 的渲染管线
// 球 ⇄ 胶囊 形变靠 dialog 通道，文字用 DOM 叠在上面。
(function () {
  var cv = document.getElementById("siriOrb");
  var lb = document.getElementById("orbLabel");
  if (!cv) return;

  function lg(m) { try { localStorage.setItem("orb_err", String(m).slice(0, 400)); } catch (e) {} }

  var renderer = null;
  var state = null;
  var raf = 0;
  var running = false;
  var last = 0;
  var t0 = 0;
  var booting = false;
  var bgUrl = "";
  var bgImg = null;
  var bgSet = false;

  // 把壁纸按 CSS cover 的规则裁出“画布正下方那一块”，
  // 这样球里看到的就是周边真实画面，而不是缩小的整张图。
  function cropForOrb() {
    if (!bgImg || !renderer) return;
    try {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var outW = Math.round(CANVAS_W * dpr), outH = Math.round(CANVAS_H * dpr);
      var c = document.createElement("canvas");
      c.width = outW;
      c.height = outH;
      var g = c.getContext("2d");
      var winW = window.innerWidth, winH = window.innerHeight;
      var iw = bgImg.naturalWidth, ih = bgImg.naturalHeight;
      var s = Math.max(winW / iw, winH / ih);
      var ox = (winW - iw * s) / 2, oy = (winH - ih * s) / 2;
      var cvX = parseFloat(cv.style.left) || 0;
      var cvY = parseFloat(cv.style.top) || 0;
      var x0 = cvX - CANVAS_W / 2, y0 = cvY - CANVAS_H / 2;
      var sx = (x0 - ox) / s, sy = (y0 - oy) / s;
      var sw = CANVAS_W / s, sh = CANVAS_H / s;
      g.drawImage(bgImg, sx, sy, sw, sh, 0, 0, outW, outH);
      renderer.setBackground(c.toDataURL("image/jpeg", 0.92));
      bgSet = true;
    } catch (e) {
      lg("crop: " + (e && e.message));
    }
  }

  function loadBg(url) {
    if (!url) return;
    bgUrl = url;
    var im = new Image();
    im.onload = function () {
      bgImg = im;
      if (renderer) cropForOrb();
    };
    im.onerror = function () { lg("bgimg error"); };
    im.src = url;
  }

  // 几何（CSS px），必须和 renderer._layout() 的公式一致
  var BALL = 104;      // ballWidth
  var DIALOG_W = 264;  // dialogWidth（受 canvas 宽度限制：canvasW - 48）
  var DIALOG_H = 104;  // dialogHeight
  var CORNER_MAX = 52;  // = 胶囊高度的一半 → 真胶囊（半圆端）
  var CANVAS_W = 312;  // 必须 >= DIALOG_W + 48
  var CANVAS_H = 120;

  var dlg = 0;          // 当前 dialog 值（0=球, 1=胶囊）
  var dlgVel = 0;       // 弹簧速度
  var dlgTarget = 0;
  var amp = 0.45;       // 当前振幅
  var ampTarget = 0.45; // 目标振幅（由外部事件驱动）  // 弹簧参数：omega=sqrt(K)，zeta=C/(2*sqrt(K))
  // K=200 C=14 → zeta≈0.50，带明显回弹的果冻感
  var SPRING_K = 200;
  var SPRING_C = 14;

  function fakeAudio(t) {
    // 双层包络：慢心跳 + 快颤动，再乘当前振幅
    var beat = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2), 2.4);
    var flutter = 0.5 + 0.5 * Math.sin(t * 11.3);
    var a = amp * (0.5 + 0.5 * beat);
    return {
      low: a * (0.72 + 0.28 * beat),
      mid: a * (0.5 + 0.5 * flutter),
      high: a * (0.3 + 0.7 * Math.abs(Math.sin(t * 17.1)))
    };
  }

  function makeBackground() {
    var c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(128, 108, 10, 128, 128, 168);
    grad.addColorStop(0, "#3d4a6b");
    grad.addColorStop(0.45, "#1d2436");
    grad.addColorStop(1, "#05070c");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return c.toDataURL("image/png");
  }

  // 每帧按当前 dialog 值算出面板真实形状，用 clip-path 把黑底裁掉
  function syncClip(t) {
    var press = 0;
    if (renderer && renderer.channels) press = renderer.channels.press || 0;
    var open = Math.max(0, Math.min(1, dlg));
    var breathe = Math.sin(t * 1.65) * 0.028 * (1 - open);
    var a = 1 + press * 0.018 + breathe;
    var base = BALL * a;
    var innerW = base + (DIALOG_W - base) * dlg;
    var innerH = base + (DIALOG_H - base) * dlg;
    var half = Math.min(innerW, innerH) / 2;
    var corner = Math.min(half, half + (CORNER_MAX - half) * open);
    var left = (CANVAS_W - innerW) / 2;
    var top = (CANVAS_H - innerH) / 2;
    cv.style.clipPath =
      "inset(" + top.toFixed(2) + "px " + left.toFixed(2) + "px " +
      top.toFixed(2) + "px " + left.toFixed(2) + "px round " + corner.toFixed(2) + "px)";
  }

  function syncLabel() {
    if (!lb) return;
    lb.style.opacity = String(Math.max(0, Math.min(1, (dlg - 0.55) / 0.45)));
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var t = (now - t0) / 1000;

    // dialog 用弹簧动力学（带过冲 → 果冻感）
    var acc = (dlgTarget - dlg) * SPRING_K - dlgVel * SPRING_C;
    dlgVel += acc * dt;
    dlg += dlgVel * dt;

    // 振幅平滑跟随
    amp += (ampTarget - amp) * Math.min(1, dt * 5);

    try {
      var audio = fakeAudio(t);
      if (state && state.setPressed) state.setPressed(true);
      var ch = state ? state.step(dt, audio) : { audio: audio };
      ch.dialog = dlg;
      ch.audio = audio;
      renderer.setFrame(ch, t);
      renderer.render();
      syncClip(t);
      syncLabel();
    } catch (e) {
      lg("frame: " + (e && e.message));
    }
    raf = requestAnimationFrame(frame);
  }

  function boot() {
    if (booting) return;
    booting = true;
    try {
      renderer = new window.SiriRenderer(cv);
      state = window.SiriState ? new window.SiriState() : null;
      renderer.init().then(function () {
        if (bgImg) cropForOrb();
        if (bgUrl && !bgImg) loadBg(bgUrl);
        if (!bgSet) {
          try { renderer.setBackground(makeBackground()); } catch (e) { lg("bg2: " + (e && e.message)); }
        }
        if (state && state.select) state.select("listening");
        last = performance.now();
        t0 = last;
        running = true;
        if (!raf) raf = requestAnimationFrame(frame);
      }).catch(function (e) { lg("init: " + (e && e.message)); booting = false; });
    } catch (e) {
      lg("boot: " + (e && e.message));
      booting = false;
    }
  }

  window.__orb = {
    setBg: function (url) {
      if (!url) return;
      if (url === bgUrl && bgImg) { return; }
      loadBg(url);
    },
    setText: function (s) {
      if (lb) lb.textContent = s || "";
    },
    // 0 = 平静停泊，1 = 满负荷
    setLevel: function (v) {
      ampTarget = Math.max(0, Math.min(1, +v || 0));
    },
    expand: function (b) {
      dlgTarget = b ? 1 : 0;
    },
    place: function (x, y) {
      var l = Math.round(x) + "px", tp = Math.round(y) + "px";
      var hide = -Math.round(y + 80) + "px";
      cv.style.left = l; cv.style.top = tp;
      cv.style.setProperty("--orb-hide", hide);
      if (lb) {
        lb.style.left = l;
        lb.style.top = tp;
        lb.style.setProperty("--orb-hide", hide);
      }
    },
    show: function () {
      cv.classList.add("on");
      if (lb) { lb.classList.add("on"); lb.style.opacity = "0"; }
      if (!renderer) { boot(); return; }
      // 每次弹出都重新裁一次（窗口可能缩放、壁纸可能换）
      if (bgImg) cropForOrb();
      if (state && state.select) state.select("listening");
      if (state && state.setPressed) state.setPressed(true);
      last = performance.now();
      t0 = last;
      running = true;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    hide: function () {
      cv.classList.remove("on");
      if (lb) { lb.classList.remove("on"); lb.style.opacity = "0"; }
      dlg = 0;
      dlgVel = 0;
      dlgTarget = 0;
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
  };
})();
