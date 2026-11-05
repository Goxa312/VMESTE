import { uploadLimit } from "@/lib/uploads";
import { json } from "@/lib/server";
export function GET() { return json({ maxSize: uploadLimit() }); }
