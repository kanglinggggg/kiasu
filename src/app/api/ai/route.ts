import {connectedAvailable,requestStructured} from '@/lib/ai/server-provider';
import {confirmInventory,objectValue,parseInventory} from '@/lib/ai/inventory-analysis';
import {parseSuggestions} from '@/lib/ai/concept-generator';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({connected:connectedAvailable()},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Cross-origin requests are not supported.'},{status:403});
 if(Number(request.headers.get('content-length')??0)>3000000)return Response.json({error:'Input is too large.'},{status:413});
 try{
  const text=await request.text();if(text.length>3000000)return Response.json({error:'Input is too large.'},{status:413});
  const body=objectValue(JSON.parse(text));
  if(!['inventory','concepts'].includes(String(body.task)))return Response.json({error:'Unknown AI task.'},{status:400});
  if(!connectedAvailable())return Response.json({error:'Connected AI is not configured. Choose Demo AI.'},{status:503});
  if(body.task==='inventory'){
   const input=objectValue(body.input);const fields=['description','notes','csv'].map(k=>typeof input[k]==='string'?input[k] as string:'');
   if(fields.some(s=>s.length>6000))return Response.json({error:'Keep each text field under 6,000 characters.'},{status:400});
   const image=typeof input.image==='string'?input.image:undefined;
   if(image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>2800000))return Response.json({error:'Use a PNG, JPEG or WebP image up to 2 MB.'},{status:400});
   if(!fields.some(s=>s.trim())&&!image)return Response.json({error:'Provide a description, notes, CSV row or image.'},{status:400});
   return Response.json({mode:'connected',result:parseInventory(await requestStructured('inventory',JSON.stringify({description:fields[0],notes:fields[1],csv:fields[2]}),image))});
  }
  const raw=objectValue(body.batch);
  const batch=confirmInventory({productType:String(raw.product??''),quantity:String(raw.quantity??''),material:String(raw.material??''),condition:String(raw.condition??''),weight:raw.weight==null?'':String(raw.weight),price:String(raw.price??'')});
  const target=typeof body.target==='string'?body.target.trim().slice(0,120):'Everyday consumers';
  // Deliberately omit economic parameters and all computed engine results.
  return Response.json({mode:'connected',result:parseSuggestions(await requestStructured('concepts',JSON.stringify({sourceProduct:batch.product,material:batch.material,condition:batch.condition,availableQuantity:batch.quantity,target}))) });
 }catch(error){
  const message=error instanceof Error?error.message:'Unable to analyse this input.';
  // Never expose raw provider responses, credentials or stack traces.
  return Response.json({error:message.startsWith('Connected AI')?message:'The AI response could not be used. Review your input, retry, or switch to Demo AI.'},{status:422});
 }
}
