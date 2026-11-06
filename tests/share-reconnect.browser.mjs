// Optional browser integration test. Uses isolated profiles and a locally intercepted film tab.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT || "playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const filmUrl = "https://kinogo.my/films/123-vmeste-rtc-fixture.html";
const browser = await chromium.launch({
  executablePath: process.env.QA_CHROME, headless: true,
  args: ["--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--auto-select-tab-capture-source-by-title=VmesteSignalFixture"],
});
const hostProfile = await browser.newContext(), guestProfile = await browser.newContext();
hostProfile.setDefaultTimeout(30000);
guestProfile.setDefaultTimeout(30000);
await guestProfile.addInitScript(() => {
  window.extensionRequests = 0;
  window.addEventListener("message", ({ data }) => {
    if (data?.channel === "vmeste-app") window.extensionRequests++;
  });
});
const host = await hostProfile.newPage(), guest = await guestProfile.newPage();
const errors = [];
for (const context of [hostProfile, guestProfile]) {
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
}
for (const page of [host, guest]) page.on("pageerror", error => errors.push(error.message));

function latch() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { release, promise };
}

async function waitForLatch(promise, label) {
  let timeout;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(label)), 30000);
    })]);
  } finally { clearTimeout(timeout); }
}

async function startBroadcast(page) {
  await page.bringToFront();
  const response = page.waitForResponse(r => r.url().endsWith("/actions") && r.request().postDataJSON()?.action === "share-start");
  await page.getByRole("button", { name: "Показать вкладку", exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200);
  const data = await result.json();
  assert.equal(data.startedShare, data.room.shareId);
  return data.startedShare;
}

async function expectFrames(previousId = null) {
  await guest.waitForFunction(previous => {
    const video = document.querySelector("video.live-video");
    return video?.readyState >= 2 && video.videoWidth > 0 && video.currentTime > .12 && video.srcObject && video.srcObject.id !== previous;
  }, previousId, { timeout: 55000 });
  return guest.locator("video.live-video").evaluate(v => ({
    id: v.srcObject.id, width: v.videoWidth, height: v.videoHeight, muted: v.muted,
  }));
}

const joinBlocked = latch(), releaseJoin = latch(), pollBlocked = latch(), releasePoll = latch();
let secondHost, owned;
try {
  // No request goes to Kinogo. Chrome captures this real, moving browser tab.
  await hostProfile.route(filmUrl, route => route.fulfill({
    contentType: "text/html",
    body: '<title>VmesteSignalFixture</title><main>Film</main><script>let n=0;setInterval(()=>document.querySelector("main").textContent="Frame "+(++n),80)</script>',
  }));
  await host.goto(base);
  await host.getByRole("button", { name: "Создать комнату", exact: true }).click();
  const form = host.getByRole("dialog");
  await form.getByLabel("Ссылка на фильм").fill(filmUrl);
  await form.getByLabel("Ваше имя").fill("Ведущий теста");
  await form.getByRole("button", { name: "Создать комнату", exact: true }).click();
  await host.waitForURL(/\/room\/[a-f0-9]+$/);
  const link = host.url(), code = new URL(link).pathname.split("/").pop(), roomPath = "/api/rooms/" + code;
  const fixture = hostProfile.waitForEvent("page");
  await host.getByRole("link", { name: "Открыть сайт" }).click();
  await (await fixture).getByRole("main").waitFor();

  await guest.goto(link);
  await guest.getByLabel("Как вас зовут?").fill("Зритель теста");
  await guest.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await guest.getByRole("button", { name: "Пригласить друга" }).waitFor();
  const token = await host.evaluate(key => JSON.parse(localStorage.getItem("vm-room-" + key)), code);
  owned={code,token};
  async function call(path, data) {
    return fetch(base + roomPath + path, {
      method: data ? "POST" : "GET", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  let first;
  secondHost = await hostProfile.newPage();
  await secondHost.goto(link);
  await secondHost.getByRole("button", { name: "Показать вкладку", exact: true }).waitFor();

  let holdNextPoll = false, requestsAfterConflict = 0, conflictReturned = false;
  await guest.route("**/api/rooms/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === roomPath && req.method() === "GET" && holdNextPoll) {
      holdNextPoll = false;
      pollBlocked.release();
      await releasePoll.promise;
    }
    if (url.pathname === roomPath + "/signal" && (!first || url.searchParams.get("session") === first)) {
      const action = req.method() === "POST" ? req.postDataJSON()?.action : "read";
      if (conflictReturned && action !== "leave") requestsAfterConflict++;
      if (action === "join") { holdNextPoll = true; joinBlocked.release(); await releaseJoin.promise; }
    }
    await route.continue().catch(() => {});
  });
  first = await startBroadcast(host);
  await waitForLatch(joinBlocked.promise, "Missing automatic viewer join");
  await waitForLatch(pollBlocked.promise, "Missing room poll during join");
  const second = await startBroadcast(secondHost);
  assert.notEqual(first, second);
  const staleResponse = guest.waitForResponse(r => r.url().includes("/signal?session=" + first) && r.status() === 409);
  releaseJoin.release();
  const outdated = await staleResponse;
  conflictReturned = true;
  assert.equal((await outdated.json()).code, "share_changed");

  // The old snapshot request is still blocked. A separate refresh must discover the new broadcast.
  const firstFrames = await expectFrames();
  assert.ok(firstFrames.muted);
  assert.equal(requestsAfterConflict, 0);
  console.log("PASS: 409 followed by decoded", firstFrames.width + "×" + firstFrames.height, "frames without a second click");
  releasePoll.release();

  await host.getByRole("button", { name: "Показать вкладку", exact: true }).waitFor();
  const lateStop = await call("/actions", { action: "share-stop", session: first, pageUrl: filmUrl, revision: 0 });
  assert.equal((await lateStop.json()).room.shareId, second);
  await host.close();
  console.log("PASS: closing the old broadcaster leaves the new broadcast running");

  const signaling = "/signal?session=" + second;
  const peers = async () => (await call(signaling)).json();
  const [before] = await peers();
  assert.ok(before.answer);
  assert.ok((await call(signaling, { action: "reset", attempt: before.attempt, guest: before.guest })).ok);
  const recovered = await expectFrames(firstFrames.id);
  assert.notEqual((await peers())[0].attempt, before.attempt);
  console.log("PASS: viewer automatically creates a new peer when the host loses its negotiation state");

  await secondHost.getByRole("button", { name: "Завершить показ" }).click();
  await guest.getByRole("heading", { name: "Ждём следующего показа" }).waitFor();
  assert.notEqual(await startBroadcast(secondHost), second);
  assert.ok((await expectFrames(recovered.id)).muted);
  await secondHost.close();
  await guest.getByRole("heading", { name: "Ждём следующего показа" }).waitFor();
  console.log("PASS: spectator follows stop/start, then sees the active host close");

  assert.equal(await guest.evaluate(() => window.extensionRequests), 0);
  await guest.getByText("Подключить плеер Киного", { exact: true }).click();
  await guest.waitForFunction(() => window.extensionRequests > 0);
  console.log("PASS: normal tab broadcasts use no extension messages; the optional player still starts on request");
  assert.deepEqual(errors, []);
} finally {
  releaseJoin.release();
  releasePoll.release();
  if(owned) await hostProfile.request.delete(base+"/api/rooms/"+owned.code,{headers:{Authorization:"Bearer "+owned.token},data:{action:"delete"}}).catch(()=>{});
  await browser.close();
}
