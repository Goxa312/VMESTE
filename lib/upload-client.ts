import { RequestError } from "./client";
export type UploadTarget = { code: string; token: string; revision: number };
async function uploadRequest<T>(url: string, token: string, method: string, signal: AbortSignal, body?: BodyInit, json = false) {
  const response = await fetch(url, { method, signal, headers: { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) }, body });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new RequestError(result.error || "Не удалось загрузить файл.", response.status);
  return result;
}
async function retryTransfer<T>(send:()=>Promise<T>, signal:AbortSignal): Promise<T> {
  for(let attempt=0;;attempt++) {
    try { return await send(); }
    catch(error) {
      if(signal.aborted || attempt >= 2 || (error instanceof RequestError && error.status < 500)) throw error;
      await new Promise<void>(resolve=>setTimeout(resolve,500*(attempt+1)));
    }
  }
}
export async function uploadFilm(target: UploadTarget, file: File, title: string, signal: AbortSignal, progress: (value: number) => void) {
  const base = `/api/rooms/${target.code}/uploads`;
  const data = await uploadRequest<{ id: string; chunkSize: number }>(base, target.token, "POST", signal,
    JSON.stringify({ title, fileName: file.name, size: file.size, revision: target.revision }), true);
  const url = base + "/" + data.id;
  try {
    for (let offset = 0, part = 1; offset < file.size; offset += data.chunkSize, part++) {
      const piece = file.slice(offset, offset + data.chunkSize);
      await retryTransfer(()=>uploadRequest(url+"?part="+part,target.token,"PUT",signal,piece), signal);
      progress(Math.min(99, Math.round((offset + piece.size) * 100 / file.size)));
    }
    // Finishing is idempotent: the file may already be ready if the final reply was lost.
    await retryTransfer(()=>uploadRequest(url,target.token,"POST",signal), signal);
    progress(100);
  } catch (error) {
    void fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${target.token}` }, keepalive: true }).catch(() => {});
    throw error;
  }
}
