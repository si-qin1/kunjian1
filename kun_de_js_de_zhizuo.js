function trainFrontier() {
    const samples = makeSamples(train, L, horizon, 1);
    const queue = [
      { name: 'Transformer 编码器', cat: '前沿 · 自注意力', ep: TR_EP, lr: 0.01,
        make: () => trCreateNet(20251101, L, 32, 64, horizon, 2), step: trTrainStep, pred: trPredict },
      { name: 'PatchTST', cat: '前沿 · Patch 注意力', ep: PT_EP, lr: 0.01,
        make: () => ptCreateNet(20251101, 7, 7, L, 32, 64, horizon, 2), step: ptTrainStep, pred: ptPredict },
      { name: 'N-BEATS', cat: '前沿 · 双残差栈', ep: NB_EP, lr: 0.02,
        make: () => nbCreateNet(20251101, 4, L, horizon, 64), step: nbTrainStep, pred: nbPredict },
    ];
    let qi = 0;
    (function next() {
      if (qi >= queue.length) { trainLstm(); return; }
      const q = queue[qi++];
      const net = q.make();
      setProg(q.name + ' 训练 ...');
      trainEpochsAsync(net, q.step, samples, q.ep, q.lr,
        (ep, loss) => setProg(q.name + ' · epoch ' + ep + '/' + q.ep + ' · loss=' + loss.toFixed(1)),
        () => {
          try {
            const preds = blockBacktest({ predict: w => q.pred(net, w) }, all, train.length, h, horizon, L);
            const fut = q.pred(net, all.slice(-L)).slice(0, horizon);
            const mm = { name: q.name, cat: q.cat, preds, fut, ...errMetrics(test, preds) };
            mm.p1 = w => q.pred(net, w)[0];
            models.push(mm);
          } catch (e) { console.warn(q.name, e); }
          next();
        });
    })();
  }

  function trainLstm() {
    const W = 7;
    const lo = Math.min(...train), hi = Math.max(...train), span = (hi - lo) || 1;
    const norm = v => (v - lo) / span;
    const win = train.map(norm);
    let samples = [];
    for (let i = W; i < win.length; i++) samples.push([win.slice(i - W, i), win[i]]);
    if (samples.length > 800) samples = samples.filter((_, i) => i % Math.ceil(samples.length / 800) === 0);
    const ENS = [{ H: 10, ep: 600, lr: 0.025 }, { H: 12, ep: 600, lr: 0.02 }, { H: 8, ep: 600, lr: 0.03 }];
    const nets = [], lossHist = [];
    let ci = 0, ep = 0, cur = null;
    (function trainLoop() {
      if (ci >= ENS.length) {
        prog.classList.add('hidden'); btn.disabled = false; btn.classList.remove('opacity-60');
        // 与其它模型统一的分块滚动回测协议（每 horizon 天重置窗口，避免长递推误差累积）
        const lstmBlockPredict = (w) => {
          const seqs = nets.map(() => w.map(norm)), out = [];
          for (let i = 0; i < horizon; i++) {
            let ysum = 0;
            nets.forEach((m, mi) => {
              const yhat = lstmForward(m, seqs[mi].slice(-W)).y;
              ysum += yhat; seqs[mi].push(Math.max(0, Math.min(1, yhat)));
            });
            out.push(Math.max(0, (ysum / nets.length) * span + lo));
          }
          return out;
        };
        const lp = blockBacktest({ predict: lstmBlockPredict }, all, train.length, h, horizon, W);
        const futSeqs = nets.map(() => all.slice(-W).map(norm)), fut = [];
        for (let i = 0; i < horizon; i++) {
          let ysum = 0;
          nets.forEach((m, mi) => {
            const yhat = lstmForward(m, futSeqs[mi].slice(-W)).y;
            ysum += yhat; futSeqs[mi].push(Math.max(0, Math.min(1, yhat)));
          });
          fut.push(Math.max(0, (ysum / nets.length) * span + lo));
        }
        const lstmModel = { name: 'LSTM 集成模型', cat: '深度时序 · 3 子网', preds: lp, fut, ...errMetrics(test, lp) };
        lstmModel.p1 = w => {
          const xs = w.slice(-W).map(norm);
          let s = 0; for (const m of nets) s += lstmForward(m, xs).y;
          return Math.max(0, s / nets.length * span + lo);
        };
        models.push(lstmModel);
        const ensBounds = ENS.reduce((acc, c) => { acc.push((acc.length ? acc[acc.length - 1] : 0) + c.ep); return acc; }, []);
        finishForecast(models, series, horizon, metric, { model: nets, lo, span, W, all, h, test, lossHist, epochs: totalEp, ensBounds, models });
        return;
      }
      if (!cur) { cur = lstmCreate(ENS[ci].H, 314159 + ci * 7919); ep = 0; }
      const cfg = ENS[ci];
      const lr = cfg.lr * (1 - ep / cfg.ep * 0.85);
      let lsum = 0;
      for (const [x, y] of samples) lsum += lstmTrainStep(cur, x, y, lr);
      ep++; doneEp++;
      lossHist.push(lsum / samples.length);
      setProg('LSTM 集成训练 ' + (ci + 1) + '/' + ENS.length + ' · epoch ' + ep + '/' + cfg.ep + ' · loss=' + (lsum / samples.length).toFixed(5));
      if (ep < cfg.ep) { setTimeout(trainLoop, 0); return; }
      nets.push(cur); cur = null; ci++;
      setTimeout(trainLoop, 0);
    })();
  }
}

