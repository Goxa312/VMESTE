// Both browsers use the real room. Only the broadcaster's synthetic movie and the fault are injected.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium, firefox } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT || "playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const film = "https://example.org/watch/room-interruption";
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME, headless: true, args: [
  "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--auto-select-tab-capture-source-by-title=InterruptedFilmFixture",
] });
const mode = process.env.QA_INTERRUPTION || "direct";
const scenarios = ["direct", "relay", "offline", "host-offline", "still", "pause", "cookie", "signaling"];
assert.ok(scenarios.includes(mode), "Unknown QA_INTERRUPTION");
const guestBrowser = process.env.QA_GUEST_ENGINE === "firefox" ? await firefox.launch({ headless: true }) :
  process.env.QA_GUEST_BROWSER ? await chromium.launch({ executablePath: process.env.QA_GUEST_BROWSER, headless: true, args: ["--mute-audio"] }) : browser;
const hostContext = await browser.newContext(), viewerContext = await guestBrowser.newContext();
const host = await hostContext.newPage(), viewer = await viewerContext.newPage();
const button = (page, name) => page.getByRole("button", { name, exact: true });
const errors = [];
for (const page of [host, viewer]) page.on("pageerror", err => errors.push(err.message));
let code, token;
await hostContext.addInitScript(() => {
  window.testPeers = [];
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) { super(...args); window.testPeers.push(this); }
  };
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function(data) {
    if (this === window.dropFrom && (data instanceof Blob || data instanceof ArrayBuffer)) return;
    if (typeof data === "string" && data.startsWith("format:")) {
      window.dropFrom = null;
      window.publisher = this;
    }
    return send.call(this, data);
  };
});
await viewerContext.addInitScript(mode => {
  if (!["direct", "still", "signaling"].includes(mode)) Object.defineProperty(window, "RTCPeerConnection", { value: undefined });
  else {
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args) { super(...args); window.lastPeer = this; }
    };
  }
  const Socket = window.WebSocket;
  window.WebSocket = class extends Socket {
    constructor(...args) { super(...args); if (String(args[0]).includes("/relay/")) window.viewerSocket = this; }
  };
}, mode);

