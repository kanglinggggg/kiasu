import type { ScanInput } from './wardrobe-schema';
import type { ClipProgress, ClipResult } from './local-clip';

let worker:Worker|null=null;
let sequence=0;
let active=false;
export function scanLocalClip(input:ScanInput,onProgress:(p:ClipProgress)=>void,signal:AbortSignal):Promise<ClipResult>{
  if(typeof Worker==='undefined'||typeof WebAssembly==='undefined')return Promise.reject(new Error('Local CLIP requires Web Workers and WebAssembly. Use Gemini Vision or Demo AI on this device.'));
  if(active)return Promise.reject(new Error('Another local scan is running. Please wait.'));
  if(signal.aborted)return Promise.reject(new Error('Local scan cancelled.'));
  return new Promise((resolve,reject)=>{
    try{worker??=new Worker(new URL('./local-clip.worker.ts',import.meta.url),{type:'module'});}catch{reject(new Error('This browser could not start Local CLIP. Use Gemini Vision or Demo AI.'));return;}
    active=true;const current=worker,id=++sequence;
    const cleanup=()=>{clearTimeout(timer);current.removeEventListener('message',message);current.removeEventListener('error',failure);signal.removeEventListener('abort',cancel);active=false;};
    const fail=(text:string)=>{cleanup();current.terminate();worker=null;reject(new Error(text));};
    const failure=()=>fail('Local CLIP stopped unexpectedly. The device may be short of memory. Retry or use Demo AI.');
    const cancel=()=>fail('Local scan cancelled.');
    const timer=setTimeout(()=>fail('Local CLIP timed out after 3 minutes. Try a faster connection or device, or use Demo AI.'),180000);
    const message=(event:MessageEvent)=>{
      if(event.data.id!==id)return;
      if(event.data.progress)onProgress(event.data.progress);
      else if(event.data.error)fail(event.data.error);
      else if(event.data.result){cleanup();resolve(event.data.result);}
    };
    current.addEventListener('message',message);current.addEventListener('error',failure);signal.addEventListener('abort',cancel);
    current.postMessage({id,input:{description:'',garmentPhoto:input.garmentPhoto}});
  });
}
