/**
 * Canvas 绘图基础设施
 * --------------------------------------------------------------------------
 * setupCanvas 统一处理高分屏（按 devicePixelRatio 放大再缩放上下文）。
 * 等距投影立体柱：px=(x-y)*cos30°, py=(x+y)*sin30°-z，加顶面侧面才立体。
 */

// ---------- canvas 绘图工具 ----------
function setupCanvas(cv, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(300, cv.parentElement.clientWidth - 4);
  cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr);
  cv.style.width = w + 'px'; cv.style.height = cssH + 'px';
  cv._w = w; cv._h = cssH;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: cssH };
}
function rr(ctx, x, y, w, h, r) { // 圆角矩形路径
  r = Math.max(0, Math.min(r, Math.abs(h) / 2, Math.abs(w) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
function animChart(cv, renderFn) {
  if (cv._anim) cancelAnimationFrame(cv._anim);
  const t0 = performance.now(), dur = 700;
  const { ctx, w, h } = setupCanvas(cv, cv._h || 260);
  (function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
    renderFn(ctx, w, h, e);
    if (t < 1) cv._anim = requestAnimationFrame(frame); else cv._anim = null;
  })(t0);
}
function fmtXAI(v) { return fcResult && fcResult.metric === 'qty' ? v.toFixed(0) : (v >= 10000 ? (v / 10000).toFixed(1) + '万' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(1)); }

// ---------- 配色 / 三维 / 热力图通用绘制 ----------
function hex2rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function rgbStr(r, g, b, a) { return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? 1 : a) + ')'; }
function mixHex(h1, h2, t) { const a = hex2rgb(h1), b = hex2rgb(h2); return rgbStr(Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)); }
/** 多色阶插值：stops = [[pos, '#hex'], ...] pos∈[0,1] */
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const p0 = stops[i - 1][0], p1 = stops[i][0];
      return mixHex(stops[i - 1][1], stops[i][1], (t - p0) / Math.max(p1 - p0, 1e-9));
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * 立体柱状图（等距投影）：正面渐变 + 顶面高光 + 右侧暗面 + 地面投影
 * cfg: { values, labels, sub, fmt, baseLine(是否画基线), unit, accent(i)->{c1,c2}, maxAbs }
 */
