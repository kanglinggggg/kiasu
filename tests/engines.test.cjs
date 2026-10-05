const fs=require('node:fs');
const assert=require('node:assert/strict');
const test=require('node:test');
const ts=require('typescript');
// Execute the actual TS engine modules without adding a test dependency.
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename);
const {defaultBatch,initialDemand,conditions}=require('../src/lib/mock-data.ts');
const {calculateConcepts,materialEstimate}=require('../src/lib/remix-engine.ts');
const {calculateRoutes}=require('../src/lib/circular-engine.ts');
const {calculateEconomics}=require('../src/lib/economics.ts');
test('default batch has intended capacities and dynamic Remix recommendation',()=>{
 const concepts=calculateConcepts(defaultBatch);
 assert.deepEqual(concepts.map(c=>c.max),[68,92,31]);
 assert.equal(calculateRoutes(defaultBatch).recommendation,'Remix');
 assert.equal(concepts[0].price,49);assert.equal(concepts[0].cost,18);assert.equal(concepts[0].utilisation,84);
});
test('41 to 42 unlock has exactly consistent gross sales',()=>{
 const tote=calculateConcepts(defaultBatch)[0];
 assert.equal(calculateEconomics(tote,41).unlocked,false);
 const result=calculateEconomics(tote,42);
 assert.equal(result.unlocked,true);assert.equal(result.committedGrossSales,2058);assert.equal(result.maximumGrossSales,3332);
});
test('half and double quantities change capacities and route values',()=>{
 const half={...defaultBatch,quantity:90,weight:71},double={...defaultBatch,quantity:360,weight:284};
 assert.deepEqual(calculateConcepts(half).map(c=>c.max),[34,46,15]);
 assert.deepEqual(calculateConcepts(double).map(c=>c.max),[136,184,62]);
 assert.equal(calculateRoutes(double).routes[2].value,2*calculateRoutes(defaultBatch).routes[2].value);
 assert.equal(calculateEconomics(calculateConcepts(double)[0],42).maximumGrossSales,6664);
 const small=calculateConcepts(half)[0];assert.equal(small.feasible,false);assert.equal(calculateEconomics(small,42).unlocked,false);
 assert.equal(initialDemand(calculateConcepts(half)).tote.preorders,0);
});
test('condition changes choose resale, repair and recycle without forced Remix',()=>{
 const expected=['Remix','Resell / Clearance','Repair + Resell','Remix','Recycle'];
 conditions.forEach((condition,i)=>assert.equal(calculateRoutes({...defaultBatch,condition}).recommendation,expected[i]));
});
test('material, price and explicit or missing weight affect estimates',()=>{
 const base=calculateConcepts(defaultBatch)[0];
 const blend=calculateConcepts({...defaultBatch,material:'Cotton Blend Denim'})[0];
 assert.ok(blend.max<base.max);assert.notEqual(blend.cost,base.cost);assert.notEqual(blend.price,base.price);
 assert.ok(calculateConcepts({...defaultBatch,price:100})[0].price>base.price);
 assert.equal(calculateConcepts({...defaultBatch,weight:71})[0].max,34);
 assert.equal(calculateConcepts({...defaultBatch,quantity:90,weight:null})[0].max,34);
 assert.equal(calculateConcepts({...defaultBatch,weight:0})[0].max,0);
 assert.equal(calculateConcepts({...defaultBatch,weight:10000})[0].max,68);
 assert.equal(materialEstimate({...defaultBatch,weight:10000}).capped,true);
});
test('scores explain their construction and remain bounded; alternatives share no orders',()=>{
 const {routes}=calculateRoutes(defaultBatch);
 routes.forEach(r=>{assert.ok(r.score>=0&&r.score<=100);assert.equal(r.score,Math.round(r.factors.reduce((s,f)=>s+f.points,0)));assert.ok(r.explanation.length>=3);});
 const seeded=initialDemand(calculateConcepts(defaultBatch));assert.equal(seeded.tote.preorders,41);assert.equal(seeded.sleeve.preorders,0);assert.equal(seeded.jacket.preorders,0);
 const empty=calculateConcepts({...defaultBatch,quantity:0,weight:0});assert.ok(empty.every(c=>c.max===0));assert.equal(calculateRoutes({...defaultBatch,quantity:0,weight:0}).recommendation,null);
});
