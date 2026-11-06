// A generated 18-second H.264/AAC clip is both a seekable file and a single-file HLS VOD.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
const {chromium,firefox}=createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT||"playwright");
const base=process.env.TEST_BASE_URL||"http://127.0.0.1:8790";
const origin="https://playback.example.org";
const movie=readFileSync(new URL("./fixtures/playback/clip.mp4",import.meta.url));
const playlist=readFileSync(new URL("./fixtures/playback/clip.m3u8",import.meta.url));
const flags=["--mute-audio","--disable-renderer-backgrounding","--disable-background-timer-throttling"];
const hBrowser=await chromium.launch({executablePath:process.env.QA_CHROME,headless:true,args:flags});
const vBrowser=process.env.QA_GUEST_ENGINE==="firefox" ? await firefox.launch({headless:true}) :
  await chromium.launch({executablePath:process.env.QA_GUEST_BROWSER||process.env.QA_CHROME,headless:true,args:flags});
const hc=await hBrowser.newContext(), gc=await vBrowser.newContext();
const h=await hc.newPage(), g=await gc.newPage(), errors=[], owned=[];
await gc.addInitScript(() => {
  const play=HTMLMediaElement.prototype.play;
  let cancelFirst=true;
  HTMLMediaElement.prototype.play=function(){
    if(cancelFirst && this.closest(".video-stage")){cancelFirst=false;return Promise.reject(new DOMException("Interrupted by a media load","AbortError"));}
    return play.call(this);
  };
});
const btn=(page,name)=>page.getByRole("button",{name,exact:true});
const join=async (page,link)=>{await page.goto(link);await page.getByLabel("Как вас зовут?").fill("Guest");await btn(page,"Войти в комнату").click();};
for(const page of [h,g])page.on("pageerror",e=>errors.push(e.message));
const state=p=>p.locator(".video-stage video").evaluate(v=>({time:v.currentTime,duration:v.duration,paused:v.paused,muted:v.muted,frames:v.getVideoPlaybackQuality().totalVideoFrames,w:v.videoWidth}));
const advancing=p=>p.waitForFunction(()=>{const v=document.querySelector(".video-stage video");return v?.videoWidth>0 && !v.paused && v.currentTime>.8 && v.getVideoPlaybackQuality().totalVideoFrames>=4;},undefined,{timeout:17000});
let rejectHls=false, lag=false, liveStart=0;
for(const [ctx,isGuest] of [[hc,false],[gc,true]])await ctx.route(origin+"/**",async route=>{
  const req=route.request(), isList=new URL(req.url()).pathname.endsWith(".m3u8");
  if(isGuest&&lag)await new Promise(resolve=>setTimeout(resolve,1400));
  const headers={"Access-Control-Allow-Origin":"*","Accept-Ranges":"bytes","Cache-Control":"no-store"};
  if(isList){
    let content=playlist.toString();
    if(new URL(req.url()).pathname==="/live.m3u8"){
      const segments=content.match(/#EXTINF:[^\n]+\n#EXT-X-BYTERANGE:[^\n]+\nclip.mp4/g);
      const end=Math.min(segments.length,4+Math.floor((Date.now()-liveStart)/2000)),start=end-4;
      content=["#EXTM3U","#EXT-X-VERSION:7","#EXT-X-TARGETDURATION:2","#EXT-X-MEDIA-SEQUENCE:"+start,content.match(/#EXT-X-MAP:[^\n]+/)[0],...segments.slice(start,end),""].join("\n");
    }
    await route.fulfill({status:isGuest&&rejectHls?403:200,headers,contentType:"application/vnd.apple.mpegurl",body:isGuest&&rejectHls?"denied":content});return;
  }
  const range=req.headers().range?.match(/^bytes=(\d+)-(\d*)$/i);
  const a=range?Number(range[1]):0,b=range&&range[2]?Math.min(movie.length-1,Number(range[2])):movie.length-1;
  if(range)headers["Content-Range"]="bytes "+a+"-"+b+"/"+movie.length;
  await route.fulfill({status:range?206:200,headers,contentType:"video/mp4",body:movie.subarray(a,b+1)});
});
async function create(url, fromPage=false) {
  if(!url){
    let finishes=0;
    const path="**/uploads/*";
    const loseFirstReceipt=async route=>{
      if(route.request().method()!=="POST")return route.continue();
      if(++finishes!==1)return route.continue();
      const receipt=await route.fetch();assert.equal(receipt.status(),200);
      await route.abort("connectionreset");
    };
    await hc.route(path,loseFirstReceipt);
    try {
      await h.goto(base);await btn(h,"Создать комнату").click();const form=h.getByRole("dialog");
      await btn(form,"С компьютера").click();await form.locator("input[type=file]").setInputFiles({name:"clip.mp4",mimeType:"video/mp4",buffer:movie});
      await form.getByLabel("Ваше имя").fill("Host");await btn(form,"Загрузить фильм").click();
      await h.waitForURL(/\/room\/[a-f0-9]{12}$/);
      const code=new URL(h.url()).pathname.split("/").pop();owned.push([code,await h.evaluate(c=>JSON.parse(localStorage.getItem("vm-room-"+c)),code)]);
      assert.equal(finishes,2,"a lost upload receipt must retry the same file");
      await h.locator(".player-overlay button").click();await advancing(h);
      return h.url();
    } finally {await hc.unroute(path,loseFirstReceipt);}
  }
  const post=await hc.request.post(base+"/api/rooms",{data:{name:"Host",title:"Cinema QA",url,sourceMode:fromPage?"page":"direct"}});
  assert.equal(post.status(),201);
  const data=await post.json(),code=data.room.id,token=data.token;
  owned.push([code,token]);
  await h.goto(base);
  await h.evaluate(([c,t])=>localStorage.setItem("vm-room-"+c,JSON.stringify(t)),[code,token]);
  const link=base+"/room/"+code;await h.goto(link);
  if(fromPage){
    await btn(h,"Есть прямая ссылка на видео?").click();const preview=h.getByRole("dialog");
    await preview.getByLabel("Прямая ссылка на видео").fill(origin+"/clip.m3u8");
    await btn(preview,"Проверить видео").click();await btn(preview,"Открыть для всех").click();
  }
  await h.locator(".player-overlay button").click();
  await advancing(h);return link;
}
try {
  if(process.env.QA_SIGNED_GUEST){
    const login="viewer_"+randomUUID().slice(0,8),password=randomUUID();
    const response=await gc.request.post(base+"/api/account",{data:{action:"register",login,email:login+"@example.test",password,passwordConfirmation:password}});
    assert.equal(response.status(),201);
  }
  for(const type of process.env.QA_FILE_ONLY ? [] : ["upload","mp4","hls","page-to-hls"]) {
    rejectHls=type==="hls"; lag=type==="mp4";
    const link=await create(type==="upload"?null:origin+(type==="hls"?"/clip.m3u8":type==="page-to-hls"?"/watch":"/clip.mp4"),type==="page-to-hls");
    await join(g,link);
    if(type==="hls"){
      await g.getByText(/HTTP 403/).first().waitFor(); assert.ok(await g.locator(".player-error").isVisible());
      rejectHls=false; await btn(g,"Попробовать снова").click();
    }
    await advancing(g); lag=false;
    if(type==="upload" || type==="page-to-hls") {
      await btn(g,"На минутку").click();
      await h.waitForFunction(()=>document.querySelector(".video-stage video")?.paused);
      await btn(g,"Я вернулся").click();
      await h.locator(".break-notes").getByText("Снова в комнате — Guest",{exact:true}).waitFor();
    } else await h.locator(".play-toggle").click();
    await g.waitForFunction(()=>document.querySelector(".video-stage video")?.paused);
    const [a,b]=await Promise.all([state(h),state(g)]);assert.ok(b.muted&&b.w===160);assert.ok(Math.abs(a.time-b.time)<1.35,JSON.stringify({type,a,b}));
    await h.locator(".timeline").focus();await h.keyboard.press("ArrowRight");await h.keyboard.press("Home");
    await g.waitForFunction(()=>document.querySelector(".video-stage video")?.currentTime<.5);
    await h.locator(".play-toggle").click();await advancing(g);
    await g.reload();await advancing(g);
    if(type==="upload"){
      await btn(g,"Сведения о воспроизведении").click();
      const report=g.getByRole("dialog");await report.getByText("160 × 90").waitFor();
      const details=await report.innerText();
      assert.ok(!details.includes(new URL(link).pathname.split("/").pop()) && !details.includes("https://"));
      await btn(report,"Закрыть").click();
      const strict=await vBrowser.newContext();
      try {
        await strict.addInitScript(()=>{
          const play=HTMLMediaElement.prototype.play;
          let permitted=false;
          document.addEventListener("click",e=>{if(e.target.closest(".player-overlay button"))permitted=true;},true);
          HTMLMediaElement.prototype.play=function(){
            if(!permitted && this.closest(".video-stage"))return Promise.reject(new DOMException("User interaction required","NotAllowedError"));
            return play.call(this);
          };
        });
        const restricted=await strict.newPage();await join(restricted,link);
        await btn(restricted,"Разрешить воспроизведение").click();await advancing(restricted);
      } finally { await strict.close(); }
    }
    if(type==="hls"||type==="page-to-hls"){
      await btn(h,"Перейти к показу вкладки").click();
      await btn(h,"Показать вкладку").waitFor();
      await g.getByRole("heading",{name:"Ждём фильм от ведущего"}).waitFor();
      assert.equal(g.url(),link);
    }
    console.log("PASS",type,"guest starts on entry, follows pause/seek/resume and rejoins muted",type==="hls"?"after HTTP 403 and retry":type==="mp4"?"with delayed media":type==="upload"?"with real authenticated upload":"after the host previews and publishes the stream");
  }
  if(!process.env.QA_FILE_ONLY){
    liveStart=Date.now();
    const liveLink=await create(origin+"/live.m3u8");await join(g,liveLink);await advancing(g);
    await g.getByText("Прямой эфир",{exact:true}).waitFor();
    assert.equal(await h.locator(".timeline").isVisible(),false);
    await btn(g,"На минутку").click();
    await Promise.all([h,g].map(p=>p.waitForFunction(()=>document.querySelector(".video-stage video")?.paused)));
    await btn(g,"Я вернулся").click();
    await h.locator(".break-notes").getByText("Снова в комнате — Guest",{exact:true}).waitFor();
    await h.locator(".play-toggle").click();await advancing(g);
    console.log("PASS: a sliding HLS window starts live, pauses for a viewer’s break, and resumes with the host.");
  }
  // Lower only the chooser's threshold; use the normal file-capture path without allocating a huge fixture.
  await hc.route("**/api/media-options",r=>r.fulfill({json:{maxSize:movie.length-1}}));
  await h.goto(base);await btn(h,"Создать комнату").click();const form=h.getByRole("dialog");
  await btn(form,"С компьютера").click();await form.locator("input[type=file]").setInputFiles({name:"fixture.mp4",mimeType:"video/mp4",buffer:movie});
  await form.getByLabel("Ваше имя").fill("Host");await btn(form,"Показать файл из браузера").click();
  await h.waitForURL(/\/room\/[a-f0-9]{12}$/);const code=new URL(h.url()).pathname.split("/").pop();
  owned.push([code,await h.evaluate(c=>JSON.parse(localStorage.getItem("vm-room-"+c)),code)]);
  await join(g,h.url());await btn(h,"Начать показ файла").click();
  const samples=[];
  const observer=setInterval(async()=>{try {
    if(samples.length<14) samples.push(await g.evaluate(()=>{const v=document.querySelector(".live-video");return {message:document.querySelector(".live-stage [role=status]")?.textContent,video:v&&[v.videoWidth,Number(v.currentTime.toFixed(1)),v.getVideoPlaybackQuality?.()?.totalVideoFrames,v.readyState,v.paused,!!v.srcObject]};}));
  }catch{}},1600);
  try {await g.waitForFunction(()=>{
    const v=document.querySelector(".live-video");
    if(!v?.videoWidth || v.paused || v.currentTime<.5 || v.readyState<2)return false;
    // Firefox reports zero totalVideoFrames for WebRTC. Check the actual coloured test pattern.
    const c=document.createElement("canvas");c.width=16;c.height=10;
    const ctx=c.getContext("2d");ctx.drawImage(v,0,0,16,10);
    const data=ctx.getImageData(0,0,16,10).data;
    for(let i=0;i<data.length;i+=4)if(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>80)return true;
    return false;
  },undefined,{timeout:40000});}
  catch(e){
    console.log("Guest samples:",samples);
    for(const [side,p] of [["host",h],["guest",g]]) console.log(side,await p.locator(".live-stage [role=status],.live-stage .error").allTextContents(),await p.locator(".live-video").evaluateAll(vs=>vs.map(v=>({width:v.videoWidth,time:v.currentTime,paused:v.paused,ended:v.ended,ready:v.readyState,frames:v.getVideoPlaybackQuality?.()?.totalVideoFrames,transport:v.srcObject?"rtc":"file/relay",error:v.error?.code}))));
    throw e;
  } finally {clearInterval(observer);}
  assert.equal(await g.locator(".live-video").evaluate(v=>v.muted),true);
  console.log("PASS: file streamed from the host browser; a guest who arrived before the show starts automatically.");
  assert.deepEqual(errors,[]);
}finally{
 for(const [code,token] of owned)await hc.request.delete(base+"/api/rooms/"+code,{headers:{Authorization:"Bearer "+token},data:{action:"delete"}}).catch(()=>{});
 await Promise.all([hBrowser.close(),vBrowser.close()]);
}
