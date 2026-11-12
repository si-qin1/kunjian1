/**
 * 数据洞察：概览 / 体检 / 雷达图 / 蜂窝图
 * --------------------------------------------------------------------------
 * 雷达图和蜂窝图都是手写的 Canvas，没有引 ECharts 之类的库：
 * 一是体积，二是这两张图的交互很简单，自己画反而更好控制样式。
 *
 * drawRadar(cv, cfg)  六维指标归一化到 0~1 后按多边形描点；
 * drawHexbin(cv, cfg) 六边形蜂窝，颜色越暖代表金额占比越高。
 * 时间窗口一律锚定数据集里的最大日期，不能用系统时间——演示数据是
 * 2025 年的，用当天日期去筛会得到一张空图（这个 bug 印象很深）。
 */

// ================= 数据中心扩展：概览 / 体检 / 模板 =================
// ================= 高级数据洞察图表：雷达图 / 蜂窝六边形热力图 =================
// 雷达图 drawRadar(cv, cfg)：cfg = { axes:['A','B',...], series:[{name,color,vals:[0-1,...]}], max? }
// 蜂窝图 drawHexbin(cv, cfg)：cfg = { rowLabels:[...], colLabels:[...], mat:[[0-1,...],...], legend? }
// 两类图全部纯 Canvas 手绘，无第三方图表库，值域统一归一化到 [0,1]。

function drawRadar(cv, cfg) {
  if (!cv) return;
  const axes = cfg.axes, series = cfg.series || [];
  const cssH = cfg.cssH || 300;
  const { ctx, w, h } = setupCanvas(cv, cssH);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2 + 6, R = Math.min(w, h) / 2 - 42;
  const n = axes.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  // 背景网格（4 层同轴多边形 + 轴线）
  for (let g = 1; g <= 4; g++) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const [x, y] = pt(i, R * g / 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
    ctx.fillStyle = g === 4 ? 'rgba(241,245,249,.9)' : 'rgba(248,250,252,.55)';
    ctx.fill(); ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.strokeStyle = '#cbd5e1';
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, R); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); }
  // 轴标签
  ctx.font = '11px system-ui'; ctx.fillStyle = '#475569';
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, R + 16);
    ctx.textAlign = Math.abs(x - cx) < 12 ? 'center' : (x > cx ? 'left' : 'right');
    ctx.textBaseline = Math.abs(y - cy) < 12 ? 'middle' : (y > cy ? 'top' : 'bottom');
    ctx.fillText(axes[i], x, y);
  }
  // 数值刻度
  ctx.font = '9px system-ui'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('100%', cx + 4, cy - R); ctx.fillText('50%', cx + 4, cy - R / 2);
  // 数据系列
  series.forEach(s => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const [x, y] = pt(i, R * Math.max(0, Math.min(1, s.vals[i]))); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
    ctx.fillStyle = s.color + '2e'; ctx.fill();
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.2; ctx.stroke();
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R * Math.max(0, Math.min(1, s.vals[i])));
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.stroke();
    }
  });
  // 图例（多系列时才绘制，避免单系列与轴标签重叠）
  if (series.length > 1) {
    const lw = ctx.measureText(series.map(s => s.name).join('')).width;
    let lx = cx - lw / 2 - series.length * 14, ly = h - 10;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    series.forEach(s => {
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 5, 10, 10);
      ctx.fillStyle = '#334155'; ctx.font = '11px system-ui';
      const name = s.name || '';
      ctx.fillText(name, lx + 14, ly);
      lx += 14 + ctx.measureText(name).width + 14;
    });
  }
}

