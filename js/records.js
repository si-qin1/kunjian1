/**
 * 送货明细
 * --------------------------------------------------------------------------
 * 系统的数据入口。筛选条件（客户 / 月份 / 关键字）都从 DOM 现取，
 * 不额外维护一份状态，省得两处不同步；数据量按 1500 条设计，
 * 直接全量渲染，没有做虚拟滚动——再大就该分页了。
 *
 * 新增和编辑共用一个弹窗，靠隐藏的 id 字段区分是插入还是更新。
 */

// ================= 送货明细 =================
function filteredRecords() {
  const cu = document.getElementById('f-customer').value;
  const mo = document.getElementById('f-month').value;
  const q = document.getElementById('f-search').value.trim().toLowerCase();
  return db.records.filter(r => {
    if (cu && r.customer !== cu) return false;
    if (mo && monthOf(r.date) !== mo) return false;
    if (q && ![r.deliveryNo, r.orderNo, r.product, r.spec].some(v => String(v||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) => (b.date||'').localeCompare(a.date||''));
}

function renderRecords() {
  const list = filteredRecords();
  const tbody = document.getElementById('records-body');
  tbody.innerHTML = list.map(r => `
    <tr class="border-t hover:bg-teal-50/40">
      <td class="px-3 py-2 whitespace-nowrap">${esc(r.date)}</td>
      <td class="px-3 py-2 font-medium">${esc(r.deliveryNo)}</td>
      <td class="px-3 py-2 text-slate-500">${esc(r.orderNo)}</td>
      <td class="px-3 py-2 max-w-[160px] truncate" title="${esc(r.customer)}">${esc(r.customer)}</td>
      <td class="px-3 py-2">${esc(r.product)}</td>
      <td class="px-3 py-2">${esc(r.spec)}</td>
      <td class="px-3 py-2 text-right">${r.qty}</td>
      <td class="px-3 py-2 text-center">${esc(r.unit)}</td>
      <td class="px-3 py-2 text-right">${fmt(r.price)}</td>
      <td class="px-3 py-2 text-right font-semibold text-slate-800">${fmt(r.qty * r.price)}</td>
      <td class="px-3 py-2 text-center no-print whitespace-nowrap">
        <button onclick="editRecord('${r.id}')" class="text-teal-600 hover:underline text-xs mr-2">编辑</button>
        <button onclick="deleteRecord('${r.id}')" class="text-red-500 hover:underline text-xs">删除</button>
      </td>
    </tr>`).join('');
  document.getElementById('records-empty').classList.toggle('hidden', list.length > 0);
  document.getElementById('stat-count').textContent = db.records.length;
  document.getElementById('stat-amount').textContent = fmt(db.records.reduce((s,r) => s + r.qty*r.price, 0));
  document.getElementById('stat-customers').textContent = new Set(db.records.map(r=>r.customer).filter(Boolean)).size;
  const thisMonth = new Date().toISOString().slice(0,7);
  document.getElementById('stat-month').textContent = fmt(db.records.filter(r => monthOf(r.date) === thisMonth).reduce((s,r) => s + r.qty*r.price, 0));
}
function clearFilters(which) {
  ['f-customer','f-month','f-search'].forEach(i => document.getElementById(i).value = '');
  renderRecords();
}
function deleteRecord(recId) {
  const r = db.records.find(x => x.id === recId);
  if (!confirm(`删除该记录？\n日期：${r.date}\n品名：${r.product}\n数量：${r.qty}`)) return;
  db.records = db.records.filter(x => x.id !== recId);
  save(); refreshSelects(); renderRecords(); toast('已删除');
}

// ================= 录入弹窗 =================
let editingId = null;
function openEditor(rec) {
  editingId = rec ? rec.id : null;
  document.getElementById('editor-title').textContent = rec ? '编辑送货记录' : '新增送货记录';
  document.getElementById('e-customer').value = rec ? rec.customer : '';
  document.getElementById('e-date').value = rec ? rec.date : new Date().toISOString().slice(0,10);
  document.getElementById('e-delivery-no').value = rec ? rec.deliveryNo : '';
  document.getElementById('e-order-no').value = rec ? rec.orderNo : '';
  document.getElementById('detail-body').innerHTML = '';
  const details = rec ? [rec] : [null, null, null];
  details.forEach(() => addDetailRow(rec));
  updateEditorTotal();
  document.getElementById('editor-modal').classList.remove('hidden');
}
function addDetailRow(rec) {
  const tr = document.createElement('tr');
  tr.className = 'border-t';
  const v = i => rec ? esc(rec[i]) : '';
  tr.innerHTML = `
    <td class="px-1 py-1"><input class="d-product w-full border rounded px-2 py-1.5 text-sm" value="${v('product')}" placeholder="如 南美白对虾 / 鲜活鲈鱼"></td>
    <td class="px-1 py-1"><input class="d-spec w-full border rounded px-2 py-1.5 text-sm" value="${v('spec')}" placeholder="如 3*4"></td>
    <td class="px-1 py-1"><input class="d-qty w-full border rounded px-2 py-1.5 text-sm text-right" type="number" min="0" step="any" value="${rec ? rec.qty : ''}" oninput="updateEditorTotal()"></td>
    <td class="px-1 py-1"><input class="d-unit w-full border rounded px-2 py-1.5 text-sm text-center" value="${rec ? esc(rec.unit) : '斤'}"></td>
    <td class="px-1 py-1"><input class="d-price w-full border rounded px-2 py-1.5 text-sm text-right" type="number" min="0" step="any" value="${rec ? rec.price : ''}" oninput="updateEditorTotal()"></td>
    <td class="px-1 py-1 d-amount text-right py-1.5 pr-3 text-sm font-medium text-slate-600">0.00</td>
    <td class="px-1 text-center"><button onclick="this.closest('tr').remove(); updateEditorTotal();" class="text-red-400 hover:text-red-600 text-sm">✕</button></td>`;
  document.getElementById('detail-body').appendChild(tr);
}
function updateEditorTotal() {
  let total = 0;
  document.querySelectorAll('#detail-body tr').forEach(tr => {
    const amt = (Number(tr.querySelector('.d-qty').value)||0) * (Number(tr.querySelector('.d-price').value)||0);
    tr.querySelector('.d-amount').textContent = fmt(amt);
    total += amt;
  });
  document.getElementById('editor-total').textContent = fmt(total);
}
function saveRecord() {
  const customer = document.getElementById('e-customer').value.trim();
  const date = document.getElementById('e-date').value;
  if (!customer) return toast('请填写客户名称', false);
  if (!date) return toast('请选择送货日期', false);
  const base = {
    customer, date,
    deliveryNo: document.getElementById('e-delivery-no').value.trim(),
    orderNo: document.getElementById('e-order-no').value.trim(),
  };
  // 自动建档客户
  if (!db.customers.some(c => c.name === customer)) db.customers.push({id: id(), name: customer, contact:'', phone:'', note:''});

  const rows = [];
  document.querySelectorAll('#detail-body tr').forEach(tr => {
    const product = tr.querySelector('.d-product').value.trim();
    if (!product) return;
    rows.push({...base, id: id(), product,
      spec: tr.querySelector('.d-spec').value.trim(),
      qty: Number(tr.querySelector('.d-qty').value)||0,
      unit: tr.querySelector('.d-unit').value.trim() || '斤',
      price: Number(tr.querySelector('.d-price').value)||0 });
  });
  if (rows.length === 0) return toast('请至少填写一行产品明细', false);
  if (editingId) {
    const idx = db.records.findIndex(r => r.id === editingId);
    db.records[idx] = rows[0];
    rows.slice(1).forEach(r => db.records.push(r));
    toast('已保存修改');
  } else {
    db.records.push(...rows);
    toast(`已保存 ${rows.length} 条记录`);
  }
  save(); refreshSelects(); renderRecords(); closeEditor();
}
function editRecord(recId) { openEditor(db.records.find(r => r.id === recId)); }
function closeEditor() { document.getElementById('editor-modal').classList.add('hidden'); }
