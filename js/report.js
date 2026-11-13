/**
 * 决策驾驶舱
 * --------------------------------------------------------------------------
 * genReport() 聚合全部记录成经营报告：月度 KPI、同比环比、客户与品类
 * 结构分析、异常提示与备货建议。结构分析三个视图切换时不重算数据。
 * 桑基图是手画贝塞尔带，默认只画 Top N，其余归“其他”。
 */

// ================= 智能决策 =================
let reportData = null;
function genReport() {
  if (!db.records.length) return toast('暂无送货数据', false);
  const recs = db.records;
  const amt = r => (r.qty || 0) * (r.price || 0);
  // 月度聚合
  const monthMap = {};
  recs.forEach(r => { const m = (r.date || '').slice(0, 7); if (!m) return;
    monthMap[m] = (monthMap[m] || 0) + amt(r); });
  const months = Object.keys(monthMap).sort();
  const lastM = months[months.length - 1], prevM = months[months.length - 2];
  const cur = monthMap[lastM] || 0, prev = monthMap[prevM] || 0;
  const momPct = prev > 0 ? (cur - prev) / prev * 100 : null;
  // 近30日均额
  const ds = [...new Set(recs.map(r => r.date))].sort();
  const last30 = ds.slice(-30);
  const d30set = {}; last30.forEach(d => d30set[d] = 1);
  const amt30 = recs.filter(r => d30set[r.date]).reduce((s, r) => s + amt(r), 0);
  // TOP5 品名
  const prodMap = {};
  recs.forEach(r => prodMap[r.product] = (prodMap[r.product] || 0) + amt(r));
  const top5 = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  // 客户贡献
  const custMap = {};
  recs.forEach(r => custMap[r.customer] = (custMap[r.customer] || 0) + amt(r));
  const custs = Object.entries(custMap).sort((a, b) => b[1] - a[1]);
  const total = recs.reduce((s, r) => s + amt(r), 0);
  // 星期规律
  const dowMap = {}; const dowCnt = {};
  recs.forEach(r => { const w = new Date(r.date + 'T00:00:00Z').getUTCDay();
    dowMap[w] = (dowMap[w] || 0) + amt(r); dowCnt[w] = (dowCnt[w] || 0) + 1; });
  const dowAvg = [0,1,2,3,4,5,6].map(w => dowCnt[w] ? dowMap[w] / dowCnt[w] : 0);
  const bestDow = dowAvg.indexOf(Math.max(...dowAvg));
  const dowNames = ['周日','周一','周二','周三','周四','周五','周六'];
  // 智能结论
  const tips = [];
  if (momPct !== null) tips.push(momPct >= 0
    ? `本月销售额较上月<b class="text-emerald-600">增长 ${momPct.toFixed(1)}%</b>，业务处于上升通道，建议按当前备货节奏适度扩大采购量。`
    : `本月销售额较上月<b class="text-rose-600">下降 ${Math.abs(momPct).toFixed(1)}%</b>，建议结合智能预测排查需求波动原因，优化进货计划避免积压。`);
  tips.push(`最畅销品为<b>${top5[0][0]}</b>（累计 ${(top5[0][1] / 10000).toFixed(1)} 万元），建议保持稳定货源并优先锁价。`);
  tips.push(`${custs[0][0]} 贡献了总销售额的 <b>${(custs[0][1] / total * 100).toFixed(1)}%</b>，是核心大客户，建议重点维护。`);
  tips.push(`${dowNames[bestDow]}是平均销售最高的日子，建议在<b>${dowNames[(bestDow + 6) % 7]}</b>提前完成备货与配送调度。`);
  // 客户 × 品名 热力矩阵（TOP8 × TOP8，单位：元）
  const topCust = custs.slice(0, 8);
  const topProd = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const ci = {}, pi = {};
  topCust.forEach(([n], i) => ci[n] = i);
  topProd.forEach(([n], i) => pi[n] = i);
  const heat = topCust.map(() => topProd.map(() => 0));
  recs.forEach(r => { const a = ci[r.customer], b = pi[r.product]; if (a != null && b != null) heat[a][b] += amt(r); });
  // 近 30 个有记录日的日销序列（KPI 迷你走势）
  const dayAmt = {};
  recs.forEach(r => { if (r.date) dayAmt[r.date] = (dayAmt[r.date] || 0) + amt(r); });
  const series30 = last30.map(d => dayAmt[d] || 0);
  // 客户画像补充：单数 / 客单价
  const custCnt = {}, custDays = {};
  recs.forEach(r => { custCnt[r.customer] = (custCnt[r.customer] || 0) + 1; (custDays[r.customer] = custDays[r.customer] || new Set()).add(r.date); });
  reportData = { months, monthMap, cur, prev, momPct, amt30, top5, custs, total, dowAvg, tips, lastM, topCust, topProd, heat, series30, custCnt, custDays };
  renderReport();
  document.getElementById('rp-export-btn').classList.remove('hidden');
  toast('智能决策报告已生成');
}

