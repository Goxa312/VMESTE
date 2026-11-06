import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const owned = [];
async function call(path, token, data, method, headers) {
  const res = await fetch(base + path, {
    method: method || (data ? "POST" : "GET"),
    headers: { ...(token && { Authorization: "Bearer " + token }), ...(data && { "Content-Type": "application/json" }), ...headers },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
async function create(url, sourceMode = "direct") {
  const r = await call("/api/rooms", null, { name:"Host", title:"Room break QA", url, sourceMode });
  assert.equal(r.status, 201);
  const room = { path:"/api/rooms/" + r.data.room.id, host:r.data.token };
  owned.push(room); return room;
}
async function join(room, name) {
  const r = await call(room.path, null, {name}); assert.equal(r.status, 201);
  return { id:r.data.me, token:r.data.token };
}
const participant = (data, id) => data.participants.find(p => p.id === id);
const act = (room, token, data) => call(room.path + "/actions", token, data);
const change = (room, token, away, previousChange, extra) => act(room,token,{action:"set-break",away,previousChange,...extra});
async function hostAct(room, data) {
  const current = await call(room.path,room.host);
  const r = await act(room,room.host,{revision:current.data.room.revision,...data});
  assert.equal(r.status,200,JSON.stringify(r.data.error)); return r.data;
}
try {
  const room = await create("https://example.org/film.mp4");
  const a = await join(room,"Anne"), b = await join(room,"Ben");
  const payload = {action:"set-break",away:true,previousChange:0};
  assert.equal((await act(room,null,payload)).status,401);
  assert.equal((await call(room.path+"/actions",a.token,payload,"POST",{Origin:"https://other.invalid"})).status,403);
  const other = await create("https://example.org/other.mp4");
  assert.equal((await act(other,a.token,payload)).status,401);
  for (const invalid of [{away:"yes"},{previousChange:-1},{previousChange:null}])
    assert.equal((await act(room,a.token,{...payload,...invalid})).status,400);
  assert.equal((await act(room,a.token,{action:"control",playing:false,position:0,revision:0})).status,403);
  const playing = await hostAct(room,{action:"control",playing:true,position:40});
  await new Promise(resolve => setTimeout(resolve,350));
  const together = await Promise.all([
    change(room,a.token,true,0,{participantId:b.id,position:500,playing:true}),
    change(room,b.token,true,0),
    change(room,a.token,true,0),
  ]);
  assert.deepEqual(together.map(r=>r.status),[200,200,200]);
  const paused = (await call(room.path,room.host)).data;
  assert.equal(paused.room.playing,false); assert.equal(paused.room.revision,playing.room.revision+1);
  const expected = 40 + Math.max(0,paused.room.updatedAt - playing.room.updatedAt)/1000;
  assert.ok(expected>40.2 && Math.abs(paused.room.position-expected)<0.002);
  assert.equal(participant(paused,paused.room.hostId).onBreak,false);
  const firstA = participant(paused,a.id), firstB = participant(paused,b.id);
  assert.ok(firstA.onBreak && firstB.onBreak);
  const late = await join(room,"Late");
  const seen = (await call(room.path,late.token)).data;
  assert.ok(participant(seen,a.id).onBreak); assert.equal(participant(seen,late.id).breakChangedAt,0);
  console.log("PASS two simultaneous breaks pause the shared clock exactly once; late join sees both people");

  const back = await change(room,a.token,false,firstA.breakChangedAt,{participantId:b.id,playing:true,position:0});
  assert.equal(back.status,200);const backA=participant(back.data,a.id);
  assert.equal(backA.onBreak,false);assert.ok(backA.breakChangedAt>firstA.breakChangedAt);
  assert.ok(participant(back.data,b.id).onBreak);
  assert.equal(back.data.room.playing,false); assert.equal(back.data.room.position,paused.room.position);
  assert.equal(back.data.room.revision,paused.room.revision);
  assert.equal((await change(room,a.token,false,firstA.breakChangedAt)).status,200);
  const resumed = await hostAct(room,{action:"control",playing:true,position:42});
  assert.equal((await change(room,a.token,true,0)).status,409);
  const repeat = await change(room,b.token,true,0);
  assert.equal(repeat.status,200);assert.equal(repeat.data.room.playing,true);assert.equal(repeat.data.room.revision,resumed.room.revision);
  assert.equal((await act(room,b.token,{action:"control",playing:true,position:500,revision:resumed.room.revision})).status,403);
  const next = await change(room,a.token,true,backA.breakChangedAt);
  assert.equal(next.status,200);assert.equal(next.data.room.playing,false);
  assert.equal((await change(room,a.token,false,firstA.breakChangedAt)).status,409);
  await call(room.path,b.token,{action:"leave"},"DELETE");
  assert.equal(participant((await call(room.path,room.host)).data,b.id),undefined);
  console.log("PASS returning affects only the caller; retry and out-of-order requests cannot pause or restart a film");

  const url = "https://example.org/watch/fixture";
  const pages = await create(url,"page"), guest = await join(pages,"Guest");
  const share = await hostAct(pages,{action:"share-start",pageUrl:url});
  const request = await change(pages,guest.token,true,0);
  const p=participant(request.data,guest.id);
  assert.equal(request.data.room.shareId,share.startedShare);assert.equal(request.data.room.revision,share.room.revision);
  assert.equal(request.data.room.updatedAt,share.room.updatedAt);
  const returned = await change(pages,guest.token,false,p.breakChangedAt);
  assert.equal(returned.data.room.shareId,share.startedShare);
  assert.equal(returned.data.room.revision,share.room.revision);
  await hostAct(pages,{action:"player-source",pageUrl:url,previousUrl:null,url:"https://example.org/movie.m3u8",format:"hls"});
  await hostAct(pages,{action:"control",playing:true,position:62});
  const native = await change(pages,guest.token,true,participant(returned.data,guest.id).breakChangedAt);
  assert.equal(native.data.room.playing,false);assert.ok(native.data.room.position>=62);assert.equal(native.data.room.nativeSource.format,"hls");

  for (const sourceMode of ["local","page"]) {
    const ext = await create(sourceMode==="page" ? "https://kinogo.my/films/123-example.html" : url,sourceMode);
    const viewer=await join(ext,"Guest");
    // The optional external player can publish a room clock even without a share ID.
    const running=await hostAct(ext,{action:"control",playing:true,position:19});
    const notice=await change(ext,viewer.token,true,0);
    assert.equal(notice.data.room.playing,true);assert.equal(notice.data.room.revision,running.room.revision);
  }
  console.log("PASS a broadcast stays active, external players only receive a request, and a published native HLS source pauses");
} finally {
  for (const room of owned) await call(room.path,room.host,{action:"delete"},"DELETE").catch(()=>{});
}
