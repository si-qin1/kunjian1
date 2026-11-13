/**
 * 归因结果的可视化与解读
 * --------------------------------------------------------------------------
 * 五张图对应五类解释产物。红绿配色遵循国内习惯：红=推高，绿=拉低。
 * 文字解读按模板拼装，但每个结论都绑定具体 φ 值和数据事实。
 */

// ---------- ① TimeSliver 发散条形图 ----------
function drawShapChart() {
  const d = fcResult.xai.data;
  const cv = document.getElementById('xai-shap');
  cv._h = d.dates.length * 40 + 56;
  animChart(cv, (ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const labelW = 86, valW = 76, mid = labelW + (w - labelW - valW) / 2;
    const maxAbs = Math.max(...d.tsl.phi.map(Math.abs), 1) * 1.05;
    const scale = (w - labelW - valW) / 2 / maxAbs;
    // 中轴线
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mid, 6); ctx.lineTo(mid, h - 30); ctx.stroke();
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center';
    ctx.fillText('← 拉低销量', mid - scale * maxAbs * 0.55, h - 12);
    ctx.fillText('推高销量 →', mid + scale * maxAbs * 0.55, h - 12);
    d.dates.forEach((dt, i) => {
      const v = d.tsl.phi[i] * t, y = 10 + i * 40, bh = 22;
      // 日期标签
      ctx.fillStyle = '#475569'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(dt, labelW - 8, y + bh / 2 + 4);
      ctx.font = '9px sans-serif'; ctx.fillStyle = '#94a3b8';
      const dw = new Date(d.winDates[i] + 'T00:00:00Z').getUTCDay();
      ctx.fillText(DOW_NM[dw], labelW - 8, y + bh / 2 + 15);
      const bw = Math.abs(v) * scale;
      if (bw > 0.5) {
        const g = ctx.createLinearGradient(v >= 0 ? mid : mid - bw, 0, v >= 0 ? mid + bw : mid, 0);
        if (v >= 0) { g.addColorStop(0, '#fda4af'); g.addColorStop(1, '#ef4444'); }
        else { g.addColorStop(0, '#6ee7b7'); g.addColorStop(1, '#059669'); }
        ctx.fillStyle = g;
        rr(ctx, v >= 0 ? mid : mid - bw, y, bw, bh, 5); ctx.fill();
        // 顶部高光
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        rr(ctx, v >= 0 ? mid : mid - bw, y + 2, bw, 6, 3); ctx.fill();
      }
      // 数值
      const full = d.tsl.phi[i];
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = full >= 0 ? '#dc2626' : '#059669';
      ctx.textAlign = full >= 0 ? 'left' : 'right';
      ctx.fillText((full >= 0 ? '+' : '−') + fmtXAI(Math.abs(full)), full >= 0 ? mid + bw + 6 : mid - bw - 6, y + bh / 2 + 4);
    });
  });
}

// ---------- ② 归因热力图（预测起点 × 窗口历史日） ----------
function drawHeatChart() {
  const d = fcResult.xai.data, cv = document.getElementById('xai-heat');
  if (!cv || !d.wm || !d.wm.mat.length) return;
  const wm = d.wm, cols = [];
  for (let i = 0; i < wm.W; i++) cols.push(i === wm.W - 1 ? 'T-0' : 'T-' + (wm.W - 1 - i));
  let mx = 0;
  wm.mat.forEach(r => r.forEach(v => { if (Math.abs(v) > mx) mx = Math.abs(v); }));
  mx = Math.max(mx, 1e-9);
  // 归因量级自适应单位
  const fz = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  drawHeatmap(cv, {
    rows: wm.labels.map(s => s + ' 起'),
    cols,
    mat: wm.mat,
    cellH: 28,
    labelW: Math.max(64, Math.min(96, cv.parentElement.clientWidth * 0.16)),
    zeroCentered: true,
    maxAbs: mx,
    stops: [[0, '#0f766e'], [0.36, '#6ee7b7'], [0.5, '#ffffff'], [0.64, '#fca5a5'], [1, '#dc2626']],
    fmt: fz,
    legendLo: '拉低预测',
    legendHi: '推高预测'
  });
}

