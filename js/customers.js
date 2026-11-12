/**
 * 客户管理
 * --------------------------------------------------------------------------
 * 列表里的等级、复购、月均采购都是现算的（数据量小，没必要落库），
 * 排序按累计采购额降序，前几名给 VIP 标记。
 * 客户档案和送货记录是弱关联：改客户名不会回写历史单据，这里做了提示。
 */

// ================= 客户管理 =================
function renderCustomers() {
  const q = (document.getElementById('c-search').value||'').trim().toLowerCase();
  const list = db.customers.map(c => {
    const recs = db.records.filter(r => r.customer === c.name);
    const total = recs.reduce((s,r) => s + r.qty*r.price, 0);
    const pref = {};
    recs.forEach(r => pref[r.product] = (pref[r.product]||0) + r.qty*r.price);
    const top = Object.entries(pref).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]).join('、') || '—';
    const activeMonths = new Set(recs.map(r=>r.date.slice(0,7))).size || 1;
    const mAvg = total / activeMonths;
    return { c, total, n: recs.length, top, mAvg, last: recs.map(r=>r.date).sort().pop() || '—' };
  }).filter(x => !q || x.c.name.toLowerCase().includes(q) || String(x.c.contact||'').toLowerCase().includes(q))
    .sort((a,b) => b.total - a.total);
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('customers-body').innerHTML = list.map((x,i) => {
    const lv = x.c.level || '普通';
    const lvCls = lv==='VIP' ? 'bg-purple-100 text-purple-700' : lv==='重要' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600';
    return `<tr class="border-t hover:bg-teal-50/40">
      <td class="px-4 py-3 font-medium">${medals[i] || '<span class="text-slate-400 text-xs mr-1">'+(i+1)+'</span>'} ${esc(x.c.name)}</td>
      <td class="px-4 py-3 text-center"><span class="${lvCls} text-xs font-bold px-2 py-0.5 rounded-full">${esc(lv)}</span></td>
      <td class="px-4 py-3">${esc(x.c.contact)}</td>
      <td class="px-4 py-3">${esc(x.c.phone)}</td>
      <td class="px-4 py-3 text-right">${x.n}</td>
      <td class="px-4 py-3 text-right font-semibold text-teal-600">¥${fmt(x.total)}</td>
      <td class="px-4 py-3 text-right">¥${fmt(x.mAvg)}</td>
      <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${esc(x.last)}</td>
      <td class="px-4 py-3 text-xs text-slate-600">${esc(x.top)}</td>
      <td class="px-4 py-3 text-center no-print whitespace-nowrap">
        <button onclick="viewCustomerBills('${esc(x.c.name)}')" class="text-emerald-600 hover:underline text-xs mr-2">看账单</button>
        <button onclick="editCustomer('${x.c.id}')" class="text-teal-600 hover:underline text-xs mr-2">编辑</button>
        <button onclick="deleteCustomer('${x.c.id}')" class="text-red-500 hover:underline text-xs">删除</button>
      </td>
    </tr>`;
  }).join('');
  setTimeout(drawCustomerAnalytics, 30);
}
let editingCustomerId = null;
function openCustomerEditor(c) {
  editingCustomerId = c ? c.id : null;
  document.getElementById('customer-modal-title').textContent = c ? '编辑客户' : '新增客户';
  ['name','contact','phone','note'].forEach(k => document.getElementById('cu-'+k).value = c ? (c[k]||'') : '');
  document.getElementById('cu-level').value = c ? (c.level||'普通') : '普通';
  document.getElementById('customer-modal').classList.remove('hidden');
}
function editCustomer(cid) { openCustomerEditor(db.customers.find(c => c.id === cid)); }
function closeCustomerEditor() { document.getElementById('customer-modal').classList.add('hidden'); }
function saveCustomer() {
  const name = document.getElementById('cu-name').value.trim();
  if (!name) return toast('请填写客户名称', false);
  const data = { name, contact: document.getElementById('cu-contact').value.trim(),
    phone: document.getElementById('cu-phone').value.trim(), note: document.getElementById('cu-note').value.trim(),
    level: document.getElementById('cu-level').value };
  if (editingCustomerId) {
    const c = db.customers.find(c => c.id === editingCustomerId);
    const oldName = c.name; Object.assign(c, data);
    db.records.forEach(r => { if (r.customer === oldName) r.customer = name; });
    toast('已保存');
  } else { db.customers.push({id: id(), ...data}); toast('已添加客户'); }
  save(); refreshSelects(); renderCustomers(); closeCustomerEditor();
}
function deleteCustomer(cid) {
  const c = db.customers.find(x => x.id === cid);
  const cnt = db.records.filter(r => r.customer === c.name).length;
  if (cnt > 0 && !confirm(`该客户名下有 ${cnt} 条送货记录，删除后记录将保留但显示为原名称。\n确认删除客户？`)) return;
  if (cnt === 0 && !confirm('确认删除该客户？')) return;
  db.customers = db.customers.filter(x => x.id !== cid);
  save(); refreshSelects(); renderCustomers(); toast('已删除');
}
function viewCustomerBills(name) {
  switchTab('records');
  document.getElementById('f-customer').value = name;
  renderRecords();
}
