/**
 * 登录页深海生物层
 * --------------------------------------------------------------------------
 * 8 只生物（6 条鱼 + 龙虾 + 帝王蟹）全部是内联 SVG，鱼身统一"头朝右、
 * 尾朝左"绘制，往左游的时候整体 scaleX(-1) 翻转，这样不管往哪边游
 * 都是头在前、尾在后。
 *
 * 位移用 CSS @keyframes 而不是 requestAnimationFrame：后台标签页里
 * rAF 会被节流甚至暂停，动画直接卡住；CSS 动画交给合成线程，切走再
 * 回来也不会错位。每只生物的周期、相位、泳道都是运行时随机生成的，
 * 所以每次刷新看到的画面都不一样。
 *
 * 泳道刻意避开了中间的登录卡片（大约 26%~66% 高度），只在上下两条带
 * 里活动，不然鱼会从输入框上穿过去，很难看。
 */

// ---------- 登录页深海生物层：6 条鱼 + 1 只大龙虾 + 1 只帝王蟹 ----------
// 实现方式：为每只生物动态生成专属 @keyframes（外层横向巡游 + 翻转，内层上下浮动 + 摆尾）。
// 游向（向左/向右）、速度、纵向位置、摆动幅度、起始相位全部随机；
// 所有本体 SVG 一律「头朝右、尾朝左」绘制，向左巡游的个体在 keyframes 中固定 scaleX(-1) 翻转，
// 因此无论朝哪边游，永远是头在前、尾在后，绝不倒游。CSS 动画在任何浏览器/后台标签都稳定运行。
function initSeaLife() {
  const host = document.getElementById('lg-sealife');
  if (!host || host.dataset.done) return;
  host.dataset.done = '1';
  const R = (a, b) => a + Math.random() * (b - a);

  // 通用小鱼（头朝右）
  function fishSVG(id, w, c1, c2, fin) {
    return `<svg width="${w}" height="${Math.round(w * 0.6)}" viewBox="0 0 120 72" fill="none">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/><stop offset="0.55" stop-color="${c2}"/><stop offset="1" stop-color="${fin}"/>
      </linearGradient></defs>
      <path d="M32 36 L8 17 C14 30 14 42 8 55 Z" fill="${fin}" opacity=".8"/>
      <path d="M30 36 L4 12 C12 26 12 46 4 60 Z" fill="${c1}" opacity=".6"/>
      <ellipse cx="66" cy="36" rx="38" ry="21" fill="url(#${id})"/>
      <path d="M56 17 C62 7 76 5 84 11 C76 13 68 17 63 20 Z" fill="${fin}" opacity=".8"/>
      <path d="M60 55 C66 63 78 65 86 60 C78 58 70 55 66 52 Z" fill="${fin}" opacity=".55"/>
      <path d="M40 26 C48 20 62 18 74 22" stroke="#ffffff" stroke-opacity=".6" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M38 40 C48 46 62 48 74 44" stroke="#ffffff" stroke-opacity=".45" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="92" cy="30" r="5" fill="#0c4a6e"/><circle cx="90.2" cy="28.2" r="1.8" fill="#ffffff"/>
      <path d="M100 41 C103 44 107 44 110 41" stroke="#0c4a6e" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`;
  }

  // 大龙虾（头朝右：长触须在前，尾扇在后）
  function lobsterSVG(w) {
    const W = 170, H = 96;
    return `<svg width="${w}" height="${Math.round(w * H / W)}" viewBox="0 0 ${W} ${H}" fill="none">
      <defs><linearGradient id="slLob" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f87171"/><stop offset="0.5" stop-color="#dc2626"/><stop offset="1" stop-color="#991b1b"/>
      </linearGradient></defs>
      <path d="M34 48 L8 34 C14 44 14 52 8 62 Z" fill="#991b1b"/>
      <path d="M36 48 L14 26 C22 40 22 56 14 70 Z" fill="#dc2626" opacity=".85"/>
      <ellipse cx="62" cy="48" rx="26" ry="15" fill="url(#slLob)"/>
      <path d="M44 42 C50 39 58 39 64 42 M42 48 C50 45 60 45 68 48 M44 54 C50 57 58 57 64 54" stroke="#7f1d1d" stroke-opacity=".45" stroke-width="2.5" fill="none"/>
      <ellipse cx="106" cy="46" rx="32" ry="19" fill="url(#slLob)"/>
      <path d="M84 38 C96 33 116 33 128 38" stroke="#fee2e2" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"/>
      <g stroke="#b91c1c" stroke-width="4" stroke-linecap="round" fill="none">
        <path d="M64 58 C60 66 54 70 46 72"/><path d="M74 60 C72 68 68 74 62 78"/><path d="M84 60 C84 68 82 74 78 80"/>
      </g>
      <path d="M120 56 C132 62 142 70 148 80" stroke="#b91c1c" stroke-width="9" stroke-linecap="round" fill="none"/>
      <ellipse cx="152" cy="84" rx="12" ry="8" transform="rotate(24 152 84)" fill="#dc2626"/>
      <path d="M124 38 C136 32 146 26 152 20" stroke="#b91c1c" stroke-width="9" stroke-linecap="round" fill="none"/>
      <ellipse cx="154" cy="15" rx="12" ry="8" transform="rotate(-30 154 15)" fill="#dc2626"/>
      <path d="M134 40 C152 34 164 26 168 12" stroke="#dc2626" stroke-width="3.5" stroke-linecap="round" fill="none"/>
      <path d="M136 48 C154 50 164 56 168 66" stroke="#dc2626" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="126" cy="40" r="4.5" fill="#450a0a"/><circle cx="124.6" cy="38.6" r="1.5" fill="#ffffff"/>
    </svg>`;
  }

  // 帝王蟹（头朝右：一对大螯在前，尖长步足在后）
  function crabSVG(w) {
    const W = 130, H = 88;
    return `<svg width="${w}" height="${Math.round(w * H / W)}" viewBox="0 0 ${W} ${H}" fill="none">
      <defs><linearGradient id="slCrab" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fdba74"/><stop offset="0.55" stop-color="#f97316"/><stop offset="1" stop-color="#c2410c"/>
      </linearGradient></defs>
      <g stroke="#c2410c" stroke-width="5.5" stroke-linecap="round" fill="none">
        <path d="M62 58 C50 62 40 70 32 82"/><path d="M66 64 C56 70 50 78 46 88"/>
        <path d="M58 50 C44 50 34 54 24 62"/>
      </g>
      <g stroke="#c2410c" stroke-width="5.5" stroke-linecap="round" fill="none" transform="translate(120,0) scale(-1,1)">
        <path d="M62 58 C50 62 40 70 32 82"/><path d="M58 50 C44 50 34 54 24 62"/>
      </g>
      <ellipse cx="66" cy="44" rx="34" ry="24" fill="url(#slCrab)"/>
      <path d="M40 34 C50 27 82 27 92 34" stroke="#ffd7a8" stroke-opacity=".6" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <circle cx="52" cy="50" r="3" fill="#c2410c" opacity=".5"/><circle cx="80" cy="52" r="3" fill="#c2410c" opacity=".4"/>
      <path d="M94 40 C104 32 112 24 118 18" stroke="#e2590b" stroke-width="8" stroke-linecap="round" fill="none"/>
      <ellipse cx="120" cy="14" rx="11" ry="8" transform="rotate(-24 120 14)" fill="#ea580c"/>
      <path d="M96 52 C106 56 114 62 120 68" stroke="#e2590b" stroke-width="8" stroke-linecap="round" fill="none"/>
      <ellipse cx="122" cy="70" rx="11" ry="8" transform="rotate(24 122 70)" fill="#ea580c"/>
      <path d="M92 34 L102 26 M92 38 L104 34" stroke="#c2410c" stroke-width="4" stroke-linecap="round"/>
      <circle cx="103" cy="25" r="4.5" fill="#450a0a"/><circle cx="101.8" cy="23.8" r="1.5" fill="#ffffff"/>
      <circle cx="105" cy="33" r="4.5" fill="#450a0a"/><circle cx="103.8" cy="31.8" r="1.5" fill="#ffffff"/>
    </svg>`;
  }

  // 生物清单：6 条鱼（异色异速）+ 大龙虾 + 帝王蟹
  const defs = [
    { svg: fishSVG('slf1', 88, '#38bdf8', '#0284c7', '#075985'), w: 88,  spd: R(42, 60) },
    { svg: fishSVG('slf2', 66, '#22d3ee', '#0891b2', '#155e75'), w: 66,  spd: R(34, 52) },
    { svg: fishSVG('slf3', 58, '#818cf8', '#6366f1', '#3730a3'), w: 58,  spd: R(36, 54) },
    { svg: fishSVG('slf4', 78, '#fbbf24', '#d97706', '#92400e'), w: 78,  spd: R(30, 48) },
    { svg: fishSVG('slf5', 52, '#34d399', '#0d9488', '#115e59'), w: 52,  spd: R(40, 58) },
    { svg: fishSVG('slf6', 62, '#94a3b8', '#64748b', '#334155'), w: 62,  spd: R(28, 44) },
    { svg: lobsterSVG(126), w: 126, spd: R(22, 34) },
    { svg: crabSVG(96),     w: 96,  spd: R(18, 30) },
  ];

  const W = Math.max(600, host.clientWidth || window.innerWidth);
  const H = Math.max(400, host.clientHeight || window.innerHeight);
  const M = 120;                       // 屏幕外缓冲
  let css = '';
  const frag = document.createDocumentFragment();

  defs.forEach((d, i) => {
    const toRight = i % 2 === 0 ? Math.random() < 0.5 : Math.random() < 0.5;   // 游向随机
    const dur = (W + 2 * M) / d.spd;                // 巡游周期（秒）
    // 纵向泳道：8 只生物均匀分层 + 抖动，保证上下错落、互不扎堆
    // 泳道避开中央登录卡片区（约 26%~66% 高度）：上下两条带内分层 + 抖动
    const band = i % 2 === 0 ? [0.03, 0.24] : [0.68, 0.93];
    const top = (band[0] + Math.random() * (band[1] - band[0])) * H;
    const delay = -R(0, dur);                       // 负延迟随机相位，避免扎堆
    const amp = R(10, 22), bobDur = R(2.2, 3.8);
    css += `@keyframes slMv${i}{from{transform:translate3d(${toRight ? -M : W + M}px,0,0) scaleX(${toRight ? 1 : -1})}to{transform:translate3d(${toRight ? W + M : -M}px,0,0) scaleX(${toRight ? 1 : -1})}}
@keyframes slBob${i}{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-${amp.toFixed(0)}px) rotate(4deg)}}`;
    const el = document.createElement('div');
    el.className = 'lg-sea';
    el.style.top = top.toFixed(0) + 'px';
    el.style.opacity = d.w > 100 ? '0.96' : R(0.78, 0.94).toFixed(2);
    el.style.animation = `slMv${i} ${dur.toFixed(1)}s linear ${delay.toFixed(1)}s infinite`;
    el.innerHTML = `<div style="animation:slBob${i} ${bobDur.toFixed(1)}s ease-in-out infinite">${d.svg}</div>`;
    frag.appendChild(el);
  });

  const styleTag = document.createElement('style');
  styleTag.textContent = css;
  document.head.appendChild(styleTag);
  host.appendChild(frag);
}
