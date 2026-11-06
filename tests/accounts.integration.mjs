import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
async function request(path,{data,cookie,token,origin,method}={}) {
  const res=await fetch(base+path,{method:method || (data?"POST":"GET"),headers:{
    ...(data&&{"Content-Type":"application/json"}),...(cookie&&{Cookie:cookie}),...(token&&{Authorization:"Bearer "+token}),...(origin&&{Origin:origin}),
  },body:data?JSON.stringify(data):undefined});
  const set=res.headers.get("set-cookie") || "";
  return {status:res.status,body:await res.json(),set,cookie:set.split(";")[0]};
}
const account="/api/account", login="test_"+randomUUID().slice(0,8), password=randomUUID();
const email=login+"@example.test", credentials={email:" "+email.toUpperCase()+" ",login,password,passwordConfirmation:password};
assert.equal((await request(account)).body.user,null);
assert.equal((await request(account,{data:{action:"register",...credentials},origin:"https://elsewhere.example"})).status,403);
for(const bad of [{email:undefined},{email:"name@-invalid.test"},{email:"x..y@example.test"},{password:"short",passwordConfirmation:"short"},{passwordConfirmation:undefined},{passwordConfirmation:password+"x"}]) {
  assert.equal((await request(account,{data:{action:"register",...credentials,...bad}})).status,400);
}
const first=await request(account,{data:{action:"register",...credentials}});
assert.equal(first.status,201);
assert.match(first.set,/HttpOnly/i); assert.match(first.set,/SameSite=Lax/i);
assert.equal((await request(account,{data:{action:"register",...credentials,email:"other-"+email}})).status,409);
assert.equal((await request(account,{data:{action:"register",...credentials,login:login+"_other",email}})).status,409);
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
assert.deepEqual(summary.favorites,[bookmark.id]); assert.ok(!JSON.stringify(summary).includes("password")); assert.ok(!JSON.stringify(summary).includes(email));
const remove=(path,action,options={})=>request(path,{method:"DELETE",data:{action},...options});
assert.equal((await remove(path,"delete")).status,401);
assert.equal((await remove(path,"delete",{cookie:b,origin:"https://elsewhere.example"})).status,403);
assert.equal((await remove(path,"leave",{cookie:b})).status,409);
const outsider=await request(path,{data:{name:"Гость"}});
assert.equal((await remove(path,"delete",{cookie:b,token:outsider.body.token})).status,403);
assert.equal((await remove(path,"leave",{token:outsider.body.token})).status,200);
assert.equal((await request(path,{token:outsider.body.token})).status,401);
const anonymous=await request("/api/rooms",{data:details});
const previous=anonymous.body.room, claim="/api/account/rooms";
assert.deepEqual((await request(claim,{cookie:a,data:{rooms:[{id:previous.id,token:"0".repeat(64)}]}})).body.ids,[]);
assert.deepEqual((await request(claim,{cookie:a,data:{rooms:[{id:previous.id,token:anonymous.body.token}]}})).body.ids,[previous.id]);
assert.equal((await request("/api/rooms/"+previous.id,{token:anonymous.body.token})).status,401);
assert.equal((await request("/api/rooms/"+previous.id,{cookie:b,data:{resume:true}})).body.me,previous.hostId);
const other=await request("/api/rooms",{data:details}), otherPath="/api/rooms/"+other.body.room.id;
const visitor=await request(otherPath,{cookie:b,data:{name:"Зритель"}});
assert.ok((await request(account,{cookie:a})).body.rooms.some(r=>r.id===other.body.room.id && !r.isHost));
assert.equal((await remove(otherPath,"delete",{cookie:b})).status,403);
assert.equal((await remove(otherPath,"leave",{cookie:b})).status,200);
assert.equal((await request(otherPath,{cookie:b,token:visitor.body.token})).status,401);
assert.ok(!(await request(account,{cookie:a})).body.rooms.some(r=>r.id===other.body.room.id));
assert.equal((await request(otherPath,{cookie:a,data:{name:"Вернулся"}})).status,201);
assert.equal((await remove(otherPath,"delete",{token:other.body.token})).status,200);
assert.equal((await request(otherPath,{token:other.body.token})).status,404);
assert.equal((await request(otherPath,{data:{resume:true}})).status,404);
await request(account,{cookie:b,data:{action:"logout"}});
assert.equal((await request(account,{cookie:b})).body.user,null);
assert.equal((await request(path,{cookie:b,token:again.body.token})).status,401);
assert.equal((await request(path,{cookie:a,token:created.body.token})).status,200);
assert.equal((await remove(path,"delete",{cookie:b})).status,401);
assert.equal((await remove(path,"delete",{cookie:a})).status,200);
assert.equal((await request(path,{data:{name:"По приглашению"}})).status,404);
assert.deepEqual((await request(account,{cookie:a})).body.rooms.map(r=>r.id),[previous.id]);
assert.equal((await remove("/api/rooms/"+previous.id,"delete",{cookie:a})).status,200);
console.log("PASS: email and confirmation, unique login/email, isolated sessions, guest import, only the host deletes, guests leave and rejoin, expired sessions cannot delete.");
