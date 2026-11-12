/**
 * 预测模型集合（纯 JavaScript，手写前向与反向传播）
 * --------------------------------------------------------------------------
 * 最早只写了 LSTM 和 TCN 两个基线，用来验证手写梯度到底能不能收敛；
 * 确认没问题之后才陆续补了 Transformer 系的 PatchTST，以及 PhaseFormer、
 * MixLinear、FreqLite 三个自研结构，形成现在七模型同台比对的局面。
 *
 * 所有模型都遵循同一套约定：
 *   build(...)  初始化参数（权重用固定种子的高斯分布，保证可复现）
 *   forward(x)  返回预测值，同时把中间量缓存下来给反向用
 *   backward()  按缓存的中间量回传梯度，Adam 更新
 * 不依赖任何深度学习框架，是为了让整个系统能塞进一个静态页面里跑。
 *
 * 训练统一用分块滚动回测：每 H 天重置一次输入窗口，避免多步递推把
 * 误差越滚越大，这样算出来的 WAPE 才和真实排产场景接近。
 */

// ================= 智能预测引擎 =================
function refreshFcSelects() {
  const names = [...new Set(db.records.map(r => r.customer).filter(Boolean))].sort();
  const prods = [...new Set(db.records.map(r => r.product).filter(Boolean))].sort();
  const fc = document.getElementById('fc-customer');
  const fp = document.getElementById('fc-product');
  if (fc) fc.innerHTML = '<option value="">全部客户</option>' + names.map(n => '<option>' + esc(n) + '</option>').join('');
  if (fp) fp.innerHTML = '<option value="">全部品名</option>' + prods.map(n => '<option>' + esc(n) + '</option>').join('');
}

