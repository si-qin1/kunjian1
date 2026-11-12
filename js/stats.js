/**
 * Diebold–Mariano 检验
 * --------------------------------------------------------------------------
 * 只比 WAPE 大小是不够的：两个模型差 0.3 个点，可能只是这 24 天抽样的
 * 偶然波动。DM 检验看的是"损失差分序列的均值是否显著不为 0"，
 * 这里用 L1 损失、Newey–West 滞后 1 阶估方差，正态近似算 p 值。
 *
 * 实现完之后发现 PatchTST 和 MixLinear 的差异其实不显著（p≈0.77），
 * 于是文档里也照实写"前四名同一梯队"，没有硬吹。
 */

// ---------- Diebold–Mariano 检验 ----------
// 检验两个预测序列的 L1 损失是否显著不同：
//   d_t = |y_t − p_A,t| − |y_t − p_B,t|，DM = d̄ / √(Var_NW(d)/n)
// 方差采用 Newey–West（滞后 1）估计，p 值用正态近似（n=24 时与 t 分布近似一致）
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - 0.3989422804 * Math.exp(-z * z / 2) * poly;
  return z >= 0 ? cdf : 1 - cdf;
}
function dmTest(y, pA, pB) {
  const n = Math.min(y.length, pA.length, pB.length);
  if (n < 8) return { stat: 0, p: 1 };
  const d = [];
  let dbar = 0;
  for (let i = 0; i < n; i++) {
    const dd = Math.abs(y[i] - pA[i]) - Math.abs(y[i] - pB[i]);
    d.push(dd); dbar += dd;
  }
  dbar /= n;
  let g0 = 0;
  for (const x of d) g0 += (x - dbar) * (x - dbar);
  g0 /= n;
  let g1 = 0;
  for (let i = 1; i < n; i++) g1 += (d[i] - dbar) * (d[i - 1] - dbar);
  g1 /= n;
  const varNW = (g0 + 2 * g1) / n;
  if (varNW <= 1e-12) return { stat: 0, p: 1 };
  const stat = dbar / Math.sqrt(varNW);
  const p = Math.min(1, Math.max(0, 2 * (1 - normCdf(Math.abs(stat)))));
  return { stat, p };
}

function finishForecast(models, series, horizon, metric, xai) {
  // 推荐模型（WAPE 最小；小样本、含零值日时比 MAPE 更稳健）
  let best = models[0];
  for (const m of models) if (m.wape < best.wape) best = m;
  if (xai) xai.pred1 = best.p1 || null;
  // DM 检验：各模型相对推荐模型的 L1 损失差异显著性
  const vals = series.map(r => (r && typeof r === 'object') ? r.v : r);
  const hLen = models[0] && models[0].preds ? models[0].preds.length : 0;
  if (hLen) {
    const testY = vals.slice(vals.length - hLen);
    for (const m of models) {
      if (m === best) continue;
      try { const dm = dmTest(testY, best.preds, m.preds); m.dmStat = dm.stat; m.dmP = dm.p; } catch (e) { }
    }
  }
  fcResult = { models, best, series, horizon, metric, xai: xai || null };
  // 模型表
  document.getElementById('fc-model-table').innerHTML = models.map(m =>
    '<tr class="border-t' + (m === best ? ' bg-teal-50' : '') + '">' +
    '<td class="px-3 py-2 font-medium">' + m.name + '</td>' +
    '<td class="px-3 py-2 text-xs text-slate-500">' + m.cat + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.mae.toFixed(2) + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.rmse.toFixed(2) + '</td>' +
    '<td class="px-3 py-2 text-right">' + m.wape.toFixed(1) + '</td>' +
    '<td class="px-3 py-2 text-right">' + (m === best ? '—' : (m.dmP != null ? m.dmP.toFixed(3) + (m.dmP < 0.05 ? ' *' : '') : '—')) + '</td>' +
    '<td class="px-3 py-2 text-center">' + (m === best ? '<span class="px-2 py-0.5 rounded-full text-xs bg-teal-600 text-white">★ 最优</span>' : '') + '</td></tr>'
  ).join('');
  document.getElementById('fc-result').classList.remove('hidden');
  drawFcChart();
  renderFcFuture();
  if (xai) { drawModelCharts(); renderXAI(); }
  drawMechPanels();
  document.getElementById('fc-export-btn').classList.remove('hidden');
  document.getElementById('fc-best-note').textContent = '综合 WAPE 推荐模型：' + best.name;
  toast('预测完成，推荐模型：' + best.name);
}
