const fs=require('node:fs'),assert=require('node:assert/strict'),test=require('node:test'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {createClipRunner,clipSuggestion,clothingLabels,attributeLabels}=require('../src/lib/ai/local-clip.ts');
const photo='data:image/png;base64,iVBORw0KGgo=';
const input={description:'',garmentPhoto:photo};
const rank=(labels,winner=labels[0])=>labels.map(label=>({label,score:label===winner?.9:.1/(labels.length-1)}));
test('CLIP is lazy, accepts image-only input and reuses one model across scans',async()=>{
 let loads=0,calls=0;const progress=[];
 const run=createClipRunner(async()=>{loads++;return async(image,labels)=>{calls++;assert.equal(image,photo);return rank(labels);};});
 assert.equal(loads,0);const a=await run(input,p=>progress.push(p.message));await run(input,p=>progress.push(p.message));
 assert.equal(loads,1);assert.equal(calls,4);assert.equal(a.suggestion.itemType.value,'Denim Jeans');assert.ok(progress.includes('Reusing Local CLIP…'));
});
test('CLIP never derives composition, verification or condition readiness from similarity',()=>{
 const r=clipSuggestion(rank(clothingLabels),rank(attributeLabels));
 assert.equal(r.suggestion.material.value,'Unknown');assert.deepEqual(r.suggestion.composition.fibres,[]);assert.equal(r.suggestion.visibleCondition.value,null);assert.equal(r.suggestion.itemType.confidence,0);assert.equal(r.suggestion.reusablePanelsLikely,null);
 assert.match(r.suggestion.itemType.evidence,/Appearance cannot establish fibre composition/);assert.doesNotMatch(r.suggestion.itemType.evidence,/T-shirt appearance/);
 for(const key of ['reward','capacity','verified_kg','allocation','unlocked'])assert.equal(r.suggestion[key],undefined);
});
test('unsupported types and weak leads remain unknown; T-shirt never proves cotton',()=>{
 for(const label of ['a T-shirt','a bag','an object other than clothing'])assert.equal(clipSuggestion(rank(clothingLabels,label),rank(attributeLabels)).suggestion.itemType.value,null);
 assert.equal(clipSuggestion(clothingLabels.map(label=>({label,score:.125})),rank(attributeLabels)).suggestion.itemType.value,null);
});
test('malformed scores and invented labels are rejected',()=>{
 assert.throws(()=>clipSuggestion([{label:'verified cotton',score:1}],rank(attributeLabels)));
 assert.throws(()=>clipSuggestion(rank(clothingLabels).map(r=>({...r,score:NaN})),rank(attributeLabels)));
});
test('failed model download clears cache and allows retry without mock substitution',async()=>{
 let loads=0;const run=createClipRunner(async()=>{if(++loads===1)throw Error('download failed');return async(_,labels)=>rank(labels);});
 await assert.rejects(run(input,()=>{}),/download failed/);assert.equal((await run(input,()=>{})).suggestion.material.value,'Unknown');assert.equal(loads,2);
});
test('description-only and label-only input do not load CLIP',async()=>{
 let loaded=false;const run=createClipRunner(async()=>{loaded=true;return async()=>[];});
 await assert.rejects(run({description:'jeans'},()=>{}),/garment photo/);await assert.rejects(run({description:'',careLabelPhoto:photo},()=>{}),/garment photo/);assert.equal(loaded,false);
});
test('concurrent scans cannot multiply model memory and inference failures can retry',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);let count=0;
 const run=createClipRunner(async()=>{await gate;return async(_,labels)=>{if(++count===1)throw Error('bad image');return rank(labels);};});
 const first=run(input,()=>{});await assert.rejects(run(input,()=>{}),/already running/);release();await assert.rejects(first,/bad image/);assert.ok(await run(input,()=>{}));
});
