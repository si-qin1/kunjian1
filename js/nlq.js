/**
 * 对话式数据分析智能体「秦思智能体」
 * --------------------------------------------------------------------------
 * 面板 DOM 在 index.html 末尾，本模块是全部引擎逻辑。设计目标：
 * 让不熟悉筛选器和报表的人用一句话拿到答案——意图识别是规则模板 +
 * 中文同义词 + 正则槽位填充（不调任何外部大模型接口，保持零依赖），
 * 时间词全部锚定数据集最大日期而非系统时钟，避免演示数据错位。
 *
 * 支持的意图：问候 / 帮助 / 数据体检 / 订单计数 / 均值客单价 / 星期规律 /
 * 环比对比 / 畅销品排行 / 大客户排行 / 品名查询 / 客户查询 / 趋势图表
 * （对话内嵌 Canvas 折线 / 柱状 / 环形，2x 高分屏适配）/ 预测播报。
 * 实体匹配：品名直接命中；客户名去掉“有限公司 / 供应链 / 贸易”等后缀
 * 后做包含匹配（nlCoreName）。回答附带跳转按钮，一键直达对应功能页。
 */

/* ========================================================================
 * 鲲鉴问答 —— 对话式数据分析引擎（纯前端本地实现，零外部依赖）
 * ------------------------------------------------------------------------
 * 目标：让不熟悉图表配置的人，用一句话完成数据查询、统计与可视化，
 *   把「点菜单 → 选筛选 → 找报表」的操作链压缩成一次自然语言提问。
 * 技术路线：AI 双引擎 —— 其一为本地意图识别（规则模板 + 中文同义词 +
 *   正则槽位填充），13 类高频意图零延迟秒答、离线可用；其二为大模型 API
 *   增强层（OpenAI 兼容协议），未命中意图自动路由 LLM 深度作答，并把本地
 *   真实经营数据摘要注入系统提示词，让 AI 回答有据可依。零配置时纯本地
 *   运行，配置后即成「AI 核心体验」，两者无缝衔接。
 * 两个开发中踩过的坑，这里直接做进了设计：
 *   ① 时间解析一律锚定【数据集自身最大日期】，绝不用系统时钟——
 *      否则演示数据停在 2025-09 时，"查上个月"会查到一个空的未来月份；
 *   ② 客户全名带公司后缀，直接 includes 匹配不到"衍洲"这种口语称呼，
 *      所以先剥壳取核心词再做双向匹配。
 * 能力面：品名/客户销量查询、TOP 排行、环比对比、星期节律、均值统计、
 *   记录数统计、预测结果解读（联动七模型训练结果）、对话内嵌图表
 *   （折线 / 条形 / 环形，Canvas 手绘、2x 清晰度）、一键跳转对应模块。
 * ======================================================================== */
const NL_NAME = '秦思智能体';
let nlOpen = false, nlBusy = false, nlWelcomed = false;
let nlVoiceMode = '', nlChunks = [], nlRecorder = null;   // 语音通道状态：native 原生 / speech 浏览器 / rec AI转写
const $nlBody = () => document.getElementById('nl-body');

function nlToggle() {
  nlOpen = !nlOpen;
  document.getElementById('nl-panel').classList.toggle('hidden', !nlOpen);
  // 展开时小鱼让位（面板不再压住数据）；收起后变回一条可爱小鱼，几乎不占地方
  document.getElementById('nl-fab').style.display = nlOpen ? 'none' : 'flex';
  if (nlOpen && !nlWelcomed) { nlWelcome(); nlWelcomed = true; }
  if (nlOpen) setTimeout(() => document.getElementById('nl-input').focus(), 80);
}
function nlShowFab(show) { document.getElementById('nl-fab').style.display = show ? 'flex' : 'none'; }

function nlThink(label) {   // “正在查询”占位气泡，回答生成后由 nlSendBtn 移除
  const d = document.createElement('div');
  d.className = 'nl-msg ai';
  d.innerHTML = '<span class="nl-think"><i></i><i></i><i></i></span> ' + (label || '正在查询数据…');
  $nlBody().appendChild(d);
  $nlBody().scrollTop = $nlBody().scrollHeight;
  return d;
}