function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;   // pointy-top
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function hexColor(v) {
  // 0→冷灰蓝 · 0.5→青绿 · 1→暖橙，温度计式配色
  v = Math.max(0, Math.min(1, v));
  const stops = [[245, 248, 252], [125, 211, 252], [45, 212, 191], [250, 204, 21], [249, 115, 22]];
  const t = v * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function drawHexbin(cv, cfg) {
  if (!cv) return;
  const rows = cfg.rowLabels || [], cols = cfg.colLabels || [], mat = cfg.mat || [];
  const nR = rows.length, nC = cols.length;
  if (!nR || !nC) return;
  const r = cfg.hexR || 21, gap = 2.5;
  const cellW = Math.sqrt(3) * r + gap;          // pointy-top 水平间距
  const cellH = 1.5 * r + gap;                   // 垂直间距
  const cssH = nR * cellH + r + 66;
  const { ctx, w, h } = setupCanvas(cv, cssH);
  ctx.clearRect(0, 0, w, h);
  const labelW = cfg.labelW || 96;
  const x0 = labelW + r / 2, y0 = 26 + r;
  // 列标题
  ctx.font = '11px system-ui'; ctx.fillStyle = '#64748b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let c = 0; c < nC; c++) ctx.fillText(cols[c], x0 + c * cellW, 14);
  // 行标题
  ctx.textAlign = 'right';
  for (let rr = 0; rr < nR; rr++) {
    const y = y0 + rr * cellH;
    ctx.fillStyle = '#475569'; ctx.font = '11px system-ui';
    ctx.fillText(rows[rr], labelW - 8, y);
    for (let c = 0; c < nC; c++) {
      const v = mat[rr] ? mat[rr][c] : 0;
      const cx = x0 + c * cellW + (rr % 2 ? cellW / 2 : 0);
      const cy = y;
      hexPath(ctx, cx, cy, r - gap / 2);
      ctx.fillStyle = hexColor(v);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.2; ctx.stroke();
      if (cfg.showValues !== false && r >= 18) {
        ctx.fillStyle = v > 0.55 ? '#ffffff' : '#334155';
        ctx.font = '9.5px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.fmtVal ? cfg.fmtVal(v, rr, c) : Math.round(v * 100), cx, cy);
      }
    }
  }
  // 图例（色带）
  const lgW = Math.min(180, w - 40), lgX = w - lgW - 24, lgY = h - 14;
  for (let i = 0; i <= 40; i++) {
    ctx.fillStyle = hexColor(i / 40);
    ctx.fillRect(lgX + i * lgW / 40, lgY - 5, lgW / 40 + 1, 10);
  }
  ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
  ctx.fillText(cfg.legendLow || '低', lgX - 6, lgY);
  ctx.textAlign = 'left'; ctx.fillText(cfg.legendHigh || '高', lgX + lgW + 6, lgY);
}

// ---------- 客户管理中心：价值雷达 + 消费蜂窝 ----------
function drawCustomerAnalytics() {
  const rows = db.customers.map(c => {
    const recs = db.records.filter(r => r.customer === c.name);
    const total = recs.reduce((s, r) => s + r.qty * r.price, 0);
    const months = new Set(recs.map(r => r.date.slice(0, 7)));
    const kinds = new Set(recs.map(r => r.product)).size;
    const last = recs.map(r => r.date).sort().pop() || '';
    const days = last ? Math.max(0, Math.round((Date.now() - new Date(last)) / 864e5)) : 999;
    return { name: c.name, total, n: recs.length, months: months.size, kinds, days };
  }).sort((a, b) => b.total - a.total).filter(x => x.n > 0);
  if (!rows.length) return;

  // ① 价值雷达：TOP5 六维画像
  const top5 = rows.slice(0, 5);
  const mx = k => Math.max(...top5.map(x => x[k]), 1e-9);
  const colors = ['#0ea5e9', '#f59e0b', '#10b981', '#6366f1', '#ef4444'];
  drawRadar(document.getElementById('cu-radar'), {
    axes: ['采购规模', '购买频次', '月均采购', '复购黏性', '品类广度', '近期活跃'],
    series: top5.map((x, i) => ({
      name: x.name.length > 8 ? x.name.slice(0, 8) + '…' : x.name, color: colors[i],
      vals: [x.total / mx('total'), x.n / mx('n'), x.total / x.months / mx('total') * Math.min(x.months, 6) / 6,
             Math.min(1, x.months / 6), x.kinds / mx('kinds'), 1 - Math.min(1, x.days / 60)],
    })),
  });

  // ② 消费蜂窝：TOP6 × 数据集最近 6 个自然月（锚定数据最大日期，与系统时钟无关）
  const monthKeys = [];
  const anchorD = new Date((db.records.map(r => r.date).sort().pop() || '') + 'T00:00:00');
  const nowD = isNaN(anchorD) ? new Date() : anchorD;
  for (let i = 5; i >= 0; i--) { const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1); monthKeys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
  const top6 = rows.slice(0, 6);
  const mat = top6.map(x => {
    const recs = db.records.filter(r => r.customer === x.name);
    const per = monthKeys.map(m => recs.filter(r => r.date.slice(0, 7) === m).reduce((s, r) => s + r.qty * r.price, 0));
    const mx2 = Math.max(...per, 1e-9);
    return per.map(v => v / mx2);
  });
  drawHexbin(document.getElementById('cu-hex'), {
    rowLabels: top6.map(x => x.name.length > 9 ? x.name.slice(0, 9) + '…' : x.name),
    colLabels: monthKeys.map(m => m.slice(2).replace('-', '/') + '月'),
    mat, fmtVal: (v) => v > 0.02 ? Math.round(v * 100) : '',
    legendLow: '淡季', legendHigh: '旺月',
  });
}

// ---------- 数据服务中心：健康雷达 + 销售密度蜂窝 ----------
function drawDataAnalytics() {
  const recs = db.records;
  if (!recs.length) return;
  // ① 数据健康雷达（五维体检，与 checkData 同源规则实时计算）
  const ratio = pred => recs.filter(pred).length / recs.length;
  const noDup = {};
  recs.forEach(r => { if (r.deliveryNo) noDup[r.deliveryNo] = (noDup[r.deliveryNo] || 0) + 1; });
  const dupKeys = Object.values(noDup).filter(v => v > 1).length;
  const uniq = Object.keys(noDup).length ? 1 - dupKeys / Object.keys(noDup).length : 1;
  const nKinds = new Set(recs.map(r => r.product)).size;
  drawRadar(document.getElementById('dt-radar'), {
    axes: ['字段完整性', '单号唯一性', '数量有效性', '价格有效性', '日期规范性', '品类丰富度'],
    cssH: 288,
    series: [{
      name: '当前数据集', color: '#0d9488',
      vals: [ratio(r => r.customer && r.product && r.date), uniq,
             ratio(r => r.qty > 0), ratio(r => r.price > 0),
             ratio(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')),
             Math.min(1, nKinds / 8)],
    }],
  });

  // ② 销售密度蜂窝：最近 8 周 × 星期几（蜂窝越亮=当日销售额越高）
  const daySum = {};
  recs.forEach(r => { daySum[r.date] = (daySum[r.date] || 0) + r.qty * r.price; });
  const weeks = 8, days = [];
  const anchorD2 = new Date((recs.map(r => r.date).sort().pop() || '') + 'T00:00:00');
  const baseD = isNaN(anchorD2) ? new Date() : anchorD2;
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(baseD); d.setDate(d.getDate() - i);
    days.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  const dowNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const rowLabels = [], mat = [];
  for (let w2 = 0; w2 < weeks; w2++) {
    const vals = new Array(7).fill(0);
    for (let k = 0; k < 7; k++) {
      const ds = days[w2 * 7 + k]; if (!ds) continue;
      const dow = (new Date(ds + 'T00:00:00').getDay() + 6) % 7;
      vals[dow] = daySum[ds] || 0;
    }
    const mx = Math.max(...vals, 1e-9);
    const wk = days[w2 * 7].slice(5).replace('-', '/');
    rowLabels.push(w2 === weeks - 1 ? '本周' : w2 === weeks - 2 ? '上周' : wk + '周');
    mat.push(vals.map(v => v / mx));
  }
  drawHexbin(document.getElementById('dt-hex'), {
    rowLabels, colLabels: dowNames, mat,
    fmtVal: v => v > 0.15 ? '●' : '', legendLow: '淡', legendHigh: '旺',
  });
}

function renderDataStats() {
  const el = document.getElementById('data-overview'); if (!el) return;
  const recs = db.records;
  const total = recs.reduce((s,r) => s + r.qty*r.price, 0);
  const cm = new Date().toISOString().slice(0,7);
  const items = [
    ['送货记录', recs.length + ' 条'],
    ['累计销售额', '¥' + fmt(total)],
    ['合作客户', new Set(recs.map(r=>r.customer)).size + ' 家'],
    ['在售品名', new Set(recs.map(r=>r.product)).size + ' 个'],
    ['本月新增', recs.filter(r=>(r.date||'').slice(0,7)===cm).length + ' 条'],
    ['最近备份', db.lastBackupAt ? new Date(db.lastBackupAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '尚未备份'],
  ];
  el.innerHTML = items.map(([k,v]) => '<div class="bg-slate-50 rounded-lg p-3 text-center"><div class="text-xs text-slate-500 mb-1">'+k+'</div><div class="text-sm font-bold text-slate-700">'+v+'</div></div>').join('');
  setTimeout(drawDataAnalytics, 30);
}
function checkData() {
  const problems = [];
  const byNo = {};
  db.records.forEach(r => { if (r.deliveryNo) (byNo[r.deliveryNo] = byNo[r.deliveryNo]||[]).push(r); });
  Object.entries(byNo).filter(([,v]) => v.length > 1).forEach(([k]) => problems.push('重复送货单号 ' + k + '（' + byNo[k].length + ' 条）'));
  db.records.forEach((r, i) => {
    if (!(r.qty > 0)) problems.push('第 ' + (i+1) + ' 行数量异常（' + r.qty + '）');
    if (!(r.price > 0)) problems.push('第 ' + (i+1) + ' 行单价异常（' + r.price + '）');
    if (!r.customer) problems.push('第 ' + (i+1) + ' 行缺少客户');
    if (!r.product) problems.push('第 ' + (i+1) + ' 行缺少品名');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')) problems.push('第 ' + (i+1) + ' 行日期格式异常（' + r.date + '）');
  });
  const el = document.getElementById('data-check-result');
  if (!problems.length) { el.innerHTML = '<span class="text-emerald-600 font-medium">✅ 体检通过：未发现任何数据问题</span>'; toast('数据体检通过'); return; }
  el.innerHTML = '<div class="text-rose-600 font-medium mb-1">发现 ' + problems.length + ' 个问题：</div>' +
    problems.slice(0,30).map(p => '• ' + esc(p)).join('<br>') + (problems.length > 30 ? '<br>…' : '');
  toast('数据体检完成：' + problems.length + ' 个问题', false);
}
function downloadTpl() {
  const aoa = [['送货日期','送货单号','订单编号','客户','品名','规格','数量','单位','单价'],
    ['2025-10-01','KY61500','YO20251001A','衍洲海产供应链(厦门)有限公司','东星斑','0.8-1斤/条',12,'斤',168],
    ['2025-10-01','KY61501','YO20251001B','蓝湾餐饮连锁集团','法国生蚝','N2 规格',10,'打',96]];
  const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:12},{wch:12},{wch:14},{wch:32},{wch:12},{wch:14},{wch:8},{wch:6},{wch:8}];
  XLSX.utils.book_append_sheet(wb, ws, '导入模板');
  downloadBlob(writeWorkbook(wb), '送货明细导入模板.xlsx', (m, bad) => toast(m, !bad));
}
