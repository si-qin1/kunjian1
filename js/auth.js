/**
 * 账号与登录
 * --------------------------------------------------------------------------
 * 这个项目没有后端，但评审演示需要"像个系统"，于是用 localStorage 维护
 * 一张用户表，密码先做一次简单哈希再存（不是安全边界，只是别让明文直接
 * 躺在 DevTools 里）。会话保持分两种：勾了"记住我"写 localStorage，
 * 否则写 sessionStorage，关掉页面就失效。
 *
 * 重置密钥和演示口令原来写死在代码里，仓库公开后等于把口令交出去，
 * 后来改成从 window.KJ_ENV 读，见 js/env.js 的说明。
 */

// ================= 认证 =================
const UKEY = 'kunyan_users_v1';
const SKEY = 'kunyan_session_v1';
// ---------- 安全配置层（QJ-SEC）：敏感信息一律通过环境变量注入，禁止硬编码入公开仓库 ----------
// 注入方式二选一：
//   A) 本地开发：复制 env.example.js 为 env.js 并按需修改（env.js 已被 .gitignore 排除，绝不入库）
//   B) 构建/部署：运行 scripts/build-env.mjs 从 .env 生成 web/env.js，或在部署平台配置环境变量后由服务端注入 window.KJ_ENV
// 本地双击打开（file://）且没有配置环境变量时，走下面的"开发兜底值"——仅用于自己调试，上线前必须覆盖。
const KJ_ENV = (typeof window !== 'undefined' && window.KJ_ENV) || {};
const RESET_KEY = KJ_ENV.RESET_KEY || '888888';            // ⚠ 兜底值仅供本地演示，生产环境必须覆盖
const DEMO_ADMIN_PASS = KJ_ENV.DEMO_ADMIN_PASS || 'admin123'; // 演示管理员初始密码，生产环境必须覆盖
const KJ_ENV_KEYS = Object.keys(KJ_ENV).length;
if (!KJ_ENV_KEYS && location.protocol !== 'file:') console.info('[安全提示] 未检测到 window.KJ_ENV，正在使用开发兜底配置；生产环境请通过环境变量注入 RESET_KEY / DEMO_ADMIN_PASS 等敏感项。');

function hash(str) {   // 简易哈希（本地存储用途，非加密标准）
  let h = 5381;
  const s = 'bill$' + str;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16) + '_' + s.length;
}
function loadUsers() {
  try { const u = JSON.parse(localStorage.getItem(UKEY)); if (Array.isArray(u) && u.length) return u; } catch(e) {}
  return [{ username: 'admin', name: '管理员', role: '老板', pass: hash(DEMO_ADMIN_PASS), created: Date.now() }];
}
function saveUsers(u) { localStorage.setItem(UKEY, JSON.stringify(u)); }
let users = loadUsers();
let currentUser = null;

function showLoginView(view) {
  ['login','register','forgot'].forEach(v => document.getElementById(v + '-form').classList.toggle('hidden', v !== view));
  ['login-error','register-msg','forgot-msg'].forEach(i => document.getElementById(i).classList.add('hidden'));
}

function doLogin() {
  const username = document.getElementById('lg-user').value.trim();
  const pass = document.getElementById('lg-pass').value;
  const err = document.getElementById('login-error');
  const u = users.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (!username || !pass) return showErr(err, '请输入账号和密码');
  if (!u || u.pass !== hash(pass)) return showErr(err, '账号或密码不正确');
  currentUser = u;
  if (document.getElementById('lg-remember').checked) {
    localStorage.setItem(SKEY, username);
  } else {
    sessionStorage.setItem(SKEY, username);
  }
  enterApp();
}
function showErr(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

function doRegister() {
  const username = document.getElementById('rg-user').value.trim();
  const name = document.getElementById('rg-name').value.trim();
  const p1 = document.getElementById('rg-pass').value;
  const p2 = document.getElementById('rg-pass2').value;
  const msg = document.getElementById('register-msg');
  if (!username) return regErr(msg, '请填写登录账号');
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) return regErr(msg, '该账号已存在');
  if (p1.length < 6) return regErr(msg, '密码至少 6 位');
  if (p1 !== p2) return regErr(msg, '两次输入的密码不一致');
  users.push({ username, name: name || username, role: '普通用户', pass: hash(p1), created: Date.now() });
  saveUsers(users);
  msg.textContent = '✅ 注册成功，正在进入系统...'; msg.className = 'text-sm text-emerald-600';
  setTimeout(() => { currentUser = users[users.length-1];
    localStorage.setItem(SKEY, username); enterApp(); }, 700);
}
function regErr(el, m) { el.textContent = '⚠ ' + m; el.className = 'text-sm text-red-500'; }

function doReset() {
  const username = document.getElementById('fg-user').value.trim();
  const key = document.getElementById('fg-key').value.trim();
  const np = document.getElementById('fg-pass').value;
  const msg = document.getElementById('forgot-msg');
  const u = users.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (!u) { msg.textContent = '⚠ 账号不存在'; msg.className = 'text-sm text-red-500'; return; }
  if (key !== RESET_KEY) { msg.textContent = '⚠ 重置密钥不正确'; msg.className = 'text-sm text-red-500'; return; }
  if (np.length < 6) { msg.textContent = '⚠ 新密码至少 6 位'; msg.className = 'text-sm text-red-500'; return; }
  u.pass = hash(np); saveUsers(users);
  msg.textContent = '✅ 密码已重置，请返回登录'; msg.className = 'text-sm text-emerald-600';
}

function doLogout() {
  if (!confirm('确认退出登录？')) return;
  localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY);
  currentUser = null; location.reload();
}
function togglePass(inputId, btn) {
  const el = document.getElementById(inputId);
  el.type = el.type === 'password' ? 'text' : 'password';
  btn.textContent = el.type === 'password' ? '👁' : '🙈';
}
function changePassword() {
  const oldP = document.getElementById('pwd-old').value;
  const n1 = document.getElementById('pwd-new').value;
  const n2 = document.getElementById('pwd-new2').value;
  if (currentUser.pass !== hash(oldP)) return toast('当前密码不正确', false);
  if (n1.length < 6) return toast('新密码至少 6 位', false);
  if (n1 !== n2) return toast('两次输入的新密码不一致', false);
  currentUser.pass = hash(n1); saveUsers(users);
  ['pwd-old','pwd-new','pwd-new2'].forEach(i => document.getElementById(i).value = '');
  toast('密码修改成功');
}

function enterApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('app-main').classList.remove('hidden');
  document.getElementById('current-user').textContent = currentUser.name || currentUser.username;
  document.getElementById('current-role').textContent = currentUser.role || '普通用户';
  document.getElementById('avatar').textContent = (currentUser.name || currentUser.username).slice(0,1).toUpperCase();
  const pu = document.getElementById('pwd-user'); if (pu) pu.textContent = currentUser.username;
  refreshSelects();
  switchTab('records');
  notifyNativeReady();
}

// 通知原生壳：界面已就绪（用于关闭启动页/调整状态栏）
function notifyNativeReady() {
  try { if (window.AndroidBridge && window.AndroidBridge.onReady) window.AndroidBridge.onReady(); } catch (e) {}
  try { document.documentElement.classList.add('app-ready'); } catch (e) {}
}