function draw3DBars(cv, cfg) {
  const t0 = performance.now(), dur = cfg.dur == null ? 680 : cfg.dur;
  if (cv._anim3d) cancelAnimationFrame(cv._anim3d);
  (function frame(now) {
    const tt = Math.min(1, (now - t0) / dur);
    render3DBars(cv, cfg, 1 - Math.pow(1 - tt, 3));
    if (tt < 1) cv._anim3d = requestAnimationFrame(frame); else cv._anim3d = null;
  })(t0);
}
function render3DBars(cv, cfg, e) {
  const raw = cfg.values, vals = raw.map(v => v * e), n = raw.length;
  const cssH = cfg.h || 300;
  const needW = Math.max(300, cv.parentElement.clientWidth - 4);
  let geo = cv._geo3d;
  if (!geo || geo.h !== cssH || geo.w !== needW) { geo = setupCanvas(cv, cssH); cv._geo3d = geo; }
  const { ctx, w, h } = geo;
  ctx.clearRect(0, 0, w, h);
  const padL = 46, padR = 22, padT = 34, padB = 52;
  const iw = w - padL - padR, ih = h - padT - padB;
  const vmax = Math.max(cfg.maxAbs || 0, ...raw.map(v => Math.abs(v)), 1e-9);
  const bw = Math.min(46, iw / n * 0.46);
  const dep = Math.max(7, bw * 0.34);          // 进深（等距）
  const ox = dep * 0.78, oy = dep * 0.5;       // 投影偏移
  const zero = cfg.neg ? padT + ih / 2 : padT + ih; // 正负图零线居中
  const span = cfg.neg ? ih / 2 : ih;
  const Y = v => zero - (v / vmax) * span;
  // 地面网格
  ctx.strokeStyle = '#eef2f6'; ctx.lineWidth = 1;
  const gl = cfg.neg ? 4 : 3;
  for (let g = 0; g <= gl; g++) {
    const y = zero - (g / gl) * span;
    if (y < padT - 2) continue;
    ctx.beginPath(); ctx.moveTo(padL - 6 - ox, y + oy * 0.6); ctx.lineTo(w - padR + ox, y + oy * 0.6); ctx.stroke();
    ctx.font = '9px sans-serif'; ctx.fillStyle = '#a8b3c2'; ctx.textAlign = 'right';
    const gv = (g / gl) * vmax;
    ctx.fillText(cfg.fmt ? cfg.fmt(gv) : gv.toFixed(1), padL - 10, y + 3);
    if (cfg.neg) {
      const y2 = zero + (g / gl) * span;
      if (y2 <= padT + ih + 2) {
        ctx.beginPath(); ctx.moveTo(padL - 6 - ox, y2 + oy * 0.6); ctx.lineTo(w - padR + ox, y2 + oy * 0.6); ctx.stroke();
        ctx.fillStyle = '#a8b3c2'; ctx.fillText(cfg.fmt ? cfg.fmt(-gv) : (-gv).toFixed(1), padL - 10, y2 + 3);
      }
    }
  }
  const slot = iw / n;
  vals.forEach((v, i) => {
    const cx = padL + slot * (i + 0.5);
    const x = cx - bw / 2;
    const accent = cfg.accent ? cfg.accent(i, v) : { c1: '#2dd4bf', c2: '#0d9488' };
    const yTop = Y(v), yBase = Y(0);
    const top = Math.min(yTop, yBase), bot = Math.max(yTop, yBase);
    const hh = Math.max(Math.abs(yTop - yBase), 0.6);
    // 地面投影
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx + ox * 0.55, yBase + oy * 0.5, bw * 0.62, dep * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,23,42,.07)'; ctx.fill();
    ctx.restore();
    // 右侧面
    ctx.beginPath();
    ctx.moveTo(x + bw, top); ctx.lineTo(x + bw + ox, top - oy);
    ctx.lineTo(x + bw + ox, bot - oy); ctx.lineTo(x + bw, bot);
    ctx.closePath();
    ctx.fillStyle = mixHex(accent.c2, '#0b1220', 0.28); ctx.fill();
    // 正面渐变
    const gd = ctx.createLinearGradient(x, top, x, bot);
    gd.addColorStop(0, mixHex(accent.c1, '#ffffff', 0.28));
    gd.addColorStop(0.55, accent.c1);
    gd.addColorStop(1, accent.c2);
    ctx.fillStyle = gd;
    rr(ctx, x, top, bw, hh, 3); ctx.fill();
    // 顶面
    ctx.beginPath();
    ctx.moveTo(x, top); ctx.lineTo(x + ox, top - oy);
    ctx.lineTo(x + bw + ox, top - oy); ctx.lineTo(x + bw, top);
    ctx.closePath();
    ctx.fillStyle = mixHex(accent.c1, '#ffffff', 0.55); ctx.fill();
    // 顶面高光线
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 1, top); ctx.lineTo(x + bw - 1, top); ctx.stroke();
    // 数值
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = v < 0 ? '#059669' : '#0f766e';
    const ly = v >= 0 ? top - oy - 7 : Math.min(bot + 13, h - 36);
    ctx.fillText((v > 0 && cfg.sign ? '+' : '') + (cfg.fmt ? cfg.fmt(v) : v.toFixed(1)), cx + ox * 0.6, ly);
    // 标签（柱位过窄时隔一个显示，避免重叠）
    const skip = n > 8 && slot < 30 && (i % 2 === 1);
    if (!skip) {
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#64748b';
      ctx.fillText(cfg.labels[i] || '', cx, h - 30);
      if (cfg.sub && cfg.sub[i]) { ctx.font = '9px sans-serif'; ctx.fillStyle = '#a0aec0'; ctx.fillText(cfg.sub[i], cx, h - 17); }
    }
  });
  if (cfg.neg) {
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(padL - ox, zero); ctx.lineTo(w - padR + ox, zero); ctx.stroke();
  }
}

/**
 * 热力图：单元格色阶 + 格内数值 + 悬浮提示
 * cfg: { rows[], cols[], mat[][], stops, fmt, title, tipUnit, zeroCentered }
 */
