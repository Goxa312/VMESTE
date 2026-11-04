import manifest from "../extension/kinogo/manifest.json" with { type: "json" };
export const EXTENSION_VERSION = manifest.version;
export type ExtensionStatus = { installed: boolean; connected: boolean; hasPlayer: boolean; pageReady?: boolean; error?: string; version?: string };
export const EMPTY_EXTENSION: ExtensionStatus = { installed: false, connected: false, hasPlayer: false };

export function needsExtensionUpdate(version?: string) {
  if (!version) return true;
  const current = version.split(".").map(Number), required = EXTENSION_VERSION.split(".").map(Number);
  for (let i = 0; i < required.length; i++) {
    if (!Number.isFinite(current[i])) return true;
    if (current[i] !== required[i]) return current[i] < required[i];
  }
  return false;
}

export function extensionRequest(type: string, data?: unknown, timeout = 2500): Promise<ExtensionStatus> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let lastError = "Расширение не ответило. Откройте его значок и нажмите «Восстановить связь».";
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin ||
          event.data?.channel !== "vmeste-extension" || event.data.type !== "response" || event.data.requestId !== requestId) return;
      const result = event.data.result;
      // Old scripts can still answer after an extension reload. Let the live bridge reply.
      if (result?.installed !== true || typeof result.connected !== "boolean" || typeof result.hasPlayer !== "boolean") {
        if (typeof result?.error === "string") lastError = result.error;
        return;
      }
      cleanup(); resolve(result);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(lastError)); }, timeout);
    window.addEventListener("message", receive);
    window.postMessage({ channel: "vmeste-app", type, requestId, data }, window.location.origin);
  });
}
