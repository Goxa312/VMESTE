// The broadcaster and viewer have separate browser profiles. The only captured tab is our moving test film.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT || "playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const movie = readFileSync(new URL("./fixtures/playback/clip.mp4",import.meta.url));
const origin = "https://break.example.org", file = origin+"/clip.mp4", film = origin+"/watch";
const browser = await chromium.launch({headless:true,executablePath:process.env.QA_CHROME,args:[
  "--mute-audio","--disable-renderer-backgrounding","--disable-background-timer-throttling","--auto-select-tab-capture-source-by-title=RoomBreakFilm",
]});
const hostContext=await browser.newContext({viewport:{width:1200,height:800}});
const guestContext=await browser.newContext({viewport:{width:375,height:760}});
// Keep system notifications inside the test; the actual room and capture use real browsers.
await hostContext.addInitScript(() => {
  window.breakNotices = []; window.permissionRequests = 0;
  class TestNotification {
    static permission = "default";
    static async requestPermission() { window.permissionRequests++; return this.permission = "granted"; }
    constructor(title, options) { window.breakNotices.push({title, ...options}); }
    close() {}
  }
  Object.defineProperty(window, "Notification", {configurable:true, value:TestNotification});
});
const host=await hostContext.newPage(), guest=await guestContext.newPage(), errors=[], owned=[];
const btn=(p,name)=>p.getByRole("button",{name,exact:true});
const status=(p,text)=>p.locator(".break-notes").getByText(text,{exact:true});
await guestContext.addCookies([{name:"tt-lang",value:"en",url:base}]);
for (const ctx of [hostContext,guestContext]) {
  ctx.on("page",p=>p.on("pageerror",e=>errors.push(e.message)));
  await ctx.route(file,async route=>{
    const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start=range?Number(range[1]):0,end=range?.[2]?Math.min(movie.length-1,Number(range[2])):movie.length-1;
    await route.fulfill({status:range?206:200,contentType:"video/mp4",body:movie.subarray(start,end+1),headers:{
      "Accept-Ranges":"bytes","Access-Control-Allow-Origin":"*",...(range&&{"Content-Range":`bytes ${start}-${end}/${movie.length}`}),
    }});
  });
}
for (const p of [host,guest]) p.on("pageerror",e=>errors.push(e.message));