async function frames(transport, previousUrl = "") {
  await viewer.waitForFunction(([transport, previousUrl]) => {
    const video = document.querySelector("video.live-video");
    if (!video || video.paused || video.readyState < 2 || !video.videoWidth) return false;
    const matches = transport === "direct" ? !!video.srcObject :
      !video.srcObject && video.currentSrc.startsWith("blob:") && video.currentSrc !== previousUrl;
    return matches && video.currentTime > .5;
  }, [transport, previousUrl], { timeout: 42000 });
  // Sample pixels, including after replacing a MediaSource on the same video element.
  await viewer.evaluate(() => { window.sampledColor = undefined; });
  await viewer.waitForFunction(() => {
    const video = document.querySelector("video.live-video");
    if (!video?.videoWidth) return false;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, 1, 1);
    const [r,,b] = context.getImageData(0, 0, 1, 1).data;
    if (Math.abs(r - b) < 25) return false;
    const color = r > b ? "warm" : "cool", previous = window.sampledColor;
    window.sampledColor = color;
    return previous && previous !== color;
  }, undefined, { timeout: 10000 });
  return viewer.locator("video.live-video").evaluate(v => ({ url: v.currentSrc, width: v.videoWidth, muted: v.muted }));
}
try {
  await hostContext.route(film, route => route.fulfill({ contentType: "text/html",
    body: '<title>InterruptedFilmFixture</title><main></main><script>let n=0;setInterval(()=>{if(window.keepStill)return;document.body.style.background=n++%2?"#d84":"#359";document.querySelector("main").textContent=n},90)</script>' }));
  await host.goto(base);
  await button(host, "Создать комнату").click();
  const form = host.getByRole("dialog");
  await form.getByLabel("Ссылка на фильм").fill(film);
  await form.getByLabel("Ваше имя").fill("QA host");
  await button(form, "Создать комнату").click();
  await host.waitForURL(/\/room\/[a-f0-9]{12}$/);
  code = new URL(host.url()).pathname.split("/").pop();
  token = await host.evaluate(code => JSON.parse(localStorage.getItem("vm-room-" + code)), code);
  const source = hostContext.waitForEvent("page");
  await host.getByRole("link", { name: "Открыть сайт" }).click();
  const movie = await source;
  await movie.waitForFunction(() => document.title === "InterruptedFilmFixture");
  await host.bringToFront(); await button(host, "Показать вкладку").click();
  await button(host, "Завершить показ").waitFor();
  await viewer.goto(host.url()); await viewer.getByLabel("Как вас зовут?").fill("QA viewer");
  await button(viewer, "Войти в комнату").click();
  const initialTransport = ["direct","still","signaling"].includes(mode) ? "direct" : "relay";
  const first = await frames(initialTransport);
  assert.ok(first.muted && first.width > 0);
  console.log("First frames decoded via", initialTransport);
  let started = Date.now();
  if (mode === "direct") {
    // The host keeps capturing the movie and the peer stays connected, but this sender loses its source.
    await host.evaluate(async () => {
      const peer = window.testPeers.find(p => p.connectionState === "connected");
      await peer.getSenders().find(s => s.track?.kind === "video").replaceTrack(null);
      if (peer.connectionState !== "connected") throw Error("Unexpected closed transport");
    });
  } else if (mode === "relay") {
    // A live socket carrying the format header provided media, then stopped delivering binary chunks.
    await host.evaluate(() => { if (!window.publisher) throw Error("No publisher"); window.dropFrom = window.publisher; });
  } else if (mode === "offline" || mode === "host-offline") {
    const context = mode === "offline" ? viewerContext : hostContext;
    const page = mode === "offline" ? viewer : host;
    await context.setOffline(true);
    try {
      await page.evaluate(() => {
        const socket = window.viewerSocket ?? window.publisher;
        if (socket?.readyState === WebSocket.OPEN) socket.close(4010, "Test network break");
      });
      await new Promise(resolve => setTimeout(resolve, 35000));
    } finally { await context.setOffline(false); started = Date.now(); }
  } else if (mode === "cookie") {
    // Drop only this guest's short-lived media cookie. The room membership is still valid.
    await viewerContext.clearCookies({ name: "vm-live" });
    await viewer.evaluate(() => window.viewerSocket.close(4010, "Test expired relay credentials"));
  } else if (mode === "signaling") {
    const id = await viewer.locator(".live-video").evaluate(v => v.srcObject.id);
    let failedPolls = 0;
    await viewerContext.route("**/signal?**", route => {
      if (route.request().method() === "GET" && new URL(route.request().url()).searchParams.has("attempt")) {
        failedPolls++; return route.fulfill({ status: 503, json: {error:"Временный сбой"} });
      }
      return route.continue();
    });
    await new Promise(resolve => setTimeout(resolve, 14500));
    assert.ok(failedPolls >= 2);
    assert.equal(await viewer.locator(".live-video").evaluate(v => v.srcObject?.id), id, "keep working video when signaling is interrupted");
    await viewerContext.unroute("**/signal?**");
  } else if (mode === "still") {
    await movie.evaluate(() => { window.keepStill = true; });
    await new Promise(resolve => setTimeout(resolve, 20000));
    assert.equal(await viewer.locator(".live-video").evaluate(v => !!v.srcObject), true, "a still source is allowed");
    await movie.evaluate(() => { window.keepStill = false; });
  } else if (mode === "pause") {
    await viewer.locator(".live-video").evaluate(v => v.pause());
    await new Promise(resolve => setTimeout(resolve, 18000));
    assert.equal(await viewer.locator(".live-video").evaluate(v => v.paused), true, "respect the viewer's pause");
    assert.equal(await viewer.locator(".live-video").evaluate(v => v.currentSrc), first.url);
    await viewer.locator(".live-video").evaluate(v => v.play());
    await frames("relay");
    await viewer.goto(base); await viewer.goBack();
    await viewer.getByRole("button", {name:"Пригласить друга"}).waitFor();
  }
  try {
    const restored = await frames(["still","signaling"].includes(mode) ? "direct" : "relay", mode === "pause" ? "" : first.url);
    assert.ok(restored.width > 0 && restored.muted);
    console.log("PASS", mode, "moving video confirmed after", ((Date.now() - started) / 1000).toFixed(1), "s", mode.endsWith("offline") ? "from network restoration" : "");
  } catch (error) {
    console.log("Viewer after interruption:", await viewer.locator(".live-stage [role=status]").allTextContents(), await viewer.evaluate(async () => {
      const v = document.querySelector("video.live-video"), track = v?.srcObject?.getVideoTracks()[0];
      const metrics = [];
      if (window.lastPeer) (await window.lastPeer.getStats()).forEach(s => {
        if (s.kind === "video" && /inbound|outbound/.test(s.type)) metrics.push([s.type, s.framesDecoded, s.packetsReceived, s.packetsSent]);
      });
      return { source: v?.srcObject ? "direct" : "relay", ready: v?.readyState, paused: v?.paused, frames: v?.getVideoPlaybackQuality().totalVideoFrames, time: v?.currentTime, track: track && [track.readyState,track.muted], connection: window.lastPeer?.connectionState, metrics };
    }));
    throw error;
  }
  assert.deepEqual(errors, []);
} finally {
  if (code && token) await hostContext.request.delete(base + "/api/rooms/" + code, { headers: { Authorization: "Bearer " + token }, data: { action: "delete" } }).catch(() => {});
  if (guestBrowser !== browser) await guestBrowser.close();
  await browser.close();
}
