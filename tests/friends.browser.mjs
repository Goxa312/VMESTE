import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT || "playwright");
const base=process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const hostBrowser=await chromium.launch({executablePath:process.env.QA_CHROME,headless:true,args:["--mute-audio"]});
const hostContext=await hostBrowser.newContext({viewport:{width:1250,height:820}});
const viewerContext=await hostBrowser.newContext({viewport:{width:360,height:740}});
const guestContext=await hostBrowser.newContext();
const owned = [];
const btn=(within,name)=>within.getByRole("button",{name,exact:true});
async function register(context,login) {
  const password=randomUUID();
  const response = await context.request.post(base+"/api/account",{data:{action:"register",login,email:login+"@example.test",password,passwordConfirmation:password}});
  assert.equal(response.status(),201); return password;
}
async function screenshot(page,name) {
  if (!process.env.QA_SCREEN_DIR) return;
  mkdirSync(process.env.QA_SCREEN_DIR,{recursive:true});
  await page.screenshot({path:path.join(process.env.QA_SCREEN_DIR,name+".png"),animations:"disabled"});
}
const tag=randomUUID().slice(0,8), a="alex_"+tag,b="dana_"+tag;
try {
  await register(hostContext,a); const viewerPassword=await register(viewerContext,b);
  await viewerContext.addCookies([{name:"tt-lang",value:"en",url:base}]);
  const host=await hostContext.newPage(), viewer=await viewerContext.newPage();
  const errors=[];for(const p of [host,viewer])p.on("pageerror",e=>errors.push(e.message));
  await Promise.all([host.goto(base),viewer.goto(base)]);
  await btn(host,"Профиль: "+a).click();await btn(host,"Друзья").click();
  const panel=host.getByRole("dialog");
  await panel.getByLabel("Логин друга").fill(b.toUpperCase());await btn(panel,"Отправить заявку").click();
  await panel.getByText("Заявка отправлена.",{exact:true}).waitFor();
  await btn(viewer,"View request").waitFor({timeout:35000});await btn(viewer,"View request").click();
  const inbox=viewer.getByRole("dialog");await btn(inbox,"Accept").click();
  await inbox.getByText("You’re now friends.",{exact:true}).waitFor();
  await screenshot(viewer,"friends-mobile");
  assert.ok(await inbox.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await btn(inbox,"Close").click();
  await btn(panel,"Закрыть").click();
  console.log("PASS requests arrive without reloading; confirmed friendship on mobile in English");
  await btn(host,"Создать комнату").click();
  const create=host.getByRole("dialog");
  await create.getByLabel("Ссылка на фильм").fill("https://example.org/friends/test-film");
  await create.getByLabel("Название фильма",{exact:true}).fill("Фильм для друзей");
  await btn(create,"Создать комнату").click();await host.waitForURL(/\/room\/[a-f0-9]{12}$/);
  const room=host.url(), code=new URL(room).pathname.split("/").pop();
  owned.push(code);
  await btn(host,"Пригласить друга").click();
  const invite=host.getByRole("dialog");
  await invite.getByText(b,{exact:true}).waitFor();
  await btn(invite,"Пригласить").click();await btn(invite,"Приглашён").waitFor();
  assert.equal(await btn(invite,"Приглашён").isDisabled(),true);
  await screenshot(host,"invite-desktop");
  const alert=viewer.getByRole("complementary",{name:"Friend notifications"});
  await alert.getByText(new RegExp(a)).waitFor({timeout:35000});
  // The invitation belongs to the account and survives a new login session.
  await viewerContext.request.post(base+"/api/account",{data:{action:"logout"}});
  const again=await viewerContext.request.post(base+"/api/account",{data:{action:"login",login:b,password:viewerPassword}});
  assert.equal(again.status(),200);
  await viewer.reload();await btn(alert,"Join room").waitFor();await btn(invite,"Закрыть").click();
  await btn(alert,"Join room").click();await viewer.waitForURL(room);
  await btn(viewer,"Invite a friend").waitFor();
  assert.equal(await viewer.getByLabel("What should we call you?").count(),0);
  await btn(viewer,"People").click();
  await viewer.locator(".person").filter({hasText:a}).waitFor();
  assert.equal(await viewerContext.request.get(base+"/api/account/friends?inbox=1").then(r=>r.json()).then(x=>x.invitations.length),0);
  console.log("PASS persistent invitation, one-click room entry, original host and shared membership");

  // Exercise the existing manual copy path for browsers that deny clipboard access.
  await host.evaluate(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:()=>Promise.reject(new Error("denied"))},configurable:true}));
  await btn(host,"Пригласить друга").click();await btn(host.getByRole("dialog"),"Скопировать ссылку").click();
  await host.locator("#invite-link").waitFor();assert.equal(await host.locator("#invite-link").inputValue(),room);
  const guest=await guestContext.newPage();await guest.goto(room);
  await guest.getByLabel("Как вас зовут?").fill("Guest");await btn(guest,"Войти в комнату").click();
  await btn(guest,"Пригласить друга").waitFor();
  await guest.evaluate(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:()=>Promise.reject(new Error("denied"))},configurable:true}));
  await btn(guest,"Пригласить друга").click();assert.equal(await guest.locator("#invite-link").inputValue(),room);
  assert.equal(await guest.getByRole("dialog").count(),0);
  console.log("PASS signed and guest copy fallback; guest still joins by link, without a social account");
  const another=await hostContext.request.post(base+"/api/rooms",{data:{title:"Следующий фильм",roomTitle:"Следующая комната",url:"https://example.org/next"}});
  assert.equal(another.status(),201);
  const next=(await another.json()).room.id; owned.push(next);
  await host.goto(base+"/room/"+next);await btn(host,"Пригласить друга").click();
  await btn(host.getByRole("dialog"),"Пригласить").click();
  const roomNotice=viewer.getByRole("complementary",{name:"Friend notifications"});
  await roomNotice.getByText(/Следующая комната/).waitFor({timeout:35000});
  await btn(roomNotice,"Join room").click();await viewer.waitForURL(base+"/room/"+next);
  await viewer.getByRole("heading",{name:"Следующий фильм",exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log("PASS new invitation appears inside an active room and switches to the correct room");
} finally {
  for (const code of owned) await hostContext.request.delete(base+"/api/rooms/"+code,{data:{action:"delete"}}).catch(()=>{});
  await hostBrowser.close();
}
