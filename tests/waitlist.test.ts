import assert from "node:assert/strict";
import test from "node:test";
import { POST as waitlistRoute } from "../app/api/waitlist/route";
import { GET as adminWaitlistRoute } from "../app/api/admin/waitlist/route";
import { db } from "../lib/database";

const request=(body:unknown)=>new Request("https://startfund.test/api/waitlist",{
 method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
});

test("waitlist stores normalized emails once and exposes them only to operators",async()=>{
 const valid=await waitlistRoute(request({email:"builder@example.com"}));
 assert.equal(valid.status,201);
 assert.deepEqual(await valid.json(),{state:"joined"});
 const duplicate=await waitlistRoute(request({email:"BUILDER@example.com"}));
 assert.equal(duplicate.status,200);
 assert.deepEqual(await duplicate.json(),{state:"existing"});
 const rows=await (await db()).all("SELECT email FROM waitlist_signups WHERE email=?","builder@example.com");
 assert.equal(rows.length,1);

 const denied=await adminWaitlistRoute(new Request("https://startfund.test/api/admin/waitlist"));
 assert.equal(denied.status,404);
 process.env.RADAR_ADMIN_TOKEN="test-only-admin-token-with-32-bytes";
 const allowed=await adminWaitlistRoute(new Request("https://startfund.test/api/admin/waitlist",{
  headers:{authorization:"Bearer test-only-admin-token-with-32-bytes"},
 }));
 assert.equal(allowed.status,200);
 const body=await allowed.json();
 assert.ok(body.entries.some((entry:{email:string})=>entry.email==="builder@example.com"));
 delete process.env.RADAR_ADMIN_TOKEN;
});
