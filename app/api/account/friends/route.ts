import { changeFriends, friendsView } from "@/lib/friends";
import { ApiError, body, currentAccount, json, safe, sameOriginWrite } from "@/lib/server";

async function accountId(req: Request) {
  const account = await currentAccount(req);
  if (!account) throw new ApiError("Войдите в аккаунт.", 401);
  return account.id;
}
export async function GET(req: Request) {
  return safe(async () => {
    const actor = await accountId(req), params = new URL(req.url).searchParams;
    return json(await friendsView(actor, params.get("room"), params.get("inbox") === "1"));
  });
}
export async function POST(req: Request) {
  return safe(async () => {
    sameOriginWrite(req);
    const actor = await accountId(req);
    return json({ notice: await changeFriends(actor, await body(req, 800)) });
  });
}
