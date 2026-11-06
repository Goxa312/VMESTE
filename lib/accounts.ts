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
  if (action !== "register") keys.push((action === "login" ? "login:" : "account:") + login);
  const statements = await Promise.all(keys.map(async key => db().prepare(
    "INSERT INTO account_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts"
  ).bind(await hash(action + ":" + key), expiry, now, now)));
  const results = await db().batch<{attempts:number}>(statements);
  const limit = action === "register" ? 6 : action === "login" ? 30 : 10;
  if (results.some((row, i) => row.results[0].attempts > (i === 0 ? limit : Math.min(limit,15))))
    throw new ApiError("Слишком много попыток. Попробуйте через 15 минут.", 429);
}
function sessionResponse(req: Request, token: string, status = 200, recoveryCode?: string) {
  const response = json({ ok: true, recoveryCode }, status);
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append("Set-Cookie", `tt-session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? lifetime : 0}${secure}`);
  return response;
}

function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const code = Array.from(bytes, value => value.toString(16).padStart(2,"0")).join("").toUpperCase();
  return code.match(/.{4}/g)!.join("-");
}
function recoveryDigest(code: string) {
  return hash("recovery:" + code.replace(/[\s-]/g, "").toUpperCase());
}
function checkNewPassword(input: Record<string,unknown>) {
  const password = input.password;
  if (typeof password !== "string" || password.length < 10 || password.length > 128)
    throw new ApiError("Используйте пароль длиной от 10 до 128 символов.");
  if (password !== input.passwordConfirmation) throw new ApiError("Пароли не совпадают. Повторите пароль ещё раз.");
  return password;
}
async function passwordHash(password: string) {
  const salt = randomId();
  return [digestPrefix, salt, (await digest(password, salt)).toString("hex")].join("$");
}
async function resetWithCode(req: Request, input: Record<string,unknown>) {
  const password = checkNewPassword(input);
  const identifier = typeof input.identifier === "string" ? input.identifier.trim().normalize("NFKC").toLowerCase() : "";
  const code = typeof input.code === "string" ? input.code.replace(/[\s-]/g,"") : "";
  if (!identifier || identifier.length > 254 || !/^[0-9a-f]{32}$/i.test(code))
    throw new ApiError("Введите логин или почту и полный резервный код.");
  await limitAttempt(req, "reset", identifier);
  const oldHash = await recoveryDigest(code);
  const account = await db().prepare("SELECT id FROM accounts WHERE (login=? OR email=?) AND recovery_hash=?").bind(identifier, identifier, oldHash).first<{id:string}>();
  const invalid = () => new ApiError("Проверьте логин или почту и резервный код.", 400);
  if (!account) throw invalid();
  const next = newRecoveryCode(), nextHash = await recoveryDigest(next);
  const [updated] = await db().batch([
    db().prepare("UPDATE accounts SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?")
      .bind(await passwordHash(password), nextHash, account.id, oldHash),
    db().prepare("DELETE FROM account_sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND recovery_hash=?)")
      .bind(account.id, account.id, nextHash),
  ]);
  if (!updated.meta.changes) throw invalid();
  return json({ok:true,recoveryCode:next});
}
async function issueRecoveryCode(req: Request, input: Record<string,unknown>) {
  const account = await currentAccount(req);
  if (!account) throw new ApiError("Войдите в аккаунт.", 401);
  await limitAttempt(req, "issue-code", account.id);
  const stored = await db().prepare("SELECT password_hash,recovery_hash FROM accounts WHERE id=?")
    .bind(account.id).first<{password_hash:string; recovery_hash:string | null}>();
  if (!stored || typeof input.password !== "string" || input.password.length > 128 || !await passwordMatches(input.password, stored.password_hash))
    throw new ApiError("Неверный пароль.", 403);
  const code = newRecoveryCode();
  const result = await db().prepare(`UPDATE accounts SET recovery_hash=? WHERE id=? AND password_hash=? AND recovery_hash IS ?
    AND EXISTS(SELECT 1 FROM account_sessions WHERE token_hash=? AND account_id=accounts.id AND expires_at>?)`)
    .bind(await recoveryDigest(code), account.id, stored.password_hash, stored.recovery_hash, await hash(account.secret), Date.now()).run();
  if (!result.meta.changes) throw new ApiError("Войдите в аккаунт ещё раз.", 401);
  return json({ok:true,recoveryCode:code});
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
  if (action === "reset-password") return resetWithCode(req, input);
  if (action === "issue-recovery-code") return issueRecoveryCode(req, input);
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
  if (action === "register") checkNewPassword(input);
  if (typeof password !== "string" || !password || password.length > 128) throw new ApiError("Введите логин и пароль.");
  await limitAttempt(req, action, login);
  const secret = randomId() + randomId(), tokenHash = await hash(secret), now = Date.now();
  const expires = now + lifetime * 1000;
  if (action === "register") {
    const id = randomId(), code = newRecoveryCode();
    const [created] = await db().batch([
      db().prepare("INSERT INTO accounts(id,email,login,name,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
        .bind(id, email, login, name, await passwordHash(password), await recoveryDigest(code), now),
      db().prepare("INSERT INTO account_sessions(token_hash,account_id,expires_at) SELECT ?,id,? FROM accounts WHERE id=?").bind(tokenHash, expires, id),
    ]);
    if (!created.meta.changes) throw new ApiError("Этот логин или адрес почты уже используется. Войдите или укажите другие данные.", 409);
    return sessionResponse(req, secret, 201, code);
  } else {
    const found = await db().prepare("SELECT id,password_hash FROM accounts WHERE login=?").bind(login).first<{id:string;password_hash:string}>();
    const valid = await passwordMatches(password, found?.password_hash ?? dummy);
    if (!valid || !found) throw new ApiError("Неверный логин или пароль.", 401);
    const session = await db().prepare("INSERT INTO account_sessions(token_hash,account_id,expires_at) SELECT ?,id,? FROM accounts WHERE id=? AND password_hash=?").bind(tokenHash, expires, found.id, found.password_hash).run();
    if (!session.meta.changes) throw new ApiError("Неверный логин или пароль.", 401);
  }
  return sessionResponse(req, secret);
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
