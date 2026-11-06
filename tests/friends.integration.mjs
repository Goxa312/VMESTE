import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const social = "/api/account/friends", suffix = randomUUID().slice(0,8);
const owned = [];
async function call(path, session, data, options = {}) {
  const response = await fetch(base + path, { method: data ? "POST" : "GET", ...options, headers: {
    Connection:"close", ...(session && {Cookie:session}), ...(data && {"Content-Type":"application/json"}), ...options.headers,
  }, body:data && JSON.stringify(data) });
  const raw=await response.text();
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw Error((options.method || (data ? "POST" : "GET"))+" "+path+" "+(data?.action || "")+" returned "+response.status+" "+raw.slice(0,120));
  return { status:response.status, body:JSON.parse(raw), cookie:response.headers.get("set-cookie")?.split(";")[0] };
}
async function register(login) {
  const password = randomUUID(), email = "qa_" + randomUUID().slice(0,8) + "@example.test";
  const r = await call("/api/account", null, {action:"register", login, email, password, passwordConfirmation:password});
  assert.equal(r.status,201); return {login,password,email,session:r.cookie};
}
async function room(user) {
  const r = await call("/api/rooms",user.session,{title:"Invitation test",roomTitle:"QA "+suffix,url:"https://example.org/test"});
  assert.equal(r.status,201); owned.push([r.body.room.id,r.body.token,user.session]); return r.body.room.id;
}
const change = (user, action, fields) => call(social,user.session,{action,...fields});
const view = async (user, extra="") => {const r = await call(social+extra,user.session); assert.equal(r.status,200);return r.body;};
const a=await register("Кино_"+suffix), b=await register("screen_"+suffix), c=await register("third_"+suffix);
try {
  assert.equal((await call(social)).status,401);
  assert.equal((await call(social,null,{action:"request",login:b.login})).status,401);
  assert.equal((await call(social,a.session,{action:"request",login:b.login},{headers:{Origin:"https://other.invalid"}})).status,403);
  assert.equal((await change(a,"request",{login:a.login})).status,400);
  assert.equal((await change(a,"request",{login:"missing_"+suffix})).status,404);
  assert.equal((await change(a,"request",{login:b.email})).status,400);
  const theater = await room(a);
  await Promise.all([change(a,"request",{login:b.login.toUpperCase()}),change(a,"request",{login:b.login})]);
  const incoming = (await view(b,"?inbox=1")).people;
  assert.equal(incoming.length,1); const id = incoming[0].id;
  assert.deepEqual([incoming[0].name,incoming[0].state],[a.login,"incoming"]);
  assert.equal((await change(b,"request",{login:a.login.toUpperCase()})).status,200);
  assert.equal((await view(b)).people[0].state,"incoming");
  assert.equal((await view(a,"?inbox=1")).people.length,0);
  assert.equal((await change(a,"accept",{id})).status,409);
  assert.equal((await change(c,"accept",{id})).status,409);
  assert.equal((await change(a,"invite",{id,room:theater})).status,403);
  await change(b,"decline",{id}); assert.equal((await view(a)).people.length,0);
  await change(a,"request",{login:b.login});
  const withdrawn = (await view(a)).people[0].id;
  await change(a,"cancel",{id:withdrawn}); assert.equal((await view(b)).people.length,0);
  await Promise.all([change(a,"request",{login:b.login}),change(b,"request",{login:a.login})]);
  const [ap,bp] = await Promise.all([view(a),view(b)]);
  assert.equal(ap.people.length,1); assert.equal(bp.people.length,1); assert.equal(ap.people[0].id,bp.people[0].id);
  const relation = ap.people[0].id;
  const recipient = ap.people[0].state==="incoming"?a:b;
  assert.equal((await change(recipient,"accept",{id:relation})).status,200);
  await change(a,"cancel",{id:withdrawn}); await change(c,"remove",{id:relation});
  assert.equal((await view(a)).people[0].state,"friend");
  assert.equal((await change(recipient,"decline",{id:relation})).status,409);
  console.log("PASS exact usernames, duplicate and crossed requests, consent, decline, withdraw and stale actions");

  assert.equal((await call(social+"?room="+theater,c.session)).status,403);
  assert.equal((await change(b,"invite",{id:relation,room:theater})).status,403);
  const otherRoom=await room(c);
  assert.equal((await change(c,"invite",{id:relation,room:otherRoom})).status,403);
  const sent=await Promise.all([change(a,"invite",{id:relation,room:theater}),change(a,"invite",{id:relation,room:theater})]);
  assert.deepEqual(sent.map(r=>r.status),[200,200]);
  assert.equal((await view(a,"?room="+theater)).people[0].invited,1);
  const inbox=await view(b,"?inbox=1");
  assert.equal(inbox.invitations.length,1);
  const invite=inbox.invitations[0];
  assert.deepEqual([invite.room,invite.sender],[theater,a.login]);
  assert.equal((await call("/api/rooms/"+theater,c.session,{invitationId:invite.id})).status,410);
  assert.equal((await call("/api/rooms/"+theater,null,{invitationId:invite.id,name:"Intruder"})).status,403);
  assert.equal((await call("/api/rooms/"+otherRoom,b.session,{invitationId:invite.id})).status,410);
  assert.equal((await view(c)).invitations.length,0);
  await change(c,"dismiss",{id:invite.id});assert.equal((await view(b)).invitations.length,1);
  for(const result of [inbox,ap,bp]) {
    assert.ok(!JSON.stringify(result).includes("@example.test"));
    assert.ok(!/password|recovery|token|email/.test(JSON.stringify(result)));
  }
  await change(b,"dismiss",{id:invite.id});
  assert.equal((await view(a,"?room="+theater)).people[0].invited,0);
  await change(a,"invite",{id:relation,room:theater}); await change(b,"remove",{id:relation});
  assert.deepEqual(await view(b),{people:[],invitations:[]});
  console.log("PASS only confirmed friends and signed room members can send; recipient-only inbox, deduplication and revocation");

  await change(a,"request",{login:b.login});
  const next=(await view(b)).people[0].id; assert.notEqual(next,relation);
  await change(b,"accept",{id:next});
  await change(a,"invite",{id:next,room:theater});
  const current=(await view(b)).invitations[0].id;
  const path="/api/rooms/"+theater;
  const guests=await Promise.all(Array.from({length:11},(_,i)=>call(path,null,{name:"Guest "+i})));
  assert.ok(guests.every(r=>r.status===201));
  assert.equal((await call(path,b.session,{invitationId:current})).status,409);
  assert.equal((await view(b)).invitations.length,1);
  await call(path,null,{action:"leave"},{method:"DELETE",headers:{Authorization:"Bearer "+guests[0].body.token}});
  const joined=await Promise.all([call(path,b.session,{invitationId:current}),call(path,b.session,{invitationId:current})]);
  assert.ok(joined.every(r=>r.status===200||r.status===201));
  assert.equal(joined[0].body.me,joined[1].body.me);
  assert.equal(joined[0].body.accountMember,true); assert.notEqual(joined[0].body.me,joined[0].body.room.hostId);
  assert.equal((await view(b)).invitations.length,0);
  const again=await call("/api/account",null,{action:"login",login:b.login,password:b.password});
  assert.equal(again.status,200);
  assert.equal((await call(path,again.cookie,{resume:true})).body.me,joined[0].body.me);
  const closed=await room(a);await change(a,"invite",{id:next,room:closed});
  const closedId=(await view(b)).invitations[0].id;
  await call("/api/rooms/"+closed,a.session,{action:"delete"},{method:"DELETE",headers:{Authorization:"Bearer "+owned.at(-1)[1]}});
  assert.equal((await view(b)).invitations.length,0);
  assert.ok([404,410].includes((await call("/api/rooms/"+closed,b.session,{invitationId:closedId})).status));
  console.log("PASS full rooms retain invitations; one-click and concurrent joins, later login, closed-room invitations");
} finally {
  for(const [code,token,session] of owned)await call("/api/rooms/"+code,session,{action:"delete"},{method:"DELETE",headers:{Authorization:"Bearer "+token}}).catch(()=>{});
}
