import assert from "node:assert/strict";
import { createRequire } from "node:module";
const {chromium}=createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT||"playwright");
const base=process.env.TEST_BASE_URL||"http://127.0.0.1:8790", fixture="https://example.org/watch/guest-source";
const browser=await chromium.launch({executablePath:process.env.QA_CHROME,headless:true,args:["--mute-audio","--disable-background-timer-throttling","--disable-renderer-backgrounding","--auto-select-tab-capture-source-by-title=GuestFrameFixture"]});
const hostContext=await browser.newContext(),host=await hostContext.newPage();
function traceSockets(page,tag) {
 if(!process.env.QA_TRACE)return;
 page.on("websocket",s=>{
   const profile=new URL(s.url()).searchParams.get("format")||"auto";let count=0;
   for(const event of ["framereceived","framesent"])s.on(event,m=>{
     if(typeof m.payload==="string"&&m.payload!=="ack")console.log(tag,profile,event,m.payload);
     else if(Buffer.isBuffer(m.payload)&&count++<4)console.log(tag,profile,event,m.payload.byteLength);
   });
   s.on("close",()=>console.log(tag,profile,"socket closed"));
 });
}
traceSockets(host,"host");
const button=(p,n)=>p.getByRole("button",{name:n,exact:true});
let code,token;
async function guest(mode){
 const ctx=await browser.newContext();
 await ctx.addInitScript(mode=>{
   if(mode==="mp4"){
     // Expose only the managed, MP4-only media path. Actual MP4 decoding still happens in Chromium.
     const Native=window.MediaSource;
     const Managed=function(){return new Native()};
     Managed.isTypeSupported=m=>m.startsWith("video/mp4")&&Native.isTypeSupported(m);
     Object.defineProperty(window,"ManagedMediaSource",{value:Managed,configurable:true});
     Object.defineProperty(window,"MediaSource",{value:undefined,configurable:true});
     Object.defineProperty(window,"RTCPeerConnection",{value:undefined,configurable:true});
   }
   if(mode==="no-frame"){
     const Native=window.RTCPeerConnection;
     window.RTCPeerConnection=class extends Native {
       constructor(...args){super(...args);this.addEventListener("connectionstatechange",()=>{if(this.connectionState==="connected")window.sawRtcConnection=true})}
       set ontrack(fn){super.ontrack=fn&&((e)=>{if(e.track.kind!=="video")fn.call(this,e)})}
       get ontrack(){return super.ontrack}
     };
   }
 },mode);
 if(mode==="no-offer")await ctx.route("**/signal?**",async r=>{
   const req=r.request(),url=new URL(req.url());
   if(req.method()==="GET"&&url.searchParams.has("attempt"))return r.fulfill({json:{offer:null,answered:0}});
   await r.continue();
 });
 const page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));traceSockets(page,mode);
 const sockets=[];page.on("websocket",s=>sockets.push(new URL(s.url()).searchParams.get("format")||"auto"));
 await page.goto(host.url());await page.getByLabel("Как вас зовут?").fill("Guest "+mode);
 const start=Date.now();await button(page,"Войти в комнату").click();
 try {await page.waitForFunction(()=>{const v=document.querySelector("video.live-video");return !!v && !v.srcObject && v.currentSrc.startsWith("blob:") && v.currentTime>.4 && v.videoWidth>0 && v.getVideoPlaybackQuality().totalVideoFrames>4;},undefined,{timeout:42000});}
 catch(e){console.log(mode,sockets,errors,await page.locator(".live-stage [role=status]").allTextContents(),await page.locator(".live-video").evaluateAll(vs=>vs.map(v=>({time:v.currentTime,ready:v.readyState,error:v.error?.message,width:v.videoWidth,buffered:v.buffered.length}))));throw e;}
 if(mode==="no-frame")assert.equal(await page.evaluate(()=>window.sawRtcConnection),true);
 if(mode==="mp4"){assert.ok(sockets.includes("mp4"));assert.equal(await page.locator(".live-video").evaluate(v=>v.disableRemotePlayback),true);}
 assert.equal(await page.locator(".live-video").evaluate(v=>v.muted),true);
 assert.deepEqual(errors,[]); console.log("PASS",mode,"first server-relayed video frames without an extra click in",((Date.now()-start)/1000).toFixed(1),"s");
 return {ctx,page};
}
try{
 await hostContext.route(fixture,r=>r.fulfill({contentType:"text/html",body:'<title>GuestFrameFixture</title><body style="font:48px sans-serif"><script>let i=0;setInterval(()=>{document.body.textContent=++i;document.body.style.background=i%2?"#974":"#459"},80)</script>'}));
 await host.goto(base);await button(host,"Создать комнату").click();
 const form=host.getByRole("dialog");await form.getByLabel("Ссылка на фильм").fill(fixture);await form.getByLabel("Ваше имя").fill("Host");await button(form,"Создать комнату").click();
 await host.waitForURL(/\/room\/[a-f0-9]{12}$/);code=new URL(host.url()).pathname.split("/").pop();
 token=await host.evaluate(c=>JSON.parse(localStorage.getItem("vm-room-"+c)),code);
 const source=hostContext.waitForEvent("page");await host.getByRole("link",{name:"Открыть сайт"}).click();
 await (await source).waitForFunction(()=>document.title==="GuestFrameFixture");await host.bringToFront();await button(host,"Показать вкладку").click();
 await button(host,"Завершить показ").waitFor();
 const first=await guest(process.env.QA_ONLY_MODE||"no-frame");
 if(!process.env.QA_ONLY_MODE) {
   const firstVideo=first.page.locator("video.live-video");
   const firstSource=await firstVideo.evaluate(v=>v.currentSrc);
   const second=await guest("mp4");
   assert.equal(await firstVideo.evaluate(v=>v.currentSrc),firstSource,"MP4 guest must not reset the other format");
   await second.ctx.close();
   await guest("no-offer");
 }
}finally{
 if(code&&token)await hostContext.request.delete(base+"/api/rooms/"+code,{headers:{Authorization:"Bearer "+token},data:{action:"delete"}}).catch(()=>{});
 await browser.close();
}
