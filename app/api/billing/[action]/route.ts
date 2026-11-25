import {billingHandlers} from "../../../../lib/billing";

type Context={params:Promise<{action:string}>};

export async function GET(request:Request,{params}:Context){
 const {action}=await params;
 if(action==="status")return billingHandlers().status(request);
 return new Response(null,{status:404});
}

export async function POST(request:Request,{params}:Context){
 const {action}=await params;
 if(action==="webhook")return billingHandlers().webhook(request);
 if(action==="checkout"||action==="confirm"||action==="portal"||action==="restore"||action==="claim")
  return billingHandlers().browser(request,action);
 return new Response(null,{status:404});
}
