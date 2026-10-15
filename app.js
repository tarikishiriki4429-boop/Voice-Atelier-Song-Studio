'use strict';
(()=>{
  const $=id=>document.getElementById(id);
  const Context=window.AudioContext||window.webkitAudioContext;
  const OfflineContext=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const MAX_RECORD_SEC=180,MAX_IMPORT_SEC=900,MAX_IMPORT_BYTES=200*1024*1024,MAX_MIX_SEC=900,MAX_CLIPS=160,MAX_LANES=24;
  const COLORS=['#a99af0','#81c4e6','#e3a2c1','#e7c77f','#9ad8ae','#df9e89','#adaad8','#75d8c3'];
  const defaultSectionNames=['Aメロ','Bメロ','Cメロ','サビ','ラスサビ'];
  const defaultBars=[8,8,8,8,8];
  const defaultLaneNames=['リード','ハモリ（上）','ハモリ（下）','ダブル'];
  const FX={hp:75,gate:0,low:0,mid:1.5,high:1,deess:1,compressor:3,reverb:8};
  const PRESETS={natural:{...FX},warm:{hp:70,gate:10,low:2,mid:0,high:-1,deess:2,compressor:3,reverb:10},clear:{hp:100,gate:12,low:-2,mid:3,high:2,deess:3,compressor:4,reverb:6},radio:{hp:165,gate:22,low:-4,mid:5,high:-2,deess:2,compressor:6,reverb:1}};
  const FIELDS=[['hp','ローカット','Hz',40,220,5],['gate','無音部のノイズゲート','%',0,100,1],['low','低音','dB',-12,12,.5],['mid','中音','dB',-12,12,.5],['high','高音','dB',-12,12,.5],['deess','サ行の刺さり','dB',0,9,.5],['compressor','音量差を整える','/10',0,10,1],['reverb','残響','%',0,35,1]];
  const st={projectName:'新しい曲',bpm:100,beats:4,sections:[],lanes:[],clips:[],selectedSection:'',selectedLane:'',selectedClip:'',ctx:null,db:null,playing:null,recording:null,starting:false,stopping:false,position:0,zoom:48,duration:0,saveTimer:0,toaster:0,replayTimer:0,raf:0,meterRaf:0,metro:null,stopSources:[],impulses:new WeakMap(),nextId:1,bridge:null,overwriteHistory:[]};
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number.isFinite(+v)?+v:a));
  const sTime=n=>{const x=Math.max(0,Number(n)||0);return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(Math.floor(x)%60).padStart(2,'0')}.${Math.floor(x*10)%10}`;};
  const id=prefix=>`${prefix}${Date.now().toString(36)}${(st.nextId++).toString(36)}`;
  const beatSec=()=>60/st.bpm;
  const getSection=key=>st.sections.find(s=>s.id===key);
  const getLane=key=>st.lanes.find(l=>l.id===key);
  const getClip=key=>st.clips.find(c=>c.id===key);
  const secAt=s=>s.startBeat*beatSec();
  const clean=s=>String(s||'audio').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,60)||'audio';
  function toast(message,ms=3900){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(st.toaster);st.toaster=setTimeout(()=>el.classList.remove('show'),ms);}
  function initDefaults(){let beat=0;st.sections=defaultSectionNames.map((name,i)=>{const s={id:id('s'),name,bars:defaultBars[i],startBeat:beat,lyrics:'',color:COLORS[i%COLORS.length]};beat+=defaultBars[i]*st.beats;return s;});st.lanes=defaultLaneNames.map((name,i)=>makeLane(name,i));st.selectedSection=st.sections[0].id;st.selectedLane=st.lanes[0].id;}
  function makeLane(name,i){return {id:id('l'),name,volume:100,pan:0,mute:false,solo:false,fx:{...FX},color:COLORS[i%COLORS.length]};}
  function setSaveStatus(label){$('saveStatus').textContent=label;}
  function safeSection(s,i){return {id:typeof s?.id==='string'?s.id:id('s'),name:String(s?.name||defaultSectionNames[i]||`パート${i+1}`).slice(0,40),bars:clamp(Math.round(s?.bars??8),1,48),startBeat:clamp(s?.startBeat??i*32,0,20000),lyrics:String(s?.lyrics||'').slice(0,50000),color:COLORS[i%COLORS.length]};}
  function safeLane(l,i){return {id:typeof l?.id==='string'?l.id:id('l'),name:String(l?.name||`声${i+1}`).slice(0,30),volume:clamp(l?.volume??100,0,200),pan:clamp(l?.pan??0,-100,100),mute:!!l?.mute,solo:!!l?.solo,fx:Object.fromEntries(FIELDS.map(([k,, ,min,max])=>[k,clamp(l?.fx?.[k]??FX[k],min,max)])),color:COLORS[i%COLORS.length],guide:!!l?.guide};}
  function safeCuts(ranges){return (Array.isArray(ranges)?ranges:[]).slice(0,200).map(v=>({start:clamp(v.start,0,MAX_IMPORT_SEC),end:clamp(v.end,0,MAX_IMPORT_SEC)})).filter(v=>v.end>v.start);}
  function safeClip(c){return {id:c.id,sectionId:c.sectionId,laneId:c.laneId,offsetSec:clamp(c.offsetSec??0,-600,1200),volume:clamp(c.volume??100,0,200),mute:!!c.mute,filename:String(c.filename||'録音').slice(0,80),cuts:safeCuts(c.cuts),buffer:null,blob:null};}
  // The same history key is kept for compatibility with v0.3.2 backups.
  function safeOverwriteHistory(entries){return (Array.isArray(entries)?entries:[]).slice(-20).filter(x=>typeof x?.newClipId==='string'&&Array.isArray(x.previous)).map(x=>({mode:x.mode==='retake'?'retake':'replace',newClipId:x.newClipId,previous:x.previous.slice(0,MAX_CLIPS).filter(p=>typeof p.id==='string').map(p=>({id:p.id,cuts:safeCuts(p.cuts),...(typeof p.mute==='boolean'?{mute:p.mute}:{})}))}));}
  function visibleSpans(c){const length=c.buffer?.duration||0;if(!length)return [];const cuts=safeCuts(c.cuts).map(x=>({start:Math.min(length,x.start),end:Math.min(length,x.end)})).filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start);const parts=[];let last=0;for(const cut of cuts){if(cut.start>last+.001)parts.push({start:last,end:cut.start});last=Math.max(last,cut.end);}if(last<length-.001)parts.push({start:last,end:length});return parts;}
  function maskPreviousForOverwrite(newClip){const start=clipAt(newClip),end=start+newClip.buffer.duration,previous=[];for(const c of st.clips){if(c.id===newClip.id||c.laneId!==newClip.laneId||!c.buffer)continue;const oldStart=clipAt(c),a=Math.max(start,oldStart),b=Math.min(end,oldStart+c.buffer.duration);if(b<=a+.002)continue;previous.push({id:c.id,cuts:safeCuts(c.cuts)});c.cuts=safeCuts([...(c.cuts||[]),{start:a-oldStart,end:b-oldStart}]);}return previous;}
  function mutePreviousForRetake(newClip){
    // Retake means *the whole selected block on this lane*, not just the newly
    // recorded time span. Muting is reversible; PCM/WAV and old cuts are untouched.
    const previous=[];
    for(const c of st.clips){if(c.id===newClip.id||c.laneId!==newClip.laneId||c.sectionId!==newClip.sectionId||!c.buffer)continue;
      previous.push({id:c.id,mute:!!c.mute,cuts:safeCuts(c.cuts)});c.mute=true;
    }return previous;
  }
  function undoLastOverwrite(){if(st.recording||st.starting||st.stopping)return;const event=st.overwriteHistory.pop();if(!event)return toast('戻せる録音変更がありません。');stopForArrangement();for(const x of event.previous){const clip=getClip(x.id);if(clip){clip.cuts=safeCuts(x.cuts);if(typeof x.mute==='boolean')clip.mute=x.mute;}}const newest=getClip(event.newClipId);if(newest)newest.mute=true;st.selectedClip=newest?.id||'';saveSoon();renderAll();toast(event.mode==='retake'?'録り直す前の歌声に戻しました。新しいテイクはミュートで残しています。':'直前の上書きを元に戻しました。新しいテイクはミュートで残しています。',5200);}

  function allData(){return {version:2,projectName:st.projectName,bpm:st.bpm,beats:st.beats,sections:st.sections.map(s=>({...s})),lanes:st.lanes.map(l=>({...l,fx:{...l.fx}})),clips:st.clips.map(({buffer,blob,...c})=>({...c})),selectedSection:st.selectedSection,selectedLane:st.selectedLane,normalize:$('normalize').checked,tail:$('tail').checked,metroEnabled:$('metroEnabled').checked,metroAudible:$('metroAudible').checked,metroVolume:+$('metroVolume').value,zoom:st.zoom,bridge:st.bridge,includeGuideExport:$('includeGuideExport').checked,recordMode:$('recordMode').value,overwriteHistory:st.overwriteHistory.map(x=>({mode:x.mode||'replace',newClipId:x.newClipId,previous:x.previous.map(p=>({id:p.id,cuts:safeCuts(p.cuts),...(typeof p.mute==='boolean'?{mute:p.mute}:{})}))}))};}
  function dbReq(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function dbOpen(){return new Promise((resolve,reject)=>{const request=indexedDB.open('voice-atelier-local-v1',2);request.onupgradeneeded=()=>{const d=request.result;for(const s of ['takes','settings','clips'])if(!d.objectStoreNames.contains(s))d.createObjectStore(s);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function dbGet(store,key){return dbReq(st.db.transaction(store,'readonly').objectStore(store).get(key));}
  async function dbPut(store,key,val){return new Promise((resolve,reject)=>{const tx=st.db.transaction(store,'readwrite');tx.objectStore(store).put(val,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
  async function dbDelete(store,key){return new Promise((resolve,reject)=>{const tx=st.db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
  function saveSoon(){setSaveStatus('保存中…');clearTimeout(st.saveTimer);st.saveTimer=setTimeout(()=>void saveSettings(),550);}
  async function saveSettings(){try{if(st.db){await dbPut('settings','songStudioProjectV2',allData());setSaveStatus('自動保存済み');}else setSaveStatus('保存不可');}catch(e){console.error(e);setSaveStatus('保存に失敗');toast('自動保存できません。ZIPを必ず保存してください。',5500);}}
  async function saveClip(c){if(!st.db){toast('保存領域がないため録音は永続保存されません。ZIPを保存してください。');return false;}try{await dbPut('clips',c.id,c.blob);saveSoon();return true;}catch(e){console.error(e);toast('録音データの自動保存に失敗しました。今すぐZIPで保存してください。',6500);return false;}}
  async function loadProject(){try{
    st.db=await dbOpen();const data=await dbGet('settings','songStudioProjectV2');
    if(data&&Array.isArray(data.sections)&&Array.isArray(data.lanes)){
      st.projectName=String(data.projectName||'新しい曲').slice(0,60);st.bpm=clamp(data.bpm,40,240);st.beats=[3,4,6].includes(+data.beats)?+data.beats:4;
      st.sections=data.sections.slice(0,40).map(safeSection);st.lanes=data.lanes.slice(0,MAX_LANES).map(safeLane);
      if(!st.sections.length||!st.lanes.length)throw new Error('曲の構成データが不正です');
      st.selectedSection=getSection(data.selectedSection)?data.selectedSection:st.sections[0].id;st.selectedLane=getLane(data.selectedLane)?data.selectedLane:st.lanes[0].id;
      st.zoom=clamp(data.zoom??48,24,130);st.bridge=data.bridge||null;st.overwriteHistory=safeOverwriteHistory(data.overwriteHistory);$('recordMode').value=['replace','retake'].includes(data.recordMode)?data.recordMode:'overdub';$('includeGuideExport').checked=data.includeGuideExport===true;$('normalize').checked=data.normalize!==false;$('tail').checked=data.tail!==false;
      $('metroEnabled').checked=data.metroEnabled!==false;$('metroAudible').checked=data.metroAudible!==false;$('metroVolume').value=clamp(data.metroVolume??45,0,100);
      for(const m of (data.clips||[]).slice(0,MAX_CLIPS)){
        if(!m?.id||!getSection(m.sectionId)||!getLane(m.laneId))continue;
        const blob=await dbGet('clips',m.id);
        if(blob instanceof Blob){try{const ctx=await audioCtx(false),buffer=await ctx.decodeAudioData(await blob.arrayBuffer());st.clips.push({...safeClip(m),buffer,blob});}catch(e){console.warn('Clip restore failed',m.id,e);toast('一部の録音を復元できません。バックアップを確認してください。',6200);}}
      }
    }
    else {
      // Best-effort local migration from Voice Atelier v0.1 on the same website origin.
      const old=await dbGet('settings','project');if(old?.tracks){
        for(let i=0;i<4;i++){const blob=await dbGet('takes',i);if(!(blob instanceof Blob))continue;try{
          const ctx=await audioCtx(false),buffer=await ctx.decodeAudioData(await blob.arrayBuffer()),c={id:id('c'),sectionId:st.sections[0].id,laneId:st.lanes[i].id,offsetSec:clamp(old.tracks[i]?.delay??0,-5,5),volume:100,mute:false,filename:`旧録音${i+1}`,blob,buffer};st.clips.push(c);await saveClip(c);
        }catch(e){console.warn('Legacy migration',e);}}
        toast('以前の録音をAメロに読み込みました。ZIPバックアップを保存してください。',6500);
      }
      await saveSettings();
    }
    setSaveStatus('自動保存済み');
  }catch(e){console.warn('Local storage unavailable',e);setSaveStatus('端末保存不可');toast('保存領域が使用できません。曲のZIPバックアップを必ず保存してください。',6500);}
    syncUI();renderAll();
  }
  async function audioCtx(resume=true){if(!Context)throw new Error('このブラウザーは音声APIを使用できません');if(!st.ctx)st.ctx=new Context({latencyHint:'interactive'});if(resume&&st.ctx.state==='suspended')await st.ctx.resume();return st.ctx;}
  function duration(){let end=1;for(const s of st.sections)end=Math.max(end,secAt(s)+s.bars*st.beats*beatSec());for(const c of st.clips)if(c.buffer){const s=getSection(c.sectionId);if(s)end=Math.max(end,Math.max(0,secAt(s)+c.offsetSec)+c.buffer.duration);}return end;}
  function clipAt(c){if(getLane(c.laneId)?.guide)return Math.max(0,c.offsetSec);const s=getSection(c.sectionId);return s?Math.max(0,secAt(s)+c.offsetSec):0;}
  function updateRecordHint(){const m=$('recordMode').value;
    $('recordModeHint').textContent=m==='replace'?'上書き：録り直した時間だけ古い音を隠し、前後を残します。':m==='retake'?'録り直し：選択中のブロック × 声レイヤーの旧テイクを新しい録音に切り替えます。旧テイクは消さずに残り、取り消せます。':'重ね録り：以前のテイクを残し、新しい声を重ねて再生します。';
  }
  function syncUI(){ updateRecordHint(); $('projectName').value=st.projectName;$('bpm').value=st.bpm;$('beats').value=st.beats;$('zoom').value=st.zoom;renderDots();refreshPickers(); }
  function refreshPickers(){
    const a=$('recordSection'),b=$('recordLane'),previousA=a.value||st.selectedSection,previousB=b.value||st.selectedLane;
    a.replaceChildren(...st.sections.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));
    b.replaceChildren(...st.lanes.filter(l=>!l.guide).map(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=l.name;return o;}));
    a.value=getSection(previousA)?previousA:st.selectedSection;b.value=getLane(previousB)&&!getLane(previousB).guide?previousB:st.lanes.find(l=>!l.guide)?.id||'';
    $('editingLane').textContent=getLane(st.selectedLane)?.name||'—';if($('bridgeStatus'))$('bridgeStatus').textContent=st.bridge?`✓ ${st.bridge.format==='music-voice-bridge'?'Music':'Melody'} Atelier連携済み：${st.bridge.title}（ガイド・伴奏はボーカル書き出しから除外）`:'Melody Atelierの「Voice Atelierへ渡すZIP」をここから読み込めます。';
  }
  function renderDots(){const dots=$('beatDots');dots.replaceChildren(...Array.from({length:st.beats},(_,i)=>{const x=document.createElement('div');x.className='beat-dot'+(i===0?' first':'');return x;}));}
  function indicateBeat(num){const active=((num%st.beats)+st.beats)%st.beats;[...$('beatDots').children].forEach((n,i)=>n.classList.toggle('active',num!==null&&active===i));$('beatCount').textContent=num===null?'—':`${active+1}/${st.beats}`;}
  function renderSections(){const wrap=$('sectionCards');wrap.innerHTML='';st.sections.forEach((s,i)=>{
    const card=document.createElement('div');card.className='section-card'+(st.selectedSection===s.id?' active':'');card.dataset.sectionId=s.id;card.style.setProperty('--block-color',s.color);
    card.innerHTML=`<div class="section-top"><button class="small-btn section-grip" type="button" title="長押しせず上下にドラッグして順番を変更" aria-label="ブロックをドラッグして並べ替え">⠿</button><span class="section-dot"></span><span class="section-name"></span><button class="small-btn rec-here" title="このブロックで録音">● 録音先</button><button class="small-btn duplicate" title="歌詞や録音を複製">⧉ 複製</button><button class="small-btn up" title="上へ移動">↑</button><button class="small-btn down" title="下へ移動">↓</button><button class="small-btn delete" title="ブロックを削除">×</button></div><div class="section-settings"><label>名前 <input class="rename" maxlength="40" aria-label="ブロック名"></label><label>小節数 <input class="bars" type="number" min="1" max="48" step="1"></label><label>開始小節 <input class="bar-start" type="number" min="1" max="5000" step=".25"></label><span class="starts"></span></div><textarea class="lyrics" placeholder="この部分の歌詞を書く。\n何行でも入力できます。"></textarea><div class="section-move"><label>ブロック位置</label><button class="small-btn step-back" title="一拍前へ">−1拍</button><input class="start-slider" aria-label="ブロック開始位置" type="range" min="0" max="800" step="1"><button class="small-btn step-next" title="一拍後へ">+1拍</button><strong class="start-val"></strong></div>`;
    card.querySelector('.section-name').textContent=s.name;
    card.querySelector('.rename').value=s.name;card.querySelector('.bars').value=s.bars;card.querySelector('.lyrics').value=s.lyrics;
    card.querySelector('.bar-start').value=+(1+s.startBeat/st.beats).toFixed(2);
    card.querySelector('.starts').textContent=`≈ ${sTime(secAt(s))}`;
    const slider=card.querySelector('.start-slider');slider.max=Math.max(800,Math.ceil(st.sections.reduce((m,a)=>Math.max(m,a.startBeat+a.bars*st.beats),0)+64));slider.value=s.startBeat;
    card.querySelector('.start-val').textContent=`${s.startBeat}拍`;
    function setStart(v){s.startBeat=clamp(v,0,20000);stopForArrangement();saveSoon();renderSections();renderTimeline();updateTime();}
    card.querySelector('.rec-here').onclick=()=>{st.selectedSection=s.id;$('recordSection').value=s.id;renderSections();const panel=$('rightEditor');if(panel?.scrollHeight>panel.clientHeight){const recorder=$('rec-title');panel.scrollTo({top:panel.scrollTop+recorder.getBoundingClientRect().top-panel.getBoundingClientRect().top-15,behavior:'smooth'});}else document.getElementById('rec-title').scrollIntoView({block:'nearest',behavior:'smooth'});};
    card.querySelector('.duplicate').onclick=()=>showDuplicateDialog(s.id);
    installSectionReorder(card.querySelector('.section-grip'),card,s.id);
    card.querySelector('.up').onclick=()=>reorderSection(i,-1);card.querySelector('.down').onclick=()=>reorderSection(i,1);
    card.querySelector('.delete').onclick=()=>removeSection(s.id);
    card.querySelector('.rename').onchange=e=>{s.name=e.target.value.trim()||`パート${i+1}`;saveSoon();renderSections();refreshPickers();renderTimeline();};
    card.querySelector('.bars').onchange=e=>{s.bars=clamp(Math.round(+e.target.value||1),1,48);stopForArrangement();saveSoon();renderSections();renderTimeline();updateTime();};
    card.querySelector('.bar-start').onchange=e=>setStart(Math.round(clamp(+e.target.value||1,1,5000)*st.beats*4)/4-st.beats);
    slider.onchange=e=>setStart(+$('snap').checked?Math.round(+e.target.value):+e.target.value);
    card.querySelector('.step-back').onclick=()=>setStart(Math.max(0,s.startBeat-1));card.querySelector('.step-next').onclick=()=>setStart(s.startBeat+1);
    card.querySelector('.lyrics').oninput=e=>{s.lyrics=e.target.value;saveSoon();};
    wrap.append(card);
  });}
  // A change to the order reflows blocks in sequence, but never alters a clip's
  // sectionId or offsetSec: every original take follows its parent block.
  function reflowSections(){let beat=0;for(const block of st.sections){block.startBeat=beat;beat+=block.bars*st.beats;}}
  function moveSection(from,to){
    if(st.recording||st.starting||st.stopping)return toast('録音停止後に順番を変更してください。');
    if(from<0||to<0||from>=st.sections.length||to>=st.sections.length||from===to)return;
    stopForArrangement();const [block]=st.sections.splice(from,1);st.sections.splice(to,0,block);
    reflowSections();st.selectedSection=block.id;saveSoon();renderAll();toast('ブロックと紐づく録音を一緒に移動しました。');
  }
  function reorderSection(i,d){moveSection(i,i+d);}
  function installSectionReorder(grip,card,sectionId){
    let drag=null;
    function reset(){grip.classList.remove('grabbing');card.classList.remove('drag-origin');$('sectionCards').querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));}
    grip.addEventListener('pointerdown',e=>{
      if(st.recording||st.starting||st.stopping||e.pointerType==='mouse'&&e.button!==0)return;
      drag={id:e.pointerId,startY:e.clientY,over:null,after:false,moved:false};grip.setPointerCapture(e.pointerId);grip.classList.add('grabbing');
    });
    grip.addEventListener('pointermove',e=>{
      if(!drag||drag.id!==e.pointerId)return;
      const d=e.clientY-drag.startY;if(Math.abs(d)>8)drag.moved=true;if(!drag.moved)return;
      e.preventDefault();const panel=$('sectionsPanel'),r=panel.getBoundingClientRect();
      if(panel.scrollHeight>panel.clientHeight){if(e.clientY<r.top+60)panel.scrollTop-=16;else if(e.clientY>r.bottom-55)panel.scrollTop+=16;}
      const cards=[...$('sectionCards').querySelectorAll('.section-card')];
      reset();card.classList.add('drag-origin');
      const target=cards.find(n=>{const x=n.getBoundingClientRect();return e.clientY>=x.top&&e.clientY<x.bottom;});
      if(target&&target!==card){drag.over=target.dataset.sectionId;drag.after=e.clientY>target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;target.classList.add(drag.after?'drop-after':'drop-before');}else drag.over=null;
    });
    grip.addEventListener('pointerup',e=>{
      if(!drag||drag.id!==e.pointerId)return;const info=drag;drag=null;reset();
      if(!info.moved||!info.over)return;
      let from=st.sections.findIndex(x=>x.id===sectionId),to=st.sections.findIndex(x=>x.id===info.over)+(info.after?1:0);
      if(from<to)to--;moveSection(from,to);
    });
    grip.addEventListener('pointercancel',()=>{drag=null;reset();});
  }
  function showDuplicateDialog(sectionId){
    if(st.recording||st.starting||st.stopping)return toast('録音停止後に複製してください。');
    const source=getSection(sectionId);if(!source)return;
    if(st.sections.length>=40)return toast('ブロック数の上限（40個）です。');
    const dlg=$('duplicateDialog');dlg.dataset.sourceId=sectionId;
    $('duplicateHint').textContent=`「${source.name}」をどの内容で複製しますか？`;
    dlg.showModal();
  }
  function nextDuplicateName(name){
    const base=name.replace(/[②③④⑤⑥⑦⑧⑨⑩]$/,'').replace(/\s*\(\d+\)$/,'');
    const taken=new Set(st.sections.map(s=>s.name));
    const nums=['②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    for(let i=0;i<100;i++){const candidate=base+(nums[i]||` (${i+2})`);if(!taken.has(candidate))return candidate.slice(0,40);}
    return `${base} コピー`.slice(0,40);
  }
  async function duplicateSection(sectionId,includeAudio){
    const source=getSection(sectionId);if(!source||st.recording||st.starting||st.stopping)return;
    if(st.sections.length>=40)return toast('ブロックは最大40個までです。');
    const originals=st.clips.filter(c=>c.sectionId===sectionId);
    if(includeAudio&&st.clips.length+originals.length>MAX_CLIPS)return toast(`録音の上限は${MAX_CLIPS}個です。`);
    const at=st.sections.findIndex(s=>s.id===sectionId);
    const copy={...source,id:id('s'),name:nextDuplicateName(source.name),color:COLORS[st.sections.length%COLORS.length]};
    const copies=includeAudio?originals.map(c=>({...safeClip(c),id:id('c'),sectionId:copy.id,buffer:c.buffer,blob:c.blob})):[];
    const saved=[];
    try{
      // A copied recording is stored under its own key. Deleting the source
      // must never remove the copied take's data.
      for(const clip of copies)if(st.db){await dbPut('clips',clip.id,clip.blob);saved.push(clip.id);}
    }catch(e){for(const key of saved)try{await dbDelete('clips',key);}catch(_){};
      console.error('Duplicate failed',e);toast('録音の複製を保存できませんでした。容量を確認してください。');return;
    }
    stopForArrangement();st.sections.splice(at+1,0,copy);st.clips.push(...copies);
    reflowSections();st.selectedSection=copy.id;st.selectedClip='';
    $('duplicateDialog').close();saveSoon();renderAll();
    scrollToLyrics(copy.id);toast(includeAudio?`「${copy.name}」を録音${copies.length}件ごと複製しました。`:`「${copy.name}」の歌詞と設定を複製しました。`);
  }
  function scrollToLyrics(sectionId){
    const target=[...$('sectionCards').children].find(n=>n.dataset.sectionId===sectionId),panel=$('sectionsPanel');
    if(!target)return;
    if(getComputedStyle(panel).overflowY==='auto'&&panel.scrollHeight>panel.clientHeight){
      const rect=target.getBoundingClientRect(),box=panel.getBoundingClientRect();
      panel.scrollTo({top:panel.scrollTop+rect.top-box.top-65,behavior:'smooth'});
    }else target.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function addSection(){if(st.recording)return toast('録音停止後に構成を編集してください。');const last=st.sections.at(-1);const s={id:id('s'),name:`パート${st.sections.length+1}`,bars:8,startBeat:last?last.startBeat+last.bars*st.beats:0,lyrics:'',color:COLORS[st.sections.length%COLORS.length]};st.sections.push(s);st.selectedSection=s.id;saveSoon();refreshPickers();renderSections();renderTimeline();}
  async function removeSection(sectionId){if(st.recording)return toast('録音中に削除できません。');if(st.sections.length<=1)return toast('ブロックは最低1個必要です。');const s=getSection(sectionId),count=st.clips.filter(c=>c.sectionId===sectionId).length;if(!confirm(`「${s.name}」を削除します。関連する録音${count}件も消えます。事前にZIPを保存してください。`))return;stopForArrangement();for(const c of st.clips.filter(c=>c.sectionId===sectionId)){try{if(st.db)await dbDelete('clips',c.id);}catch(e){console.warn(e);}}st.clips=st.clips.filter(c=>c.sectionId!==sectionId);st.sections=st.sections.filter(x=>x.id!==sectionId);st.selectedSection=st.sections[0].id;st.selectedClip='';saveSoon();refreshPickers();renderAll();}
  function packSections(){if(st.recording)return toast('録音停止後に並べ替えてください。');if(!confirm('現在の並び順に隙間なく配置し直します。録音も各ブロックと一緒に移動します。'))return;stopForArrangement();reflowSections();saveSoon();renderAll();}
  function addLane(afterLaneId=null){if(st.recording||st.starting||st.stopping)return toast('録音停止後にレイヤーを追加してください。');if(st.lanes.length>=MAX_LANES)return toast('端末負荷を考慮して声のレイヤーは最大24本です。');
    const lane=makeLane(`声のレイヤー${st.lanes.length+1}`,st.lanes.length),idx=st.lanes.findIndex(l=>l.id===afterLaneId);
    st.lanes.splice(idx<0?st.lanes.length:idx+1,0,lane);st.selectedLane=lane.id;
    saveSoon();refreshPickers();$('recordLane').value=lane.id;renderTimeline();renderEffects();updateButtons();toast(`「${lane.name}」を追加しました。録音先に選択しています。`);
  }
  async function removeLane(laneId){if(st.recording)return toast('録音中に削除できません。');if(st.lanes.length===1)return toast('最低1レイヤー必要です。');const l=getLane(laneId),count=st.clips.filter(c=>c.laneId===laneId).length;if(!confirm(`「${l.name}」と関連する録音${count}件を消しますか？`))return;stopForArrangement();for(const c of st.clips.filter(c=>c.laneId===laneId)){try{if(st.db)await dbDelete('clips',c.id);}catch(e){console.warn(e);}}st.clips=st.clips.filter(c=>c.laneId!==laneId);st.lanes=st.lanes.filter(l=>l.id!==laneId);st.selectedLane=st.lanes[0].id;st.selectedClip='';saveSoon();refreshPickers();renderTimeline();renderEffects();}
  function selectLane(laneId){st.selectedLane=laneId;$('recordLane').value=laneId;renderEffects();saveSoon();}
  function renderEffects(){const lane=getLane(st.selectedLane);if(!lane)return; $('editingLane').textContent=lane.name;
    const preset=Object.entries(PRESETS).find(([,v])=>FIELDS.every(([k])=>lane.fx[k]===v[k]));$('preset').value=preset?.[0]||'custom';
    const area=$('effectControls');area.innerHTML='';for(const [k,title,unit,min,max,step] of FIELDS){
      const e=document.createElement('label');e.className='fx-item';e.innerHTML='<div class="fx-head"><span></span><strong></strong></div><input type="range"><small></small>';
      e.querySelector('span').textContent=title;e.querySelector('small').textContent=k==='gate'?'声がない場所だけを下げる':k==='compressor'?'大きな声のピークを抑える':k==='deess'?'高音域のEQによる補正':'原音は変更しません';
      const input=e.querySelector('input'),value=e.querySelector('strong');Object.assign(input,{min,max,step,value:lane.fx[k]});value.textContent=`${lane.fx[k]} ${unit}`;
      input.oninput=()=>{lane.fx[k]=+input.value;value.textContent=`${lane.fx[k]} ${unit}`;$('preset').value='custom';saveSoon();scheduleReplay();};area.append(e);
    }
  }
  function drawWave(canvas,buffer,color){if(!buffer)return;const ratio=Math.min(devicePixelRatio||1,2),w=Math.max(16,canvas.clientWidth||160),h=Math.max(20,canvas.clientHeight||50);canvas.width=Math.ceil(w*ratio);canvas.height=Math.ceil(h*ratio);const g=canvas.getContext('2d');g.scale(ratio,ratio);g.clearRect(0,0,w,h);g.fillStyle=color;const a=buffer.getChannelData(0);for(let x=0;x<w;x++){const from=Math.floor(x*a.length/w),to=Math.floor((x+1)*a.length/w);let p=0;const step=Math.max(1,Math.floor((to-from)/20));for(let j=from;j<to;j+=step)p=Math.max(p,Math.abs(a[j]));const len=Math.max(1,p*(h-8));g.fillRect(x,Math.floor((h-len)/2),1,len);}}
  function redrawClipWaves(){document.querySelectorAll('canvas[data-clip]').forEach(n=>{const c=getClip(n.dataset.clip);if(c?.buffer)drawWave(n,c.buffer,getLane(c.laneId)?.color||'#bfa8ff');});}
  function renderTimeline(){
    st.duration=duration();const timelineWidth=Math.max(580,Math.ceil((st.duration+2)*st.zoom)),head=matchMedia('(max-width:700px)').matches?200:218;
    const inner=$('timelineInner');inner.style.width=`${timelineWidth+head}px`;inner.style.setProperty('--beat-px',`${st.zoom*beatSec()}px`);
    const ruler=$('ruler');ruler.replaceChildren();for(let sec=0;sec<st.duration+2;sec+=5){const tick=document.createElement('span');tick.className='ruler-mark';tick.style.left=`${head+sec*st.zoom}px`;tick.textContent=sTime(sec).slice(0,5);ruler.append(tick);}
    const strip=$('arrangeStrip');strip.replaceChildren();for(const s of st.sections){const el=document.createElement('div');el.className='arrange-block';el.style.setProperty('--block-color',s.color);el.style.left=`${head+secAt(s)*st.zoom}px`;el.style.width=`${Math.max(22,s.bars*st.beats*beatSec()*st.zoom)}px`;
      const title=document.createElement('span');title.textContent=s.name;const sub=document.createElement('b');sub.textContent=`${s.bars}小節`;el.append(title,sub);
      addDrag(el,()=>s.startBeat,delta=>{let value=s.startBeat+delta/Math.max(1,st.zoom)/beatSec();if($('snap').checked)value=Math.round(value);return clamp(value,0,20000);},v=>{s.startBeat=v;st.selectedSection=s.id;saveSoon();renderSections();renderTimeline();updateTime();},'beat');
      el.onclick=()=>{st.selectedSection=s.id;$('recordSection').value=s.id;renderSections();};strip.append(el);
    }
    const area=$('lanes');area.replaceChildren();for(const l of st.lanes){const row=document.createElement('div');row.className='lane-row';row.style.height='98px';
      const header=document.createElement('div');header.className='lane-header';header.innerHTML='<div class="lane-header-top"><input class="lane-name" maxlength="30" aria-label="レイヤー名"><div class="lane-controls"><button class="small-btn lane-mute" title="ミュート">M</button><button class="small-btn lane-solo" title="ソロ">S</button><button class="small-btn lane-add" type="button" title="この下に声のレイヤーを追加" aria-label="この下に声のレイヤーを追加">＋</button><button class="small-btn lane-remove delete" title="レイヤー削除">×</button></div></div><div class="lane-header-bottom"><span>音量</span><input class="lane-volume" type="range" min="0" max="200" step="1"><span class="lane-value"></span></div><div class="lane-header-bottom"><span>左右</span><input class="lane-pan" type="range" min="-100" max="100" step="1"><span class="pan-value"></span></div>';
      const name=header.querySelector('.lane-name');name.value=l.name;name.onfocus=()=>selectLane(l.id);name.onchange=()=>{l.name=name.value.trim()||'声';saveSoon();refreshPickers();renderEffects();};
      const mute=header.querySelector('.lane-mute'),solo=header.querySelector('.lane-solo');mute.classList.toggle('on',l.mute);solo.classList.toggle('on',l.solo);
      mute.onclick=()=>{l.mute=!l.mute;saveSoon();renderTimeline();scheduleReplay();};solo.onclick=()=>{l.solo=!l.solo;saveSoon();renderTimeline();scheduleReplay();};
      header.querySelector('.lane-add').onclick=()=>addLane(l.id);header.querySelector('.lane-remove').onclick=()=>void removeLane(l.id);
      const vol=header.querySelector('.lane-volume'),pan=header.querySelector('.lane-pan');vol.value=l.volume;pan.value=l.pan;
      header.querySelector('.lane-value').textContent=`${l.volume}%`;header.querySelector('.pan-value').textContent=l.pan===0?'中央':l.pan>0?'右':'左';
      vol.oninput=()=>{l.volume=+vol.value;header.querySelector('.lane-value').textContent=`${l.volume}%`;selectLane(l.id);saveSoon();scheduleReplay();};
      pan.oninput=()=>{l.pan=+pan.value;header.querySelector('.pan-value').textContent=l.pan===0?'中央':`${l.pan>0?'右':'左'}${Math.abs(l.pan)}`;selectLane(l.id);saveSoon();scheduleReplay();};
      header.onclick=e=>{if(e.target===header)selectLane(l.id);};
      const body=document.createElement('div');body.className='lane-body';body.style.width=`${timelineWidth}px`;body.style.minWidth=`${timelineWidth}px`;
      for(const c of st.clips.filter(c=>c.laneId===l.id&&c.buffer)){
        const el=document.createElement('div');el.className=`clip-block${st.selectedClip===c.id?' selected':''}${c.mute?' muted':''}`;
        el.style.left=`${clipAt(c)*st.zoom}px`;el.style.width=`${Math.max(16,c.buffer.duration*st.zoom)}px`;el.style.setProperty('--clip-color',l.color);
        const wave=document.createElement('canvas');wave.dataset.clip=c.id;const title=document.createElement('span');title.className='clip-name';title.textContent=`${getSection(c.sectionId)?.name||''} · ${c.filename}`;el.append(wave,title);
        for(const cut of safeCuts(c.cuts)){const mark=document.createElement('div');mark.className='overwrite-cut';mark.style.left=`${Math.max(0,cut.start/c.buffer.duration*100)}%`;mark.style.width=`${Math.max(0,Math.min(c.buffer.duration,cut.end)-cut.start)/c.buffer.duration*100}%`;el.append(mark);}
        addDrag(el,()=>c.offsetSec,delta=>{let next=c.offsetSec+delta/st.zoom;if($('snap').checked)next=Math.round(next/beatSec())*beatSec();return clamp(next,-600,1200);},v=>{c.offsetSec=+v.toFixed(3);st.selectedClip=c.id;saveSoon();renderTimeline();renderInspector();updateTime();scheduleReplay();},'clip');
        el.onclick=()=>{st.selectedClip=c.id;st.selectedLane=l.id;renderTimeline();renderInspector();renderEffects();};body.append(el);
      }
      row.append(header,body);area.append(row);
    }
    // Add remains visible at the *bottom of the tracks*, even when the section
    // heading has scrolled out of view on iPad.
    const addRow=document.createElement('div');addRow.className='lane-add-row';
    const addButton=document.createElement('button');addButton.id='addLaneBottom';addButton.type='button';addButton.className='btn primary small';
    addButton.textContent=`＋ トラックを追加 (${st.lanes.length}/${MAX_LANES})`;addButton.disabled=st.lanes.length>=MAX_LANES||!!st.recording||st.starting||st.stopping;
    addButton.onclick=()=>addLane();
    const addText=document.createElement('span');addText.textContent='リード・ハモリ・ダブルなど、必要な声を増やせます。';
    addRow.append(addButton,addText);area.append(addRow);
    $('globalPlayhead').style.left=`${head+(st.position||0)*st.zoom}px`;updateTime();requestAnimationFrame(redrawClipWaves);
  }
  function addDrag(el,getStart,compute,commit,mode){let pointer=null;el.addEventListener('pointerdown',e=>{
    if(st.recording)return;if(e.pointerType==='mouse'&&e.button!==0)return;
    pointer={id:e.pointerId,x:e.clientX,prev:e.clientX,moved:false,initial:getStart()};el.setPointerCapture(e.pointerId);
  });el.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId)return;pointer.prev=e.clientX;const delta=e.clientX-pointer.x;if(Math.abs(delta)>5){pointer.moved=true;el.classList.add('dragging');el.style.transform=`translateX(${delta}px)`;}});
    const finish=e=>{if(!pointer||pointer.id!==e.pointerId)return;const p=pointer;pointer=null;el.classList.remove('dragging');el.style.transform='';if(p.moved){e.preventDefault();e.stopPropagation();commit(compute(p.prev-p.x));}};
    el.addEventListener('pointerup',finish);el.addEventListener('pointercancel',()=>{pointer=null;el.classList.remove('dragging');el.style.transform='';});
  }
  function renderInspector(){const box=$('clipInspector'),c=getClip(st.selectedClip);if(!c){box.textContent='録音クリップを選ぶと、ここで開始位置や音量を細かく調整できます。';return;}
    box.innerHTML='<div class="inspector-head"><strong></strong><button class="btn ghost small clip-mute">ミュート</button><button class="btn ghost small clip-export">↓ 原音WAV</button><button class="btn ghost small clip-delete">× 録音削除</button></div><div class="inspector-controls"><label>ブロック内の開始ずれ (秒)<input type="number" class="clip-offset" step="0.01" min="-600" max="1200"></label><button class="small-btn nudge-left">−0.05秒</button><button class="small-btn nudge-right">＋0.05秒</button><label>クリップ音量 <input type="range" class="clip-volume" min="0" max="200" step="1"><span class="clip-vol-value"></span></label><label>録音ブロック <select class="clip-section"></select></label></div>';
    box.querySelector('strong').textContent=`${getSection(c.sectionId)?.name} / ${getLane(c.laneId)?.name} / ${sTime(c.buffer.duration)}`;
    const mute=box.querySelector('.clip-mute');mute.textContent=c.mute?'ミュート解除':'ミュート';mute.onclick=()=>{c.mute=!c.mute;saveSoon();renderTimeline();renderInspector();scheduleReplay();};
    box.querySelector('.clip-export').onclick=()=>downloadBlob(wav24(c.buffer),`${clean(st.projectName)}-${clean(c.filename)}-RAW.wav`);
    box.querySelector('.clip-delete').onclick=()=>void deleteClip(c.id);
    const offset=box.querySelector('.clip-offset');offset.value=c.offsetSec;function updateOffset(v){c.offsetSec=clamp(v,-600,1200);saveSoon();renderTimeline();renderInspector();scheduleReplay();}
    offset.onchange=()=>updateOffset(+offset.value);box.querySelector('.nudge-left').onclick=()=>updateOffset(+(c.offsetSec-.05).toFixed(3));box.querySelector('.nudge-right').onclick=()=>updateOffset(+(c.offsetSec+.05).toFixed(3));
    const volume=box.querySelector('.clip-volume');volume.value=c.volume;box.querySelector('.clip-vol-value').textContent=`${c.volume}%`;volume.oninput=()=>{c.volume=+volume.value;box.querySelector('.clip-vol-value').textContent=`${c.volume}%`;saveSoon();scheduleReplay();};
    const sel=box.querySelector('.clip-section');sel.replaceChildren(...st.sections.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));sel.value=c.sectionId;sel.onchange=()=>{const absolute=clipAt(c);c.sectionId=sel.value;c.offsetSec=+(absolute-secAt(getSection(c.sectionId))).toFixed(3);saveSoon();renderTimeline();renderInspector();scheduleReplay();};
  }
  async function deleteClip(cid){if(st.recording)return toast('録音中に削除できません。');const c=getClip(cid);if(!c||!confirm(`「${c.filename}」を削除しますか？取り消しできません。`))return;stopForArrangement();const latest=st.overwriteHistory.at(-1);if(latest?.newClipId===cid){for(const item of latest.previous){const original=getClip(item.id);if(original){original.cuts=safeCuts(item.cuts);if(typeof item.mute==='boolean')original.mute=item.mute;}}st.overwriteHistory.pop();}else if(st.overwriteHistory.some(x=>x.newClipId===cid)){toast('古い上書き録音を削除しました。上書き範囲は残るため、必要ならZIPバックアップから復元してください。',6500);}if(st.db)try{await dbDelete('clips',cid);}catch(e){console.warn(e);toast('保存領域からの削除に失敗しました');}st.clips=st.clips.filter(x=>x.id!==cid);st.selectedClip='';saveSoon();renderTimeline();renderInspector();}
  function renderAll(){refreshPickers();renderSections();renderTimeline();renderInspector();renderEffects();updateButtons();}
  function updateTime(){st.duration=duration();st.position=clamp(st.position,0,st.duration);const position=playbackPos();$('playTime').textContent=`${sTime(position)} / ${sTime(st.duration)}`;$('seek').value=st.duration?(position/st.duration*100):0;
    const head=matchMedia('(max-width:700px)').matches?200:218;$('globalPlayhead').style.left=`${head+position*st.zoom}px`;$('globalPlayhead').style.display=st.playing?'block':'none';}
  function playbackPos(){if(st.playing){return clamp(st.playing.offset+Math.max(0,st.playing.ctx.currentTime-st.playing.when),0,st.duration);}return st.position;}
  function stopSources(){for(const s of st.stopSources)try{s.stop();}catch(e){}st.stopSources=[];}
  function stopMetro(){if(st.metro?.timer)clearInterval(st.metro.timer);st.metro=null;indicateBeat(null);}
  function stopPlayback(keep=true){if(st.playing){if(keep)st.position=playbackPos();st.playing=null;}stopSources();if(st.raf)cancelAnimationFrame(st.raf);st.raf=0;stopMetro();updateTime();updateButtons();}
  function stopForArrangement(){if(st.playing&&!st.recording)stopPlayback();}
  function makeIR(ctx){if(st.impulses.has(ctx))return st.impulses.get(ctx);const n=Math.ceil(ctx.sampleRate*1.3),buffer=ctx.createBuffer(2,n,ctx.sampleRate);let seed=412845;for(let ch=0;ch<2;ch++){const a=buffer.getChannelData(ch);for(let i=0;i<n;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;a[i]=(((seed>>>0)/2147483648)-1)*.10*Math.pow(1-i/n,3.5);}}st.impulses.set(ctx,buffer);return buffer;}
  function filter(ctx,type,freq,q=null,gain=null){const n=ctx.createBiquadFilter();n.type=type;n.frequency.value=freq;if(q!=null)n.Q.value=q;if(gain!=null)n.gain.value=gain;return n;}
  function gatedBuffer(clip,lane,ctx){const v=lane.fx.gate,raw=clip.buffer;if(!raw||v<=0)return raw;if(clip._gate?.raw===raw&&clip._gate?.value===v)return clip._gate.buffer;
    const b=ctx.createBuffer(raw.numberOfChannels,raw.length,raw.sampleRate),block=256,threshold=Math.pow(10,(-78+v*.46)/20),weights=new Float32Array(Math.ceil(raw.length/block));let smooth=0;
    for(let k=0;k<weights.length;k++){let sum=0,n=0;const from=k*block,to=Math.min(from+block,raw.length);for(let i=from;i<to;i+=4){let x=0;for(let c=0;c<raw.numberOfChannels;c++)x+=raw.getChannelData(c)[i]**2;sum+=x/raw.numberOfChannels;n++;}const rms=Math.sqrt(sum/Math.max(1,n));const alpha=rms>smooth?.30:.025;smooth+=(rms-smooth)*alpha;const ratio=smooth/threshold;weights[k]=ratio>=1.7?1:ratio<=.75?.13:.13+.87*(ratio-.75)/.95;}
    for(let c=0;c<raw.numberOfChannels;c++){const src=raw.getChannelData(c),dst=b.getChannelData(c);for(let i=0;i<src.length;i++){const p=i/block,k=Math.floor(p),a=weights[Math.min(k,weights.length-1)],z=weights[Math.min(k+1,weights.length-1)];dst[i]=src[i]*(a+(z-a)*(p-k));}}clip._gate={raw,value:v,buffer:b};return b;
  }
  function buildSources(ctx,offset,when,options={}){
    const output=ctx.createGain(),limiter=ctx.createDynamicsCompressor(),gain=ctx.createGain();limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=18;limiter.attack.value=.003;limiter.release.value=.1;gain.gain.value=.90;output.connect(limiter);limiter.connect(gain);gain.connect(ctx.destination);
    const reverb=ctx.createConvolver();reverb.buffer=makeIR(ctx);reverb.connect(output);
    const anySolo=st.lanes.some(l=>l.solo),sources=[];
    for(const c of st.clips){const lane=getLane(c.laneId);if(!c.buffer||!lane||(options.excludeGuide&&lane.guide)||c.mute||lane.mute||(anySolo&&!lane.solo)||options.excludeClip===c.id||(options.excludeLane&&c.laneId===options.excludeLane))continue;
      const start=clipAt(c),spans=visibleSpans(c).filter(span=>start+span.end>offset+.002);if(!spans.length)continue;
      const nodes=[filter(ctx,'highpass',lane.fx.hp,.707),filter(ctx,'lowshelf',180,null,lane.fx.low),filter(ctx,'peaking',2600,.9,lane.fx.mid),filter(ctx,'highshelf',7800,null,lane.fx.high),filter(ctx,'peaking',6200,1.4,-lane.fx.deess)];
      const comp=ctx.createDynamicsCompressor(),v=lane.fx.compressor;comp.threshold.value=-8-v*2.2;comp.knee.value=6;comp.ratio.value=1+v*.65;comp.attack.value=.005;comp.release.value=.16;nodes.push(comp);
      const amp=ctx.createGain();amp.gain.value=lane.volume/100*c.volume/100;nodes.push(amp);
      for(let i=0;i<nodes.length-1;i++)nodes[i].connect(nodes[i+1]);let last=amp;
      if(ctx.createStereoPanner){const pan=ctx.createStereoPanner();pan.pan.value=lane.pan/100;last.connect(pan);last=pan;}
      last.connect(output);
      if(lane.fx.reverb>0){const wet=ctx.createGain();wet.gain.value=lane.fx.reverb/100*1.3;last.connect(wet);wet.connect(reverb);}
      const audio=gatedBuffer(c,lane,ctx);
      for(const span of spans){const from=Math.max(span.start,offset-start),len=span.end-from;if(len<=.002)continue;
        const src=ctx.createBufferSource();src.buffer=audio;src.connect(nodes[0]);const at=when+Math.max(0,start+from-offset);src.start(at,from,len);sources.push(src);}
    }
    return sources;
  }
  function scheduleClick(ctx,time,isDownbeat,volume){const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(isDownbeat?1160:760,time);osc.frequency.exponentialRampToValueAtTime(isDownbeat?790:530,time+.045);gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(Math.max(.001,volume)*.12,time+.003);gain.gain.exponentialRampToValueAtTime(.0001,time+.065);osc.connect(gain);gain.connect(ctx.destination);osc.start(time);osc.stop(time+.07);}
  function startMetro(ctx,beatZeroTime,minBeat,maxBeat,countinEndBeat=null){stopMetro();if(!$('metroEnabled').checked&&minBeat>=0)return;
    const m={ctx,beatZeroTime,countinEndBeat,nextBeat:Math.ceil((ctx.currentTime+.005-beatZeroTime)/beatSec()),minBeat,maxBeat,timer:null};
    const advance=()=>{const bs=beatSec(),horizon=ctx.currentTime+.16;while(m.nextBeat*bs+beatZeroTime<=horizon&&m.nextBeat<=maxBeat){const at=m.nextBeat*bs+beatZeroTime;if(m.nextBeat>=minBeat&&at>=ctx.currentTime-.01&&$('metroAudible').checked&&($('metroEnabled').checked||(countinEndBeat!==null&&m.nextBeat<countinEndBeat))){const vol=+$('metroVolume').value/100;scheduleClick(ctx,Math.max(at,ctx.currentTime+.004),m.nextBeat%st.beats===0,vol);}m.nextBeat++;}};
    advance();m.timer=setInterval(advance,45);st.metro=m;
  }
  async function play(offset=st.position){if(st.recording||st.starting)return;stopPlayback(false);const ctx=await audioCtx();st.duration=duration();offset=clamp(offset,0,st.duration);if(offset>=st.duration)offset=0;st.position=offset;const when=ctx.currentTime+.075;
    st.stopSources=buildSources(ctx,offset,when);st.playing={ctx,when,offset};if($('metroEnabled').checked)startMetro(ctx,when-offset,0,Math.ceil(st.duration/beatSec())+2);updateButtons();frame();
  }
  function frame(){if(st.playing){const now=playbackPos();if(!st.recording&&now>=st.duration-.015){stopPlayback(false);st.position=0;updateTime();return;}updateTime();}if(st.recording){const r=st.recording;const diff=Math.max(0,r.ctx.currentTime-r.recordAt);$('captureStatus').textContent=r.ctx.currentTime<r.recordAt?'● カウント中':'● 録音中';$('recordTimer').textContent=sTime(diff);if(r.autoEnd&&r.ctx.currentTime>=r.autoEnd+.12&&!st.stopping)void endRecording();}
    if(st.metro&&st.playing){let beat=Math.floor((st.playing.ctx.currentTime-st.metro.beatZeroTime)/beatSec());indicateBeat(beat);}
    else if(st.metro&&st.recording){let beat=Math.floor((st.recording.ctx.currentTime-st.metro.beatZeroTime)/beatSec());indicateBeat(beat);}
    if(st.playing||st.recording)st.raf=requestAnimationFrame(frame);
  }
  function scheduleReplay(){if(!st.playing||st.recording)return;clearTimeout(st.replayTimer);st.replayTimer=setTimeout(()=>{const pos=playbackPos();void play(pos).catch(e=>toast(e.message));},160);}
  function updateButtons(){const rec=!!st.recording,lock=st.starting||st.stopping;
    $('recordBtn').classList.toggle('active',rec);$('recordSymbol').textContent=rec?'■':'●';$('recordLabel').textContent=rec?'録音を停止':$('recordMode').value==='retake'?'このブロックを録り直す':'このブロックを録音';$('recordBtn').disabled=lock;
    for(const btn of [$('addLane'),$('addLaneNearRecord'),$('addLaneBottom')])if(btn)btn.disabled=rec||lock||st.lanes.length>=MAX_LANES;
    $('recordSection').disabled=rec||lock;$('recordLane').disabled=rec||lock;$('recordMode').disabled=rec||lock;
    $('undoOverwriteBtn').disabled=rec||lock||!st.overwriteHistory.length;
    $('playBtn').disabled=rec||lock;$('playBtn').textContent=st.playing&&!rec?'❚❚ 一時停止':'▶ 再生';
    $('stopBtn').disabled=(!st.playing&&!rec)||lock;
    $('exportMix').disabled=rec||lock||!st.clips.length;$('backupBtn').disabled=rec||lock;
    $('restoreBtn').disabled=rec||lock;$('importBtn').disabled=rec||lock;$('bridgeImportBtn').disabled=rec||lock;$('musicImportBtn').disabled=rec||lock;$('musicExportBtn').disabled=rec||lock;
    $('captureStatus').textContent=rec?(st.recording?.ctx.currentTime<st.recording?.recordAt?'● カウント中':'● 録音中'):st.starting?'マイクの使用を準備中…':'待機中';
  }
  function pcmPush(r,pcm){if(st.recording!==r||(st.stopping&&r.fallback))return;const remaining=Math.floor(MAX_RECORD_SEC*r.sampleRate)-r.frames;if(remaining<=0){if(!st.stopping)void endRecording();return;}const a=pcm.length>remaining?pcm.slice(0,remaining):pcm;r.chunks.push(a);r.frames+=a.length;if(r.frames>=Math.floor(MAX_RECORD_SEC*r.sampleRate)&&!st.stopping)void endRecording();}
  function meterTick(){const r=st.recording;if(!r)return;const v=new Float32Array(r.analyser.fftSize);r.analyser.getFloatTimeDomainData(v);let peak=0;for(let i=0;i<v.length;i++)peak=Math.max(peak,Math.abs(v[i]));const db=20*Math.log10(Math.max(1e-7,peak));$('peakReadout').textContent=`${db.toFixed(1)} dBFS`;$('meterFill').style.width=`${clamp((db+55)/55*100,0,100)}%`;$('clipWarning').hidden=peak<.985;st.meterRaf=requestAnimationFrame(meterTick);}
  async function beginRecording(){if(st.recording||st.starting||st.stopping)return;
    if(st.clips.length>=MAX_CLIPS)return toast('音声が多いため、ZIPバックアップ後に不要な録音を削除してください。');
    if(!navigator.mediaDevices?.getUserMedia)return toast('マイクを使えません。GitHub PagesのHTTPS URLをSafariで開いてください。',6000);
    const section=getSection($('recordSection').value),lane=getLane($('recordLane').value);if(!section||!lane)return toast('録音する場所を選んでください。');
    if(st.playing)stopPlayback(false);st.starting=true;updateButtons();let stream=null,rec=null;
    try{
      const ctx=await audioCtx();stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();analyser.fftSize=2048;
      const silent=ctx.createGain();silent.gain.value=0;
      const waitBeats=$('countIn').checked?st.beats:0,secPerBeat=beatSec(),waitSecs=waitBeats*secPerBeat;
      // Keep all scheduled events on the same AudioContext clock.
      let countdownAt=ctx.currentTime+.22,recordAt=countdownAt+waitSecs;
      const endSeconds=$('autoStop').checked?Math.min(section.bars*st.beats*secPerBeat,MAX_RECORD_SEC):MAX_RECORD_SEC;
      const autoEnd=recordAt+endSeconds;
      rec={ctx,stream,source,analyser,silent,node:null,sectionId:section.id,laneId:lane.id,mode:$('recordMode').value,chunks:[],frames:0,sampleRate:ctx.sampleRate,recordAt,autoEnd,flushResolve:null,fallback:false};st.recording=rec;
      source.connect(analyser);
      let node=null;
      if(ctx.audioWorklet?.addModule){try{
        await ctx.audioWorklet.addModule('./capture-worklet.js');node=new AudioWorkletNode(ctx,'songstudio-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
        node.port.onmessage=e=>{if(e.data?.type==='pcm')pcmPush(rec,e.data.data);else if(e.data?.type==='flushed')rec.flushResolve?.();else if(e.data?.type==='limit'&&!st.stopping)void endRecording();};
      }catch(e){console.warn('Worklet fallback',e);}}
      if(!node){if(!ctx.createScriptProcessor)throw new Error('端末の音声収録APIを利用できません。');rec.fallback=true;node=ctx.createScriptProcessor(2048,1,1);node.onaudioprocess=e=>{
        if(st.recording!==rec||st.stopping)return;const samples=e.inputBuffer.getChannelData(0),start=e.playbackTime||ctx.currentTime;
        const from=Math.max(0,Math.ceil((rec.recordAt-start)*rec.sampleRate)),to=Math.min(samples.length,Math.floor((rec.autoEnd-start)*rec.sampleRate));if(to>from)pcmPush(rec,samples.slice(from,to));
      };}
      rec.node=node;analyser.connect(node);node.connect(silent);silent.connect(ctx.destination);
      countdownAt=ctx.currentTime+.25;recordAt=countdownAt+waitSecs;rec.recordAt=recordAt;rec.autoEnd=recordAt+endSeconds;
      if(!rec.fallback)node.port.postMessage({type:'arm',startFrame:recordAt*ctx.sampleRate,endFrame:rec.autoEnd*ctx.sampleRate});
      if($('hearOthers').checked){const when=recordAt;st.stopSources=buildSources(ctx,secAt(section),when,{excludeLane:rec.mode==='replace'||rec.mode==='retake'?lane.id:null});st.playing={ctx,when,offset:secAt(section)};}
      // count-in and playback share the grid; only captured frames after recordAt are kept.
      if(waitBeats||$('metroEnabled').checked){const gridZero=recordAt-section.startBeat*secPerBeat;startMetro(ctx,gridZero,section.startBeat-waitBeats,section.startBeat+Math.ceil(endSeconds/secPerBeat)+2,section.startBeat);}
      st.starting=false;updateButtons();st.raf=requestAnimationFrame(frame);st.meterRaf=requestAnimationFrame(meterTick);
      toast(waitBeats?`1小節カウント後に「${section.name}」を録音します。`:`「${section.name}」を録音します。`);
    }catch(e){console.error(e);stream?.getTracks().forEach(t=>t.stop());if(rec){try{rec.node?.disconnect();rec.source?.disconnect();rec.analyser?.disconnect();rec.silent?.disconnect();}catch(err){}st.recording=null;}stopPlayback(false);toast(`録音を始められません：${e.message}`,6500);}finally{st.starting=false;updateButtons();}
  }
  async function endRecording(){if(!st.recording||st.stopping)return;st.stopping=true;const r=st.recording;updateButtons();
    try{
      if(r.node&&!r.fallback){await Promise.race([new Promise(resolve=>{r.flushResolve=resolve;r.node.port.postMessage({type:'stop'});}),new Promise(resolve=>setTimeout(resolve,600))]);}
      if(r.frames<=0){toast('音声が録れていません。マイク許可や入力音量、カウント終了までの長さを確認してください。',5500);return;}
      const buffer=r.ctx.createBuffer(1,r.frames,r.sampleRate),target=buffer.getChannelData(0);let pos=0;for(const arr of r.chunks){target.set(arr,pos);pos+=arr.length;}
      const blob=wav24(buffer),section=getSection(r.sectionId),lane=getLane(r.laneId),take=st.clips.filter(c=>c.sectionId===r.sectionId&&c.laneId===r.laneId).length+1;
      const c={id:id('c'),sectionId:r.sectionId,laneId:r.laneId,offsetSec:0,volume:100,mute:false,filename:`${section?.name||'パート'} テイク${take}`,buffer,blob,cuts:[]};
      // Keep the original material untouched until a valid new take has been decoded and saved.
      const persisted=await saveClip(c);
      if(!persisted&&r.mode!=='overdub')throw new Error('元の録音を守るため、録り直し／上書きは反映しませんでした。保存容量を確認してください。');
      if(r.mode==='replace'||r.mode==='retake'){
        const previous=r.mode==='replace'?maskPreviousForOverwrite(c):mutePreviousForRetake(c);
        st.overwriteHistory.push({mode:r.mode,newClipId:c.id,previous});st.overwriteHistory=st.overwriteHistory.slice(-20);
      }
      st.clips.push(c);st.selectedClip=c.id;saveSoon();toast(r.mode==='replace'?`上書き録音を反映しました（${sTime(buffer.duration)}）。元の音声は保持しています。`:r.mode==='retake'?`録り直しを採用しました（${sTime(buffer.duration)}）。このブロックの旧テイクはミュートで保持。元に戻すこともできます。`:`${c.filename}を追加しました（${sTime(buffer.duration)}）。`);
    }catch(e){console.error(e);toast(`録音の保存に失敗：${e.message}。元の声は保持されています。`,6500);}
    finally{
      r.stream?.getTracks().forEach(t=>t.stop());try{r.node?.disconnect();r.source?.disconnect();r.analyser?.disconnect();r.silent?.disconnect();}catch(e){}
      st.recording=null;st.stopping=false;cancelAnimationFrame(st.meterRaf);$('meterFill').style.width='0%';$('recordTimer').textContent='00:00.0';$('peakReadout').textContent='— dBFS';$('clipWarning').hidden=true;
      stopPlayback(false);st.position=0;renderAll();
    }
  }
  async function importAudio(file){if(!file)return;try{if(st.clips.length>=MAX_CLIPS)throw new Error('録音クリップ上限に達しています');if(file.size>MAX_IMPORT_BYTES)throw new Error('ファイルが大きすぎます（200MBまで）');
    const ctx=await audioCtx(),buffer=await ctx.decodeAudioData(await file.arrayBuffer());if(buffer.duration>MAX_IMPORT_SEC+.01)throw new Error('取り込み音声は15分以内にしてください');
    const clip={id:id('c'),sectionId:$('recordSection').value,laneId:$('recordLane').value,offsetSec:0,volume:100,mute:false,filename:file.name.replace(/\.[a-z0-9]+$/i,''),buffer,blob:file};
    st.clips.push(clip);st.selectedClip=clip.id;await saveClip(clip);saveSoon();renderAll();toast('音声を新しいクリップとして追加しました。');
  }catch(e){console.error(e);toast(`音声を取り込めません：${e.message}`,6000);}}
  function wav24(buffer,normalize=1){const num=buffer.numberOfChannels,rate=buffer.sampleRate,frames=buffer.length,bytes=frames*num*3;if(bytes>0xffffffff-44)throw new Error('WAVが4GBを超えています');
    const header=new ArrayBuffer(44),h=new DataView(header);function word(off,s){for(let i=0;i<4;i++)h.setUint8(off+i,s.charCodeAt(i));}word(0,'RIFF');h.setUint32(4,36+bytes,true);word(8,'WAVE');word(12,'fmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,num,true);h.setUint32(24,rate,true);h.setUint32(28,rate*num*3,true);h.setUint16(32,num*3,true);h.setUint16(34,24,true);word(36,'data');h.setUint32(40,bytes,true);
    const streams=Array.from({length:num},(_,i)=>buffer.getChannelData(i)),chunks=[header],slice=8192;
    for(let offset=0;offset<frames;offset+=slice){const n=Math.min(slice,frames-offset),out=new Uint8Array(n*num*3);let p=0;for(let i=0;i<n;i++)for(let ch=0;ch<num;ch++){const v=Math.max(-1,Math.min(1,streams[ch][offset+i]*normalize)),s=v<0?Math.round(v*8388608):Math.round(v*8388607);out[p++]=s&255;out[p++]=(s>>8)&255;out[p++]=(s>>16)&255;}chunks.push(out);}
    return new Blob(chunks,{type:'audio/wav'});
  }
  function downloadBlob(blob,name){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.style.display='none';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  async function exportMix(){if(!st.clips.some(c=>c.buffer&&(!$('includeGuideExport').checked? !getLane(c.laneId)?.guide:true)))return toast($('includeGuideExport').checked?'まだ音声がありません。':'歌声がありません。ガイド音声も含める場合はチェックをONにしてください。',6000);if(!OfflineContext)return toast('この端末はオフライン音声合成に対応していません。');
    $('exportMix').disabled=true;setSaveStatus('ミックス作成中…');try{const length=duration()+($('tail').checked?1.5:0);if(length>MAX_MIX_SEC)throw new Error('書き出し上限15分を超えています。構成を短くしてください。');
      const rate=st.ctx?.sampleRate||44100,offline=new OfflineContext(2,Math.ceil(length*rate),rate);buildSources(offline,0,0,{excludeGuide:!$('includeGuideExport').checked});const buffer=await offline.startRendering();let factor=1;
      if($('normalize').checked){let peak=0;for(let ch=0;ch<buffer.numberOfChannels;ch++){const a=buffer.getChannelData(ch);for(let i=0;i<a.length;i++)peak=Math.max(peak,Math.abs(a[i]));}if(peak>.00001)factor=Math.pow(10,-1/20)/peak;}
      downloadBlob(wav24(buffer,factor),`${clean(st.projectName)}-MIX-24bit.wav`);toast('曲全体を24bit WAVで書き出しました。ファイルアプリに保存してください。');
    }catch(e){console.error(e);toast(`ミックスの書き出しに失敗：${e.message}`,6500);}finally{setSaveStatus(st.db?'自動保存済み':'保存不可');updateButtons();}}
  async function exportVocalsOnly(){
    if(!st.clips.some(c=>c.buffer&&!getLane(c.laneId)?.guide))return toast('ボーカル録音がありません。');
    if(!OfflineContext)return toast('この端末はWAV合成に対応していません。');
    const btn=$('exportVocalsOnly');btn.disabled=true;setSaveStatus('ボーカル専用WAV作成中…');
    try{const seconds=duration();if(seconds>MAX_MIX_SEC)throw Error('15分の上限を超えています。');
      const rate=st.ctx?.sampleRate||44100,offline=new OfflineContext(2,Math.ceil(seconds*rate),rate);
      buildSources(offline,0,0,{excludeGuide:true});const buffer=await offline.startRendering();
      let peak=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)for(const x of buffer.getChannelData(ch))peak=Math.max(peak,Math.abs(x));
      const factor=$('normalize').checked&&peak>.00001?Math.pow(10,-1/20)/peak:1;
      downloadBlob(wav24(buffer,factor),`${clean(st.projectName)}-VOCALS-0sec-24bit.wav`);
      toast('曲の0秒から同期したボーカル専用WAVを書き出しました。');
    }catch(e){console.error(e);toast('ボーカル書き出し失敗：'+e.message,6500);}
    finally{btn.disabled=false;setSaveStatus(st.db?'自動保存済み':'保存不可');}
  }
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const crcTable=(()=>{const a=new Uint32Array(256);for(let n=0;n<256;n++){let x=n;for(let i=0;i<8;i++)x=x&1?0xedb88320^(x>>>1):x>>>1;a[n]=x>>>0;}return a;})();
  function crc32(bytes){let c=0xffffffff;for(const x of bytes)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
  function zipStore(entries){const parts=[],central=[];let offset=0;for(const entry of entries){const name=encoder.encode(entry.name),bytes=entry.bytes,crc=crc32(bytes);
      const local=new Uint8Array(30+name.length),dv=new DataView(local.buffer);dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(6,0x800,true);dv.setUint16(8,0,true);dv.setUint32(14,crc,true);dv.setUint32(18,bytes.length,true);dv.setUint32(22,bytes.length,true);dv.setUint16(26,name.length,true);local.set(name,30);parts.push(local,bytes);
      const cd=new Uint8Array(46+name.length),v=new DataView(cd.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(10,0,true);v.setUint32(16,crc,true);v.setUint32(20,bytes.length,true);v.setUint32(24,bytes.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);cd.set(name,46);central.push(cd);offset+=local.length+bytes.length;
    }let centralLength=0;for(const c of central){parts.push(c);centralLength+=c.length;}const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,centralLength,true);v.setUint32(16,offset,true);parts.push(end);return new Blob(parts,{type:'application/zip'});
  }
  function readZipStore(fileBytes){const a=fileBytes,v=new DataView(a.buffer,a.byteOffset,a.byteLength),out=new Map();let offset=0;
    while(offset+4<=a.length){const sig=v.getUint32(offset,true);if(sig===0x02014b50||sig===0x06054b50)break;
      if(sig!==0x04034b50||offset+30>a.length)throw new Error('ZIP形式が読み取れません');const method=v.getUint16(offset+8,true),flags=v.getUint16(offset+6,true),crc=v.getUint32(offset+14,true),compressed=v.getUint32(offset+18,true),size=v.getUint32(offset+22,true),nameLen=v.getUint16(offset+26,true),extraLen=v.getUint16(offset+28,true);
      if(method!==0||(flags&8)!==0)throw new Error('このアプリが作成した無圧縮ZIPだけを復元できます');if(compressed!==size)throw new Error('ZIPの長さが正しくありません');const start=offset+30+nameLen+extraLen,end=start+size;if(end>a.length)throw new Error('ZIPが途中で切れています');
      const name=decoder.decode(a.subarray(offset+30,offset+30+nameLen)),bytes=a.subarray(start,end);if(crc32(bytes)!==crc)throw new Error(`破損しているZIP内ファイル: ${name}`);out.set(name,bytes);offset=end;
    }return out;
  }
  async function backup(){if(st.recording)return;setSaveStatus('バックアップ作成中…');$('backupBtn').disabled=true;
    try{const project=allData(),entries=[{name:'project.json',bytes:encoder.encode(JSON.stringify({...project,exportedAt:new Date().toISOString()},null,2))}];
      for(const c of st.clips)if(c.buffer){const data=new Uint8Array(await wav24(c.buffer).arrayBuffer());entries.push({name:`audio/${c.id}.wav`,bytes:data});}
      const file=zipStore(entries);downloadBlob(file,`${clean(st.projectName)}-project-backup.zip`);toast('歌詞・構成・すべての録音をZIPにまとめました。ファイルに保存してください。',5500);
    }catch(e){console.error(e);toast(`バックアップ失敗：${e.message}`,6500);}finally{setSaveStatus(st.db?'自動保存済み':'保存不可');updateButtons();}
  }
  async function restoreZip(file){if(!file)return;if(!confirm('ZIP内のプロジェクトを読み込みます。現在編集中の曲は置き換わります。先に現在のZIPを保存しましたか？'))return;
    $('restoreBtn').disabled=true;setSaveStatus('復元中…');try{
      if(file.size>650*1024*1024)throw new Error('ZIPが大きすぎます（650MBまで）');const bytes=new Uint8Array(await file.arrayBuffer()),files=readZipStore(bytes),json=files.get('project.json');if(!json)throw new Error('project.jsonがありません');const data=JSON.parse(decoder.decode(json));if(data.version!==2||!Array.isArray(data.sections)||!Array.isArray(data.lanes))throw new Error('このプロジェクト形式に対応していません');
      const sections=data.sections.slice(0,40).map(safeSection),lanes=data.lanes.slice(0,MAX_LANES).map(safeLane);if(!sections.length||!lanes.length)throw new Error('歌詞やレイヤーの情報がありません');
      const clips=[];const ctx=await audioCtx(false);
      for(const item of (data.clips||[]).slice(0,MAX_CLIPS)){
        if(!item.id||!sections.some(s=>s.id===item.sectionId)||!lanes.some(l=>l.id===item.laneId))continue;
        const raw=files.get(`audio/${item.id}.wav`);if(!raw)throw new Error(`録音ファイル ${item.id} がありません`);
        const blob=new Blob([raw],{type:'audio/wav'}),buf=await ctx.decodeAudioData(raw.slice().buffer);clips.push({...safeClip(item),blob,buffer:buf});
      }
      if(st.playing)stopPlayback(false);
      // Decode and validate everything before replacing active project.
      if(st.db){
        await new Promise((resolve,reject)=>{const tx=st.db.transaction(['clips','settings'],'readwrite');const store=tx.objectStore('clips');store.clear();for(const c of clips)store.put(c.blob,c.id);tx.objectStore('settings').put({...data,clips:clips.map(({blob,buffer,...x})=>x)},'songStudioProjectV2');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
      }
      st.sections=sections;st.lanes=lanes;st.clips=clips;st.projectName=String(data.projectName||'復元された曲').slice(0,60);st.bpm=clamp(data.bpm||100,40,240);st.beats=[3,4,6].includes(+data.beats)?+data.beats:4;st.zoom=clamp(data.zoom||48,24,130);st.bridge=data.bridge||null;st.overwriteHistory=safeOverwriteHistory(data.overwriteHistory);$('recordMode').value=['replace','retake'].includes(data.recordMode)?data.recordMode:'overdub';$('includeGuideExport').checked=data.includeGuideExport===true;
      st.selectedSection=sections.some(s=>s.id===data.selectedSection)?data.selectedSection:sections[0].id;st.selectedLane=lanes.some(l=>l.id===data.selectedLane)?data.selectedLane:lanes[0].id;st.selectedClip='';st.position=0;
      $('normalize').checked=data.normalize!==false;$('tail').checked=data.tail!==false;$('metroEnabled').checked=data.metroEnabled!==false;$('metroAudible').checked=data.metroAudible!==false;$('metroVolume').value=clamp(data.metroVolume??45,0,100);
      syncUI();renderAll();saveSoon();toast('プロジェクトを復元しました。歌詞と録音も読み込まれています。',5300);
    }catch(e){console.error(e);toast(`ZIPを復元できません：${e.message}`,7000);}finally{setSaveStatus(st.db?'自動保存済み':'保存不可');updateButtons();}
  }
  async function importMelodyBridge(file){
    if(!file||st.recording||st.starting||st.stopping)return;
    if(file.size>230*1024*1024)return toast('連携ZIPは230MBまでです。',6000);
    const button=$('bridgeImportBtn');button.disabled=true;setSaveStatus('連携データを確認中…');
    try{
      const entries=readZipStore(new Uint8Array(await file.arrayBuffer()));
      const metadata=entries.get('bridge.json');
      if(!metadata)throw Error('bridge.jsonがありません。');
      if(metadata.length>4*1024*1024)throw Error('メロディー情報が大きすぎます。');
      const d=JSON.parse(decoder.decode(metadata));
      if(d.format!=='melody-voice-bridge'||![1,2].includes(d.version)||!Array.isArray(d.sections))throw Error('この連携データ形式には対応していません。');
      const guideBytes=entries.get(d.version===2?'melody.wav':'guide.wav'),accompanimentBytes=d.version===2?entries.get('accompaniment.wav'):null;
      if(!guideBytes||(d.version===2&&!accompanimentBytes))throw Error('メロディーまたは伴奏のWAVがありません。');
      if(d.sections.length<1||d.sections.length>40)throw Error('連携できるブロック数は1〜40個です。');
      const bpm=clamp(d.bpm,40,240),beats=[3,4,6].includes(+d.beats)?+d.beats:4;
      if(!Number.isFinite(+d.bpm)||Math.abs(bpm-d.bpm)>.01||!([3,4,6].includes(+d.beats)))throw Error('BPMや拍子の情報が不正です。');
      const sections=d.sections.map((sec,i)=>{
        if(!Number.isFinite(+sec.startBeat)||+sec.startBeat<0||!Number.isFinite(+sec.bars)||+sec.bars<1||+sec.bars>48)throw Error('ブロックの長さ・位置が不正です。');
        return safeSection({id:id('s'),name:sec.name,bars:sec.bars,startBeat:sec.startBeat,lyrics:sec.lyrics},i);
      });
      const approximateEnd=Math.max(...sections.map(s=>s.startBeat+s.bars*beats))*60/bpm;
      if(approximateEnd>MAX_MIX_SEC+60)throw Error('曲の構成が長すぎます（約15分以内にしてください）。');
      if(guideBytes.byteLength>MAX_IMPORT_BYTES)throw Error('ガイド音声が大きすぎます（200MBまで）。');
      if(decoder.decode(guideBytes.subarray(0,4))!=='RIFF'||decoder.decode(guideBytes.subarray(8,12))!=='WAVE')throw Error('ガイド音声がWAV形式ではありません。');
      const ctx=await audioCtx(false),sound=await ctx.decodeAudioData(guideBytes.slice().buffer),accompanimentSound=accompanimentBytes?await ctx.decodeAudioData(accompanimentBytes.slice().buffer):null;
      if(sound.duration>MAX_IMPORT_SEC+.01||(accompanimentSound&&accompanimentSound.duration>MAX_IMPORT_SEC+.01))throw Error('ガイド音声は15分までです。');
      if(st.clips.length&&!confirm(`現在の曲には録音・音声が${st.clips.length}件あります。
