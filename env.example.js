/**
 * 页面侧环境变量对象模板（JS 形态）
 */
window.KJ_ENV = {
  RESET_KEY: '',              // 账号「找回密码」校验密钥
  DEMO_ADMIN_PASS: '',        // 演示管理员 admin 的初始口令
  LLM_API_KEY: '',            // 大模型
  LLM_BASE_URL: '',           // API 基址
  LLM_MODEL: '',              // 对话模型
  LLM_ASR_MODEL: '',          // 语音转写模型，留空用 whisper-1
  LLM_VISION_MODEL: ''        // 视觉模型（图片识别），留空沿用对话模型
};
