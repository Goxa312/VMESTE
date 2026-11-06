"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, Link2, SendHorizontal, Users, WifiOff, X, Clapperboard } from "lucide-react";
import { api, readLocal, readRecentRooms, recordViewing, rememberRoom, RequestError, saveLocal } from "@/lib/client";
import { playbackPosition, type Snapshot, type Video } from "@/lib/shared";
import { Logo, Spinner, Empty } from "./ui";
import { TabPlayer } from "./tab-player";
import { Player } from "./player";
import { KinogoPlayer } from "./kinogo-player";
import { RoomSourceDialog } from "./room-source-dialog";
import { extensionRequest } from "@/lib/kinogo-bridge";
import { isKinogoPage } from "@/lib/video-source";
import { VideoForm } from "./video-form";
function KinogoOption({ code, children }: { code: string; children: ReactNode }) {
  const key = "vm-kinogo-option-" + code;
  // Only a viewer who selected Kinogo needs to contact the browser extension.
  const [selected, setSelected] = useState(() => {
    try { return sessionStorage.getItem(key) === "1"; } catch { return false; }
  });
  return <details className="legacy-source" onToggle={event => {
    if (!event.currentTarget.open || selected) return;
    setSelected(true);
    try { sessionStorage.setItem(key, "1"); } catch { /* Optional in private browsing. */ }
  }}><summary>Подключить плеер Киного</summary>{selected && children}</details>;
}

