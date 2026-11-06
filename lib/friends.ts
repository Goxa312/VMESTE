import { accountLogin, attemptBucket } from "./accounts";
import { ApiError, db, getRoom, randomId } from "./server";

export type Friend = { id: string; name: string; state: "friend" | "incoming" | "outgoing"; invited: number };
export type RoomInvite = { id: string; room: string; title: string; film: string; sender: string };
export type FriendsView = { people: Friend[]; invitations: RoomInvite[] };

export function socialId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) throw new ApiError("Некорректный номер заявки.");
  return value;
}
async function inviteRoom(actor: string, room: unknown) {
  if (typeof room !== "string") throw new ApiError("Выберите комнату.");
  await getRoom(room);
  const present = await db().prepare("SELECT 1 FROM participants WHERE account_id=? AND room_id=?").bind(actor, room).first();
  if (!present) throw new ApiError("Приглашать друзей могут участники комнаты.", 403);
  return room;
}

export async function friendsView(actor: string, room: string | null, inbox: boolean): Promise<FriendsView> {
  if (room) await inviteRoom(actor, room);
  const people = db().prepare(`
    SELECT f.id, a.name,
      CASE WHEN f.accepted_at IS NOT NULL THEN 'friend' WHEN f.requested_by=?1 THEN 'outgoing' ELSE 'incoming' END AS state,
      EXISTS(SELECT 1 FROM room_invites i WHERE i.recipient_id=a.id AND i.room_id=?2 AND f.accepted_at IS NOT NULL) AS invited
    FROM friendships f
    JOIN accounts a ON a.id=CASE WHEN f.first_id=?1 THEN f.second_id ELSE f.first_id END
    WHERE (f.first_id=?1 OR f.second_id=?1) ${inbox ? "AND f.accepted_at IS NULL AND f.requested_by<>?1" : ""}
    ORDER BY a.login
  `).bind(actor, room);
  const invitations = db().prepare(`
    SELECT i.id, r.id AS room, r.title, r.video_title AS film, sender.name AS sender
    FROM room_invites i JOIN rooms r ON r.id=i.room_id
    JOIN friendships f ON f.id=i.friendship_id
    JOIN accounts sender ON sender.id=CASE WHEN f.first_id=i.recipient_id THEN f.second_id ELSE f.first_id END
    WHERE i.recipient_id=? AND r.expires_at>? AND f.accepted_at IS NOT NULL
    ORDER BY i.created_at DESC,i.id
  `).bind(actor, Date.now());
  const [contacts, invites] = await db().batch([people, invitations]);
  return { people: contacts.results as Friend[], invitations: invites.results as RoomInvite[] };
}

async function limitSend(actor: string, kind: "request" | "invite") {
  const count = await (await attemptBucket("friends:" + kind + ":" + actor, Date.now())).first<number>("attempts");
  if (count !== null && count > 40) throw new ApiError("Слишком много попыток. Попробуйте через 15 минут.", 429);
}

async function requestFriend(actor: string, value: unknown) {
  const { login } = accountLogin(value);
  await limitSend(actor, "request");
  const other = await db().prepare("SELECT id FROM accounts WHERE login=?").bind(login).first<{id:string}>();
  if (!other) throw new ApiError("Пользователь с таким логином не найден.", 404);
  if (other.id === actor) throw new ApiError("Это ваш собственный логин.");
  const [first, second] = [actor, other.id].sort();
  // Both directions share one row. A crossed request still requires an explicit acceptance.
  const [, relation] = await db().batch<{requested_by:string; accepted_at:number | null}>([
    db().prepare("INSERT INTO friendships(id,first_id,second_id,requested_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(first_id,second_id) DO NOTHING")
      .bind(randomId(), first, second, actor, Date.now()),
    db().prepare("SELECT requested_by,accepted_at FROM friendships WHERE first_id=? AND second_id=?").bind(first, second),
  ]);
  const row = relation.results[0];
  if (row.accepted_at !== null) return "Вы уже друзья.";
  return row.requested_by === actor ? "Заявка отправлена." : "У вас уже есть входящая заявка от этого человека.";
}

async function sendInvite(actor: string, id: string, value: unknown) {
  const room = await inviteRoom(actor, value);
  await limitSend(actor, "invite");
  const now = Date.now(), newId = randomId();
  // Check the friendship, membership and room lifetime in the actual write. A retry keeps the first invitation.
  const sent = await db().prepare(`
    INSERT INTO room_invites(id,room_id,friendship_id,recipient_id,created_at)
    SELECT ?,r.id,f.id,CASE WHEN f.first_id=? THEN f.second_id ELSE f.first_id END,?
    FROM friendships f JOIN rooms r ON r.id=? JOIN participants p ON p.room_id=r.id AND p.account_id=?
    WHERE f.id=? AND f.accepted_at IS NOT NULL AND (f.first_id=? OR f.second_id=?) AND r.expires_at>?
    ON CONFLICT(recipient_id,room_id) DO UPDATE SET id=room_invites.id RETURNING id
  `).bind(newId, actor, now, room, actor, id, actor, actor, now).first<{id:string}>();
  if (!sent) throw new ApiError("Приглашение доступно только для подтверждённых друзей в действующей комнате.", 403);
  return sent.id === newId ? "Приглашение отправлено." : "У друга уже есть приглашение в эту комнату.";
}

export async function changeFriends(actor: string, input: Record<string, unknown>) {
  if (input.action === "request") return requestFriend(actor, input.login);
  const id = socialId(input.id);
  switch (input.action) {
    case "invite": return sendInvite(actor, id, input.room);
    case "dismiss":
      await db().prepare("DELETE FROM room_invites WHERE id=? AND recipient_id=?").bind(id,actor).run();
      return "Приглашение скрыто.";
    case "accept": {
      const result = await db().prepare(`UPDATE friendships SET accepted_at=COALESCE(accepted_at,?)
        WHERE id=? AND (first_id=? OR second_id=?) AND requested_by<>?`).bind(Date.now(), id, actor, actor, actor).run();
      if (!result.meta.changes) throw new ApiError("Входящая заявка больше недоступна.", 409);
      return "Теперь вы друзья.";
    }
    case "decline":
    case "cancel":
    case "remove": {
      const predicates = { decline:"accepted_at IS NULL AND requested_by<>?2", cancel:"accepted_at IS NULL AND requested_by=?2", remove:"accepted_at IS NOT NULL" };
      const messages = { decline:"Заявка отклонена.", cancel:"Заявка отозвана.", remove:"Пользователь удалён из друзей." };
      const owner = "id=?1 AND (first_id=?2 OR second_id=?2)";
      const deleted = await db().prepare(`DELETE FROM friendships WHERE ${owner} AND ${predicates[input.action]}`).bind(id, actor).run();
      if (!deleted.meta.changes && await db().prepare(`SELECT 1 FROM friendships WHERE ${owner}`).bind(id, actor).first())
        throw new ApiError("Список друзей изменился. Проверьте заявку ещё раз.", 409);
      return messages[input.action];
    }
    default: throw new ApiError("Неизвестное действие.");
  }
}
