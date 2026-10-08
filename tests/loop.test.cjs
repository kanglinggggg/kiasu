const fs=require('node:fs');
const assert=require('node:assert/strict');
const test=require('node:test');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {defaultBatch}=require('../src/lib/mock-data.ts');
const {defaultItem,recommendAction,recoverableKg,confirmItem}=require('../src/lib/return-engine.ts');
const {matchMaterial,loopCapacity}=require('../src/lib/material-match-engine.ts');
const {calculateRewards}=require('../src/lib/rewards-engine.ts');
const {calculateUnlock}=require('../src/lib/unlock-engine.ts');
const {createLoopState,reserveItem,confirmReceipt,placeLoopOrder,completeLoop,loopSummary,demandIntelligence}=require('../src/lib/loop-engine.ts');
const {suggestWardrobe}=require('../src/lib/ai/wardrobe-analysis.ts');

test('wearable items stay in use; repair and reuse precede recovery',()=>{
 assert.equal(recommendAction({...defaultItem,type:'Denim Jacket',condition:'Good',usage:'Rarely worn'}).action,'KEEP & RESTYLE');
 assert.equal(recommendAction({...defaultItem,condition:'Good',usage:'No longer used'}).action,'RESELL / DONATE');
 assert.equal(recommendAction({...defaultItem,condition:'Repairable'}).action,'REPAIR');
 assert.equal(recommendAction(defaultItem).action,'RETURN FOR REMIX');
 assert.equal(recommendAction({...defaultItem,condition:'Fibre only'}).action,'RECYCLE');
 assert.equal(recommendAction({...defaultItem,material:'Unknown'}).action,'MATERIAL REVIEW');
 assert.equal(recoverableKg({...defaultItem,condition:'Good'}),0);
 assert.equal(recoverableKg({...defaultItem,usage:'Often worn'}),0);
});
test('material match uses registered composition and remaining need',()=>{
 const {pool}=createLoopState(defaultBatch),match=matchMaterial(defaultItem,pool);
 assert.equal(match.materialMatch,'high');assert.equal(match.compatibleDrop,'DROP024');assert.equal(match.estimatedRecoverableKg,.8);assert.equal(match.materialStillNeededKg,.8);
 assert.equal(matchMaterial({...defaultItem,material:'Cotton Blend Denim'},pool).eligible,false);
 assert.equal(matchMaterial({...defaultItem,material:'Unknown'},pool).eligible,false);
 assert.equal(matchMaterial({...defaultItem,condition:'Good'},pool).eligible,false);
});
test('rewards follow recoverability, active demand and compatible shortage',()=>{
 const {pool}=createLoopState(defaultBatch);
 assert.deepEqual(calculateRewards(defaultItem,pool,41),{base:100,bonus:80,total:180,discountPercent:10,earlyAccess:true});
 assert.equal(calculateRewards(defaultItem,pool,10).bonus,0);
 assert.equal(calculateRewards({...defaultItem,material:'Cotton Blend Denim'},pool,41).total,0);
 assert.equal(calculateRewards({...defaultItem,condition:'Good'},pool,41).total,0);
 const partial=[...pool,{id:'extra',source:'consumer_return',sourceId:'extra',kg:.4,items:1}];
 assert.equal(calculateRewards(defaultItem,partial,41).total,90);
 const full=[...pool,{id:'extra',source:'consumer_return',sourceId:'extra',kg:.8,items:1}];
 assert.equal(calculateRewards(defaultItem,full,41).total,0);
});
test('AI fields cannot override mass, rewards, capacity or unlock',()=>{
 const injected={...defaultItem,estimatedRecoverableKg:900,recoveredKg:900,credits:99999,capacity:999,unlocked:true};
 assert.deepEqual(confirmItem(injected),defaultItem);assert.equal(recoverableKg(injected),.8);
 let state=createLoopState(defaultBatch);state=reserveItem(state,injected,'NUS UTown');
 assert.equal(state.reservation.credits,180);assert.equal(state.reservation.estimatedKg,.8);
 state=confirmReceipt(state);assert.equal(loopCapacity(state.pool),42);assert.equal(loopSummary(state.pool,state.orders).unlocked,false);
});
test('dual gate is independent; invalid or overcapacity commitments fail closed',()=>{
 const base={preorders:41,preorderThreshold:42,recoveredKg:41.2,kgPerUnit:1,capacity:41};
 assert.equal(calculateUnlock(base).unlocked,false);
 const demand=calculateUnlock({...base,preorders:42});assert.equal(demand.demandReady,true);assert.equal(demand.materialReady,false);assert.equal(demand.unlocked,false);
 const material=calculateUnlock({...base,recoveredKg:42,capacity:68});assert.equal(material.demandReady,false);assert.equal(material.materialReady,true);assert.equal(material.unlocked,false);
 assert.equal(calculateUnlock({...base,preorders:42,recoveredKg:42,capacity:68}).unlocked,true);
 assert.equal(calculateUnlock({...base,preorders:69,recoveredKg:42,capacity:68}).unlocked,false);
 assert.equal(calculateUnlock({...base,recoveredKg:NaN}).unlocked,false);
});
test('default reservation adds no mass; receipt adds 0.8 once; 42nd order unlocks SGD 2058',()=>{
 let state=createLoopState(defaultBatch);
 assert.equal(loopSummary(state.pool,state.orders).kg,41.2);
 state=reserveItem(state,defaultItem,'NUS UTown');assert.equal(state.reservation.status,'Reserved');assert.equal(loopSummary(state.pool,state.orders).kg,41.2);
 assert.equal(completeLoop(state).completed,false);
 state=confirmReceipt(state);assert.equal(state.reservation.status,'Received');assert.equal(loopSummary(state.pool,state.orders).kg,42);
 assert.deepEqual(confirmReceipt(state),state);assert.equal(loopSummary(state.pool,state.orders).unlocked,false);
 state=placeLoopOrder(state);const summary=loopSummary(state.pool,state.orders);assert.equal(summary.unlocked,true);assert.equal(summary.grossSales,2058);assert.equal(summary.capacity,42);assert.deepEqual(placeLoopOrder(state),state);
 state=completeLoop(state);const completed=loopSummary(state.pool,state.orders,state.completed);assert.equal(completed.produced,42);assert.equal(completed.residualKg,0);assert.equal(completed.communityReturns,10);
 assert.equal(state.pool.filter(p=>p.source==='brand_surplus')[0].kg,34);assert.equal(state.pool.filter(p=>p.source==='consumer_return').reduce((n,p)=>n+p.kg,0),8);
});
test('reverse sequence waits for material and unsafe returns cannot reserve',()=>{
 let state=placeLoopOrder(createLoopState(defaultBatch));assert.equal(state.orders,42);assert.equal(loopSummary(state.pool,state.orders).unlocked,false);
 assert.equal(reserveItem(state,{...defaultItem,condition:'Good'},'NUS UTown').reservation,null);
 assert.equal(reserveItem(state,defaultItem,'Unregistered location').reservation,null);
 state=confirmReceipt(reserveItem(state,defaultItem,'NUS UTown'));assert.equal(loopSummary(state.pool,state.orders).unlocked,true);
});
test('brand material and next batch stay capacity constrained',()=>{
 const empty=createLoopState({...defaultBatch,quantity:0,weight:0});assert.equal(loopCapacity(empty.pool),7);assert.equal(placeLoopOrder(empty).orders,42);assert.equal(loopSummary(empty.pool,41).unlocked,false);
 const d=demandIntelligence(empty.pool,41);assert.equal(d.nextBatch,7);
 const full=createLoopState(defaultBatch);assert.equal(demandIntelligence(full.pool,41).nextBatch,41);
 assert.equal(createLoopState({...defaultBatch,material:'Cotton Blend Denim'}).pool[0].kg,0);
 assert.equal(createLoopState({...defaultBatch,condition:'Unsold / Good Condition'}).pool[0].kg,0);
});
test('wardrobe AI mock suggests classification only and supports wearable jacket',async()=>{
 const s=await suggestWardrobe('demo','A cotton denim jacket in good condition. Rarely worn.');
 assert.equal(s.type,'Denim Jacket');assert.equal(s.condition,'Good');assert.equal(s.material,'Cotton Denim');assert.equal(s.estimatedRecoverableKg,undefined);assert.equal(s.credits,undefined);
});

test('planned material follows demand and does not wait for the full batch cap',()=>{
 const base={preorders:42,preorderThreshold:42,recoveredKg:42,kgPerUnit:1,capacity:68};
 assert.equal(calculateUnlock(base).unlocked,true);
 assert.equal(calculateUnlock({...base,recoveredKg:67.2}).unlocked,true);
 assert.equal(calculateUnlock({...base,preorders:50,recoveredKg:49.9}).materialReady,false);
 assert.equal(calculateUnlock({...base,preorders:50,recoveredKg:50}).requiredKg,50);
 assert.equal(calculateUnlock({...base,preorders:41}).unlocked,false);
 assert.equal(calculateUnlock({...base,plannedUnits:1}).unlocked,false);
 assert.equal(calculateUnlock({...base,kgPerUnit:.3333,recoveredKg:13.998}).unlocked,false);
 assert.equal(calculateUnlock({...base,kgPerUnit:.3333,recoveredKg:13.999}).unlocked,true);
});
