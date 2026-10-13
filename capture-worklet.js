/* Sample-frame-aligned mono PCM capture; keeps count-in out of the recorded audio. */
class SongStudioCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.armed=false;this.chunk=new Float32Array(2048);this.pos=0;this.limitSignaled=false;
    this.port.onmessage=e=>{
      const m=e.data;
      if(m?.type==='arm'){
        this.startFrame=Math.max(0,Math.round(m.startFrame));
        this.endFrame=Math.max(this.startFrame,Math.round(m.endFrame));
        this.pos=0;this.chunk=new Float32Array(2048);this.armed=true;this.limitSignaled=false;
      }else if(m?.type==='stop'){
        this.flush();this.armed=false;this.port.postMessage({type:'flushed'});
      }
    };
  }
  flush(){if(!this.pos)return;const arr=this.chunk.slice(0,this.pos);this.port.postMessage({type:'pcm',data:arr},[arr.buffer]);this.pos=0;}
  process(inputs){
    const channels=inputs[0];if(!channels?.length||!this.armed)return true;
    const a=channels[0],b=channels[1];
    for(let i=0;i<a.length;i++){
      const frame=currentFrame+i;
      if(frame<this.startFrame)continue;
      if(frame>=this.endFrame){this.flush();this.armed=false;if(!this.limitSignaled){this.limitSignaled=true;this.port.postMessage({type:'limit'});}break;}
      this.chunk[this.pos++]=b?(a[i]+b[i])*.5:a[i];
      if(this.pos>=this.chunk.length){const arr=this.chunk;this.port.postMessage({type:'pcm',data:arr},[arr.buffer]);this.chunk=new Float32Array(2048);this.pos=0;}
    }
    return true;
  }
}
registerProcessor('songstudio-capture',SongStudioCapture);
