"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Bookmark, Check, ChevronDown, DoorOpen, Film, Play, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { api, libraryKey, readLocal, readRecentRooms, saveLocal, type RecentRoom } from "@/lib/client";
import { listSuggestions, program } from "@/lib/program";
import { demos, formatTime, kinds, type Video } from "@/lib/shared";
import { Empty, Logo, Modal, Spinner } from "./ui";
import { VideoForm } from "./video-form";
import { AccountDialog } from "./account-dialog";
import { Rankings } from "./rankings";
import { chartFilms } from "@/lib/charts";

type Profile = { id:string; name:string };
type Overview = { user:Profile | null; rooms?:RecentRoom[]; favorites?:string[] };

type View = "home" | "library" | "saved" | "rooms";
const navigation = [["home", "Главная"], ["library", "Каталог"], ["saved", "Наш список"]] as const;
const categories = [["all", "Все"], ["film", "Фильмы"], ["series", "Сериалы"], ["anime", "Аниме"]] as const;
const normalize = (value: string) => value.trim().toLocaleLowerCase("ru").replaceAll("ё", "е");
function currentView(): View {
  const hash = window.location.hash.slice(1);
  return hash === "library" || hash === "saved" || hash === "rooms" ? hash : "home";
}
function description(film: Video) {
  return [kinds[film.kind], film.subtitle || film.duration].filter(Boolean).join(" · ");
}
function listCount(count: number) {
  const word = new Intl.PluralRules("ru").select(count);
  return count + " " + (word === "one" ? "название" : word === "few" ? "названия" : "названий");
}
function RoomEntry({room}: {room:RecentRoom}) {
  const position = room.duration && room.position ? Math.max(0,Math.ceil((room.duration-room.position)/60)) : undefined;
  const detail = [room.videoTitle, room.isHost === undefined ? "" : room.isHost ? "Вы ведущий" : "Вы участник",
    position !== undefined ? (position ? "Осталось "+position+" мин" : "Просмотрено") : room.position ? formatTime(room.position) : ""].filter(Boolean).join(" · ");
  return <a className="room-entry" href={"/room/"+room.id} aria-label={`Открыть комнату: ${room.title}, ${room.videoTitle}`}>
    {room.poster ? <img src={room.poster} alt=""/> : <span className="room-entry-symbol"><DoorOpen size={24}/></span>}
    <span><strong>{room.title}</strong><small>{detail}</small></span><ArrowRight size={17} aria-hidden="true"/>
  </a>;
}