// 构建按日聚合的时间序列（缺失日期补 0）
function buildFcSeries(metric, customer, product) {
  const map = {};
  db.records.forEach(r => {
    if (!r.date) return;
    if (customer && r.customer !== customer) return;
    if (product && r.product !== product) return;
    const v = metric === 'qty' ? (+r.qty || 0) : (r.qty || 0) * (r.price || 0);
    map[r.date] = (map[r.date] || 0) + v;
  });
  const keys = Object.keys(map).sort();
  if (keys.length < 2) return [];
  const out = [];
  let d = new Date(keys[0]), last = new Date(keys[keys.length - 1]);
  while (d <= last) {
    const ds = d.toISOString().slice(0, 10);
    out.push({ date: ds, v: +(map[ds] || 0) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ---------- 轻量深度时序模型（纯 JS）：TCN / PhaseFormer（相位-频带 token 自注意力） / MixLinear（门控混合线性专家） ----------
const SEQ_L = 14;        // 回看窗口长度（小样本下 14 天最稳）

function winStats(w) {
  const mu = w.reduce((a, b) => a + b, 0) / (w.length || 1);
  let s = 0; for (const v of w) s += (v - mu) * (v - mu);
  return { mu, sd: Math.sqrt(s / (w.length || 1)) || 1e-6 };
}
function paddedWin(win, L) {
  const w = win.slice(-L);
  while (w.length < L) w.unshift(w.length ? w[0] : 0);
  return w;
}
// ---------- PhaseFormer：相位-频带 token 注意力预测器 ----------
// 机制：窗口 → rFFT → 6 个频带 token（log幅值 / 相位 cos·sin / 相干性 / 能量占比）
//       → 共享线性投影 + 频带位置嵌入 → 单头自注意力（残差）→ 均值池化 ⊕ 末值捷径 → 线性头
//       全参数 Adam 端到端训练；inspect() 暴露频带注意力矩阵与相位谱用于机制可视化
const PF_BANDS = 6, PF_D = 12;
function pfBandTokens(xn, L){
  const HB = Math.floor(L/2);                    // rFFT 非负频点数（不含 DC）
  const Xr=new Array(HB+1).fill(0), Xi=new Array(HB+1).fill(0);
  for(let k=0;k<=HB;k++){ let sr=0,si=0;
    for(let n=0;n<L;n++){ const th=-2*Math.PI*k*n/L, c=Math.cos(th), s=Math.sin(th);
      sr+=xn[n]*c; si+=xn[n]*s; } Xr[k]=sr; Xi[k]=si; }
  const eTot=Xr.slice(1).reduce((a,r,i)=>a+r*r+Xi[i+1]*Xi[i+1],0)||1e-9;
  const toks=[], bounds=[];
  for(let b=0;b<PF_BANDS;b++){
    const a0=1+Math.floor((HB-1)*b/PF_BANDS), a1=1+Math.floor((HB-1)*(b+1)/PF_BANDS);
    bounds.push([a0,Math.max(a1,a0+1)]);
  }
  for(const [a0,a1] of bounds){
    let amp=0,sr=0,si=0,sa=0,e=0;
    for(let k=a0;k<a1;k++){ const xr=Xr[k],xi=Xi[k],m=Math.hypot(xr,xi);
      amp+=m; sr+=xr; si+=xi; sa+=m; e+=m*m; }
    const cnt=a1-a0; amp/=cnt;
    const ph=Math.atan2(si,sr), coh=sa>1e-9?Math.hypot(sr,si)/sa:0;
    const fMid=(a0+a1-1)/2/HB;
    toks.push([Math.log1p(amp*10), Math.cos(ph), Math.sin(ph), coh, fMid, e/eTot]);
  }
  return { toks, bands:bounds.map(([a0,a1])=>[a0,a1]), Xr, Xi, HB };
}
function phaseFormerFit(data, L, H, EP){
  EP = EP || 80;
  const rnd = kyunRng(20260101);
  const proj = linCreate(6, PF_D, rnd);          // 频带特征 6 维 → 注意力空间
  const bemb = xavierMat(PF_BANDS, PF_D, rnd);   // 频带位置嵌入
  const att  = attCreate(PF_D, rnd);             // 频带间自注意力
  const head = linCreate(PF_D + 3, H, rnd);      // 池化向量 ⊕ 末值捷径 → 多步预测
  const mb = Array.from({length:PF_BANDS},()=>new Array(PF_D).fill(0));
  const vb = Array.from({length:PF_BANDS},()=>new Array(PF_D).fill(0));
  let t = 0;
  function core(win){
    const {mu,sd,xn} = winNorm(paddedWin(win,L));
    const {toks} = pfBandTokens(xn, L);
    const E = linF(proj, toks).map((row,b)=>row.map((v,d)=>v+bemb[b][d]));
    const O = attF(att, E);
    const OW = linF(att.Wo, O);
    const H1 = E.map((e,ti)=>e.map((v,d)=>v+OW[ti][d]));
    const mp = new Array(PF_D).fill(0);
    for(const row of H1) for(let d=0;d<PF_D;d++) mp[d]+=row[d]/PF_BANDS;
    const last=xn[L-1], mean=xn.reduce((a,b)=>a+b,0)/L;
    const slope=(xn[L-1]-xn[L-4])/3;
    mp.push(last, mean, slope);
    const yz = linF(head,[mp])[0];
    return { mu,sd,H1,yz };
  }
  function stepFn(xraw,yraw,lr){
    const c = core(xraw); t++;
    linZero(proj); linZero(att.Wq); linZero(att.Wk); linZero(att.Wv); linZero(att.Wo); linZero(head);
    const yn = yraw.map(v=>(v-c.mu)/c.sd);
    const dYhat = c.yz.map((p,i)=>2*(p-yn[i])/H);
    const dMP = linB(head,[dYhat])[0];
    const dH1 = c.H1.map(()=>dMP.slice(0,PF_D).map(v=>v/PF_BANDS));
    const dO  = linB(att.Wo, dH1);             // OW = Wo·O，dOW=dH1
    const dE2 = attB(att, dO);
    const dE  = dH1.map((r,ti)=>r.map((v,d)=>v+dE2[ti][d]));
    linB(proj, dE);
    const dEmb = Array.from({length:PF_BANDS},()=>new Array(PF_D).fill(0));
    for(let b=0;b<PF_BANDS;b++) for(let d=0;d<PF_D;d++) dEmb[b][d]=dE[b][d];
    adamMat(bemb, dEmb, mb, vb, lr, t);
    linAdam(proj,lr,t); linAdam(att.Wq,lr,t); linAdam(att.Wk,lr,t); linAdam(att.Wv,lr,t);
    linAdam(att.Wo,lr,t); linAdam(head,lr,t);
    let loss=0; for(let i=0;i<H;i++){ const e=c.yz[i]-yn[i]; loss+=e*e; } return loss/H;
  }
  const samples = makeSamples(data, L, H, 2);
  if (samples.length < 10) return null;
  for(let ep=0; ep<EP; ep++){
    const lr = 0.02*(1-ep/EP*0.85);
    let ls=0; for(const s of samples) ls+=stepFn(s.x,s.y,lr);
    if(!isFinite(ls)) return null;
  }
  return {
    L, H, kind: 'pf',
    predict(win){
      const c = core(paddedWin(win,L));
      return c.yz.map(v=>Math.max(0, v*c.sd+c.mu));
    },
    inspect(win){
      const w = paddedWin(win,L);
      const {mu,sd,xn} = winNorm(w);
      const spec = pfBandTokens(xn, L);
      const E = linF(proj, spec.toks).map((row,b)=>row.map((v,d)=>v+bemb[b][d]));
      attF(att, E);
      const A = att._c.A.map(r=>r.slice());
      return { A, amp: spec.toks.map(tk=>tk[0]), phase: spec.toks.map(tk=>Math.atan2(tk[2],tk[1])), energy: spec.toks.map(tk=>tk[5]), bands: spec.bands };
    }
  };
}

// ---------- MixLinear：门控混合线性专家（极限轻量，~0.6K 参数） ----------
// 机制：三个确定性特征视图专家——E1 全窗口 / E2 一阶差分（近期动态）/ E3 因果平滑（趋势），
//       每个专家以岭回归闭式解拟合多步映射；门控 g = softmax(Wg·[窗口描述4维 ⊕ 三专家首步预测3维])
//       经 Adam 端到端训练（栈式泛化），按窗口形态自动分工；inspect() 暴露门控权重
function mixRidgeFit(X, Y, lam){
  const n=X.length, p=X[0].length, H=Y[0].length;
  const A=Array.from({length:p},()=>new Array(p).fill(0));
  const B=Array.from({length:p},()=>new Array(H).fill(0));
  for(let i=0;i<n;i++){ const xi=X[i],yi=Y[i];
    for(let a=0;a<p;a++){ const xa=xi[a];
      for(let b=a;b<p;b++) A[a][b]+=xa*xi[b];
      for(let h=0;h<H;h++) B[a][h]+=xa*yi[h]; } }
  for(let a=0;a<p;a++){ for(let b=a+1;b<p;b++) A[b][a]=A[a][b]; A[a][a]+=lam*n; }
  const M=A.map((row,i)=>row.concat(B[i]));
  for(let c=0;c<p;c++){ let piv=c;
    for(let r=c+1;r<p;r++) if(Math.abs(M[r][c])>Math.abs(M[piv][c])) piv=r;
    if(piv!==c){ const t=M[piv]; M[piv]=M[c]; M[c]=t; }
    const d=M[c][c]||1e-12;
    for(let j=c;j<p+H;j++) M[c][j]/=d;
    for(let r=0;r<p;r++){ if(r===c) continue; const f=M[r][c]; if(!f) continue;
      for(let j=c;j<p+H;j++) M[r][j]-=f*M[c][j]; } }
  return Array.from({length:p},(_,a)=>Array.from({length:H},(_,h)=>M[a][p+h]||0));
}
function mixLinearFit(data, L, H, EP){
  EP = EP || 300;
  const K = 3, lam = 0.3, entLam = 0.05;
  const rnd = kyunRng(20260201);
  const samples = makeSamples(data, L, H, 2);
  if (samples.length < 10) return null;
  function viewsOf(xn){
    const dx = xn.map((v,i)=>v-(i?xn[i-1]:xn[0]));
    const sm = xn.map((_,i)=>{ const a=Math.max(0,i-2); let s=0; for(let j=a;j<=i;j++) s+=xn[j]; return s/(i-a+1); });
    return [xn, dx, sm];
  }
  // 1) 标准化样本组装
  const prep = samples.map(s=>{
    const st = winStats(s.x), xn = s.x.map(v=>(v-st.mu)/st.sd);
    const last = xn[L-1];
    const vs = viewsOf(xn);
    const yn = s.y.map(v=>(v-st.mu)/st.sd-last);
    return { st, vs, yn, last };
  });
  // 2) 三专家岭回归闭式解
  const Wk = [];
  for(let k=0;k<K;k++){
    const X = prep.map(p=>p.vs[k].concat([1]));
    Wk.push(mixRidgeFit(X, prep.map(p=>p.yn), lam));
  }
  function EoutOf(p){
    return p.vs.map((f,k)=>{
      const xw=f.concat([1]);
      const o=new Array(H).fill(0);
      for(let i=0;i<=L;i++){ const wi=Wk[k][i]; for(let h=0;h<H;h++) o[h]+=xw[i]*wi[h]; }
      return o;
    });
  }
  // 3) 门控特征：窗口描述 4 维（均值/波动/末值差分/斜率，按波动归一）⊕ 三专家首步预测 3 维
  function descOf(p, Eo){
    const xn=p.vs[0];
    const mean=xn.reduce((a,c)=>a+c,0)/L;
    let v=0; for(const c of xn) v+=(c-mean)*(c-mean);
    const sd=Math.sqrt(v/L)||1e-6;
    const base=[mean/sd, sd/2, (xn[L-1]-xn[L-2])/sd, (xn[L-1]-xn[L-4])/(3*sd)];
    if(!Eo) return base;
    return base.concat(Eo.map(e=>e[0]/Math.max(sd,1e-6)));
  }
  const Eout = prep.map(EoutOf);
  const descr = prep.map(p=>descOf(p, EoutOf(p)));
  // 4) 门控 Adam 训练（softmax 栈式泛化 + 轻微熵正则）
  const Wg = Array.from({length:7},()=>[0,0,0]), bg = [0,0,0];
  const mW = Array.from({length:7},()=>[0,0,0]), vW = Array.from({length:7},()=>[0,0,0]);
  const mb = [0,0,0], vb = [0,0,0];
  let t = 0;
  for(let ep=0;ep<EP;ep++){
    const lr = 0.05*(1-ep/EP*0.9);
    const gWg = Array.from({length:7},()=>[0,0,0]), gbg = [0,0,0];
    for(let i=0;i<prep.length;i++){
      const d = descr[i];
      const logits=[0,1,2].map(k=>{ let s=bg[k]; for(let a=0;a<7;a++) s+=d[a]*Wg[a][k]; return s; });
      const mx=Math.max(...logits), ex=logits.map(s=>Math.exp(s-mx)), Z=ex.reduce((a,c)=>a+c,0);
      const g=ex.map(e=>e/Z);
      const z=new Array(H).fill(0);
      for(let k=0;k<K;k++) for(let h=0;h<H;h++) z[h]+=g[k]*Eout[i][k][h];
      const dOut=z.map((p2,h)=>2*(p2-prep[i].yn[h])/H);
      const dPre=[0,1,2].map(k=>{ let dot=0; for(let h=0;h<H;h++) dot+=dOut[h]*Eout[i][k][h]; return g[k]*dot; });
      let gDot=0; for(let k=0;k<K;k++) gDot+=g[k]*dPre[k];
      const dLogit=[0,1,2].map(k=>g[k]*(dPre[k]-gDot)-entLam*g[k]*(1+Math.log(g[k]+1e-9))/prep.length);
      for(let a=0;a<7;a++) for(let k=0;k<K;k++) gWg[a][k]+=d[a]*dLogit[k];
      for(let k=0;k<K;k++) gbg[k]+=dLogit[k];
    }
    const nn=prep.length; t++;
    for(let a=0;a<7;a++) for(let k=0;k<K;k++){
      const g=gWg[a][k]/nn;
      mW[a][k]=0.9*mW[a][k]+0.1*g; vW[a][k]=0.999*vW[a][k]+0.001*g*g;
      const c1=1-Math.pow(0.9,t), c2=1-Math.pow(0.999,t);
      Wg[a][k]-=lr*(mW[a][k]/c1)/(Math.sqrt(vW[a][k]/c2)+1e-8);
    }
    for(let k=0;k<K;k++){
      const g=gbg[k]/nn;
      mb[k]=0.9*mb[k]+0.1*g; vb[k]=0.999*vb[k]+0.001*g*g;
      const c1=1-Math.pow(0.9,t), c2=1-Math.pow(0.999,t);
      bg[k]-=lr*(mb[k]/c1)/(Math.sqrt(vb[k]/c2)+1e-8);
    }
  }
  function core(win){
    const w=win.slice(-L); while(w.length<L) w.unshift(w.length?w[0]:0);
    const st=winStats(w), xn=w.map(v=>(v-st.mu)/st.sd), last=xn[L-1];
    const vs=viewsOf(xn);
    const Eo=vs.map((f,k)=>{ const xw=f.concat([1]); const o=new Array(H).fill(0);
      for(let i=0;i<=L;i++){ const wi=Wk[k][i]; for(let h=0;h<H;h++) o[h]+=xw[i]*wi[h]; } return o; });
    const d=descOf({vs}, Eo);
    const logits=[0,1,2].map(k=>{ let s=bg[k]; for(let a=0;a<7;a++) s+=d[a]*Wg[a][k]; return s; });
    const mx=Math.max(...logits), ex=logits.map(s=>Math.exp(s-mx)), Z=ex.reduce((a,c)=>a+c,0);
    const g=ex.map(e=>e/Z);
    const z=new Array(H).fill(0);
    for(let k=0;k<K;k++) for(let h=0;h<H;h++) z[h]+=g[k]*Eo[k][h];
    return { st, last, z, g };
  }
  return {
    L, H, kind: 'ml',
    predict(win){
      const c = core(win);
      return c.z.map(v=>Math.max(0,(v+c.last)*c.st.sd+c.st.mu));
    },
    inspect(win){
      return { gate: core(win).g.slice() };
    }
  };
}

// ---------- 轻量 TCN：3 层因果膨胀卷积 + 残差，直出多步 ----------
function tcnCreate(seed, C, L, H) {
  const rnd = lstmRng(seed), rand = () => (rnd() * 2 - 1) * 0.22;
  const cfg = [{ k: 3, d: 1 }, { k: 3, d: 2 }, { k: 3, d: 4 }];
  const layers = []; let cin = 1;
  for (const c of cfg) {
    layers.push({
      cin, cout: C, k: c.k, d: c.d,
      W: Array.from({ length: C }, () => Array.from({ length: cin }, () => Array.from({ length: c.k }, rand))),
      b: new Array(C).fill(0),
      mW: Array.from({ length: C }, () => Array.from({ length: cin }, () => new Array(c.k).fill(0))),
      vW: Array.from({ length: C }, () => Array.from({ length: cin }, () => new Array(c.k).fill(0))),
      mb: new Array(C).fill(0), vb: new Array(C).fill(0)
    });
    cin = C;
  }
  return {
    C, L, H, layers, t: 0,
    Wo: Array.from({ length: H }, () => Array.from({ length: C }, rand)),
    bo: new Array(H).fill(0),
    mWo: Array.from({ length: H }, () => new Array(C).fill(0)),
    vWo: Array.from({ length: H }, () => new Array(C).fill(0)),
    mbo: new Array(H).fill(0), vbo: new Array(H).fill(0)
  };
}
function tcnForward(net, xs) {
  let inp = [xs.slice()];
  const caches = [];
  for (const ly of net.layers) {
    const T = inp[0].length, pre = [], out = [];
    for (let o = 0; o < ly.cout; o++) {
      const po = new Array(T).fill(0), Wo = ly.W[o], b = ly.b[o];
      for (let t = 0; t < T; t++) {
        let a = b;
        for (let ci = 0; ci < ly.cin; ci++) {
          const row = Wo[ci], ic = inp[ci];
          for (let k = 0; k < ly.k; k++) { const tt = t - ly.d * k; if (tt >= 0) a += row[k] * ic[tt]; }
        }
        po[t] = a;
      }
      pre.push(po);
      const oo = po.slice();
      for (let t = 0; t < T; t++) if (oo[t] < 0) oo[t] = 0;
      if (ly.cin === ly.cout) { const src = inp[o]; for (let t = 0; t < T; t++) oo[t] += src[t]; }
      out.push(oo);
    }
    caches.push({ inp, pre, out, ly });
    inp = out;
  }
  const T = xs.length, last = new Array(net.C);
  for (let c = 0; c < net.C; c++) last[c] = inp[c][T - 1];
  const y = new Array(net.H).fill(0);
  for (let h = 0; h < net.H; h++) {
    let s = net.bo[h];
    for (let c = 0; c < net.C; c++) s += net.Wo[h][c] * last[c];
    y[h] = s;
  }
  return { y, caches, last, T };
}
function adamApply(p, g, m, v, lr, t) {
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  const m1 = b1 * m + (1 - b1) * g, v1 = b2 * v + (1 - b2) * g * g;
  const mh = m1 / (1 - Math.pow(b1, t)), vh = v1 / (1 - Math.pow(b2, t));
  return [p - lr * mh / (Math.sqrt(vh) + eps), m1, v1];
}
function tcnTrainStep(net, xraw, yraw, lr) {
  const st = winStats(xraw);
  const xs = xraw.map(v => (v - st.mu) / st.sd), ys = yraw.map(v => (v - st.mu) / st.sd);
  const fw = tcnForward(net, xs), T = fw.T, H = net.H;
  let loss = 0;
  const dy = new Array(H);
  for (let h = 0; h < H; h++) { const e = fw.y[h] - ys[h]; loss += e * e; dy[h] = 2 * e / H; }
  loss /= H;
  net.t++;
  const t = net.t;
  for (let h = 0; h < H; h++) {
    for (let c = 0; c < net.C; c++) {
      const [np, nm, nv] = adamApply(net.Wo[h][c], dy[h] * fw.last[c], net.mWo[h][c], net.vWo[h][c], lr, t);
      net.Wo[h][c] = np; net.mWo[h][c] = nm; net.vWo[h][c] = nv;
    }
    const [nb, nmb, nvb] = adamApply(net.bo[h], dy[h], net.mbo[h], net.vbo[h], lr, t);
    net.bo[h] = nb; net.mbo[h] = nmb; net.vbo[h] = nvb;
  }
  let dOut = Array.from({ length: net.C }, () => new Array(T).fill(0));
  for (let c = 0; c < net.C; c++) {
    let s = 0; for (let h = 0; h < H; h++) s += dy[h] * net.Wo[h][c];
    dOut[c][T - 1] = s;
  }
  for (let li = net.layers.length - 1; li >= 0; li--) {
    const ly = net.layers[li], ca = fw.caches[li];
    const dinp = Array.from({ length: ly.cin }, () => new Array(T).fill(0));
    if (ly.cin === ly.cout) for (let o = 0; o < ly.cout; o++) { const row = dOut[o]; for (let tt = 0; tt < T; tt++) dinp[o][tt] += row[tt]; }
    const gW = Array.from({ length: ly.cout }, () => Array.from({ length: ly.cin }, () => new Array(ly.k).fill(0)));
    const gb = new Array(ly.cout).fill(0);
    for (let o = 0; o < ly.cout; o++) {
      const drow = dOut[o];
      for (let tt = 0; tt < T; tt++) {
        const d = ca.pre[o][tt] > 0 ? drow[tt] : 0;
        if (!d) continue;
        gb[o] += d;
        for (let ci = 0; ci < ly.cin; ci++) {
          const ic = ca.inp[ci], g = gW[o][ci], wrow = ly.W[o][ci];
          for (let k = 0; k < ly.k; k++) {
            const tt2 = tt - ly.d * k;
            if (tt2 >= 0) { g[k] += d * ic[tt2]; dinp[ci][tt2] += d * wrow[k]; }
          }
        }
      }
    }
    for (let o = 0; o < ly.cout; o++) {
      for (let ci = 0; ci < ly.cin; ci++) for (let k = 0; k < ly.k; k++) {
        const [np, nm, nv] = adamApply(ly.W[o][ci][k], gW[o][ci][k], ly.mW[o][ci][k], ly.vW[o][ci][k], lr, t);
        ly.W[o][ci][k] = np; ly.mW[o][ci][k] = nm; ly.vW[o][ci][k] = nv;
      }
      const [nb, nmb, nvb] = adamApply(ly.b[o], gb[o], ly.mb[o], ly.vb[o], lr, t);
      ly.b[o] = nb; ly.mb[o] = nmb; ly.vb[o] = nvb;
    }
    dOut = dinp;
  }
  return loss;
}
function tcnPredict(net, win) {
  const w = paddedWin(win, net.L), st = winStats(w);
  const fw = tcnForward(net, w.map(v => (v - st.mu) / st.sd));
  return fw.y.map(v => Math.max(0, v * st.sd + st.mu));
}

// ---------- 直接多步模型的回测 / 未来预测 ----------
function makeSamples(data, L, H, stride) {
  const out = [];
  for (let s = L; s + H <= data.length; s += stride) out.push({ x: data.slice(s - L, s), y: data.slice(s, s + H) });
  return out;
}
function blockBacktest(model, allVals, startIdx, h, H, L) {
  const out = [];
  for (let s = startIdx; s < startIdx + h; s += H) {
    const win = allVals.slice(Math.max(0, s - L), s);
    const p = model.predict(win);
    for (let i = 0; i < H && out.length < h; i++) out.push(p[i]);
  }
  return out;
}
function trainTcnAsync(net, samples, epochs, lr, onEp, done) {
  let ep = 0;
  (function loop() {
    const t0 = performance.now();
    while (ep < epochs && performance.now() - t0 < 40) {
      const lrNow = lr * (1 - ep / epochs * 0.8);
      let ls = 0;
      for (const smp of samples) ls += tcnTrainStep(net, smp.x, smp.y, lrNow);
      ep++; onEp(ep, ls / samples.length);
    }
    if (ep < epochs) setTimeout(loop, 0); else done();
  })();
}

// ---------- LSTM（纯 JS 实现，单层 + Adam，适配 ≤1200 条小样本） ----------
function lstmRng(seed) { let a = seed | 0; return function () { a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function lstmCreate(H, seed) {
  const rr0 = seed ? lstmRng(seed) : null;
  const r = rr0 ? () => (rr0() - 0.5) * 0.4 : () => (Math.random() - 0.5) * 0.4;
  return {
    H, inDim: 1,
    Wx: [0, 1, 2, 3].map(() => Array.from({ length: H }, r)),      // 输入门/遗忘门/输出门/候选  (H)
    Wh: [0, 1, 2, 3].map(() => Array.from({ length: H }, () => Array.from({ length: H }, r))),
    b: [0, 1, 2, 3].map(() => new Array(H).fill(0)),
    Wy: Array.from({ length: H }, r), by: 0,
    mWx: [0,1,2,3].map(()=>new Array(H).fill(0)), vWx: [0,1,2,3].map(()=>new Array(H).fill(0)),
    mWh: [0,1,2,3].map(()=>Array.from({length:H},()=>new Array(H).fill(0))),
    vWh: [0,1,2,3].map(()=>Array.from({length:H},()=>new Array(H).fill(0))),
    mb: [0,1,2,3].map(()=>new Array(H).fill(0)), vb: [0,1,2,3].map(()=>new Array(H).fill(0)),
    mWy: new Array(H).fill(0), vWy: new Array(H).fill(0), mby: 0, vby: 0, t: 0
  };
}
const _sig = x => 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, x))));
const _tanh = x => Math.tanh(Math.max(-60, Math.min(60, x)));
function lstmForward(m, xs) { // xs: 标量序列；返回 {y, cache}
  const H = m.H, cache = [];
  let h = new Array(H).fill(0), c = new Array(H).fill(0);
  for (const xt of xs) {
    const pre = [[],[],[],[]], gate = [[],[],[],[]], tc = new Array(H), cn = new Array(H);
    for (let g = 0; g < 4; g++) for (let j = 0; j < H; j++) {
      let a = m.Wx[g][j] * xt + m.b[g][j];
      const Whg = m.Wh[g][j];
      for (let k = 0; k < H; k++) a += Whg[k] * h[k];
      pre[g][j] = a;
      gate[g][j] = g < 2 ? _sig(a) : (g === 2 ? _sig(a) : _tanh(a));
    }
    for (let j = 0; j < H; j++) {
      cn[j] = gate[1][j] * c[j] + gate[0][j] * gate[3][j];
      tc[j] = _tanh(cn[j]);
    }
    const hn = new Array(H);
    for (let j = 0; j < H; j++) hn[j] = gate[2][j] * tc[j];
    cache.push({ xt, h, c, pre, gate, tc, cn, hn });
    h = hn; c = cn;
  }
  let y = m.by;
  for (let j = 0; j < H; j++) y += m.Wy[j] * h[j];
  return { y, cache, hLast: h };
}
function lstmTrainStep(m, xs, target, lr) { // 单样本前向 + BPTT + Adam
  const H = m.H, fw = lstmForward(m, xs), cache = fw.cache, T = cache.length;
  const dy = fw.y - target; const loss = dy * dy;
  const dhOut = new Array(H).fill(0);
  for (let j = 0; j < H; j++) dhOut[j] = dy * m.Wy[j];
  const gWy = new Array(H).fill(0);
  for (let j = 0; j < H; j++) gWy[j] = dy * cache[T - 1].h[j];
  const gby = dy;
  const gWx = [0,1,2,3].map(() => new Array(H).fill(0));
  const gWh = [0,1,2,3].map(() => Array.from({ length: H }, () => new Array(H).fill(0)));
  const gb  = [0,1,2,3].map(() => new Array(H).fill(0));
  let dhNext = new Array(H).fill(0);  // 对 h_t 的梯度（来自未来步的门反传）
  let dcCarry = new Array(H).fill(0); // 对 c_t 的梯度（来自 c_{t+1}·f_{t+1}）
  for (let t = T - 1; t >= 0; t--) {
    const c0 = cache[t];
    const dh = new Array(H), dc = new Array(H);
    for (let j = 0; j < H; j++) {
      dh[j] = dhNext[j] + (t === T - 1 ? dhOut[j] : 0);
      // h_t = o_t · tanh(c_t)：两条路径
      dc[j] = dh[j] * c0.gate[2][j] * (1 - c0.tc[j] * c0.tc[j]) + dcCarry[j];
    }
    const dpre = [new Array(H), new Array(H), new Array(H), new Array(H)];
    const dhPrev = new Array(H).fill(0);
    for (let j = 0; j < H; j++) {
      const doj = dh[j] * c0.tc[j];                                        // 输出门
      const dij = dc[j] * c0.gate[3][j];                                   // 输入门
      const dfj = dc[j] * c0.c[j];                                         // 遗忘门
      const dgj = dc[j] * c0.gate[0][j];                                   // 候选
      dpre[0][j] = dij * c0.gate[0][j] * (1 - c0.gate[0][j]);
      dpre[1][j] = dfj * c0.gate[1][j] * (1 - c0.gate[1][j]);
      dpre[2][j] = doj * c0.gate[2][j] * (1 - c0.gate[2][j]);
      dpre[3][j] = dgj * (1 - c0.gate[3][j] * c0.gate[3][j]);
      gWx[0][j] += dpre[0][j] * c0.xt; gWx[1][j] += dpre[1][j] * c0.xt;
      gWx[2][j] += dpre[2][j] * c0.xt; gWx[3][j] += dpre[3][j] * c0.xt;
      gb[0][j] += dpre[0][j]; gb[1][j] += dpre[1][j];
      gb[2][j] += dpre[2][j]; gb[3][j] += dpre[3][j];
      for (let g = 0; g < 4; g++) for (let k = 0; k < H; k++) {
        gWh[g][j][k] += dpre[g][j] * c0.h[k];
        dhPrev[k] += dpre[g][j] * m.Wh[g][j][k];
      }
    }
    dhNext = dhPrev;
    dcCarry = dc.map((d, j) => d * c0.gate[1][j]); // dc_t·f_t 传给 c_{t-1}
  }
  // Adam 更新
  m.t++;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  const upd = (pv, g, mm, vv) => {
    const m1 = b1 * mm + (1 - b1) * g, v1 = b2 * vv + (1 - b2) * g * g;
    const mh = m1 / (1 - Math.pow(b1, m.t)), vh = v1 / (1 - Math.pow(b2, m.t));
    return [pv - lr * mh / (Math.sqrt(vh) + eps), m1, v1];
  };
  for (let g = 0; g < 4; g++) for (let j = 0; j < H; j++) {
    [m.Wx[g][j], m.mWx[g][j], m.vWx[g][j]] = upd(m.Wx[g][j], gWx[g][j], m.mWx[g][j], m.vWx[g][j]);
    [m.b[g][j], m.mb[g][j], m.vb[g][j]] = upd(m.b[g][j], gb[g][j], m.mb[g][j], m.vb[g][j]);
    for (let k = 0; k < H; k++)
      [m.Wh[g][j][k], m.mWh[g][j][k], m.vWh[g][j][k]] = upd(m.Wh[g][j][k], gWh[g][j][k], m.mWh[g][j][k], m.vWh[g][j][k]);
  }
  for (let j = 0; j < H; j++)
    [m.Wy[j], m.mWy[j], m.vWy[j]] = upd(m.Wy[j], gWy[j], m.mWy[j], m.vWy[j]);
  [m.by, m.mby, m.vby] = upd(m.by, gby, m.mby, m.vby);
  return loss;
}

// ---------- 前沿模型：Transformer / PatchTST / FreqLite（频域滤波残差栈，纯 JS 手写，含完整反向传播） ----------
function kyunRng(seed){ let a=seed|0; return function(){ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function xavierMat(rows, cols, rnd){ const s=Math.sqrt(2/(rows+cols)); return Array.from({length:rows},()=>Array.from({length:cols},()=>(rnd()*2-1)*s)); }
function adamMat(W,dW,m,v,lr,t){ const b1=0.9,b2=0.999,eps=1e-8,c1=1-Math.pow(b1,t),c2=1-Math.pow(b2,t);
  for(let i=0;i<W.length;i++) for(let j=0;j<W[i].length;j++){ const g=dW[i][j];
    m[i][j]=b1*m[i][j]+(1-b1)*g; v[i][j]=b2*v[i][j]+(1-b2)*g*g;
    W[i][j]-=lr*(m[i][j]/c1)/(Math.sqrt(v[i][j]/c2)+eps); } }
function adamVec(b,db,m,v,lr,t){ const b1=0.9,b2=0.999,eps=1e-8,c1=1-Math.pow(b1,t),c2=1-Math.pow(b2,t);
  for(let j=0;j<b.length;j++){ const g=db[j]; m[j]=b1*m[j]+(1-b1)*g; v[j]=b2*v[j]+(1-b2)*g*g; b[j]-=lr*(m[j]/c1)/(Math.sqrt(v[j]/c2)+eps); } }
// ===== 通用线性层：Y = X·W + b =====
function linCreate(nin,nout,rnd){ return { nin,nout, W:xavierMat(nin,nout,rnd), b:new Array(nout).fill(0),
  dW:null, db:null, mW:null,vW:null,mb:null,vb:null, _x:null }; }
function linF(l,X){ l._x=X; const T=X.length,out=[];
  for(let t=0;t<T;t++){ const xi=X[t],o=new Array(l.nout);
    for(let j=0;j<l.nout;j++){ let s=l.b[j]; for(let i=0;i<l.nin;i++) s+=xi[i]*l.W[i][j]; o[j]=s; } out.push(o); }
  return out; }
function linB(l,dOut){ const T=l._x.length;
  if(!l.dW){ l.dW=Array.from({length:l.nin},()=>new Array(l.nout).fill(0)); l.db=new Array(l.nout).fill(0);
    l.mW=Array.from({length:l.nin},()=>new Array(l.nout).fill(0)); l.vW=Array.from({length:l.nin},()=>new Array(l.nout).fill(0));
    l.mb=new Array(l.nout).fill(0); l.vb=new Array(l.nout).fill(0); }
  const dX=[];
  for(let t=0;t<T;t++){ const d=dOut[t],xi=l._x[t],dx=new Array(l.nin).fill(0);
    for(let i=0;i<l.nin;i++){ const Wi=l.W[i]; let s=0;
      for(let j=0;j<l.nout;j++){ const g=d[j]; s+=Wi[j]*g; l.dW[i][j]+=xi[i]*g; } dx[i]=s; }
    for(let j=0;j<l.nout;j++) l.db[j]+=d[j];
    dX.push(dx); }
  return dX; }
function linZero(l){ if(!l.dW) return; for(const r of l.dW) r.fill(0); l.db.fill(0); }
function linAdam(l,lr,t){ if(!l.dW) return; adamMat(l.W,l.dW,l.mW,l.vW,lr,t); adamVec(l.b,l.db,l.mb,l.vb,lr,t); }
// ===== LayerNorm（逐行归一，gamma/beta 可学习） =====
function lnCreate(D){ return { D, g:new Array(D).fill(1), b:new Array(D).fill(0), dg:new Array(D).fill(0), db:new Array(D).fill(0),
  mg:new Array(D).fill(0),vg:new Array(D).fill(0),mb:new Array(D).fill(0),vb:new Array(D).fill(0), _c:null }; }
function lnF(ln,X){ ln._c=[]; return X.map(row=>{ const D=row.length;
  const mu=row.reduce((a,b)=>a+b,0)/D; let v=0; for(const x of row) v+=(x-mu)*(x-mu); const sd=Math.sqrt(v/D+1e-5);
  ln._c.push({mu,sd,x:row.slice()}); return row.map((x,i)=>(x-mu)/sd*ln.g[i]+ln.b[i]); }); }
function lnB(ln,dOut){ return dOut.map((d,t)=>{ const c=ln._c[t],D=ln.D;
  const xh=c.x.map((x,i)=>(x-c.mu)/c.sd); let m1=0,m2=0;
  for(let i=0;i<D;i++){ m1+=d[i]*ln.g[i]; m2+=d[i]*ln.g[i]*xh[i]; } m1/=D; m2/=D;
  return xh.map((xh,i)=>{ ln.dg[i]+=d[i]*xh; ln.db[i]+=d[i]; return (ln.g[i]/c.sd)*(d[i]-m1-xh*m2); }); }); }
function lnZero(ln){ ln.dg.fill(0); ln.db.fill(0); }
function lnAdam(ln,lr,t){ adamVec(ln.g,ln.dg,ln.mg,ln.vg,lr,t); adamVec(ln.b,ln.db,ln.mb,ln.vb,lr,t); }
// ===== 单头自注意力：att = softmax(QKᵀ/√D)，O = att·V =====
function attCreate(D,rnd){ return { D, Wq:linCreate(D,D,rnd), Wk:linCreate(D,D,rnd), Wv:linCreate(D,D,rnd), Wo:linCreate(D,D,rnd), _c:null }; }
function attF(a,X){ const T=X.length,D=a.D;
  const Q=linF(a.Wq,X),K=linF(a.Wk,X),V=linF(a.Wv,X),A=[];
  for(let i=0;i<T;i++){ const row=new Array(T); let mx=-1e9;
    for(let j=0;j<T;j++){ let s=0; for(let d=0;d<D;d++) s+=Q[i][d]*K[j][d]; s/=Math.sqrt(D); row[j]=s; if(s>mx)mx=s; }
    let sum=0; for(let j=0;j<T;j++){ row[j]=Math.exp(row[j]-mx); sum+=row[j]; }
    for(let j=0;j<T;j++) row[j]/=sum; A.push(row); }
  const O=A.map((row,i)=>{ const o=new Array(D).fill(0);
    for(let j=0;j<T;j++){ const aij=row[j]; if(aij<1e-12) continue; const vj=V[j];
      for(let d=0;d<D;d++) o[d]+=aij*vj[d]; } return o; });
  a._c={Q,K,V,A}; return O; }
function attB(a,dO){ const c=a._c, Q=c.Q,K=c.K,V=c.V,A=c.A, T=A.length, D=a.D;
  const dA=A.map((row,i)=>{ const r=new Array(T).fill(0);
    for(let j=0;j<T;j++){ let s=0; for(let d=0;d<D;d++) s+=dO[i][d]*V[j][d]; r[j]=s; } return r; });
  const dV=V.map(()=>new Array(D).fill(0));
  for(let i=0;i<T;i++) for(let j=0;j<T;j++){ const aij=A[i][j]; if(aij<1e-12) continue;
    for(let d=0;d<D;d++) dV[j][d]+=aij*dO[i][d]; }
  const dS=A.map((row,i)=>{ let dot=0; for(let j=0;j<T;j++) dot+=dA[i][j]*row[j];
    return row.map((aij,j)=>aij*(dA[i][j]-dot)); });
  const sc=1/Math.sqrt(D), dQ=Q.map(()=>new Array(D).fill(0)), dK=K.map(()=>new Array(D).fill(0));
  for(let i=0;i<T;i++) for(let j=0;j<T;j++){ const ds=dS[i][j]*sc; if(ds===0) continue;
    for(let d=0;d<D;d++){ dQ[i][d]+=ds*K[j][d]; dK[j][d]+=ds*Q[i][d]; } }
  const dX1=linB(a.Wq,dQ),dX2=linB(a.Wk,dK),dX3=linB(a.Wv,dV);
  const dX=Q.map((_,t)=>{ const r=new Array(D); for(let d=0;d<D;d++) r[d]=dX1[t][d]+dX2[t][d]+dX3[t][d]; return r; });
  return dX; }
// ===== 编码器块：Y = LN2( H2 + W2·relu(W1·LN1(X + Wo·att(X))) ) =====
function blkCreate(D,ff,rnd){ return { att:attCreate(D,rnd), ln1:lnCreate(D), f1:linCreate(D,ff,rnd), f2:linCreate(ff,D,rnd), ln2:lnCreate(D), _c:null }; }
function blkFwd(bk,X){ const T=X.length,D=X[0].length;
  const O=attF(bk.att,X), OW=linF(bk.att.Wo,O);
  const H1=X.map((x,t)=>{ const h=new Array(D); for(let d=0;d<D;d++) h[d]=x[d]+OW[t][d]; return h; });
  const H2=lnF(bk.ln1,H1);
  const F1=linF(bk.f1,H2).map(r=>r.map(v=>v>0?v:0));
  const F2=linF(bk.f2,F1);
  const Y2=lnF(bk.ln2,H2.map((h,t)=>{ const y=new Array(D); for(let d=0;d<D;d++) y[d]=h[d]+F2[t][d]; return y; }));
  bk._c={X,H2,F1}; return Y2; }
function blkBack(bk,dY2){ const c=bk._c, X=c.X, H2=c.H2, F1=c.F1, T=X.length, D=X[0].length;
  const dYpre=lnB(bk.ln2,dY2);                       // 对 LN2 输入 (H2 + F2) 的梯度
  const dF2=linB(bk.f2,dYpre);                       // 对 F2 输入（=relu 输出）的梯度
  const dF1=dF2.map((r,t)=>r.map((g,d)=>F1[t][d]>0?g:0));   // relu 反传
  const dH2a=linB(bk.f1,dF1);                        // f1 分支对 H2 的梯度
  const dH2=dYpre.map((r,t)=>{ const o=new Array(D); for(let d=0;d<D;d++) o[d]=r[d]+dH2a[t][d]; return o; });
  const dH1=lnB(bk.ln1,dH2);                         // 对 LN1 输入 (X + OW) 的梯度
  const dOW=linB(bk.att.Wo,dH1);                     // 对 attention 输出的梯度
  const dXa=attB(bk.att,dOW);
  return X.map((x,t)=>{ const r=new Array(D); for(let d=0;d<D;d++) r[d]=dH1[t][d]+dXa[t][d]; return r; }); }
function blkZero(bk){ linZero(bk.att.Wq); linZero(bk.att.Wk); linZero(bk.att.Wv); linZero(bk.att.Wo);
  linZero(bk.f1); linZero(bk.f2); lnZero(bk.ln1); lnZero(bk.ln2); }
function blkAdam(bk,lr,t){ linAdam(bk.att.Wq,lr,t); linAdam(bk.att.Wk,lr,t); linAdam(bk.att.Wv,lr,t); linAdam(bk.att.Wo,lr,t);
  linAdam(bk.f1,lr,t); linAdam(bk.f2,lr,t); lnAdam(bk.ln1,lr,t); lnAdam(bk.ln2,lr,t); }
// 正弦位置编码（固定，免训练）
function sinusPos(T,D){ const P=[];
  for(let t=0;t<T;t++){ const row=new Array(D);
    for(let d=0;d<D;d++) row[d]=d%2===0?Math.sin(t/Math.pow(10000,d/D)):Math.cos(t/Math.pow(10000,(d-1)/D));
    P.push(row); } return P; }
// 统一归一化（窗口均值/标准差，预测后反归一）
function winNorm(xs){ const mu=xs.reduce((a,b)=>a+b,0)/xs.length;
  let v=0; for(const x of xs) v+=(x-mu)*(x-mu); const sd=Math.sqrt(v/xs.length)||1;
  return { mu, sd, xn:xs.map(x=>(x-mu)/sd) }; }
// ---------- ① Transformer 编码器（逐点 token + 均值池化 + 线性头） ----------
function trCreateNet(seed,T,D,ff,H,nl){ const rnd=kyunRng(seed);
  return { kind:'tr', T,D,H, blocks:Array.from({length:nl},()=>blkCreate(D,ff,rnd)),
    emb:linCreate(1,D,rnd), pos:sinusPos(T,D), head:linCreate(D,H,rnd), _t:0 }; }
function trCore(net,xs){ const {mu,sd,xn}=winNorm(xs);
  const X=xn.map(x=>[x]);
  const E=linF(net.emb,X);
  const P=E.map((e,t)=>e.map((val,d)=>val+net.pos[t][d]));
  let cur=P; for(const bk of net.blocks) cur=blkFwd(bk,cur);
  const mp=new Array(net.D).fill(0);
  for(const row of cur) for(let d=0;d<net.D;d++) mp[d]+=row[d]/cur.length;
  return { mu,sd,cur,mp,y:linF(net.head,[mp])[0].map(s=>s*sd+mu) }; }
function trTrainStep(net,xraw,yraw,lr){ const c=trCore(net,xraw), H=net.H;
  net._t++;
  for(const bk of net.blocks) blkZero(bk); linZero(net.emb); linZero(net.head);
  const dYhat=c.y.map((p,i)=>2*(p-yraw[i])/H);
  const dMP=linB(net.head,[dYhat.map(s=>s*c.sd)])[0];
  let dBack=c.cur.map(row=>row.map((val,d)=>dMP[d]/c.cur.length));
  for(let i=net.blocks.length-1;i>=0;i--) dBack=blkBack(net.blocks[i],dBack);
  linB(net.emb,dBack);
  for(const bk of net.blocks) blkAdam(bk,lr,net._t);
  linAdam(net.emb,lr,net._t); linAdam(net.head,lr,net._t);
  let loss=0; for(let i=0;i<H;i++){ const e=c.y[i]-yraw[i]; loss+=e*e; } return loss/H; }
function trPredict(net,win){ return trCore(net,win).y; }
// ---------- ② PatchTST（patch 化 token + 正弦位置编码，复用编码器块） ----------
function ptCreateNet(seed,patch,stride,T,D,ff,H,nl){ const rnd=kyunRng(seed);
  const nTok=Math.floor((T-patch)/stride)+1;
  return { kind:'pt', T,patch,stride,nTok,D,H, blocks:Array.from({length:nl},()=>blkCreate(D,ff,rnd)),
    emb:linCreate(patch,D,rnd), pos:sinusPos(nTok,D), head:linCreate(D,H,rnd), _t:0 }; }
function ptCore(net,xs){ const {mu,sd,xn}=winNorm(xs);
  const toks=[];
  for(let s=0;s+net.patch<=xn.length;s+=net.stride) toks.push(xn.slice(s,s+net.patch));
  const E=linF(net.emb,toks);
  const P=E.map((e,t)=>e.map((val,d)=>val+net.pos[t][d]));
  let cur=P; for(const bk of net.blocks) cur=blkFwd(bk,cur);
  const mp=new Array(net.D).fill(0);
  for(const row of cur) for(let d=0;d<net.D;d++) mp[d]+=row[d]/cur.length;
  return { mu,sd,cur,mp,y:linF(net.head,[mp])[0].map(s=>s*sd+mu) }; }
function ptTrainStep(net,xraw,yraw,lr){ const c=ptCore(net,xraw), H=net.H;
  net._t++;
  for(const bk of net.blocks) blkZero(bk); linZero(net.emb); linZero(net.head);
  const dYhat=c.y.map((p,i)=>2*(p-yraw[i])/H);
  const dMP=linB(net.head,[dYhat.map(s=>s*c.sd)])[0];
  let dBack=c.cur.map(row=>row.map((val,d)=>dMP[d]/c.cur.length));
  for(let i=net.blocks.length-1;i>=0;i--) dBack=blkBack(net.blocks[i],dBack);
  linB(net.emb,dBack);
  for(const bk of net.blocks) blkAdam(bk,lr,net._t);
  linAdam(net.emb,lr,net._t); linAdam(net.head,lr,net._t);
  let loss=0; for(let i=0;i<H;i++){ const e=c.y[i]-yraw[i]; loss+=e*e; } return loss/H; }
function ptPredict(net,win){ return ptCore(net,win).y; }
// ---------- ③ FreqLite：可学习频域滤波 + 残差全连接栈 ----------
// 机制：窗口 → rFFT → 复数增益滤波（Gk 可学习，恒等初始化）→ iFFT 回时域
//       → 谱特征 [滤波时域 ⊕ log幅频] → 残差 MLP（2 残差块）→ 线性头
//       增益/全连接层 Adam 端到端训练；inspect() 暴露滤波前后幅频谱
function flCreateNet(seed, T, H, width){
  const rnd = kyunRng(seed);
  const K = Math.floor(T/2)+1;
  return { kind:'fl', T, H, K, width, _t:0,
    gr:new Array(K).fill(1), gi:new Array(K).fill(0),
    dgr:new Array(K).fill(0), dgi:new Array(K).fill(0),
    mgr:new Array(K).fill(0), vgr:new Array(K).fill(0), mgi:new Array(K).fill(0), vgi:new Array(K).fill(0),
    embed:linCreate(T+K, width, rnd),
    blocks:Array.from({length:2},()=>({ f1:linCreate(width,width,rnd), f2:linCreate(width,width,rnd) })),
    head:linCreate(width, H, rnd) };
}
function flRfft(x){
  const L=x.length, K=Math.floor(L/2)+1, Xr=new Array(K), Xi=new Array(K);
  for(let k=0;k<K;k++){ let sr=0,si=0;
    for(let n=0;n<L;n++){ const th=-2*Math.PI*k*n/L; sr+=x[n]*Math.cos(th); si+=x[n]*Math.sin(th); }
    Xr[k]=sr; Xi[k]=si; }
  return {Xr,Xi};
}
function flCore(net, xs, keepCache){
  const {mu,sd,xn} = winNorm(paddedWin(xs, net.T));
  const L=net.T, K=net.K;
  const {Xr,Xi} = flRfft(xn);
  // 复数增益滤波：Fr+Fi·i = (gr+gi·i)·(Xr+Xi·i)
  const Fr=new Array(K), Fi=new Array(K);
  for(let k=0;k<K;k++){ Fr[k]=net.gr[k]*Xr[k]-net.gi[k]*Xi[k]; Fi[k]=net.gr[k]*Xi[k]+net.gi[k]*Xr[k]; }
  // iFFT 合成（实信号）：x[n] = (1/L)[X0 + 2Σ_{1..L/2-1}(Fr·cosθ − Fi·sinθ) + F_{L/2}·(−1)^n]
  const xf=new Array(L).fill(0);
  for(let n=0;n<L;n++){
    let s=Fr[0];
    for(let k=1;k<K-1;k++){ const th=2*Math.PI*k*n/L; s+=2*(Fr[k]*Math.cos(th)-Fi[k]*Math.sin(th)); }
    if(K>1) s+=Fr[K-1]*(n%2===0?1:-1);
    xf[n]=s/L;
  }
  const magsIn=Xr.map((r,k)=>Math.hypot(r,Xi[k]));
  const magsOut=Fr.map((r,k)=>Math.hypot(r,Fi[k]));
  const feat=xf.slice().concat(magsIn.map(m=>Math.log1p(m)));
  let h=linF(net.embed,[feat])[0].map(v=>v>0?v:0);
  const h0=h.slice();
  const caches=[];
  for(const bk of net.blocks){
    const a=linF(bk.f1,[h])[0].map(v=>v>0?v:0);
    const o=linF(bk.f2,[a])[0];
    h=h.map((v,i)=>v+o[i]);
    caches.push({a,o});
  }
  const yz=linF(net.head,[h])[0];
  const res={ mu,sd,xn,Xr,Xi,Fr,Fi,xf,magsIn,magsOut,h0,h,caches,yz };
  if(keepCache) res.feat=feat;
  return res;
}
function flZeroGrad(net){
  net.dgr.fill(0); net.dgi.fill(0);
  linZero(net.embed); for(const bk of net.blocks){ linZero(bk.f1); linZero(bk.f2); } linZero(net.head);
}
function flTrainStep(net, xraw, yraw, lr){
  const L=net.T,K=net.K,H=net.H;
  const c=flCore(net,xraw,true);
  net._t++;
  flZeroGrad(net);
  const yn=yraw.map(v=>(v-c.mu)/c.sd);
  const dYz=c.yz.map((p,i)=>2*(p-yn[i])/H);
  let dh=linB(net.head,[dYz])[0];
  for(let bi=net.blocks.length-1;bi>=0;bi--){
    const bk=net.blocks[bi], ca=c.caches[bi];
    const da=linB(bk.f2,[dh])[0].map((v,i)=>ca.a[i]>0?v:0);
    const dhIn=linB(bk.f1,[da])[0];
    dh=dh.map((v,i)=>v+dhIn[i]);
  }
  const dhMask=dh.map((v,i)=>c.h0[i]>0?v:0);   // embed 输出 ReLU 掩码
  const dEmb=linB(net.embed,[dhMask])[0];
  const dxf=dEmb.slice(0,L);
  // iFFT 反传：dFr/dFi
  const dFr=new Array(K).fill(0), dFi=new Array(K).fill(0);
  for(let n=0;n<L;n++){
    const g=dxf[n];
    if(!g) continue;
    dFr[0]+=g/L;
    for(let k=1;k<K-1;k++){ const th=2*Math.PI*k*n/L; dFr[k]+=2*g*Math.cos(th)/L; dFi[k]-=2*g*Math.sin(th)/L; }
    if(K>1) dFr[K-1]+=g*(n%2===0?1:-1)/L;
  }
  // 复数增益反传：Fr=gr·Xr−gi·Xi；Fi=gr·Xi+gi·Xr（含恒等锚定正则，防滤波器漂移发散）
  for(let k=0;k<K;k++){
    const xr=c.Xr[k], xi=c.Xi[k];
    net.dgr[k]+=dFr[k]*xr+dFi[k]*xi + 0.03*(net.gr[k]-1);
    net.dgi[k]+=dFi[k]*xr-dFr[k]*xi + 0.03*net.gi[k];
  }
  // 梯度裁剪（谱域参数范数 ≤3）
  let gn2=0; for(let k=0;k<K;k++) gn2+=net.dgr[k]*net.dgr[k]+net.dgi[k]*net.dgi[k];
  gn2=Math.sqrt(gn2);
  if(gn2>3) for(let k=0;k<K;k++){ net.dgr[k]*=3/gn2; net.dgi[k]*=3/gn2; }
  adamVec(net.gr,net.dgr,net.mgr,net.vgr,lr,net._t);
  adamVec(net.gi,net.dgi,net.mgi,net.vgi,lr,net._t);
  linAdam(net.embed,lr,net._t);
  for(const bk of net.blocks){ linAdam(bk.f1,lr,net._t); linAdam(bk.f2,lr,net._t); }
  linAdam(net.head,lr,net._t);
  let loss=0; for(let i=0;i<H;i++){ const e=c.yz[i]-yn[i]; loss+=e*e; } return loss/H;
}
function flPredict(net,win){ const c=flCore(net,win); return c.yz.map(v=>Math.max(0,v*c.sd+c.mu)); }
function flInspect(nets,win){
  if(!Array.isArray(nets)) nets=[nets];
  let magsIn=null; const magsOut=new Array(nets[0].K).fill(0);
  for(const net of nets){
    const c=flCore(net,win);
    if(!magsIn) magsIn=c.magsIn.slice();
    for(let k=0;k<magsOut.length;k++) magsOut[k]+=c.magsOut[k]/nets.length;
  }
  return { magsIn, magsOut };
}
// ---------- 梯度自检（有限差分抽检，仅开发验证用） ----------
function frontierGradCheck(){ // 返回各模型最大相对误差
  const eps=1e-4, out={};
  function numGrad(stepFn, getW, idx){ const w=getW(); const old=w[idx[0]][idx[1]];
    w[idx[0]][idx[1]]=old+eps; const l1=stepFn();
    w[idx[0]][idx[1]]=old-eps; const l2=stepFn();
    w[idx[0]][idx[1]]=old; return (l1-l2)/(2*eps); }
  // Transformer
  { const net=trCreateNet(7,14,16,32,7,2);
    const x=Array.from({length:14},(_,i)=>10+3*Math.sin(i/2)+i*0.1);
    const y=Array.from({length:7},(_,i)=>11+2*Math.cos(i/3));
    const step=()=>trTrainStep(net,x,y,0);
    let mx=0; const W=net.blocks[0].f1.W;
    for(const idx of [[0,0],[1,2],[5,7]]){
      for(const bk of net.blocks) blkZero(bk); linZero(net.emb); linZero(net.head);
      trTrainStep(net,x,y,0);
      const an=net.blocks[0].f1.dW[idx[0]][idx[1]];
      const nu=numGrad(step,()=>W,idx); if(Math.abs(an)+Math.abs(nu)>1e-8) mx=Math.max(mx,Math.abs(an-nu)/(Math.abs(an)+Math.abs(nu))); }
    out.transformer=mx; }
  // PatchTST
  { const net=ptCreateNet(7,7,7,14,16,32,7,2);
    const x=Array.from({length:14},(_,i)=>8+2*Math.sin(i/3));
    const y=Array.from({length:7},(_,i)=>9+i*0.1);
    const step=()=>ptTrainStep(net,x,y,0);
    let mx=0; const W=net.blocks[0].f2.W;
    for(const idx of [[0,0],[3,1],[2,4]]){
      for(const bk of net.blocks) blkZero(bk); linZero(net.emb); linZero(net.head);
      ptTrainStep(net,x,y,0);
      const an=net.blocks[0].f2.dW[idx[0]][idx[1]];
      const nu=numGrad(step,()=>W,idx); if(Math.abs(an)+Math.abs(nu)>1e-8) mx=Math.max(mx,Math.abs(an-nu)/(Math.abs(an)+Math.abs(nu))); }
    out.patchtst=mx; }
  // FreqLite（频域滤波 + 残差全连接栈）
  { const net=flCreateNet(7,14,7,24);
    const x=Array.from({length:14},(_,i)=>6+Math.sin(i));
    const y=Array.from({length:7},(_,i)=>7+i*0.2);
    const step=()=>flTrainStep(net,x,y,0);
    let mx=0;
    for(const k of [0,2,6]){                      // 复数增益（一维参数）
      flZeroGrad(net); flTrainStep(net,x,y,0);
      const an=net.dgr[k];
      const old=net.gr[k];
      net.gr[k]=old+eps; const l1=step();
      net.gr[k]=old-eps; const l2=step();
      net.gr[k]=old;
      const nu=(l1-l2)/(2*eps);
      if(Math.abs(an)+Math.abs(nu)>1e-8) mx=Math.max(mx,Math.abs(an-nu)/(Math.abs(an)+Math.abs(nu))); }
    for(const idx of [[0,0],[3,5],[10,20]]){      // embed 全连接
      flZeroGrad(net); flTrainStep(net,x,y,0);
      const an=net.embed.dW[idx[0]][idx[1]];
      const nu=numGrad(step,()=>net.embed.W,idx);
      if(Math.abs(an)+Math.abs(nu)>1e-8) mx=Math.max(mx,Math.abs(an-nu)/(Math.abs(an)+Math.abs(nu))); }
    for(const idx of [[0,0],[5,3]]){              // 残差块全连接
      flZeroGrad(net); flTrainStep(net,x,y,0);
      const an=net.blocks[0].f1.dW[idx[0]][idx[1]];
      const nu=numGrad(step,()=>net.blocks[0].f1.W,idx);
      if(Math.abs(an)+Math.abs(nu)>1e-8) mx=Math.max(mx,Math.abs(an-nu)/(Math.abs(an)+Math.abs(nu))); }
    out.freqlite=mx; }
  return out; }