// ---------- 经营结构分析：三视图切换 ----------
let structView = 'heat';
const STRUCT_DESC = {
  heat: '横向看单品在哪些客户处集中，纵向看单客户对哪些品名依赖最深，可快速识别“谁买什么”的结构性依赖与替代风险。',
  sankey: '桑基图把“客户 → 品名”的资金流画成带状路径：带宽 = 采购金额，一眼看出哪条链路贡献最大、是否存在单点依赖。',
  bubble: '客户气泡画像：横轴 = 送货笔数（频次），纵轴 = 客单价（单笔价值），气泡面积 = 累计采购额；右上角即“高频高客单”的黄金客户。'
};

function switchStructView(v) {
  structView = v;
  [['heat', '热力图'], ['sankey', '桑基图'], ['bubble', '气泡图']].forEach(([k, l]) => {
    const el = document.getElementById('rp-view-' + k);
    if (el) el.classList.toggle('hidden', k !== v);
    const b = document.getElementById('rp-tab-' + k);
    if (b) b.setAttribute('style', 'font-size:11px;padding:4px 11px;border-radius:8px;border:none;cursor:pointer;transition:all .18s;' +
      (k === v ? 'background:#fff;color:#0f766e;font-weight:600;box-shadow:0 1px 3px rgba(15,23,42,.14)' : 'background:transparent;color:#64748b'));
  });
  const d = document.getElementById('rp-view-desc');
  if (d) d.textContent = STRUCT_DESC[v];
  if (v === 'sankey') drawSankey();
  if (v === 'bubble') drawBubble();
}