function errMetrics(actual, pred) {
  let mae = 0, rmse = 0, mape = 0, cnt = 0, sumA = 0, sumE = 0;
  for (let i = 0; i < actual.length; i++) {
    const e = Math.abs(actual[i] - pred[i]);
    mae += e; rmse += e * e; sumA += Math.abs(actual[i]); sumE += e;
    const den = Math.max(Math.abs(actual[i]), 1e-6);
    if (Math.abs(actual[i]) > 1e-6) { mape += Math.abs((actual[i] - pred[i]) / den); cnt++; }
  }
  mae /= actual.length; rmse = Math.sqrt(rmse / actual.length);
  mape = cnt ? mape / cnt * 100 : 0;
  const wape = sumA > 0 ? sumE / sumA * 100 : 0;
  return { mae, rmse, mape, wape };
}

function finishForecast(models, series, horizon, metric, xai) {
  // 推荐模型（WAPE 最小；小样本、含零值日时比 MAPE 更稳健）
  let best = models[0];
  for (const m of models) if (m.wape < best.wape) best = m;
  if (xai) xai.pred1 = best.p1 || null;
  fcResult = { models, best, series, horizon, metric, xai: xai || null };
  // 模型表
  document.getElementById('fc-model-table').innerHTML = models.map(m =>
    '<tr class="border-t' + (m === best ? ' bg-teal-50' : '') + '">' +
    '<td class="px-3 py-2 font-medium">' + m.name + '</td>' +
    '<td class="px-3 py-2 text-xs text-slate-500">' + m.cat + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.mae.toFixed(2) + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.rmse.toFixed(2) + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.wape.toFixed(1) + '</td>' +
    '<td class="px-3 py-2 text-center">' + (m === best ? '<span class="px-2 py-0.5 rounded-full text-xs bg-teal-600 text-white">★ 最优</span>' : '') + '</td></tr>'
  ).join('');
  document.getElementById('fc-result').classList.remove('hidden');
  drawFcChart();
  renderFcFuture();
  if (xai) { drawModelCharts(); renderXAI(); }
  document.getElementById('fc-export-btn').classList.remove('hidden');
  document.getElementById('fc-best-note').textContent = '综合 WAPE 推荐模型：' + best.name;
  toast('预测完成，推荐模型：' + best.name);
}

