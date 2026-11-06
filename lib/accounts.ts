import { scrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { ApiError, accountCookie, currentAccount, db, hash, json, randomId } from "./server";

const lifetime = 30 * 86400;
const digestPrefix = "scrypt-16384-8-5";
const fixedSalt = "64769aaca50aef1058cc70d9d478117c";
const dummy = digestPrefix + "$" + fixedSalt + "$" + "00".repeat(32);

function digest(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 },
      (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}
async function passwordMatches(password: string, stored: string) {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== digestPrefix || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(key)) return false;
  return timingSafeEqual(await digest(password, salt), Buffer.from(key, "hex"));
}
async function limitAttempt(req: Request, action: string, login: string) {
  const now = Date.now(), expiry = now + 15 * 60000;
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  const keys = ["ip:" + ip];
  if (action === "login") keys.push("login:" + login);
  const statements = await Promise.all(keys.map(async key => db().prepare(
    "INSERT INTO account_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts"
  ).bind(await hash(action + ":" + key), expiry, now, now)));
  const results = await db().batch<{attempts:number}>(statements);
  if (results.some((row, i) => row.results[0].attempts > (action === "register" ? 6 : i === 0 ? 30 : 15)))
    throw new ApiError("Слишком много попыток. Попробуйте через 15 минут.", 429);
}
function sessionResponse(req: Request, token: string, status = 200) {
  const response = json({ ok: true }, status);
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append("Set-Cookie", `tt-session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? lifetime : 0}${secure}`);
  return response;
}

function registrationEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  const [local, domain, extra] = email.split("@");
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!domain || extra !== undefined || email.length > 254 || local.length > 64 ||
      !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local) ||
      !domain.includes(".") || !domain.split(".").every(part => label.test(part)))
    throw new ApiError("Введите адрес электронной почты, например name@example.ru.");
  return email;
}

export async function authenticate(req: Request, input: Record<string, unknown>) {
  const action = input.action;
  if (action === "logout") {
    const token = accountCookie(req);
    if (token) await db().prepare("DELETE FROM account_sessions WHERE token_hash=?").bind(await hash(token)).run();
    return sessionResponse(req, "");
  }
  if (action !== "login" && action !== "register") throw new ApiError("Выберите вход или регистрацию.");
  const email = action === "register" ? registrationEmail(input.email) : null;
  const name = typeof input.login === "string" ? input.login.trim().normalize("NFKC") : "";
  const login = name.toLowerCase(), password = input.password;
  if (!/^[а-яёa-z0-9][а-яёa-z0-9_.-]{2,23}$/u.test(login)) throw new ApiError("Логин — от 3 до 24 букв, цифр, точек, дефисов или подчёркиваний.");
  if (typeof password !== "string" || !password || password.length > 128 || (action === "register" && password.length < 10))
    throw new ApiError(action === "register" ? "Используйте пароль длиной от 10 до 128 символов." : "Введите логин и пароль.");
  if (action === "register" && password !== input.passwordConfirmation) throw new ApiError("Пароли не совпадают. Повторите пароль ещё раз.");
  await limitAttempt(req, action, login);
  const secret = randomId() + randomId(), tokenHash = await hash(secret), now = Date.now();
  const expires = now + lifetime * 1000;
  if (action === "register") {
    const id = randomId(), salt = randomId(), key = (await digest(password, salt)).toString("hex");
    const [created] = await db().batch([
      db().prepare("INSERT INTO accounts(id,email,login,name,password_hash,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING")
        .bind(id, email, login, name, [digestPrefix, salt, key].join("$"), now),
      db().prepare("INSERT INTO account_sessions(token_hash,account_id,expires_at) SELECT ?,id,? FROM accounts WHERE id=?").bind(tokenHash, expires, id),
    ]);
    if (!created.meta.changes) throw new ApiError("Этот логин или адрес почты уже используется. Войдите или укажите другие данные.", 409);
  } else {
    const found = await db().prepare("SELECT id,password_hash FROM accounts WHERE login=?").bind(login).first<{id:string;password_hash:string}>();
    const valid = await passwordMatches(password, found?.password_hash ?? dummy);
    if (!valid || !found) throw new ApiError("Неверный логин или пароль.", 401);
    await db().prepare("INSERT INTO account_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)").bind(tokenHash, found.id, expires).run();
  }
  return sessionResponse(req, secret, action === "register" ? 201 : 200);
}

export async function accountOverview(req: Request) {
  const account = await currentAccount(req);
  if (!account) return json({ user: null });
  const [rooms, favorites] = await db().batch<Record<string,unknown>>([
    db().prepare("SELECT r.id,r.title,r.video_title AS videoTitle,r.poster,r.kind,r.expires_at AS expiresAt,p.id=r.host_id AS isHost FROM participants p JOIN rooms r ON r.id=p.room_id WHERE p.account_id=? AND r.expires_at>? ORDER BY p.seen_at DESC,r.created_at DESC LIMIT 100").bind(account.id, Date.now()),
    db().prepare("SELECT video_id FROM account_favorites WHERE account_id=? ORDER BY created_at,video_id").bind(account.id),
  ]);
  return json({ user: { id: account.id, name: account.name }, rooms: rooms.results, favorites: favorites.results.map(row => row.video_id) });
}
