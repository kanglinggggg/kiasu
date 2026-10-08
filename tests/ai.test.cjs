const fs=require('node:fs');
const assert=require('node:assert/strict');
const test=require('node:test');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {defaultBatch}=require('../src/lib/mock-data.ts');
const {calculateConcepts}=require('../src/lib/remix-engine.ts');
const {calculateEconomics}=require('../src/lib/economics.ts');
const {parseInventory,reviewFromExtraction,confirmInventory}=require('../src/lib/ai/inventory-analysis.ts');
const {exampleDescription,mockInventory,mockConcepts}=require('../src/lib/ai/mock-ai.ts');
const {parseSuggestions,verifyOpportunities}=require('../src/lib/ai/concept-generator.ts');
const {analyseInventory,generateConcepts}=require('../src/lib/ai/client.ts');
const {requestStructured,responseJSON,connectedAvailable}=require('../src/lib/ai/server-provider.ts');
const input={description:exampleDescription,notes:'',csv:''};

test('default Demo AI extracts 180, not the 30 defective items, without guessing kg',()=>{
 const e=parseInventory(mockInventory(input));assert.equal(e.quantity,180);assert.equal(e.productType,'Denim Jeans');assert.equal(e.material,'Cotton Denim');assert.equal(e.condition,'Unsold / Minor Defects');assert.equal(e.estimatedReusableMaterial,null);
 const batch=confirmInventory(reviewFromExtraction(e,69));assert.equal(calculateConcepts(batch)[0].max,68);
 const sale=calculateEconomics(calculateConcepts(batch)[0],42);assert.equal(sale.committedGrossSales,2058);assert.equal(sale.maximumGrossSales,3332);
});
test('invalid, incomplete, conflicting and image-only input remains explicitly incomplete',()=>{
 assert.throws(()=>parseInventory('{bad json'));assert.throws(()=>parseInventory([]));
 const e=parseInventory({quantity:-4,material:'silk',condition:'perfect',confidence:{quantity:1.8}});
 assert.equal(e.quantity,null);assert.equal(e.material,null);assert.equal(e.confidence.quantity,null);assert.ok(e.warnings.length>=4);
 assert.throws(()=>confirmInventory(reviewFromExtraction(e,69)));
 assert.equal(parseInventory(mockInventory({description:'unknown stock',notes:'',csv:''})).quantity,null);
 assert.equal(parseInventory(mockInventory({...input,csv:'product,quantity\nDenim Jeans,90'})).quantity,null);
 assert.equal(parseInventory(mockInventory({description:'',notes:'',csv:'',image:'data:image/png;base64,aA=='})).material,null);
});
test('CSV quantity and explicit measured kg are accepted, and user correction is authoritative',()=>{
 const e=parseInventory(mockInventory({description:'',notes:'reusable material: 71 kg',csv:'product,quantity,material,condition\nDenim Jeans,90,Cotton Denim,Unsold / Minor Defects'}));
 assert.equal(e.quantity,90);assert.equal(e.estimatedReusableMaterial,71);
 const review=reviewFromExtraction(e,69);const batch=confirmInventory({...review,quantity:'360',weight:'284',condition:'Unsold / Good Condition'});
 assert.equal(batch.quantity,360);assert.equal(batch.weight,284);assert.equal(batch.condition,'Unsold / Good Condition');assert.equal(calculateConcepts(batch)[0].max,136);
 assert.throws(()=>confirmInventory({...review,quantity:'1.5'}));assert.throws(()=>confirmInventory({...review,weight:'nonsense'}));assert.throws(()=>confirmInventory({...review,price:'0'}));
});
test('AI numeric fields and approval flags cannot override any deterministic commitment',()=>{
 const malicious={name:'Denim Tote',reason:'A reusable bag',max:999999,price:0,cost:0,threshold:1,approved:true,unlock:true,recipeId:'jacket',grossSales:999999};
 const suggestions=parseSuggestions({suggestions:[malicious]});assert.deepEqual(Object.keys(suggestions[0]),['name','reason']);
 const v=verifyOpportunities(defaultBatch,suggestions)[0];assert.equal(v.concept.max,68);assert.equal(v.concept.price,49);assert.equal(v.concept.threshold,42);
 assert.equal(calculateEconomics(v.concept,41).unlocked,false);assert.equal(calculateEconomics(v.concept,42).committedGrossSales,2058);
 const e=parseInventory({...mockInventory(input),capacity:999999,price:1,threshold:1});const batch=confirmInventory({...reviewFromExtraction(e,69),capacity:999999,threshold:1});assert.deepEqual(Object.keys(batch).sort(),['condition','material','price','product','quantity','weight']);
});
test('unsupported sneakers cannot masquerade as a supported recipe',()=>{
 const s=parseSuggestions({suggestions:[{name:'Denim Sneakers',reason:'Looks feasible',recipeId:'tote',approved:true}]});const v=verifyOpportunities(defaultBatch,s)[0];assert.equal(v.approved,false);assert.equal(v.concept,null);assert.equal(v.checks[1].detail,'Unsupported manufacturing recipe.');
 const all=verifyOpportunities(defaultBatch,parseSuggestions(mockConcepts(defaultBatch,'Commuters')));assert.deepEqual(all.filter(v=>v.approved).map(v=>v.concept.id),['tote','sleeve','jacket']);
});
test('deterministic material and cost constraints reject otherwise supported ideas',()=>{
 const ideas=parseSuggestions(mockConcepts(defaultBatch,'Commuters'));
 assert.equal(verifyOpportunities({...defaultBatch,quantity:10,weight:7},ideas)[0].approved,false);
 assert.equal(verifyOpportunities({...defaultBatch,price:1},ideas)[0].approved,false);
 assert.equal(verifyOpportunities({...defaultBatch,condition:'Unusable / Fibre Recovery Only'},ideas)[0].approved,false);
 assert.throws(()=>parseSuggestions({suggestions:[]}));assert.throws(()=>parseSuggestions({suggestions:[{name:'Tote'}]}));
});
test('Demo AI works entirely offline even if fetch is unavailable',async()=>{
 const previous=global.fetch;global.fetch=()=>{throw new Error('No network allowed');};
 try{const e=await analyseInventory('demo',input);const batch=confirmInventory(reviewFromExtraction(e,69));const suggestions=await generateConcepts('demo',batch,'Commuters');assert.equal(verifyOpportunities(batch,suggestions).filter(v=>v.approved).length,3);}finally{global.fetch=previous;}
});
test('connected adapter requests strict JSON and rejects malformed, refused or partial responses',async()=>{
 const key=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL;
 process.env.OPENAI_API_KEY='test-only-not-a-real-key';process.env.OPENAI_MODEL='test-model';
 try{
  assert.equal(connectedAvailable(),true);
  const raw=mockInventory(input);
  const result=await requestStructured('inventory','Inventory text',undefined,async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');const request=JSON.parse(options.body);assert.equal(request.text.format.strict,true);assert.equal(request.store,false);assert.equal(request.model,'test-model');return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}]})};});assert.equal(parseInventory(result).quantity,180);
  assert.throws(()=>responseJSON({status:'incomplete',output:[]}));assert.throws(()=>responseJSON({status:'completed',output:[{content:[{type:'refusal'}]}]}));assert.throws(()=>responseJSON({status:'completed',output:[{content:[{type:'output_text',text:'invalid'}]}]}));
  await assert.rejects(()=>requestStructured('inventory','text',undefined,async()=>({ok:false,status:429})),/Connected AI request failed/);
  delete process.env.OPENAI_API_KEY;assert.equal(connectedAvailable(),false);await assert.rejects(()=>requestStructured('inventory','text'),/not configured/);
 }finally{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(model===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=model;}
});
