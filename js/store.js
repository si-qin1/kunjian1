/**
 * 数据层
 * --------------------------------------------------------------------------
 * 全站数据挂在同一个 db 对象上（送货记录 / 客户 / 对账状态），任何写操作
 * 之后统一走 save() 落盘，读的时候先做一次版本号检查，方便以后改结构。
 *
 * demoData() 生成演示数据集：固定随机种子，保证每次打开看到的数据完全
 * 一致——截图、文档里的金额和条数都是照着它算的，数据一变就对不上。
 */

// ================= 数据存储 =================
const KEY = 'kunyan_v3';
let db = loadData();

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.records) return d;
  } catch(e) {}
  return { records: demoData(), reconStatus: {}, customers: [
    {id: id(), name: '衍洲海产供应链(厦门)有限公司', contact: '郑总', phone: '138****5108', note: '核心大客户，日结', level: 'VIP'},
    {id: id(), name: '鹭岛洲际酒店采购部', contact: '林经理', phone: '139****6632', note: '五星级酒店，月结60天', level: 'VIP'},
    {id: id(), name: '宏鲜汇冷链物流(福建)有限公司', contact: '黄采购', phone: '137****9415', note: '二级批发，周结', level: '重要'},
    {id: id(), name: '海峡渔市批发行', contact: '何老板', phone: '150****3327', note: '渔市档口，现结', level: '普通'},
    {id: id(), name: '蓝湾餐饮连锁集团', contact: '苏主管', phone: '186****7789', note: '连锁餐饮20家门店，月结', level: '重要'},
  ]};
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function demoData() {
  // 内置演示数据：衍洲国际深海臻品供应链 · 确定性生成约 120 天送货记录（可「数据服务中心」清空）
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(20251101);
  const products = [
    { n: '东星斑',     spec: '0.8-1斤/条', u: '斤', p: 168, base: 12 },
    { n: '澳洲龙虾',   spec: '1-1.5斤/只', u: '斤', p: 268, base: 8 },
    { n: '帝王蟹',     spec: '3-4斤/只',   u: '斤', p: 388, base: 4 },
    { n: '波士顿龙虾', spec: '0.8-1.2斤/只', u: '斤', p: 138, base: 10 },
    { n: '青斑',       spec: '1-1.5斤/条', u: '斤', p: 88,  base: 18 },
    { n: '多宝鱼',     spec: '1.2-1.6斤/条', u: '斤', p: 52, base: 26 },
    { n: '象拔蚌',     spec: '特级',       u: '斤', p: 216, base: 7 },
    { n: '法国生蚝',   spec: 'N2 规格',    u: '打', p: 96,  base: 15 },
    { n: '北极贝刺身', spec: 'S级 1kg/盒', u: '盒', p: 128, base: 9 },
    { n: '九节虾',     spec: '头市大',     u: '斤', p: 118, base: 14 },
  ];
  const customers = [
    '衍洲海产供应链(厦门)有限公司',
    '鹭岛洲际酒店采购部',
    '宏鲜汇冷链物流(福建)有限公司',
    '海峡渔市批发行',
    '蓝湾餐饮连锁集团'
  ];
  const rows = [];
  let no = 61500;
  const start = new Date(Date.UTC(2025, 5, 1)), endD = new Date(Date.UTC(2025, 8, 28));
  let dayIdx = 0;
  for (let d = new Date(start); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const weekend = (dow === 5 || dow === 6) ? 1.25 : (dow === 0 ? 1.12 : 1);
    const m = d.getUTCMonth() + 1;
    const season = m === 6 ? 0.96 : m === 7 ? 1.1 : m === 8 ? 1.22 : 1.12; // 盛夏至中秋旺季
    const trend = 1 + dayIdx / 120 * 0.2;   // 稳中有升
    const day = d.getUTCDate();
    const promo = (day === 10 || day === 25) ? 1.15 : 1; // 月中/月末促销脉冲
    const holiday = (m === 8 && day >= 20 && day <= 28) ? 1.14 : 1; // 中秋备货高峰
    dayIdx++;
    customers.forEach((cu, ci) => {
      if (rnd() < 0.04) return;               // 少数日子无进货
      const core = [[0, 4, 7, 9], [0, 2, 6], [4, 5, 8, 7], [3, 5, 9], [1, 2, 9, 6]][ci];
      const picks = [3, 2, 3, 2, 3][ci];
      const used = {};
      for (let k = 0; k < picks; k++) {
        let pi = k < core.length ? core[k] : Math.floor(rnd() * products.length);
        if (used[pi]) continue; used[pi] = 1;
        const pr = products[pi];
        const scale = [1.0, 0.85, 0.7, 0.6, 0.55][ci];
        let qty = Math.round(pr.base * scale * weekend * season * trend * promo * holiday * (0.96 + rnd() * 0.08));
        if (qty <= 0) continue;
        const price = +(pr.p * (0.97 + rnd() * 0.06)).toFixed(1);
        rows.push({ date, deliveryNo: 'KY' + (no++), orderNo: 'YO' + date.replace(/-/g, '') + String.fromCharCode(65 + k),
          product: pr.n, spec: pr.spec, qty, unit: pr.u, price, customer: cu });
      }
    });
  }
  return rows.map(r => ({ id: id(), ...r }));
}