// ---------- SVG 折线图 ----------
const FC_COLORS = { 'DLinear 分解线性': '#0ea5e9', 'NLinear 归一线性': '#f59e0b', '轻量 TCN': '#8b5cf6', 'LSTM 集成模型': '#0d9488', 'Transformer 编码器': '#ef4444', 'PatchTST': '#ec4899', 'N-BEATS': '#6366f1' };
function drawFcChart() {
  const { models, best, series, horizon, metric } = fcResult;
  const n = series.length;
  const h = (fcResult.xai && fcResult.xai.data) ? fcResult.xai.data.h : Math.max(5, Math.round(n * 0.2));
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
function trainFrontier() {
    const samples = makeSamples(train, L, horizon, 1);
    const queue = [
      { name: 'Transformer 编码器', cat: '前沿 · 自注意力', ep: TR_EP, lr: 0.01,
        make: () => trCreateNet(20251101, L, 32, 64, horizon, 2), step: trTrainStep, pred: trPredict },
      { name: 'PatchTST', cat: '前沿 · Patch 注意力', ep: PT_EP, lr: 0.01,
        make: () => ptCreateNet(20251101, 7, 7, L, 32, 64, horizon, 2), step: ptTrainStep, pred: ptPredict },
      { name: 'N-BEATS', cat: '前沿 · 双残差栈', ep: NB_EP, lr: 0.02,
        make: () => nbCreateNet(20251101, 4, L, horizon, 64), step: nbTrainStep, pred: nbPredict },
    ];
    let qi = 0;
    (function next() {
      if (qi >= queue.length) { trainLstm(); return; }
      const q = queue[qi++];
      const net = q.make();
      setProg(q.name + ' 训练 ...');
      trainEpochsAsync(net, q.step, samples, q.ep, q.lr,
        (ep, loss) => setProg(q.name + ' · epoch ' + ep + '/' + q.ep + ' · loss=' + loss.toFixed(1)),
        () => {
          try {
            const preds = blockBacktest({ predict: w => q.pred(net, w) }, all, train.length, h, horizon, L);
            const fut = q.pred(net, all.slice(-L)).slice(0, horizon);
            const mm = { name: q.name, cat: q.cat, preds, fut, ...errMetrics(test, preds) };
            mm.p1 = w => q.pred(net, w)[0];
            models.push(mm);
          } catch (e) { console.warn(q.name, e); }
          next();
        });
    })();
  }

  function trainLstm() {
    const W = 7;
    const lo = Math.min(...train), hi = Math.max(...train), span = (hi - lo) || 1;
    const norm = v => (v - lo) / span;
    const win = train.map(norm);
    let samples = [];
    for (let i = W; i < win.length; i++) samples.push([win.slice(i - W, i), win[i]]);
    if (samples.length > 800) samples = samples.filter((_, i) => i % Math.ceil(samples.length / 800) === 0);
    const ENS = [{ H: 10, ep: 600, lr: 0.025 }, { H: 12, ep: 600, lr: 0.02 }, { H: 8, ep: 600, lr: 0.03 }];
    const nets = [], lossHist = [];
    let ci = 0, ep = 0, cur = null;
    (function trainLoop() {
      if (ci >= ENS.length) {
        prog.classList.add('hidden'); btn.disabled = false; btn.classList.remove('opacity-60');
        // 与其它模型统一的分块滚动回测协议（每 horizon 天重置窗口，避免长递推误差累积）
        const lstmBlockPredict = (w) => {
          const seqs = nets.map(() => w.map(norm)), out = [];
          for (let i = 0; i < horizon; i++) {
            let ysum = 0;
            nets.forEach((m, mi) => {
              const yhat = lstmForward(m, seqs[mi].slice(-W)).y;
              ysum += yhat; seqs[mi].push(Math.max(0, Math.min(1, yhat)));
            });
            out.push(Math.max(0, (ysum / nets.length) * span + lo));
          }
          return out;
        };
        const lp = blockBacktest({ predict: lstmBlockPredict }, all, train.length, h, horizon, W);
        const futSeqs = nets.map(() => all.slice(-W).map(norm)), fut = [];
        for (let i = 0; i < horizon; i++) {
          let ysum = 0;
          nets.forEach((m, mi) => {
            const yhat = lstmForward(m, futSeqs[mi].slice(-W)).y;
            ysum += yhat; futSeqs[mi].push(Math.max(0, Math.min(1, yhat)));
          });
          fut.push(Math.max(0, (ysum / nets.length) * span + lo));
        }
        const lstmModel = { name: 'LSTM 集成模型', cat: '深度时序 · 3 子网', preds: lp, fut, ...errMetrics(test, lp) };
        lstmModel.p1 = w => {
          const xs = w.slice(-W).map(norm);
          let s = 0; for (const m of nets) s += lstmForward(m, xs).y;
          return Math.max(0, s / nets.length * span + lo);
        };
        models.push(lstmModel);
        const ensBounds = ENS.reduce((acc, c) => { acc.push((acc.length ? acc[acc.length - 1] : 0) + c.ep); return acc; }, []);
        finishForecast(models, series, horizon, metric, { model: nets, lo, span, W, all, h, test, lossHist, epochs: totalEp, ensBounds, models });
        return;
      }
      if (!cur) { cur = lstmCreate(ENS[ci].H, 314159 + ci * 7919); ep = 0; }
      const cfg = ENS[ci];
      const lr = cfg.lr * (1 - ep / cfg.ep * 0.85);
      let lsum = 0;
      for (const [x, y] of samples) lsum += lstmTrainStep(cur, x, y, lr);
      ep++; doneEp++;
      lossHist.push(lsum / samples.length);
      setProg('LSTM 集成训练 ' + (ci + 1) + '/' + ENS.length + ' · epoch ' + ep + '/' + cfg.ep + ' · loss=' + (lsum / samples.length).toFixed(5));
      if (ep < cfg.ep) { setTimeout(trainLoop, 0); return; }
      nets.push(cur); cur = null; ci++;
      setTimeout(trainLoop, 0);
    })();
  }
}