function renderReport() {
  const R = reportData, fmtW = v => (v / 10000).toFixed(1);
  const viewTabs = [['heat', '热力图'], ['sankey', '桑基图'], ['bubble', '气泡图']].map(([k, l]) =>
    '<button id="rp-tab-' + k + '" onclick="switchStructView(\'' + k + '\')" style="font-size:11px;padding:4px 11px;border-radius:8px;border:none;cursor:pointer;transition:all .18s;' +
    (structView === k ? 'background:#fff;color:#0f766e;font-weight:600;box-shadow:0 1px 3px rgba(15,23,42,.14)' : 'background:transparent;color:#64748b') + '">' + l + '</button>').join('');
  const momTxt = R.momPct === null ? '—' : (R.momPct >= 0 ? '+' : '') + R.momPct.toFixed(1) + '%';
  const momCol = R.momPct === null ? '#94a3b8' : (R.momPct >= 0 ? '#34d399' : '#fb7185');
  // 迷你走势（近 30 个记录日）
  const spark = (arr, color) => {
    const mx = Math.max(...arr, 1), mn = Math.min(...arr, 0);
    const pts = arr.map((v, i) => (i / Math.max(arr.length - 1, 1) * 100).toFixed(1) + ',' + (26 - (v - mn) / Math.max(mx - mn, 1e-9) * 22).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 100 30" preserveAspectRatio="none" style="width:100%;height:34px;display:block">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/></svg>';
  };
  const kpi = [
    { ic: '💰', t: R.lastM + ' 销售额', v: fmt(R.cur), s: '环比 ' + (R.momPct === null ? '—' : (R.momPct >= 0 ? '▲ ' : '▼ ') + Math.abs(R.momPct).toFixed(1) + '%'), c: '#0d9488', bg: '#ccfbf1', glow: 'rgba(45,212,191,.2)', sc: R.momPct === null ? '#94a3b8' : (R.momPct >= 0 ? '#059669' : '#e11d48') },
    { ic: '📈', t: '近 30 日日均', v: fmt(R.amt30 / 30), s: '按有记录日统计', c: '#0284c7', bg: '#e0f2fe', glow: 'rgba(56,189,248,.18)', sc: '#94a3b8' },
    { ic: '🏆', t: '累计总销售额', v: fmtW(R.total) + ' 万', s: '共 ' + db.records.length + ' 笔送货', c: '#7c3aed', bg: '#ede9fe', glow: 'rgba(139,92,246,.16)', sc: '#94a3b8' },
    { ic: '🤝', t: '活跃客户', v: R.custs.length + ' 家', s: 'TOP1 占比 ' + (R.custs[0][1] / R.total * 100).toFixed(0) + '%', c: '#d97706', bg: '#fef3c7', glow: 'rgba(245,158,11,.18)', sc: '#94a3b8' }
  ];
  const kpiHtml = kpi.map(k =>
    '<div class="bg-white rounded-xl p-4 shadow-sm relative overflow-hidden">' +
      '<div style="position:absolute;right:-14px;top:-14px;width:64px;height:64px;border-radius:9999px;background:' + k.glow + ';filter:blur(16px)"></div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
        '<span style="width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;background:' + k.bg + '">' + k.ic + '</span>' +
        '<span style="font-size:12px;color:#64748b">' + k.t + '</span></div>' +
      '<p style="font-size:20px;font-weight:700;line-height:1.2;color:' + k.c + '">' + k.v + '</p>' +
      '<p style="font-size:11px;color:' + k.sc + ';margin-top:4px">' + k.s + '</p></div>').join('');
  // TOP5 品名（进度条 + 占比）
  const maxTop = R.top5[0][1] || 1;
  // 棒棒糖图（Lollipop）：细茎 + 渐变糖头，比进度条更适合排名型数据
  const topHtml = R.top5.map(([n, v], i) => {
    const pct = Math.min(94, Math.max(3, v / maxTop * 100));
    const d = 13.5 - i * 1.2;
    const col = ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4'][i];
    return '<div style="display:flex;align-items:center;gap:8px;height:33px">' +
      '<span style="font-size:11px;width:84px;flex:0 0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569" title="' + esc(n) + '">' + esc(n) + '</span>' +
      '<div style="flex:1;position:relative;height:33px">' +
        '<div style="position:absolute;left:0;right:0;top:50%;height:1px;background:#eef2f6"></div>' +
        '<div style="position:absolute;left:0;top:50%;transform:translateY(-50%);height:3px;width:' + pct + '%;border-radius:3px;background:linear-gradient(90deg,#ccfbf1,' + col + ')"></div>' +
        '<div style="position:absolute;left:' + pct + '%;top:50%;transform:translate(-50%,-50%);width:' + d.toFixed(1) + 'px;height:' + d.toFixed(1) + 'px;border-radius:9999px;background:radial-gradient(circle at 32% 28%,#ffffff 0%,' + col + ' 62%);box-shadow:0 0 0 3px rgba(13,148,136,.1),0 2px 5px rgba(13,148,136,.32)"></div>' +
      '</div>' +
      '<span style="font-size:11px;font-weight:600;color:#0f766e;width:44px;text-align:right;flex:0 0 auto">' + fmtW(v) + '万</span>' +
      '<span style="font-size:10px;color:#94a3b8;width:32px;text-align:right;flex:0 0 auto">' + (v / R.total * 100).toFixed(1) + '%</span></div>';
  }).join('');
  // 星期规律
  const dowMax = Math.max(...R.dowAvg) || 1;
  const dowBest = R.dowAvg.indexOf(Math.max(...R.dowAvg));
  const dowHtml = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((n, w) => {
    const v = R.dowAvg[w], hh = Math.max(3, v / dowMax * 62);
    const on = w === dowBest;
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">' +
      '<div style="height:' + hh.toFixed(1) + 'px;width:58%;border-radius:5px 5px 2px 2px;background:' + (on ? 'linear-gradient(180deg,#38bdf8,#0284c7)' : '#e0f2fe') + '"></div>' +
      '<span style="font-size:9px;color:' + (on ? '#0284c7' : '#94a3b8') + '">' + n + '</span></div>';
  }).join('');
  // 客户 × 品名 热力图
  let mx = 0;
  R.heat.forEach(r => r.forEach(v => { if (v > mx) mx = v; }));
  mx = Math.max(mx, 1);
  const heatStops = [[0, '#f8fafc'], [0.18, '#ecfdf5'], [0.38, '#a7f3d0'], [0.6, '#34d399'], [0.8, '#0d9488'], [1, '#065f46']];
  const cell = (v) => {
    const t = v > 0 ? Math.pow(v / mx, 0.62) : 0;
    const bg = v > 0 ? ramp(heatStops, t) : '#f8fafc';
    const fg = t > 0.52 ? '#ffffff' : '#94a3b8';
    const txt = v > 0 ? (v >= 10000 ? (v / 10000).toFixed(1) : (v / 1000).toFixed(0) + 'k') : '';
    return { bg, fg, txt };
  };
  const heatHtml =
    '<div class="overflow-x-auto"><div style="min-width:560px">' +
      '<div style="display:flex;padding-left:104px;margin-bottom:4px">' +
        R.topProd.map(([n]) => '<div style="flex:1;min-width:46px;display:flex;justify-content:center">' +
          '<span style="display:block;writing-mode:vertical-rl;font-size:9px;color:#64748b;height:76px;line-height:16px;overflow:hidden;letter-spacing:1px" title="' + esc(n) + '">' + esc(n) + '</span></div>').join('') +
      '</div>' +
      R.topCust.map(([cn], r) => '<div style="display:flex;align-items:center;margin-bottom:3px">' +
        '<div style="width:104px;font-size:11px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px" title="' + esc(cn) + '">' + esc(cn) + '</div>' +
        R.topProd.map(([, pv], c) => {
          const v = R.heat[r][c], o = cell(v);
          return '<div style="flex:1;min-width:46px;height:30px;margin:0 2px;border-radius:6px;background:' + o.bg + ';display:flex;align-items:center;justify-content:center" title="' + esc(cn) + ' × ' + esc(R.topProd[c][0]) + '：' + fmt(v) + ' 元">' +
            '<span style="font-size:9px;font-weight:600;color:' + o.fg + '">' + o.txt + '</span></div>';
        }).join('') + '</div>').join('') +
    '</div></div>';
  // 子弹图（Bullet Chart）：实际条 + 平均目标线 + 三档定性背景带
  const custAvg = R.total / Math.max(R.custs.length, 1);
  const custMax = R.custs[0][1] || 1;
  const custHtml = R.topCust.map(([n, v], i) => {
    const cnt = R.custCnt[n] || 0, avg = cnt ? v / cnt : 0;
    const pct = Math.max(2, v / custMax * 100);
    const tgt = Math.max(1, Math.min(99, custAvg / custMax * 100));
    const hit = v >= custAvg;
    const short = n.replace(/[（(].*?[)）]/g, '');
    return '<div style="margin-bottom:11px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:8px">' +
        '<span style="font-size:11.5px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(n) + '">' + esc(short) +
          ' <span style="font-size:9px;color:#a8b3c2">' + cnt + ' 单 · 客单 ' + (avg >= 10000 ? (avg / 10000).toFixed(1) + '万' : Math.round(avg)) + '</span></span>' +
        '<span style="font-size:11px;font-weight:600;color:' + (hit ? '#0f766e' : '#94a3b8') + ';flex:0 0 auto">' + fmtW(v) + '万 · ' + (v / R.total * 100).toFixed(1) + '%</span>' +
      '</div>' +
      '<div style="position:relative;height:16px;border-radius:4px;overflow:visible;background:linear-gradient(90deg,#f8fafc 0 33.3%,#eef4f9 33.3% 66.6%,#e6eef6 66.6% 100%)">' +
        '<div style="position:absolute;left:0;top:4px;height:8px;width:' + pct.toFixed(1) + '%;border-radius:2px;background:linear-gradient(90deg,#67e8f9,#0284c7)"></div>' +
        '<div title="平均贡献 ' + fmtW(custAvg) + ' 万" style="position:absolute;left:' + tgt.toFixed(1) + '%;top:-3px;bottom:-3px;width:2px;background:#f59e0b;border-radius:2px;box-shadow:0 0 0 2px rgba(245,158,11,.16)"></div>' +
      '</div>' +
    '</div>';
  }).join('');
  const tipsHtml = R.tips.map((t, i) =>
    '<li style="display:flex;gap:8px;font-size:12.5px;color:#475569;line-height:1.65">' +
      '<span style="flex:0 0 auto;width:18px;height:18px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;margin-top:2px;background:' + ['#0d9488', '#0ea5e9', '#8b5cf6', '#f59e0b'][i % 4] + '">' + (i + 1) + '</span>' +
      '<span>' + t + '</span></li>').join('');
  document.getElementById('report-content').innerHTML =
  // 驾驶舱头部
  '<div class="rounded-2xl mb-4 relative overflow-hidden" style="background:radial-gradient(130% 160% at 0% 0%,#0f766e 0%,#0b3b4a 44%,#04141f 100%)">' +
    '<div style="position:absolute;right:-60px;bottom:-80px;width:220px;height:220px;border-radius:9999px;background:rgba(45,212,191,.18);filter:blur(50px)"></div>' +
    '<div class="p-5 md:p-6 relative">' +
      '<div class="flex items-start justify-between gap-6 flex-wrap">' +
        '<div>' +
          '<p style="font-size:10px;letter-spacing:.24em;color:#5eead4">DECISION COCKPIT</p>' +
          '<h3 style="color:#ffffff;font-size:21px;font-weight:700;margin-top:3px">智能决策驾驶舱</h3>' +
          '<p style="color:#99f6e4;font-size:12px;opacity:.8;margin-top:5px">' + db.records.length + ' 笔送货记录 · ' + R.months.length + ' 个月 · ' + R.custs.length + ' 家客户 · ' + R.topProd.length + ' 个主力品名</p>' +
        '</div>' +
        '<div style="width:230px;max-width:100%">' +
          '<p style="color:#99f6e4;font-size:10px;text-align:right;margin-bottom:2px">近 30 个记录日销售额走势</p>' + spark(R.series30, '#5eead4') +
        '</div>' +
      '</div>' +
      '<div class="flex gap-2 mt-5 flex-wrap">' +
        '<span style="font-size:11px;padding:4px 10px;border-radius:9999px;background:rgba(255,255,255,.09);color:#ccfbf1;border:1px solid rgba(153,246,228,.25)">环比 <b style="color:' + momCol + '">' + momTxt + '</b></span>' +
        '<span style="font-size:11px;padding:4px 10px;border-radius:9999px;background:rgba(255,255,255,.09);color:#ccfbf1;border:1px solid rgba(153,246,228,.25)">销冠 <b style="color:#fff">' + esc(R.top5[0][0]) + '</b></span>' +
        '<span style="font-size:11px;padding:4px 10px;border-radius:9999px;background:rgba(255,255,255,.09);color:#ccfbf1;border:1px solid rgba(153,246,228,.25)">核心客户 <b style="color:#fff">' + esc(R.custs[0][0]) + '</b></span>' +
        '<span style="font-size:11px;padding:4px 10px;border-radius:9999px;background:rgba(255,255,255,.09);color:#ccfbf1;border:1px solid rgba(153,246,228,.25)">旺季 <b style="color:#fff">' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dowBest] + '</b></span>' +
      '</div>' +
    '</div>' +
  '</div>' +
  // KPI
  '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">' + kpiHtml + '</div>' +
  // 3D 月度 + TOP5
  '<div class="grid lg:grid-cols-5 gap-4 mb-4">' +
    '<div class="lg:col-span-3 bg-white rounded-xl p-5 shadow-sm">' +
      '<div class="flex items-center justify-between mb-1 flex-wrap gap-2">' +
        '<h4 class="font-bold text-sm">📊 月度销售趋势</h4>' +
        '<span style="font-size:10px;padding:2px 8px;border-radius:9999px;background:#f0fdfa;color:#0f766e">立体柱 · 单位万元</span></div>' +
      '<canvas id="rp-3d" class="w-full"></canvas>' +
    '</div>' +
    '<div class="lg:col-span-2 bg-white rounded-xl p-5 shadow-sm">' +
      '<h4 class="font-bold text-sm mb-3">🔥 畅销品名 TOP5</h4>' + topHtml +
      '<div style="height:1px;background:#f1f5f9;margin:12px 0"></div>' +
      '<div class="flex items-center justify-between mb-2"><h4 class="font-bold text-sm">🗓 星期销售规律</h4>' +
        '<span style="font-size:10px;color:#94a3b8">日均 · 峰值 ' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dowBest] + '</span></div>' +
      '<div class="flex items-end gap-1" style="height:76px">' + dowHtml + '</div>' +
    '</div>' +
  '</div>' +
  // 经营结构分析（热力图 / 桑基图 / 气泡图 三视图）
  '<div class="bg-white rounded-xl p-5 shadow-sm mb-4">' +
    '<div class="flex items-center justify-between mb-1 flex-wrap gap-2">' +
      '<h4 class="font-bold text-sm">🧭 经营结构分析</h4>' +
      '<div style="display:flex;gap:2px;padding:3px;border-radius:10px;background:#f1f5f9">' + viewTabs + '</div>' +
    '</div>' +
    '<p id="rp-view-desc" style="font-size:11px;color:#94a3b8;margin:2px 0 12px;line-height:1.6">' + STRUCT_DESC[structView] + '</p>' +
    '<div id="rp-view-heat">' + heatHtml + '</div>' +
    '<div id="rp-view-sankey" class="hidden"><canvas id="rp-sankey" class="w-full"></canvas></div>' +
    '<div id="rp-view-bubble" class="hidden"><canvas id="rp-bubble" class="w-full"></canvas></div>' +
  '</div>' +
  // 客户贡献 + 建议
  '<div class="grid lg:grid-cols-2 gap-4 mb-4">' +
    '<div class="bg-white rounded-xl p-5 shadow-sm">' +
      '<div class="flex items-center justify-between mb-3"><h4 class="font-bold text-sm">🤝 客户贡献度</h4>' +
        '<span style="font-size:10px;color:#94a3b8">TOP' + R.topCust.length + ' · 含笔数与客单价</span></div>' + custHtml +
    '</div>' +
    '<div class="rounded-xl p-5 shadow-sm" style="background:linear-gradient(160deg,#ffffff 0%,#f0fdfa 65%,#ecfeff 100%)">' +
      '<div class="flex items-center gap-2 mb-3"><h4 class="font-bold text-sm">💡 智能经营建议</h4>' +
        '<span style="font-size:9px;padding:2px 7px;border-radius:9999px;background:#fef3c7;color:#b45309">AI 生成</span></div>' +
      '<ul style="display:flex;flex-direction:column;gap:10px">' + tipsHtml + '</ul>' +
    '</div>' +
  '</div>';
  drawReportCharts();
}