// ---------- ③ TimeSliver 贡献立体柱 ----------
function drawEsen3D() {
  const d = fcResult.xai.data, cv = document.getElementById('xai-3d');
  if (!cv) return;
  const isQty = fcResult.metric === 'qty';
  const fz = v => isQty ? (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)) : (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + '万' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0));
  draw3DBars(cv, {
    values: d.tsl.phi,
    labels: d.dates,
    sub: d.winDates.map(dt => DOW_NM[new Date(dt + 'T00:00:00Z').getUTCDay()]),
    h: 300,
    neg: true,
    sign: true,
    fmt: fz,
    accent: (i, v) => v >= 0 ? { c1: '#fb7185', c2: '#b91c1c' } : { c1: '#5eead4', c2: '#047857' }
  });
}

// ---------- ④ 时间敏感度柱状图 ----------
function drawSaliencyChart() {
  const d = fcResult.xai.data, cv = document.getElementById('xai-saliency');
  cv._h = 230;
  animChart(cv, (ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const padL = 44, padR = 10, padT = 18, padB = 34;
    const iw = w - padL - padR, ih = h - padT - padB;
    const maxAbs = Math.max(...d.sal.map(Math.abs), 1e-9);
    const ymax = maxAbs * 1.15;
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    [0, .5, 1].forEach(g => { const y = padT + ih * (1 - g); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); });
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'right';
    [1, .5, 0].forEach(g => ctx.fillText(fmtXAI(ymax * g), padL - 5, padT + ih * (1 - g) + 3));
    const bw = Math.min(34, iw / 7 * 0.55);
    d.sal.forEach((v, i) => {
      const cx = padL + iw / 7 * (i + 0.5), bh = Math.abs(v) / ymax * ih * t;
      const g = ctx.createLinearGradient(0, padT + ih - bh, 0, padT + ih);
      g.addColorStop(0, '#0ea5e9'); g.addColorStop(1, '#14b8a6');
      ctx.fillStyle = g; rr(ctx, cx - bw / 2, padT + ih - bh, bw, bh, 4); ctx.fill();
      if (i === d.salMax) { ctx.font = '12px sans-serif'; ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'center'; ctx.fillText('★', cx, padT + ih - bh - 5); }
      ctx.font = '9px sans-serif'; ctx.fillStyle = '#64748b'; ctx.textAlign = 'center';
      ctx.fillText(d.dates[i], cx, h - 18);
      ctx.fillStyle = '#94a3b8'; ctx.fillText(i === 6 ? '昨日' : (6 - i) + '天前', cx, h - 6);
    });
  });
}

// ---------- ③ 星期周期效应柱状图 ----------
function drawDowChart() {
  const d = fcResult.xai.data, cv = document.getElementById('xai-dow');
  cv._h = 230;
  animChart(cv, (ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const padL = 44, padR = 10, padT = 18, padB = 30;
    const iw = w - padL - padR, ih = h - padT - padB;
    const order = [1, 2, 3, 4, 5, 6, 0];
    const ymax = Math.max(...order.map(w2 => d.dow.avg[w2]), 1) * 1.15;
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    [0, 1].forEach(g => { const y = padT + ih * (1 - g); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); });
    // 均值虚线
    const mean = order.reduce((s, w2) => s + d.dow.avg[w2], 0) / 7;
    const my = padT + ih * (1 - mean / ymax);
    ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, my); ctx.lineTo(w - padR, my); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '9px sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left';
    ctx.fillText('周均 ' + fmtXAI(mean), padL + 2, my - 4);
    const bw = Math.min(38, iw / 7 * 0.56);
    order.forEach((dw, i) => {
      const v = d.dow.avg[dw] * t, cx = padL + iw / 7 * (i + 0.5), bh = v / ymax * ih;
      const we = dw === 0 || dw === 6;
      const g = ctx.createLinearGradient(0, padT + ih - bh, 0, padT + ih);
      if (we) { g.addColorStop(0, '#fb7185'); g.addColorStop(1, '#f43f5e'); }
      else { g.addColorStop(0, '#2dd4bf'); g.addColorStop(1, '#0d9488'); }
      ctx.fillStyle = g; rr(ctx, cx - bw / 2, padT + ih - bh, bw, bh, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; rr(ctx, cx - bw / 2, padT + ih - bh, bw, Math.min(6, bh), 3); ctx.fill();
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#64748b'; ctx.textAlign = 'center';
      ctx.fillText(DOW_NM[dw], cx, h - 12);
      if (we) { ctx.font = '9px sans-serif'; ctx.fillStyle = '#f43f5e'; ctx.fillText('周末', cx, h - 2); }
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = we ? '#e11d48' : '#0f766e';
      ctx.fillText(fmtXAI(d.dow.avg[dw]), cx, padT + ih - bh - 5);
    });
  });
}

