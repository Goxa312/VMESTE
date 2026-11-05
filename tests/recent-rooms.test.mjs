import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readRecentRooms, recordViewing, rememberRoom } from "../lib/client.ts";

const store = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value),
} });
beforeEach(() => store.clear());
const room = {
  id: "123456789abc", title: "Комната", videoTitle: "Фильм", kind: "film", poster: "",
  videoUrl: "https://video.example/film.mp4?token=private", sourceMode: "direct",
  position: 20, expiresAt: Date.now() + 86400000,
};

test("keeps old room links and drops expired or malformed records", () => {
  const legacy = { id: room.id, title: "Комната", videoTitle: "Синтел", poster: "" };
  store.set("vm-recent", JSON.stringify([legacy, null, { ...legacy, expiresAt: 1 }, { ...legacy, id: "bad" }]));
  assert.deepEqual(readRecentRooms(), [legacy]);
  store.set("vm-recent", "{}");
  assert.deepEqual(readRecentRooms(), []);
});

test("records a real position and duration without storing the source URL", () => {
  rememberRoom({ room, token: "member-token" });
  recordViewing(room, 48, 120);
  recordViewing(room, 54);
  assert.equal(readRecentRooms()[0].duration, 120);
  assert.equal(readRecentRooms()[0].position, 54);
  assert.equal(JSON.parse(store.get("vm-room-" + room.id)), "member-token");
  assert.ok(!store.get("vm-recent").includes("private"));
  recordViewing({ ...room, videoUrl: "https://video.example/other.mp4" }, 0);
  assert.equal(readRecentRooms()[0].duration, undefined);
});

test("background checkpoints keep newer visits first and live rooms have no progress bar", () => {
  recordViewing(room, 18, 100, true);
  const live = { ...room, id: "abc123abc123", sourceMode: "page" };
  recordViewing(live, 80, 100, true);
  recordViewing(room, 77);
  const entries = readRecentRooms();
  assert.deepEqual(entries.map(entry => entry.id), [live.id, room.id]);
  assert.equal(entries[0].position, undefined);
  assert.equal(entries[0].duration, undefined);
  assert.equal(entries[1].position, 77);
});
