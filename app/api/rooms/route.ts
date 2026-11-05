import { safe, body, str, mediaCookie, videoInput, randomId, hash, db, json, snapshot } from "@/lib/server";
export async function POST(req: Request) { return safe(async () => {
  const input = await body(req), video = videoInput(input), name = str(input.name, "Имя", 24);
  const title = str(input.roomTitle || `Смотрим ${video.title}`, "Название комнаты", 80);
  const code = randomId().slice(0, 12), id = randomId(), token = randomId() + randomId(), now = Date.now();
  await db().batch([
    db().prepare("INSERT INTO rooms (id,title,video_url,video_title,source_mode,kind,poster,host_id,playing,position,revision,updated_at,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,0,0,0,?,?,?)").bind(code, title, video.url, video.title, video.sourceMode, video.kind, video.poster, id, now, now, now + 7 * 86400000),
    db().prepare("INSERT INTO participants (id,room_id,token_hash,name,color,seen_at,joined_at) VALUES (?,?,?,?,0,?,?)").bind(id, code, await hash(token), name, now, now),
  ]);
  return mediaCookie(json({ ...(await snapshot(code, id)), token }, 201), req, code, token);
}); }
