<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,Consolas,monospace}
body{background:#0f172a;color:#e2e8f0;padding:20px;max-width:1400px;margin:0 auto}
h1{color:#f87171;border-bottom:1px solid #475569;padding-bottom:12px;margin-bottom:20px}
.main-wrap{display:grid;grid-template-columns:1fr 1fr;gap:24px}
/* 左侧代码区 */
.code-panel{background:#1e293b;padding:20px;border-radius:12px;box-shadow:0 4px 20px #0003}
pre{white-space:pre-wrap;line-height:1.8;font-size:14px}
.code-line{padding:2px 6px;border-radius:4px;transition:0.4s}
.highlight-line{animation:codePulse 1.2s infinite;background:#f8717133}
@keyframes codePulse{0,100%{box-shadow:0 0 0 2px #f87171}50%{box-shadow:0 0 0 5px #f8717155}}
/* 右侧动画讲师区 */
.anim-panel{display:flex;flex-direction:column;gap:16px}
.teacher-box{background:#1e293b;border-radius:12px;padding:16px;display:flex;gap:14px;align-items:flex-start}
.teacher-avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#38bdf8,#a855f7);position:relative;overflow:hidden;flex-shrink:0}
/* 讲师人物动态动画 */
@keyframes teacherBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes teacherHand{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(15deg)}}
.teacher-body{width:36px;height:44px;background:#fff;border-radius:8px;position:absolute;bottom:0;left:22px}
.teacher-hand{width:12px;height:26px;background:#fff;border-radius:6px;position:absolute;bottom:12px;right:8px;animation:teacherHand 2s infinite}
.teacher-head{width:32px;height:32px;background:#fff;border-radius:50%;position:absolute;top:8px;left:24px}
.teacher-talk{flex:1}
.talk-text{padding:10px;background:#334155;border-radius:8px;line-height:1.6;min-height:80px;transition:0.5s}
/* 张量可视化画布 */
.tensor-canvas{background:#0f172a;border-radius:12px;padding:20px;min-height:360px;display:flex;flex-direction:column;gap:16px}
.ctrl-bar{display:flex;gap:10px;flex-wrap:center}
button{padding:8px 14px;border:none;border-radius:6px;font-size:14px;cursor:pointer}
.btn-step{background:#2563eb;color:#fff}
.btn-reset{background:#475569;color:#fff}
.dim-log{padding:10px;background:#1e293b;border-radius:6px;color:#facc15;font-family:monospace}
.block-container{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;min-height:180px}
.dim-block{width:90px;height:100px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-weight:bold;transition:all 0.7s cubic-bezier(0.2,0,0.2,1);position:relative;overflow:hidden}
/* 通道流动动画 */
@keyframes flowMove{0{transform:translateX(-30px);opacity:0}50%{opacity:1}100%{transform:translateX(30px);opacity:0}}
.flow-cell{width:14px;height:14px;background:#fff8;border-radius:50%;position:absolute;animation:flowMove 3s infinite}
/* 底部原理说明 */
.desc-card{margin-top:20px;background:#1e293b;padding:16px;border-radius:12px}
.desc-card h3{color:#38bdf8;margin-bottom:10px}
ul{padding-left:20px;line-height:1.7;color:#cbd5e1}
.red-tip{background:#7f1d1d44;border:1px solid #ef4444;padding:8px;border-radius:6px;margin-top:10px;color:#fca5a5}
</style>
</head>
<body>
<h1>ShuffleLayer Permute 通道混洗 完整代码动画教学</h1>
<div class="main-wrap">
    <!-- 左侧代码面板 -->
    <div class="code-panel">
        <h2 style="margin-bottom:12px;color:#94a3b8">PyTorch 原始源码逐行标注</h2>
<pre>
<span style="color:#c084fc"># 分组卷积通道混洗核心实现，等价permute维度置换</span>
<span class="code-line" id="line1">def ShuffleLayer(x, groups):</span>
<span class="code-line" id="line2">    batchsize, num_channels, height, width = x.data.size()</span>
<span class="code-line" id="line3">    channels_per_group = num_channels // groups</span>

<span style="color:#38bdf8">    ### Step1 reshape 拆分通道维度</span>
<span class="code-line" id="line4">    x = x.view(batchsize, groups, channels_per_group, height, width)</span>

<span style="color:#38bdf8">    ### Step2 transpose 交换维度(核心混洗)</span>
<span class="code-line" id="line5">    x = torch.transpose(x, dim0=1, dim1=2).contiguous()</span>

<span style="color:#38bdf8">    ### Step3 flatten 合并维度还原特征图</span>
<span class="code-line" id="line6">    x = x.view(batchsize, -1, height, width)</span>

<span class="code-line" id="line7">    return x
</pre>
    </div>

    <!-- 右侧动画+讲师讲解 -->
    <div class="anim-panel">
        <!-- AI讲师人物讲解模块 -->
        <div class="teacher-box">
            <div class="teacher-avatar" style="animation:teacherBounce 2.5s infinite">
                <div class="teacher-head"></div>
                <div class="teacher-body"></div>
                <div class="teacher-hand"></div>
            </div>
            <div class="teacher-talk">
                <h3 style="margin-bottom:6px;color:#94a3b8">AI深度学习讲师</h3>
                <div class="talk-text" id="talkBox">点击下方分步按钮，我会同步讲解每一步张量变换逻辑，可视化通道分组混洗全过程</div>
            </div>
        </div>

        <!-- 张量动画画布 -->
        <div class="tensor-canvas">
            <div class="ctrl-bar">
                <button class="btn-step" onclick="run(1)">1.初始4维输入 [B,C,H,W]</button>
                <button class="btn-step" onclick="run(2)">2.Reshape拆分5维 [B,G,Cg,H,W]</button>
                <button class="btn-step" onclick="run(3)">3.Transpose交换维度混洗</button>
                <button class="btn-step" onclick="run(4)">4.Flatten还原输出</button>
                <button class="btn-reset" onclick="resetAll()">重置全部动画</button>
            </div>
            <div class="dim-log" id="dimLog">当前张量状态：等待演示</div>
            <div class="block-container" id="blockBox"></div>
        </div>
    </div>
</div>

<!-- 底部原理补充 -->
<div class="desc-card">
    <h3>通道混洗 Channel Shuffle 底层原理与代码坑点</h3>
    <ul>
        <li>分组卷积（Group Conv）各组通道独立计算，组间无信息交互，模型精度下降</li>
        <li>view拆分通道：把单通道维度拆分为「分组数G + 每组通道Cg」两个独立维度</li>
        <li>transpose(1,2)是permute简化操作，交换分组与单组通道，实现通道跨组打乱</li>
        <li>.contiguous()强制内存连续：transpose后张量存储不连续，不调用会导致后续view报错</li>
        <li>view(batch,-1,...)中-1自动计算合并通道，恢复标准4维卷积特征图格式</li>
    </ul>
    <div class="red-tip">⚠️ 高频踩坑：transpose / permute 操作后必须 .contiguous()，否则重塑view会抛出RuntimeError</div>
</div>

<script>
// 全局参数配置（本地离线固定参数：B=1，分组G=2，每组通道Cg=3，总通道6）
const config = {B:1, groups:2, cg:3, H:2, W:2};
const talkBox = document.getElementById('talkBox');
const dimLog = document.getElementById('dimLog');
const blockBox = document.getElementById('blockBox');
const codeLineIds = ['line1','line2','line3','line4','line5','line6','line7'];

// 清除所有代码高亮
function clearCodeHighlight(){
    codeLineIds.forEach(id=>document.getElementById(id).classList.remove('highlight-line'))
}

// 生成维度色块+通道流动粒子动画
function renderBlocks(dimList, colorList){
    blockBox.innerHTML = '';
    dimList.forEach((dim,idx)=>{
        const div = document.createElement('div');
        div.className = 'dim-block';
        div.style.background = colorList[idx];
        div.innerHTML = `<div>${dim.name}</div><div style="font-size:12px;margin-top:4px">size:${dim.val}</div>`;
        // 添加流动通道粒子动画
        for(let i=0;i<Math.min(dim.val,4);i++){
            let dot = document.createElement('div');
            dot.className = 'flow-cell';
            dot.style.animationDelay = `${i*0.4}s`;
            div.appendChild(dot);
        }
        blockBox.appendChild(div);
    })
}

// 分步执行逻辑 + 讲师同步台词 + 代码高亮联动
function run(step){
    clearCodeHighlight();
    const totalC = config.groups * config.cg;
    switch(step){
        case 1:
            // 步骤1：初始输入张量
            document.getElementById('line2').classList.add('highlight-line');
            talkBox.innerText = "第一步代码读取输入张量维度：输入是标准卷积4维特征图 [Batch, Channel, Height, Width]。我们示例批次B=1，总通道6，特征图高宽都是2。此时所有通道挤在同一个维度，分组卷积无法跨组交换信息。";
            dimLog.innerText = `张量形状：[B=${config.B}, C=${totalC}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"Channel",val:totalC},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#ef4444","#16a34a","#eab308"]);
            break;
        case 2:
            // 步骤2：reshape拆分5维
            document.getElementById('line4').classList.add('highlight-line');
            talkBox.innerText = "第二步执行view重塑，把单一通道维度拆成两层：groups分组 和 channels_per_group每组通道。4维张量升维为5维 [B, G, Cg, H, W]，现在通道被切分为2个分组，每组3个通道，为后续交换维度做准备。";
            dimLog.innerText = `Reshape拆分后5维：[B=${config.B}, groups=${config.groups}, C_per_group=${config.cg}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"Groups(G)",val:config.groups},
                {name:"C_per_Grp(Cg)",val:config.cg},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#9333ea","#f472b6","#16a34a","#eab308"]);
            break;
        case 3:
            // 步骤3：transpose交换维度 核心混洗
            document.getElementById('line5').classList.add('highlight-line');
            talkBox.innerText = "第三步是混洗核心！torch.transpose(x,1,2)交换第1、2维度，也就是交换分组维度和单组通道维度，通道自动跨组打乱。转置后内存不连续，必须调用.contiguous()重置内存，否则下一行view会直接报错。";
            dimLog.innerText = `转置交换维度后：[B=${config.B}, C_per_group=${config.cg}, groups=${config.groups}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"C_per_Grp(Cg)",val:config.cg},
                {name:"Groups(G)",val:config.groups},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#f472b6","#9333ea","#16a34a","#eab308"]);
            break;
        case 4:
            // 步骤4：flatten合并还原4维
            document.getElementById('line6').classList.add('highlight-line');
            talkBox.innerText = "最后一步view合并前两个维度，-1代表自动计算合并后的通道总数，张量恢复标准4维卷积格式。此时通道已经完成跨组混洗，下一层分组卷积可以融合来自不同分组的特征，解决分组卷积信息隔离问题。";
            dimLog.innerText = `输出混洗完成4维：[B=${config.B}, Shuffled_C=${totalC}, H=${config.H}, W=${config.W}]`;
            renderBlocks([
                {name:"Batch",val:config.B},
                {name:"Shuffled_Channel",val:totalC},
                {name:"Height",val:config.H},
                {name:"Width",val:config.W}
            ],["#2563eb","#f97316","#16a34a","#eab308"]);
            break;
    }
}

// 重置全部状态
function resetAll(){
    clearCodeHighlight();
    talkBox.innerText = "点击下方分步按钮，我会同步讲解每一步张量变换逻辑，可视化通道分组混洗全过程";
    dimLog.innerText = "当前张量状态：等待演示";
    blockBox.innerHTML = '<div style="color:#64748b">点击上方分步按钮启动张量动画演示</div>';
}
window.onload = resetAll;
</script>