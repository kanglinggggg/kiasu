'use client';
import type {ClipProgress,ClipResult} from '@/lib/ai/local-clip';
import {useEffect,useRef,useState} from 'react';
import {ConsumerItem,itemTypes,itemConditions,itemMaterials} from '@/lib/return-engine';
import {demoWardrobe,MAX_IMAGE_BYTES,parseWardrobe,reviewedWardrobe,ScanInput,scanInputSchema,WardrobeSuggestion} from '@/lib/ai/wardrobe-schema';

export function WardrobeScanner({staticOnly=false,disabled=false,onApply}:{staticOnly?:boolean;disabled?:boolean;onApply:(item:Partial<ConsumerItem>)=>void}){
  const [mode,setMode]=useState<'demo'|'gemini'|'clip'>('demo'),[available,setAvailable]=useState(false);
  const [input,setInput]=useState<ScanInput>({description:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [result,setResult]=useState<WardrobeSuggestion|null>(null),[type,setType]=useState(''),[material,setMaterial]=useState('Unknown'),[condition,setCondition]=useState('');
  const [progress,setProgress]=useState<ClipProgress|null>(null),[clip,setClip]=useState<ClipResult|null>(null);
  const modeChosen=useRef(false);
  const [composition,setComposition]=useState('');
  const labelRef=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),version=useRef(0);
  useEffect(()=>{if(staticOnly)return;const c=new AbortController();fetch('/api/wardrobe',{signal:c.signal,cache:'no-store'}).then(r=>r.json()).then(v=>{setAvailable(v.gemini===true);if(v.gemini&&!modeChosen.current)setMode('gemini');}).catch(()=>{});return()=>c.abort();},[staticOnly]);
  useEffect(()=>()=>{version.current++;abort.current?.abort();},[]);
  function clear(){version.current++;abort.current?.abort();setResult(null);setClip(null);setProgress(null);setError('');setBusy(false);}
  async function photo(file:File|undefined,key:'garmentPhoto'|'careLabelPhoto'){
    clear();setInput(old=>({...old,[key]:undefined}));if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){setError('Use JPEG, PNG or WebP up to 10 MB per photo.');return;}
    const token=version.current;
    try {
      const bitmap=await createImageBitmap(file);
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');if(!context){bitmap.close();throw new Error('Image preparation is unsupported on this device.');}
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const data=canvas.toDataURL('image/jpeg',.85);
      if(data.length>Math.ceil(MAX_IMAGE_BYTES/3)*4)throw new Error('Prepared photo is too large. Choose a smaller image.');
      if(token===version.current)setInput(old=>({...old,[key]:data}));
    }catch(e){if(token===version.current)setError(e instanceof Error?e.message:'Could not decode this photo. Choose another image.');}
  }
  async function scan(){
    clear();const token=version.current;setBusy(true);
    try{
      const checked=scanInputSchema.parse(input);let next:WardrobeSuggestion;
      if(mode==='demo')next=demoWardrobe(checked);
      else if(mode==='clip'){
        abort.current=new AbortController();
        setProgress({message:'Starting local image analysis…'});
        const {scanLocalClip}=await import('@/lib/ai/local-clip-client');
        if(token!==version.current)return;
        const local=await scanLocalClip(checked,p=>{if(token===version.current)setProgress(p);},abort.current.signal);
        if(token!==version.current)return;
        setClip(local);next=local.suggestion;
      }
      else{
        abort.current=new AbortController();
        const response=await fetch('/api/wardrobe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(checked),signal:abort.current.signal});
        const body=await response.json();if(!response.ok)throw new Error(body.error??'Analysis failed. Please retry.');next=parseWardrobe(body,checked);
      }
      if(token!==version.current)return;
      setResult(next);setType(next.itemType.value??'');setMaterial(next.material.value??'Unknown');setCondition(next.visibleCondition.value??'');
      setComposition(next.composition.fibres.map(f=>`${f.percent===null?'':f.percent+'% '}${f.name}`).join(' / '));
    }catch(e){if(token===version.current)setError(e instanceof Error?e.message:'Analysis failed. Retry or switch to Demo AI.');}
    finally{if(token===version.current)setBusy(false);}
  }
  const confidence=(n:number)=>n>=0.85?'High':n>=0.6?'Medium':'Low';
  return <details className="loop-ai" open><summary>AI-assisted clothing scan · optional</summary>
    <fieldset className="loop-fields" disabled={disabled||busy}>
      <label>Analysis mode<select value={mode} onChange={e=>{clear();modeChosen.current=true;setMode(e.target.value as typeof mode);}}>{!staticOnly&&<option value="gemini" disabled={!available}>Gemini Vision · primary</option>}<option value="clip">Local CLIP · on-device</option><option value="demo">Demo AI · mock fallback</option></select></label>
      {staticOnly?<p className="fine-print">Public demo · Local CLIP or Demo AI. Gemini requires the local server.</p>:!available&&<p className="fine-print">Gemini Vision is not configured. Demo AI remains available.</p>}
      <p className="fine-print">{mode==='clip'?'Local CLIP analyses the garment photo on this device. The first scan downloads a large model from Hugging Face (roughly 150 MB); runtime files also need internet. Photos are not uploaded. Cached files may be evicted. It does not read care labels.':mode==='demo'?'Demo AI uses mock suggestions. Photos stay local and are not analysed.':'Connected AI sends the selected image to the configured external AI provider for analysis. Do not upload sensitive images.'}</p>
      <div className="form-grid scan-photo-grid">{(['garmentPhoto','careLabelPhoto'] as const).map((key,i)=><label className="scan-photo-card" key={key}>{i===0?'1. Garment photo':'2. Care label'}<small>{i===0?'Upload or take photo':'Optional · improves material accuracy'}</small><input ref={i===1?labelRef:undefined} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void photo(e.target.files?.[0],key);e.target.value='';}}/>{input[key]&&<><img className="loop-item-image" src={input[key]} alt={i===0?'Garment reference':'Care-label reference'}/><button type="button" className="text-button" onClick={()=>{clear();setInput(old=>({...old,[key]:undefined}));}}>Remove photo</button></>}</label>)}</div>
      <label>Description · optional when a photo is supplied<textarea maxLength={6000} value={input.description} placeholder="Describe the item, or upload a photo above." onChange={e=>{clear();setInput(old=>({...old,description:e.target.value}));}}/></label>
      <p className="fine-print">JPEG, PNG or WebP · up to 10 MB each, prepared locally to 1600 px and under 2 MB. Temporary analysis inputs only; images are not saved in the wardrobe database.</p>
      <button type="button" className="secondary" disabled={mode==='clip'?!input.garmentPhoto:!input.description.trim()&&!input.garmentPhoto&&!input.careLabelPhoto} onClick={()=>void scan()}>{busy?'Scanning…':'Scan clothing'}</button>
    </fieldset>
    {busy&&progress&&<div role="status"><p>{progress.message}</p>{progress.percent!==undefined&&<progress aria-label="Current model file download" max={100} value={progress.percent}/>}<p className="fine-print">First load can take several minutes on mobile. Download progress is per file.</p></div>}
    {busy&&<button type="button" className="text-button" onClick={clear}>Cancel scan</button>}
    {error&&<div role="alert"><p>{error}</p><button type="button" className="text-button" onClick={()=>{clear();modeChosen.current=true;setMode('demo');}}>Use Demo AI</button></div>}
    {clip&&<div className="callout"><div><strong>Local CLIP visual matches</strong><p>These scores rank the listed labels. They are not confidence percentages or verified identification. Check the item yourself.</p>{[['Clothing types',clip.types],['Visual attributes',clip.attributes]].map(([title,rows])=><div key={String(title)}><strong>{String(title)}</strong><ol>{(rows as ClipResult['types']).slice(0,3).map(r=><li key={r.label}>{r.label} · relative score {r.score.toFixed(2)}</li>)}</ol></div>)}<small>Completed in {(clip.elapsedMs/1000).toFixed(1)} s, including model loading if needed.</small></div></div>}
    {result&&<div className="scan-review"><h3>Review suggestions</h3><p className="fine-print">AI suggestions need your review. {clip?'CLIP ranks labels; it does not measure confidence.':'Confidence labels are estimates, not verification.'} Review every field; then confirm the item below.</p>
      <fieldset className="loop-fields" disabled={disabled||busy}><div className="form-grid">
      <label>Detected item<select value={type} onChange={e=>setType(e.target.value)}><option value="">Unknown · select clothing type</option>{itemTypes.map(v=><option key={v}>{v}</option>)}</select><small>{clip?'Visual suggestion':confidence(result.itemType.confidence)+' confidence'} · {result.itemType.evidence}</small></label>
      <label>Visible condition<select value={condition} onChange={e=>setCondition(e.target.value)}><option value="">Unknown · inspect condition</option>{itemConditions.map(v=><option key={v}>{v}</option>)}</select><small>{clip?'Human inspection required':confidence(result.visibleCondition.confidence)+' confidence'} · {result.visibleCondition.evidence}</small></label>
      <label>Material<select value={material} onChange={e=>setMaterial(e.target.value)}>{itemMaterials.map(v=><option key={v}>{v}</option>)}</select><small>{clip?'Unknown composition':confidence(result.material.confidence)+' confidence'} · {result.material.evidence}</small></label>
      <label>Composition suggestion · editable<input value={composition} onChange={e=>setComposition(e.target.value)} placeholder="Unknown"/><small>Composition source: {result.composition.source==='care_label'?'Care label':result.composition.source==='visual_guess'?'Visual guess · not composition evidence':'Unknown'}. Reference only; not saved as verified composition.</small></label>
      </div>
      {result.visibleDamage.length>0&&<p>Visible damage: {result.visibleDamage.join('; ')}</p>}
      <p>Reusable panels: {result.reusablePanelsLikely===null?'Uncertain':result.reusablePanelsLikely?'Appear present · inspection required':'Not identified · inspection required'}</p>
      {result.material.value==='Unknown'&&<p>{clip?'Material composition is Unknown. Read the care label manually, or use Gemini Vision with a care-label photo.':'Material composition is uncertain. Scan the care label for a more reliable result.'}</p>}
      {!clip&&input.garmentPhoto&&!input.careLabelPhoto&&result.material.value==='Unknown'&&<><p>Want a more accurate material match? Scan the care label.</p><button type="button" className="text-button" onClick={()=>labelRef.current?.click()}>Add care-label photo</button></>}
      <button type="button" className="secondary" disabled={!type||!condition} onClick={()=>{onApply(reviewedWardrobe(type,material,condition));setResult(null);}}>Apply reviewed suggestions</button>
      </fieldset>
    </div>}
  </details>;
}
