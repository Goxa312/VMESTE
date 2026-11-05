// Real tab capture and media decoding with WebRTC intentionally unable to find a route.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT || "playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME, headless: true,
  args:["--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--auto-select-tab-capture-source-by-title=VmesteRelayFixture"] });
const filmUrl = "https://example.org/watch/vmeste-relay-fixture";
const hostContext = await browser.newContext(), guestContext = await browser.newContext(), lateContext = await browser.newContext();
const ctxs = [hostContext,guestContext,lateContext];
const errors = [];
for (const ctx of ctxs) {
  ctx.on("page", page => page.on("pageerror", e => errors.push(e.message)));
  await ctx.addInitScript(() => {
    const rtc = window.RTCPeerConnection;
    window.blockedPeers = 0;
    window.RTCPeerConnection = class extends rtc {
      constructor(config) { super({ ...config, iceServers: [], iceTransportPolicy:"relay" }); window.blockedPeers++; }
    };
  });
}
const host = await hostContext.newPage(), guest = await guestContext.newPage(), late = await lateContext.newPage();
const frames = async page => {
  await page.waitForFunction(() => {
    const v = document.querySelector(".live-video");
    return v && !v.srcObject && v.currentSrc.startsWith("blob:") && v.getVideoPlaybackQuality().totalVideoFrames > 4 && v.currentTime > 0.35;
  }, undefined, { timeout:100000 });
  return page.locator(".live-video").evaluate(v => ({ frames:v.getVideoPlaybackQuality().totalVideoFrames,width:v.videoWidth,height:v.videoHeight,muted:v.muted }));
};
async function enter(page, url, name) {
  await page.goto(url); await page.getByLabel("Как вас зовут?").fill(name);
  await page.getByRole("button",{name:"Войти в комнату",exact:true}).click();
  await page.getByRole("button",{name:"Пригласить друзей"}).waitFor();
}
// Use a complete, HTTP/1.1 WebSocket upgrade: the public edge rejects malformed
// Upgrade requests before the Worker's membership check can run.
function handshake(path, origin, cookie="") {
  const url=new URL(path,base);
  return new Promise((resolve,reject) => {
    const req=(url.protocol==="https:"?https:http).get(url,{
      headers:{Origin:origin, Connection:"Upgrade", Upgrade:"websocket", "Sec-WebSocket-Version":"13",
        "Sec-WebSocket-Key":randomBytes(16).toString("base64"), "X-Host":"1", ...(cookie && {Cookie:cookie})}
    }, res=>{res.resume();resolve(res.statusCode);});
    req.on("upgrade",(_res,socket)=>{socket.destroy();resolve(101);});
    req.on("error",reject); req.setTimeout(12000,()=>req.destroy(new Error("Handshake timed out")));
  });
}
const status = async page => (await page.locator(".live-stage [role=status]").allTextContents()).join(" · ");
try {
  // Pretend only this one host-owned test page is the film; no third-party video is accessed.
  await hostContext.route(filmUrl, r => r.fulfill({ contentType:"text/html", body:'<title>VmesteRelayFixture</title><main></main><script>let n=0;setInterval(()=>{document.body.style.background=n++%2?"#f98":"#345";document.querySelector("main").textContent=n},100)</script>' }));
  await host.goto(base);
  await host.locator(".loading-small").waitFor({ state:"hidden" }); // wait until the room form is hydrated
  await host.getByRole("textbox",{name:"Ссылка на фильм"}).fill(filmUrl);
  await host.getByRole("button",{name:"Создать комнату",exact:true}).click();
  const dialog=host.getByRole("dialog");
  await dialog.getByLabel("Ваше имя").fill("Ведущий теста");
  await dialog.getByRole("button",{name:"Создать комнату",exact:true}).click();
  await host.waitForURL(/\/room\/[a-f0-9]+$/); const link=host.url(), code=new URL(link).pathname.split("/").pop();
  const fixture=hostContext.waitForEvent("page"); await host.getByRole("link",{name:"Открыть сайт"}).click();
  await (await fixture).getByRole("main").waitFor(); await host.bringToFront();
  const start=host.waitForResponse(r=>r.url().endsWith("/actions") && r.request().postDataJSON()?.action==="share-start");
  await host.getByRole("button",{name:"Показать вкладку",exact:true}).click();
  const session=(await (await start).json()).startedShare; assert.ok(session);
  await enter(guest,link,"Зритель теста");
  const config=guest.waitForResponse(r=>r.url().includes("ice=1"));
  await guest.getByRole("button",{name:"Смотреть трансляцию",exact:true}).click();
  assert.equal((await (await config).json()).roomRelay,true);
  const first=await frames(guest);
  assert.ok(first.width > 0 && first.height > 0 && first.muted && await guest.evaluate(()=>window.blockedPeers)>0);
  await guest.getByText("В эфире · через комнату",{exact:true}).waitFor();
  console.log("PASS: automatic fallback after blocked ICE decoded", first.width+"×"+first.height, "muted, without another click");

  await enter(late,link,"Второй зритель теста");
  await late.getByRole("button",{name:"Смотреть через комнату",exact:true}).click();
  assert.ok((await frames(late)).muted);
  assert.equal(await late.evaluate(()=>window.blockedPeers),0);
  assert.ok((await frames(guest)).frames>4);
  console.log("PASS: late viewer starts immediately without WebRTC; original viewer keeps receiving video");

  if (process.env.QA_LONG_PLAY) {
    const from = await guest.locator(".live-video").evaluate(v => v.currentTime);
    await guest.waitForFunction(t => {
      const v=document.querySelector(".live-video"), b=v?.buffered;
      return b?.length && v.currentTime > t+42 && b.start(0)>5;
    }, from, {timeout:85000});
    console.log("PASS: live playback continues after eviction of old movie data");
  }
  const socketPath="/api/rooms/"+code+"/relay/"+session;
  // Neither a URL alone nor an undocumented role header grants access.
  assert.equal(await handshake(socketPath,base),401);
  const cookie=(await guestContext.cookies(base+socketPath)).find(c=>c.name==="vm-live");
  assert.ok(cookie?.httpOnly);
  const auth=cookie.name+"="+cookie.value;
  assert.equal(await handshake(socketPath,"https://example.invalid",auth),403);
  const denied=await late.evaluate(path => new Promise((resolve, reject) => {
    const url=new URL(path,location.href); url.protocol=location.protocol==="https:"?"wss:":"ws:";
    const sock=new WebSocket(url); sock.onopen=()=>sock.send(new Uint8Array([1]));
    sock.onclose=e=>resolve(e.code); sock.onerror=()=>reject(new Error("Authenticated test socket did not connect"));
  }), socketPath);
  assert.equal(denied,1008);
  console.log("PASS: membership and origin checked; authenticated viewers cannot publish video");
  await host.getByRole("button",{name:"Завершить показ",exact:true}).click();
  await guest.getByRole("heading",{name:"Ждём следующего показа"}).waitFor();
  assert.equal(await guest.locator(".live-video").count(),0);
  assert.equal(await handshake(socketPath,base,auth),409);
  console.log("PASS: ending the show closes the relay and denies stale handshakes");
  assert.deepEqual(errors,[]);
} catch(e) {
  console.error("Host status:",await status(host),"Guest status:",await status(guest),"Late status:",await status(late));
  throw e;
} finally { await browser.close(); }