/* ---------- 语音输入：优先原生桥（APK），其次 Web Speech（浏览器） ---------- */
const NL_PH = '例如：东星斑 9 月卖了多少？';
let nlVoiceOn = false, nlVoiceNative = false, nlRec = null;
function nlVoiceBtn(on) { const b = document.getElementById('nl-mic'); if (b) b.classList.toggle('on', on); }
function nlVoiceToggle() { nlVoiceOn ? nlVoiceStop() : nlVoiceStart(); }
function nlVoiceStart() {
  const inp = document.getElementById('nl-input');
  try {
    /* 通道优先级：App 原生识别 → 浏览器识别 → AI 转录（国内可用兜底） */
    if (window.AndroidBridge && typeof window.AndroidBridge.startVoice === 'function' && nlVoiceMode !== 'rec') {
      nlVoiceNative = true; nlVoiceOn = true; nlVoiceMode = 'native'; nlVoiceBtn(true);
      inp.placeholder = '请说话…（说完自动发送）';
      window.AndroidBridge.startVoice();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && nlVoiceMode !== 'rec') { nlStartSpeech(SR, inp); return; }
    if (nlLlmReady()) { nlStartRecord(inp); return; }
    nlBubble('ai', '这个环境暂不支持语音输入 🎤。<br>两种解法：① 在 Chrome / Edge 或 App 内使用；② 点右上角 ⚙ 配置大模型 API（如 DeepSeek / 硅基流动）后，即可用 <b>AI 语音转写</b> 通道——录音经 Whisper 转写成文字，国内可直连。');
  } catch (e) {
    nlVoiceStop();
    nlBubble('ai', '语音启动失败：' + e.message);
  }
}
function nlStartSpeech(SR, inp) {
  nlVoiceMode = 'speech';
  nlRec = new SR();
  nlRec.lang = 'zh-CN';
  nlRec.interimResults = true;   // 边说边显
  nlRec.continuous = false;      // 一句话结束即返回
  nlRec.onresult = e => {
    let t = '';
    for (const r of e.results) t += r[0].transcript;
    inp.value = t;
    if (e.results[e.results.length - 1].isFinal) { nlVoiceStop(); if (t.trim()) nlSendBtn(); }
  };
  nlRec.onerror = e => {
    nlVoiceStop();
    const err = e.error || '';
    if (err === 'network' || err === 'service-not-allowed') {
      /* 国内网络访问不到浏览器内置语音服务：给出提示并优选 AI 转写通道 */
      nlVoiceMode = nlLlmReady() ? 'rec' : '';
      nlBubble('ai', nlLlmReady()
        ? '当前网络无法使用浏览器内置语音服务（它需访问境外识别服务），已为你切到 <b>AI 语音转写</b> 通道 👉 再点一次 🎤 开始录音，说完再点一次结束，语音会自动转成文字并发送。'
        : '当前网络无法使用浏览器内置语音服务 🎤。<br>点右上角 ⚙ 配置大模型 API（DeepSeek / 硅基流动等）后，即可启用 <b>AI 语音转写</b> 通道，国内可直连；文字输入不受影响。');
    } else if (err === 'not-allowed' || err === 'service-not-allowed')
      nlBubble('ai', '麦克风权限被拒绝 🎤 请在浏览器地址栏允许使用麦克风后重试。');
    else if (err === 'no-speech')
      nlBubble('ai', '没听清，再试一次？点 🎤 后靠近一点说话。');
    else
      nlBubble('ai', '语音识别出错（' + err + '），可改用文字输入，或在 ⚙ 中配置大模型 API 使用 AI 语音转写。');
  };
  nlRec.onend = () => { if (nlVoiceOn) nlVoiceStop(); };
  nlRec.start();
  nlVoiceOn = true; nlVoiceBtn(true);
  inp.placeholder = '正在聆听，请说话…（说完自动发送）';
}
/* AI 语音转写通道：录音 → POST /audio/transcriptions（Whisper 兼容）→ 自动发送 */
function nlStartRecord(inp) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    nlBubble('ai', '当前环境不支持录音 🎤（需 HTTPS 页面或 App 内使用）。');
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    nlChunks = [];
    let mime = '';
    try { if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus'; } catch (e) {}
    nlRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    nlRecorder.ondataavailable = ev => { if (ev.data && ev.data.size) nlChunks.push(ev.data); };
    nlRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(nlChunks, { type: 'audio/webm' });
      if (!blob.size) { nlBubble('ai', '没有录到声音，再试一次？'); return; }
      nlTranscribe(blob);
    };
    nlRecorder.start();
    nlVoiceMode = 'rec'; nlVoiceOn = true; nlVoiceBtn(true);
    inp.placeholder = '正在录音…（再点一次 🎤 结束并转写）';
  }).catch(e => {
    nlVoiceStop();
    nlBubble('ai', '麦克风不可用：' + (e && e.name === 'NotAllowedError' ? '请允许使用麦克风后重试。' : (e.message || e.name)));
  });
}
async function nlTranscribe(blob) {
  const c = nlLlmCfg(), inp = document.getElementById('nl-input');
  const tip = nlBubble('ai', '正在把录音转写成文字…');
  try {
    const fd = new FormData();
    fd.append('file', blob, 'voice.webm');
    fd.append('model', (c && c.asr) || 'whisper-1');
    const resp = await fetch(c.base.replace(/\/+\s*$/, '') + '/audio/transcriptions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + c.key }, body: fd });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    const t = (j && (j.text || (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content))) || '';
    if (!t.trim()) throw new Error('转写结果为空');
    tip.remove();
    inp.value = t.trim();
    nlBubble('me', '🎤 ' + t.trim().replace(/</g, '&lt;'));
    nlSendBtn();
  } catch (e) {
    tip.remove();
    nlBubble('ai', '语音转写失败：' + (e.message || '网络异常') + '。<br>请在 ⚙ 中确认「转写模型」名称（whisper-1，或硅基流动的 FunAudioLLM/SenseVoiceSmall），并确认网络可访问该 API。');
  }
}
function nlVoiceStop() {
  nlVoiceOn = false; nlVoiceBtn(false);
  document.getElementById('nl-input').placeholder = NL_PH;
  try {
    if (nlVoiceNative) { if (window.AndroidBridge && window.AndroidBridge.stopVoice) window.AndroidBridge.stopVoice(); }
    else if (nlRec) nlRec.stop();
    else if (nlRecorder && nlRecorder.state !== 'inactive') nlRecorder.stop();
  } catch (e) { /* 停止失败不影响交互 */ }
  nlRec = null; nlVoiceNative = false;
}
/* APK 原生识别回调（MainActivity 经 evaluateJavascript 调入） */
window.__nlVoicePartial = t => { if (nlVoiceOn) document.getElementById('nl-input').value = t; };
window.__nlVoiceFinal = t => { document.getElementById('nl-input').value = t; nlVoiceStop(); if (t && t.trim()) nlSendBtn(); };
window.__nlVoiceError = m => {
  nlVoiceStop();
  if (nlLlmReady()) {
    nlVoiceMode = 'rec';
    nlBubble('ai', (m || '本机语音识别不可用') + '<br>已为你切到 <b>AI 语音转写</b> 通道 👉 再点一次 🎤 开始录音，说完再点一次结束。');
  } else {
    nlBubble('ai', (m || '本机语音识别不可用') + '<br>点右上角 ⚙ 配置大模型 API 后，可启用「AI 语音转写」通道。');
  }
};

function nlBubble(role, html) {
  const d = document.createElement('div');
  d.className = 'nl-msg ' + role;
  d.innerHTML = html;
  $nlBody().appendChild(d);
  $nlBody().scrollTop = $nlBody().scrollHeight;
  return d;
}
function nlActions(host, actions) {
  const box = document.createElement('div');
  box.className = 'nl-actions';
  actions.forEach(a => {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.onclick = () => { try { switchTab(a.tab); nlToggle(); } catch (e) {} };
    box.appendChild(b);
  });
  host.appendChild(box);
  $nlBody().scrollTop = $nlBody().scrollHeight;
}

/* ---------- 时间解析：全部锚定数据集最大日期 ---------- */
function nlDataBounds() {
  const ds = [...new Set(db.records.map(r => r.date).filter(Boolean))].sort();
  if (!ds.length) return null;
  return { first: new Date(ds[0] + 'T00:00:00Z'), last: new Date(ds[ds.length - 1] + 'T00:00:00Z') };
}
function nlMonthStr(d) { return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1); } // 带「YYYY-M月」交给 nlParseTime，避免跨年锚错
function nlParseTime(text) {
  const B = nlDataBounds(); if (!B) return null;
  const Y = B.last.getUTCFullYear();
  let m;
  if ((m = text.match(/最近\s*(\d+)\s*天|近\s*(\d+)\s*天/))) {
    const n = Math.min(365, +(m[1] || m[2]));
    const start = new Date(B.last); start.setUTCDate(start.getUTCDate() - n + 1);
    return { label: '最近 ' + n + ' 天', start: start.toISOString().slice(0, 10), end: B.last.toISOString().slice(0, 10), days: n };
  }
  if (/最近\s*一?周|近一周|最近\s*7\s*天/.test(text)) return nlParseTime('最近7天');
  const mk = (d, tag) => {
    const ms = d.toISOString().slice(0, 7);
    return { label: ms.replace('-', ' 年 ') + ' 月' + (tag || ''), start: ms + '-01', end: ms + '-31', month: ms };
  };
  if (/上个月|上月/.test(text)) { const d = new Date(B.last); d.setUTCMonth(d.getUTCMonth() - 1); return mk(d); }
  if (/本月|这个月|当月/.test(text)) return mk(B.last);
  if ((m = text.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*月?/))) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, 1)); return mk(d);
  }
  if ((m = text.match(/(\d{1,2})\s*月/))) {
    const d = new Date(Date.UTC(Y, +m[1] - 1, 1)); return mk(d);
  }
  return null;
}

