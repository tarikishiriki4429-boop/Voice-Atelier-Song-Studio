'use strict';
/* Voice Atelier 0.3.8: independent local vocal special-effects workspace.
 * Source audio stays unchanged. Uses only browser Web Audio + IndexedDB.
 * Requires app.js 0.3.6 and its fileInput audio importer.
 */
(()=>{
  const $=id=>document.getElementById(id);
  const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const Audio=window.AudioContext||window.webkitAudioContext;
  const mount=$('clipInspector');
  const version=document.querySelector('.brand .version');if(version)version.textContent='SONG STUDIO · v0.3.8';
  if(!mount||!Offline||!Audio||document.getElementById('voiceFxPanel'))return;
  const css=document.createElement('style');
  css.textContent=`
  #voiceFxPanel{margin:12px 0 4px;border:1px solid #58627c;border-radius:11px;background:#192334;color:#f3f1ff}
  #voiceFxPanel>summary{cursor:pointer;min-height:44px;padding:11px 14px;font-weight:750;list-style-position:inside;touch-action:manipulation}
  #voiceFxPanel .vfx-inner{padding:0 13px 14px;border-top:1px solid #343f56}
  #voiceFxPanel .vfx-row{display:flex;gap:11px;flex-wrap:wrap;align-items:end;margin:12px 0}
  #voiceFxPanel label{display:grid;gap:5px;font-size:12px;color:#d6d9ea;flex:1;min-width:130px}
  #voiceFxPanel .vfx-half{min-width:110px}
  #voiceFxPanel label.vfx-check{display:flex;align-items:center;gap:7px}
  #voiceFxPanel input[type=range]{width:100%;min-width:80px}
  #voiceFxPanel input,#voiceFxPanel select{background:#101728;border:1px solid #606b8c;color:#f4f3ff;padding:8px;border-radius:7px;min-height:38px}
  #voiceFxPanel .vfx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:12px 0}
  #voiceFxPanel .vfx-output{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  #voiceFxPanel button{border:1px solid #6c7293;background:#303851;border-radius:9px;color:#f7f6ff;padding:9px 13px;min-height:40px}
  #voiceFxPanel button.vfx-primary{background:#2a6d67;border-color:#69c5ae}
  #voiceFxPanel button:disabled{opacity:.45}
  #voiceFxPanel .vfx-note{font-size:12px;line-height:1.7;color:#b4c0da;margin:8px 0}
  #voiceFxPanel #vfxStatus{font-size:12px;color:#93e0cb;line-height:1.6;min-height:20px}
  #voiceFxPanel audio{width:100%;height:43px;margin-top:6px}
  #voiceFxPanel .vfx-numeric{font-variant-numeric:tabular-nums;color:#e5d3ff}
  #voiceFxPanel .vfx-wave-card{padding:10px;background:#10192c;border:1px solid #485b77;border-radius:12px;margin:12px 0}
  #voiceFxPanel #vfxWave{display:block;width:100%;height:112px;touch-action:none;user-select:none;cursor:crosshair;border-radius:8px;background:#0b1322}
  #voiceFxPanel .vfx-wave-label{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#d4ddeb;font-variant-numeric:tabular-nums;margin:6px 0}
  #voiceFxPanel .vfx-range-fields{display:flex;flex-wrap:wrap;align-items:end;gap:10px;margin-top:10px}
  #voiceFxPanel .vfx-range-fields label{min-width:110px;max-width:180px}
  #voiceFxPanel .vfx-range-fields input{width:100%}
  #voiceFxPanel .vfx-tip{font-size:11px;color:#abbed1;margin:6px 0}
  #voiceFxPanel .vfx-range-buttons{display:flex;gap:8px;flex-wrap:wrap}
  #voiceFxPanel .vfx-pick{font-size:12px;color:#a9e3d5;font-variant-numeric:tabular-nums}

  `;
  document.head.append(css);
  const section=document.createElement('details');section.id='voiceFxPanel';
  section.innerHTML=`<summary>✦ 声の特殊エフェクト（エコー・ハモリ・響き・ノイズ）</summary>
    <div class="vfx-inner">
      <p class="vfx-note">録音を波形で範囲選択し、その部分だけを加工します。原音を残したまま、新しいクリップを元のフレーズと同じ位置に追加できます。</p>
      <div class="vfx-row">
        <label>声を選ぶ <select id="vfxSource"></select></label>
        <button type="button" id="vfxRefresh">録音一覧を更新 ↻</button>
      </div>
      <div class="vfx-wave-card">
        <div class="vfx-wave-label"><b>声の波形をなぞって範囲選択</b><span class="vfx-pick" id="vfxPicked">音源を選択してください</span></div>
        <canvas id="vfxWave" aria-label="録音波形。ドラッグして加工範囲を選択" role="img"></canvas>
        <div class="vfx-wave-label"><span id="vfxWaveFrom">0:00</span><span id="vfxWaveTo">0:00</span></div>
        <p class="vfx-tip">波形を指で横になぞって範囲を指定。紫の端をドラッグして微調整できます。声の一節だけ選べます。</p>
        <div class="vfx-range-fields">
          <label>開始（秒）<input id="vfxRangeStart" type="number" inputmode="decimal" min="0" step="0.01" value="0"></label>
          <label>終了（秒）<input id="vfxRangeEnd" type="number" inputmode="decimal" min="0.05" step="0.01" value="1"></label>
          <div class="vfx-range-buttons"><button type="button" id="vfxRangeAll">全体</button><button type="button" id="vfxRangeListen">▶ 選択を聴く</button></div>
        </div>
        <audio id="vfxRangePlayer" playsinline preload="none" hidden></audio>
      </div>
      <div class="vfx-row">
        <label>演出プリセット <select id="vfxPreset">
          <option value="custom">カスタム</option>
          <option value="echo">ポワンワン反復エコー</option>
          <option value="room">ほんのり響く声</option>
          <option value="wide">広いホール</option>
          <option value="harm">上下ハモリ</option>
          <option value="lofi">ざらついたノイズ声</option>
          <option value="dream">揺れる夢の残響</option>
        </select></label>
        <label>ハモリ <select id="vfxHarmony">
          <option value="none">なし</option>
          <option value="up3">上 +3半音（短3度）</option>
          <option value="up4">上 +4半音（長3度）</option>
          <option value="down3">下 −3半音</option>
          <option value="down4">下 −4半音</option>
          <option value="up7">上 +7半音（5度）</option>
          <option value="duet">上下2声（+4 / −3）</option>
        </select></label>
      </div>
      <div class="vfx-grid">
        <label>エコー間隔 <span id="vfxEchoMsVal" class="vfx-numeric"></span><input id="vfxEchoMs" type="range" min="100" max="650" step="10" value="250"></label>
        <label>エコー回数 <span id="vfxEchoCountVal" class="vfx-numeric"></span><input id="vfxEchoCount" type="range" min="0" max="7" step="1" value="0"></label>
        <label>エコー音量 <span id="vfxEchoMixVal" class="vfx-numeric"></span><input id="vfxEchoMix" type="range" min="0" max="90" step="1" value="50"></label>
        <label>残響（リバーブ） <span id="vfxReverbVal" class="vfx-numeric"></span><input id="vfxReverb" type="range" min="0" max="75" step="1" value="12"></label>
        <label>ハモリ音量 <span id="vfxHarmMixVal" class="vfx-numeric"></span><input id="vfxHarmMix" type="range" min="0" max="90" step="1" value="35"></label>
        <label>ノイズ量 <span id="vfxNoiseVal" class="vfx-numeric"></span><input id="vfxNoise" type="range" min="0" max="75" step="1" value="0"></label>
        <label>歪み・ざらつき <span id="vfxDriveVal" class="vfx-numeric"></span><input id="vfxDrive" type="range" min="0" max="80" step="1" value="0"></label>
        <label>エコーの揺れ <span id="vfxWarbleVal" class="vfx-numeric"></span><input id="vfxWarble" type="range" min="0" max="80" step="1" value="0"></label>
      </div>
      <div class="vfx-row"><label>書き出し内容 <select id="vfxMode">
        <option value="wet" selected>エフェクト成分のみ（元の声に重ねる・推奨）</option>
        <option value="full">原音＋エフェクト（原音と重ねると二重になる）</option>
        <option value="harmony">ハモリだけ（新トラック向け）</option>
      </select></label><label>曲に追加する声レイヤー <select id="vfxTargetLane"></select></label></div>
      <div class="vfx-output">
        <button type="button" class="vfx-primary" id="vfxMake">▶ 加工して試聴</button>
        <button type="button" id="vfxExport" disabled>↓ 加工WAVを保存</button>
        <button type="button" id="vfxImport" disabled>＋ この曲に新クリップで追加</button>
      </div>
      <audio id="vfxPlayer" controls playsinline preload="none"></audio>
      <div id="vfxStatus" role="status" aria-live="polite">元の声を選び、プリセットや効果を調整してください。</div>
      <p class="vfx-note">※ 「エフェクト成分のみ」は元の録音を残して重ねます。ハモリは固定音程の簡易生成で、曲の和声に自動追従しません。波形の範囲選択は1クリップ内の音声だけを対象にします。出力後の位置はタイムラインで確認してください。</p>
    </div>`;
  mount.insertAdjacentElement('afterend',section);
  const controls=['EchoMs','EchoCount','EchoMix','Reverb','HarmMix','Noise','Drive','Warble'];
  let db=null,record=null,renderedBlob=null,renderedFile=null,renderedMeta=null,previewURL=null,busy=false;
  let waveformBuffer=null,waveformFileURL=null,waveformId='',rangeStart=0,rangeEnd=0,rangeDrag=null,selectionIsCustom=false,rangeStop=null;
  const status=$('vfxStatus'),setStatus=s=>status.textContent=s;
  const val=x=>Number($('vfx'+x).value)||0;
  const set=(x,n)=>{$('vfx'+x).value=String(n);};
  const modes={
    echo:{EchoMs:270,EchoCount:5,EchoMix:54,Reverb:15,HarmMix:0,Noise:0,Drive:0,Warble:17,h:'none'},
    room:{EchoMs:230,EchoCount:0,EchoMix:0,Reverb:17,HarmMix:0,Noise:0,Drive:0,Warble:0,h:'none'},
    wide:{EchoMs:345,EchoCount:1,EchoMix:21,Reverb:55,HarmMix:0,Noise:0,Drive:0,Warble:0,h:'none'},
    harm:{EchoMs:220,EchoCount:0,EchoMix:0,Reverb:12,HarmMix:37,Noise:0,Drive:0,Warble:0,h:'duet'},
    lofi:{EchoMs:175,EchoCount:1,EchoMix:18,Reverb:4,HarmMix:0,Noise:32,Drive:40,Warble:0,h:'none'},
    dream:{EchoMs:310,EchoCount:5,EchoMix:47,Reverb:46,HarmMix:19,Noise:3,Drive:0,Warble:64,h:'up4'}
  };
  function indicate(){for(const x of controls)$('vfx'+x+'Val').textContent=val(x)+(x==='EchoMs'?' ms':x==='EchoCount'?' 回':'%');}
  function invalidate(){renderedBlob=null;renderedFile=null;renderedMeta=null;$('vfxExport').disabled=true;$('vfxImport').disabled=true;try{$('vfxPlayer').pause();}catch{}if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('vfxPlayer').removeAttribute('src');$('vfxPlayer').load();}
  for(const x of controls)$('vfx'+x).addEventListener('input',()=>{indicate();invalidate();$('vfxPreset').value='custom';});
  for(const x of ['Harmony','Mode'])$('vfx'+x).addEventListener('change',invalidate);
  $('vfxMode').addEventListener('change',()=>{if($('vfxMode').value==='harmony'&&record){const target=$('vfxTargetLane'),lane=record.lanes?.find(x=>/ハモリ/.test(x.name)&&/上/.test(x.name))||record.lanes?.find(x=>/ハモリ/.test(x.name));if(lane)target.value=lane.id;}});
  $('vfxPreset').addEventListener('change',()=>{const opt=modes[$('vfxPreset').value];if(!opt)return;for(const [k,v] of Object.entries(opt)){if(k==='h')$('vfxHarmony').value=v;else set(k,v);}indicate();invalidate();});
  indicate();
  function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('voice-atelier-local-v1');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('録音保存領域を開けません。'));});}
  function dbRead(database,store,key){return new Promise((resolve,reject)=>{try{const req=database.transaction(store,'readonly').objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}catch(e){reject(e);}});}
  async function refresh(){
    try{
      if(!db)db=await openDB();const data=await dbRead(db,'settings','songStudioProjectV2');
      if(!data?.clips?.length){record=null;$('vfxSource').replaceChildren(new Option('録音がありません（先に録音してください）',''));setStatus('録音後に「録音一覧を更新」を押してください。');return;}
      const pick=$('vfxSource'),current=pick.value;pick.replaceChildren();
      for(const clip of data.clips){const lane=data.lanes?.find(l=>l.id===clip.laneId);if(lane?.guide)continue;const block=data.sections?.find(s=>s.id===clip.sectionId);pick.add(new Option(`${block?.name||'ブロック'} / ${lane?.name||'声'} / ${clip.filename||'録音'}`,clip.id));}
      if([...pick.options].some(x=>x.value===current))pick.value=current;
      else if(pick.options.length)pick.selectedIndex=0;
      if(!pick.options.length)pick.add(new Option('編集できる歌声がありません',''));
      record=data;
      const target=$('vfxTargetLane'),oldTarget=target.value;target.replaceChildren();
      for(const lane of data.lanes||[]){if(lane.guide)continue;target.add(new Option(lane.name,lane.id));}
      if([...target.options].some(o=>o.value===oldTarget))target.value=oldTarget;
      else {const source=data.clips.find(c=>c.id===pick.value);if(source)target.value=source.laneId;}
      setStatus(`録音 ${pick.options.length}件を読み込みました。波形からフレーズを選択してください。`);
      await loadWaveform();
    }catch(e){setStatus('録音データにアクセスできません：'+e.message);}
  }
  $('vfxRefresh').onclick=()=>{invalidate();void refresh();};
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const canvas=$('vfxWave'),rStart=$('vfxRangeStart'),rEnd=$('vfxRangeEnd');
  const secText=n=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}.${String(Math.floor((n%1)*100)).padStart(2,'0')}`;
  function updateRange(syncInputs=true){
    const length=waveformBuffer?.duration||0;
    rangeStart=clamp(rangeStart,0,length);rangeEnd=clamp(rangeEnd,0,length);
    if(rangeEnd-rangeStart<.05){rangeEnd=Math.min(length,rangeStart+.05);if(rangeEnd-rangeStart<.05)rangeStart=Math.max(0,rangeEnd-.05);}
    rStart.max=rEnd.max=length.toFixed(3);
    if(syncInputs){rStart.value=rangeStart.toFixed(2);rEnd.value=rangeEnd.toFixed(2);}
    $('vfxPicked').textContent=length?`${secText(rangeStart)} — ${secText(rangeEnd)}（${(rangeEnd-rangeStart).toFixed(2)}秒）`:'録音がありません';
    $('vfxWaveFrom').textContent='0:00';$('vfxWaveTo').textContent=secText(length);
    drawWaveform();invalidate();
  }
  function drawWaveform(){
    const ratio=Math.min(2,window.devicePixelRatio||1),w=Math.max(220,Math.round(canvas.clientWidth||350)),h=112;
    canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
    const g=canvas.getContext('2d');g.setTransform(ratio,0,0,ratio,0,0);
    g.clearRect(0,0,w,h);g.fillStyle='#0b1322';g.fillRect(0,0,w,h);
    if(!waveformBuffer)return;
    const duration=waveformBuffer.duration,s=rangeStart/duration*w,e=rangeEnd/duration*w;
    g.fillStyle='#4e4079';g.fillRect(s,0,Math.max(1,e-s),h);
    g.strokeStyle='#283a52';g.lineWidth=1;g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke();
    const audio=waveformBuffer.getChannelData(0),stride=Math.max(1,Math.floor(audio.length/w));
    for(let i=0;i<w;i++){
      let peak=0;const from=Math.floor(i/w*audio.length),to=Math.min(audio.length,Math.floor((i+1)/w*audio.length));
      const hop=Math.max(1,Math.floor((to-from)/30));
      for(let j=from;j<to;j+=hop)peak=Math.max(peak,Math.abs(audio[j]||0));
      const amp=Math.max(1,peak*(h*.43));g.fillStyle=i>=s&&i<=e?'#cfb8ff':'#6dbdb6';g.fillRect(i,h/2-amp,1,amp*2);
    }
    for(const [x] of [[s],[e]]){g.fillStyle='#ede0ff';g.fillRect(Math.max(0,x-1.3),0,2.6,h);g.fillRect(Math.max(0,x-5),0,10,6);g.fillRect(Math.max(0,x-5),h-6,10,6);}
  }
  async function loadWaveform(){
    const id=$('vfxSource').value;
    if(!id||!db){waveformBuffer=null;waveformId='';updateRange();return;}
    if(id===waveformId&&waveformBuffer){drawWaveform();return;}
    waveformId=id;waveformBuffer=null;
    if(waveformFileURL){URL.revokeObjectURL(waveformFileURL);waveformFileURL=null;}
    try{
      const blob=await dbRead(db,'clips',id);if(!(blob instanceof Blob))throw Error('録音データがありません。');
      if(id!==$('vfxSource').value)return;
      const ctx=new Audio();let decoded;
      try{decoded=await ctx.decodeAudioData(await blob.arrayBuffer());}finally{await ctx.close().catch(()=>{});}
      if(id!==$('vfxSource').value)return;
      waveformBuffer=decoded;rangeStart=0;rangeEnd=decoded.duration;selectionIsCustom=false;
      waveformFileURL=URL.createObjectURL(blob);$('vfxRangePlayer').src=waveformFileURL;updateRange();
    }catch(e){setStatus('波形を表示できません：'+e.message);waveformId='';updateRange();}
  }
  const pointerTime=e=>clamp((e.clientX-canvas.getBoundingClientRect().left)/Math.max(1,canvas.getBoundingClientRect().width),0,1)*(waveformBuffer?.duration||0);
  canvas.addEventListener('pointerdown',e=>{
    if(!waveformBuffer||busy||e.pointerType==='mouse'&&e.button!==0)return;
    e.preventDefault();const at=pointerTime(e),w=canvas.getBoundingClientRect().width,d=waveformBuffer.duration;
    const tol=d*Math.min(.08,16/Math.max(w,1));
    const nearStart=Math.abs(at-rangeStart)<tol,nearEnd=Math.abs(at-rangeEnd)<tol;
    const mode=(nearStart||nearEnd)?(nearStart&&(!nearEnd||Math.abs(at-rangeStart)<=Math.abs(at-rangeEnd))?'start':'end'):'new';
    rangeDrag={id:e.pointerId,mode,anchor:at};canvas.setPointerCapture(e.pointerId);
    if(mode==='new'){rangeStart=at;rangeEnd=Math.min(d,at+.05);}selectionIsCustom=true;updateRange();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!rangeDrag||e.pointerId!==rangeDrag.id||!waveformBuffer)return;
    e.preventDefault();const t=pointerTime(e),d=waveformBuffer.duration;
    if(rangeDrag.mode==='start')rangeStart=Math.min(t,rangeEnd-.05);
    else if(rangeDrag.mode==='end')rangeEnd=Math.max(t,rangeStart+.05);
    else{rangeStart=Math.min(rangeDrag.anchor,t);rangeEnd=Math.max(rangeDrag.anchor,t);}
    rangeStart=clamp(rangeStart,0,Math.max(0,d-.05));rangeEnd=clamp(rangeEnd,rangeStart+.05,d);updateRange();
  });
  const doneDrag=e=>{if(rangeDrag&&e.pointerId===rangeDrag.id){rangeDrag=null;updateRange();}};
  canvas.addEventListener('pointerup',doneDrag);canvas.addEventListener('pointercancel',doneDrag);
  for(const [el,key] of [[rStart,'start'],[rEnd,'end']])el.addEventListener('change',()=>{
    if(!waveformBuffer)return;const t=Number(el.value);if(!Number.isFinite(t))return updateRange();
    if(key==='start')rangeStart=Math.min(t,rangeEnd-.05);else rangeEnd=Math.max(t,rangeStart+.05);
    selectionIsCustom=true;updateRange();
  });
  $('vfxRangeAll').onclick=()=>{if(!waveformBuffer)return;rangeStart=0;rangeEnd=waveformBuffer.duration;selectionIsCustom=false;updateRange();};
  $('vfxSource').onchange=()=>{invalidate();void loadWaveform();};
  $('vfxRangeListen').onclick=()=>{
    if(!waveformBuffer)return setStatus('まず録音を選択してください。');
    const player=$('vfxRangePlayer');if(!player.src)return;
    try{player.pause();player.currentTime=rangeStart;player.play().catch(e=>setStatus('試聴できません：'+e.message));}
    catch(e){setStatus('試聴できません：'+e.message);}
  };
  $('vfxRangePlayer').ontimeupdate=e=>{if(e.currentTarget.currentTime>=rangeEnd){e.currentTarget.pause();}};
  window.addEventListener('resize',drawWaveform);
  function resample(audio,rate){
    const length=Math.floor(audio.duration*rate),n=audio.numberOfChannels,channels=[];
    for(let ch=0;ch<Math.min(n,2);ch++){
      const src=audio.getChannelData(ch),out=new Float32Array(length),ratio=audio.sampleRate/rate;
      for(let i=0;i<length;i++){const p=i*ratio,idx=Math.floor(p),t=p-idx;out[i]=(src[idx]||0)*(1-t)+(src[Math.min(idx+1,src.length-1)]||0)*t;}
      channels.push(out);
    }
    return channels;
  }
  function granularShift(input,ratio,rate){
    const N=input.length,out=new Float32Array(N),wgt=new Float32Array(N),grain=Math.round(rate*.067/4)*4,hop=grain/4;
    // Weighted overlap-add. Each grain is centered at original time; rate changes pitch without moving syllables.
    for(let center=0;center<N+hop;center+=hop){
      for(let j=0;j<grain;j++){
        const d=center+j-grain/2;if(d<0||d>=N)continue;
        const src=center+(j-grain/2)*ratio;const k=Math.floor(src);
        if(k<0||k+1>=N)continue;
        const f=src-k,weight=.5-.5*Math.cos(2*Math.PI*j/(grain-1));
        out[d]+=(input[k]*(1-f)+input[k+1]*f)*weight;
        wgt[d]+=weight;
      }
    }
    for(let i=0;i<N;i++)out[i]=wgt[i]>.03?out[i]/wgt[i]:input[i];
    return out;
  }
  function makeIR(ctx,length){
    const len=Math.floor(ctx.sampleRate*length),b=ctx.createBuffer(2,len,ctx.sampleRate);
    let state=912847;
    for(let c=0;c<2;c++){
      const a=b.getChannelData(c);for(let i=0;i<len;i++){
        state=(Math.imul(state,1664525)+1013904223)|0;
        const rnd=(state>>>0)/2147483648-1,env=Math.pow(1-i/len,2.4);
        a[i]=rnd*env*(1.4/Math.sqrt(ctx.sampleRate));
      }
    }
    return b;
  }
  function floatToWav(channels,rate){
    const len=channels[0].length,n=channels.length,ab=new ArrayBuffer(44+len*n*2),v=new DataView(ab);
    function s(at,w){for(let i=0;i<w.length;i++)v.setUint8(at+i,w.charCodeAt(i));}
    s(0,'RIFF');v.setUint32(4,ab.byteLength-8,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,n,true);v.setUint32(24,rate,true);v.setUint32(28,rate*n*2,true);v.setUint16(32,n*2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,len*n*2,true);
    let max=0;for(const ch of channels)for(let i=0;i<ch.length;i++)max=Math.max(max,Math.abs(ch[i]));const gain=max>.965?.965/max:1;
    for(let i=0;i<len;i++)for(let ch=0;ch<n;ch++)v.setInt16(44+(i*n+ch)*2,Math.round(clamp(channels[ch][i]*gain,-1,1)*32767),true);
    return new Blob([ab],{type:'audio/wav'});
  }
  function addNoiseAndDrive(channels,sourceLen,rate){
    let seed=4623947,noise=val('Noise')/100,drive=val('Drive')/100;
    if(!noise&&!drive)return;
    const amount=Math.pow(noise,1.6)*.065,boost=1+drive*8;
    for(let ch=0;ch<channels.length;ch++){
      const a=channels[ch];for(let i=0;i<a.length;i++){
        const s=a[i];seed=(Math.imul(seed,1664525)+1013904223)|0;
        const white=((seed>>>0)/2147483648-1),env=i<sourceLen?Math.min(1,.15+Math.abs(s)*5):0;
        const combined=s+white*amount*env;
        a[i]=drive?(Math.tanh(combined*boost)/Math.tanh(boost)):combined;
      }
    }
  }
  async function process(src,meta){
    const rate=src.sampleRate>44100?44100:src.sampleRate;
    if(src.duration>91)throw Error('選択範囲は90秒以内にしてください（iPadの負荷を抑えるため）。');
    if(src.duration<.05)throw Error('音声が短すぎます。');
    const mode=$('vfxMode').value,hm=$('vfxHarmony').value,harmMix=val('HarmMix')/100;
    const hmSemis={up3:[3],up4:[4],down3:[-3],down4:[-4],up7:[7],duet:[4,-3]};
    const shifts=hm==='none'?[]:hmSemis[hm]||[];
    if(mode==='harmony'&&(!shifts.length||!harmMix))throw Error('ハモリを選び、ハモリ音量を上げてください。');
    const base=resample(src,rate),len=base[0].length;
    for(const cut of meta?.cuts||[]){
      const a=Math.floor(clamp((Number(cut.start)||0)-(meta.selectionStart||0),0,src.duration)*rate);
      const b=Math.floor(clamp((Number(cut.end)||0)-(meta.selectionStart||0),0,src.duration)*rate);
      for(const ch of base)ch.fill(0,a,b);
    }
    // Tiny fade avoids clicks at the exact edit boundary. Tail effects continue after the end.
    const fade=Math.max(1,Math.min(Math.floor(rate*.009),Math.floor(len/8)));
    for(const ch of base)for(let i=0;i<fade;i++){ch[i]*=i/fade;ch[len-1-i]*=i/fade;}
    const reverb=val('Reverb')/100,echoCount=val('EchoCount'),echoMs=val('EchoMs'),echoMix=val('EchoMix')/100,warble=val('Warble')/100;
    const echoSec=(echoCount?echoMs/1000*echoCount+.4:0),rvTail=reverb?(0.8+reverb*2.3):0;
    const tail=Math.min(5,Math.max(echoSec,rvTail))+.17,total=len+Math.ceil(rate*tail);
    if(total>rate*188)throw Error('音源が長すぎます。');
    const offline=new Offline(2,total,rate);
    const dest=offline.createDynamicsCompressor();dest.threshold.value=-5;dest.ratio.value=9;dest.attack.value=.005;dest.release.value=.20;dest.connect(offline.destination);
    const bus=offline.createGain();
    const source=offline.createBuffer(base.length,len,rate);for(let ch=0;ch<base.length;ch++)source.copyToChannel(base[ch],ch);
    const attach=(buffer,gain,pan=0)=>{const node=offline.createBufferSource();node.buffer=buffer;const amp=offline.createGain();amp.gain.value=gain;node.connect(amp);if(offline.createStereoPanner){const p=offline.createStereoPanner();p.pan.value=pan; amp.connect(p);p.connect(bus);}else amp.connect(bus);node.start(0);};
    if(mode!=='harmony')attach(source,1);
    // Harmonic voices are added to the common FX bus and are also individually audible.
    if(shifts.length&&harmMix>0){for(let k=0;k<shifts.length;k++){
      setStatus(`ハモリを生成中 ${k+1}/${shifts.length}（時間と音程を維持）…`);await new Promise(r=>setTimeout(r,15));
      const shifted=offline.createBuffer(base.length,len,rate),ratio=Math.pow(2,shifts[k]/12);
      for(let ch=0;ch<base.length;ch++)shifted.copyToChannel(granularShift(base[ch],ratio,rate),ch);
      const node=offline.createBufferSource();node.buffer=shifted;const amp=offline.createGain();amp.gain.value=harmMix/(shifts.length===2?1.15:1);
      node.connect(amp);if(offline.createStereoPanner){const p=offline.createStereoPanner();p.pan.value=shifts[k]>0?-.27:.27;amp.connect(p);p.connect(dest);}else amp.connect(dest);node.start(0);
    }}
    // Only wet export: the dry voice is audible only as a source for echoes/reverb.
    const direct=offline.createGain();direct.gain.value=mode==='full'?1:0;
    bus.connect(direct);direct.connect(dest);
    if(echoCount&&echoMix&&mode!=='harmony'){
      const delay=offline.createDelay(1.5),repeats=offline.createGain(),wet=offline.createGain();
      delay.delayTime.value=echoMs/1000;repeats.gain.value=Math.min(.78,echoCount<=1?0:.22+echoCount*.073);wet.gain.value=echoMix*.75;
      bus.connect(delay);delay.connect(wet);wet.connect(dest);delay.connect(repeats);repeats.connect(delay);
      if(warble){const osc=offline.createOscillator(),depth=offline.createGain();osc.frequency.value=3.1;depth.gain.value=warble*.015;osc.connect(depth);depth.connect(delay.delayTime);osc.start(0);osc.stop((total/rate));}
    }
    if(reverb>0&&mode!=='harmony'){
      const rev=offline.createConvolver(),wet=offline.createGain();rev.buffer=makeIR(offline,1+reverb*2.5);wet.gain.value=reverb*.9;bus.connect(rev);rev.connect(wet);wet.connect(dest);
    }
    setStatus('WAVへ書き出すための音声を合成中…');await new Promise(r=>setTimeout(r,20));
    const result=await offline.startRendering();const channels=[];for(let ch=0;ch<Math.min(2,result.numberOfChannels);ch++)channels.push(result.getChannelData(ch).slice());
    if(mode==='wet'&&(val('Noise')>0||val('Drive')>0)){
      // Make special texture audible as an additive layer without duplicating the untreated original.
      const core=base;
      const transformed=core.map(ch=>{const out=new Float32Array(channels[0].length);out.set(ch);return out;});
      addNoiseAndDrive(transformed,len,rate);
      for(let c=0;c<channels.length;c++)for(let i=0;i<len;i++)channels[c][i]+=transformed[Math.min(c,transformed.length-1)][i]-(core[Math.min(c,core.length-1)][i]||0);
    }else if(mode!=='wet')addNoiseAndDrive(channels,len,rate);
    return {blob:floatToWav(channels,rate),sampleRate:rate,duration:result.duration};
  }
  function clean(name){return String(name||'Voice').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,42);}
  let selectedMeta;
  async function render(){
    if(busy)return;busy=true;$('vfxMake').disabled=true;invalidate();
    try{
      if(!db)db=await openDB();const data=await dbRead(db,'settings','songStudioProjectV2');const id=$('vfxSource').value;
      const meta=data?.clips?.find(c=>c.id===id);if(!meta)throw Error('録音を選び直して「録音一覧を更新」を押してください。');
      if(id!==waveformId||!waveformBuffer)await loadWaveform();
      const full=waveformBuffer;if(!full)throw Error('選んだ声の波形が読み込まれていません。');
      const start=rangeStart,end=rangeEnd;if(end-start<.05)throw Error('0.05秒以上の範囲を選んでください。');
      if(end-start>90)throw Error('一度に加工できる範囲は90秒以内です。波形で一節を選んでください。');
      const at=Math.floor(start*full.sampleRate),until=Math.min(full.length,Math.ceil(end*full.sampleRate));
      const ctx=new Audio();let src;
      try{
        src=ctx.createBuffer(full.numberOfChannels,until-at,full.sampleRate);
        for(let ch=0;ch<full.numberOfChannels;ch++)src.copyToChannel(full.getChannelData(ch).subarray(at,until),ch);
      }finally{await ctx.close().catch(()=>{});}
      const processed=await process(src,{...meta,selectionStart:start});
      renderedBlob=processed.blob;renderedMeta={...meta,selectionStart:start,selectionEnd:end};
      renderedFile=new File([renderedBlob],`${clean(meta.filename)}-${start.toFixed(2)}s-${end.toFixed(2)}s-VoiceFX.wav`,{type:'audio/wav'});
      previewURL=URL.createObjectURL(renderedBlob);$('vfxPlayer').src=previewURL;
      $('vfxExport').disabled=false;$('vfxImport').disabled=false;
      setStatus(`完成：選択 ${start.toFixed(2)}〜${end.toFixed(2)}秒（余韻込み${processed.duration.toFixed(1)}秒）。元の声は変更していません。`);
    }catch(e){setStatus('エフェクト生成失敗：'+e.message);console.error('VoiceFX',e);}
    finally{busy=false;$('vfxMake').disabled=false;}
  }
  $('vfxMake').onclick=()=>void render();
  $('vfxExport').onclick=()=>{if(!renderedBlob)return;const link=document.createElement('a'),url=URL.createObjectURL(renderedBlob);link.href=url;link.download=renderedFile.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
  async function importResult(){
    if(!renderedFile||!renderedMeta||busy)return;
    // Use Voice Atelier's existing importer. This keeps the untouched recording and adds a new clip.
    const fileInput=$('fileInput'),recordSection=$('recordSection'),recordLane=$('recordLane');
    if(!fileInput||!recordSection||!recordLane||typeof DataTransfer==='undefined'){
      setStatus('自動取り込みはこのSafariで利用できません。加工WAVを保存して「＋音声を取り込む」から追加してください。');return;
    }
    const beforeSection=recordSection.value,beforeLane=recordLane.value;
    const requestedLane=$('vfxTargetLane').value;
    const lane=[...recordLane.options].some(o=>o.value===requestedLane)?requestedLane:beforeLane;
    const section=[...recordSection.options].some(o=>o.value===renderedMeta.sectionId)?renderedMeta.sectionId:beforeSection;
    try{
      recordSection.value=section;recordSection.dispatchEvent(new Event('change',{bubbles:true}));
      recordLane.value=lane;recordLane.dispatchEvent(new Event('change',{bubbles:true}));
      const dt=new DataTransfer();dt.items.add(renderedFile);fileInput.files=dt.files;fileInput.dispatchEvent(new Event('change',{bubbles:true}));
      setStatus('新しい録音クリップとして追加しています…（元の録音はそのまま残ります）');
      // Wait for the asynchronous app importer and its selected-clip inspector.
      let found=false;
      for(let i=0;i<45;i++){
        await new Promise(r=>setTimeout(r,160));
        const label=$('clipInspector')?.querySelector('.inspector-head strong')?.textContent||'';
        const offset=$('clipInspector')?.querySelector('.clip-offset');
        if(label&&offset&&label.includes('/')){
          const data=await dbRead(db,'settings','songStudioProjectV2');
          // The newest clip should be the imported file. Check filename match to avoid moving another recording.
          const last=data?.clips?.at(-1);
          if(last?.filename===renderedFile.name.replace(/\.wav$/i,'')&&last.id!==renderedMeta.id){
            offset.value=Number(((renderedMeta.offsetSec||0)+(renderedMeta.selectionStart||0)).toFixed(3));offset.dispatchEvent(new Event('change',{bubbles:true}));found=true;break;
          }
        }
      }
      setStatus(found?'追加成功。選択範囲の位置に加工声を配置しました（原音も残っています）。もし原音＋エフェクトを選んだ場合は声が二重になるのでご注意ください。':'追加操作を送信しました。タイムラインに新しいクリップがあるか確認してください。位置がずれた場合は手動で調整してね。');
    }catch(e){setStatus('自動取り込み失敗：'+e.message+'。加工WAVを保存して通常の取り込みから追加してください。');}
    finally{
      if([...recordSection.options].some(o=>o.value===beforeSection)){recordSection.value=beforeSection;recordSection.dispatchEvent(new Event('change',{bubbles:true}));}
      if([...recordLane.options].some(o=>o.value===beforeLane)){recordLane.value=beforeLane;recordLane.dispatchEvent(new Event('change',{bubbles:true}));}
    }
  }
  $('vfxImport').onclick=()=>void importResult();
  section.addEventListener('toggle',()=>{if(section.open)void refresh();else $('vfxRangePlayer').pause();});
  // No auto-play and no network requests; do not overwrite project data.
})();
