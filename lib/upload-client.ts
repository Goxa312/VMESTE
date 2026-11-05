import { RequestError } from "./client";
export type UploadTarget = { code: string; token: string; revision: number };
async function uploadRequest<T>(url: string, token: string, method: string, signal: AbortSignal, body?: BodyInit, json = false) {
  const response = await fetch(url, { method, signal, headers: { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) }, body });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new RequestError(result.error || "Не удалось загрузить файл.", response.status);
  return result;
}
export async function uploadFilm(target: UploadTarget, file: File, title: string, signal: AbortSignal, progress: (value: number) => void) {
  const base = `/api/rooms/${target.code}/uploads`;
  const data = await uploadRequest<{ id: string; chunkSize: number }>(base, target.token, "POST", signal,
    JSON.stringify({ title, fileName: file.name, size: file.size, revision: target.revision }), true);
  const url = base + "/" + data.id;
  try {
    for (let offset = 0, part = 1; offset < file.size; offset += data.chunkSize, part++) {
      const piece = file.slice(offset, offset + data.chunkSize);
      for (let attempt = 0; ; attempt++) {
        try { await uploadRequest(url + "?part=" + part, target.token, "PUT", signal, piece); break; }
        catch (e) {
          if (signal.aborted || attempt >= 2 || (e instanceof RequestError && e.status < 500)) throw e;
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      progress(Math.min(99, Math.round((offset + piece.size) * 100 / file.size)));
    }
    await uploadRequest(url, target.token, "POST", signal);
    progress(100);
  } catch (error) {
    void fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${target.token}` }, keepalive: true }).catch(() => {});
    throw error;
  }
}
