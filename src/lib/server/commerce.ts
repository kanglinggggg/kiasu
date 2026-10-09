import { z } from 'zod';
import { PoolClient } from 'pg';
import { Actor, assertDomain, owns, role, compatibility } from './domain';
import { one, getDrop, audit } from './service';
import { command, reverseReward } from './accounting';
import { checkoutQuote, materialShortage, demandBonus, commercePolicy } from '../commerce-engine';
import { qualityCompatible } from '../material-quality';
import { id } from './validation';
const request=z.object({requestKey:id}).strict();

export async function reconcileCheckout(c:PoolClient,a:Actor,preorderId:string,next:string,key:string){
 const record=(await c.query('SELECT * FROM checkout_records WHERE preorder_id=$1 FOR UPDATE',[preorderId])).rows[0];
 if(!record)return;
 if(next==='confirmed'){
  assertDomain(record.status==='reserved'&&new Date(record.expires_at)>new Date(),'Checkout expired or is no longer reserved. Cancel it to restore credits.');
  if(record.entitlement_id){const e=await one(c,'SELECT * FROM discount_entitlements WHERE id=$1 FOR UPDATE',[record.entitlement_id]);assertDomain(e.status==='reserved'&&new Date(e.expires_at)>new Date(),'Return discount expired. Cancel this checkout.');await c.query("UPDATE discount_entitlements SET status='redeemed' WHERE id=$1",[e.id]);}
 }else if(['cancelled','failed','refunded'].includes(next)){
  // Refund is a later accounting state after cancellation. Credits and the
  // entitlement were already restored by cancellation, so only advance the
  // checkout record and retain the original reversal trail.
  if(record.status==='cancelled'&&next==='refunded'){
   await c.query('UPDATE checkout_records SET status=$2 WHERE id=$1',[record.id,next]);
   await audit(c,a,'checkout_'+next,'checkout',record.id,{preorderId,simulated:true});
   return;
  }
  if(['cancelled','failed','refunded'].includes(record.status))return;
  await c.query('UPDATE checkout_records SET status=$2 WHERE id=$1',[record.id,next]);
  if(record.credit_transaction_id)await reverseReward(c,a,record.credit_transaction_id,key);
  if(record.entitlement_id)await c.query("UPDATE discount_entitlements SET status=CASE WHEN expires_at>now() AND NOT EXISTS(SELECT 1 FROM return_corrections WHERE receipt_id=discount_entitlements.receipt_id) THEN 'available' ELSE 'revoked' END,preorder_id=NULL WHERE id=$1 AND status IN ('reserved','redeemed')",[record.entitlement_id]);
 }else return;
 if(next==='confirmed')await c.query('UPDATE checkout_records SET status=$2 WHERE id=$1',[record.id,next]);
 await audit(c,a,'checkout_'+next,'checkout',record.id,{preorderId,simulated:true});
}
export async function executeCommerce(c:PoolClient,a:Actor,path:string[],raw:unknown){
 const [resource,dropId,action]=path;
 if(resource!=='drops'||!['checkout','waitlist'].includes(action))return undefined;
 role(a,'consumer');const d=await getDrop(c,a.workspace_id,dropId,a.id);
 assertDomain(d.phase==='market_test','This market test is closed.');
 if(action==='waitlist'){
  const v=request.parse(raw);await command(c,a,{...v,reason:'Join unpaid waitlist'});
  const row=await one(c,'INSERT INTO waitlist_entries(workspace_id,drop_id,user_id,command_id) VALUES($1,$2,$3,$4) RETURNING *',[a.workspace_id,dropId,a.id,v.requestKey]);
  await audit(c,a,'waitlist_joined','waitlist',row.id,{dropId,confirmed:false});return row;
 }
 const v=request.extend({credits:z.number().int().min(0).max(1000000).default(0),entitlementId:id.optional()}).strict().parse(raw);
 const ceiling=Math.min(d.maximum_capacity,...d.auxiliary.map(r=>r.capacity));
 const pending=await one(c,"SELECT count(*) n FROM preorders WHERE drop_id=$1 AND status='pending'",[dropId]);
 assertDomain(d.orders+pending.n<ceiling,'This batch is fully reserved. Join the unpaid waitlist.');
 const key=await command(c,a,{requestKey:v.requestKey,reason:'Reserve simulated checkout'});
 const policy=(await c.query('SELECT * FROM commerce_policies WHERE workspace_id=$1',[a.workspace_id])).rows[0];
 const balance=await one(c,'SELECT COALESCE(sum(amount),0) n FROM reward_transactions WHERE user_id=$1',[a.id]);
 let discount=0;
 if(v.entitlementId){const e=await one(c,'SELECT * FROM discount_entitlements WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[v.entitlementId,a.workspace_id]);owns(a,e.user_id);assertDomain(e.user_id===a.id&&e.status==='available'&&new Date(e.expires_at)>new Date()&&e.eligible_recipes.includes(d.recipe_key),'Discount is unavailable or not eligible for this product.');discount=e.percent;}
 const quote=checkoutQuote({priceCents:Math.round(d.selling_price*100),credits:v.credits,balance:balance.n,discountPercent:discount,creditsPerSgd:policy?.credits_per_sgd??100,capPercent:policy?.stack_cap_percent??25});
 const order=await one(c,"INSERT INTO preorders(drop_id,user_id,unit_price,status) VALUES($1,$2,$3,'pending') RETURNING id",[dropId,a.id,d.selling_price]);
 let ledgerId=null;
 if(v.credits){ledgerId=(await one(c,"INSERT INTO reward_transactions(workspace_id,user_id,type,amount,reason,command_id) VALUES($1,$2,'redeem',$3,'Credits reserved for simulated checkout',$4) RETURNING id",[a.workspace_id,a.id,-v.credits,key])).id;await audit(c,a,'checkout_credits_reserved','reward_transaction',ledgerId,{credits:v.credits});}
 const record=await one(c,'INSERT INTO checkout_records(workspace_id,user_id,preorder_id,entitlement_id,credit_transaction_id,price_cents,discount_cents,credit_cents,payable_cents,credits,credits_per_sgd,cap_percent,command_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[a.workspace_id,a.id,order.id,v.entitlementId??null,ledgerId,quote.priceCents,quote.discountCents,quote.creditCents,quote.payableCents,v.credits,policy?.credits_per_sgd??100,policy?.stack_cap_percent??25,key]);
 if(v.entitlementId)await c.query("UPDATE discount_entitlements SET status='reserved',preorder_id=$2 WHERE id=$1",[v.entitlementId,order.id]);
 await audit(c,a,'checkout_reserved','checkout',record.id,{preorderId:order.id,...quote});return record;
}
export async function compatibleStock(c:PoolClient,a:Pick<Actor,'workspace_id'>,req:any,brandId:string,excludeReceipt?:string){
 const rows=(await c.query(`SELECT s.* FROM source_balances s
  JOIN source_brand_ownership o ON o.source_id=s.id
  WHERE s.workspace_id=$1 AND o.brand_id=$2 AND s.remaining_kg>0
    AND (s.receipt_id IS NULL OR s.receipt_id::text<>$3)`,[a.workspace_id,brandId,excludeReceipt??''])).rows;
 return rows.filter(s=>compatibility(s.material_type,req).compatible&&qualityCompatible(s,req.accepted_grades)).reduce((sum,s)=>sum+s.remaining_kg,0);
}
export async function commerceSnapshot(c:PoolClient,a:Actor,drops:any[]){
 const entitlements=(await c.query('SELECT * FROM discount_entitlements WHERE user_id=$1 ORDER BY created_at DESC',[a.id])).rows;
 const checkouts=(await c.query('SELECT cr.*,d.code,d.id drop_id FROM checkout_records cr JOIN preorders p ON p.id=cr.preorder_id JOIN drops d ON d.id=p.drop_id WHERE cr.user_id=$1 ORDER BY cr.created_at DESC',[a.id])).rows;
 const waitlist=(await c.query("SELECT drop_id,count(*) total,bool_or(user_id=$2) mine FROM waitlist_entries WHERE workspace_id=$1 AND status='active' GROUP BY drop_id",[a.workspace_id,a.id])).rows;
 const policy=(await c.query('SELECT * FROM commerce_policies WHERE workspace_id=$1',[a.workspace_id])).rows[0]??{credits_per_sgd:100,stack_cap_percent:25,bonus_budget:10000};
 const spent=await one(c,"SELECT COALESCE(sum(balance),0) total FROM material_bonus_balances WHERE workspace_id=$1",[a.workspace_id]);
 const bounties=[];
 // Each brand's authorized stock is consumed virtually once, in demand order.
 // Private inventory is never treated as another brand's available supply.
 const allStock=(await c.query(`SELECT s.*,o.brand_id FROM source_balances s
  JOIN source_brand_ownership o ON o.source_id=s.id
  WHERE s.workspace_id=$1 AND s.remaining_kg>0 ORDER BY s.created_at,s.id`,[a.workspace_id])).rows;
 const stockByBrand=new Map<string,any[]>();
 for(const row of allStock){const rows=stockByBrand.get(row.brand_id)??[];rows.push({...row,left:row.remaining_kg});stockByBrand.set(row.brand_id,rows);}
 for(const d of [...drops].filter(d=>d.phase==='market_test').sort((a,b)=>b.orders-a.orders||a.id.localeCompare(b.id))){
  const stockRows=stockByBrand.get(d.brand_id)??[];
  const waitlistTotal=waitlist.find(w=>w.drop_id===d.id)?.total??0;
  // A material campaign needs a real demand signal. An empty market test must
  // not manufacture a shortage simply by aiming at its minimum batch size.
  if(d.orders+d.reservations+waitlistTotal===0)continue;
  for(const req of d.requirements){
   let gap=Math.max(0,req.required_kg-req.allocated_kg),stock=0;
   for(const s of stockRows){if(compatibility(s.material_type,req).compatible&&qualityCompatible(s,req.accepted_grades)){const used=Math.min(gap,s.left);gap-=used;stock+=used;s.left-=used;}}
   const shortage=materialShortage(req.required_kg,req.allocated_kg,stock);
   bounties.push({dropId:d.id,code:d.code,name:d.name,material:req.material_type,grades:req.accepted_grades,requiredKg:req.required_kg,allocatedKg:req.allocated_kg,availableStockKg:stock,shortageKg:shortage,orders:d.orders,reservations:d.reservations,waitlist:waitlistTotal,bonus:demandBonus(100,shortage,d.orders,d.reservations,waitlistTotal,policy.bonus_budget-spent.total)});
  }
 }
 const community=await one(c,`SELECT count(*) accepted_returns,COALESCE(sum(rr.verified_material_kg),0) recovered_kg,count(DISTINCT r.user_id) contributors FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id WHERE r.workspace_id=$1 AND rr.inspection_result<>'rejected' AND NOT EXISTS(SELECT 1 FROM return_corrections rc WHERE rc.receipt_id=rr.id)`,[a.workspace_id]);
 const production=await one(c,"SELECT COALESCE(sum(p.confirmed_units),0) products,count(DISTINCT p.drop_id) fulfilled FROM production_runs p JOIN drops d ON d.id=p.drop_id WHERE d.workspace_id=$1 AND p.status='completed'",[a.workspace_id]);
 const residual=await one(c,"SELECT COALESCE(sum(remaining_kg),0) kg FROM source_balances WHERE workspace_id=$1 AND source_type='residual_material'",[a.workspace_id]);
 const privateBrand=a.role==='brand_user'?a.brand_id:null;
 const locations=a.role==='consumer'?[]:(await c.query(`SELECT cp.name,rr.verified_material_type material,sum(rr.verified_material_kg) kg
  FROM return_receipts rr JOIN return_requests r ON r.id=rr.return_request_id
  JOIN drops d ON d.id=r.target_drop_id JOIN collection_points cp ON cp.id=r.collection_point_id
  WHERE r.workspace_id=$1 AND ($2::uuid IS NULL OR d.brand_id=$2) AND rr.inspection_result<>'rejected'
    AND NOT EXISTS(SELECT 1 FROM return_corrections WHERE receipt_id=rr.id)
  GROUP BY cp.name,rr.verified_material_type`,[a.workspace_id,privateBrand])).rows;
 let sales:{gmv_cents:number;discount_cents:number;credit_cents:number;net_cents:number;scope:string};
 if(a.role==='consumer')sales={gmv_cents:0,discount_cents:0,credit_cents:0,net_cents:0,scope:'not_exposed'};
 else{
  const totals=await one(c,`SELECT COALESCE(sum(round(p.unit_price*100)),0) gmv_cents,
      COALESCE(sum(cr.discount_cents),0) discount_cents,COALESCE(sum(cr.credit_cents),0) credit_cents,
      COALESCE(sum(COALESCE(cr.payable_cents,round(p.unit_price*100))),0) net_cents
    FROM preorders p JOIN drops d ON d.id=p.drop_id LEFT JOIN checkout_records cr ON cr.preorder_id=p.id
    WHERE d.workspace_id=$1 AND ($2::uuid IS NULL OR d.brand_id=$2) AND p.status='confirmed'`,[a.workspace_id,privateBrand]);
  sales={gmv_cents:Number(totals.gmv_cents),discount_cents:Number(totals.discount_cents),credit_cents:Number(totals.credit_cents),net_cents:Number(totals.net_cents),scope:privateBrand?'brand':'workspace_admin'};
 }
 return {entitlements,checkouts,waitlist,bounties,policy,community:{accepted_returns:Number(community.accepted_returns),recovered_kg:Number(community.recovered_kg),contributors:Number(community.contributors),products:Number(production.products),fulfilled:Number(production.fulfilled),residual_kg:residual.kg,confirmed_preorders:drops.reduce((sum,d)=>sum+d.orders,0)},locations,sales};
}
export type CommerceSnapshot=Awaited<ReturnType<typeof commerceSnapshot>>;
