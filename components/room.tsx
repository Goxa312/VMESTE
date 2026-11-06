"use client";
import { LanguageSwitch, useLanguage } from "./language";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, Link2, SendHorizontal, Users, WifiOff, X, Clapperboard } from "lucide-react";
import { api, forgetGuestRoom, readLocal, recordViewing, rememberRoom, RequestError, saveLocal } from "@/lib/client";
import { playbackPosition, type Snapshot, type Video } from "@/lib/shared";
import { Logo, Spinner, Empty } from "./ui";
import { TabPlayer } from "./tab-player";
import { Player } from "./player";
import { RoomBreakBar } from "./room-break-bar";
import { PlaybackDetails } from "./playback-details";
import { FriendsCenter } from "./friends-center";
import { KinogoPlayer } from "./kinogo-player";
import { RoomSourceDialog } from "./room-source-dialog";
import { extensionRequest } from "@/lib/kinogo-bridge";
import { isKinogoPage } from "@/lib/video-source";
import { VideoForm } from "./video-form";
function KinogoOption({ code, children }: { code: string; children: ReactNode }) {
  const { t } = useLanguage();
  const key = "vm-kinogo-option-" + code;
  // Only a viewer who selected Kinogo needs to contact the browser extension.
  const [selected, setSelected] = useState(() => {
    try { return sessionStorage.getItem(key) === "1"; } catch { return false; }
  });
  return <details className="legacy-source" onToggle={event => {
    if (!event.currentTarget.open || selected) return;
    setSelected(true);
    try { sessionStorage.setItem(key, "1"); } catch { /* Optional in private browsing. */ }
  }}><summary>{t("Подключить плеер Киного")}</summary>{selected && children}</details>;
}

