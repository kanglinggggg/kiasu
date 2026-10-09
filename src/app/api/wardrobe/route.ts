import { geminiAvailable, handleScan } from '@/lib/ai/gemini-provider';
export const runtime='nodejs';
export function GET(){return Response.json({gemini:geminiAvailable()},{headers:{'Cache-Control':'no-store'}});}
export function POST(request:Request){return handleScan(request);}