function errMetrics(actual, pred) {
  let mae = 0, rmse = 0, mape = 0, cnt = 0, sumA = 0, sumE = 0;
  for (let i = 0; i < actual.length; i++) {
    const e = Math.abs(actual[i] - pred[i]);
    mae += e; rmse += e * e; sumA += Math.abs(actual[i]); sumE += e;
    const den = Math.max(Math.abs(actual[i]), 1e-6);
    if (Math.abs(actual[i]) > 1e-6) { mape += Math.abs((actual[i] - pred[i]) / den); cnt++; }
  }
  mae /= actual.length; rmse = Math.sqrt(rmse / actual.length);
  mape = cnt ? mape / cnt * 100 : 0;
  const wape = sumA > 0 ? sumE / sumA * 100 : 0;
  return { mae, rmse, mape, wape };
}

function finishForecast(models, series, horizon, metric, xai) {
  // 推荐模型（WAPE 最小；小样本、含零值日时比 MAPE 更稳健）
  let best = models[0];
  for (const m of models) if (m.wape < best.wape) best = m;
  if (xai) xai.pred1 = best.p1 || null;
  fcResult = { models, best, series, horizon, metric, xai: xai || null };
  // 模型表
  document.getElementById('fc-model-table').innerHTML = models.map(m =>
    '<tr class="border-t' + (m === best ? ' bg-teal-50' : '') + '">' +
    '<td class="px-3 py-2 font-medium">' + m.name + '</td>' +
    '<td class="px-3 py-2 text-xs text-slate-500">' + m.cat + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.mae.toFixed(2) + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.rmse.toFixed(2) + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.wape.toFixed(1) + '</td>' +
    '<td class="px-3 py-2 text-center">' + (m === best ? '<span class="px-2 py-0.5 rounded-full text-xs bg-teal-600 text-white">★ 最优</span>' : '') + '</td></tr>'
  ).join('');
  document.getElementById('fc-result').classList.remove('hidden');
  drawFcChart();
  renderFcFuture();
  if (xai) { drawModelCharts(); renderXAI(); }
  document.getElementById('fc-export-btn').classList.remove('hidden');
  document.getElementById('fc-best-note').textContent = '综合 WAPE 推荐模型：' + best.name;
  toast('预测完成，推荐模型：' + best.name);
}

