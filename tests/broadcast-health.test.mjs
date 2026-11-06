import assert from "node:assert/strict";
import test from "node:test";
import { createVideoProbe, healthReply, observeBroadcastVideo } from "../lib/broadcast-health.ts";

test("moving source counters or a lost sender confirm a stall; a paused or static source stays connected", t => {
  let time = 100;
  t.mock.method(performance, "now", () => time);
  const probe = createVideoProbe();
  let sent = 0;
  const check = () => probe.failed(() => { sent++; });
  for (const marker of ["health:paused", "health:paused", "health:2/4", "health:2/4", "health:2/4"]) {
    assert.equal(check(), false); probe.receive(marker); time += 2500;
  }
  assert.equal(sent,5);
  probe.receive("health:3/5");
  assert.equal(check(),true);
  probe.reset(); assert.equal(check(),false); probe.receive("health:lost"); assert.equal(check(),true);
});

test("unanswered probes time out and old or malformed replies cannot keep a dead stream alive", t => {
  let time = 100;
  t.mock.method(performance, "now", () => time);
  const probe = createVideoProbe();
  probe.receive("health:lost");
  assert.equal(probe.failed(() => {}),false);
  for (const data of ["probe","health:", "health:https://example.org", "health:1/-1", "health:1/11111111111111111"]) {
    assert.equal(healthReply.test(data),false); probe.receive(data);
  }
  time += 6700;
  assert.equal(probe.failed(() => {}),true);
  probe.reset(); assert.equal(probe.failed(() => {}),false);
});

test("a visible guest needs new rendered frames; a local pause and background time do not trigger recovery", t => {
  let now = 10, pending, first = 0;
  t.mock.method(performance,"now",()=>now);
  const doc = new EventTarget();
  const original = Object.getOwnPropertyDescriptor(globalThis,"document");
  Object.defineProperty(globalThis,"document",{value:doc,configurable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,"document",original);else delete globalThis.document;});
  const video = Object.assign(new EventTarget(), {
    currentTime:0, paused:false, videoWidth:320, readyState:4,
    requestVideoFrameCallback(fn) { pending = fn; return 1; },
    cancelVideoFrameCallback() { pending = undefined; },
  });
  const monitor = observeBroadcastVideo(video, () => first++);
  assert.equal(monitor.read(),"waiting");
  pending(); assert.equal(monitor.read(),"playing"); assert.equal(first,1);
  now += 10000; video.currentTime += 10; assert.equal(monitor.read(),"stalled");
  video.paused = true; assert.equal(monitor.read(),"paused");
  video.paused = false; doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
  now += 60000; assert.equal(monitor.read(),"playing");
  doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange")); assert.equal(monitor.read(),"playing");
  now += 10000; assert.equal(monitor.read(),"stalled");
  pending(); assert.equal(monitor.read(),"playing"); assert.equal(first,1);
  monitor.stop(); assert.equal(pending,undefined);
});
