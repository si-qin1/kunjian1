/**
 * 本地 mock 大模型服务（仅用于离线自测与演示，不属于线上依赖）
 * --------------------------------------------------------------------------
 * 用途：在没有真实 API Key 的环境里，验证「秦思智能体」的完整 Agent 链路：
 *       规划 → Function Calling → 工具执行 → 观察回填 → 作答 → 引用核对。
 * 协议：OpenAI 兼容
 *   POST /v1/chat/completions   支持 tools / tool_calls / tool 角色，可选 stream(SSE)
 *   POST /v1/audio/transcriptions  返回固定转写文本
 * 运行：node scripts/mock-llm.mjs          默认 http://127.0.0.1:8787/v1
 * 使用：在 .env 中配置
 *        LLM_BASE_URL=http://127.0.0.1:8787/v1
 *        LLM_API_KEY=mock-key
 *        LLM_MODEL=mock-model
 *      再执行 node scripts/build-env.mjs，打开页面提问即可看到工具调用轨迹。
 * 说明：它只做"决策模拟"，不产出业务结论——所有数字都来自页面真实工具结果。
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8787);
const KEY = process.env.MOCK_KEY || 'mock-key';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS,GET'
};

function send(res, code, obj, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, CORS, extra || {}));
  res.end(JSON.stringify(obj));
}

/** 根据问题挑一个工具，模拟模型的自主决策 */
function pickTool(question) {
  const q = question || '';
  if (/排行|最好|TOP|top|贡献最大|卖得最好/.test(q)) {
    return { name: 'top_rank', args: { by: /客户|哪家|哪位/.test(q) ? 'customer' : 'product', limit: 5 } };
  }
  if (/趋势|走势|最近|曲线|变化/.test(q)) {
    return { name: 'trend_series', args: { days: 30 } };
  }
  if (/客户档案|回款|账期/.test(q) && /「|」|"|客户名/.test(q)) {
    const name = (q.match(/「(.+?)」/) || q.match(/客户名[:：]\s*(\S+)/) || [])[1];
    if (name) return { name: 'customer_profile', args: { name } };
  }
  if (/客户|结构|流失|贡献|哪家/.test(q)) {
    return { name: 'top_rank', args: { by: 'customer', limit: 5 } };
  }
  if (/对账|应收|差额|欠/.test(q)) {
    return { name: 'reconcile_summary', args: {} };
  }
  if (/多少|一共|总量|区间|合计/.test(q)) {
    return { name: 'data_bounds', args: {} };
  }
  return { name: 'query_sales', args: {} };
}

function toolCall(id, name, args) {
  return {
    id: id,
    type: 'function',
    function: { name: name, arguments: JSON.stringify(args) }
  };
}

/** 从工具结果里凑一句带引用的回答（数字全部取自工具，保证可核对） */
function composeAnswer(messages) {
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  const last = toolMsgs.length ? toolMsgs[toolMsgs.length - 1].content : '';
  let parsed = null;
  try { parsed = JSON.parse(last); } catch { parsed = null; }

  if (parsed && parsed.list) {
    const rows = parsed.list.map((x) => `${x.name} ${x.amount.toLocaleString()} 元（${x.share}）`).join('；');
    return `${parsed.by === 'customer' ? '客户' : '品名'}销售额 TOP${parsed.list.length}（${parsed.period}，合计 ${parsed.total.toLocaleString()} 元）：${rows}。[1]\n建议：对前两位加大备货优先级，末位复核是否需要减少账期。`;
  }
  if (parsed && parsed.total !== undefined && parsed.avg !== undefined) {
    return `最近 ${parsed.days} 天（${parsed.customer} / ${parsed.product}）合计 ${parsed.total.toLocaleString()} 元，日均 ${parsed.avg.toLocaleString()} 元，峰值出现在 ${parsed.peak.date}（${parsed.peak.value.toLocaleString()} 元），首尾三日对比 ${parsed.change}。[1]\n建议：按日均 × 1.15 作为近期备货基线。`;
  }
  if (parsed && parsed.records !== undefined && parsed.amount !== undefined) {
    return `${parsed.period} · ${parsed.customer} · ${parsed.product}：共 ${parsed.records} 笔，销售额 ${parsed.amount.toLocaleString()} 元，销量 ${parsed.qty.toLocaleString()}。[1]\n建议：结合近 30 天趋势判断是否需要补货。`;
  }
  if (parsed && parsed.first) {
    return `数据集覆盖 ${parsed.first} 至 ${parsed.last}，共 ${parsed.records} 笔记录，累计销售额 ${parsed.total.toLocaleString()} 元。[1]`;
  }
  if (parsed && parsed.hits) {
    return `检索到 ${parsed.hits.length} 条相关资料：${parsed.hits.map((h) => h.title).join('、')}。[1]`;
  }
  if (parsed && parsed.due !== undefined) {
    return `应收合计 ${parsed.due.toLocaleString()} 元，待确认对账组 ${parsed.pendingGroups} 个。[1]\n建议：优先处理跨月差额，避免影响月结。`;
  }
  if (parsed && parsed.name && parsed.amount !== undefined) {
    return `${parsed.name} 累计采购 ${parsed.amount.toLocaleString()} 元，${parsed.records} 笔，最近一次 ${parsed.lastDate}。[1]\n建议：按 A/B/C 分级安排回访节奏。`;
  }
  return '已根据工具返回的数据整理结论，详见上方工具结果。[1]';
}

function chatHandler(body) {
  const messages = body.messages || [];
  const hasToolAnswer = messages.some((m) => m.role === 'tool');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = (lastUser && typeof lastUser.content === 'string') ? lastUser.content : '';

  if (body.tools && body.tools.length && !hasToolAnswer) {
    const pick = pickTool(question);
    const valid = body.tools.some((t) => t.function && t.function.name === pick.name);
    const tool = valid ? pick : { name: body.tools[0].function.name, args: {} };
    return {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      model: body.model || 'mock-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: '', tool_calls: [toolCall('call_mock_1', tool.name, tool.args)] },
        finish_reason: 'tool_calls'
      }],
      usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 }
    };
  }

  const content = composeAnswer(messages);
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    model: body.model || 'mock-model',
    choices: [{ index: 0, message: { role: 'assistant', content: content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 260, completion_tokens: 80, total_tokens: 340 }
  };
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(''); return; }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true, service: 'mock-llm', port: PORT });
    return;
  }

  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== KEY) {
    send(res, 401, { error: { message: 'invalid api key', type: 'authentication_error' } });
    return;
  }

  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try {
      if (req.url === '/v1/audio/transcriptions') {
        send(res, 200, { text: '东星斑 9 月卖了多少' });
        return;
      }
      if (req.url !== '/v1/chat/completions') { send(res, 404, { error: { message: 'not found' } }); return; }
      const body = JSON.parse(raw || '{}');
      const out = chatHandler(body);
      console.log(`[mock-llm] ${out.choices[0].finish_reason} · ${(body.messages || []).length} msgs · tools=${(body.tools || []).length}`);
      send(res, 200, out);
    } catch (e) {
      send(res, 500, { error: { message: String(e && e.message || e) } });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] OpenAI 兼容 mock 已启动：http://127.0.0.1:${PORT}/v1`);
  console.log(`[mock-llm] 鉴权：Authorization: Bearer ${KEY}`);
  console.log('[mock-llm] 仅用于离线自测/演示，不产出业务结论（数字来自页面真实工具）');
});
