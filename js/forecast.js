/**
 * 预测主流程
 * --------------------------------------------------------------------------
 * runForecast() 把七次训练串起来：浏览器主线程不能一口气算几十秒，
 * 按 epoch 切片、每片让出一次事件循环并刷新进度条。训练完在留出段
 * （后 20%）回测，按 WAPE 自动择优，再全量重训外推未来 horizon 天。
 */

// ---------- 预测主流程 ----------
let fcResult = null;
function runForecast() {
  const metric = document.getElementById('fc-metric').value;
  const customer = document.getElementById('fc-customer').value;
  const product = document.getElementById('fc-product').value;
  const horizon = +document.getElementById('fc-horizon').value;
  const series = buildFcSeries(metric, customer, product);
  if (series.length < 20) return toast('历史数据不足（按日聚合不足 20 天），请先录入更多送货记录', false);
  const n = series.length, h = Math.max(5, Math.round(n * 0.2));
  const train = series.slice(0, n - h).map(r => r.v);
  const test = series.slice(n - h).map(r => r.v);
  const all = series.map(r => r.v);
  document.getElementById('fc-status').textContent = '样本 ' + n + ' 天（训练 ' + train.length + ' / 回测 ' + h + '）';
  document.getElementById('fc-result').classList.add('hidden');

  const models = [];
  const L = Math.min(SEQ_L, Math.max(14, train.length - 8));

  // ----- 1) PhaseFormer / MixLinear：轻量端到端训练（频带注意力 / 门控混合专家） -----
  function addDirect(name, cat, fit) {
    try {
      const m1 = fit(train); if (!m1) return;
      const preds = blockBacktest(m1, all, train.length, h, horizon, L);
      const m2 = fit(all);
      const fut = m2 ? m2.predict(all.slice(-L)).slice(0, horizon) : [];
      const mm = { name, cat, preds, fut, ...errMetrics(test, preds) };
      mm.p1 = w => (m2 ? m2.predict(w)[0] : 0);
      if (m2 && m2.inspect) mm.inspect = w => m2.inspect(w);   // 机制透视（注意力/门控）
      models.push(mm);
    } catch (e) { console.warn(name, e); }
  }
  addDirect('PhaseFormer 相位频带注意力', '前沿 · 谱域注意力', t => phaseFormerFit(t, L, horizon, 80));
  addDirect('MixLinear 门控混合专家', '前沿 · 混合线性', t => mixLinearFit(t, L, horizon, 220));

  // ----- 2) 轻量 TCN 训练（分片执行，UI 不冻结） -----
  const prog = document.getElementById('fc-progress-wrap'), bar = document.getElementById('fc-progress'),
        ptext = document.getElementById('fc-progress-text'), btn = document.getElementById('fc-run');
  prog.classList.remove('hidden'); btn.disabled = true; btn.classList.add('opacity-60');
  const TCN_EP = 70, TCN_N = 3, TCN_C = 8, TR_EP = 60, PT_EP = 60, FL_EP = 90, LSTM_EP = 1800; // FL_EP = FreqLite 训练轮数
  const totalEp = TCN_EP * TCN_N + TR_EP + PT_EP + FL_EP + LSTM_EP;
  let doneEp = 0;
  const setProg = txt => { bar.style.width = (doneEp / totalEp * 100).toFixed(0) + '%'; ptext.textContent = txt; };

  const tcnSamples = makeSamples(train, L, horizon, 1);
  const tcnNets = [];
  const tcnEnsPredict = w => {
    let out = null;
    for (const net of tcnNets) {
      const p = tcnPredict(net, w);
      out = out ? out.map((v, i) => v + p[i]) : p;
    }
    return out ? out.map(v => v / tcnNets.length) : [];
  };
  function trainNextTcn() {
    if (tcnNets.length >= TCN_N) {
      try {
        const preds = blockBacktest({ predict: tcnEnsPredict }, all, train.length, h, horizon, L);
        const fut = tcnEnsPredict(all.slice(-L)).slice(0, horizon);
        const mm = { name: '轻量 TCN', cat: '深度时序 · 3 膨胀子网', preds, fut, ...errMetrics(test, preds) };
        mm.p1 = w => tcnEnsPredict(w)[0];
        models.push(mm);
      } catch (e) { console.warn('TCN', e); }
      trainFrontier();
      return;
    }
    const k = tcnNets.length;
    const net = tcnCreate(20250601 + k * 7919, TCN_C, L, horizon);
    setProg('轻量 TCN 训练 ' + (k + 1) + '/' + TCN_N + ' ...');
    trainTcnAsync(net, tcnSamples, TCN_EP, 0.03, (ep, loss) => {
      doneEp++;
      setProg('轻量 TCN 训练 ' + (k + 1) + '/' + TCN_N + ' · epoch ' + ep + '/' + TCN_EP + ' · loss=' + loss.toFixed(4));
    }, () => { tcnNets.push(net); trainNextTcn(); });
  }
  trainNextTcn();

  // ----- 3) LSTM 三子网集成 -----
  // 通用异步训练器：每 epoch 分片调度，保持界面响应
  function trainEpochsAsync(net, stepFn, samples, epochs, lr, onEp, done) {
    let ep = 0;
    (function loop() {
      if (ep >= epochs) { done(); return; }
      ep++;
      let loss = 0;
      for (const sm of samples) loss += stepFn(net, sm.x, sm.y, lr * (1 - ep / epochs * 0.8));
      doneEp++;
      onEp(ep, loss / Math.max(1, samples.length));
      setTimeout(loop, 0);
    })();
  }
  // 前沿模型训练链：Transformer → PatchTST → FreqLite
  function trainFrontier() {
    const samples = makeSamples(train, L, horizon, 1);
    const queue = [
      { name: 'Transformer 编码器', cat: '前沿 · 自注意力', ep: TR_EP, lr: 0.01,
        make: () => trCreateNet(20251101, L, 32, 64, horizon, 2), step: trTrainStep, pred: trPredict },
      { name: 'PatchTST', cat: '前沿 · Patch 注意力', ep: PT_EP, lr: 0.01,
        make: () => ptCreateNet(20251101, 7, 7, L, 32, 64, horizon, 2), step: ptTrainStep, pred: ptPredict },
      { name: 'FreqLite 频域滤波残差栈', cat: '前沿 · 谱域滤波 3 子网集成', ep: FL_EP, lr: 0.02,
        make: () => [flCreateNet(20251101, L, horizon, 64), flCreateNet(20251102, L, horizon, 64), flCreateNet(20251103, L, horizon, 64)],
        step: (nets, x, y, lr) => { let ls=0; for(const n of nets) ls+=flTrainStep(n, x, y, lr); return ls/nets.length; },
        pred: (nets, w) => { const ps=nets.map(n=>flPredict(n, w)); return ps[0].map((_, i)=>ps.reduce((a, p)=>a+p[i], 0)/ps.length); } },
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
            if (Array.isArray(net)) mm.inspect = w => flInspect(net, w);   // 频域滤波透视（集成平均谱）
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
