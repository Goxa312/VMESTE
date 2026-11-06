import { accountOverview, authenticate } from "@/lib/accounts";
import { body, sameOriginWrite, safe } from "@/lib/server";
export async function GET(req: Request) { return safe(() => accountOverview(req)); }
export async function POST(req: Request) {
  return safe(async () => {
    sameOriginWrite(req);
    return authenticate(req, await body(req, 2000));
  });
}
