import { loadData } from '@/lib/importer';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  try{return Response.json(await loadData(),{headers:{'Cache-Control':'no-store'}});}
  catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось прочитать Excel.'},{status:500});}
}