/** 智能决策页图表（3D 柱 / 热力）重绘入口 */
function drawReportCharts() {
  if (!reportData) return;
  const R = reportData;
  const cv = document.getElementById('rp-3d');
  if (!cv) return;
  draw3DBars(cv, {
    values: R.months.map(m => R.monthMap[m]),
    labels: R.months.map(m => m.slice(5) + '月'),
    sub: R.months.map((m, i) => i === 0 || m.slice(5) === '01' ? m.slice(0, 4) : ''),
    h: 300,
    fmt: v => (v / 10000).toFixed(1) + '万',
    accent: (i) => i === R.months.length - 1 ? { c1: '#38bdf8', c2: '#0369a1' } : { c1: '#5eead4', c2: '#0f766e' }
  });
  if (structView === 'sankey') drawSankey();
  if (structView === 'bubble') drawBubble();
}

// ---------- 桑基图：客户 → 品名 资金流向 ----------
function geoCache(cv, cssH) {
  const needW = Math.max(300, cv.parentElement.clientWidth - 4);
  let g = cv._gc;
  if (!g || g.h !== cssH || g.w !== needW) { g = setupCanvas(cv, cssH); cv._gc = g; }
  return g;
}
function truncTxt(ctx, s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function drawSankey() {
  const cv = document.getElementById('rp-sankey');
  if (!cv || !reportData) return;
  const R = reportData;
  const CUSTC = ['#0d9488', '#0ea5e9', '#6366f1', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444'];
  const L = R.topCust.map(([n], i) => ({ n, i, t: R.heat[i].reduce((a, b) => a + b, 0) })).filter(o => o.t > 0);
  const RR = R.topProd.map(([n], j) => ({ n, j, t: L.reduce((a, o) => a + R.heat[o.i][j], 0) })).filter(o => o.t > 0);
  if (!L.length || !RR.length) return;
  const total = L.reduce((a, o) => a + o.t, 0) || 1;
  const cssH = Math.max(330, Math.min(430, Math.max(L.length, RR.length) * 56 + 96));
  const t0 = performance.now(), dur = 760;
  if (cv._animS) cancelAnimationFrame(cv._animS);
  (function frame(now) {
    const tt = Math.min(1, (now - t0) / dur);
    renderSankey(cv, { R, L, RR, total, CUSTC, cssH }, 1 - Math.pow(1 - tt, 3));
    if (tt < 1) cv._animS = requestAnimationFrame(frame); else cv._animS = null;
  })(t0);
}
function renderSankey(cv, D, e) {
  const { R, L, RR, total, CUSTC, cssH } = D;
  const { ctx, w, h } = geoCache(cv, cssH);
  ctx.clearRect(0, 0, w, h);
  const labW = Math.min(104, Math.max(70, w * 0.17));
  const nodeW = 11, padT = 30, padB = 34, gap = 9;
  const leftX = labW, rightX = w - labW - nodeW;
  const ih = h - padT - padB;
  // 左右列共用同一高度标度，保证连线两端厚度完全一致
  const scaleH = Math.min(ih - gap * (L.length - 1), ih - gap * (RR.length - 1));
  const fit = (nodes) => {
    let y = padT;
    nodes.forEach(o => { o.h = Math.max(4, o.t / total * scaleH); o.y = y; y += o.h + gap; });
  };
  fit(L); fit(RR);
  // 居中
  const center = (nodes) => {
    const top = nodes[0].y, bot = nodes[nodes.length - 1].y + nodes[nodes.length - 1].h;
    const dy = (padT + ih / 2) - (top + bot) / 2;
    nodes.forEach(o => o.y += dy);
  };
  center(L); center(RR);
  // 连线
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, Math.max(1, (w - labW) * e + labW * 0.5), h); ctx.clip();
  const lOff = {}, rOff = {};
  L.forEach(o => lOff[o.i] = 0);
  RR.forEach(o => rOff[o.j] = 0);
  L.forEach(o => {
    RR.forEach(p => {
      const v = R.heat[o.i][p.j];
      if (!v) return;
      const th = Math.max(0.8, v / total * scaleH);
      const x0 = leftX + nodeW, x1 = rightX;
      const y0 = o.y + lOff[o.i], y1 = p.y + rOff[p.j];
      lOff[o.i] += th; rOff[p.j] += th;
      const dx = Math.max(28, (x1 - x0) * 0.42);
      const rgb = hex2rgb(CUSTC[o.i % CUSTC.length]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + dx, y0, x1 - dx, y1, x1, y1);
      ctx.lineTo(x1, y1 + th);
      ctx.bezierCurveTo(x1 - dx, y1 + th, x0 + dx, y0 + th, x0, y0 + th);
      ctx.closePath();
      ctx.fillStyle = rgbStr(rgb[0], rgb[1], rgb[2], 0.34);
      ctx.fill();
    });
  });
  ctx.restore();
  // 节点
  L.forEach((o) => {
    const c = CUSTC[o.i % CUSTC.length], rgb = hex2rgb(c);
    ctx.fillStyle = rgbStr(rgb[0], rgb[1], rgb[2], 0.95);
    rr(ctx, leftX, o.y, nodeW, o.h, 3); ctx.fill();
  });
  RR.forEach((p) => {
    ctx.fillStyle = '#334155';
    rr(ctx, rightX, p.y, nodeW, p.h, 3); ctx.fill();
  });
  // 标签
  ctx.font = '10px sans-serif';
  L.forEach(o => {
    ctx.textAlign = 'right'; ctx.fillStyle = '#475569';
    ctx.fillText(truncTxt(ctx, o.n.replace(/[（(].*?[)）]/g, ''), labW - 12), leftX - 8, o.y + o.h / 2 + 2);
    ctx.font = '9px sans-serif'; ctx.fillStyle = '#a8b3c2';
    ctx.fillText((o.t / 10000).toFixed(1) + '万', leftX - 8, o.y + o.h / 2 + 13);
    ctx.font = '10px sans-serif';
  });
  RR.forEach(p => {
    ctx.textAlign = 'left'; ctx.fillStyle = '#475569';
    ctx.fillText(truncTxt(ctx, p.n, labW - 14), rightX + nodeW + 8, p.y + p.h / 2 + 2);
    ctx.font = '9px sans-serif'; ctx.fillStyle = '#a8b3c2';
    ctx.fillText((p.t / 10000).toFixed(1) + '万', rightX + nodeW + 8, p.y + p.h / 2 + 13);
    ctx.font = '10px sans-serif';
  });
  // 标题与图例
  ctx.textAlign = 'left'; ctx.font = '9.5px sans-serif'; ctx.fillStyle = '#a8b3c2';
  ctx.fillText('客户（左）', 8, 14);
  ctx.textAlign = 'right';
  ctx.fillText('品名（右）', w - 8, 14);
  ctx.textAlign = 'left';
  ctx.fillText('带宽 = 采购金额　·　同色系 = 同一客户', 8, h - 8);
}

// ---------- 气泡图：客户频次 / 客单价 / 采购额 ----------
function drawBubble() {
  const cv = document.getElementById('rp-bubble');
  if (!cv || !reportData) return;
  const t0 = performance.now(), dur = 700;
  if (cv._animB) cancelAnimationFrame(cv._animB);
  (function frame(now) {
    const tt = Math.min(1, (now - t0) / dur);
    renderBubble(cv, 1 - Math.pow(1 - tt, 3));
    if (tt < 1) cv._animB = requestAnimationFrame(frame); else cv._animB = null;
  })(t0);
}
function renderBubble(cv, e) {
  const R = reportData;
  const cssH = 340;
  const { ctx, w, h } = geoCache(cv, cssH);
  ctx.clearRect(0, 0, w, h);
  const pts = R.topCust.map(([n, v], i) => {
    const c = R.custCnt[n] || 1;
    return { n, v, c, avg: v / c, i };
  });
  const padL = 58, padR = 26, padT = 22, padB = 46;
  const iw = w - padL - padR, ih = h - padT - padB;
  const xMax = Math.max(...pts.map(p => p.c)) * 1.12 || 1;
  const yMax = Math.max(...pts.map(p => p.avg)) * 1.18 || 1;
  const X = v => padL + v / xMax * iw;
  const Y = v => padT + ih * (1 - v / yMax);
  const vMax = Math.max(...pts.map(p => p.v)) || 1;
  // 网格
  ctx.strokeStyle = '#eef2f6'; ctx.lineWidth = 1; ctx.font = '9px sans-serif';
  for (let g = 0; g <= 4; g++) {
    const yv = yMax * g / 4, y = Y(yv);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = '#a8b3c2'; ctx.textAlign = 'right';
    ctx.fillText((yv / 10000).toFixed(1) + '万', padL - 6, y + 3);
  }
  for (let g = 0; g <= 4; g++) {
    const xv = xMax * g / 4, x = X(xv);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ih); ctx.stroke();
    ctx.fillStyle = '#a8b3c2'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(xv), x, h - 28);
  }
  // 轴标题
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'center'; ctx.fillText('送货笔数（频次）→', padL + iw / 2, h - 10);
  ctx.save(); ctx.translate(13, padT + ih / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('客单价（元）→', 0, 0); ctx.restore();
  // 气泡
  const pal = ['#0d9488', '#0ea5e9', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6'];
  const placed = [];
  pts.forEach((p, k) => {
    const r = (7 + 25 * Math.sqrt(p.v / vMax)) * e;
    const cx = X(p.c), cy = Y(p.avg);
    const c = pal[k % pal.length], rgb = hex2rgb(c);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, mixHex(c, '#ffffff', 0.45));
    g.addColorStop(1, rgbStr(rgb[0], rgb[1], rgb[2], 0.86));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.4; ctx.stroke();
    if (e > 0.55) {
      // 标签避让：与前序气泡重叠时把标签翻到气泡上方
      let ty = cy + r + 13;
      const clash = placed.some(q => Math.hypot(q.cx - cx, q.cy - cy) < q.r + r + 2);
      if (clash) ty = cy - r - 7;
      placed.push({ cx, cy, r, ty });
      ctx.globalAlpha = (e - 0.55) / 0.45;
      ctx.fillStyle = '#334155'; ctx.font = 'bold 9.5px sans-serif'; ctx.textAlign = 'center';
      const nm = p.n.replace(/[（(].*?[)）]/g, '');
      ctx.fillText(nm.length > 9 ? nm.slice(0, 9) + '…' : nm, cx, ty);
      ctx.globalAlpha = 1;
    }
  });
  // 面积图例
  const lgx = Math.max(10, w - padR - 110), lgy = padT + 6;
  [[0.55, 7], [1, 11]].forEach(([t, rr2], idx) => {
    ctx.beginPath(); ctx.arc(lgx + 10 + idx * 26, lgy + 16, 4 + 7 * t, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(13,148,136,' + (0.18 + 0.14 * idx) + ')'; ctx.fill();
  });
  ctx.fillStyle = '#a8b3c2'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('气泡面积 = 累计采购额', lgx - 4, lgy + 2);
}

function exportReport() {
  if (!reportData) return;
  const R = reportData;
  const aoa = [
    ['鲲鉴智策 · 智能决策报告'], ['生成时间：' + new Date().toLocaleString('zh-CN')], [],
    ['月份', '销售额(元)'], ...R.months.map(m => [m, +R.monthMap[m].toFixed(2)]), [],
    ['畅销品名 TOP5', '销售额(元)'], ...R.top5.map(([n, v]) => [n, +v.toFixed(2)]), [],
    ['客户×品名采购热力矩阵(元)', ...R.topProd.map(([n]) => n)],
    ...R.topCust.map(([cn], r) => [cn].concat(R.heat[r].map(v => +v.toFixed(2)))), [],
    ['客户', '销售额(元)', '占比(%)'], ...R.custs.map(([n, v]) => [n, +v.toFixed(2), +(v / R.total * 100).toFixed(1)]), [],
    ['智能建议'], ...R.tips.map(t => [t.replace(/<[^>]+>/g, '')])
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, '智能决策报告');
  downloadBlob(writeWorkbook(wb), '智能决策报告_' + new Date().toISOString().slice(0, 10) + '.xlsx', (m, bad) => toast(m, !bad));
}
