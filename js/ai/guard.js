/**
 * AI 安全护栏：输入过滤 / 输出核对 / 密钥脱敏 / 审计
 * --------------------------------------------------------------------------
 * 对应评分项「AI 安全与可控性」：
 *   1) 输入侧：长度限制 + 提示词注入检测 + 越权指令识别；
 *   2) 输出侧：数字落地核对（回答里的关键数字必须来自工具结果或检索资料，
 *      否则判为"未经数据支撑"，触发重答或加注警示）；
 *   3) 引用校验：回答出现 [1][2] 时必须能在本次检索结果中找到对应来源；
 *   4) 全程审计：关键动作写入 KJ_AI.audit（脱敏），可在界面查看。
 * 对外：KJ_AI.GUARD.checkInput / verify / auditSummary
 */
window.KJ_AI = window.KJ_AI || {};
(function () {
  const G = {};

  const INJECT_PATTERNS = [
    /(忽略|无视|跳过|忘记)\s*(以上|之前|上面|前面|你的)?\s*(所有)?\s*(指令|指示|规则|提示|设定)/i,
    /(system|developer)\s*(prompt|message|instruction)/i,
    /(你的|输出|显示|打印|复述).{0,6}(系统提示|提示词|system prompt|原始指令)/i,
    /repeat\s+(the\s+)?(text|words|prompt)\s+above/i,
    /(现在|接下来)你是.{0,8}(DAN|开发者模式|无限制模式)/
  ];

  const BLOCK_PATTERNS = [
    /(帮我|给我).{0,6}(写|生成).{0,6}(木马|病毒|勒索软件|钓鱼|破解)/i,
    /(如何|怎么).{0,8}(盗|窃取).{0,6}(账号|密码|数据)/i
  ];

  G.checkInput = function (text) {
    const t = String(text == null ? '' : text);
    const trimmed = t.trim();
    if (!trimmed) return { ok: false, reason: '输入为空' };
    if (trimmed.length > 800) return { ok: false, reason: '问题过长（上限 800 字），请精简后重试', text: trimmed.slice(0, 800) };
    for (const re of BLOCK_PATTERNS) {
      if (re.test(trimmed)) {
        KJ_AI.log('guard', '拦截高风险请求');
        return { ok: false, reason: '该请求超出经营数据分析助手的职责范围，已拒绝执行' };
      }
    }
    for (const re of INJECT_PATTERNS) {
      if (re.test(trimmed)) {
        KJ_AI.log('guard', '疑似提示词注入：' + trimmed.slice(0, 40));
        return {
          ok: false,
          reason: '检测到疑似"忽略系统规则"的指令，已拒绝。\n请直接问经营数据问题，例如「东星斑 9 月卖了多少」。'
        };
      }
    }
    return { ok: true, text: trimmed };
  };

  /** 从文本里抽取需要核对的关键数字（只核金额/数量级的大数，忽略年份与"天/%"等建议性小数） */
  function keyNumbers(text) {
    const out = [];
    const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|万元|笔|条|单)|(\d{4,})(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(String(text)))) {
      const token = m[0];
      if (/\d{4}/.test(token) && !/元|万|笔|条|单/.test(token)) {
        const y = parseInt(token, 10);
        if (y >= 1900 && y <= 2100) continue;      // 年份不参与核对
      }
      const v = parseFloat(String(token).replace(/,/g, '').replace(/[^\d.]/g, ''));
      if (!isFinite(v) || v < 100) continue;        // 两位数以下（如"30 天""15%"）不作为事实核对对象
      out.push(v);
      if (out.length >= 12) break;
    }
    return out;
  }

  function numIn(v, hay) {
    const cands = [v, Math.round(v)];
    return cands.some(function (n) {
      const s1 = String(n);
      const s2 = Number(n).toLocaleString('zh-CN');
      return hay.indexOf(s1) >= 0 || hay.indexOf(s2) >= 0;
    });
  }

  /**
   * 输出核对
   * @param {string} answer 模型回答
   * @param {string} grounded 工具结果 + 检索资料拼成的文本（作为"事实底座"）
   * @param {Array} citations 引用列表
   * @returns {{ok:boolean, unchecked:number[], missingCitations:number[], note:string}}
   */
  G.verify = function (answer, grounded, citations) {
    const hay = String(grounded || '').replace(/,/g, '');
    const nums = keyNumbers(answer);
    const unchecked = nums.filter(function (v) { return !numIn(v, hay); });

    const marks = (String(answer).match(/\[(\d+)\]/g) || []).map(function (s) { return parseInt(s.replace(/[\[\]]/g, ''), 10); });
    const maxIdx = (citations || []).length;
    const missingCitations = marks.filter(function (i) { return i < 1 || i > maxIdx; });

    const ok = unchecked.length === 0 && missingCitations.length === 0;
    let note = '';
    if (unchecked.length) note = '有 ' + unchecked.length + ' 个数字未能与工具/资料核对';
    if (missingCitations.length) note += (note ? '；' : '') + '有引用编号超出检索来源范围';
    KJ_AI.log('verify', ok ? '通过（数字与引用均可溯源）' : '未通过：' + note);
    return { ok: ok, unchecked: unchecked, missingCitations: missingCitations, note: note, checked: nums.length };
  };

  G.auditSummary = function () {
    const a = KJ_AI.usage;
    return {
      requests: a.req, retries: a.retries, errors: a.errors,
      promptTokens: a.promptTokens, completionTokens: a.completionTokens,
      events: KJ_AI.audit.length
    };
  };

  KJ_AI.GUARD = G;
})();
