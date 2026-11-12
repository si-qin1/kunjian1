/**
 * 预测页图表：回测验证 / 未来走势 / 机制透视
 * --------------------------------------------------------------------------
 * 回测图沿用 SVG 而不是 Canvas：折线数量少、需要 hover 和点击图例隐藏，
 * SVG 的 DOM 事件处理起来更省事。
 *
 * 未来走势用了断轴：历史段和预测段比例不同，硬画在一起预测段会被压扁，
 * 所以中间留一条分隔线，右侧单独放大，并在预测段叠加置信带。
 *
 * 机制透视三张图（频带注意力轮 / 门控环 / 幅频对比）画的是模型真实
 * 前向传播的中间量，不是示意图——所以每次训练完都会重新取数。
 */

// ---------- SVG 折线图 ----------
const FC_COLORS = { 'PhaseFormer 相位频带注意力': '#0ea5e9', 'MixLinear 门控混合专家': '#f59e0b', '轻量 TCN': '#8b5cf6', 'LSTM 集成模型': '#0d9488', 'Transformer 编码器': '#ef4444', 'PatchTST': '#ec4899', 'FreqLite 频域滤波残差栈': '#6366f1' };
function drawFcChart() {
  const { models, best, series, horizon, metric } = fcResult;
  const n = series.length;
  const h = (fcResult.xai && fcResult.xai.data && fcResult.xai.data.h) ? fcResult.xai.data.h : Math.max(5, Math.round(n * 0.2));
  const isQty = metric === 'qty';
  const fc0 = document.getElementById('fc-chart');
  const CW = Math.max(980, fc0.clientWidth || 1150);
  const svgWrap = (W, H, inner) => '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="display:block;min-width:' + W + 'px">' + inner + '</svg>';

  // ================= ① 回测验证：真实销量 vs 各模型回测预测 =================
  const K = Math.min(n, Math.max(46, h + 16));
  const hist = series.slice(-K);
  const b0 = K - h;                       // 回测段起点
  const H1 = 300, pL = 58, pR = 18, pT = 30, pB = 36;
  const iw1 = CW - pL - pR, ih1 = H1 - pT - pB;
  const vals1 = hist.map(r => r.v);
  models.forEach(m => m.preds.forEach(v => vals1.push(Math.max(0, v))));
  const ymax1 = Math.max(...vals1) * 1.14 || 1;
  const x1 = i => pL + (K > 1 ? i * iw1 / (K - 1) : iw1 / 2);
  const y1 = v => pT + ih1 * (1 - v / ymax1);
  let s1 = '';
  s1 += '<rect x="' + x1(b0) + '" y="' + pT + '" width="' + Math.max(0, CW - pR - x1(b0)) + '" height="' + ih1 + '" fill="#f0fdfa"/>';
  for (let g = 0; g <= 4; g++) {
    const gv = ymax1 * g / 4, y = y1(gv);
    s1 += '<line x1="' + pL + '" y1="' + y + '" x2="' + (CW - pR) + '" y2="' + y + '" stroke="#eef2f7"/>' +
          '<text x="' + (pL - 8) + '" y="' + (y + 4) + '" font-size="11" fill="#94a3b8" text-anchor="end">' + fmtShort(gv) + '</text>';
  }
  const step1 = Math.ceil(K / 9);
  hist.forEach((r, i) => { if (i % step1 === 0 || i === K - 1) s1 += '<text x="' + x1(i) + '" y="' + (H1 - 12) + '" font-size="10" fill="#94a3b8" text-anchor="middle">' + r.date.slice(5) + '</text>'; });
  s1 += '<line x1="' + x1(b0) + '" y1="' + (pT - 6) + '" x2="' + x1(b0) + '" y2="' + (pT + ih1) + '" stroke="#14b8a6" stroke-dasharray="4,4"/>' +
        '<text x="' + (x1(b0) + 7) + '" y="' + (pT - 12) + '" font-size="10" fill="#0f766e" font-weight="bold">留出回测段（后 20%，' + h + ' 天）</text>';
  models.forEach(m => {
    const pts = m.preds.map((v, i) => x1(b0 + i) + ',' + y1(Math.max(0, v)));
    if (!pts.length) return;
    const isBest = (m === best);
    s1 += '<path class="fc-line" data-name="' + m.name + '" d="M' + pts.join(' L') + '" fill="none" stroke="' + (FC_COLORS[m.name] || '#333') + '" stroke-width="' + (isBest ? 2.8 : 1.5) + '"' + (isBest ? '' : ' stroke-dasharray="5,4" opacity="0.5"') + ' stroke-linejoin="round"/>';
  });
  s1 += '<path d="M' + hist.map((r, i) => x1(i) + ',' + y1(r.v)).join(' L') + '" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linejoin="round"/>';
  hist.forEach((r, i) => { if (i >= b0) s1 += '<circle cx="' + x1(i) + '" cy="' + y1(r.v) + '" r="2.2" fill="#0f172a"/>'; });
  s1 += '<text x="' + (CW - pR) + '" y="' + (pT - 12) + '" font-size="11" fill="#0f766e" text-anchor="end" font-weight="bold">' + best.name + ' · 回测 WAPE ' + best.wape.toFixed(1) + '%</text>';

  // ================= ② 完整预测走势：断轴放大未来段 =================
  const H2 = 330, qL = 58, qR = 18, qT = 34, qB = 40;
  const hist2 = series.slice(-Math.min(28, n));
  const futD = futureDates(series[n - 1].date, horizon);
  const gap = 34, innerW = CW - qL - qR;
  const wHist = (innerW - gap) * 0.56, wFut = (innerW - gap) * 0.44;
  const xh = i => qL + (hist2.length > 1 ? i * wHist / (hist2.length - 1) : wHist / 2);
  const xf = j => qL + wHist + gap + (horizon > 1 ? j * wFut / (horizon - 1) : wFut / 2);
  const vals2 = hist2.map(r => r.v);
  models.forEach(m => m.fut.forEach(v => vals2.push(Math.max(0, v))));
  const ymax2 = Math.max(...vals2) * 1.14 || 1;
  const ih2 = H2 - qT - qB, y2 = v => qT + ih2 * (1 - v / ymax2);
  let s2 = '';
  s2 += '<rect x="' + (xf(0) - 14) + '" y="' + (qT - 8) + '" width="' + Math.max(0, CW - qR - xf(0) + 14) + '" height="' + (ih2 + 8) + '" rx="8" fill="#f0fdfa"/>';
  for (let g = 0; g <= 4; g++) {
    const gv = ymax2 * g / 4, y = y2(gv);
    s2 += '<line x1="' + qL + '" y1="' + y + '" x2="' + (CW - qR) + '" y2="' + y + '" stroke="#eef2f7"/>' +
          '<text x="' + (qL - 8) + '" y="' + (y + 4) + '" font-size="11" fill="#94a3b8" text-anchor="end">' + fmtShort(gv) + '</text>';
  }
  const xToday = qL + wHist + gap / 2;
  s2 += '<line x1="' + xToday + '" y1="' + (qT - 4) + '" x2="' + xToday + '" y2="' + (qT + ih2) + '" stroke="#94a3b8" stroke-dasharray="3,3"/>' +
        '<text x="' + xToday + '" y="' + (qT - 14) + '" font-size="10" fill="#64748b" text-anchor="middle">今天</text>' +
        '<text x="' + (xf(0) + wFut / 2) + '" y="' + (qT - 14) + '" font-size="10" fill="#0f766e" text-anchor="middle" font-weight="bold">未来 ' + horizon + ' 天逐日预测</text>';
  const step2 = Math.ceil(hist2.length / 6);
  hist2.forEach((r, i) => { if (i % step2 === 0) s2 += '<text x="' + xh(i) + '" y="' + (H2 - 14) + '" font-size="10" fill="#94a3b8" text-anchor="middle">' + r.date.slice(5) + '</text>'; });
  const stepF = horizon <= 8 ? 1 : Math.ceil(horizon / 8);
  futD.forEach((d, j) => { if (j % stepF === 0 || j === horizon - 1) s2 += '<text x="' + xf(j) + '" y="' + (H2 - 14) + '" font-size="10" fill="#0f766e" text-anchor="middle">' + d.slice(5) + '</text>'; });
  const lastHistX = xh(hist2.length - 1), lastHistY = y2(hist2[hist2.length - 1].v);
  s2 += '<path d="M' + lastHistX + ',' + lastHistY + ' L' + best.fut.map((v, j) => xf(j) + ',' + y2(Math.max(0, v))).join(' L') + ' L' + xf(horizon - 1) + ',' + (qT + ih2) + ' L' + lastHistX + ',' + (qT + ih2) + ' Z" fill="rgba(13,148,136,0.08)"/>';
  models.forEach(m => {
    const pts = [lastHistX + ',' + lastHistY].concat(m.fut.map((v, j) => xf(j) + ',' + y2(Math.max(0, v))));
    const isBest = (m === best);
    s2 += '<path class="fc-line" data-name="' + m.name + '" d="M' + pts.join(' L') + '" fill="none" stroke="' + (FC_COLORS[m.name] || '#333') + '" stroke-width="' + (isBest ? 3 : 1.5) + '"' + (isBest ? '' : ' stroke-dasharray="5,4" opacity="0.48"') + ' stroke-linejoin="round"/>';
  });
  s2 += '<path d="M' + hist2.map((r, i) => xh(i) + ',' + y2(r.v)).join(' L') + '" fill="none" stroke="#0f172a" stroke-width="2.2"/>';
  best.fut.forEach((v, j) => {
    s2 += '<circle cx="' + xf(j) + '" cy="' + y2(Math.max(0, v)) + '" r="3" fill="#fff" stroke="#0d9488" stroke-width="2"/>';
    if (horizon <= 10 || j % stepF === 0) s2 += '<text x="' + xf(j) + '" y="' + (y2(Math.max(0, v)) - 9) + '" font-size="10" fill="#0f766e" text-anchor="middle" font-weight="bold">' + (isQty ? Math.round(v) : fmtShort(v)) + '</text>';
  });

  const legend = '<div class="flex flex-wrap gap-2 mt-1">' +
    '<span class="text-xs flex items-center gap-1"><span class="inline-block w-6 h-0.5 bg-slate-800"></span>历史真实</span>' +
    models.map(m => '<button onclick="toggleFcLine(this,\'' + m.name + '\')" class="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ' + (m === best ? 'border-teal-600 text-teal-700 font-bold' : 'border-slate-200 text-slate-500') + '"><span class="inline-block w-4 border-t-2 ' + (m === best ? '' : 'border-dashed') + '" style="border-color:' + (FC_COLORS[m.name] || '#333') + '"></span>' + m.name + '<span class="text-[10px] text-slate-400">' + m.wape.toFixed(1) + '%</span></button>').join('') + '</div>';

  fc0.innerHTML =
    '<div class="flex items-center gap-2 mb-1 mt-1"><span class="text-sm font-bold text-slate-700">① 回测验证</span><span class="text-[11px] text-slate-400">黑线为真实销量，越贴合的模型曲线越可靠</span></div>' +
    svgWrap(CW, H1, s1) +
    '<div class="flex items-center gap-2 mb-1 mt-5"><span class="text-sm font-bold text-slate-700">② 完整预测走势</span><span class="text-[11px] text-slate-400">未来 ' + horizon + ' 天逐日展开，粗实线为推荐模型</span></div>' +
    svgWrap(CW, H2, s2) + legend;
}
function toggleFcLine(btn, name) {
  const els = document.querySelectorAll('.fc-line[data-name="' + name + '"]');
  if (!els.length) return;
  const off = els[0].style.display === 'none';
  els.forEach(el => { el.style.display = off ? '' : 'none'; });
  btn.classList.toggle('opacity-40', !off);
}
function fmtShort(v) { return v >= 10000 ? (v / 10000).toFixed(1) + '万' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0); }
function futureDates(lastDate, n) {
  const out = [], d = new Date(lastDate);
  for (let i = 1; i <= n; i++) { d.setDate(d.getDate() + 1); out.push(d.toISOString().slice(0, 10)); }
  return out;
}