async function room(url,mode) {
  const r=await hostContext.request.post(base+"/api/rooms",{data:{name:"Ведущий",url,title:"Room break test",sourceMode:mode}});
  assert.equal(r.status(),201);
  const data=await r.json(), code=data.room.id, link=base+"/room/"+code;
  owned.push([code,data.token]);
  await host.goto(base);
  await host.evaluate(([code,token])=>localStorage.setItem("vm-room-"+code,JSON.stringify(token)),[code,data.token]);
  await host.goto(link);await btn(host,"На минутку").waitFor();
  await guest.goto(link);await guest.getByLabel("What should we call you?").fill("Алекс");
  await btn(guest,"Join room").click();await btn(guest,"Take a break").waitFor();
  return {code,link,token:data.token};
}
const videoState=p=>p.locator(".video-stage video").evaluate(v=>({paused:v.paused,time:v.currentTime}));
const playing=p=>p.waitForFunction(()=>{const v=document.querySelector(".video-stage video");return v?.videoWidth>0&&!v.paused&&v.currentTime>.4;});
async function shot(p,name) {
  if(process.env.QA_SCREEN_DIR){mkdirSync(process.env.QA_SCREEN_DIR,{recursive:true});await p.screenshot({path:path.join(process.env.QA_SCREEN_DIR,name+".png"),animations:"disabled"});}
}
try {
  await room(file,"direct");
  // The room controls remain available when the player owns the fullscreen element.
  if(await host.evaluate(()=>document.fullscreenEnabled)) {
    await btn(host,"Полноэкранный режим").click();
    await host.waitForFunction(()=>document.fullscreenElement?.contains(document.querySelector(".break-toggle")));
    await host.evaluate(()=>document.exitFullscreen());
  }
  await host.locator(".player-overlay button").click();
  await Promise.all([host,guest].map(playing));
  const lost=async route=>{
    const req=route.request(),body=req.postDataJSON();
    if(body?.action!=="set-break"||body.away!==true)return route.continue();
    const reply=await route.fetch();assert.equal(reply.status(),200);await route.abort("connectionreset");
  };
  await guestContext.route("**/actions",lost);
  await btn(guest,"Take a break").click();
  await status(host,"На перерыве — Алекс").waitFor();
  await Promise.all([host,guest].map(p=>p.waitForFunction(()=>document.querySelector(".video-stage video")?.paused)));
  await guestContext.unroute("**/actions",lost);
  await btn(guest,"I’m back").waitFor();
  assert.ok(Math.abs((await videoState(host)).time-(await videoState(guest)).time)<.5);
  await guest.reload();await btn(guest,"I’m back").waitFor();
  assert.equal(await guest.locator(".room-break-bar [role=alert]").count(),0);
  await btn(guest,"Film only").click();
  await status(guest,"You’re on a break.").waitFor();
  assert.ok(await guest.locator(".room-break-bar").evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await shot(guest,"mobile-break");
  await btn(guest,"I’m back").click();await status(host,"Снова в комнате — Алекс").waitFor();
  const frozen=await videoState(host);await new Promise(resolve=>setTimeout(resolve,1300));
  assert.deepEqual(await videoState(host),frozen);assert.ok(frozen.paused);
  await host.locator(".play-toggle").click();await Promise.all([host,guest].map(playing));
  console.log("PASS native video pauses in both profiles; a lost response, refresh, fullscreen and film-only mode preserve the break; the host resumes");

  await hostContext.route(film,r=>r.fulfill({contentType:"text/html",body:`<meta charset="utf-8"><title>RoomBreakFilm</title><style>html,body{margin:0;height:100%;background:#171614}video{width:100%;height:90%;object-fit:contain}</style><video src="${file}" autoplay loop muted playsinline></video><button onclick="document.querySelector('video').pause()">Pause test film</button>`}));
  const live=await room(film,"page");
  const alerts=host.getByRole("checkbox",{name:"Уведомлять о перерывах в других вкладках"});
  assert.equal(await alerts.isChecked(),false);
  assert.equal(await host.evaluate(()=>window.permissionRequests),0);
  await alerts.check();assert.equal(await host.evaluate(()=>window.permissionRequests),1);
  const opened=hostContext.waitForEvent("page");await host.getByRole("link",{name:"Открыть сайт"}).click();const source=await opened;
  await source.waitForFunction(()=>{const v=document.querySelector("video");return v?.videoWidth>0&&!v.paused;});
  await host.bringToFront();
  const started=host.waitForResponse(r=>r.url().endsWith("/actions")&&r.request().postDataJSON()?.action==="share-start");
  await btn(host,"Показать вкладку").click();
  const session=(await (await started).json()).startedShare;
  const api=base+"/api/rooms/"+live.code, headers={Authorization:"Bearer "+live.token};
  const before=(await (await hostContext.request.get(api,{headers})).json()).room;
  assert.equal(before.shareId,session);
  await guest.waitForFunction(()=>{const v=document.querySelector(".live-video");return v?.videoWidth>0&&!v.paused&&v.currentTime>.3;},undefined,{timeout:45000});
  await source.bringToFront();
  // Headless Chrome can mark both pages visible. Reproduce the room being backgrounded.
  await host.evaluate(()=>Object.defineProperty(document,"hidden",{configurable:true,get:()=>true}));
  await btn(guest,"Take a break").click();
  await status(host,"Поставьте фильм на паузу в его вкладке.").waitFor();
  await host.waitForFunction(()=>document.title.includes("Просьба о паузе"));
  await host.waitForFunction(()=>window.breakNotices.some(n=>n.title.includes("Просьба о паузе")&&n.body.includes("Алекс")&&n.silent===true));
  await shot(host,"host-pause-request");
  assert.equal(await source.locator("video").evaluate(v=>v.paused),false);
  const during=(await (await hostContext.request.get(api,{headers})).json()).room;
  assert.equal(during.shareId,session);assert.equal(during.revision,before.revision);
  await btn(source,"Pause test film").click();
  await btn(guest,"I’m back").click();await status(host,"Снова в комнате — Алекс").waitFor();
  await host.waitForFunction(()=>document.title.includes("Снова в комнате") && window.breakNotices.some(n=>n.title.includes("Снова в комнате")&&n.silent===true));
  assert.equal(await host.evaluate(()=>window.breakNotices.length),2);
  assert.equal(await source.locator("video").evaluate(v=>v.paused),true);
  assert.equal((await (await hostContext.request.get(api,{headers})).json()).room.shareId,session);
  await btn(host,"Завершить показ").click();
  assert.deepEqual(errors,[]);
  console.log("PASS real tab capture shows a named request and return beside the player and in the room tab title; the source film and broadcast remain under host control");
} finally {
  for(const [code,token] of owned)await hostContext.request.delete(base+"/api/rooms/"+code,{headers:{Authorization:"Bearer "+token},data:{action:"delete"}}).catch(()=>{});
  await browser.close();
}
