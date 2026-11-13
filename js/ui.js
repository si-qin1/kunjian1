/**
 * 通用 UI：Tab 切换 / 全局提示 / 下拉刷新 / 格式化
 * --------------------------------------------------------------------------
 * switchTab 除了切显示，还负责切换后触发当前页重绘：Canvas 放在隐藏容器
 * 里量出来宽度是 0，直接画就是一片空白，统一改成“先显示、再绘制”。
 */

// ================= 工具 =================
function fmt(n) { return Number(n||0).toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function toast(msg, ok=true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-lg text-sm shadow-lg z-[60] text-white ' + (ok ? 'bg-emerald-600' : 'bg-red-600');
  setTimeout(() => t.classList.add('hidden'), 2200);
  t.classList.remove('hidden');
}
function monthOf(dateStr) { return (dateStr||'').slice(0,7); }

// ================= Tab 切换 =================
function switchTab(tab) {
  ['records','reconcile','customers','data','forecast','report','users'].forEach(t => {
    const pg = document.getElementById('page-'+t);
    pg.classList.toggle('hidden', t !== tab);
    document.getElementById('tab-'+t).className = 'px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ' +
      (t === tab ? 'bg-white shadow-md shadow-teal-200/70 text-teal-700 font-semibold' : 'text-slate-500 hover:text-slate-700');
    if (t === tab) { pg.classList.remove('page-enter'); void pg.offsetWidth; pg.classList.add('page-enter'); }
  });
  refreshSelects();
  if (tab === 'records') renderRecords();
  if (tab === 'reconcile') renderReconcile();
  if (tab === 'customers') renderCustomers();
  if (tab === 'data') renderDataStats();
  if (tab === 'users') renderUsersView();
  if (tab === 'forecast') refreshFcSelects();
  if (tab === 'report' && reportData) setTimeout(drawReportCharts, 30);
  if (tab === 'forecast' && fcResult) setTimeout(function () {
    try {
      drawFcChart();
      if (fcResult.xai && fcResult.xai.data) { drawShapChart(); drawHeatChart(); drawEsen3D(); drawSaliencyChart(); drawDowChart(); drawBacktestChart(); }
      if (fcResult.xai && fcResult.xai.lossHist) drawModelCharts();
    } catch (e) {}
  }, 30);
  // 注：上面用 className 重置页签样式会抹掉 hidden，这里按角色重新同步「用户管理」页签显隐
  if (typeof syncAdminNav === 'function') syncAdminNav();
}

function lgDemoFill() {
  document.getElementById('lg-user').value = 'admin';
  document.getElementById('lg-pass').value = DEMO_ADMIN_PASS;
}

// ================= 下拉选项 =================
function refreshSelects() {
  const names = [...new Set(db.records.map(r => r.customer).filter(Boolean))].sort();
  const opts = (allLabel) => '<option value="">' + allLabel + '</option>' + names.map(n => `<option>${esc(n)}</option>`).join('');
  const fc = document.getElementById('f-customer');
  if (fc) fc.innerHTML = opts('全部客户');
  const rc = document.getElementById('r-customer');
  if (rc) rc.innerHTML = opts('请选择客户');
  document.getElementById('customer-list').innerHTML = db.customers.map(c => `<option value="${esc(c.name)}">`).join('');
}
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
