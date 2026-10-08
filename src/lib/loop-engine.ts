import {Batch} from './mock-data';
import {materialEstimate} from './remix-engine';
import {ConsumerItem,MaterialContribution,ReturnReservation,confirmItem,recommendAction,receiveReturn,returnDeadline,collectionPoints} from './return-engine';
import {loopRecipe,loopCapacity,totalKg} from './material-match-engine';
import {calculateUnlock} from './unlock-engine';
import {matchMaterial} from './material-match-engine';
import {calculateRewards} from './rewards-engine';
import {calculateRoutes} from './circular-engine';
export function seedPool(batch:Batch):MaterialContribution[]{
 // DROP017 and DROP024 are alternative demo allocations, never simultaneous production runs.
 const kg=batch.material==='Cotton Denim'&&calculateRoutes(batch).recommendation==='Remix'?Math.min(60,materialEstimate(batch).effectiveKg):0;
 return [{id:'brand-D102',source:'brand_surplus',sourceId:'D102',kg:Math.round(kg*1000)/1000,items:0},{id:'community-seed',source:'consumer_return',sourceId:'simulated-prior-returns',kg:7.2,items:9}];
}
export function loopSummary(pool:MaterialContribution[],preorders:number,completed=false){
 const kg=totalKg(pool),capacity=loopCapacity(pool);
 const unlock=calculateUnlock({preorders,preorderThreshold:42,recoveredKg:kg,materialThresholdKg:68,capacity});
 const produced=completed&&unlock.unlocked?preorders:0;
 return {...unlock,kg,capacity,preorders,grossSales:preorders*loopRecipe.price,produced,residualKg:Math.round((kg-produced*loopRecipe.kgPerUnit)*1000)/1000,communityReturns:pool.filter(p=>p.source==='consumer_return').reduce((n,p)=>n+p.items,0)};
}
export function demandIntelligence(pool:MaterialContribution[],orders:number){
 const capacity=loopCapacity(pool);
 // Confirmed orders cap the next batch; preferences are descriptive, not order substitutes.
 const next=Math.min(Math.max(0,Math.floor(orders)),capacity);
 return {capacity,nextBatch:next,availableKg:totalKg(pool),demand:orders>=42?'High':'Building',darkDenimPercent:68,pocketPercent:54};
}
export type LoopState={pool:MaterialContribution[];orders:number;ordered:boolean;reservation:ReturnReservation|null;completed:boolean};
export function createLoopState(batch:Batch):LoopState{return {pool:seedPool(batch),orders:41,ordered:false,reservation:null,completed:false};}
export function reserveItem(state:LoopState,item:ConsumerItem,location:string):LoopState{
 if(state.reservation||state.completed)return state;
 const confirmed=confirmItem(item),match=matchMaterial(confirmed,state.pool),reward=calculateRewards(confirmed,state.pool,state.orders);
 if(recommendAction(confirmed).action!=='RETURN FOR REMIX'||!match.eligible||!collectionPoints.includes(location as typeof collectionPoints[number]))return state;
 return {...state,reservation:{id:'R1042',item:confirmed,estimatedKg:match.estimatedRecoverableKg,allocatedKg:0,credits:reward.total,bonus:reward.bonus,discountPercent:reward.discountPercent,earlyAccess:reward.earlyAccess,status:'Reserved',location,returnBy:returnDeadline()}};
}
export function confirmReceipt(state:LoopState):LoopState{
 if(!state.reservation||state.reservation.status==='Received'||state.completed)return state;
 const match=matchMaterial(state.reservation.item,state.pool);
 if(!match.eligible)return state;
 const reward=calculateRewards(state.reservation.item,state.pool,state.orders);
 const result=receiveReturn({...state.reservation,credits:reward.total,bonus:reward.bonus,discountPercent:reward.discountPercent,earlyAccess:reward.earlyAccess},state.pool,match.materialStillNeededKg);
 return {...state,...result};
}
export function placeLoopOrder(state:LoopState):LoopState{
 if(state.ordered||state.completed||state.orders>=loopCapacity(state.pool))return state;
 return {...state,orders:state.orders+1,ordered:true};
}
export function completeLoop(state:LoopState):LoopState{return loopSummary(state.pool,state.orders).unlocked?{...state,completed:true}:state;}