export default function Room({ code }: { code: string }) {
  const [token, setToken] = useState(""), [initialized, setInitialized] = useState(false), [snapshot, setSnapshot] = useState<Snapshot>(), [name, setName] = useState(""), [error, setError] = useState(""), [fatal, setFatal] = useState(false), [connected, setConnected] = useState(false), [joining, setJoining] = useState(false), [busy, setBusy] = useState(false), [chatBusy, setChatBusy] = useState(false), [message, setMessage] = useState(""), [change, setChange] = useState(false), [copied, setCopied] = useState(false), [invite, setInvite] = useState("");
  const [filmOnly, setFilmOnly] = useState(false);
  const [inviteFallback, setInviteFallback] = useState(false);
  const inviteInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (inviteFallback) { inviteInput.current?.focus(); inviteInput.current?.select(); } }, [inviteFallback]);
  const [offset, setOffset] = useState(0), [chatTab, setChatTab] = useState<"chat" | "people">("chat");
  const [sourceSetup, setSourceSetup] = useState<{ pageUrl: string; previousUrl: string | null } | null>(null);
  const mediaUrl = snapshot?.room.nativeSource?.url;
  useEffect(() => { setSourceSetup(null); }, [code, snapshot?.room.videoUrl, mediaUrl]);
  useEffect(() => {
    if (mediaUrl) void extensionRequest("disconnect", { forRoomPlayer: true }).catch(() => {});
  }, [code, mediaUrl]);
  const latest = useRef<Snapshot | undefined>(undefined), chatEnd = useRef<HTMLDivElement>(null), chatList = useRef<HTMLDivElement>(null), busyRef = useRef(false), lastSeenMessage = useRef<number | undefined>(undefined);
  const watchMain = useRef<HTMLDivElement>(null);
  const serverOffset = useRef(0);
  const apply = useCallback((data: Snapshot, start: number) => {
    if (latest.current && data.room.revision < latest.current.room.revision) return;
    latest.current = data; serverOffset.current = data.serverTime - (start + Date.now()) / 2;
    setSnapshot(data); setOffset(serverOffset.current); setConnected(true);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const reloadAccount = (event: StorageEvent) => { if (event.key === "vm-account-change") window.location.reload(); };
    window.addEventListener("storage", reloadAccount);
    setInvite(window.location.href.split("?")[0]);
    const restore = async () => {
      const start = Date.now();
      let nextToken = readLocal(`vm-room-${code}`, ""), nextName = readLocal("vm-name", "");
      try {
        const result = await api<(Snapshot & {token:string}) | {token:null; name?:string}>(`/api/rooms/${code}`, undefined, { resume:true }, "POST", controller.signal);
        if (controller.signal.aborted) return;
        if (result.token !== null) { nextToken = result.token; apply(result, start); }
        else if (result.name) nextName = result.name;
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof RequestError && [404,410].includes(err.status)) { setError(err.message); setFatal(true); }
      }
      setToken(nextToken); setName(nextName); setInitialized(true);
    };
    void restore();
    return () => { controller.abort(); window.removeEventListener("storage", reloadAccount); };
  }, [code, apply]);
  useEffect(() => {
    if (!token) return; let alive = true, timer: ReturnType<typeof setTimeout>;
    async function poll() { const start = Date.now(); try { const data = await api<Snapshot>(`/api/rooms/${code}`, token); if (alive) { apply(data, start); setError(""); } } catch (e) { if (alive) { setConnected(false); if (e instanceof RequestError && e.status === 401) { setToken(""); saveLocal(`vm-room-${code}`, ""); } else if (e instanceof RequestError && [404, 410].includes(e.status)) { setError(e.message); setFatal(true); saveLocal("vm-recent", readRecentRooms().filter(room => room.id !== code)); return; } else setError("Связь прервалась. Пытаемся подключиться снова…"); } } if (alive) timer = setTimeout(poll, document.hidden ? 2000 : 850); }
    void poll(); return () => { alive = false; clearTimeout(timer); };
  }, [token, code, apply]);
  const viewing = snapshot?.room.id;
  useEffect(() => {
    if (!viewing || !token) return;
    function record(promote = false) {
      const room = latest.current?.room;
      if (!room || room.id !== code || latest.current?.accountMember) return;
      const duration = watchMain.current?.querySelector<HTMLVideoElement>(".video-stage video")?.duration;
      recordViewing(room, playbackPosition(room, Date.now() + serverOffset.current), duration, promote);
    }
    record(true);
    const checkpoint = () => record();
    const player = watchMain.current;
    const interval = setInterval(checkpoint, 10000);
    player?.addEventListener("loadedmetadata", checkpoint, true);
    player?.addEventListener("seeked", checkpoint, true);
    player?.addEventListener("pause", checkpoint, true);
    document.addEventListener("visibilitychange", checkpoint);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      checkpoint(); clearInterval(interval);
      player?.removeEventListener("loadedmetadata", checkpoint, true);
      player?.removeEventListener("seeked", checkpoint, true);
      player?.removeEventListener("pause", checkpoint, true);
      document.removeEventListener("visibilitychange", checkpoint);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [code, viewing, token]);
  const lastMessage = snapshot?.messages.at(-1)?.id;
  useEffect(() => { const box = chatList.current; if (box && (lastSeenMessage.current === undefined || box.scrollHeight - box.clientHeight - box.scrollTop < 120 || latest.current?.messages.at(-1)?.participantId === latest.current?.me)) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" }); lastSeenMessage.current = lastMessage; }, [lastMessage, chatTab]);
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 2500); return () => clearTimeout(timer); } }, [copied]);
  async function join(e: FormEvent) { e.preventDefault(); setJoining(true); setError(""); const start = Date.now(); try { const data = await api<Snapshot & { token: string }>(`/api/rooms/${code}`, undefined, { name }); rememberRoom(data); if (!data.accountMember) saveLocal("vm-name", name); apply(data, start); setToken(data.token); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось войти"); } finally { setJoining(false); } }
  async function action(data: Record<string, unknown>) { const start = Date.now(); const result = await api<Snapshot & { startedShare?: string }>(`/api/rooms/${code}/actions`, token, { ...data, revision: latest.current?.room.revision }); apply(result, start); return result; }
  const refreshRoom = useCallback(async () => {
    const start = Date.now();
    const data = await api<Snapshot>(`/api/rooms/${code}`, token);
    apply(data, start);
    return { room: data.room, offset: data.serverTime - (start + Date.now()) / 2 };
  }, [code, token, apply]);
  async function control(playing: boolean, position: number) { if (busyRef.current) return; busyRef.current = true; setBusy(true); try { await action({ action: "control", playing, position }); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось синхронизировать"); } finally { busyRef.current = false; setBusy(false); } }
  async function send(text: string) { if (!text.trim() || chatBusy) return; setChatBusy(true); try { await action({ action: "message", text }); setMessage(""); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось отправить"); } finally { setChatBusy(false); } }
  async function copy() {
    try { await navigator.clipboard.writeText(invite); setCopied(true); setInviteFallback(false); }
    catch { setInviteFallback(true); }
  }
  const isHost = snapshot?.me === snapshot?.room.hostId;
  const online = snapshot?.participants.filter(p => p.online) || [];
  if (!initialized || (token && !snapshot && !fatal)) return <div className="room-loading"><Logo/><Spinner/><p>{error || "Готовим ваш кинозал…"}</p><a href="/" className="text-button">Вернуться в библиотеку</a></div>;
  if (fatal) return <div className="join-page"><Logo/><Empty title="Кинозал пока недоступен" text={error} action="Вернуться в библиотеку" onClick={() => { window.location.href = "/"; }}/></div>;
  if (!token || !snapshot) return <div className="join-page"><div className="join-background"/><Logo/><div className="join-card"><h1>Войти в комнату</h1><p>Представьтесь, чтобы друзья узнали вас в чате.</p><form onSubmit={join} className="stack-form"><label>Как вас зовут?<input autoFocus required maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя"/></label>{error && <p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={joining}>{joining ? <Spinner/> : "Войти в комнату"}</button></form><a className="text-button" href="/">В библиотеку</a></div></div>;
  const room = snapshot.room;
  function openSourceSetup() {
    setSourceSetup({ pageUrl: room.videoUrl, previousUrl: room.nativeSource?.url ?? null });
  }
  const watchingKinogo = isKinogoPage(room.videoUrl);
  const needsCapture = (room.sourceMode === "page" || room.sourceMode === "local") && !room.nativeSource;
  const awaitingFile = room.sourceMode === "upload" && !room.videoUrl;
  const viewControl = <button type="button" className="view-toggle" aria-controls="room-chat" aria-expanded={!filmOnly}
    onClick={() => setFilmOnly(value => !value)}>{filmOnly ? "Вернуть панели" : "Только фильм"}</button>;
  const roomPlayer = needsCapture
    ? <TabPlayer key={room.videoUrl} room={room} token={token} host={isHost} hostOnline={online.some(p => p.id === room.hostId)} connected={connected} onAction={action} onSessionChanged={refreshRoom}>
        {isHost && room.sourceMode === "page" && !watchingKinogo && <button className="text-button" onClick={openSourceSetup}>Есть прямая ссылка на видео?</button>}
        {watchingKinogo && <KinogoOption code={code}><KinogoPlayer key={room.videoUrl} room={room} isHost={isHost} offset={offset} connected={connected}
        onControl={async (playing, position) => { await action({ action: "control", playing, position }); }} onRefresh={refreshRoom} onChooseSource={openSourceSetup}/></KinogoOption>}
      </TabPlayer>
    : awaitingFile ? <div className="live-stage"><div className="live-intro"><Clapperboard size={34}/><h2>Фильм ещё загружается</h2><p>{isHost ? "Выберите файл, чтобы начать просмотр в этой комнате." : "Плеер появится здесь, как только ведущий загрузит файл."}</p>{isHost && <button className="button primary" onClick={() => setChange(true)}>Выбрать файл</button>}</div></div>
    : <Player key={JSON.stringify([room.videoUrl, room.nativeSource])} room={room} isHost={isHost} offset={offset} busy={busy}
        connected={connected} onControl={control} viewControl={viewControl} onChangeVideo={room.sourceMode === "page" ? openSourceSetup : () => setChange(true)}/>;
  return <div className={`room-page${filmOnly ? " film-only" : ""}`}>
    <header className="room-topbar">
      <Logo/><h1 className="room-film-title" title={room.videoTitle}>{room.videoTitle}</h1>
      <button className="invite-action" onClick={() => void copy()}>
        {copied ? <Check size={18}/> : <Link2 size={18}/>}
        <span aria-live="polite">{copied ? "Ссылка скопирована" : "Пригласить друга"}</span>
      </button>
    </header>
    <main className="room-content">
      {inviteFallback && <div className="manual-invite">
        <label htmlFor="invite-link">Ссылка для друга</label>
        <input id="invite-link" ref={inviteInput} readOnly value={invite} onFocus={e => e.target.select()}/>
        <button className="icon-button" aria-label="Закрыть приглашение" onClick={() => setInviteFallback(false)}><X size={16}/></button>
      </div>}
      {error && <div className="notice" role="alert">
        {!connected && <WifiOff size={17}/>}<span>{error}</span>
        <button aria-label="Закрыть сообщение" onClick={() => setError("")}><X size={16}/></button>
      </div>}
      <div className="watch-layout">
        <div className="watch-main" ref={watchMain}>
          {roomPlayer}
          {(needsCapture || awaitingFile) && <div className="live-view-bar">{viewControl}</div>}
        </div>
        <aside className="chat-panel" id="room-chat" aria-label="Панель комнаты">
          <div className="chat-tabs">
            <button aria-pressed={chatTab === "chat"} onClick={() => setChatTab("chat")}>Чат</button>
            <button className="people-switch" aria-pressed={chatTab === "people"} aria-label="Участники" onClick={() => setChatTab("people")}><Users size={16}/>{online.length}</button>
          </div>
          {chatTab === "chat" ? <>
            <div className="chat-messages" ref={chatList} role="log" aria-label="Чат комнаты" aria-live="polite">
              {!snapshot.messages.length && <p className="chat-welcome">Здесь появятся сообщения.</p>}
              {snapshot.messages.map(m => <div key={m.id} className="chat-message"><p>{m.body}</p>
                <div className="message-author"><span>{m.name}</span><time>{new Date(m.createdAt).toLocaleTimeString("ru", { hour:"2-digit", minute:"2-digit" })}</time></div>
              </div>)}
              <div ref={chatEnd}/>
            </div>
            <div className="chat-bottom">
              <details className="chat-reactions"><summary>Реакции</summary><div className="reactions">
                {["❤️","😂","🍿","🔥","👏"].map(emoji => <button key={emoji} aria-label={`Отправить реакцию ${emoji}`} disabled={!connected || chatBusy}
                  onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void send(emoji); }}>{emoji}</button>)}
              </div></details>
              <form className="message-form" onSubmit={event => { event.preventDefault(); void send(message); }}>
                <input aria-label="Сообщение в чат" placeholder="Сообщение в чат" maxLength={500} value={message} onChange={e => setMessage(e.target.value)} disabled={!connected}/>
                <button aria-label="Отправить сообщение" disabled={!connected || chatBusy || !message.trim()}>{chatBusy ? <Spinner/> : <SendHorizontal size={18}/>}</button>
              </form>
            </div>
          </> : <div className="people-tab">
            {snapshot.participants.filter(p => p.online || p.id === room.hostId || p.id === snapshot.me).map(p => <div className="person" key={p.id}>
              <div><strong>{p.name}{p.id === snapshot.me && " (вы)"}</strong>
                <span>{p.id === room.hostId ? (p.online ? "Ведущий" : "Ведущий · не в сети") : (p.online ? "В комнате" : "Не в сети")}</span></div>
            </div>)}
            <button className="text-link" onClick={() => void copy()}>Пригласить друга в комнату</button>
          </div>}
        </aside>
      </div>
      <div className="room-tools">
        <span>{room.title} <span className="role-caption">· {isHost ? "Вы ведущий" : `Ведущий: ${snapshot.participants.find(p => p.id === room.hostId)?.name || "участник"}`}</span></span>
        {isHost && <div>{room.nativeSource && <button className="text-link" onClick={openSourceSetup}>Источник видео</button>}
          <button className="text-link" onClick={() => setChange(true)}>Выбрать фильм</button></div>}
      </div>
      <footer className="room-footer"><a href="/#library">Фильмотека</a><span>Комната открыта до {new Date(room.expiresAt).toLocaleDateString("ru")}</span></footer>
    </main>{change && <VideoForm mode="change" uploadTarget={{ code, token, revision: room.revision }} selected={{ sourceMode: room.sourceMode, id: snapshot.room.id, title: snapshot.room.videoTitle, url: snapshot.room.videoUrl, kind: snapshot.room.kind, poster: snapshot.room.poster }} onClose={() => setChange(false)} onChangeVideo={async (v: Partial<Video>) => { await action({ action: "video", ...v }); }}/>}
    {isHost && sourceSetup?.pageUrl === room.videoUrl && sourceSetup.previousUrl === (room.nativeSource?.url ?? null) &&
      <RoomSourceDialog room={room} offset={offset} connected={connected} onClose={() => setSourceSetup(null)}
        onApply={async source => { await action({ action: "player-source", pageUrl: sourceSetup.pageUrl, previousUrl: sourceSetup.previousUrl,
          url: source?.url ?? null, format: source?.format ?? null }); }}/>}
    </div>;
}
