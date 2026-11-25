import test from "node:test";
import assert from "node:assert/strict";
import {createBetaInvite,redeemBetaInvite,verifyBetaSession,betaSessionCookie,betaCookie} from "../lib/beta-auth";
import {db} from "../lib/database";

process.env.RADAR_DB_PATH=":memory:";

test("one-time invite redeems once and produces a signed beta session",async()=>{
 const invite=await createBetaInvite("test invite");
 assert.match(invite.code,/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
 const attempts=await Promise.all([redeemBetaInvite(invite.code),redeemBetaInvite(invite.code.replace(/-/g,""))]);
 assert.equal(attempts.filter(Boolean).length,1);
 const session=attempts.find(Boolean);
 assert.ok(session);
 assert.ok(await verifyBetaSession(session.value));
 assert.equal(await verifyBetaSession(session.value.slice(0,-1)+(session.value.endsWith("A")?"B":"A")),null);
 assert.equal(await redeemBetaInvite(invite.code),null);
 const [stored]=await (await db()).all("SELECT code_hash,used,note FROM beta_invites WHERE id=?",session.invite);
 assert.equal(String(stored.code_hash).length,64);
 assert.ok(Number(stored.used)>0);
 assert.equal(stored.note,"test invite");
 const cookie=betaSessionCookie(new Request("https://startfund.test/"),session.value,session.expires);
 assert.ok(cookie.startsWith(betaCookie+"="));
 assert.match(cookie,/HttpOnly; SameSite=Lax/);
 assert.match(cookie,/Secure/);
});

test("wrong and malformed invite codes never redeem",async()=>{
 assert.equal(await redeemBetaInvite("WRONG-CODE-WRONG1"),null);
 assert.equal(await redeemBetaInvite("short"),null);
 assert.equal(await verifyBetaSession(undefined),null);
 assert.equal(await verifyBetaSession("v1.bad"),null);
});
