import { CLIP_MODEL, createClipRunner } from './local-clip';
import type { ScanInput } from './wardrobe-schema';

const run=createClipRunner(async(progress)=>{
  const {pipeline,env}=await import('@huggingface/transformers');
  env.allowLocalModels=false;
  env.useBrowserCache=true;
  // Single-threaded WASM works on static hosts without cross-origin isolation.
  env.backends.onnx.wasm!.numThreads=1;
  env.backends.onnx.wasm!.proxy=false;
  const classifier=await pipeline('zero-shot-image-classification',CLIP_MODEL,{
    device:'wasm',dtype:'q8',
    progress_callback:(event)=>{
      if(event.status==='progress')progress({message:`Downloading ${event.file}`,percent:Math.round(event.progress)});
      else if(event.status==='initiate')progress({message:`Loading ${event.file}…`});
      else if(event.status==='ready')progress({message:'Local model ready.'});
    },
  });
  return async(image,labels)=>classifier(image,labels);
});
self.onmessage=async(event:MessageEvent<{id:number;input:ScanInput}>)=>{
  const {id,input}=event.data;
  try{
    const result=await run(input,progress=>self.postMessage({id,progress}));
    self.postMessage({id,result});
  }catch(error){
    console.error('Local CLIP runtime:',error instanceof Error?error.message:'Unknown runtime error');
    self.postMessage({id,error:`Local CLIP could not load or analyse this photo. ${error instanceof Error?error.message.slice(0,350):''} Check your connection and available memory, retry, or use Gemini Vision / Demo AI.`});
  }
};
