/**
 * 环境变量构建脚本
 * --------------------------------------------------------------------------
 * 职责：把 .env（或进程环境变量）中的敏感配置，生成为页面可读的 js/env.js。
 *
 * 用法：
 *   node scripts/build-env.mjs           从 .env / 环境变量生成 js/env.js
 *   node scripts/build-env.mjs --empty   忽略所有取值，生成空值模板（提交前执行）
 *
 * 变量白名单：RESET_KEY、DEMO_ADMIN_PASS、LLM_API_KEY、
 *             LLM_BASE_URL、LLM_MODEL、LLM_ASR_MODEL、LLM_VISION_MODEL
 *             （白名单之外的环境变量一律忽略，不会被写入产物）
 * 取值优先级：进程环境变量 > 项目根目录 .env > 空串（便于 CI 覆盖本地文件）
 * 约束：不做网络请求、不读取白名单以外的变量、不依赖任何第三方包。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WHITELIST = [
  'RESET_KEY',
  'DEMO_ADMIN_PASS',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_ASR_MODEL',
  'LLM_VISION_MODEL'
];
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_FILE = join(ROOT, '.env');
const TARGET = join(ROOT, 'js', 'env.js');
const EMPTY_MODE = process.argv.includes('--empty');

/** 解析 .env：忽略空行与 # 注释，支持 KEY=VALUE、引号包裹 */
function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 生成 js/env.js 全文；值统一走 JSON.stringify，避免引号/反斜杠破坏语法 */
function render(values) {
  const body = WHITELIST.map(
    (key) => `    ${key}: ${JSON.stringify(values[key] || '')}`
  ).join(',\n');
  return `/**
 * 运行时环境配置
 * --------------------------------------------------------------------------
 * 本文件由 scripts/build-env.mjs 生成，请勿手工编辑。
 *   生成：node scripts/build-env.mjs
 *   还原：node scripts/build-env.mjs --empty
 *
 * 约定：本文件随仓库提交，公开仓库中只允许是空值模板，不得承载任何真实密钥；
 *       真实值只存在于本机 .env、env.local.js 或部署平台的环境变量面板。
 *       未配置任何取值时，业务代码回落到本地调试兜底值，双击 index.html 即可运行。
 * 模板见根目录 .env.example 与《环境配置.txt》。
 */
window.KJ_ENV = Object.assign(window.KJ_ENV || {}, {
${body}
});
`;
}

/** 只显示前 2 位与长度，避免把真实值打到控制台/CI 日志 */
function mask(value) {
  if (!value) return '(空)';
  return `${value.slice(0, 2)}***（长度 ${value.length}）`;
}

let fileEnv = {};
if (!EMPTY_MODE) {
  if (existsSync(ENV_FILE)) {
    fileEnv = parseEnv(readFileSync(ENV_FILE, 'utf8'));
    console.log('[build-env] 已读取 .env');
  } else {
    console.log('[build-env] 未找到 .env，本次生成空值模板（业务侧将回落到本地兜底值）');
  }
}

const values = {};
let hasSecret = false;
for (const key of WHITELIST) {
  if (EMPTY_MODE) {
    values[key] = '';
    continue;
  }
  const fromProcess = process.env[key];
  const value =
    fromProcess !== undefined && fromProcess !== ''
      ? fromProcess
      : fileEnv[key] || '';
  values[key] = value;
  if (value) hasSecret = true;
}

writeFileSync(TARGET, render(values), 'utf8');

console.log(`[build-env] 已生成 ${TARGET}${EMPTY_MODE ? '（--empty 空值模板）' : ''}`);
for (const key of WHITELIST) {
  console.log(`[build-env]   ${key.padEnd(16)} ${mask(values[key])}`);
}

if (hasSecret) {
  console.log(
    '[build-env] ⚠ 产物包含非空配置，仅可用于本地/私有部署；提交公开仓库前请执行：node scripts/build-env.mjs --empty'
  );
}
