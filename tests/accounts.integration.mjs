import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
async function request(path,{data,cookie,token,origin,method}={}) {
  const res=await fetch(base+path,{method:method || (data?"POST":"GET"),headers:{
    Connection:"close", ...(data&&{"Content-Type":"application/json"}),...(cookie&&{Cookie:cookie}),...(token&&{Authorization:"Bearer "+token}),...(origin&&{Origin:origin}),
  },body:data?JSON.stringify(data):undefined});
  const set=res.headers.get("set-cookie") || "";
  return {status:res.status,body:await res.json(),set,cookie:set.split(";")[0]};
}
const account="/api/account", login="test_"+randomUUID().slice(0,8), password=randomUUID();
const credentials={login,password};
assert.equal((await request(account)).body.user,null);
assert.equal((await request(account,{data:{action:"register",...credentials},origin:"https://elsewhere.example"})).status,403);
assert.equal((await request(account,{data:{action:"register",login,password:"short"}})).status,400);
const first=await request(account,{data:{action:"register",...credentials}});
assert.equal(first.status,201);
assert.match(first.set,/HttpOnly/i); assert.match(first.set,/SameSite=Lax/i);
assert.equal((await request(account,{data:{action:"register",...credentials}})).status,409);
assert.equal((await request(account,{data:{action:"login",login,password:"another-password-1"}})).status,401);
const second=await request(account,{data:{action:"login",login:login.toUpperCase(),password}});
assert.equal(second.status,200); assert.notEqual(second.cookie,first.cookie);
const a=first.cookie,b=second.cookie;
const details={title:"Тест профиля",kind:"film",url:"https://example.org/watch/account",name:"Ведущий"};
const created=await request("/api/rooms",{cookie:a,data:details}); assert.equal(created.status,201);
const room=created.body.room, path="/api/rooms/"+room.id;
assert.equal(created.body.accountMember,true);
assert.equal((await request(path,{token:created.body.token})).status,401);
const again=await request(path,{cookie:b,data:{resume:true}});
assert.equal(again.body.me,room.hostId); assert.notEqual(again.body.token,created.body.token);
assert.equal((await request(path,{cookie:b,token:again.body.token})).status,200);
assert.equal((await request(path,{cookie:a,token:again.body.token})).status,401);
const saved="/api/account/favorites", bookmark={id:"chart-film-Q172241",saved:true};
assert.equal((await request(saved,{data:bookmark})).status,401);
assert.equal((await request(saved,{cookie:a,data:bookmark})).status,200);
const summary=(await request(account,{cookie:b})).body;
assert.equal(summary.user.name,login); assert.equal(summary.rooms[0].id,room.id); assert.equal(summary.rooms[0].isHost,1);
assert.deepEqual(summary.favorites,[bookmark.id]); assert.ok(!JSON.stringify(summary).includes("password"));
const anonymous=await request("/api/rooms",{data:details});
const previous=anonymous.body.room, claim="/api/account/rooms";
assert.deepEqual((await request(claim,{cookie:a,data:{rooms:[{id:previous.id,token:"0".repeat(64)}]}})).body.ids,[]);
assert.deepEqual((await request(claim,{cookie:a,data:{rooms:[{id:previous.id,token:anonymous.body.token}]}})).body.ids,[previous.id]);
assert.equal((await request("/api/rooms/"+previous.id,{token:anonymous.body.token})).status,401);
assert.equal((await request("/api/rooms/"+previous.id,{cookie:b,data:{resume:true}})).body.me,previous.hostId);
await request(account,{cookie:b,data:{action:"logout"}});
assert.equal((await request(account,{cookie:b})).body.user,null);
assert.equal((await request(path,{cookie:b,token:again.body.token})).status,401);
assert.equal((await request(path,{cookie:a,token:created.body.token})).status,200);
console.log("PASS: registration/login, cookie isolation, cross-device host role and list, proven guest import and session revocation");