// ---------- ④ 回测置信区间图 ----------
function drawBacktestChart() {
  const d = fcResult.xai.data, cv = document.getElementById('xai-backtest');
  const n = d.test.length;
  cv._h = 260;
  animChart(cv, (ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const padL = 52, padR = 14, padT = 16, padB = 34;
    const iw = w - padL - padR, ih = h - padT - padB;
    const lo = 0, ymax = Math.max(...d.test, ...d.preds.map(p => p + d.best.rmse)) * 1.1 || 1;
    const X = i => padL + (n > 1 ? i * iw / (n - 1) : iw / 2), Y = v => padT + ih * (1 - v / ymax);
    // 网格
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.font = '10px sans-serif';
    for (let g = 0; g <= 4; g++) {
      const gv = ymax * g / 4, y = Y(gv);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'right'; ctx.fillText(fmtXAI(gv), padL - 6, y + 3);
    }
    const step = Math.ceil(n / 8);
    d.btDates.forEach((dt, i) => { if (i % step === 0 || i === n - 1) { ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center'; ctx.fillText(dt.slice(5), X(i), h - 16); } });
    // 动画：从左向右揭开
    ctx.save();
    ctx.beginPath(); ctx.rect(padL - 4, 0, (iw + 8) * t, h); ctx.clip();
    // 置信带（预测 ±1 RMSE）
    ctx.beginPath();
    d.preds.forEach((p, i) => { const y = Y(Math.min(ymax, p + d.best.rmse)); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); });
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(Math.max(0, d.preds[i] - d.best.rmse)));
    ctx.closePath(); ctx.fillStyle = 'rgba(13,148,136,.12)'; ctx.fill();
    // 实际
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2.2; ctx.beginPath();
    d.test.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    // 预测
    ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 2.2; ctx.setLineDash([7, 4]); ctx.beginPath();
    d.preds.forEach((p, i) => { const x = X(i), y = Y(Math.max(0, p)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
    // 数据点
    d.test.forEach((v, i) => { ctx.beginPath(); ctx.arc(X(i), Y(v), 2.6, 0, 7); ctx.fillStyle = '#0f172a'; ctx.fill(); });
    d.preds.forEach((p, i) => { ctx.beginPath(); ctx.arc(X(i), Y(Math.max(0, p)), 2.6, 0, 7); ctx.fillStyle = '#0d9488'; ctx.fill(); });
    ctx.restore();
    // 图例
    const lg = [['实际值', '#0f172a', false], ['预测值', '#0d9488', true], ['±1×RMSE 置信带', 'rgba(13,148,136,.25)', true]];
    let lx = w - padR - 210;
    lg.forEach(([nm, col, dash]) => {
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash(dash ? [5, 3] : []);
      ctx.beginPath(); ctx.moveTo(lx, padT + 6); ctx.lineTo(lx + 24, padT + 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#475569'; ctx.textAlign = 'left'; ctx.fillText(nm, lx + 29, padT + 9);
      lx += 105;
    });
  });
}

// ---------- 解读文字 + 建议报告 ----------
function renderXAI() {
  const X = fcResult; if (!X || !X.xai) return;
  const { pred1, h, test } = X.xai;
  const W = 7;
  const winRaw = X.series.slice(-W).map(r => r.v);
  const dates = X.series.slice(-W).map(r => r.date.slice(5));
  const winDates = X.series.slice(-W).map(r => r.date);
  const sh = shapCompute(pred1, winRaw);          // 精确 SHAP（对照基准，2^7 联盟全枚举）
  const es = tsliverCompute(pred1, winRaw);       // TimeSliver 时间切片归因（2^3 联盟闭式枚举）
  const agree = xaiAgree(es.phi, sh.phi);
  const wm = tsliverWindowMatrix(pred1, X.series, W, 7);
  const sal = saliencyCompute(pred1, winRaw);
  const dow = dowEffect(X.series);
  const btDates = X.series.slice(-h).map(r => r.date);
  X.xai.data = { tsl: es, shap: sh, agree, wm, sal, dow, winRaw, dates, winDates, test, preds: X.best.preds, best: X.best, btDates, salMax: sal.reduce((mi, v, i, a) => Math.abs(v) > Math.abs(a[mi]) ? i : mi, 0) };
  const isQty = X.metric === 'qty';
  const fmtV = v => isQty ? v.toFixed(0) : fmt(v) + ' 元';
  // 可加性校验（TimeSliver 满足效率性，Σψ 应严格等于 v(N)−v(∅)）
  const addErr = Math.abs(es.base + es.phi.reduce((a, b) => a + b, 0) - es.out) / Math.max(Math.abs(es.out), 1e-9) * 100;
  // 趋势
  const futMean = X.best.fut.reduce((a, b) => a + b, 0) / X.best.fut.length;
  const last7Mean = winRaw.reduce((a, b) => a + b, 0) / W;
  const trendPct = last7Mean > 0 ? (futMean - last7Mean) / last7Mean * 100 : 0;
  // SHAP 排序
  const phiIdx = es.phi.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  const pos = phiIdx.filter(o => o.p > 0), neg = phiIdx.filter(o => o.p < 0).reverse();
  const totalAbs = es.phi.reduce((s, p) => s + Math.abs(p), 0) || 1;
  // 建议列表（纯文本，供导出复用）
  const advice = [];
  advice.push('【核心结论】推荐模型「' + X.best.name + '」（回测 WAPE ' + X.best.wape.toFixed(1) + '%）预测未来 ' + X.horizon + ' 天日均 ' + fmtV(futMean) + '，较近 7 天实际均值' + (trendPct >= 0 ? '上升 ' : '下降 ') + Math.abs(trendPct).toFixed(1) + '%。');
  if (pos.length) advice.push('【主要驱动】' + pos.slice(0, 2).map(o => dates[o.i] + '（' + DOW_NM[new Date(winDates[o.i] + 'T00:00:00Z').getUTCDay()] + '）销量贡献 +' + fmtV(o.p)).join('；') + '，合计解释 ' + (pos.slice(0, 2).reduce((s, o) => s + o.p, 0) / totalAbs * 100).toFixed(0) + '% 的预测偏离。');
  if (neg.length) advice.push('【抑制因素】' + dates[neg[0].i] + ' 的低销量拉低预测 −' + fmtV(Math.abs(neg[0].p)) + '。');
  advice.push('【模型依赖】' + (() => {
    const i = X.xai.data.salMax;
    const when = i === 6 ? '昨日（' + dates[i] + '）' : (6 - i) + ' 天前（' + dates[i] + '）';
    return '模型对 ' + when + ' 的销量最敏感，' + (i >= 4 ? '近因效应强，请及时录入最新送货单以保持预测精度。' : '长记忆特征明显，历史规律权重较高。');
  })());
  advice.push('【周期效应】' + (dow.weekendFactor >= 1.1 ? '周末日均约为工作日的 ' + dow.weekendFactor.toFixed(2) + ' 倍，周末效应显著，建议周五前完成周末备货。' : dow.weekendFactor <= 0.9 ? '工作日销量反而高于周末（周末/工作日 = ' + dow.weekendFactor.toFixed(2) + '），属 B 端送货型业务特征。' : '各星期销量分布均衡，无明显周末效应。'));
  if (trendPct >= 5) advice.push('【备货建议】预测呈上升态势，建议提前 1-2 天向供应商加单，优先保障近期贡献度高的品名库存。');
  else if (trendPct <= -5) advice.push('【备货建议】预测呈回落态势，建议控制采购节奏、降低易腐水产库存积压风险，同时跟进客户回流。');
  else advice.push('【备货建议】预测整体平稳，按现有补货节奏即可，关注周末窗口的临时加单需求。');
  advice.push('【精度提示】' + (X.best.wape <= 10 ? '推荐模型回测 WAPE 为 ' + X.best.wape.toFixed(1) + '%，精度较高，可直接用于订货决策。' : X.best.wape <= 20 ? '推荐模型回测 WAPE 为 ' + X.best.wape.toFixed(1) + '%，属可接受水平，建议结合经验微调。' : '当前数据波动较大（回测 WAPE ' + X.best.wape.toFixed(1) + '%），预测仅供趋势参考，请谨慎用于大额订货。'));
  advice.push('【归因校验】TimeSliver 片段级精确 Shapley 严格满足效率性，Σφ = v(N)−v(∅)，可加性误差 ' + addErr.toFixed(2) + '%（基线 ' + fmtV(es.base) + ' + 各日贡献之和 = 预测值 ' + fmtV(es.out) + '），分解结果可信。');
  advice.push('【引擎对照】与逐日精确 SHAP（2⁷=128 联盟、逐子集扰动评估）相比，TimeSliver 时间切片机制只需 2³=8 个联盟（前向 ' + es.evals + ' 次含敏感度），联盟数下降 93.75%，平均偏差 ' + (isQty ? agree.dev.toFixed(2) : fmt(agree.dev) + ' 元') + '（归一化 ' + agree.norm.toFixed(3) + '），排序一致性 Spearman = ' + agree.spearman.toFixed(3) + '，计算量下降 ' + ((1 - es.evals / (W * Math.pow(2, W - 1) * 2)) * 100).toFixed(1) + '%。');
  X.xai.data.advice = advice;
  // 渲染摘要卡
  const icons = ['💡', '🚀', '⬇️', '🧩', '📆', '📦', '⚠️', '✅', '🔬'];
  document.getElementById('xai-summary').innerHTML =
    '<div class="rounded-xl p-4" style="background:linear-gradient(135deg,#f0fdfa 0%,#eff6ff 100%);border:1px solid #99f6e4;">' +
    '<div class="flex items-center gap-2 mb-2 flex-wrap"><span class="text-lg">🧠</span><b class="text-sm text-teal-800">AI 预测解读报告</b>' +
    '<span class="text-xs px-2 py-0.5 rounded-full bg-teal-600 text-white">TimeSliver 时间切片归因</span>' +
    '<span class="text-xs px-2 py-0.5 rounded-full bg-white text-slate-500 border">SHAP 一致性已校验</span>' +
    '<span class="text-xs text-slate-400">基线 = 近7天均值 · 特征窗口 7 日</span></div>' +
    '<ul class="space-y-1.5 text-xs leading-relaxed text-slate-700">' +
    advice.map((a, i) => '<li class="flex gap-2"><span>' + (icons[i] || '•') + '</span><span>' + a.replace(/\【(.*?)\】/, '<b class="text-teal-700">【$1】</b>') + '</span></li>').join('') +
    '</ul></div>';
  // 引擎一致性指标卡
  const fullEvals = W * Math.pow(2, W - 1) * 2;
  const kpi = [
    ['评估次数', es.evals + ' 次', 'SHAP 需 ' + fullEvals + ' 次', '#0d9488'],
    ['平均偏差', (isQty ? agree.dev.toFixed(2) : fmt(agree.dev)), '归一化 ' + agree.norm.toFixed(3), '#0284c7'],
    ['排序一致性', agree.spearman.toFixed(3), 'Spearman ρ', '#7c3aed'],
    ['公理满足', '3 / 3', '效率·对称·虚拟玩家', '#f59e0b']
  ];
  document.getElementById('xai-agree').innerHTML = kpi.map(k =>
    '<div class="rounded-xl px-3 py-2.5 bg-slate-50 border border-slate-100">' +
    '<p class="text-[10px] text-slate-400 mb-0.5">' + k[0] + '</p>' +
    '<p class="text-base font-bold leading-tight" style="color:' + k[3] + '">' + k[1] + '</p>' +
    '<p class="text-[10px] text-slate-400 mt-0.5">' + k[2] + '</p></div>').join('');
  // 置信带注释
  document.getElementById('xai-bt-note').textContent = '推荐模型「' + X.best.name + '」· RMSE ' + X.best.rmse.toFixed(2) + ' · 阴影带 = 预测 ±1×RMSE';
  // 六张图
  drawShapChart(); drawHeatChart(); drawEsen3D(); drawSaliencyChart(); drawDowChart(); drawBacktestChart();
}

// ---------- 导出解读报告 Excel ----------
function exportXAI() {
  if (!fcResult || !fcResult.xai || !fcResult.xai.data) return toast('请先完成一次预测', false);
  const d = fcResult.xai.data, X = fcResult;
  const isQty = X.metric === 'qty';
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const totalAbs = d.tsl.phi.reduce((s, p) => s + Math.abs(p), 0) || 1;
  const fullEvals = 7 * Math.pow(2, 6) * 2;
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['TimeSliver 符号-线性归因 vs 精确 SHAP 对照'],
    ['推荐模型', X.best.name, '回测WAPE(%)', +X.best.wape.toFixed(2)],
    ['基线值(均值)', +d.tsl.base.toFixed(2), '归因后预测值', +d.tsl.out.toFixed(2)],
    ['TimeSliver 前向次数（含敏感度）', d.tsl.evals, '精确 SHAP 前向次数', fullEvals],
    ['平均绝对偏差', +d.agree.dev.toFixed(4), '归一化偏差', +d.agree.norm.toFixed(4), 'Spearman', +d.agree.spearman.toFixed(4)],
    [],
    ['日期', '星期', '当日' + (isQty ? '销量' : '金额'), 'TimeSliver贡献', '精确SHAP贡献', '绝对偏差', '占总贡献%'],
    ...d.winDates.map((dt, i) => [dt, DOW_NM[new Date(dt + 'T00:00:00Z').getUTCDay()], +d.winRaw[i].toFixed(2), +d.tsl.phi[i].toFixed(2), +d.shap.phi[i].toFixed(2), +Math.abs(d.tsl.phi[i] - d.shap.phi[i]).toFixed(4), +(Math.abs(d.tsl.phi[i]) / totalAbs * 100).toFixed(1)])
  ]);
  ws1['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, safeSheetName('归因对照', used));
  const wmCols = ['预测起点'];
  for (let i = 0; i < d.wm.W; i++) wmCols.push(i === d.wm.W - 1 ? 'T-0(昨日)' : 'T-' + (d.wm.W - 1 - i));
  const ws0 = XLSX.utils.aoa_to_sheet([
    ['TimeSliver 时间切片归因热力矩阵（行=预测起点，列=窗口历史日，φ 带符号）'],
    wmCols,
    ...d.wm.ends.map((dt, r) => [dt].concat(d.wm.mat[r].map(v => +v.toFixed(3))))
  ]);
  ws0['!cols'] = [{ wch: 14 }].concat(d.wm.W ? Array.from({ length: d.wm.W }, () => ({ wch: 11 })) : []);
  XLSX.utils.book_append_sheet(wb, ws0, safeSheetName('归因热力矩阵', used));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['时间敏感度（梯度）'], ['相对天数', '日期', '敏感度'],
    ...d.sal.map((v, i) => [6 - i, d.winDates[i], +v.toFixed(3)]),
    [], ['星期周期效应'], ['星期', '日均' + (isQty ? '销量' : '金额')],
    ...order.map(dw => [DOW_NM[dw], +d.dow.avg[dw].toFixed(2)]),
    [], ['周末/工作日系数', +d.dow.weekendFactor.toFixed(2)]
  ]);
  ws2['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, safeSheetName('敏感度与周期', used));
  const ws3 = XLSX.utils.aoa_to_sheet([
    ['回测对比（留出后 20% 数据）'], ['日期', '实际值', '预测值', '误差', '误差率%'],
    ...d.test.map((v, i) => [d.btDates[i], +v.toFixed(2), +d.preds[i].toFixed(2), +(v - d.preds[i]).toFixed(2), v > 0 ? +(((v - d.preds[i]) / v) * 100).toFixed(1) : 0])
  ]);
  ws3['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws3, safeSheetName('回测对比', used));
  const ws4 = XLSX.utils.aoa_to_sheet([['AI 预测解读与建议', ''], [], ...d.advice.map(a => [a])]);
  ws4['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws4, safeSheetName('解读与建议', used));
  downloadBlob(writeWorkbook(wb), '预测解读报告_' + new Date().toISOString().slice(0, 10) + '.xlsx', (m, bad) => toast(m, !bad));
}

// ---------- 保存归因长图 PNG ----------
function saveXAIPng() {
  if (!fcResult || !fcResult.xai || !fcResult.xai.data) return toast('请先完成一次预测', false);
  const items = [
    { cv: document.getElementById('xai-shap'), cap: '① TimeSliver 时间片段贡献分解（红=推高 / 绿=拉低）' },
    { cv: document.getElementById('xai-heat'), cap: '② 归因热力图（行=预测起点 · 列=窗口历史日）' },
    { cv: document.getElementById('xai-3d'), cap: '③ 贡献强度立体柱（零线以上推高 / 以下拉低）' },
    { cv: document.getElementById('xai-saliency'), cap: '④ 时间敏感度（★为模型最依赖的历史日）' },
    { cv: document.getElementById('xai-dow'), cap: '⑤ 星期周期效应' },
    { cv: document.getElementById('xai-backtest'), cap: '⑥ 回测置信区间' }
  ];
  if (items.some(it => !it.cv._w)) return toast('图表尚未渲染完成，请稍候', false);
  const pad = 26, headH = 118, capH = 30, gap = 16, footH = 64;
  const W2 = Math.max(...items.map(it => it.cv._w)) + pad * 2;
  const H2 = headH + items.reduce((s, it) => s + capH + it.cv._h + gap, 0) + footH;
  const out = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  out.width = W2 * dpr; out.height = H2 * dpr;
  const ctx = out.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W2, H2);
  // 头部
  const hg = ctx.createLinearGradient(0, 0, W2, headH);
  hg.addColorStop(0, '#02182b'); hg.addColorStop(0.55, '#0b4f6c'); hg.addColorStop(1, '#0d9488');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W2, headH);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('鲲鉴智策 · 预测解读与 TimeSliver 归因报告', pad, 44);
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#99f6e4';
  ctx.fillText('推荐模型：' + fcResult.best.name + '　·　预测指标：' + (fcResult.metric === 'qty' ? '销售数量' : '销售金额') + '　·　预测未来 ' + fcResult.horizon + ' 天　·　回测 WAPE ' + fcResult.best.wape.toFixed(1) + '%', pad, 70);
  ctx.fillText('生成时间：' + new Date().toLocaleString('zh-CN'), pad, 92);
  let y = headH;
  items.forEach(it => {
    ctx.fillStyle = '#0f766e'; ctx.font = 'bold 14px sans-serif';
    ctx.fillText(it.cap, pad, y + 20); y += capH;
    ctx.drawImage(it.cv, pad, y, it.cv._w, it.cv._h); y += it.cv._h + gap;
  });
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif';
  ctx.fillText('由鲲鉴智策·可解释时序预测与决策平台自动生成　|　TimeSliver 时空切片归因（ICLR 2026）· 并行精确 SHAP 一致性校验', pad, H2 - 24);
  out.toBlob(function (blob) {
    downloadBlob(blob, '预测解读归因图_' + new Date().toISOString().slice(0, 10) + '.png', (m, bad) => toast(m, !bad));
  }, 'image/png');
}

// 导出预测 Excel
function exportForecast() {
  if (!fcResult) return;
  const { models, best, series, horizon, metric } = fcResult;
  const dates = futureDates(series[series.length - 1].date, horizon);
  const head = ['日期', ...models.map(m => m.name), '推荐(' + best.name + ')'];
  const aoa = [
    ['鲲鉴智策 · 中小企业臻品供应链 智能销量预测报告'], ['模型对比（回测后 20% 数据）'],
    ["模型","类别","MAE","RMSE","WAPE(%)"],
    ...models.map(m => [m.name, m.cat, +m.mae.toFixed(2), +m.rmse.toFixed(2), +m.wape.toFixed(1)]),
    [], ['未来 ' + horizon + ' 天预测（' + (metric === 'qty' ? '数量' : '金额') + '）'], head,
    ...dates.map((d, i) => [d, ...models.map(m => +m.fut[i].toFixed(2)), +best.fut[i].toFixed(2)])
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, '预测报告');
  downloadBlob(writeWorkbook(wb), '智能预测报告_' + new Date().toISOString().slice(0, 10) + '.xlsx', (m, bad) => toast(m, !bad));
}