export default function Room({ code }: { code: string }) {
  const [detailsOpen,setDetailsOpen] = useState(false), [friendsOpen,setFriendsOpen] = useState(false);
  const { t,notice,locale } = useLanguage();
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
  const clockSamples = useRef<{at:number; rtt:number; offset:number}[]>([]);
  const apply = useCallback((data: Snapshot, start: number) => {
    const previous = latest.current;
    if (previous && (data.room.revision < previous.room.revision ||
        (data.room.revision === previous.room.revision && data.serverTime < previous.serverTime))) return;
    // Participant changes have their own version. A delayed poll must not undo a return to the room.
    if (previous) {
      const old = new Map(previous.participants.map(p => [p.id, p]));
      data = { ...data, participants: data.participants.map(person => {
        const known = old.get(person.id);
        return known && known.breakChangedAt > person.breakChangedAt
          ? { ...person, onBreak: known.onBreak, breakChangedAt: known.breakChangedAt } : person;
      }) };
    }
    const now = Date.now();
    // A slow poll includes server processing time. A recent, faster round trip is a better clock sample.
    const samples = clockSamples.current.filter(s=>s.at <= now && now-s.at < 30000).slice(-24);
    samples.push({at:now,rtt:Math.max(0,now-start),offset:data.serverTime-(start+now)/2});
    clockSamples.current = samples;
    latest.current = data; serverOffset.current = samples.reduce((best,s)=>s.rtt<best.rtt?s:best).offset;
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
        if (err instanceof RequestError && [404,410].includes(err.status)) { forgetGuestRoom(code); nextToken = ""; setError(err.message); setFatal(true); }
      }
      setToken(nextToken); setName(nextName); setInitialized(true);
    };
    void restore();
    return () => { controller.abort(); window.removeEventListener("storage", reloadAccount); };
  }, [code, apply]);
  useEffect(() => {
    if (!token) return; let alive = true, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const start = Date.now();
      try {
        const data = await api<Snapshot>(`/api/rooms/${code}`, token);
        if (alive) { apply(data, start); setError(""); }
      } catch (e) {
        if (!alive) return;
        setConnected(false);
        if (e instanceof RequestError && e.status === 401) {
          if (readLocal(`vm-room-${code}`, "") === token) forgetGuestRoom(code);
          setToken(""); return;
        }
        if (e instanceof RequestError && [404, 410].includes(e.status)) {
          forgetGuestRoom(code); setToken(""); setError(e.message); setFatal(true); return;
        }
        setError("Связь прервалась. Пытаемся подключиться снова…");
      }
      if (alive) timer = setTimeout(poll, document.hidden ? 2000 : 850);
    }
    void poll(); return () => { alive = false; clearTimeout(timer); };
  }, [token, code, apply]);
  const viewing = snapshot?.room.id;
  useEffect(() => {
    if (!viewing || !token) return;
    function record(promote = false) {
      const room = latest.current?.room;
      if (!room || room.id !== code || latest.current?.accountMember || readLocal(`vm-room-${code}`, "") !== token) return;
      const duration = watchMain.current?.querySelector<HTMLVideoElement>(".video-stage video")?.duration;
      recordViewing(room, playbackPosition(room, Date.now() + serverOffset.current), duration, promote, latest.current?.me);
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
  async function changeBreak(away: boolean, previousChange: number) {
    try { await action({ action: "set-break", away, previousChange }); }
    catch (err) {
      // The write can succeed even if its reply is lost.
      await refreshRoom().catch(() => {});
      const current = latest.current;
      if (current?.participants.find(p => p.id === current.me)?.onBreak !== away) throw err;
    }
  }
  async function control(playing: boolean, position: number) { if (busyRef.current) return; busyRef.current = true; setBusy(true); try { await action({ action: "control", playing, position }); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось синхронизировать"); } finally { busyRef.current = false; setBusy(false); } }
  async function send(text: string) { if (!text.trim() || chatBusy) return; setChatBusy(true); try { await action({ action: "message", text }); setMessage(""); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось отправить"); } finally { setChatBusy(false); } }
  async function copy() {
    try { await navigator.clipboard.writeText(invite); setCopied(true); setInviteFallback(false); }
    catch { setFriendsOpen(false); setInviteFallback(true); }
  }
  function inviteFriend() { if (snapshot?.accountMember) setFriendsOpen(true); else void copy(); }
  const isHost = snapshot?.me === snapshot?.room.hostId;
  const online = snapshot?.participants.filter(p => p.online) || [];
  if (!initialized || (token && !snapshot && !fatal)) return <div className="room-loading"><LanguageSwitch/><Logo/><Spinner/><p>{notice(error) || t("Готовим ваш кинозал…")}</p><a href="/" className="text-button">{t("Вернуться в библиотеку")}</a></div>;
  if (fatal) return <div className="join-page"><LanguageSwitch/><Logo/><Empty title={t("Кинозал пока недоступен")} text={notice(error)} action={t("Вернуться в библиотеку")} onClick={() => { window.location.href = "/"; }}/></div>;
  if (!token || !snapshot) return <div className="join-page"><div className="join-background"/><LanguageSwitch/><Logo/><div className="join-card"><h1>{t("Войти в комнату")}</h1><p>{t("Представьтесь, чтобы друзья узнали вас в чате.")}</p><form onSubmit={join} className="stack-form"><label>{t("Как вас зовут?")}<input autoFocus required maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder={t("Ваше имя")}/></label>{error && <p className="error" role="alert">{notice(error)}</p>}<button className="button primary full" disabled={joining}>{joining ? <Spinner/> : t("Войти в комнату")}</button></form><a className="text-button" href="/">{t("В библиотеку")}</a></div></div>;
  const room = snapshot.room;
  async function switchToTabSharing() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      if (room.nativeSource) await action({action:"player-source",pageUrl:room.videoUrl,previousUrl:room.nativeSource.url,url:null,format:null});
      else await action({action:"video",url:room.videoUrl,title:room.videoTitle,kind:room.kind,poster:room.poster,sourceMode:"page"});
    } catch(e) { setError(e instanceof Error ? e.message : "Не удалось сменить плеер."); }
    finally { busyRef.current=false;setBusy(false); }
  }
  function openSourceSetup() {
    setSourceSetup({ pageUrl: room.videoUrl, previousUrl: room.nativeSource?.url ?? null });
  }
  const watchingKinogo = isKinogoPage(room.videoUrl);
  const needsCapture = (room.sourceMode === "page" || room.sourceMode === "local") && !room.nativeSource;
  const awaitingFile = room.sourceMode === "upload" && !room.videoUrl;
  const viewControl = <button type="button" className="view-toggle" aria-controls="room-chat" aria-expanded={!filmOnly}
    onClick={() => setFilmOnly(value => !value)}>{filmOnly ? t("Вернуть панели") : t("Только фильм")}</button>;
  const playerFooter = <RoomBreakBar snapshot={snapshot} connected={connected} capture={needsCapture ? (room.sourceMode === "local" ? "file" : "tab") : null}
    onChange={changeBreak}>{viewControl}</RoomBreakBar>;
  const roomPlayer = needsCapture
    ? <TabPlayer key={room.videoUrl} room={room} people={snapshot.participants} token={token} host={isHost} hostOnline={online.some(p => p.id === room.hostId)} connected={connected} onAction={action} onSessionChanged={refreshRoom}>
        {isHost && room.sourceMode === "page" && !watchingKinogo && <button className="text-button" onClick={openSourceSetup}>{t("Есть прямая ссылка на видео?")}</button>}
        {watchingKinogo && <KinogoOption code={code}><KinogoPlayer key={room.videoUrl} room={room} isHost={isHost} offset={offset} connected={connected}
        onControl={async (playing, position) => { await action({ action: "control", playing, position }); }} onRefresh={refreshRoom} onChooseSource={openSourceSetup}/></KinogoOption>}
      </TabPlayer>
    : awaitingFile ? <div className="live-stage"><div className="live-intro"><Clapperboard size={34}/><h2>{t("Фильм ещё загружается")}</h2><p>{isHost ? t("Выберите файл, чтобы начать просмотр в этой комнате.") : t("Плеер появится здесь, как только ведущий загрузит файл.")}</p>{isHost && <button className="button primary" onClick={() => setChange(true)}>{t("Выбрать файл")}</button>}</div></div>
    : <Player key={JSON.stringify([room.videoUrl, room.nativeSource])} room={room} isHost={isHost} offset={offset} busy={busy}
        connected={connected} onControl={control} footer={playerFooter} onChangeVideo={room.sourceMode === "page" ? openSourceSetup : () => setChange(true)}/>;
  return <div className={`room-page${filmOnly ? " film-only" : ""}`}>
    <header className="room-topbar">
      <Logo/><h1 className="room-film-title" title={room.videoTitle}>{room.videoTitle}</h1>
      <button className="invite-action" onClick={inviteFriend}>
        {copied ? <Check size={18}/> : <Link2 size={18}/>}
        <span aria-live="polite">{copied ? t("Ссылка скопирована") : t("Пригласить друга")}</span>
      </button><LanguageSwitch/>
    </header>
    <main className="room-content">
      {snapshot.accountMember && <FriendsCenter open={friendsOpen} room={code} copied={copied} copyLink={() => void copy()} onOpen={() => setFriendsOpen(true)} onClose={() => setFriendsOpen(false)}/>}
      {inviteFallback && <div className="manual-invite">
        <label htmlFor="invite-link">{t("Ссылка для друга")}</label>
        <input id="invite-link" ref={inviteInput} readOnly value={invite} onFocus={e => e.target.select()}/>
        <button className="icon-button" aria-label={t("Закрыть приглашение")} onClick={() => setInviteFallback(false)}><X size={16}/></button>
      </div>}
      {error && <div className="notice" role="alert">
        {!connected && <WifiOff size={17}/>}<span>{notice(error)}</span>
        <button aria-label={t("Закрыть сообщение")} onClick={() => setError("")}><X size={16}/></button>
      </div>}
      <div className="watch-layout">
        <div className="watch-main" ref={watchMain}>
          {roomPlayer}
          {(needsCapture || awaitingFile) && playerFooter}
        </div>
        <aside className="chat-panel" id="room-chat" aria-label={t("Панель комнаты")}>
          <div className="chat-tabs">
            <button aria-pressed={chatTab === "chat"} onClick={() => setChatTab("chat")}>{t("Чат")}</button>
            <button className="people-switch" aria-pressed={chatTab === "people"} aria-label={t("Участники")} onClick={() => setChatTab("people")}><Users size={16}/>{online.length}</button>
          </div>
          {chatTab === "chat" ? <>
            <div className="chat-messages" ref={chatList} role="log" aria-label={t("Чат комнаты")} aria-live="polite">
              {!snapshot.messages.length && <p className="chat-welcome">{t("Здесь появятся сообщения.")}</p>}
              {snapshot.messages.map(m => <div key={m.id} className="chat-message"><p>{m.body}</p>
                <div className="message-author"><span>{m.name}</span><time>{new Date(m.createdAt).toLocaleTimeString(locale, { hour:"2-digit", minute:"2-digit" })}</time></div>
              </div>)}
              <div ref={chatEnd}/>
            </div>
            <div className="chat-bottom">
              <details className="chat-reactions"><summary>{t("Реакции")}</summary><div className="reactions">
                {["❤️","😂","🍿","🔥","👏"].map(emoji => <button key={emoji} aria-label={t("Отправить реакцию {0}", emoji)} disabled={!connected || chatBusy}
                  onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void send(emoji); }}>{emoji}</button>)}
              </div></details>
              <form className="message-form" onSubmit={event => { event.preventDefault(); void send(message); }}>
                <input aria-label={t("Сообщение в чат")} placeholder={t("Сообщение в чат")} maxLength={500} value={message} onChange={e => setMessage(e.target.value)} disabled={!connected}/>
                <button aria-label={t("Отправить сообщение")} disabled={!connected || chatBusy || !message.trim()}>{chatBusy ? <Spinner/> : <SendHorizontal size={18}/>}</button>
              </form>
            </div>
          </> : <div className="people-tab">
            {snapshot.participants.filter(p => p.online || p.id === room.hostId || p.id === snapshot.me).map(p => <div className="person" key={p.id}>
              <div><strong>{p.name}{p.id === snapshot.me && t(" (вы)")}</strong>
                <span>{p.id === room.hostId ? (p.online ? t("Ведущий") : t("Ведущий · не в сети")) : (p.online ? t("В комнате") : t("Не в сети"))}</span></div>
            </div>)}
            <button className="text-link" onClick={inviteFriend}>{t("Пригласить друга в комнату")}</button>
          </div>}
        </aside>
      </div>
      <div className="room-tools">
        <span>{room.title} <span className="role-caption">· {isHost ? t("Вы ведущий") : t("Ведущий: {0}", snapshot.participants.find(p => p.id === room.hostId)?.name || t("участник"))}</span></span>
        {isHost && <div>{room.nativeSource && <button className="text-link" onClick={openSourceSetup}>{t("Источник видео")}</button>}
          {(room.sourceMode === "direct" || room.nativeSource) && <button className="text-link" disabled={busy || !connected} onClick={()=>void switchToTabSharing()}>{t("Перейти к показу вкладки")}</button>}
          <button className="text-link" onClick={() => setChange(true)}>{t("Выбрать фильм")}</button></div>}
      </div>
      <footer className="room-footer"><a href="/#library">{t("Фильмотека")}</a><button className="text-button" onClick={()=>setDetailsOpen(true)}>{t("Сведения о воспроизведении")}</button><span>{t("Комната открыта до ")}{new Date(room.expiresAt).toLocaleDateString(locale)}</span></footer>
    </main>{change && <VideoForm mode="change" uploadTarget={{ code, token, revision: room.revision }} selected={{ sourceMode: room.sourceMode, id: snapshot.room.id, title: snapshot.room.videoTitle, url: snapshot.room.videoUrl, kind: snapshot.room.kind, poster: snapshot.room.poster }} onClose={() => setChange(false)} onChangeVideo={async (v: Partial<Video>) => { await action({ action: "video", ...v }); }}/>}
    {detailsOpen && <PlaybackDetails panel={watchMain} room={room} connected={connected} host={isHost} onClose={()=>setDetailsOpen(false)}/>}
    {isHost && sourceSetup?.pageUrl === room.videoUrl && sourceSetup.previousUrl === (room.nativeSource?.url ?? null) &&
      <RoomSourceDialog room={room} offset={offset} connected={connected} onClose={() => setSourceSetup(null)}
        onApply={async source => { await action({ action: "player-source", pageUrl: sourceSetup.pageUrl, previousUrl: sourceSetup.previousUrl,
          url: source?.url ?? null, format: source?.format ?? null }); }}/>}
    </div>;
}