// ---------- SVG 折线图 ----------
const FC_COLORS = { 'DLinear 分解线性': '#0ea5e9', 'NLinear 归一线性': '#f59e0b', '轻量 TCN': '#8b5cf6', 'LSTM 集成模型': '#0d9488', 'Transformer 编码器': '#ef4444', 'PatchTST': '#ec4899', 'N-BEATS': '#6366f1' };
function drawFcChart() {
  const { models, best, series, horizon, metric } = fcResult;
  const n = series.length;
  const h = (fcResult.xai && fcResult.xai.data) ? fcResult.xai.data.h : Math.max(5, Math.round(n * 0.2));
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
}<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,Consolas,monospace}
body{background:#0f172a;color:#e2e8f0;padding:20px;max-width:1400px;margin:0 auto}
h1{color:#f87171;border-bottom:1px solid #475569;padding-bottom:12px;margin-bottom:20px}
.main-wrap{display:grid;grid-template-columns:1fr 1fr;gap:24px}
/* 左侧代码区 */
.code-panel{background:#1e293b;padding:20px;border-radius:12px;box-shadow:0 4px 20px #0003}
pre{white-space:pre-wrap;line-height:1.8;font-size:14px}
.code-line{padding:2px 6px;border-radius:4px;transition:0.4s}
.highlight-line{animation:codePulse 1.2s infinite;background:#f8717133}
@keyframes codePulse{0,100%{box-shadow:0 0 0 2px #f87171}50%{box-shadow:0 0 0 5px #f8717155}}
/* 右侧动画讲师区 */
.anim-panel{display:flex;flex-direction:column;gap:16px}
.teacher-box{background:#1e293b;border-radius:12px;padding:16px;display:flex;gap:14px;align-items:flex-start}
.teacher-avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#38bdf8,#a855f7);position:relative;overflow:hidden;flex-shrink:0}
/* 讲师人物动态动画 */
@keyframes teacherBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes teacherHand{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(15deg)}}
.teacher-body{width:36px;height:44px;background:#fff;border-radius:8px;position:absolute;bottom:0;left:22px}
.teacher-hand{width:12px;height:26px;background:#fff;border-radius:6px;position:absolute;bottom:12px;right:8px;animation:teacherHand 2s infinite}
.teacher-head{width:32px;height:32px;background:#fff;border-radius:50%;position:absolute;top:8px;left:24px}
.teacher-talk{flex:1}
.talk-text{padding:10px;background:#334155;border-radius:8px;line-height:1.6;min-height:80px;transition:0.5s}
/* 张量可视化画布 */
.tensor-canvas{background:#0f172a;border-radius:12px;padding:20px;min-height:360px;display:flex;flex-direction:column;gap:16px}
.ctrl-bar{display:flex;gap:10px;flex-wrap:center}
button{padding:8px 14px;border:none;border-radius:6px;font-size:14px;cursor:pointer}
.btn-step{background:#2563eb;color:#fff}
.btn-reset{background:#475569;color:#fff}
.dim-log{padding:10px;background:#1e293b;border-radius:6px;color:#facc15;font-family:monospace}
.block-container{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;min-height:180px}
.dim-block{width:90px;height:100px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-weight:bold;transition:all 0.7s cubic-bezier(0.2,0,0.2,1);position:relative;overflow:hidden}
/* 通道流动动画 */
@keyframes flowMove{0{transform:translateX(-30px);opacity:0}50%{opacity:1}100%{transform:translateX(30px);opacity:0}}
.flow-cell{width:14px;height:14px;background:#fff8;border-radius:50%;position:absolute;animation:flowMove 3s infinite}
/* 底部原理说明 */
.desc-card{margin-top:20px;background:#1e293b;padding:16px;border-radius:12px}
.desc-card h3{color:#38bdf8;margin-bottom:10px}
ul{padding-left:20px;line-height:1.7;color:#cbd5e1}
.red-tip{background:#7f1d1d44;border:1px solid #ef4444;padding:8px;border-radius:6px;margin-top:10px;color:#fca5a5}
</style>
</head>
<body>
<h1>ShuffleLayer Permute 通道混洗 完整代码动画教学</h1>
<div class="main-wrap">
    <!-- 左侧代码面板 -->
    <div class="code-panel">
        <h2 style="margin-bottom:12px;color:#94a3b8">PyTorch 原始源码逐行标注</h2>
<pre>
<span style="color:#c084fc"># 分组卷积通道混洗核心实现，等价permute维度置换</span>
<span class="code-line" id="line1">def ShuffleLayer(x, groups):</span>
<span class="code-line" id="line2">    batchsize, num_channels, height, width = x.data.size()</span>
<span class="code-line" id="line3">    channels_per_group = num_channels // groups</span>

<span style="color:#38bdf8">    ### Step1 reshape 拆分通道维度</span>
<span class="code-line" id="line4">    x = x.view(batchsize, groups, channels_per_group, height, width)</span>

<span style="color:#38bdf8">    ### Step2 transpose 交换维度(核心混洗)</span>
<span class="code-line" id="line5">    x = torch.transpose(x, dim0=1, dim1=2).contiguous()</span>

<span style="color:#38bdf8">    ### Step3 flatten 合并维度还原特征图</span>
<span class="code-line" id="line6">    x = x.view(batchsize, -1, height, width)</span>

<span class="code-line" id="line7">    return x
</pre>
    </div>

    <!-- 右侧动画+讲师讲解 -->
    <div class="anim-panel">
        <!-- AI讲师人物讲解模块 -->
        <div class="teacher-box">
            <div class="teacher-avatar" style="animation:teacherBounce 2.5s infinite">
                <div class="teacher-head"></div>
                <div class="teacher-body"></div>
                <div class="teacher-hand"></div>
            </div>
            <div class="teacher-talk">
                <h3 style="margin-bottom:6px;color:#94a3b8">AI深度学习讲师</h3>
                <div class="talk-text" id="talkBox">点击下方分步按钮，我会同步讲解每一步张量变换逻辑，可视化通道分组混洗全过程</div>
            </div>
        </div>

        <!-- 张量动画画布 -->
        <div class="tensor-canvas">
            <div class="ctrl-bar">
                <button class="btn-step" onclick="run(1)">1.初始4维输入 [B,C,H,W]</button>
                <button class="btn-step" onclick="run(2)">2.Reshape拆分5维 [B,G,Cg,H,W]</button>
                <button class="btn-step" onclick="run(3)">3.Transpose交换维度混洗</button>
                <button class="btn-step" onclick="run(4)">4.Flatten还原输出</button>
                <button class="btn-reset" onclick="resetAll()">重置全部动画</button>
            </div>
            <div class="dim-log" id="dimLog">当前张量状态：等待演示</div>
            <div class="block-container" id="blockBox"></div>
        </div>
    </div>
</div>

<!-- 底部原理补充 -->
<div class="desc-card">
    <h3>通道混洗 Channel Shuffle 底层原理与代码坑点</h3>
    <ul>
        <li>分组卷积（Group Conv）各组通道独立计算，组间无信息交互，模型精度下降</li>
        <li>view拆分通道：把单通道维度拆分为「分组数G + 每组通道Cg」两个独立维度</li>
        <li>transpose(1,2)是permute简化操作，交换分组与单组通道，实现通道跨组打乱</li>
        <li>.contiguous()强制内存连续：transpose后张量存储不连续，不调用会导致后续view报错</li>
        <li>view(batch,-1,...)中-1自动计算合并通道，恢复标准4维卷积特征图格式</li>
    </ul>
    <div class="red-tip">⚠️ 高频踩坑：transpose / permute 操作后必须 .contiguous()，否则重塑view会抛出RuntimeError</div>
</div>

<script>
// 全局参数配置（本地离线固定参数：B=1，分组G=2，每组通道Cg=3，总通道6）
const config = {B:1, groups:2, cg:3, H:2, W:2};
const talkBox = document.getElementById('talkBox');
const dimLog = document.getElementById('dimLog');
const blockBox = document.getElementById('blockBox');
const codeLineIds = ['line1','line2','line3','line4','line5','line6','line7'];

// 清除所有代码高亮
function clearCodeHighlight(){
    codeLineIds.forEach(id=>document.getElementById(id).classList.remove('highlight-line'))
}

// 生成维度色块+通道流动粒子动画
function renderBlocks(dimList, colorList){
    blockBox.innerHTML = '';
    dimList.forEach((dim,idx)=>{
        const div = document.createElement('div');
        div.className = 'dim-block';
        div.style.background = colorList[idx];
        div.innerHTML = `<div>${dim.name}</div><div style="font-size:12px;margin-top:4px">size:${dim.val}</div>`;
        // 添加流动通道粒子动画
        for(let i=0;i<Math.min(dim.val,4);i++){
            let dot = document.createElement('div');
            dot.className = 'flow-cell';
            dot.style.animationDelay = `${i*0.4}s`;
            div.appendChild(dot);
        }
        blockBox.appendChild(div);
    })
}

// 分步执行逻辑 + 讲师同步台词 + 代码高亮联动
function run(step){
    clearCodeHighlight();
    const totalC = config.groups * config.cg;
    switch(step){
        case 1:
            // 步骤1：初始输入张量
            document.getElementById('line2').classList.add('highlight-line');
            talkBox.innerText = "第一步代码读取输入张量维度：输入是标准卷积4维特征图 [Batch, Channel, Height, Width]。我们示例批次B=1，总通道6，特征图高宽都是2。此时所有通道挤在同一个维度，分组卷积无法跨组交换信息。";
            dimLog.innerText = `张量形状：[B=${config.B}, C=${totalC}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"Channel",val:totalC},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#ef4444","#16a34a","#eab308"]);
            break;
        case 2:
            // 步骤2：reshape拆分5维
            document.getElementById('line4').classList.add('highlight-line');
            talkBox.innerText = "第二步执行view重塑，把单一通道维度拆成两层：groups分组 和 channels_per_group每组通道。4维张量升维为5维 [B, G, Cg, H, W]，现在通道被切分为2个分组，每组3个通道，为后续交换维度做准备。";
            dimLog.innerText = `Reshape拆分后5维：[B=${config.B}, groups=${config.groups}, C_per_group=${config.cg}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"Groups(G)",val:config.groups},
                {name:"C_per_Grp(Cg)",val:config.cg},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#9333ea","#f472b6","#16a34a","#eab308"]);
            break;
        case 3:
            // 步骤3：transpose交换维度 核心混洗
            document.getElementById('line5').classList.add('highlight-line');
            talkBox.innerText = "第三步是混洗核心！torch.transpose(x,1,2)交换第1、2维度，也就是交换分组维度和单组通道维度，通道自动跨组打乱。转置后内存不连续，必须调用.contiguous()重置内存，否则下一行view会直接报错。";
            dimLog.innerText = `转置交换维度后：[B=${config.B}, C_per_group=${config.cg}, groups=${config.groups}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"C_per_Grp(Cg)",val:config.cg},
                {name:"Groups(G)",val:config.groups},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#f472b6","#9333ea","#16a34a","#eab308"]);
            break;
        case 4:
            // 步骤4：flatten合并还原4维
            document.getElementById('line6').classList.add('highlight-line');
            talkBox.innerText = "最后一步view合并前两个维度，-1代表自动计算合并后的通道总数，张量恢复标准4维卷积格式。此时通道已经完成跨组混洗，下一层分组卷积可以融合来自不同分组的特征，解决分组卷积信息隔离问题。";
            dimLog.innerText = `输出混洗完成4维：[B=${config.B}, Shuffled_C=${totalC}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"Shuffled_Channel",val:totalC},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#f97316","#16a34a","#eab308"]);
            break;
    }
}

// 重置全部状态
function resetAll(){
    clearCodeHighlight();
    talkBox.innerText = "点击下方分步按钮，我会同步讲解每一步张量变换逻辑，可视化通道分组混洗全过程";
    dimLog.innerText = "当前张量状态：等待演示";
    blockBox.innerHTML = '<div style="color:#64748b">点击上方分步按钮启动张量动画演示</div>';
}
window.onload = resetAll;
</script>
