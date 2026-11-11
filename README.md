# 鲲鉴智策 · 可解释时序预测与决策平台（分层源码版）

面向水产批发等小微批发企业的端侧智能预测系统：**LSTM 三子网集成 + 轻量 TCN + DLinear / NLinear** 四种深度时序模型同台回测择优，配套**精确 Shapley 归因**等可解释性分析，全程纯 JavaScript 实现、完全离线运行。

> 本目录为**分层分文件**的工程化源码版本，功能与单文件版完全一致。
> 如需"双击一个 HTML 即用"的交付版，请使用配套的 `鲲鉴智策.html`（单文件内联版）。

## 运行方式

### 方式一：直接双击（file:// 协议）

用 Chrome / Edge 打开 `index.html` 即可。所有依赖均为本地文件、无任何网络请求，**断网可用**。

> 说明：为兼容 file:// 协议，本项目采用普通 `<script>` 顺序加载而非 ES Module（ES Module 在 file:// 下会被 CORS 策略阻止）。

### 方式二：本地静态服务器（推荐开发调试）

```bash
# 任选其一
python3 -m http.server 8080
npx serve .
```

访问 `http://localhost:8080`。

**默认账号**：`admin / admin123`（登录页有「一键填入」按钮）
**重置密钥**：`888888`

首次打开自动载入 820 条水产送货演示数据（约 120 天 × 3 客户 × 10 品名），全部功能开箱即用。

## 目录结构

```
鲲鉴/
├── index.html                     # 页面骨架（仅 DOM 与资源引用，无业务逻辑）
│
├── css/                           # ── 样式层 ──
│   ├── base.css                   #   基础样式：排版、表格、表单、卡片
│   ├── theme.css                  #   端侧适配：安全区、点击高亮
│   └── login.css                  #   登录页：深海渐变、光斑动效、玻璃拟态
│
├── js/                            # ── 脚本层（按依赖顺序加载）──
│   ├── core/                      #   核心层
│   │   ├── auth.js                #     身份认证：登录/注册/重置/改密/会话
│   │   ├── store.js               #     数据层：localStorage、演示数据
│   │   ├── utils.js               #     通用工具：格式化、Toast、转义
│   │   └── nav.js                 #     导航：页签切换、一键填入
│   ├── pages/                     #   业务页面层
│   │   ├── records.js             #     送货明细：列表/筛选/编辑弹窗
│   │   ├── reconcile.js           #     月度对账：汇总/对账单/Excel 导出
│   │   ├── customers.js           #     客户管理：档案与累计统计
│   │   └── io.js                  #     数据进出：Excel 导入导出、JSON 备份
│   ├── models/                    #   模型层（纯函数，无 DOM 依赖）
│   │   ├── metrics.js             #     指标与回测：WAPE、分块滚动回测
│   │   ├── linear.js              #     DLinear / NLinear：岭回归闭式解
│   │   ├── tcn.js                 #     轻量 TCN：膨胀因果卷积 + 反向传播
│   │   └── lstm.js                #     LSTM：前向 + BPTT + Adam
│   ├── forecast.js                #   预测编排：训练调度、四模型竞技、择优
│   ├── charts/                    #   可视化层
│   │   ├── forecast-chart.js      #     预测双面板 SVG（回测验证+走势）
│   │   └── xai-charts.js          #     Canvas：效能/SHAP/敏感度/周期/置信带
│   ├── xai.js                     #   可解释引擎：精确 Shapley、解读与导出
│   ├── report.js                  #   经营分析报告：生成/渲染/导出
│   └── main.js                    #   入口：初始化与自动登录（必须最后加载）
│
└── vendor/                        # ── 第三方库（本地化，离线可用）──
    ├── tailwind.js                #   Tailwind CSS 运行时（Play CDN 版）
    └── xlsx.bundle.js             #   xlsx-js-style 1.2.0（Excel 导入导出）
```

## 模块加载顺序（重要）

```
core/auth → core/store → core/utils → core/nav
  → pages/records → pages/reconcile → pages/customers → pages/io
  → models/metrics → models/linear → models/tcn → models/lstm
  → forecast.js
  → charts/forecast-chart → charts/xai-charts
  → xai.js → report.js → main.js
```

- 模块间通过**全局作用域**协作（函数声明跨文件可用），`index.html` 中的顺序即依赖顺序，**不可调整**。
- 模型层（`models/`）为纯函数、零 DOM 依赖，可单独抽出在 Node.js 中复用。

## 技术要点

| 模块 | 说明 |
|---|---|
| 四模型竞技 | LSTM 集成（3 子网）、轻量 TCN（3 膨胀子网）、DLinear、NLinear 统一留出回测，WAPE 择优 |
| 精确 SHAP | 7 天窗口 2⁷ 全子集枚举（448 次前向），可加性误差为 0 |
| 确定性复现 | 固定随机种子，任意机器重跑结果一致 |
| 端侧离线 | 零网络请求，数据不出浏览器本地 |

## 环境要求

- 现代浏览器：Chrome 90+ / Edge 90+ / Safari 14+ / Firefox 90+
- 无需安装任何依赖；`vendor/` 内已含全部第三方库
