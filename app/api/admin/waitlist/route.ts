import { isAdmin } from "../../../../lib/admin";
import { waitlistEntries } from "../../../../lib/waitlist";

export async function GET(request:Request){
 if(!isAdmin(request.headers))return new Response(null,{status:404});
 return Response.json({entries:await waitlistEntries()},{headers:{"Cache-Control":"no-store"}});
}
