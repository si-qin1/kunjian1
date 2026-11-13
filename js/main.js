/**
 * 启动入口
 * --------------------------------------------------------------------------
 * 最后加载：刷新下拉选项、绑定弹窗遮罩关闭、检查遗留登录会话直接进
 * 主界面。放在所有模块之后，保证调用的函数都已定义。
 */

refreshSelects();
document.getElementById('editor-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditor(); });
document.getElementById('customer-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeCustomerEditor(); });

// AI/重活调度：兼容不支持 requestIdleCallback 的旧 WebView
window.ric = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1); };

// 检查登录状态（勾选"记住"用 localStorage，否则 sessionStorage 仅当前会话有效）
(function autoLogin() {
  const saved = localStorage.getItem(SKEY) || sessionStorage.getItem(SKEY);
  if (saved) {
    const u = users.find(x => x.username.toLowerCase() === saved.toLowerCase());
    if (u) { currentUser = u; enterApp(); notifyNativeReady(); return; }
  }
  document.getElementById('login-page').classList.remove('hidden');
  initSeaLife();
  setTimeout(() => document.getElementById('lg-user').focus(), 200);
})();
