import { beginUpload } from "@/lib/uploads";
import { body, safe } from "@/lib/server";
export async function POST(req: Request, context: { params: Promise<{ code: string }> }) {
  return safe(async () => beginUpload(req, (await context.params).code, await body(req)));
}
