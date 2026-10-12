import { readPublicContent } from "../../../../lib/catalog/content.ts";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({data:await readPublicContent("public_store_settings")},{headers:{"Cache-Control":"no-store"}}); }
  catch { return Response.json({error:{code:"UNAVAILABLE"}},{status:503,headers:{"Cache-Control":"no-store"}}); }
}
