import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {pool,transaction} from '../src/lib/server/db';
import {seedWorkspace} from '../src/lib/server/seed';
import {snapshot} from '../src/lib/server/snapshot';
import {execute} from '../src/lib/server/service';
import {defaultItem} from '../src/lib/return-engine';
after(()=>pool.end());
const cmd=()=>({requestKey:crypto.randomUUID(),reason:'Commerce integration check'});
async function fixture(){const f=await transaction(c=>seedWorkspace(c,'Commerce '+crypto.randomUUID()));const s=await snapshot(f.admin);return {...f,drop:s.drops.find(d=>d.code==='DROP024')!,s};}
async function reserve(f:Awaited<ReturnType<typeof fixture>>){const item=await execute(f.admin,['consumer-items'],defaultItem);return execute(f.admin,['returns'],{itemId:item.id,dropId:f.drop.id,collectionPointId:f.s.points[0].id});}
async function accept(f:Awaited<ReturnType<typeof fixture>>){const r=await reserve(f);await execute(f.admin,['returns',r.id,'receive'],{});await execute(f.admin,['returns',r.id,'simulate-inspection'],{});return r;}
test('reservation grants nothing; verified return grants one usable entitlement and excludes existing stock from bounty',async()=>{const f=await fixture(),r=await reserve(f);assert.equal((await snapshot(f.admin)).commerce.entitlements.length,0);await execute(f.admin,['returns',r.id,'receive'],{});const calls=await Promise.allSettled([execute(f.admin,['returns',r.id,'simulate-inspection'],{}),execute(f.admin,['returns',r.id,'simulate-inspection'],{})]);assert.equal(calls.filter(c=>c.status==='fulfilled').length,1);const s=await snapshot(f.admin);assert.equal(s.commerce.entitlements.length,1);assert.equal(s.commerce.entitlements[0].percent,10);assert.equal(s.balance,100);assert.equal(s.commerce.bounties.find(b=>b.dropId===f.drop.id)!.bonus,0);});
test('rejected return has no discount, credit or counted community return',async()=>{const f=await fixture(),r=await reserve(f);await execute(f.admin,['returns',r.id,'receive'],{});await execute(f.admin,['returns',r.id,'inspect'],{material:'Cotton Denim',condition:'Damaged / reusable panels',kg:0,result:'rejected',note:'Rejected test'});const s=await snapshot(f.admin);assert.equal(s.commerce.entitlements.length,0);assert.equal(s.balance,0);assert.equal(s.commerce.community.accepted_returns,9);});
test('checkout reserves once, confirms net commitments, then cancellation and refund reconcile benefits once',async()=>{const f=await fixture();await accept(f);let s=await snapshot(f.admin);const key=crypto.randomUUID(),payload={credits:100,entitlementId:s.commerce.entitlements[0].id,requestKey:key};const race=await Promise.allSettled([execute(f.admin,['drops',f.drop.id,'checkout'],payload),execute(f.admin,['drops',f.drop.id,'checkout'],payload)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);const record=(race.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;assert.equal(record.payable_cents,4310);s=await snapshot(f.admin);assert.equal(s.balance,0);assert.equal(s.commerce.entitlements[0].status,'reserved');assert.equal(s.drops.find(d=>d.id===f.drop.id)!.orders,41);await execute(f.admin,['preorders',record.preorder_id,'confirm'],cmd());s=await snapshot(f.admin);assert.equal(s.drops.find(d=>d.id===f.drop.id)!.orders,42);assert.equal(s.commerce.entitlements[0].status,'redeemed');assert.equal(s.commerce.sales.gmv_cents-s.commerce.sales.net_cents,590);await execute(f.admin,['preorders',record.preorder_id,'cancel'],cmd());s=await snapshot(f.admin);assert.equal(s.balance,100);assert.equal(s.commerce.entitlements[0].status,'available');assert.equal(s.commerce.checkouts[0].status,'cancelled');await assert.rejects(execute(f.admin,['preorders',record.preorder_id,'cancel'],cmd()));await execute(f.admin,['preorders',record.preorder_id,'refund'],cmd());s=await snapshot(f.admin);assert.equal(s.balance,100);assert.equal(s.commerce.entitlements[0].status,'available');assert.equal(s.commerce.checkouts[0].status,'refunded');assert.equal(s.preorders.find(p=>p.id===record.preorder_id)!.status,'refunded');});
test('failed pending checkout restores ledger and entitlement without confirmed demand',async()=>{const f=await fixture();await accept(f);let s=await snapshot(f.admin);const r=await execute(f.admin,['drops',f.drop.id,'checkout'],{credits:50,entitlementId:s.commerce.entitlements[0].id,requestKey:crypto.randomUUID()});await execute(f.admin,['preorders',r.preorder_id,'fail'],cmd());s=await snapshot(f.admin);assert.equal(s.balance,100);assert.equal(s.commerce.entitlements[0].status,'available');assert.equal(s.commerce.checkouts[0].status,'failed');assert.equal(s.drops.find(d=>d.id===f.drop.id)!.orders,41);});
test('unpaid waitlist never increases confirmed demand or material plan',async()=>{const f=await fixture();await execute(f.admin,['drops',f.drop.id,'waitlist'],{requestKey:crypto.randomUUID()});const s=await snapshot(f.admin);assert.equal(s.commerce.waitlist.find(w=>w.drop_id===f.drop.id).total,1);assert.equal(s.drops.find(d=>d.id===f.drop.id)!.orders,41);assert.equal(s.drops.find(d=>d.id===f.drop.id)!.planned_units,42);});
test('corrected return revokes discount and leaves community history out of totals',async()=>{const f=await fixture(),r=await accept(f);let s=await snapshot(f.admin);assert.equal(s.commerce.community.accepted_returns,10);await execute(f.admin,['returns',r.id,'correct'],cmd());s=await snapshot(f.admin);assert.equal(s.commerce.community.accepted_returns,9);assert.equal(s.commerce.community.recovered_kg,7.2);assert.equal(s.commerce.entitlements[0].status,'revoked');});

test('checkout debit cannot be reversed outside its lifecycle',async()=>{const f=await fixture();await accept(f);const r=await execute(f.admin,['drops',f.drop.id,'checkout'],{credits:100,requestKey:crypto.randomUUID()});await assert.rejects(execute(f.admin,['rewards',r.credit_transaction_id,'reverse'],cmd()),/linked preorder/);assert.equal((await snapshot(f.admin)).balance,0);await execute(f.admin,['preorders',r.preorder_id,'fail'],cmd());assert.equal((await snapshot(f.admin)).balance,100);});
test('parallel checkouts cannot spend the same credit balance',async()=>{const f=await fixture();await accept(f);const other=f.s.drops.find(d=>d.code==='DROP025')!;const outcomes=await Promise.allSettled([f.drop.id,other.id].map(id=>execute(f.admin,['drops',id,'checkout'],{credits:100,requestKey:crypto.randomUUID()})));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal((await snapshot(f.admin)).balance,0);});
test('expired reserved checkout rejects confirmation and can restore credits',async(t)=>{const f=await fixture();await accept(f);const r=await execute(f.admin,['drops',f.drop.id,'checkout'],{credits:100,requestKey:crypto.randomUUID()});t.mock.timers.enable({apis:['Date'],now:Date.now()+31*60*1000});await assert.rejects(execute(f.admin,['preorders',r.preorder_id,'confirm'],cmd()),/expired/);await execute(f.admin,['preorders',r.preorder_id,'cancel'],cmd());assert.equal((await snapshot(f.admin)).balance,100);});

test('genuine shortage scenario pays a verified bonus, clears the bounty from real stock, and unlocks only after allocation',async()=>{
 const f=await transaction(c=>seedWorkspace(c,`Demo run ${new Date().toISOString()} · GENUINE SHORTAGE`,'genuine_shortage'));
 let s=await snapshot(f.admin),drop=s.drops.find(d=>d.code==='DROP024')!;
 const bounty=s.commerce.bounties.find(b=>b.dropId===drop.id)!;
 assert.ok(s.commerce.bounties.every(b=>b.orders+b.reservations+b.waitlist>0));
 assert.equal(drop.orders,41);assert.equal(drop.allocated_kg,41.2);assert.equal(drop.material_ready,false);
 assert.equal(bounty.availableStockKg,0);assert.equal(bounty.shortageKg,.8);assert.ok(bounty.bonus>0);
 const item=await execute(f.admin,['consumer-items'],defaultItem);
 const preview=item.matches.find((m:any)=>m.dropId===drop.id);
 assert.ok(preview.reward.bonus>0);
 const ret=await execute(f.admin,['returns'],{itemId:item.id,dropId:drop.id,collectionPointId:s.points[0].id});
 assert.equal((await snapshot(f.admin)).commerce.entitlements.length,0);
 await execute(f.admin,['returns',ret.id,'receive'],{});
 await execute(f.admin,['returns',ret.id,'simulate-inspection'],{});
 s=await snapshot(f.admin);drop=s.drops.find(d=>d.id===drop.id)!;
 const accepted=s.returns.find(r=>r.id===ret.id)!;
 assert.equal(s.balance,100+preview.reward.bonus);assert.equal(s.commerce.entitlements.length,1);
 assert.equal(s.commerce.bounties.find(b=>b.dropId===drop.id)!.shortageKg,0);
 assert.equal(drop.material_ready,false);assert.equal(drop.eligible,false);
 await execute(f.admin,['drops',drop.id,'allocate-material'],{sourceId:accepted.source_id,requirementId:drop.requirements[0].id,kg:.8,requestKey:crypto.randomUUID()});
 s=await snapshot(f.admin);drop=s.drops.find(d=>d.id===drop.id)!;
 assert.equal(drop.material_ready,true);assert.equal(drop.demand_ready,false);assert.equal(drop.eligible,false);
 const checkout=await execute(f.admin,['drops',drop.id,'checkout'],{credits:0,requestKey:crypto.randomUUID()});
 await execute(f.admin,['preorders',checkout.preorder_id,'confirm'],cmd());
 s=await snapshot(f.admin);drop=s.drops.find(d=>d.id===drop.id)!;
 assert.equal(drop.orders,42);assert.equal(drop.demand_ready,true);assert.equal(drop.eligible,true);
 await execute(f.admin,['drops',drop.id,'unlock'],{});
 assert.equal((await snapshot(f.admin)).drops.find(d=>d.id===drop.id)!.phase,'unlocked');
});

test('database rejects forged checkout arithmetic, unlinked entitlements, and terminal-state revival',async()=>{
 const f=await fixture();await accept(f);let s=await snapshot(f.admin);
 const entitlement=s.commerce.entitlements[0],other=s.drops.find(d=>d.code==='DROP025')!;
 await assert.rejects(transaction(async c=>{await c.query("UPDATE discount_entitlements SET status='reserved' WHERE id=$1",[entitlement.id]);}),/requires a preorder/);
 await assert.rejects(transaction(async c=>{
  const key=crypto.randomUUID();await c.query("INSERT INTO accounting_commands(id,workspace_id,actor_id,reason) VALUES($1,$2,$3,'Forged discount regression')",[key,f.workspaceId,f.admin.id]);
  const p=(await c.query("INSERT INTO preorders(drop_id,user_id,unit_price,status) VALUES($1,$2,35,'pending') RETURNING id",[other.id,f.admin.id])).rows[0];
  await c.query("INSERT INTO checkout_records(workspace_id,user_id,preorder_id,price_cents,discount_cents,credit_cents,payable_cents,credits,credits_per_sgd,cap_percent,command_id) VALUES($1,$2,$3,3500,100,0,3400,0,100,25,$4)",[f.workspaceId,f.admin.id,p.id,key]);
 }),/incentive arithmetic/);
 await assert.rejects(transaction(async c=>{
  const key=crypto.randomUUID();await c.query("INSERT INTO accounting_commands(id,workspace_id,actor_id,reason) VALUES($1,$2,$3,'Forged exchange regression')",[key,f.workspaceId,f.admin.id]);
  const p=(await c.query("INSERT INTO preorders(drop_id,user_id,unit_price,status) VALUES($1,$2,35,'pending') RETURNING id",[other.id,f.admin.id])).rows[0];
  const debit=(await c.query("INSERT INTO reward_transactions(workspace_id,user_id,type,amount,reason,command_id) VALUES($1,$2,'redeem',-1,'Forged exchange regression',$3) RETURNING id",[f.workspaceId,f.admin.id,key])).rows[0];
  await c.query("INSERT INTO checkout_records(workspace_id,user_id,preorder_id,credit_transaction_id,price_cents,discount_cents,credit_cents,payable_cents,credits,credits_per_sgd,cap_percent,command_id) VALUES($1,$2,$3,$4,3500,0,500,3000,1,100,25,$5)",[f.workspaceId,f.admin.id,p.id,debit.id,key]);
 }),/incentive arithmetic/);
 const checkout=await execute(f.admin,['drops',f.drop.id,'checkout'],{credits:0,requestKey:crypto.randomUUID()});
 await execute(f.admin,['preorders',checkout.preorder_id,'fail'],cmd());
 await assert.rejects(transaction(c=>c.query("UPDATE checkout_records SET status='reserved' WHERE id=$1",[checkout.id])),/Invalid checkout transition/);
});

test('material bonus budget follows expiration reversals and final correction through the full ledger chain',async()=>{
 const f=await transaction(c=>seedWorkspace(c,`Bonus lineage ${crypto.randomUUID()}`,'genuine_shortage'));
 let s=await snapshot(f.admin),drop=s.drops.find(d=>d.code==='DROP024')!;
 const item=await execute(f.admin,['consumer-items'],defaultItem);
 const ret=await execute(f.admin,['returns'],{itemId:item.id,dropId:drop.id,collectionPointId:s.points[0].id});
 await execute(f.admin,['returns',ret.id,'receive'],{});await execute(f.admin,['returns',ret.id,'simulate-inspection'],{});
 const bonus=await transaction(async c=>(await c.query("SELECT * FROM reward_transactions WHERE receipt_id=(SELECT id FROM return_receipts WHERE return_request_id=$1) AND type='material_bonus'",[ret.id])).rows[0]);
 assert.ok(bonus.amount>0);
 const expiry=await execute(f.admin,['rewards',bonus.id,'expire'],{...cmd(),amount:30});
 await execute(f.admin,['rewards',expiry.id,'reverse'],cmd());
 let balance=await transaction(async c=>Number((await c.query('SELECT balance FROM material_bonus_balances WHERE root_id=$1',[bonus.id])).rows[0].balance));
 assert.equal(balance,bonus.amount);
 await execute(f.admin,['returns',ret.id,'correct'],cmd());
 balance=await transaction(async c=>Number((await c.query('SELECT balance FROM material_bonus_balances WHERE root_id=$1',[bonus.id])).rows[0].balance));
 assert.equal(balance,0);assert.equal((await snapshot(f.admin)).returns.find(r=>r.id===ret.id)!.reward_bonus,0);
});