function drawHeatmap(cv, cfg) {
  const rows = cfg.rows, cols = cfg.cols, mat = cfg.mat;
  const nR = rows.length, nC = cols.length;
  const labelW = cfg.labelW || 62;
  const cellH = cfg.cellH || 30;
  const gap = 3;
  const cssH = nR * (cellH + gap) + 46;
  const geo = setupCanvas(cv, cssH);
  const { ctx, w, h } = geo;
  ctx.clearRect(0, 0, w, h);
  const gridW = w - labelW - 8;
  const cw = gridW / nC;
  const all = mat.flat().map(Math.abs);
  const mx = cfg.maxAbs || Math.max(...all, 1e-9);
  const stops = cfg.stops || [[0, '#dc2626'], [0.5, '#f8fafc'], [1, '#dc2626']];
  for (let r = 0; r < nR; r++) {
    const y = r * (cellH + gap) + 22;
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#64748b'; ctx.textAlign = 'right';
    ctx.fillText(rows[r], labelW - 8, y + cellH / 2 + 3);
    for (let c = 0; c < nC; c++) {
      const v = mat[r][c], x = labelW + c * cw;
      const tx = cfg.zeroCentered ? (v / mx + 1) / 2 : Math.abs(v) / mx;
      ctx.fillStyle = ramp(stops, tx);
      rr(ctx, x + 1, y, cw - 2, cellH, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1; ctx.stroke();
      if (cw > 34) {
        const dark = cfg.zeroCentered ? Math.abs(tx - 0.5) > 0.22 : tx > 0.62;
        ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = dark ? '#ffffff' : '#475569';
        ctx.fillText(cfg.fmt ? cfg.fmt(v) : v.toFixed(1), x + cw / 2, y + cellH / 2 + 3);
      }
    }
  }
  // 列标签
  ctx.font = '9px sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center';
  for (let c = 0; c < nC; c++) {
    if (nC > 12 && c % 2) continue;
    ctx.fillText(cols[c], labelW + c * cw + cw / 2, 12);
  }
  // 色条
  const barW = Math.min(150, w * 0.4), bx = w - barW - 4, by = h - 14;
  for (let k = 0; k <= 40; k++) {
    ctx.fillStyle = ramp(stops, k / 40);
    ctx.fillRect(bx + barW * k / 40, by, barW / 40 + 1, 7);
  }
  ctx.strokeStyle = '#e2e8f0'; ctx.strokeRect(bx, by, barW, 7);
  ctx.font = '9px sans-serif'; ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left'; ctx.fillText(cfg.legendLo || '低', bx, by - 3);
  ctx.textAlign = 'right'; ctx.fillText(cfg.legendHi || '高', bx + barW, by - 3);
}


// ---------- 模型效能图：WAPE 精度对比 + LSTM 训练收敛 ----------
function drawModelCharts() {
  if (!fcResult || !fcResult.xai || !fcResult.xai.lossHist) return;
  const models = fcResult.models, lossHist = fcResult.xai.lossHist;
  const H = models.length * 34 + 36;
  const cv1 = document.getElementById('mdl-mape');
  if (cv1) {
    cv1._h = H;
    animChart(cv1, (ctx, w, h, t) => {
      ctx.clearRect(0, 0, w, h);
      // 标签列宽按最长模型名自适应，避免长名称被画布左缘裁掉
      ctx.font = '10px sans-serif';
      const labelW = Math.min(w * 0.44, Math.max(...models.map(m => ctx.measureText(m.name).width)) + 16);
      const valW = 54;
      const maxM = Math.max(...models.map(m => m.wape), 1);
      models.forEach((m, i) => {
        const y = 6 + i * 34, bh = 20;
        ctx.fillStyle = '#475569'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(m.name, labelW - 6, y + bh / 2 + 3);
        const full = (w - labelW - valW) * Math.max(0.02, m.wape / maxM);
        const bw = full * t;
        const g = ctx.createLinearGradient(labelW, 0, labelW + Math.max(bw, 1), 0);
        if (m === fcResult.best) { g.addColorStop(0, '#0d9488'); g.addColorStop(1, '#38bdf8'); }
        else { g.addColorStop(0, '#cbd5e1'); g.addColorStop(1, '#e2e8f0'); }
        ctx.fillStyle = g; rr(ctx, labelW, y, Math.max(2, bw), bh, 5); ctx.fill();
        ctx.textAlign = 'left'; ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = m === fcResult.best ? '#0f766e' : '#64748b';
        ctx.fillText(m.wape.toFixed(1) + '%', labelW + Math.max(2, bw) + 6, y + bh / 2 + 3);
        if (m === fcResult.best) { ctx.font = '9px sans-serif'; ctx.fillStyle = '#f59e0b'; ctx.fillText('★', labelW + 2, y + bh / 2 + 3); }
      });
      ctx.font = '9px sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left';
      ctx.fillText('WAPE（加权绝对百分比误差，越低越好）', 2, h - 8);
    });
  }
  const cv2 = document.getElementById('mdl-loss');
  if (cv2) {
    cv2._h = H;
    animChart(cv2, (ctx, w, h, t) => {
      ctx.clearRect(0, 0, w, h);
      const padL = 44, padR = 14, padT = 14, padB = 28;
      const iw = w - padL - padR, ih = h - padT - padB;
      const n = lossHist.length;
      const maxL = Math.max(...lossHist), minL = Math.min(...lossHist);
      const yMin = Math.max(0, minL - (maxL - minL) * 0.1), yMax = maxL;
      const X = i => padL + (n > 1 ? i * iw / (n - 1) : 0);
      const Y = v => padT + ih * (1 - (v - yMin) / Math.max(yMax - yMin, 1e-9));
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      for (let g = 0; g <= 3; g++) { const y = padT + ih * g / 3; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); }
      const upto = Math.max(2, Math.round(n * t));
      ctx.beginPath(); ctx.moveTo(X(0), padT + ih);
      for (let i = 0; i < upto; i++) ctx.lineTo(X(i), Y(lossHist[i]));
      ctx.lineTo(X(upto - 1), padT + ih); ctx.closePath();
      const g2 = ctx.createLinearGradient(0, padT, 0, padT + ih);
      g2.addColorStop(0, 'rgba(45,212,191,.38)'); g2.addColorStop(1, 'rgba(45,212,191,.02)');
      ctx.fillStyle = g2; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < upto; i++) { const x = X(i), y = Y(lossHist[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.font = '9px sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'right';
      ctx.fillText(maxL.toFixed(3), padL - 4, padT + 4);
      ctx.fillText(minL.toFixed(3), padL - 4, padT + ih + 3);
      ctx.textAlign = 'left'; ctx.fillText('LOSS', 4, padT + 4);
      // 子网分界线
      const bounds = (fcResult.xai && fcResult.xai.ensBounds) || [];
      bounds.slice(0, -1).forEach(b => {
        const bx = X(b - 1);
        if (bx > padL && bx < w - padR) {
          ctx.save(); ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(bx, padT); ctx.lineTo(bx, padT + ih); ctx.stroke(); ctx.restore();
          ctx.fillStyle = '#64748b'; ctx.textAlign = 'center'; ctx.font = '8px sans-serif';
          ctx.fillText('子网' + (bounds.indexOf(b) + 1) + '→' + (bounds.indexOf(b) + 2), bx, padT + 10);
        }
      });
      ctx.textAlign = 'left'; ctx.fillStyle = '#94a3b8'; ctx.font = '9px sans-serif';
      ctx.fillText('epoch ' + n + ' · 最终 ' + lossHist[n - 1].toFixed(4), padL, h - 8);
      ctx.beginPath(); ctx.arc(X(n - 1), Y(lossHist[n - 1]), 3, 0, 7); ctx.fillStyle = '#0d9488'; ctx.fill();
    });
  }
}

let _xaiResizeT = null;
window.addEventListener('resize', function () {
  clearTimeout(_xaiResizeT);
  _xaiResizeT = setTimeout(function () {
    const vis = id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); };
    try { if (reportData && vis('page-report')) drawReportCharts(); } catch (e) {}
    if (!fcResult) return;
    try {
      drawFcChart();
      if (fcResult.xai && fcResult.xai.data && !document.getElementById('page-forecast').classList.contains('hidden')) {
        drawShapChart(); drawHeatChart(); drawEsen3D();
        drawSaliencyChart(); drawDowChart(); drawBacktestChart();
      }
      if (fcResult.xai && fcResult.xai.lossHist) drawModelCharts();
    } catch (e) {}
  }, 220);
});