/* ---------- 实体匹配 ---------- */
function nlCoreName(name) {
  return name.replace(/（[^）]*）|\([^)]*\)|有限公司|股份|供应链|海产贸易|商贸|贸易|实业/g, '').trim();
}
function nlFindProduct(text) {
  const ps = [...new Set(db.records.map(r => r.product).filter(Boolean))];
  return ps.find(p => text.includes(p)) || null;
}
function nlFindCustomer(text) {
  const cs = [...new Set(db.records.map(r => r.customer).filter(Boolean))];
  for (const c of cs) {
    const core = nlCoreName(c);
    if (core && core.length >= 2 && (text.includes(core) || text.includes(c))) return c;
  }
  return null;
}

/* ---------- 数据聚合 ---------- */
function nlFilter(range, prod, cust) {
  return db.records.filter(r =>
    (!prod || r.product === prod) && (!cust || r.customer === cust) &&
    (!range || (r.date >= range.start && r.date <= range.end)));
}
function nlAmt(r) { return (r.qty || 0) * (r.price || 0); }
function nlSum(recs) { return recs.reduce((s, r) => s + nlAmt(r), 0); }
function nlSeries(recs, range) {
  if (!range) {
    const B = nlDataBounds(); if (!B) return [];
    range = { start: B.first.toISOString().slice(0, 10), end: B.last.toISOString().slice(0, 10) };
  }
  const map = {};
  recs.forEach(r => { if (r.date) map[r.date] = (map[r.date] || 0) + nlAmt(r); });
  const out = [];
  const d = new Date(range.start + 'T00:00:00Z'), end = new Date(range.end + 'T00:00:00Z');
  let guard = 0;
  while (d <= end && guard++ < 800) {
    const ds = d.toISOString().slice(0, 10);
    out.push({ date: ds, v: map[ds] || 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ---------- 对话内嵌图表（Canvas 手绘，2x 清晰度） ---------- */
function nlDrawCv(cv, cfg) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = 330;
  const H = cfg.type === 'bar' ? Math.max(96, cfg.values.length * 26 + 26) : 150;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const vals = cfg.values, n = vals.length;
  if (cfg.type === 'line') {
    const mx = Math.max(...vals, 1), pad = { l: 8, r: 8, t: 12, b: 18 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    ctx.strokeStyle = '#e8eef4'; ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ih); ctx.lineTo(W - pad.r, pad.t + ih); ctx.stroke();
    const pts = vals.map((v, i) => [pad.l + i / Math.max(n - 1, 1) * iw, pad.t + ih - v / mx * (ih - 6)]);
    const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    g.addColorStop(0, 'rgba(13,148,136,.22)'); g.addColorStop(1, 'rgba(13,148,136,0)');
    ctx.beginPath(); ctx.moveTo(pts[0][0], pad.t + ih);
    pts.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(pts[pts.length - 1][0], pad.t + ih); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    const lp = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(lp[0], lp[1], 3.2, 0, 7); ctx.fillStyle = '#0284c7'; ctx.fill();
    ctx.fillStyle = '#475569'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    const step = Math.ceil(n / 6);
    for (let i = 0; i < n; i += step) ctx.fillText(cfg.labels[i].slice(5), pts[i][0], H - 5);
    return;
  }
  if (cfg.type === 'bar') {
    const mx = Math.max(...vals, 1);
    const labelW = Math.min(96, Math.max(...cfg.labels.map(l => l.length)) * 11 + 10);
    vals.forEach((v, i) => {
      const rowH = (H - 14) / Math.max(n, 1);
      const y = 7 + i * rowH, bh = Math.min(16, rowH - 6);
      ctx.fillStyle = '#334155'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      const nm = cfg.labels[i].length > 8 ? cfg.labels[i].slice(0, 8) + '…' : cfg.labels[i];
      ctx.fillText(nm, labelW - 5, y + bh / 2 + 3.5);
      const bw = (W - labelW - 48) * (v / mx);
      const x0 = labelW, w0 = Math.max(bw, 2), r2 = Math.min(4, bh / 2);
      if (i === 0) {
        const g = ctx.createLinearGradient(x0, 0, x0 + w0, 0);
        g.addColorStop(0, '#0d9488'); g.addColorStop(1, '#38bdf8');
        ctx.fillStyle = g;
      } else ctx.fillStyle = '#c8e2e8';
      ctx.beginPath();
      ctx.moveTo(x0 + r2, y); ctx.lineTo(x0 + w0 - r2, y); ctx.quadraticCurveTo(x0 + w0, y, x0 + w0, y + r2);
      ctx.lineTo(x0 + w0, y + bh - r2); ctx.quadraticCurveTo(x0 + w0, y + bh, x0 + w0 - r2, y + bh);
      ctx.lineTo(x0 + r2, y + bh); ctx.quadraticCurveTo(x0, y + bh, x0, y + bh - r2);
      ctx.lineTo(x0, y + r2); ctx.quadraticCurveTo(x0, y, x0 + r2, y); ctx.fill();
      ctx.fillStyle = i === 0 ? '#0f766e' : '#64748b'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(cfg.fmt(v), x0 + w0 + 6, y + bh / 2 + 3.5);
    });
    return;
  }
  if (cfg.type === 'donut') {
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = 62, cy = H / 2, R = 42, r0 = 26;
    const cols = ['#0d9488', '#0284c7', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + v / total * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.arc(cx, cy, r0, a1, a0, true); ctx.closePath();
      ctx.fillStyle = cols[i % cols.length]; ctx.fill();
      a0 = a1;
    });
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(cfg.fmt(total), cx, cy + 3);
    ctx.font = '9px sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.fillText('合计', cx, cy + 15);
    vals.slice(0, 6).forEach((v, i) => {
      const y = 14 + i * 21;
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath(); ctx.arc(122, y, 4, 0, 7); ctx.fill();
      ctx.fillStyle = '#334155'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
      const nm = cfg.labels[i].length > 9 ? cfg.labels[i].slice(0, 9) + '…' : cfg.labels[i];
      ctx.fillText(nm, 132, y + 3.5);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(cfg.fmt(v) + ' · ' + (v / total * 100).toFixed(1) + '%', 210, y + 3.5);
    });
  }
}

/* ---------- 意图引擎：规则模板 + 同义词 + 槽位填充 ---------- */
const NL_HELP = '直接用大白话问我，不用点菜单：<br>· 「东星斑 9 月卖了多少」<br>· 「衍洲海产最近 30 天趋势」<br>· 「卖得最好的品名」「哪位客户贡献最大」<br>· 「9 月比 8 月怎么样」「星期几生意最好」<br>· 「画最近 30 天销量折线图」「预测下周销量」<br>· 「一共多少笔订单」「日均卖多少」<br>🎤 点输入框旁的麦克风，也能直接说话提问。';

function nlIntent(raw) {
  const t = raw.trim();
  if (!t) return null;
  if (/^(你好|您好|hi|hello|嗨|在吗)/i.test(t)) return { name: 'greet' };
  if (/^(谢谢|感谢|辛苦)/.test(t)) return { name: 'thanks' };
  if (/帮助|能做什么|你会什么|怎么用|功能|help/i.test(t) && t.length < 18) return { name: 'help' };
  if (/预测|未来.{0,6}卖|接下来.{0,6}卖|下周|下个月.{0,8}多少/.test(t)) return { name: 'forecast' };
  if (/画|绘|生成.{0,4}图|趋势图|折线|柱状|饼图|看下.{0,8}走势/.test(t)) return { name: 'chart' };
  if (/环比|对比|比较|相比|增长|下降|涨|跌|变化|怎么样/.test(t) && /月|周|天/.test(t)) return { name: 'compare' };
  if (/星期|周[一二三四五六日天]|礼拜/.test(t)) return { name: 'weekday' };
  if (/体检|数据质量|脏数据|异常/.test(t)) return { name: 'check' };
  if (/多少笔|多少条|多少单|多少个订单|订单数|记录数/.test(t)) return { name: 'count' };
  if (/客单价|日均|平均.{0,6}(卖|销|额|价)/.test(t)) return { name: 'avg' };
  const cust = nlFindCustomer(t);
  const prod = nlFindProduct(t);
  if (cust && /买|采购|贡献|花|消费|进了|拿了|卖了/.test(t)) return { name: 'custQuery', cust };
  if (prod && /卖|销|金额|多少|流水|出货/.test(t)) return { name: 'prodQuery', prod };
  if (/畅销|最好卖|卖得最好|销量.{0,4}高|排行|top\s*\d*|冠军|第一|前\d/i.test(t) && !cust) return { name: 'topProd' };
  if (/大客户|客户.{0,4}排行|贡献.{0,4}大|谁.{0,6}最多|哪家|客源/.test(t)) return { name: 'topCust' };
  if (prod) return { name: 'prodQuery', prod };
  if (cust) return { name: 'custQuery', cust };
  return { name: 'fallback' };
}

/* ---------- 回答生成 ---------- */
function nlAnswer(intent, raw) {
  const B = nlDataBounds();
  if (!B) return { text: '库里还没有送货数据。先去「送货明细」录入或导入 Excel，再来问我。', actions: [{ label: '去送货明细', tab: 'records' }] };
  const amtMode = !/数量|多少斤|件数|几斤/.test(raw);
  const unitTxt = amtMode ? '元' : '件';
  const fmtV = v => amtMode
    ? (v >= 10000 ? (v / 10000).toFixed(2) + ' 万' + unitTxt : Math.round(v).toLocaleString() + ' ' + unitTxt)
    : Math.round(v).toLocaleString() + ' ' + unitTxt;
  const pickN = (() => { const m = raw.match(/前\s*(\d+)|top\s*(\d+)/i); return m ? Math.min(10, +(m[1] || m[2])) : 5; })();

  switch (intent.name) {
    case 'greet':
      return { text: '你好，我是' + NL_NAME + ' 🐟。用大白话问我数据就行，比如「东星斑 9 月卖了多少」「卖得最好的品名」。点右上角「收起」我会变成右下角的小鱼，不挡页面。' };
    case 'thanks':
      return { text: '不客气，随时来问 😊' };
    case 'help':
      return { text: NL_HELP };
    case 'check':
      return { text: '数据体检在「数据服务中心」：重复单号、数量/单价异常、缺失字段与日期格式一键质检并给出问题清单。', actions: [{ label: '打开数据服务中心', tab: 'data' }] };
    case 'count': {
      const range = nlParseTime(raw);
      const recs = nlFilter(range, intent.prod, intent.cust);
      return { text: (range ? range.label : '全部数据') + '共有 <b>' + recs.length + '</b> 笔送货记录，累计金额 <b>' + fmtV(nlSum(recs)) + '</b>。', actions: [{ label: '查看送货明细', tab: 'records' }] };
    }
    case 'avg': {
      const range = nlParseTime(raw);
      const recs = nlFilter(range, intent.prod, intent.cust);
      const days = new Set(recs.map(r => r.date)).size || 1;
      return { text: (range ? range.label : '全部数据') + '按有记录日平均，日均销售额 <b>' + fmtV(nlSum(recs) / days) + '</b>（共 ' + days + ' 个有记录日）。' };
    }
    case 'weekday': {
      const dow = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
      db.records.forEach(r => {
        const w = new Date(r.date + 'T00:00:00Z').getUTCDay();
        dow[w] += nlAmt(r); cnt[w]++;
      });
      const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const arr = names.map((nm, i) => ({ nm, avg: cnt[i] ? dow[i] / cnt[i] : 0 })).sort((a, b) => b.avg - a.avg);
      return { text: '全量数据按星期统计，<b>' + arr[0].nm + '</b>平均销售额最高（' + fmtV(arr[0].avg) + '），其次 ' + arr[1].nm + '。建议在' + arr[0].nm + '前一天完成备货与配送调度。',
        chart: { type: 'bar', labels: arr.map(x => x.nm), values: arr.map(x => x.avg), fmt: v => fmtV(v) },
        actions: [{ label: '看销售蜂窝热力', tab: 'data' }] };
    }
    case 'compare': {
      const months = [...raw.matchAll(/(\d{1,2})\s*月/g)].map(m => nlParseTime(m[0])).filter(Boolean);
      let a = months[0], b = months[1];
      if (!a && months.length === 1) a = months[0];
      if (!b) {  // 未给足两个月 → 自动取数据最后两个月
        const B2 = nlDataBounds();
        const d1 = new Date(B2.last), d2 = new Date(B2.last);
        d2.setUTCMonth(d2.getUTCMonth() - 1);
        a = a || nlParseTime(nlMonthStr(d1) + '月'); b = nlParseTime(nlMonthStr(d2) + '月');
      }
      const va = nlSum(nlFilter(a, intent.prod, intent.cust));
      const vb = nlSum(nlFilter(b, intent.prod, intent.cust));
      const pct = vb > 0 ? (va - vb) / vb * 100 : null;
      const dir = pct === null ? '' : (pct >= 0 ? '增长 ' : '下降 ') + Math.abs(pct).toFixed(1) + '%';
      const col = pct !== null && pct < 0 ? '建议结合智能预测排查需求波动、优化进货计划避免积压' : '业务处于上升通道，可按当前节奏适度扩大备货';
      return { text: a.label + '销售额 <b>' + fmtV(va) + '</b>，' + b.label + '为 <b>' + fmtV(vb) + '</b>，' + (dir ? '环比' + dir + '。' : '。') + col,
        actions: [{ label: '看决策驾驶舱', tab: 'report' }, { label: '跑一次预测', tab: 'forecast' }] };
    }
    case 'topProd': {
      const range = nlParseTime(raw);
      const recs = nlFilter(range, intent.prod, intent.cust);
      const map = {};
      recs.forEach(r => { if (r.product) map[r.product] = (map[r.product] || 0) + nlAmt(r); });
      const arr = Object.entries(map).sort((x, y) => y[1] - x[1]).slice(0, pickN);
      if (!arr.length) return { text: '该范围内没有数据。' };
      const total = nlSum(recs) || 1;
      return { text: (range ? range.label : '全部数据') + '销售额 TOP ' + arr.length + ' 品名：<b>' + arr[0][0] + '</b> 以 ' + fmtV(arr[0][1]) + ' 居首，占比 ' + (arr[0][1] / total * 100).toFixed(1) + '%。',
        chart: { type: 'bar', labels: arr.map(x => x[0]), values: arr.map(x => x[1]), fmt: v => fmtV(v) },
        actions: [{ label: '看畅销品棒棒糖图', tab: 'report' }] };
    }
    case 'topCust': {
      const range = nlParseTime(raw);
      const recs = nlFilter(range, intent.prod, intent.cust);
      const map = {};
      recs.forEach(r => { if (r.customer) map[r.customer] = (map[r.customer] || 0) + nlAmt(r); });
      const arr = Object.entries(map).sort((x, y) => y[1] - x[1]).slice(0, pickN);
      if (!arr.length) return { text: '该范围内没有数据。' };
      const total = nlSum(recs) || 1;
      return { text: (range ? range.label : '全部数据') + '客户贡献 TOP ' + arr.length + '：<b>' + nlCoreName(arr[0][0]) + '</b> 以 ' + fmtV(arr[0][1]) + ' 领跑，占总销售额 ' + (arr[0][1] / total * 100).toFixed(1) + '%，是必须重点维护的核心客户。',
        chart: { type: 'donut', labels: arr.map(x => nlCoreName(x[0])), values: arr.map(x => x[1]), fmt: v => fmtV(v) },
        actions: [{ label: '看客户管理中心', tab: 'customers' }] };
    }
    case 'prodQuery': {
      const range = nlParseTime(raw);
      const recs = nlFilter(range, intent.prod, intent.cust);
      const sum = nlSum(recs);
      const qty = recs.reduce((s, r) => s + (r.qty || 0), 0);
      if (!recs.length) return { text: '「' + intent.prod + '」在该时间范围内没有记录。可以试试放宽时间，比如「东星斑最近 30 天卖了多少」。' };
      const ser = nlSeries(recs, range);
      const avgP = recs.reduce((s, r) => s + (r.price || 0), 0) / recs.length;
      return { text: '<b>' + intent.prod + '</b>' + (range ? range.label : '全部数据') + (intent.cust ? '（' + nlCoreName(intent.cust) + '）' : '') +
          '：销售额 <b>' + fmtV(sum) + '</b>' + (amtMode ? '' : '') + '，共 ' + recs.length + ' 笔、' + qty + ' ' + (recs[0].unit || '件') +
          '，平均单价 ' + avgP.toFixed(1) + ' 元。最高单日 ' + fmtV(Math.max(...ser.map(x => x.v))) + '。',
        chart: { type: 'line', labels: ser.map(x => x.date), values: ser.map(x => x.v), fmt: fmtV },
        actions: [{ label: '跑专属预测', tab: 'forecast' }] };
    }
    case 'custQuery': {
      const range = nlParseTime(raw);
      const recs = nlFilter(range, intent.prod, intent.cust);
      if (!recs.length) return { text: nlCoreName(intent.cust) + '在该时间范围内没有采购记录。' };
      const sum = nlSum(recs);
      const pm = {};
      recs.forEach(r => { if (r.product) pm[r.product] = (pm[r.product] || 0) + nlAmt(r); });
      const favs = Object.entries(pm).sort((x, y) => y[1] - x[1]).slice(0, 3);
      const days = new Set(recs.map(r => r.date)).size;
      return { text: '<b>' + nlCoreName(intent.cust) + '</b>' + (range ? range.label : '全部数据') + '：采购 <b>' + fmtV(sum) + '</b>，共 ' + recs.length + ' 笔 / ' + days + ' 个送货日，最常买 <b>' + favs[0][0] + '</b>（' + fmtV(favs[0][1]) + '），其次 ' + favs.slice(1).map(f => f[0]).join('、') + '。',
        chart: { type: 'donut', labels: favs.map(f => f[0]), values: favs.map(f => f[1]), fmt: v => fmtV(v) },
        actions: [{ label: '看客户画像雷达', tab: 'customers' }] };
    }
    case 'chart': {
      const prod = nlFindProduct(raw), cust = nlFindCustomer(raw);
      let range = nlParseTime(raw);
      const isPie = /饼|占比|构成/.test(raw);
      if (isPie) {   // 饼图：品名或客户构成
        const recs = nlFilter(range, null, prod ? null : cust);
        const key = prod ? 'product' : 'customer', label = prod ? intent.prod && '「' + prod + '」的客户构成' : (cust ? nlCoreName(cust) + '的品名构成' : '全量品名构成');
        const map = {};
        recs.forEach(r => { const k = prod ? r.customer : r.product; if (k) map[k] = (map[k] || 0) + nlAmt(r); });
        const arr = Object.entries(map).sort((x, y) => y[1] - x[1]).slice(0, 6);
        if (!arr.length) return { text: '没有可画的数据。' };
        return { text: (range ? range.label : '全部数据') + label + '如下（TOP ' + arr.length + '）：',
          chart: { type: 'donut', labels: arr.map(x => prod ? nlCoreName(x[0]) : x[0]), values: arr.map(x => x[1]), fmt: v => fmtV(v) } };
      }
      if (!range && !/全部|所有/.test(raw)) range = nlParseTime('最近30天');
      const recs = nlFilter(range, prod, cust);
      const ser = nlSeries(recs, range);
      if (!ser.length) return { text: '没有可画的数据。' };
      const who = (prod ? '「' + prod + '」' : cust ? nlCoreName(cust) : '全量') + (range ? ' · ' + range.label : '');
      const sum = nlSum(recs);
      return { text: who + '的销售额走势：区间合计 <b>' + fmtV(sum) + '</b>，日均 ' + fmtV(sum / Math.max(ser.filter(x => x.v > 0).length, 1)) + '（按有记录日）。',
        chart: { type: 'line', labels: ser.map(x => x.date), values: ser.map(x => x.v), fmt: fmtV } };
    }
    case 'forecast': {
      let fr = null;
      try { fr = (typeof fcResult !== 'undefined') ? fcResult : null; } catch (e) {}
      if (fr && fr.best && fr.best.p1) {
        const H2 = fr.best.preds ? fr.best.preds.length : 7;
        const B2 = nlDataBounds();
        const d0 = new Date(B2.last);
        const lines = [];
        for (let i = 0; i < Math.min(3, H2); i++) {
          const d = new Date(d0); d.setUTCDate(d.getUTCDate() + i + 1);
          lines.push(d.toISOString().slice(5).replace('-', '/') + '：' + fmtV(fr.best.preds[i]));
        }
        return { text: '当前已训练 <b>' + fr.models.length + ' 个模型</b>，推荐 <b>' + fr.best.name + '</b>（WAPE ' + fr.best.wape.toFixed(1) + '%）。未来 ' + H2 + ' 天预测：首日 ' + fmtV(fr.best.preds[0]) + '，前几日依次为 ' + lines.join('；') + '。完整走势与置信带见预测页。',
          actions: [{ label: '看预测走势', tab: 'forecast' }, { label: '看归因解释', tab: 'forecast' }] };
      }
      return { text: '预测引擎还没跑。点下面按钮到「智能预测引擎」点击开始预测，七模型约 99 秒训练完成后，我就能直接报给你听了。', actions: [{ label: '去智能预测引擎', tab: 'forecast' }] };
    }
    default: {
      return { text: '这句我还没学会 🤔 换个说法试试，或者点下面的示例：', help: true, fallback: true };
    }
  }
}

/* ---------- 大模型 API 集成（AI 双引擎之二：LLM 增强层） ----------
 * 本地规则引擎负责 13 类高频意图的零延迟秒答；未命中的开放性问题
 * 自动路由到大模型 API（OpenAI 兼容协议，DeepSeek/通义/智谱/GPT 均可），
 * 并把本地数据的真实统计摘要注入系统提示词 —— AI 回答的不是泛泛而谈，
 * 而是结合本店真实经营数字的深度分析。密钥仅存本机 localStorage。 */
function nlLlmCfg() { try { return JSON.parse(localStorage.getItem('kj_llm_cfg') || 'null'); } catch (e) { return null; } }
function nlLlmReady() { const c = nlLlmCfg(); return !!(c && c.on && c.base && c.key); }
function nlLlmSys() {
  const B = nlDataBounds();
  let ctx = '';
  if (B) {
    const recs = db.records, byP = {}, byC = {};
    recs.forEach(r => { byP[r.product] = (byP[r.product] || 0) + nlAmt(r); byC[r.customer] = (byC[r.customer] || 0) + nlAmt(r); });
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => k + ' ' + Math.round(v).toLocaleString() + '元').join('、');
    ctx = '\n\n【真实数据摘要，回答须优先引用】统计区间 ' + B.first.toISOString().slice(0, 10) + ' 至 ' + B.last.toISOString().slice(0, 10) +
      '；共 ' + recs.length + ' 笔送货记录，总销售额 ' + Math.round(nlSum(recs)).toLocaleString() + ' 元；销售额 TOP5 品名：' + top(byP) + '；TOP5 客户：' + top(byC) + '。';
  }
  return '你是中小企业臻品供应链经营平台「鲲鉴智策」内置的对话式数据分析智能体「秦思智能体」。用简洁中文回答经营数据问题，给出具体数字与可执行建议，一次回答不超过 200 字。' + ctx;
}
async function nlAskLlm(q) {
  const c = nlLlmCfg();
  const resp = await fetch(c.base.replace(/\/+\s*$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
    body: JSON.stringify({ model: c.model || 'gpt-4o-mini', temperature: 0.4,
      messages: [{ role: 'system', content: nlLlmSys() }, { role: 'user', content: q }] })
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const j = await resp.json();
  const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!t) throw new Error('返回格式异常');
  return t;
}
function nlLlmUI() {
  const box = document.getElementById('nl-llm'), c = nlLlmCfg() || {};
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  document.getElementById('nl-llm-base').value = c.base || '';
  document.getElementById('nl-llm-key').value = c.key || '';
  document.getElementById('nl-llm-model').value = c.model || '';
  document.getElementById('nl-llm-asr').value = c.asr || '';
  if (document.getElementById('nl-llm-vision')) document.getElementById('nl-llm-vision').value = c.vision || '';
  document.getElementById('nl-llm-on').checked = !!c.on;
  document.getElementById('nl-llm-msg').textContent = '';
  box.classList.remove('hidden');
}
function nlLlmSave(showMsg) {
  const cfg = { base: document.getElementById('nl-llm-base').value.trim(),
    key: document.getElementById('nl-llm-key').value.trim(),
    model: document.getElementById('nl-llm-model').value.trim(),
    asr: document.getElementById('nl-llm-asr').value.trim(),
    vision: (document.getElementById('nl-llm-vision') || {}).value ? document.getElementById('nl-llm-vision').value.trim() : '',
    on: document.getElementById('nl-llm-on').checked };
  localStorage.setItem('kj_llm_cfg', JSON.stringify(cfg));
  const m = document.getElementById('nl-llm-msg');
  if (showMsg) m.textContent = '✓ 已保存' + (cfg.on && (!cfg.base || !cfg.key) ? '（开启 AI 增强还需填写地址与密钥）' : cfg.on && cfg.base && cfg.key ? '，AI 增强已开启' : '');
  return cfg;
}
async function nlLlmTest() {
  const cfg = nlLlmSave(false), m = document.getElementById('nl-llm-msg');
  m.textContent = '测试中…';
  try {
    const resp = await fetch(cfg.base.replace(/\/+\s*$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', max_tokens: 8,
        messages: [{ role: 'user', content: '请回复：连接成功' }] }) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    await resp.json();
    m.textContent = '✓ 连接成功，AI 增强可用';
  } catch (e) { m.textContent = '✗ 连接失败：' + e.message + '（请检查地址/密钥/网络或跨域限制）'; }
}

/* ---------- 交互流程 ---------- */
const NL_CHIPS = ['卖得最好的品名', '东星斑 9 月卖了多少', '衍洲海产最近 30 天趋势', '9 月比 8 月怎么样', '星期几生意最好', '预测下周销量', '一共多少笔订单'];
function nlWelcome() {
  nlBubble('ai', '你好，我是<b>' + NL_NAME + '</b> 🐟 —— 对话式数据分析智能体。<br>本地引擎秒答 13 类高频问题：查数据、看趋势、出图表，🎤 也能语音提问；点右上角 ⚙ 接入大模型 API（DeepSeek / 通义 / 智谱 / GPT 均可），开放性经营问题由 AI 结合本店真实数据深度作答。' + NL_HELP);
  nlRenderChips();
}
function nlRenderChips(list) {
  const box = document.getElementById('nl-chips');
  box.innerHTML = '';
  (list || NL_CHIPS).forEach(c => {
    const b = document.createElement('button');
    b.textContent = c;
    b.onclick = () => { document.getElementById('nl-input').value = c; nlSendBtn(); };
    box.appendChild(b);
  });
}
function nlSendBtn() {
  const inp = document.getElementById('nl-input');
  const text = inp.value.trim();
  if (!text || nlBusy) return;
  inp.value = '';
  nlBubble('me', text.replace(/</g, '&lt;'));
  nlBusy = true;
  document.getElementById('nl-send').disabled = true;
  const th = nlThink();
  setTimeout(() => {
    try {
      th.remove();
      let intent = null;
      try { intent = nlIntent(text); } catch (e) { intent = { name: 'fallback' }; }
      let ans;
      try { ans = nlAnswer(intent, text); } catch (e) { ans = { text: '查询出错了：' + e.message }; }
      /* AI 增强：本地意图未命中且已配置大模型 → 交给 Agent 工作流
       * （规划 → 工具调用 → 观察 → 作答 → 数字与引用核对），
       *  失败或未配置时仍回到本地规则引擎，保证任何环境都能用。 */
      if (ans.fallback && window.KJ_AI && KJ_AI.ready()) {
        KJ_AI.runChat(text);
        return;
      }
      const d = nlBubble('ai', String(ans.text).replace(/\n/g, '<br>'));
      try {
        if (ans.chart && ans.chart.type) {
          const cv = document.createElement('canvas');
          d.appendChild(cv);
          nlDrawCv(cv, ans.chart);
        }
      } catch (e2) { /* 图表失败不影响文字回答 */ }
      if (ans.help) nlRenderChips();
      if (ans.actions) nlActions(d, ans.actions);
    } finally {
      /* Agent 接管期间由 KJ_AI.busy 维护忙碌态，避免这里提前解锁造成并发提问 */
      if (!(window.KJ_AI && KJ_AI.busy)) {
        nlBusy = false;
        document.getElementById('nl-send').disabled = false;
      }
      $nlBody().scrollTop = $nlBody().scrollHeight;
    }
  }, 420);
}