【重要】連携ZIPを読み込むと、現在の歌詞・構成・録音はすべて置き換わります。
先に「プロジェクト一式ZIPで保存」してありますか？`))return;
      if(!confirm(`「${String(d.title||'新しい曲').slice(0,45)}」を新しい曲として読み込みます。現在の編集中の内容を置き換えてよいですか？`))return;
      if(st.playing)stopPlayback(false);
      const lanes=[...defaultLaneNames.map((name,i)=>makeLane(name,i))],guideLane=makeLane('♪ メロディーガイド',lanes.length);
      guideLane.guide=true;guideLane.volume=65;guideLane.fx={...FX,hp:40,low:0,mid:0,high:0,deess:0,compressor:0,reverb:0,gate:0};lanes.push(guideLane);
      const guideClip={id:id('c'),sectionId:sections[0].id,laneId:guideLane.id,offsetSec:0,volume:100,mute:false,filename:'Melody Atelier ガイド音声',blob:new Blob([guideBytes],{type:'audio/wav'}),buffer:sound};
       const accompanimentLane=accompanimentSound?makeLane('♫ コード伴奏',lanes.length):null;
       if(accompanimentLane){accompanimentLane.guide=true;accompanimentLane.volume=75;accompanimentLane.fx={...guideLane.fx};lanes.push(accompanimentLane);}
       const accompanimentClip=accompanimentLane?{id:id('c'),sectionId:sections[0].id,laneId:accompanimentLane.id,offsetSec:0,volume:100,mute:false,filename:'Melody Atelier コード伴奏',blob:new Blob([accompanimentBytes],{type:'audio/wav'}),buffer:accompanimentSound}:null;
       const importedClips=accompanimentClip?[guideClip,accompanimentClip]:[guideClip];
      const title=String(d.title||'Melody Atelierからの曲').slice(0,60),bridgeInfo={format:'melody-voice-bridge',version:d.version,title,importedAt:new Date().toISOString(),includesChords:!!d.includesChords};
      // Entire IndexedDB transaction commits atomically before changing in-memory state.
      if(st.db){
        await new Promise((resolve,reject)=>{
          const tx=st.db.transaction(['settings','clips'],'readwrite'),clips=tx.objectStore('clips');clips.clear();for(const c of importedClips)clips.put(c.blob,c.id);
          tx.objectStore('settings').put({...allData(),projectName:title,bpm,beats,sections,lanes,clips:importedClips.map(safeClip),selectedSection:sections[0].id,selectedLane:lanes[0].id,bridge:bridgeInfo,overwriteHistory:[],includeGuideExport:false},'songStudioProjectV2');
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });
      }
      st.projectName=title;st.bpm=bpm;st.beats=beats;st.sections=sections;st.lanes=lanes;st.clips=importedClips;
      st.bridge=bridgeInfo;st.overwriteHistory=[];st.selectedSection=sections[0].id;st.selectedLane=lanes[0].id;st.selectedClip=guideClip.id;st.position=0;
      $('includeGuideExport').checked=false;syncUI();renderAll();saveSoon();
      $('bridgeStatus').textContent=`✓ ${sections.length}ブロック／BPM ${bpm}／${beats}拍子／ガイド ${sTime(sound.duration)}${accompanimentSound?'／伴奏 '+sTime(accompanimentSound.duration):''}。歌声を別レイヤーに録音できます。`;
      toast('Melody Atelierから歌詞・曲構成・BPM・ガイド音声を読み込みました。',6500);
    }catch(e){console.error(e);toast('連携ZIPを読み込めません：'+e.message,7200);}
    finally{setSaveStatus(st.db?'自動保存済み':'端末保存不可');updateButtons();}
  }
  // Music Atelier interchange v1: ZIP STORED, time origin at the start of the song.
  // bridge.json: {format:"music-voice-bridge",version:1,title,bpm,beats,
  //   audioFile:"accompaniment.wav",guideFile?:"melody.wav",
  //   sections:[{name,lyrics,startBeat,bars}]}
  async function importMusicBridge(file){
    if(!file||st.recording||st.starting||st.stopping)return;
    const button=$('musicImportBtn');button.disabled=true;setSaveStatus('Music連携ZIPを確認中…');
    try{
      if(file.size>450*1024*1024)throw Error('ZIPは450MB以内にしてください。');
      const files=readZipStore(new Uint8Array(await file.arrayBuffer()));
      const raw=files.get('bridge.json');if(!raw||raw.length>4*1024*1024)throw Error('bridge.jsonが見つからないか大きすぎます。');
      const data=JSON.parse(decoder.decode(raw));
      if(data.format!=='music-voice-bridge'||data.version!==1)throw Error('Music Atelier連携ZIP v1を選んでください。');
      const bpm=Number(data.bpm),beats=Number(data.beats);
      if(!Number.isFinite(bpm)||bpm<40||bpm>240||![3,4,6].includes(beats))throw Error('BPMまたは拍子が不正です。');
      const safePath=(v)=>typeof v==='string'&&/^[\w.-]+\.wav$/i.test(v)?v:null;
      const audioName=safePath(data.audioFile),guideName=data.guideFile?safePath(data.guideFile):null;
      if(!audioName||(data.guideFile&&!guideName))throw Error('WAVファイル名が不正です。');
      const backing=files.get(audioName),guide=guideName?files.get(guideName):null;
      if(!backing||(guideName&&!guide))throw Error('ZIP内の伴奏・ガイドWAVがありません。');
      const checkWav=bytes=>{if(bytes.length>MAX_IMPORT_BYTES||decoder.decode(bytes.subarray(0,4))!=='RIFF'||decoder.decode(bytes.subarray(8,12))!=='WAVE')throw Error('WAVが不正、または200MBを超えています。');};
      checkWav(backing);if(guide)checkWav(guide);
      const ctx=await audioCtx(false);
      const backingSound=await ctx.decodeAudioData(backing.slice().buffer);
      const guideSound=guide?await ctx.decodeAudioData(guide.slice().buffer):null;
      if(backingSound.duration>MAX_IMPORT_SEC||guideSound?.duration>MAX_IMPORT_SEC)throw Error('音声は15分以内にしてください。');
      const input=Array.isArray(data.sections)?data.sections:[];
      if(input.length>40)throw Error('曲構成は40ブロックまでです。');
      const rawSections=input.length?input:[{name:'曲全体',lyrics:'',startBeat:0,bars:Math.max(1,Math.ceil(backingSound.duration*bpm/60/beats))}];
      const sections=rawSections.map((sec,i)=>{
        const startBeat=Number(sec.startBeat),bars=Number(sec.bars);
        if(!Number.isFinite(startBeat)||startBeat<0||!Number.isInteger(bars)||bars<1||bars>48)throw Error('ブロック位置または小節数が不正です（最大48小節）。');
        return safeSection({id:id('s'),name:sec.name,lyrics:sec.lyrics,startBeat,bars},i);
      });
      if(Math.max(...sections.map(x=>x.startBeat+x.bars*beats))*60/bpm>MAX_MIX_SEC+60)throw Error('曲の構成が15分を超えています。');
      if(!confirm('Music Atelierの曲を読み込み、現在の曲・録音を置き換えます。現在のプロジェクトZIPは保存しましたか？'))return;
      if(st.playing)stopPlayback(false);
      const lanes=[...defaultLaneNames.map((name,i)=>makeLane(name,i))];
      const makeGuide=(name,bytes,buffer,volume)=>{
        const lane=makeLane(name,lanes.length);lane.guide=true;lane.volume=volume;lane.fx={...FX,hp:40,low:0,mid:0,high:0,deess:0,compressor:0,reverb:0,gate:0};lanes.push(lane);
        return {id:id('c'),sectionId:sections[0].id,laneId:lane.id,offsetSec:-sections[0].startBeat*60/bpm,volume:100,mute:false,filename:name,blob:new Blob([bytes],{type:'audio/wav'}),buffer};
      };
      const clips=[makeGuide('♫ Music Atelier 伴奏',backing,backingSound,85)];
      if(guide)clips.push(makeGuide('♪ Music Atelier メロディーガイド',guide,guideSound,60));
      const title=String(data.title||'Music Atelierからの曲').slice(0,60);
      const bridge={format:'music-voice-bridge',version:1,title,importedAt:new Date().toISOString(),sourceProjectId:String(data.projectId||'').slice(0,120)};
      if(st.db)await new Promise((resolve,reject)=>{
        const tx=st.db.transaction(['settings','clips'],'readwrite'),store=tx.objectStore('clips');store.clear();
        for(const clip of clips)store.put(clip.blob,clip.id);
        tx.objectStore('settings').put({...allData(),projectName:title,bpm,beats,sections,lanes,clips:clips.map(safeClip),selectedSection:sections[0].id,selectedLane:lanes[0].id,bridge,overwriteHistory:[],includeGuideExport:false},'songStudioProjectV2');
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      st.projectName=title;st.bpm=bpm;st.beats=beats;st.sections=sections;st.lanes=lanes;st.clips=clips;st.bridge=bridge;
      st.overwriteHistory=[];st.selectedSection=sections[0].id;st.selectedLane=lanes[0].id;st.selectedClip=clips[0].id;st.position=0;
      $('includeGuideExport').checked=false;syncUI();renderAll();saveSoon();
      $('bridgeStatus').textContent=`✓ Music Atelier連携：${title}／伴奏${sTime(backingSound.duration)}／BPM ${bpm}／${beats}拍子。録音後はMusicへ返すZIPを使ってください。`;
      toast('Music Atelierの伴奏・曲構成を読み込みました。録音を始められます。',6500);
    }catch(e){console.error(e);toast('Music連携ZIP読み込み失敗：'+e.message,7000);}
    finally{button.disabled=false;setSaveStatus(st.db?'自動保存済み':'保存不可');updateButtons();}
  }
  async function exportForMusic(){
    if(st.recording||st.starting||st.stopping)return;
    if(!st.clips.some(c=>c.buffer&&!getLane(c.laneId)?.guide))return toast('ボーカル録音がありません。');
    if(!OfflineContext)return toast('この端末はオフラインWAV合成に対応していません。');
    const button=$('musicExportBtn');button.disabled=true;setSaveStatus('Music連携ZIPを作成中…');
    try{
      const seconds=duration();if(seconds>MAX_MIX_SEC)throw Error('15分の上限を超えています。');
      const rate=st.ctx?.sampleRate||44100,offline=new OfflineContext(2,Math.ceil(seconds*rate),rate);
      buildSources(offline,0,0,{excludeGuide:true});
      const rendered=await offline.startRendering();
      let peak=0;for(let ch=0;ch<rendered.numberOfChannels;ch++)for(const x of rendered.getChannelData(ch))peak=Math.max(peak,Math.abs(x));
      const factor=$('normalize').checked&&peak>.00001?Math.pow(10,-1/20)/peak:1;
      const wav=new Uint8Array(await wav24(rendered,factor).arrayBuffer());
      const metadata={format:'voice-music-bridge',version:1,source:'Voice Atelier',title:st.projectName,bpm:st.bpm,beats:st.beats,
        audioFile:'vocals-0sec.wav',startSeconds:0,durationSeconds:rendered.duration,sampleRate:rate,
        sourceProjectId:st.bridge?.sourceProjectId||null,
        sections:st.sections.map(x=>({name:x.name,lyrics:x.lyrics,startBeat:x.startBeat,bars:x.bars}))};
      const zip=zipStore([{name:'bridge.json',bytes:encoder.encode(JSON.stringify(metadata))},{name:'vocals-0sec.wav',bytes:wav}]);
      downloadBlob(zip,`${clean(st.projectName)}-Music連携-ボーカル.zip`);
      toast('Music Atelierへ渡すZIPを作成しました。伴奏・ガイドを除いた0秒同期のボーカルが入っています。',6500);
    }catch(e){console.error(e);toast('Music連携ZIP作成失敗：'+e.message,7000);}
    finally{button.disabled=false;setSaveStatus(st.db?'自動保存済み':'保存不可');}
  }
  function bind(){
    $('projectName').oninput=e=>{st.projectName=e.target.value;saveSoon();};
    $('bpm').onchange=e=>{const next=clamp(Math.round(+e.target.value||100),40,240);stopForArrangement();st.bpm=next;e.target.value=next;saveSoon();renderAll();};
    $('beats').onchange=e=>{stopForArrangement();st.beats=+e.target.value;saveSoon();renderDots();renderAll();};
    $('metroEnabled').onchange=()=>{saveSoon();if(st.playing&&!st.recording)void play(playbackPos());};
    $('metroAudible').onchange=saveSoon;$('metroVolume').onchange=saveSoon;
    $('playBtn').onclick=()=>{if(st.playing)stopPlayback();else void play().catch(e=>toast(`再生できません：${e.message}`));};
    $('stopBtn').onclick=()=>{if(st.recording)void endRecording();else stopPlayback();};
    $('seek').oninput=e=>{const p=duration()*(+e.target.value)/100;st.position=p;if(st.playing&&!st.recording)void play(p).catch(err=>toast(err.message));else updateTime();};
    $('addSection').onclick=addSection;$('packSections').onclick=packSections;$('addLane').onclick=()=>addLane();$('addLaneNearRecord').onclick=()=>addLane();
    $('recordSection').onchange=e=>{st.selectedSection=e.target.value;saveSoon();renderSections();scrollToLyrics(st.selectedSection);};
    $('duplicateLyrics').onclick=()=>void duplicateSection($('duplicateDialog').dataset.sourceId,false);
    $('duplicateWithAudio').onclick=()=>void duplicateSection($('duplicateDialog').dataset.sourceId,true);
    $('recordLane').onchange=e=>selectLane(e.target.value);
    $('recordMode').onchange=()=>{saveSoon();updateRecordHint();updateButtons();};
    $('undoOverwriteBtn').onclick=undoLastOverwrite;
    $('recordBtn').onclick=()=>st.recording?void endRecording():void beginRecording();
    $('preset').onchange=e=>{const lane=getLane(st.selectedLane);if(!lane||!PRESETS[e.target.value])return;lane.fx={...PRESETS[e.target.value]};saveSoon();renderEffects();scheduleReplay();};
    $('zoom').oninput=e=>{st.zoom=+e.target.value;renderTimeline();};$('zoom').onchange=saveSoon;
    $('importBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>{void importAudio(e.target.files?.[0]);e.target.value='';};
    $('bridgeImportBtn').onclick=()=>$('bridgeInput').click();$('bridgeInput').onchange=e=>{void importMelodyBridge(e.target.files?.[0]);e.target.value='';};
    $('musicImportBtn').onclick=()=>$('musicInput').click();$('musicInput').onchange=e=>{void importMusicBridge(e.target.files?.[0]);e.target.value='';};$('musicExportBtn').onclick=()=>void exportForMusic();
    $('exportMix').onclick=()=>void exportMix();$('exportVocalsOnly').onclick=()=>void exportVocalsOnly();$('backupBtn').onclick=()=>void backup();$('restoreBtn').onclick=()=>$('backupInput').click();$('backupInput').onchange=e=>{void restoreZip(e.target.files?.[0]);e.target.value='';};
    $('normalize').onchange=saveSoon;$('includeGuideExport').onchange=saveSoon;$('tail').onchange=saveSoon;
    window.addEventListener('resize',()=>{renderTimeline();});
    window.addEventListener('beforeunload',e=>{if(st.recording){e.preventDefault();e.returnValue='';}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&st.recording)toast('録音中です。画面ロックや他アプリに切り替えると音が欠ける可能性があります。',5500);});
  }
  initDefaults();bind();syncUI();renderAll();void loadProject();
  if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline setup failed',e));
})();
