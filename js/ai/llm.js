/**
 * AI 基础层：大模型客户端
 * --------------------------------------------------------------------------
 * 职责：统一封装 OpenAI 兼容接口的对话 / 流式 / 视觉 / 语音转写调用，并处理
 *       超时、重试、错误分类、用量统计与日志脱敏，供 agent / tools / 界面层复用。
 * 配置来源（优先级从高到低）：
 *   1) window.KJ_ENV（构建期由 .env 生成，部署用，不入库）
 *   2) localStorage.kj_llm_cfg（本机临时填写，兼容旧版配置面板）
 * 对外：KJ_AI.ready() / cfg() / chat() / vision() / transcribe() / mask() / usage
 * 约束：不把密钥写进日志；所有网络请求均带超时与中断控制。
 */
window.KJ_AI = window.KJ_AI || {};
(function () {
  const AI = window.KJ_AI;
  const DEF_BASE = 'https://api.deepseek.com/v1';
  const DEF_MODEL = 'deepseek-chat';

  function lsCfg() {
    try { return JSON.parse(localStorage.getItem('kj_llm_cfg') || 'null') || {}; } catch (e) { return {}; }
  }

  AI.cfg = function () {
    const env = window.KJ_ENV || {};
    const ls = lsCfg();
    const base = (env.LLM_BASE_URL || ls.base || DEF_BASE).replace(/\/+$/, '');
    const key = env.LLM_API_KEY || ls.key || '';
    const model = env.LLM_MODEL || ls.model || DEF_MODEL;
    const asr = env.LLM_ASR_MODEL || ls.asr || 'whisper-1';
    const vision = env.LLM_VISION_MODEL || ls.vision || model;
    // 环境变量里给了 key 就以环境变量为准（部署配置优先）；否则看本机开关
    const on = !!(key && base) && (env.LLM_API_KEY ? true : ls.on !== false);
    return { base: base, key: key, model: model, asr: asr, vision: vision, on: on, fromEnv: !!env.LLM_API_KEY };
  };

  AI.ready = function () { const c = AI.cfg(); return !!(c.on && c.base && c.key); };

  AI.mask = function (v) {
    if (!v) return '(空)';
    const s = String(v);
    return s.length <= 6 ? s[0] + '***' : s.slice(0, 3) + '***' + s.slice(-2) + '（长度 ' + s.length + '）';
  };

  AI.usage = { req: 0, promptTokens: 0, completionTokens: 0, retries: 0, errors: 0 };
  AI.audit = [];                       // 审计日志（脱敏），供界面「安全审计」面板查看
  AI.log = function (type, detail) {
    AI.audit.push({ t: new Date().toISOString(), type: type, detail: detail });
    if (AI.audit.length > 80) AI.audit.shift();
  };

  function errText(status) {
    if (status === 401 || status === 403) return '密钥无效或无权限（HTTP ' + status + '）';
    if (status === 404) return '接口地址或模型名不存在（HTTP 404）';
    if (status === 429) return '请求过于频繁或额度用尽（HTTP 429）';
    if (status >= 500) return '模型服务端异常（HTTP ' + status + '）';
    return 'HTTP ' + status;
  }

  /**
   * 对话补全
   * @param {Array} messages OpenAI 格式消息
   * @param {Object} opt {tools, toolChoice, temperature, maxTokens, stream, timeout, retries}
   * @returns {Promise<{content:string, toolCalls:Array, finish:string, usage:Object}>}
   */
  AI.chat = async function (messages, opt) {
    opt = opt || {};
    const c = AI.cfg();
    if (!c.base || !c.key) throw new Error('未配置大模型（缺少 API 地址或密钥）');
    const body = {
      model: opt.model || c.model,
      messages: messages,
      temperature: opt.temperature === undefined ? 0.3 : opt.temperature,
      max_tokens: opt.maxTokens || 800
    };
    if (opt.tools && opt.tools.length) { body.tools = opt.tools; body.tool_choice = opt.toolChoice || 'auto'; }
    const url = c.base + '/chat/completions';
    const retries = opt.retries === undefined ? 1 : opt.retries;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, opt.timeout || 45000);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!resp.ok) { lastErr = new Error(errText(resp.status)); lastErr.status = resp.status; throw lastErr; }
        const j = await resp.json();
        AI.usage.req++;
        if (j.usage) {
          AI.usage.promptTokens += j.usage.prompt_tokens || 0;
          AI.usage.completionTokens += j.usage.completion_tokens || 0;
        }
        const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
        AI.log('llm', c.model + ' · ' + (msg.tool_calls ? 'tool_calls×' + msg.tool_calls.length : 'answer'));
        return {
          content: msg.content || '',
          toolCalls: msg.tool_calls || [],
          finish: (j.choices && j.choices[0] && j.choices[0].finish_reason) || '',
          usage: j.usage || null
        };
      } catch (e) {
        clearTimeout(timer);
        const isAbort = e && e.name === 'AbortError';
        const retryable = isAbort || e.status === 429 || e.status >= 500 || !e.status;
        if (attempt < retries && retryable) {
          AI.usage.retries++;
          AI.log('retry', (isAbort ? '超时' : e.message) + ' · 第 ' + (attempt + 2) + ' 次尝试');
          await new Promise(function (r) { setTimeout(r, 700 * (attempt + 1)); });
          continue;
        }
        AI.usage.errors++;
        AI.log('error', isAbort ? '请求超时（' + ((opt.timeout || 45000) / 1000) + 's）' : (e.message || '网络异常'));
        throw isAbort ? new Error('请求超时，请稍后重试') : e;
      }
    }
    throw lastErr || new Error('调用失败');
  };

  /** 视觉理解：把图片（dataURL）交给支持视觉的模型 */
  AI.vision = async function (dataUrl, promptText, opt) {
    opt = opt || {};
    const c = AI.cfg();
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }];
    const r = await AI.chat(messages, Object.assign({ model: opt.model || c.vision, maxTokens: 900 }, opt));
    return r.content;
  };

  /** 语音转写（Whisper 兼容），返回文本 */
  AI.transcribe = async function (blob, opt) {
    opt = opt || {};
    const c = AI.cfg();
    if (!c.base || !c.key) throw new Error('未配置大模型');
    const fd = new FormData();
    fd.append('file', blob, 'voice.webm');
    fd.append('model', opt.model || c.asr);
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 60000);
    try {
      const resp = await fetch(c.base + '/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + c.key }, body: fd, signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(errText(resp.status));
      const j = await resp.json();
      AI.log('asr', '转写 ' + ((j.text || '').length) + ' 字');
      return j.text || '';
    } catch (e) { clearTimeout(timer); throw e; }
  };

  /** 解析模型返回的 JSON（容忍 ```json 包裹与前后噪声） */
  AI.extractJson = function (text) {
    if (!text) return null;
    let s = String(text).trim().replace(/```json\s*/i, '').replace(/```\s*/g, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch (e) { return null; }
  };
})();
