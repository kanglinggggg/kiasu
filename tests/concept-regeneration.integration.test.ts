import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {pool, transaction} from '../src/lib/server/db';
import {seedWorkspace} from '../src/lib/server/seed';
import {execute} from '../src/lib/server/service';
import {defaultBatch} from '../src/lib/mock-data';
import {mockConcepts} from '../src/lib/ai/mock-ai';
after(()=>pool.end());
const ideas=mockConcepts(defaultBatch,'everyday use');
const records=async(id:string)=>(await pool.query('SELECT * FROM remix_concepts WHERE batch_id=$1 ORDER BY recipe_key',[id])).rows;
test('seeded B017 regeneration preserves frozen approved concepts and reuses its allocated Tote',async()=>{
 const f=await transaction(c=>seedWorkspace(c,`Concept regression ${crypto.randomUUID()}`));
 const batch=(await pool.query("SELECT id FROM inventory_batches WHERE workspace_id=$1 AND code='B017'",[f.workspaceId])).rows[0];
 const before=await records(batch.id);
 const results=await Promise.all([execute(f.admin,['inventory',batch.id,'concepts'],ideas),execute(f.admin,['inventory',batch.id,'concepts'],ideas)]);
 assert.deepEqual(await records(batch.id),before);
 for(const r of results){assert.equal(r.checks.find((x:any)=>x.concept?.id==='tote').approved,true);assert.equal(r.checks.find((x:any)=>x.concept?.id==='sleeve').approved,false)}
 await assert.rejects(()=>execute(f.admin,['concepts',before[0].id,'approve'],{makerName:'Simulated maker',note:'Explicit simulated review'}));
});
test('two clean simulated brand runs create proposals, require explicit approval and preserve it on regeneration',async()=>{
 for(let i=0;i<2;i++){
  const f=await transaction(c=>seedWorkspace(c,`Concept rehearsal ${crypto.randomUUID()}`));
  const b=await execute(f.admin,['inventory'],{...defaultBatch,product:'Denim Jeans - simulated pilot'});
  await execute(f.admin,['inventory',b.id,'analyse'],{});
  await execute(f.admin,['inventory',b.id,'select-route'],{route:'Remix'});
  await execute(f.admin,['inventory',b.id,'concepts'],ideas);
  const concept=(await records(b.id)).find(x=>x.recipe_key==='tote');
  assert.equal(concept.brand_approved_at,null);
  await assert.rejects(()=>execute(f.admin,['drops'],{conceptId:concept.id}));
  const batch=(await pool.query('SELECT estimated_reusable_kg FROM inventory_batches WHERE id=$1',[b.id])).rows[0];
  await execute(f.admin,['inventory',b.id,'verify'],{material:'Cotton Denim',kg:batch.estimated_reusable_kg,note:'Explicit simulated inspection'});
  await execute(f.admin,['concepts',concept.id,'approve'],{makerName:'Simulated maker',note:'Explicit simulated review'});
  const approved=(await records(b.id)).find(x=>x.id===concept.id);
  await execute(f.admin,['inventory',b.id,'concepts'],ideas);
  assert.deepEqual((await records(b.id)).find(x=>x.id===concept.id),approved);
  const drop=await execute(f.admin,['drops'],{conceptId:concept.id});
  assert.ok(drop.id);
  await assert.rejects(()=>execute(f.admin,['drops'],{conceptId:concept.id}));
 }
});
