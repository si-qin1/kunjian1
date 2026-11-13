/**
 * 账号与登录
 * --------------------------------------------------------------------------
 * 没有后端，但评审演示需要“像个系统”：localStorage 维护用户表，密码哈希
 * 后存储（不是安全边界，只是别让明文躺进 DevTools）。会话保持分两种：
 * “记住我”写 localStorage，否则写 sessionStorage，关页即失效。
 * 登录成功后顺带点亮右下角的对话式数据分析助手（nlShowFab(true)）。
 */

// ================= 认证 =================
const UKEY = 'kunyan_users_v1';
const SKEY = 'kunyan_session_v1';
// ---------- 安全配置层（QJ-SEC）：敏感信息一律通过环境变量注入，禁止硬编码入公开仓库 ----------
// 注入链路（两条任选其一，产物都是 js/env.js）：
//   A) 本地：复制 .env.example 为 .env 并填值（.env 已列入 .gitignore），执行
//      node scripts/build-env.mjs 生成 js/env.js；
//   B) 部署平台：在 CI / 部署平台的环境变量面板配置同名变量，构建期执行同一脚本
//      （脚本优先读取进程环境变量，白名单仅 RESET_KEY / DEMO_ADMIN_PASS / LLM_API_KEY）。
// 仓库内的 js/env.js 只是空值模板，不承载任何真实密钥；提交前可执行
//   node scripts/build-env.mjs --empty
// 还原为空值模板。公开仓库中不得出现真实的 RESET_KEY / DEMO_ADMIN_PASS / LLM_API_KEY。
// 具备兜底值的前提下，未注入任何配置（如直接双击 index.html）时仍可正常演示。
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
  currentUser = null; nlShowFab(false); location.reload();
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
  applyRolePermissions();
  nlShowFab(true);          // 登录后才亮出对话式分析入口
  notifyNativeReady();
}

// 角色权限：高危操作（清空全部数据）仅管理员可见；普通用户看不到该卡片
// 说明：单机版无后端，这是界面层与调用层的双重约束，真正的权限边界需接入后端后由服务端裁决。
function applyRolePermissions() {
  const isAdmin = !!(currentUser && currentUser.role === '老板');
  const card = document.getElementById('danger-clear-card');
  if (card) card.classList.toggle('hidden', !isAdmin);
  syncAdminNav();
  if (!isAdmin) {
    const pg = document.getElementById('page-users');
    if (pg && !pg.classList.contains('hidden')) switchTab('records');
  }
}

// 只负责「用户管理」页签的显隐；switchTab 每次重排页签样式后都会重新调用它
function syncAdminNav() {
  const nav = document.getElementById('tab-users');
  if (!nav) return;
  const isAdmin = !!(typeof currentUser !== 'undefined' && currentUser && currentUser.role === '老板');
  nav.classList.toggle('hidden', !isAdmin);
}

// ================= 账号管理（仅管理员可见可用） =================
function requireAdmin() {
  if (!currentUser || currentUser.role !== '老板') { toast('仅管理员可管理账号', false); return false; }
  return true;
}

function renderUsersView() {
  const box = document.getElementById('user-table');
  if (!box) return;
  if (!currentUser || currentUser.role !== '老板') {
    box.innerHTML = '<p class="text-sm text-slate-500 py-4">仅管理员（老板）可查看账号列表。</p>';
    return;
  }
  const rows = users.map((u, idx) => {
    const created = u.created ? new Date(u.created).toLocaleString('zh-CN', { hour12: false }) : '—';
    const isMe = currentUser.username === u.username;
    const isBoss = u.role === '老板';
    const roleTag = isBoss
      ? '<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-medium">管理员</span>'
      : '<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-medium">普通用户</span>';
    const nextRole = isBoss ? '普通用户' : '老板';
    const nextLabel = isBoss ? '设为普通用户' : '设为管理员';
    return `<tr class="border-t border-slate-100">
      <td class="py-2 px-3 text-sm font-medium text-slate-800">${esc(u.username)}${isMe ? ' <span class="text-[11px] text-teal-600 font-normal">（当前登录）</span>' : ''}</td>
      <td class="py-2 px-3 text-sm text-slate-600">${esc(u.name || u.username)}</td>
      <td class="py-2 px-3">${roleTag}</td>
      <td class="py-2 px-3 text-xs text-slate-500">${created}</td>
      <td class="py-2 px-3 text-right whitespace-nowrap">
        <button onclick="adminSetRole(${idx},'${nextRole}')" class="text-teal-600 hover:underline text-xs px-1">${nextLabel}</button>
        <button onclick="adminResetPass(${idx})" class="text-slate-500 hover:underline text-xs px-1">重置口令</button>
        <button onclick="adminDeleteUser(${idx})" class="text-red-500 hover:underline text-xs px-1">删除</button>
      </td></tr>`;
  }).join('');
  const bossCount = users.filter(x => x.role === '老板').length;
  box.innerHTML = `
    <table class="w-full min-w-[640px]">
      <thead><tr class="text-left text-xs text-slate-400">
        <th class="py-2 px-3">账号</th><th class="py-2 px-3">姓名</th><th class="py-2 px-3">角色</th>
        <th class="py-2 px-3">创建时间</th><th class="py-2 px-3 text-right">操作</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="text-xs text-slate-400 mt-3">共 ${users.length} 个账号 · 管理员 ${bossCount} 个 · 至少保留 1 个管理员；当前登录账号不可删除、不可取消管理员身份。</p>`;
}

