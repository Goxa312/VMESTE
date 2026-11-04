export type ExtensionStatus = { installed: boolean; connected: boolean; hasPlayer: boolean; pageReady?: boolean; error?: string; version?: string };

export function extensionRequest(type: string, data?: unknown, timeout = 2500): Promise<ExtensionStatus> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin ||
          event.data?.channel !== "vmeste-extension" || event.data.type !== "response" || event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.result?.error && !event.data.result.installed) reject(new Error(event.data.result.error));
      else resolve(event.data.result || { installed: true, connected: false, hasPlayer: false });
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Расширение не отвечает")); }, timeout);
    window.addEventListener("message", receive);
    window.postMessage({ channel: "vmeste-app", type, requestId, data }, window.location.origin);
  });
}
