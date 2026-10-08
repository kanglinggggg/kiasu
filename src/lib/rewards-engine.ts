import {ConsumerItem,MaterialContribution} from './return-engine';
import {matchMaterial} from './material-match-engine';
export function calculateRecoveryReward(kg:number,score:number,needed:number,orders:number){const eligible=[kg,score,needed,orders].every(Number.isFinite)&&kg>0&&score>0&&needed>0;const base=eligible?Math.round(100*Math.min(1,Math.min(kg,needed)/.8)):0,bonus=orders>=32?Math.round(base*.8):0;return {base,bonus,total:base+bonus};}
export function calculateRewards(item:ConsumerItem,pool:MaterialContribution[],preorders:number){
 const match=matchMaterial(item,pool);
 if(!match.eligible)return {base:0,bonus:0,total:0,discountPercent:0,earlyAccess:false};
 const base=Math.round(100*Math.min(1,match.allocatedKg/0.8));
 const bonus=preorders>=32?Math.round(base*0.8):0;
 return {base,bonus,total:base+bonus,discountPercent:bonus>0?10:0,earlyAccess:bonus>0};
}