function adminAddUser() {
  if (!requireAdmin()) return;
  const uEl = document.getElementById('nu-user');
  const nEl = document.getElementById('nu-name');
  const pEl = document.getElementById('nu-pass');
  const rEl = document.getElementById('nu-role');
  if (!uEl || !pEl) return;
  const username = (uEl.value || '').trim();
  const name = (nEl.value || '').trim();
  const pass = pEl.value || '';
  const role = rEl && rEl.value === '老板' ? '老板' : '普通用户';
  if (!username) return toast('请填写登录账号', false);
  if (users.some(x => x.username.toLowerCase() === username.toLowerCase())) return toast('该账号已存在', false);
  if (pass.length < 6) return toast('初始口令至少 6 位', false);
  users.push({ username, name: name || username, role, pass: hash(pass), created: Date.now() });
  saveUsers(users);
  uEl.value = ''; nEl.value = ''; pEl.value = ''; if (rEl) rEl.value = '普通用户';
  renderUsersView();
  toast(`已创建账号 ${username}（${role === '老板' ? '管理员' : '普通用户'}）`);
}

function adminDeleteUser(idx) {
  if (!requireAdmin()) return;
  const u = users[idx];
  if (!u) return toast('账号不存在', false);
  if (u.username === currentUser.username) return toast('不能删除当前登录的账号', false);
  if (u.role === '老板' && users.filter(x => x.role === '老板').length <= 1) return toast('至少保留一个管理员账号', false);
  if (!confirm(`确认删除账号「${u.username}」？删除后该账号将无法登录。`)) return;
  users.splice(idx, 1);
  saveUsers(users);
  renderUsersView();
  toast(`已删除账号 ${u.username}`);
}

function adminSetRole(idx, role) {
  if (!requireAdmin()) return;
  const u = users[idx];
  if (!u) return toast('账号不存在', false);
  const target = role === '老板' ? '老板' : '普通用户';
  if (u.role === target) return;
  if (u.username === currentUser.username && target !== '老板') return toast('不能取消自己的管理员身份', false);
  if (target !== '老板' && users.filter(x => x.role === '老板').length <= 1) return toast('至少保留一个管理员账号', false);
  u.role = target;
  saveUsers(users);
  renderUsersView();
  toast(`已将 ${u.username} 设为${target === '老板' ? '管理员' : '普通用户'}`);
}

function adminResetPass(idx) {
  if (!requireAdmin()) return;
  const u = users[idx];
  if (!u) return toast('账号不存在', false);
  const np = prompt(`为账号「${u.username}」设置新口令（至少 6 位）：`);
  if (np === null) return;
  if ((np || '').length < 6) return toast('新口令至少 6 位', false);
  u.pass = hash(np);
  saveUsers(users);
  toast(`已重置 ${u.username} 的口令`);
}

// 通知原生壳：界面已就绪（用于关闭启动页/调整状态栏）
function notifyNativeReady() {
  try { if (window.AndroidBridge && window.AndroidBridge.onReady) window.AndroidBridge.onReady(); } catch (e) {}
  try { document.documentElement.classList.add('app-ready'); } catch (e) {}
}