// ---------- 前沿模型机制透视（PhaseFormer 注意力轮 / MixLinear 门控 / FreqLite 频域滤波） ----------
function drawMechPanels() {
  if (!fcResult || !fcResult.models) return;
  const byKind = k => fcResult.models.find(m => m.inspect && m.name.indexOf(k) === 0);
  const pf = byKind('PhaseFormer'), ml = byKind('MixLinear'), fl = byKind('FreqLite');
  const win = fcResult.series.slice(-Math.max(14, 0)).map(r => r.v);
  const horizon = fcResult.horizon;
  if (pf) drawMechPf(document.getElementById('mech-pf'), pf.inspect(win.slice(-14)), horizon);
  if (ml) drawMechMl(document.getElementById('mech-ml'), ml.inspect(win.slice(-14)));
  if (fl) drawMechFl(document.getElementById('mech-fl'), fl.inspect(win.slice(-14)));
}
function drawMechPf(cv, diag, horizon) {
  if (!cv) return;
  const B = diag.A.length, dpr = window.devicePixelRatio || 1;
  const w = Math.max(300, cv.parentElement.clientWidth - 4), H = 344;
  cv.width = w * dpr; cv.height = H * dpr; cv.style.width = w + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  // —— 上半：频带注意力极坐标轮（半径=幅值，色相=相位） ——
  const cx = w / 2, cy = 88, R = 62;
  const maxAmp = Math.max(...diag.amp, 1e-9);
  const bands = ['DC/低频', '低频', '中低频', '中高频', '高频', '最高频'];
  ctx.strokeStyle = 'rgba(14,165,233,.25)'; ctx.setLineDash([3, 3]);
  for (const rr2 of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * rr2, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
  for (let b = 0; b < B; b++) {
    const ang = -Math.PI / 2 + b * 2 * Math.PI / B;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(ang), cy + R * Math.sin(ang));
    ctx.strokeStyle = 'rgba(148,163,184,.4)'; ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(bands[b] || ('带' + b), cx + (R + 16) * Math.cos(ang), cy + (R + 14) * Math.sin(ang) + 3);
  }
  ctx.beginPath();
  for (let b = 0; b <= B; b++) {
    const i = b % B, ang = -Math.PI / 2 + i * 2 * Math.PI / B, r = R * Math.max(0.08, diag.amp[i] / maxAmp);
    const px = cx + r * Math.cos(ang), py = cy + r * Math.sin(ang);
    if (b === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, R);
  grad.addColorStop(0, 'rgba(56,189,248,.05)'); grad.addColorStop(1, 'rgba(2,132,199,.35)');
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  for (let b = 0; b < B; b++) {
    const ang = -Math.PI / 2 + b * 2 * Math.PI / B, r = R * Math.max(0.08, diag.amp[b] / maxAmp);
    const hue = Math.round(((diag.phase[b] + Math.PI) / (2 * Math.PI)) * 340);
    ctx.beginPath(); ctx.arc(cx + r * Math.cos(ang), cy + r * Math.sin(ang), 5.5, 0, Math.PI * 2);
    ctx.fillStyle = 'hsl(' + hue + ',85%,52%)'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  ctx.fillStyle = '#334155'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('频带幅值（半径）· 相位（色相）', cx, H * 0.5 - 6);
  // —— 下半：频带间注意力热力 ——
  const gx = w / 2 - B * 11, gy = H * 0.5 + 14, cell = 22;
  ctx.font = '10px system-ui';
  for (let i = 0; i < B; i++) for (let j = 0; j < B; j++) {
    const t = Math.max(0, Math.min(1, diag.A[i][j] * B * 0.85));
    ctx.fillStyle = ramp([[0, '#f8fafc'], [0.5, '#7dd3fc'], [1, '#0369a1']], t);
    ctx.fillRect(gx + j * cell, gy + i * cell, cell - 2, cell - 2);
    if (diag.A[i][j] > 0.18) {
      ctx.fillStyle = t > 0.55 ? '#fff' : '#0c4a6e'; ctx.textAlign = 'center';
      ctx.fillText(diag.A[i][j].toFixed(2), gx + j * cell + (cell - 2) / 2, gy + i * cell + 14);
    }
  }
  ctx.fillStyle = '#64748b'; ctx.textAlign = 'left'; ctx.font = '10px system-ui';
  ctx.fillText('频带→频带 注意力权重（行=Query，列=Key）', gx, gy + B * cell + 16);
}
function drawMechMl(cv, diag) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(300, cv.parentElement.clientWidth - 4), H = 300;
  cv.width = w * dpr; cv.height = H * dpr; cv.style.width = w + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  const g = diag.gate, sum = g.reduce((a, b) => a + b, 0) || 1;
  const cols = ['#0ea5e9', '#f59e0b', '#8b5cf6'];
  const names = ['全窗口专家', '差分动态专家', '平滑趋势专家'];
  const cx = w / 2, cy = 110, R = 66, rIn = 40;
  let ang = -Math.PI / 2;
  g.forEach((v, i) => {
    const a2 = ang + v / sum * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, ang, a2); ctx.closePath();
    ctx.fillStyle = cols[i]; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    const mid = (ang + a2) / 2;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
    if (v / sum > 0.07) ctx.fillText((v / sum * 100).toFixed(0) + '%', cx + (rIn + R) / 2 * Math.cos(mid), cy + (rIn + R) / 2 * Math.sin(mid) + 4);
    ang = a2;
  });
  ctx.beginPath(); ctx.arc(cx, cy, rIn, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('门控', cx, cy - 4);
  ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui';
  ctx.fillText('softmax(Wg·窗口描述)', cx, cy + 12);
  names.forEach((nm, i) => {
    const y = H * 0.62 + i * 30;
    rr(ctx, 30, y, 10, 10, 3); ctx.fillStyle = cols[i]; ctx.fill();
    ctx.fillStyle = '#334155'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(nm, 48, y + 9);
    ctx.fillStyle = '#0ea5e9';
    ctx.fillText((g[i] / sum * 100).toFixed(1) + '%', w - 66, y + 9);
  });
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('输出 = Σ 门控权重 · 专家预测（端到端联合训练）', cx, H - 12);
}
function drawMechFl(cv, diag) {
  if (!cv) return;
  const K = diag.magsIn.length, dpr = window.devicePixelRatio || 1;
  const w = Math.max(300, cv.parentElement.clientWidth - 4), H = 300;
  cv.width = w * dpr; cv.height = H * dpr; cv.style.width = w + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  const L = 44, Rp = 16, T2 = 40, B2 = H - 46;
  const mIn = diag.magsIn.map(v => Math.log1p(v)), mOut = diag.magsOut.map(v => Math.log1p(v));
  const mx = Math.max(...mIn, ...mOut, 1e-9), mxR = Math.max(mx * 1.08, 1e-9);
  const xf = k => L + (w - L - Rp) * (K === 1 ? 0 : k / (K - 1));
  const yf = v => B2 - (B2 - T2) * (v / mxR);
  ctx.strokeStyle = 'rgba(148,163,184,.35)';
  for (let g2 = 0; g2 <= 3; g2++) { const gy = T2 + (B2 - T2) * g2 / 3;
    ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(w - Rp, gy); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
    ctx.fillText((mxR * (1 - g2 / 3)).toFixed(2), L - 5, gy + 3); }
  ctx.beginPath();
  mIn.forEach((v, k) => { const px = xf(k), py = yf(v); if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath();
  mOut.forEach((v, k) => { const px = xf(k), py = yf(v); if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  const lg = ctx.createLinearGradient(L, 0, w - Rp, 0);
  lg.addColorStop(0, '#6366f1'); lg.addColorStop(1, '#0ea5e9');
  ctx.strokeStyle = lg; ctx.lineWidth = 2.4; ctx.stroke(); ctx.lineWidth = 1;
  mOut.forEach((v, k) => { ctx.beginPath(); ctx.arc(xf(k), yf(v), 3, 0, Math.PI * 2); ctx.fillStyle = '#4f46e5'; ctx.fill(); });
  ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
  for (const k of [0, Math.floor((K - 1) / 2), K - 1]) ctx.fillText('k=' + k, xf(k), B2 + 14);
  ctx.save(); ctx.translate(14, (T2 + B2) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('log 幅值 |X(k)|', 0, 0); ctx.restore();
  ctx.textAlign = 'left';
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(L + 40, H - 20); ctx.lineTo(L + 60, H - 20); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#475569'; ctx.fillText('滤波前（原始频谱）', L + 66, H - 16);
  ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(w / 2 + 50, H - 20); ctx.lineTo(w / 2 + 70, H - 20); ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#4f46e5'; ctx.fillText('滤波后（Gk 加权）', w / 2 + 76, H - 16);
  ctx.fillStyle = '#334155'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('可学习复数增益 Gk：抑制噪声频带 · 保留季节频带', w / 2, H - 2);
}
function renderFcFuture() {
  const { models, best, horizon, metric } = fcResult;
  const dates = futureDates(fcResult.series[fcResult.series.length - 1].date, horizon);
  const unit = metric === 'qty' ? '数量' : '金额(元)';
  document.getElementById('fc-future-head').innerHTML = '<tr><th class="px-3 py-2 text-left">日期</th>' +
    models.map(m => '<th class="px-3 py-2 text-right">' + m.name + '</th>').join('') +
    '<th class="px-3 py-2 text-right bg-teal-50">推荐(' + best.name + ')</th></tr>';
  document.getElementById('fc-future-body').innerHTML = dates.map((d, i) =>
    '<tr class="border-t"><td class="px-3 py-1.5">' + d + '</td>' +
    models.map(m => '<td class="px-3 py-1.5 text-right text-slate-600">' + (metric === 'qty' ? m.fut[i].toFixed(0) : fmt(m.fut[i])) + '</td>').join('') +
    '<td class="px-3 py-1.5 text-right font-bold bg-teal-50">' + (metric === 'qty' ? best.fut[i].toFixed(0) : fmt(best.fut[i])) + (metric === 'qty' ? '' : ' 元') + '</td></tr>'
  ).join('') +
  '<tr class="border-t-2 bg-teal-50"><td class="px-3 py-2 font-bold">合计(' + unit + ')</td>' +
  models.map(m => '<td class="px-3 py-2 text-right font-medium">' + (metric === 'qty' ? m.fut.reduce((a, b) => a + b, 0).toFixed(0) : fmt(m.fut.reduce((a, b) => a + b, 0))) + '</td>').join('') +
  '<td class="px-3 py-2 text-right font-bold text-teal-700">' + (metric === 'qty' ? best.fut.reduce((a, b) => a + b, 0).toFixed(0) : fmt(best.fut.reduce((a, b) => a + b, 0))) + '</td></tr>';
}