function FilmCard({ title, poster, detail, onWatch, saved, onSave, onDelete }: {
  title: string; poster?: string; detail: string; onWatch?: () => void;
  saved?: boolean; onSave?: () => void; onDelete?: () => void;
}) {
  const content = <>
    <span className="still">
      {poster ? <img src={poster} alt="" loading="lazy"/> : <span className="missing-still"><Film size={38} aria-hidden="true"/></span>}
      <Play className="still-play" fill="currentColor" size={19} aria-hidden="true"/>
    </span>
    <strong className="film-title">{title}</strong><small className="film-detail">{detail}</small>
  </>;
  return <article className="film-card">
    <button className="film-choice" aria-label={`Смотреть: ${title}`} onClick={onWatch}>{content}</button>
    {(onSave || onDelete) && <div className="film-tools">
      {onSave && <button className="card-tool" aria-label={`${saved ? "Убрать из списка" : "В список"}: ${title}`} aria-pressed={saved} onClick={onSave}>
        {saved ? <Check size={16}/> : <Plus size={16}/>}</button>}
      {onDelete && <button className="card-tool" aria-label={`Удалить из каталога: ${title}`} onClick={onDelete}><Trash2 size={15}/></button>}
    </div>}
  </article>;
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [search, setSearch] = useState(""), [sort, setSort] = useState("new"), [category, setCategory] = useState("all");
  const [videos, setVideos] = useState<Video[]>([]), [favorites, setFavorites] = useState<string[]>([]), [recent, setRecent] = useState<RecentRoom[]>([]);
  const [modal, setModal] = useState<"create" | "add" | "join" | "help" | null>(null), [selected, setSelected] = useState<Video>();
  const [initialTab, setInitialTab] = useState<"link" | "file">("link"), [toast, setToast] = useState("");
  const [libraryError, setLibraryError] = useState(""), [loading, setLoading] = useState(true), [interactive, setInteractive] = useState(false);
  const [joinCode, setJoinCode] = useState(""), [joinError, setJoinError] = useState("");
  const [guestRooms, setGuestRooms] = useState<RecentRoom[]>([]);
  const [movingRooms, setMovingRooms] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [user, setUser] = useState<Profile | null>(null);
  const [auth, setAuth] = useState<"login" | "register" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingFavorites = useRef(new Set<string>());
  const accountState = useRef<Profile | null>(null);
  const menu = useRef<HTMLDivElement>(null), menuButton = useRef<HTMLButtonElement>(null), searchInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ videos: Video[] }>("/api/library", libraryKey());
      setVideos(data.videos); setLibraryError("");
    } catch { setLibraryError("Не удалось загрузить ваши фильмы."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let alive = true;
    const restoreGuest = () => {
      const saved = readLocal<unknown>("vm-favorites", []);
      setFavorites(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
      setRecent(readRecentRooms());
    };
    const restore = async () => {
      try {
        const data = await api<Overview>("/api/account");
        if (!alive) return;
        accountState.current = data.user; setUser(data.user); setProfileError(""); setInteractive(true);
        if (data.user) { setRecent(data.rooms || []); setFavorites(data.favorites || []); setGuestRooms(readRecentRooms().filter(room => readLocal(`vm-room-${room.id}`, ""))); }
        else restoreGuest();
      } catch { if (alive) { setProfileError("Не удалось загрузить профиль и комнаты."); setInteractive(false); } }
      if (alive) void load();
    };
    const onReturn = (event:PageTransitionEvent) => { if (event.persisted) void restore(); };
    const navigate = () => { setView(currentView()); setCategory("all"); setSearch(""); setMenuOpen(false); };
    const showSection = () => { navigate(); window.scrollTo({ top: 0, behavior: "instant" }); };
    const sync = (event: StorageEvent) => {
      if (event.key === "vm-account-change") { window.location.reload(); return; }
      if (!accountState.current && (event.key === "vm-recent" || event.key === "vm-favorites" || !event.key)) restoreGuest();
    };
    navigate(); void restore();
    window.addEventListener("hashchange", showSection); window.addEventListener("storage", sync); window.addEventListener("pageshow", onReturn);
    return () => {
      alive = false; window.removeEventListener("hashchange", showSection); window.removeEventListener("storage", sync); window.removeEventListener("pageshow", onReturn);
    };
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  async function importRooms() {
    if (!user || movingRooms) return;
    setMovingRooms(true);
    try {
      const rooms = guestRooms.map(({id})=>({id,token:readLocal(`vm-room-${id}`,"")}));
      const result = await api<{ids:string[]}>("/api/account/rooms",undefined,{rooms});
      if (!result.ids.length) { setToast("Нет доступных гостевых комнат для переноса."); return; }
      result.ids.forEach(id=>saveLocal(`vm-room-${id}`,""));
      saveLocal("vm-recent",readRecentRooms().filter(room=>!result.ids.includes(room.id)));
      accountChanged();
    } catch (err) { setToast(err instanceof Error?err.message:"Не удалось перенести комнаты."); }
    finally { setMovingRooms(false); }
  }
  function accountChanged() { saveLocal("vm-account-change", crypto.randomUUID()); window.location.reload(); }
  async function logout() {
    try { await api("/api/account", undefined, {action:"logout"}); accountChanged(); }
    catch { setToast("Не удалось выйти. Попробуйте ещё раз."); }
  }
  async function favorite(id: string) {
    if (!interactive || pendingFavorites.current.has(id)) return;
    const saved = !favorites.includes(id);
    pendingFavorites.current.add(id);
    try {
      if (user) await api("/api/account/favorites", undefined, { id, saved });
      setFavorites(old => {
        const next = saved ? [...old.filter(value=>value!==id),id] : old.filter(value=>value!==id);
        if (!user) saveLocal("vm-favorites",next);
        return next;
      });
    } catch (e) { setToast(e instanceof Error ? e.message : "Не удалось изменить список."); }
    finally { pendingFavorites.current.delete(id); }
  }
  async function deleteFilm(id: string) {
    try {
      await api("/api/library", libraryKey(), { id }, "DELETE");
      setVideos(old => old.filter(film => film.id !== id));
      if (favorites.includes(id)) favorite(id);
    } catch { setToast("Не удалось удалить фильм."); }
  }
  function create(video?: Video, tab: "link" | "file" = "link") {
    if (!interactive) { setToast("Сначала дождитесь загрузки профиля."); return; }
    setMenuOpen(false); setSelected(video); setInitialTab(tab); setModal("create");
  }
  function watch(film: Video) {
    if (!film.url) {
      const match = (title: string) => normalize(title) === normalize(film.title);
      const room = recent.find(room => match(room.videoTitle));
      if (room) { window.location.assign("/room/" + room.id); return; }
      const source = videos.find(video => video.url && match(video.title));
      if (source) { create({ ...source, poster: source.poster || film.poster }); return; }
    }
    create(film);
  }
  function join(event: FormEvent) {
    event.preventDefault();
    let code = joinCode.trim();
    try { if (code.includes("/")) code = new URL(code).pathname.split("/").filter(Boolean).pop() || ""; }
    catch { /* The code check below also covers invalid invitation URLs. */ }
    if (!/^[a-z0-9]{12}$/.test(code)) { setJoinError("Вставьте приглашение или код комнаты из 12 символов."); return; }
    window.location.assign("/room/" + code);
  }
  function resetNavigation() { setSearch(""); setCategory("all"); setMenuOpen(false); }
  const query = normalize(search);
  const isCatalog = Boolean(query) || view === "library" || view === "saved";
  const catalog = [...videos, ...program, ...demos];
  const allFilms = [...catalog, ...chartFilms];
  const savedFilms = favorites.flatMap(id => { const film = allFilms.find(item => item.id === id); return film ? [film] : []; });
  const searchable = query ? [...catalog, ...chartFilms.filter(item => !catalog.some(film => film.kind === item.kind && normalize(film.title) === normalize(item.title)))] : catalog;
  const films = (view === "saved" && !query ? savedFilms : searchable).filter(film =>
    (category === "all" || film.kind === category) && (!query || normalize(film.title + " " + description(film)).includes(query)));
  if (sort === "az") films.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const chartResults = films.filter(film => film.id.startsWith("chart-"));
  const gallery = films.filter(film => !film.id.startsWith("chart-"));
  const lowerShelf = savedFilms.length ? savedFilms.slice(0, 2) : listSuggestions;

  return <div className="cinema-home">
    <header className="cinema-header">
      <Logo/>
      <nav className="main-nav" aria-label="Основное меню">{navigation.map(([key, label]) =>
        <a key={key} href={"#" + key} onClick={resetNavigation} aria-current={(query ? key === "library" : view === key) ? "page" : undefined}>{label}</a>)}<button className="create-nav" disabled={!interactive} onClick={()=>create()}><Plus size={16}/>Создать комнату</button></nav>
      <div className="header-search">
        <Search size={23} aria-hidden="true"/><input type="search" ref={searchInput} aria-label="Найти фильм или сериал" placeholder="Найти фильм или сериал" value={search} onChange={e => { setSearch(e.target.value); setCategory("all"); setMenuOpen(false); }}/>
        {search && <button type="button" aria-label="Очистить поиск" onClick={() => { setSearch(""); searchInput.current?.focus(); }}><X size={17}/></button>}
      </div>
      <div className="profile" ref={menu}>
        {user ? <>
          <button ref={menuButton} className="account-trigger" aria-label={`Профиль: ${user.name}`} aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}><UserRound size={18}/><span>{user.name}</span><ChevronDown size={14}/></button>
          {menuOpen && <div className="profile-menu" id="viewing-menu"><a href="#rooms" onClick={resetNavigation}>Мои комнаты</a>
            <button onClick={()=>{setMenuOpen(false);setJoinError("");setModal("join");}}>Войти по коду</button>
            <button onClick={()=>void logout()}>Выйти из аккаунта</button></div>}
        </> : <div className="account-links"><button disabled={!interactive} onClick={()=>setAuth("login")}>Вход</button><span aria-hidden="true">/</span><button disabled={!interactive} onClick={()=>setAuth("register")}>Регистрация</button></div>}
      </div>
    </header>
    <main className="cinema-main">
      {profileError && <p className="notice" role="alert">{profileError}<button onClick={()=>window.location.reload()}>Повторить</button></p>}
      {view === "home" && !query && <>
        <Rankings onWatch={watch} favorites={favorites} onSave={favorite}/>
        <section className="screenings rooms-strip" aria-labelledby="screenings-title">
          <div className="section-heading"><h2 id="screenings-title">Мои комнаты</h2>
            {recent.length>3 && <a className="rank-more" href="#rooms">Все комнаты <ArrowRight size={16}/></a>}</div>
          {recent.length ? <div className="room-entries">{recent.slice(0,3).map(room=><RoomEntry key={room.id} room={room}/>)}</div> :
            <p className="rooms-empty">{profileError || (interactive ? "Здесь появятся комнаты, которые вы создадите или посетите по приглашению." : "Загружаем комнаты…")}</p>}
          {!!user && guestRooms.length>0 && <button className="text-link import-rooms" disabled={movingRooms} onClick={()=>void importRooms()}>{movingRooms?"Переносим комнаты…":"Перенести мои гостевые комнаты в профиль"}</button>}
        </section>
        <section className="list-shelf" aria-labelledby="shelf-title">
          <div className="shelf-heading"><a href="#saved" id="shelf-title"><h2>Наш список</h2></a><small>{savedFilms.length ? listCount(savedFilms.length) : "Пока пусто"}</small></div>
          {lowerShelf.map(film => <article className="shelf-entry" key={film.id}>
            <button className="shelf-choice" aria-label={`Смотреть: ${film.title}`} onClick={() => watch(film)}>
              {film.poster ? <img src={film.poster} alt="" loading="lazy"/> : <span className="shelf-fallback"><Film size={21}/></span>}
              <span><strong>{film.title}</strong><small>{description(film)}</small></span></button>
            {!savedFilms.length && <button className="shelf-add" aria-label={`В список: ${film.title}`} onClick={() => favorite(film.id)}><Plus size={16}/></button>}
          </article>)}
        </section>
      </>}
      {isCatalog && <section className="catalog">
        <div className="section-heading"><h1>{query ? "Результаты поиска" : view === "saved" ? "Наш список" : "Каталог"}</h1>
          <button className="catalog-add" onClick={() => { setSelected(undefined); setModal("add"); }}><Plus size={17}/>Добавить фильм</button></div>
        <div className="catalog-tools"><div className="catalog-filters" role="group" aria-label="Жанр просмотра">{categories.map(([key, label]) =>
          <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}</div>
          <label className="sort-label"><select aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}><option value="new">По умолчанию</option><option value="az">От А до Я</option></select><ChevronDown size={14} aria-hidden="true"/></label></div>
        {libraryError && <p className="notice">{libraryError}<button onClick={() => void load()}>Повторить</button></p>}
        {loading && <div className="loading-small"><Spinner/>Загружаем ваши фильмы…</div>}
        {films.length > 0 && <>{gallery.length > 0 && <div className="film-grid">{gallery.map(film => <FilmCard key={film.id} title={film.title} poster={film.poster} detail={description(film)}
          saved={favorites.includes(film.id)} onWatch={() => watch(film)} onSave={() => favorite(film.id)} onDelete={film.demo ? undefined : () => void deleteFilm(film.id)}/>)}</div>}
          {chartResults.length>0 && <div className="chart-results">{chartResults.map(film=><article key={film.id}>
            <button className="result-title" onClick={()=>watch(film)}><strong>{film.title}</strong><small>{kinds[film.kind]}</small></button>
            <button className="rank-save" aria-pressed={favorites.includes(film.id)} aria-label={`${favorites.includes(film.id)?"Убрать из списка":"В список"}: ${film.title}`} onClick={()=>void favorite(film.id)}><Bookmark size={17}/></button>
          </article>)}</div>}</>}
        {!films.length && !loading && <Empty title={query ? "Ничего не найдено" : view === "saved" && !savedFilms.length ? "Список пока пуст" : "Здесь пока нет фильмов"}
            text={query ? "Попробуйте другое название или жанр." : "Добавьте фильм кнопкой «В список» в каталоге."} action={view === "saved" && !query ? "Открыть каталог" : undefined} onClick={() => { window.location.hash = "library"; }}/>}
      </section>}
      {view === "rooms" && !query && <section className="catalog">
        <div className="section-heading"><h1>Мои комнаты</h1></div>
        {recent.length ? <div className="room-entries">{recent.map(room=><RoomEntry key={room.id} room={room}/>)}</div> : <Empty title="Здесь появятся ваши комнаты" text="Создайте комнату или откройте приглашение друга."/>}
      </section>}
      <footer className="cinema-footer"><a href="#rooms" onClick={resetNavigation}>Мои комнаты</a><button onClick={() => { setJoinError(""); setModal("join"); }}>Войти по коду</button><button onClick={() => setModal("help")}>Как смотреть вместе</button></footer>
    </main>
    {auth && <AccountDialog initial={auth} onClose={()=>setAuth(null)} onSuccess={accountChanged}/>}
    {(modal === "create" || modal === "add") && <VideoForm accountName={user?.name} key={modal} mode={modal} initialTab={modal === "add" ? "link" : initialTab} selected={selected} onFileRoom={() => create(undefined, "file")} onClose={() => setModal(null)} onSaved={video => { setVideos(old => [video, ...old]); setToast("Фильм добавлен"); }}/>}
    {modal === "join" && <Modal title="Войти в комнату" caption="Вставьте приглашение или код, который прислал ведущий." onClose={() => setModal(null)}>
      <form className="stack-form" onSubmit={join}><label>Приглашение<input autoFocus required value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Ссылка или код комнаты"/></label>
        {joinError && <p className="error" role="alert">{joinError}</p>}<button className="button primary full">Войти</button></form></Modal>}
    {modal === "help" && <Modal title="Как смотреть вместе" onClose={() => setModal(null)}>
      <div className="help-steps"><p><b>Выберите фильм</b>Добавьте ссылку или файл через «Создать комнату». Для карточек из подборки понадобится ваш источник. У короткометражек в каталоге он уже есть.</p>
        <p><b>Пригласите друга</b>Скопируйте ссылку в комнате и отправьте её другу. Приглашение действует семь дней.</p><p><b>Смотрите вместе</b>Ведущий управляет воспроизведением. Фильмом с другого сайта можно поделиться через показ вкладки.</p></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
