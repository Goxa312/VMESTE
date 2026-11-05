import { cancelUpload, finishUpload, putPart, serveFilm } from "@/lib/uploads";
import { safe } from "@/lib/server";
type Context = { params: Promise<{ code: string; file: string }> };
function handler(fn: typeof serveFilm) {
  return async (req: Request, context: Context) => safe(async () => {
    const { code, file } = await context.params;
    return fn(req, code, file);
  });
}
export const PUT = handler(putPart);
export const POST = handler(finishUpload);
export const DELETE = handler(cancelUpload);
export const GET = handler(serveFilm);
export const HEAD = GET;
