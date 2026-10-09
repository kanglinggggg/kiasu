import {CheckCircle2,Layers3} from 'lucide-react';
import {Batch,money} from '@/lib/mock-data';
import {Concept} from '@/lib/remix-engine';
import {calculateEconomics} from '@/lib/economics';
import {SectionTitle} from './ui';
export function ImpactView({batch,concept,orders,onReturn}:{batch:Batch;concept:Concept;orders:number;onReturn:()=>void}){
 const e=calculateEconomics(concept,orders);
 const metrics=[
  {value:String(batch.quantity),label:`surplus ${batch.product.toLowerCase()} assessed`,detail:'Assessed inventory, not measured diversion'},
  {value:`${concept.utilisation}%`,label:'estimated material utilisation',detail:`Prototype design estimate · ${concept.name}`},
  {value:String(e.confirmedOrders),label:'confirmed pre-orders before production',detail:'Current simulated order count'},
  {value:money(e.committedGrossSales),label:'committed gross sales',detail:`${e.confirmedOrders} × ${money(concept.price)} · not profit`},
  {value:String(concept.max),label:'maximum production',detail:'Material-constrained units'},
  {value:money(e.maximumGrossSales),label:'maximum potential gross sales',detail:`${concept.max} × ${money(concept.price)} · only if all sell`},
  {value:'0',label:'speculative Remix units produced before demand validation',detail:'No physical production takes place in this demo'}
 ];
 return <><SectionTitle eyebrow="05 / BATCH SUMMARY" title={e.unlocked?'Orders and materials confirmed.':'Review this batch.'} description="Sales totals use the confirmed order count for the selected design."/><div className="impact-hero" role="status"><div className="impact-icon">{e.unlocked?<CheckCircle2 size={46}/>:<Layers3 size={46}/>}</div><div><span className="eyebrow">{concept.name.toUpperCase()} / DROP 017</span><h2>{e.unlocked?'PRODUCTION UNLOCKED':e.feasible?'AWAITING CONFIRMED DEMAND':'INSUFFICIENT MATERIAL CAPACITY'}</h2><p>{e.confirmedOrders} / {concept.threshold} confirmed pre-orders · Maximum {concept.max}</p></div><button className="white-button" onClick={onReturn}>Return to the drop</button></div><div className="impact-grid">{metrics.map(m=><div className="metric" key={m.label}><strong>{m.value}</strong><h3>{m.label}</h3><span>{m.detail}</span></div>)}</div><div className="callout"><Layers3 size={23}/><span><strong>{e.confirmedOrders} × {money(concept.price)} = {money(e.committedGrossSales)} committed gross sales</strong><br/>Estimated production cost for those units: {money(e.estimatedProductionCost)}. Setup, logistics, platform fees, returns and other costs are not included; no profit is claimed.</span></div><div className="manifesto"><span className="eyebrow">BEFORE PRODUCTION</span><h2>Use existing material.<br/><span>Confirm demand.</span><br/>Produce when both are ready.</h2></div><p className="fine-print">These are estimates, not measured environmental results. Assessing stock does not prove waste diversion: that requires material records, maker confirmation and a disposal baseline. Preorders are simulated; no payment is collected.</p></>;
}
