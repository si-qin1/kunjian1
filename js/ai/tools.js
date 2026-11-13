/**
 * 工具层（Function Calling / 工具注册表）
 * --------------------------------------------------------------------------
 * 对应评分项「MCP/工具集成」与「Agent 工作流」。
 * 设计：每个工具用 JSON Schema 声明（与 OpenAI tools 协议一致，可直接喂给模型），
 *      执行器只读为主；写操作（清空/删除）不注册为 AI 可调用工具，从机制上杜绝
 *      "一句话删库"。另提供 MCP 风格适配：schemas() 输出可直接作为 MCP tools/list
 *      的结果，call() 等价于 tools/call，便于接入 MCP 宿主。
 * 对外：KJ_AI.TOOLS.schemas() / call(name,args) / list()
 */
window.KJ_AI = window.KJ_AI || {};
(function () {
  const T = {};

  const REG = {};
  function reg(name, meta, schema, fn) {
    REG[name] = Object.assign({ name: name, readOnly: !meta.write, write: !!meta.write, cost: meta.cost || 'low' }, schema);
    REG[name].fn = fn;
  }

  /* ---------- 数据类工具（全部只读） ---------- */
  reg('data_bounds', {}, {
    description: '获取数据集的时间区间、记录数、累计销售额。回答任何"整体/一共/区间"类问题前应先调用，避免猜测。',
    parameters: { type: 'object', properties: {}, required: [] }
  }, function () {
    const B = nlDataBounds();
    if (!B) return { ok: false, error: '当前没有业务数据' };
    return { ok: true, first: B.first.toISOString().slice(0, 10), last: B.last.toISOString().slice(0, 10), records: db.records.length, total: Math.round(nlSum(db.records)) };
  });

  reg('query_sales', {}, {
    description: '按时间区间/客户/品名汇总销售额与销量。period 支持"最近N天""本月""上个月""YYYY年M月"等自然语言表述。',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', description: '时间区间，如 最近30天 / 本月 / 上个月 / 2025年9月；留空表示全区间' },
        customer: { type: 'string', description: '客户全名或简称，可留空' },
        product: { type: 'string', description: '品名，可留空' }
      }, required: []
    }
  }, function (a) {
    const range = a.period ? nlParseTime(a.period) : null;
    if (a.period && !range) return { ok: false, error: '无法解析时间区间：' + a.period };
    const cust = a.customer ? (nlFindCustomer(a.customer) || null) : null;
    const prod = a.product ? (nlFindProduct(a.product) || null) : null;
    const knownC = db.records.length ? Array.from(new Set(db.records.map(function (r) { return r.customer; }))).slice(0, 8) : [];
    if (a.customer && !cust) return { ok: false, error: '未找到客户：' + a.customer, known: knownC };
    if (a.product && !prod) return { ok: false, error: '未找到品名：' + a.product, known: Array.from(new Set(db.records.map(function (r) { return r.product; }))).slice(0, 8) };
    const recs = nlFilter(range, prod, cust);
    if (!recs.length) return { ok: true, empty: true, note: '该条件下没有送货记录' };
    return {
      ok: true, period: range ? range.label : '全部区间', customer: cust || '全部', product: prod || '全部',
      records: recs.length, amount: Math.round(nlSum(recs)), qty: Math.round(recs.reduce(function (s, r) { return s + (r.qty || 0); }, 0))
    };
  });

  reg('top_rank', {}, {
    description: '取销售额排行（品名或客户），返回 Top N 及其占比。',
    parameters: {
      type: 'object',
      properties: {
        by: { type: 'string', enum: ['product', 'customer'], description: '按品名或客户排行' },
        limit: { type: 'integer', description: '返回条数，默认 5，最多 10' },
        period: { type: 'string', description: '时间区间，可留空' }
      }, required: ['by']
    }
  }, function (a) {
    const range = a.period ? nlParseTime(a.period) : null;
    const recs = nlFilter(range, null, null);
    if (!recs.length) return { ok: true, empty: true };
    const key = a.by === 'customer' ? 'customer' : 'product';
    const map = {};
    recs.forEach(function (r) { const k = r[key] || '未命名'; map[k] = (map[k] || 0) + nlAmt(r); });
    const total = nlSum(recs);
    const list = Object.keys(map).sort(function (x, y) { return map[y] - map[x]; })
      .slice(0, Math.max(1, Math.min(10, a.limit || 5)))
      .map(function (k, i) { return { rank: i + 1, name: k, amount: Math.round(map[k]), share: Math.round(map[k] / total * 1000) / 10 + '%' }; });
    return { ok: true, by: key, period: range ? range.label : '全部区间', total: Math.round(total), list: list };
  });

  reg('trend_series', {}, {
    description: '按日给出销售额序列（可指定最近的 N 天、品名或客户），并计算首尾对比与峰值。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '最近多少天，默认 30，最多 180' },
        customer: { type: 'string', description: '客户，可留空' },
        product: { type: 'string', description: '品名，可留空' }
      }, required: []
    }
  }, function (a) {
    const days = Math.max(3, Math.min(180, a.days || 30));
    const range = nlParseTime('最近' + days + '天');
    const cust = a.customer ? nlFindCustomer(a.customer) : null;
    const prod = a.product ? nlFindProduct(a.product) : null;
    const recs = nlFilter(range, prod, cust);
    const series = nlSeries(recs, range);
    const vals = series.map(function (x) { return x.v; });
    const total = vals.reduce(function (s, v) { return s + v; }, 0);
    const peak = series.reduce(function (m, x) { return x.v > m.v ? x : m; }, series[0] || { date: '', v: 0 });
    const first3 = vals.slice(0, 3).reduce(function (s, v) { return s + v; }, 0) / 3;
    const last3 = vals.slice(-3).reduce(function (s, v) { return s + v; }, 0) / 3;
    return {
      ok: true, days: days, customer: cust || '全部', product: prod || '全部',
      total: Math.round(total), avg: Math.round(total / series.length),
      peak: { date: peak.date, value: Math.round(peak.v) },
      head3: Math.round(first3), tail3: Math.round(last3),
      change: first3 ? Math.round((last3 - first3) / first3 * 1000) / 10 + '%' : 'n/a',
      series: series.filter(function (x, i) { return i % Math.max(1, Math.ceil(series.length / 12)) === 0; }).map(function (x) { return x.date.slice(5) + ':' + Math.round(x.v); })
    };
  });

  reg('customer_profile', {}, {
    description: '查询单个客户的档案：结算方式、历史采购额、笔数、最近采购日期、常购品名。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '客户名称或简称' } }, required: ['name']
    }
  }, function (a) {
    const c = nlFindCustomer(a.name);
    if (!c) {
      const all = Array.from(new Set(db.records.map(function (r) { return r.customer; })));
      return { ok: false, error: '未找到客户：' + a.name + '（请改用下列客户全名之一）', known: all.slice(0, 12) };
    }
    const recs = db.records.filter(function (r) { return r.customer === c; });
    const amt = nlSum(recs);
    const last = recs.reduce(function (m, r) { return r.date > m ? r.date : m; }, '');
    const byP = {};
    recs.forEach(function (r) { byP[r.product] = (byP[r.product] || 0) + nlAmt(r); });
    const topP = Object.keys(byP).sort(function (x, y) { return byP[y] - byP[x]; }).slice(0, 3)
      .map(function (k) { return k + ' ' + Math.round(byP[k]).toLocaleString() + '元'; });
    const meta = (db.customers || []).find(function (x) { return x.name === c; }) || {};
    return {
      ok: true, name: c, settle: meta.settle || meta.period || '未记录', amount: Math.round(amt),
      records: recs.length, lastDate: last, freqPerMonth: recs.length ? Math.round(recs.length / 4 * 10) / 10 : 0, topProducts: topP
    };
  });

  reg('reconcile_summary', {}, {
    description: '对账汇总：按客户或月份给出应收、实收、差额与状态。',
    parameters: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: '客户，可留空' },
        month: { type: 'string', description: '月份，如 2025-09，可留空' }
      }, required: []
    }
  }, function (a) {
    const cust = a.customer ? nlFindCustomer(a.customer) : null;
    const recs = db.records.filter(function (r) {
      return (!cust || r.customer === cust) && (!a.month || String(r.date).slice(0, 7) === a.month);
    });
    if (!recs.length) return { ok: true, empty: true };
    const due = nlSum(recs);
    const st = db.reconStatus || {};
    let paid = 0, confirmed = 0, pending = 0;
    const map = {};
    recs.forEach(function (r) {
      const key = r.customer + '|' + String(r.date).slice(0, 7);
      if (!map[key]) map[key] = { customer: r.customer, month: String(r.date).slice(0, 7), due: 0 };
      map[key].due += nlAmt(r);
    });
    Object.keys(map).forEach(function (k) {
      const v = map[k];
      const s = st[k] || st[v.customer + '|' + v.month];
      if (s === 'confirmed' || s === true) { paid += v.due; confirmed++; }
      else if (s === 'pending') { pending++; }
    });
    return {
      ok: true, customer: cust || '全部客户', month: a.month || '全部月份',
      due: Math.round(due), confirmedGroups: confirmed, pendingGroups: pending,
      note: '差额需人工确认原因（退货/折扣/跨月结算），系统不自动冲销'
    };
  });

  reg('kb_search', {}, {
    description: '检索业务知识库与数据档案（客户/品名/月度汇总、口径定义、对账与备货规则），返回带编号的片段，回答中请用 [n] 标注来源。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或问题' },
        k: { type: 'integer', description: '返回条数，默认 4' }
      }, required: ['query']
    }
  }, function (a) {
    const hits = KJ_AI.RAG.search(a.query, a.k || 4);
    if (!hits.length) return { ok: true, empty: true, note: '知识库无匹配条目' };
    return { ok: true, hits: hits.map(function (h, i) { return { no: i + 1, title: h.title, text: h.text.slice(0, 150) }; }) };
  });

  /* ---------- 对外接口 ---------- */
  T.schemas = function () {
    return Object.keys(REG).filter(function (k) { return !REG[k].write; }).map(function (k) {
      return { type: 'function', function: { name: k, description: REG[k].description, parameters: REG[k].parameters } };
    });
  };

  T.list = function () {
    return Object.keys(REG).map(function (k) {
      return { name: k, description: REG[k].description, readOnly: REG[k].readOnly, schema: REG[k].parameters };
    });
  };

  /** 调用工具（等价 MCP tools/call）。统一包一层 try/catch，异常不炸整条链路 */
  T.call = async function (name, args) {
    const t0 = performance.now();
    const tool = REG[name];
    if (!tool) return { ok: false, error: '未知工具：' + name, ms: 0 };
    if (tool.write) return { ok: false, error: '该工具为写操作，AI 无权调用', ms: 0 };
    let data;
    try {
      data = await tool.fn(args || {});
    } catch (e) {
      data = { ok: false, error: '工具执行异常：' + (e.message || e) };
    }
    const ms = Math.round(performance.now() - t0);
    KJ_AI.log('tool', name + ' ' + (data && data.ok ? 'ok' : 'fail') + ' ' + ms + 'ms');
    return Object.assign({}, data, { tool: name, ms: ms });
  };

  KJ_AI.TOOLS = T;
})();
