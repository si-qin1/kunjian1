/**
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
    RESET_KEY: "",
    DEMO_ADMIN_PASS: "",
    LLM_API_KEY: "",
    LLM_BASE_URL: "",
    LLM_MODEL: "",
    LLM_ASR_MODEL: "",
    LLM_VISION_MODEL: ""
});
