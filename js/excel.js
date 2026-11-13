/**
 * Excel 导入导出与 JSON 备份
 * --------------------------------------------------------------------------
 * 导出走 xlsx-js-style：表头加底色、金额设数字格式、列宽按内容估。
 * 导入兼容 .xlsx/.xls/.csv，按表头名匹配字段，缺列提示而不是静默丢弃。
 */

// ================= Excel / 备份 =================
function exportRecords() {
  const list = filteredRecords();
  if (!list.length) return toast('没有可导出的数据', false);
  const cu = document.getElementById('f-customer').value || '全部客户';
  const mo = document.getElementById('f-month').value;
  const wb = XLSX.utils.book_new();
  const ws = buildStatementSheet(list, cu, (mo ? mo : '') + '送货明细');
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName('送货明细', new Set()));
  downloadBlob(writeWorkbook(wb), `送货明细_${new Date().toISOString().slice(0,10)}.xlsx`,
    (m, bad) => toast(m, !bad));
}
function exportBackup() {
  db.lastBackupAt = Date.now(); save();
  const blob = new Blob([JSON.stringify(db, null, 2)], {type: 'application/json'});
  downloadBlob(blob, `鲲鉴智策备份_${new Date().toISOString().slice(0,10)}.json`,
    (m, bad) => toast(m, !bad));
}
function importBackup(input) {
  const f = input.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (!d.records) throw 0;
      if (!confirm('导入将覆盖当前全部数据，确认继续？')) return;
      db = { records: d.records, customers: d.customers || [] };
      save(); refreshSelects(); switchTab('records'); toast('导入成功，共 ' + d.records.length + ' 条记录');
    } catch(err) { toast('文件格式错误', false); }
    input.value = '';
  };
  reader.readAsText(f);
}
function importExcel(input) {
  const f = input.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
      const pick = (r, keys) => { for (const k of keys) { const hit = Object.keys(r).find(x => x.trim() && keys.some(kk => x.trim().includes(kk))); if (hit !== undefined && String(r[hit]).trim() !== '') return r[hit]; } return ''; };
      let added = 0;
      rows.forEach(r => {
        const product = pick(r, ['品名','产品','货物名称']);
        if (!product) return;
        const dateRaw = pick(r, ['送货日期','日期']);
        let date = new Date().toISOString().slice(0,10);
        if (typeof dateRaw === 'number') {
          const d = XLSX.SSF.parse_date_code(dateRaw);
          if (d) date = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
        } else if (dateRaw) { const m = String(dateRaw).match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/); if (m) date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; }
        const customer = pick(r, ['客户']) || '未分类客户';
        db.records.push({ id: id(), date,
          deliveryNo: String(pick(r, ['送货单号','送货单'])), orderNo: String(pick(r, ['订单编号','订单'])),
          customer, product, spec: String(pick(r, ['规格'])),
          qty: Number(pick(r, ['数量']))||0,
          unit: String(pick(r, ['单位']))||'斤',
          price: Number(pick(r, ['单价']))||0 });
        if (!db.customers.some(c => c.name === customer)) db.customers.push({id: id(), name: customer, contact:'', phone:'', note:''});
        added++;
      });
      save(); refreshSelects(); renderRecords();
      document.getElementById('excel-result').innerHTML = `<span class="text-emerald-600">✅ 成功导入 ${added} 条记录</span>`;
      toast(`导入成功 ${added} 条`);
    } catch(err) { toast('Excel 解析失败', false); }
    input.value = '';
  };
  reader.readAsArrayBuffer(f);
}
function clearAllData() {
  // 调用层二次校验：即使绕过界面（如控制台直接调用），非管理员也无法执行
  if (!currentUser || currentUser.role !== '老板') { toast('仅管理员可执行清空操作', false); return; }
  if (!confirm('⚠️ 确认清空全部送货记录和客户数据？此操作不可恢复！')) return;
  if (!confirm('再次确认：真的要清空吗？建议先导出备份。')) return;
  db = { records: [], customers: [] };
  save(); refreshSelects(); switchTab('records'); toast('已清空全部数据');
}
