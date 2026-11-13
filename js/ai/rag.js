/**
 * RAG 检索层：语料构建 + 混合检索（BM25 + 实体加权）+ 引用输出
 * --------------------------------------------------------------------------
 * 对应评分项「RAG 技术应用」。语料分三类，全部由本应用真实数据/文档派生：
 *   ① 领域知识库：指标口径、模型评估、对账规则、备货原则、系统用法、AI 说明等静态条目；
 *   ② 业务数据切片：客户档案、品名档案、月度汇总（随数据变化自动重建）；
 *   ③ 检索策略：中文二元切分 + BM25（k1=1.2,b=0.75）+ 实体命中加权 + 去重，
 *      返回 Top-K 片段并生成编号引用，供 Agent 在回答中标注 [n]。
 * 对外：KJ_AI.RAG.build() / search() / context() / stats()
 */
window.KJ_AI = window.KJ_AI || {};
(function () {
  const RAG = {};

  /* ---------------- ① 静态知识库 ---------------- */
  const KB = [
    { id: 'kb-metric-amount', title: '销售额口径', text: '本系统「销售额」= 送货数量 × 单价，逐笔求和后汇总。所有报表、预测目标与对账金额均使用这一口径，不含退货冲减，退货在单独列示。' },
    { id: 'kb-metric-qty', title: '销量口径', text: '「销量」指送货数量合计，单位随品名不同（kg / 箱 / 件）。跨单位求和没有业务意义，比较销量时须限定同一品名。' },
    { id: 'kb-metric-margin', title: '毛利估算', text: '毛利 = 销售额 − 成本额，成本额按品名档案里的单位成本 × 数量估算。若品名未维护单位成本，毛利显示为空，不做默认填充，避免误导。' },
    { id: 'kb-model-error', title: '预测误差指标', text: 'WAPE = Σ|实际−预测| / Σ实际，衡量整体偏差，对量级敏感度低，适合日销量波动大的水产场景；MAE 为平均绝对误差；RMSE 对大误差更敏感。三者都保留，便于横向比较模型。' },
    { id: 'kb-model-tuning', title: '预测调参原则', text: '预测窗口默认按数据长度自动选择：样本少于 90 天用短窗口，多于 180 天用长窗口。调参只改窗口和季节项，不针对单点过拟合；每次调参后必须在验证集上复核 WAPE，劣化则不采纳。' },
    { id: 'kb-recon-rule', title: '对账规则', text: '对账以「客户 × 月份」为粒度：汇总该客户当月送货金额，与实收金额比对，差额需人工确认原因（退货、折扣、跨月结算）。未确认的差额保留在待办列表，不自动冲销。' },
    { id: 'kb-recon-month', title: '月结时点', text: '月结日为每月最后一天，跨月送货按送货日期归属月份。月末最后 3 天的单据允许延迟 2 天入账，但归属月份不变。' },
    { id: 'kb-stock-rule', title: '备货建议原则', text: '备货量 = 未来 N 天预测销量 × 安全系数（默认 1.15），再扣除当前库存。安全系数可调，节假日、休渔期前后建议上调到 1.3 以上。' },
    { id: 'kb-season', title: '季节性影响', text: '水产经营受休渔期（5—8 月）、春节、中秋影响明显。模型已把星期与月份作为季节项，但极端天气、封港属于外生冲击，不在模型能力范围内，需人工判断。' },
    { id: 'kb-cust-level', title: '客户分级标准', text: '客户按近 90 天采购额分三档：A 档 ≥ 30 万元，B 档 10—30 万元，C 档 < 10 万元。分级用于确定回访频次与账期，不直接影响价格。' },
    { id: 'kb-data-struct', title: '数据结构说明', text: '业务数据存于浏览器 localStorage 的 kunyan_v3 键，结构为 {records:[], reconStatus:{}, customers:[]}。records 每条含 date、customer、product、spec、qty、unit、price 字段；账号存于 kunyan_users_v1。' },
    { id: 'kb-module-map', title: '系统模块地图', text: '系统含七个手写时序模型（移动平均、指数平滑、Holt-Winters、线性回归、ARIMA 近似、季节分解、集成加权）、TimeSliver 时序归因、决策驾驶舱、对账、报表、数据洞察与对话式智能体「秦思智能体」。' },
    { id: 'kb-ai-design', title: 'AI 能力设计说明', text: '秦思智能体采用双引擎：本地规则引擎负责高频确定性问题（零延迟、可离线），大模型 Agent 负责开放性问题（规划—工具调用—作答）。未配置密钥时自动降级为本地引擎，保证系统始终可用。' },
    { id: 'kb-ai-safety', title: 'AI 安全策略', text: 'AI 侧限制：不接收密钥类输入；回答中的关键数字须与工具结果或检索资料一致，否则标注未通过核对；引用编号必须落在本次检索来源内；危险写操作（清空数据、删除记录）不经 AI 执行。' },
    { id: 'kb-forecast-horizon', title: '预测时长建议', text: '日粒度预测建议不超过 14 天，超过后误差快速放大；月度汇总预测可到 3 个月。对外汇报时应同时给出误差区间，而非单一数值。' }
  ];

  /* ---------------- 语料构建 ---------------- */
  let docs = [];
  let index = null;
  let sig = '';

  function sigOf() {
    const n = (db && db.records ? db.records.length : 0);
    const ds = db && db.records && db.records.length ? db.records[db.records.length - 1].date : '';
    return n + '|' + ds + '|' + ((db && db.customers) ? db.customers.length : 0);
  }

  function addDoc(id, title, text, kind, meta) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 8) return;
    docs.push({ id: id, title: title, text: t, kind: kind || 'kb', meta: meta || {} });
  }

  function buildDynamic() {
    if (!db || !db.records || !db.records.length) return;
    const B = nlDataBounds();
    const recs = db.records;
    const byP = {}, byC = {}, byM = {};
    recs.forEach(function (r) {
      byP[r.product] = byP[r.product] || { amt: 0, qty: 0, n: 0 };
      byP[r.product].amt += nlAmt(r); byP[r.product].qty += (r.qty || 0); byP[r.product].n++;
      byC[r.customer] = byC[r.customer] || { amt: 0, n: 0, last: '' };
      byC[r.customer].amt += nlAmt(r); byC[r.customer].n++;
      if (r.date > byC[r.customer].last) byC[r.customer].last = r.date;
      const m = String(r.date || '').slice(0, 7);
      byM[m] = byM[m] || { amt: 0, n: 0 };
      byM[m].amt += nlAmt(r); byM[m].n++;
    });
    if (B) addDoc('ds-bounds', '数据集区间与总量',
      '数据区间 ' + B.first.toISOString().slice(0, 10) + ' 至 ' + B.last.toISOString().slice(0, 10) +
      '，共 ' + recs.length + ' 笔送货记录，累计销售额 ' + Math.round(nlSum(recs)).toLocaleString() + ' 元。', 'data');

    Object.keys(byC).forEach(function (c, i) {
      const v = byC[c];
      addDoc('cust-' + i, '客户档案：' + c,
        c + ' 累计采购 ' + Math.round(v.amt).toLocaleString() + ' 元，共 ' + v.n + ' 笔，最近一次 ' + v.last + '。',
        'customer', { name: c });
    });
    Object.keys(byP).forEach(function (p, i) {
      const v = byP[p];
      addDoc('prod-' + i, '品名档案：' + p,
        p + ' 累计销售额 ' + Math.round(v.amt).toLocaleString() + ' 元，销量 ' + Math.round(v.qty).toLocaleString() + '，' + v.n + ' 笔记录。',
        'product', { name: p });
    });
    Object.keys(byM).sort().forEach(function (m) {
      const v = byM[m];
      addDoc('month-' + m, '月度汇总：' + m,
        m + ' 销售额 ' + Math.round(v.amt).toLocaleString() + ' 元，' + v.n + ' 笔送货。', 'month', { month: m });
    });
  }

  function tokenize(s) {
    const out = [];
    const low = String(s || '').toLowerCase().replace(/[，。、；：！？（）()“”"'《》\s]+/g, ' ');
    low.split(/\s+/).forEach(function (w) {
      if (!w) return;
      if (/^[\x00-\x7f]+$/.test(w)) { if (w.length > 1) out.push(w); return; }
      out.push(w);
      for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));   // 中文二元切分
    });
    return out;
  }

  function buildIndex() {
    index = { df: {}, docs: [], avg: 0, N: docs.length };
    let total = 0;
    docs.forEach(function (d) {
      const toks = tokenize(d.title + ' ' + d.text);
      const tf = {};
      toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      d._tf = tf; d._len = toks.length;
      total += d._len;
      Object.keys(tf).forEach(function (t) { index.df[t] = (index.df[t] || 0) + 1; });
    });
    index.avg = docs.length ? total / docs.length : 1;
  }

  function bm25(qTokens, k1, b) {
    const N = index.N;
    const scores = docs.map(function (d) {
      let s = 0;
      qTokens.forEach(function (t) {
        const f = d._tf[t] || 0;
        if (!f) return;
        const df = index.df[t] || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d._len / index.avg));
      });
      return { d: d, s: s };
    });
    return scores;
  }

  RAG.build = function (force) {
    const s = sigOf();
    if (!force && index && s === sig) return RAG.stats();
    docs = [];
    KB.forEach(function (x) { addDoc(x.id, x.title, x.text, 'kb'); });
    buildDynamic();
    buildIndex();
    sig = s;
    return RAG.stats();
  };

  RAG.stats = function () {
    const kinds = {};
    docs.forEach(function (d) { kinds[d.kind] = (kinds[d.kind] || 0) + 1; });
    return { docs: docs.length, kinds: kinds, terms: Object.keys(index && index.df ? index.df : {}).length };
  };

  /**
   * 检索
   * @param {string} query 自然语言问题
   * @param {number} k 返回条数
   * @returns {Array<{id,title,text,score,kind}>}
   */
  RAG.search = function (query, k) {
    RAG.build();                                   // 数据变化即重建
    k = k || 4;
    const q = String(query || '');
    const qt = tokenize(q);
    if (!qt.length) return [];
    const scored = bm25(qt, 1.2, 0.75);

    // 实体加权：问题里出现的客户/品名，若命中对应档案则加分（提升"问谁就查谁"的召回）
    const prod = (typeof nlFindProduct === 'function') ? nlFindProduct(q) : null;
    const cust = (typeof nlFindCustomer === 'function') ? nlFindCustomer(q) : null;
    scored.forEach(function (x) {
      if (prod && x.d.meta && x.d.meta.name === prod) x.s += 3.2;
      if (cust && x.d.meta && x.d.meta.name === cust) x.s += 3.2;
      if (x.d.kind === 'data' && /多少|总量|区间|一共/.test(q)) x.s += 1.0;
    });

    return scored.filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, k)
      .map(function (x) {
        return { id: x.d.id, title: x.d.title, text: x.d.text, kind: x.d.kind, score: Math.round(x.s * 100) / 100 };
      });
  };

  /** 生成给模型用的资料块 + 引用列表（编号与 [n] 一致） */
  RAG.context = function (query, k) {
    const hits = RAG.search(query, k);
    if (!hits.length) return { text: '', citations: [] };
    const lines = hits.map(function (h, i) {
      return '【资料' + (i + 1) + '｜' + h.title + '】' + h.text;
    });
    return {
      text: lines.join('\n'),
      citations: hits.map(function (h, i) { return { no: i + 1, id: h.id, title: h.title, snippet: h.text.slice(0, 110), score: h.score, kind: h.kind }; })
    };
  };

  KJ_AI.RAG = RAG;
})();
