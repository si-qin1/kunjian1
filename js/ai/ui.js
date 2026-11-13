/**
 * AI 界面层：把 Agent 的"规划—工具—作答—核对"过程可视化，并提供多模态入口
 * --------------------------------------------------------------------------
 * 对应评分项：
 *   · Agent/工作流（思考轨迹、工具调用可见）
 *   · 多模态（图片识别 → 结构化、语音播报回答）
 *   · AI 安全可控（核对结果徽标、审计面板、引用来源可点开）
 *   · RAG（引用卡 [n] 与来源片段一一对应）
 * 依赖 nlq.js 的 nlBubble / nlThink 做气泡，不改变原有本地引擎路径。
 */
window.KJ_AI = window.KJ_AI || {};
(function () {
  const AI = window.KJ_AI;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function body() { return document.getElementById('nl-body'); }
  function toBottom() { const b = body(); if (b) b.scrollTop = b.scrollHeight; }

  /** 回答里的 [n] 转成可点的引用标记 */
  function markCitations(html) {
    return html.replace(/\[(\d+)\]/g, function (m, n) {
      return '<sup class="kj-cite" title="查看来源" onclick="KJ_AI.showCite(' + n + ')">[' + n + ']</sup>';
    });
  }

  AI.lastRun = null;

  AI.showCite = function (n) {
    const r = AI.lastRun;
    if (!r || !r.citations) return;
    const c = r.citations.find(function (x) { return x.no === Number(n); });
    if (!c) return;
    nlBubble('ai', '<b>来源 [' + n + '] ' + esc(c.title) + '</b><br><span style="opacity:.75">' + esc(c.snippet) + '…</span>');
  };

  /** 语音播报（本地 speechSynthesis，零外网依赖） */
  AI.speak = function (text) {
    try {
      if (!window.speechSynthesis) { nlBubble('ai', '当前浏览器不支持语音播报。'); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/\[\d+\]/g, '').replace(/<[^>]+>/g, ''));
      u.lang = 'zh-CN'; u.rate = 1.05;
      speechSynthesis.speak(u);
      AI.log('tts', '播报 ' + u.text.length + ' 字');
    } catch (e) { /* 播报失败不打断 */ }
  };

  /** 组装一条完整的 AI 回答气泡 */
  function renderRun(run) {
    const d = nlBubble('ai', '');
    const v = run.verify;
    const badge = !v ? '' :
      '<div class="kj-verify ' + (v.ok ? 'ok' : 'warn') + '">' +
      (v.ok ? (v.checked ? '✓ 已核对：' + v.checked + ' 个数字均可溯源' : '✓ 已核对：回答未包含需溯源的关键数字') : '⚠ 未通过核对：' + esc(v.note || '')) + '</div>';

    let html = markCitations(esc(run.answer).replace(/\n/g, '<br>'));

    if (run.citations && run.citations.length) {
      html += '<div class="kj-cites"><div class="kj-cites-h">检索来源（RAG）</div>' +
        run.citations.map(function (c) {
          return '<div class="kj-cite-row" onclick="KJ_AI.showCite(' + c.no + ')">[' + c.no + '] ' + esc(c.title) +
            '<span class="kj-cite-s">' + esc(c.snippet.slice(0, 46)) + '…</span></div>';
        }).join('') + '</div>';
    }

    if (run.steps && run.steps.length) {
      html += '<details class="kj-trace"><summary>思考与工具调用（' + run.steps.length + ' 步 · ' + (run.toolCount || 0) + ' 次工具）</summary>' +
        run.steps.map(function (s) {
          return '<div class="kj-step"><b>' + s.index + '.</b> ' + esc(s.think) +
            (s.tools.length ? s.tools.map(function (t) {
              return '<div class="kj-tool">↳ <code>' + esc(t.name) + '</code>(' + esc(JSON.stringify(t.args)) + ') ' +
                (t.ok ? '<i class="ok">' + esc(t.brief) + '</i>' : '<i class="bad">' + esc(t.brief) + '</i>') +
                ' <span class="ms">' + t.ms + 'ms</span></div>';
            }).join('') : '') + '</div>';
        }).join('') + '</details>';
    }

    html += '<div class="kj-acts">' +
      '<button onclick="KJ_AI.speak(' + JSON.stringify(run.answer).replace(/"/g, '&quot;') + ')">🔊 朗读</button>' +
      '<button onclick="KJ_AI.copyAnswer()">📋 复制</button>' +
      '</div>' + badge;

    d.innerHTML = html;
    toBottom();
    return d;
  }

  AI.copyAnswer = function () {
    const r = AI.lastRun; if (!r) return;
    try { navigator.clipboard.writeText(r.answer); nlBubble('ai', '已复制到剪贴板。'); } catch (e) {}
  };

  /** Agent 主流程（由 nlq.js 的发送逻辑调用） */
  AI.runChat = function (question) {
    AI.busy = true;
    const th = nlThink();
    let stepHtml = '';
    const stepBox = document.createElement('div');
    stepBox.className = 'kj-live';
    th.appendChild(stepBox);

    return AI.AGENT.run(question, {
      onStep: function (s) {
        if (s.type === 'tool') {
          stepHtml += '<div>· 调用 <code>' + esc(s.name) + '</code> → ' + esc((s.result && (s.result.ok ? '完成' : '失败')) || '') + '</div>';
          stepBox.innerHTML = stepHtml;
          toBottom();
        }
      }
    }).then(function (run) {
      AI.lastRun = run;
      th.remove();
      if (run.blocked) { nlBubble('ai', '🛡 ' + esc(run.answer)); return; }
      renderRun(run);
    }).catch(function (e) {
      th.remove();
      const msg = e && e.code === 'AI_NO_LLM'
        ? '未配置大模型，已使用本地引擎。'
        : '⚠ AI 服务暂不可用（' + esc(e.message || '网络异常') + '）。<br>本地模式仍可回答：<br>' + NL_HELP;
      nlBubble('ai', msg);
    }).finally(function () {
      AI.busy = false;
      if (typeof nlBusy !== 'undefined') nlBusy = false;
      const btn = document.getElementById('nl-send'); if (btn) btn.disabled = false;
      toBottom();
    });
  };

  /* ---------------- 多模态：图片识别 → 结构化 ---------------- */
  const IMG_PROMPT = [
    '你是单据识别助手。识别这张图片：',
    '1) 如果是送货单/订单/对账单/发票，抽取为 JSON：',
    '{"docType":"送货单|订单|对账单|发票|其他","date":"YYYY-MM-DD","billNo":"","customer":"","product":"","spec":"","qty":数值,"unit":"","price":数值,"amount":数值,"notes":""}',
    '2) 如果不是单据（如商品照片、图表截图），输出 {"docType":"其他","desc":"一句话说明图片内容"}。',
    '只输出 JSON，不要解释，不要加代码块。缺失字段留空字符串或 0，不要编造。'
  ].join('\n');

  AI.pickImage = function () {
    if (!AI.ready()) {
      nlBubble('ai', '图片识别需要大模型支持视觉能力：请在 ⚙ 中配置 API 地址、密钥与视觉模型（如 gpt-4o-mini / qwen-vl-plus / glm-4v）。');
      return;
    }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function () {
      const f = inp.files && inp.files[0];
      if (!f) return;
      if (f.size > 6 * 1024 * 1024) { nlBubble('ai', '图片超过 6MB，请压缩后再试。'); return; }
      const th = nlThink('正在识别图片…');
      const reader = new FileReader();
      reader.onload = function () {
        AI.vision(reader.result, IMG_PROMPT, { maxTokens: 600 })
          .then(function (txt) {
            th.remove();
            const j = AI.extractJson(txt) || { docType: '其他', desc: String(txt).slice(0, 200) };
            AI.renderImageResult(j, f.name);
          })
          .catch(function (e) {
            th.remove();
            nlBubble('ai', '⚠ 图片识别失败：' + esc(e.message || '网络异常') + '<br>请确认所用模型支持视觉输入（如 gpt-4o-mini、qwen-vl-plus），或在 ⚙ 中单独填写「视觉模型」。');
          })
          .finally(function () { if (typeof nlBusy !== 'undefined') { nlBusy = false; } const b = document.getElementById('nl-send'); if (b) b.disabled = false; });
      };
      reader.readAsDataURL(f);
    };
    inp.click();
  };

  AI.renderImageResult = function (j, filename) {
    const d = nlBubble('ai', '');
    AI.lastImage = j;
    if (j.docType === '其他' || (!j.date && !j.customer && !j.product && !j.qty)) {
      d.innerHTML = '<b>图像理解结果</b><div class="kj-img-desc">' + esc(j.desc || '未识别出单据字段') + '</div>' +
        (filename ? '<div class="kj-img-f">文件：' + esc(filename) + '</div>' : '');
      return;
    }
    const rows = [
      ['单据类型', j.docType], ['日期', j.date], ['单号', j.billNo], ['客户', j.customer],
      ['品名', j.product], ['规格', j.spec], ['数量', j.qty], ['单位', j.unit],
      ['单价', j.price], ['金额', j.amount], ['备注', j.notes]
    ].filter(function (r) { return r[1] !== '' && r[1] !== 0 && r[1] != null; });
    d.innerHTML = '<b>图像识别 · 结构化抽取</b>' +
      '<table class="kj-img-tb">' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<div class="kj-acts"><button onclick="KJ_AI.exportImageCsv()">⬇ 导出 CSV</button>' +
      '<button onclick="KJ_AI.copyImageJson()">📋 复制 JSON</button></div>' +
      '<div class="kj-img-note">识别结果仅供录入参考，写入业务数据前请人工核对。</div>';
    toBottom();
  };

  AI.copyImageJson = function () {
    if (!AI.lastImage) return;
    try { navigator.clipboard.writeText(JSON.stringify(AI.lastImage, null, 2)); nlBubble('ai', 'JSON 已复制。'); } catch (e) {}
  };

  AI.exportImageCsv = function () {
    const j = AI.lastImage; if (!j) return;
    const keys = ['docType', 'date', 'billNo', 'customer', 'product', 'spec', 'qty', 'unit', 'price', 'amount', 'notes', 'desc'];
    const head = keys.join(',');
    const row = keys.map(function (k) { return '"' + String(j[k] == null ? '' : j[k]).replace(/"/g, '""') + '"'; }).join(',');
    const blob = new Blob(['\ufeff' + head + '\r\n' + row], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '单据识别_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  };

  /* ---------------- AI 面板：状态与审计 ---------------- */
  AI.panel = function () {
    const c = AI.cfg();
    const s = AI.GUARD.auditSummary();
    const rag = (function () { AI.RAG.build(); return AI.RAG.stats(); })();
    const html = [
      '<div class="kj-ai-panel">',
      '<div class="kj-row"><span>运行模式</span><b>' + (AI.ready() ? 'AI Agent（在线）' : '本地规则引擎（离线）') + '</b></div>',
      '<div class="kj-row"><span>模型</span><b>' + esc(c.model || '-') + '</b></div>',
      '<div class="kj-row"><span>密钥来源</span><b>' + (c.fromEnv ? '环境变量 KJ_ENV' : (c.key ? '本机 localStorage' : '未配置')) + '</b></div>',
      '<div class="kj-row"><span>RAG 语料</span><b>' + rag.docs + ' 篇（知识库 / 客户 / 品名 / 月度）· ' + rag.terms + ' 词项</b></div>',
      '<div class="kj-row"><span>工具</span><b>' + AI.TOOLS.list().map(function (t) { return t.name; }).join('、') + '</b></div>',
      '<div class="kj-row"><span>调用统计</span><b>' + s.requests + ' 次 · 重试 ' + s.retries + ' · 失败 ' + s.errors + ' · tokens ' + (s.promptTokens + s.completionTokens) + '</b></div>',
      '<details><summary>安全审计日志（' + AI.audit.length + ' 条）</summary><pre class="kj-audit">' +
        esc(AI.audit.slice(-20).map(function (x) { return x.t.slice(11, 19) + ' ' + x.type + ' ' + x.detail; }).join('\n')) +
      '</pre></details>',
      '<div class="kj-row2"><button onclick="KJ_AI.panel()">刷新</button><button onclick="nlLlmUI()">配置密钥</button></div>',
      '</div>'
    ].join('');
    nlBubble('ai', html);
  };
})();
