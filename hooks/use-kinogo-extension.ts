"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_EXTENSION, extensionRequest, type ExtensionStatus } from "@/lib/kinogo-bridge";

export function useKinogoExtension(playback?: () => unknown) {
  const [extension, setExtension] = useState<ExtensionStatus>(EMPTY_EXTENSION);
  const [checking, setChecking] = useState(true), [reachable, setReachable] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const current = useRef(playback); current.current = playback;
  const checkRef = useRef<() => void>(() => {});
  const check = useCallback(() => { setChecking(true); checkRef.current(); }, []);
  useEffect(() => {
    let alive = true, pending = false, timer: ReturnType<typeof setTimeout>;
    async function update() {
      if (!alive || pending) return;
      clearTimeout(timer); pending = true;
      try {
        const snapshot = current.current?.();
        const result = await extensionRequest(snapshot ? "state" : "ping", snapshot);
        if (alive) { setExtension(result); setReachable(true); setConnectionError(""); }
      } catch (error) {
        if (alive) { setReachable(false); setConnectionError(error instanceof Error ? error.message : "Нет ответа от расширения"); }
      } finally {
        pending = false;
        if (alive) { setChecking(false); timer = setTimeout(update, current.current ? 1000 : 3000); }
      }
    }
    const onReady = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.channel === "vmeste-extension" && event.data.type === "ready") void update();
    };
    const focus = () => { if (document.visibilityState === "visible") void update(); };
    checkRef.current = () => void update();
    window.addEventListener("message", onReady);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    void update();
    return () => {
      alive = false; clearTimeout(timer); checkRef.current = () => {};
      window.removeEventListener("message", onReady); window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      // A React remount or browser refresh must not disconnect the film.
      // The background owns cleanup when a room tab closes or changes its URL.
    };
  }, []);
  return { extension, setExtension, checking, reachable, connectionError, check };
}
