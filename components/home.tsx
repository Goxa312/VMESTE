"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, Film, Play, Plus, Search, Trash2, X } from "lucide-react";
import { api, libraryKey, readLocal, readRecentRooms, saveLocal, type RecentRoom } from "@/lib/client";
import { eveningFilms, listSuggestions, program, tonight } from "@/lib/program";
import { demos, formatTime, kinds, type Video } from "@/lib/shared";
import { Empty, Logo, Modal, Spinner } from "./ui";
import { VideoForm } from "./video-form";

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
function recentCaption(room: RecentRoom) {
  if (room.live) return "Трансляция · " + room.title;
  const kind = room.kind ? kinds[room.kind] : "Комната";
  if (room.duration && room.position) {
    const minutes = Math.ceil((room.duration - room.position) / 60);
    return kind + (minutes > 0 ? " · Осталось " + minutes + " мин" : " · Просмотрено");
  }
  return kind + " · " + (room.position ? formatTime(room.position) : room.title);
}

function FilmCard({ title, poster, detail, href, onWatch, progress, saved, onSave, onDelete }: {
  title: string; poster?: string; detail: string; href?: string; onWatch?: () => void; progress?: number;
  saved?: boolean; onSave?: () => void; onDelete?: () => void;
}) {
  const content = <>
    <span className="still">
      {poster ? <img src={poster} alt="" loading="lazy"/> : <span className="missing-still"><Film size={38} aria-hidden="true"/></span>}
      <Play className="still-play" fill="currentColor" size={19} aria-hidden="true"/>
      {progress !== undefined && <span className="still-track" aria-hidden="true"><span style={{ width: Math.min(100, Math.max(0, progress)) + "%" }}/></span>}
    </span>
    <strong className="film-title">{title}</strong><small className="film-detail">{detail}</small>
  </>;
  return <article className="film-card">
    {href ? <a className="film-choice" aria-label={`Продолжить просмотр: ${title}`} href={href}>{content}</a> :
      <button className="film-choice" aria-label={`Смотреть: ${title}`} onClick={onWatch}>{content}</button>}
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
  const [menuOpen, setMenuOpen] = useState(false);
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
    const restore = () => {
      const saved = readLocal<unknown>("vm-favorites", []);
      setFavorites(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
      setRecent(readRecentRooms());
    };
    const navigate = () => { setView(currentView()); setCategory("all"); setSearch(""); setMenuOpen(false); };
    const showSection = () => { navigate(); window.scrollTo({ top: 0, behavior: "instant" }); };
    const sync = (event: StorageEvent) => { if (event.key === "vm-recent" || event.key === "vm-favorites" || !event.key) restore(); };
    restore(); navigate(); setInteractive(true); void load();
    window.addEventListener("hashchange", showSection); window.addEventListener("storage", sync); window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("hashchange", showSection); window.removeEventListener("storage", sync); window.removeEventListener("pageshow", restore);
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

  function favorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
    setFavorites(next); saveLocal("vm-favorites", next);
  }
  async function deleteFilm(id: string) {
    try {
      await api("/api/library", libraryKey(), { id }, "DELETE");
      setVideos(old => old.filter(film => film.id !== id));
      if (favorites.includes(id)) favorite(id);
    } catch { setToast("Не удалось удалить фильм."); }
  }
  function create(video?: Video, tab: "link" | "file" = "link") {
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
  const allFilms = [...videos, ...program, ...demos];
  const savedFilms = favorites.flatMap(id => { const film = allFilms.find(item => item.id === id); return film ? [film] : []; });
  const films = (view === "saved" && !query ? savedFilms : allFilms).filter(film =>
    (category === "all" || film.kind === category) && (!query || normalize(film.title + " " + description(film)).includes(query)));
  if (sort === "az") films.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const savedTonight = favorites.includes(tonight.id);
  const lowerShelf = savedFilms.length ? savedFilms.slice(0, 2) : listSuggestions;

  return <div className="cinema-home">
    <header className="cinema-header">
      <Logo/>
      <nav className="main-nav" aria-label="Основное меню">{navigation.map(([key, label]) =>
        <a key={key} href={"#" + key} onClick={resetNavigation} aria-current={(query ? key === "library" : view === key) ? "page" : undefined}>{label}</a>)}</nav>
      <div className="header-search">
        <Search size={23} aria-hidden="true"/><input type="search" ref={searchInput} aria-label="Найти фильм или сериал" placeholder="Найти фильм или сериал" value={search} onChange={e => { setSearch(e.target.value); setCategory("all"); setMenuOpen(false); }}/>
        {search && <button type="button" aria-label="Очистить поиск" onClick={() => { setSearch(""); searchInput.current?.focus(); }}><X size={17}/></button>}
      </div>
      <div className="profile" ref={menu}>
        <button ref={menuButton} type="button" className="portrait" disabled={!interactive} aria-label="Меню просмотра" aria-expanded={menuOpen} aria-controls="viewing-menu" onClick={() => setMenuOpen(!menuOpen)}><img src="/images/program/portrait.webp" width="51" height="51" alt=""/></button>
        {menuOpen && <div className="profile-menu" id="viewing-menu">
          <button onClick={() => create()}>Смотреть по ссылке</button><button onClick={() => create(undefined, "file")}>Загрузить файл</button>
          <a href="#rooms" onClick={resetNavigation}>Мои комнаты</a><button onClick={() => { setMenuOpen(false); setJoinError(""); setModal("join"); }}>Войти по коду</button>
        </div>}
      </div>
    </header>
    <main className="cinema-main">
      {view === "home" && !query && <>
        <section className="tonight" aria-labelledby="tonight-title">
          <div className="tonight-copy">
            <p className="tonight-label">На этот вечер</p>
            <h1 id="tonight-title"><span>После</span>{" "}<span>заката</span></h1>
            <p className="tonight-kind">Фильм · Драма</p>
            <p className="tonight-synopsis">Неожиданная встреча в тихом городе меняет привычный ход вещей.</p>
            <div className="tonight-actions">
              <button className="button primary watch-button" disabled={!interactive} onClick={() => watch(tonight)}><Play fill="currentColor" size={18}/>Смотреть</button>
              <button className="list-action" disabled={!interactive} aria-pressed={savedTonight} onClick={() => favorite(tonight.id)}>
                {savedTonight ? <Check size={20}/> : <Plus size={20}/>} {savedTonight ? "В списке" : "В список"}</button>
            </div>
          </div>
          <img className="tonight-frame" src={tonight.poster} alt="Пассажирка смотрит из окна вечернего поезда на город" width={945} height={388} fetchPriority="high"/>
        </section>
        <section className="screenings" aria-labelledby="screenings-title">
          <div className="section-heading"><h2 id="screenings-title">{recent.length ? "Продолжить просмотр" : "Что посмотреть"}</h2>
            <button className="own-film" disabled={!interactive} onClick={() => create()}><Plus size={17}/>Свой фильм</button></div>
          <div className="film-grid">{recent.slice(0, 3).map(room =>
            <FilmCard key={room.id} title={room.videoTitle} poster={room.poster || allFilms.find(film => normalize(film.title) === normalize(room.videoTitle))?.poster} detail={recentCaption(room)} href={"/room/" + room.id}
              progress={room.duration && room.position !== undefined ? 100 * room.position / room.duration : undefined}/>)}
            {eveningFilms.filter(film => !recent.some(room => normalize(room.videoTitle) === normalize(film.title))).slice(0, Math.max(0, 3 - recent.length)).map(film =>
              <FilmCard key={film.id} title={film.title} poster={film.poster} detail={recent.length ? "Из подборки · " + kinds[film.kind] : description(film)} onWatch={() => watch(film)}/>)}</div>
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
          <button className="own-film" onClick={() => { setSelected(undefined); setModal("add"); }}><Plus size={17}/>Добавить фильм</button></div>
        <div className="catalog-tools"><div className="catalog-filters" role="group" aria-label="Жанр просмотра">{categories.map(([key, label]) =>
          <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}</div>
          <label className="sort-label"><select aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}><option value="new">По умолчанию</option><option value="az">От А до Я</option></select><ChevronDown size={14} aria-hidden="true"/></label></div>
        {libraryError && <p className="notice">{libraryError}<button onClick={() => void load()}>Повторить</button></p>}
        {loading && <div className="loading-small"><Spinner/>Загружаем ваши фильмы…</div>}
        {films.length ? <div className="film-grid">{films.map(film => <FilmCard key={film.id} title={film.title} poster={film.poster} detail={description(film)}
          saved={favorites.includes(film.id)} onWatch={() => watch(film)} onSave={() => favorite(film.id)} onDelete={film.demo ? undefined : () => void deleteFilm(film.id)}/>)}</div> :
          !loading && <Empty title={query ? "Ничего не найдено" : view === "saved" && !savedFilms.length ? "Список пока пуст" : "Здесь пока нет фильмов"}
            text={query ? "Попробуйте другое название или жанр." : "Добавьте фильм кнопкой «В список» в каталоге."} action={view === "saved" && !query ? "Открыть каталог" : undefined} onClick={() => { window.location.hash = "library"; }}/>}
      </section>}
      {view === "rooms" && !query && <section className="catalog">
        <div className="section-heading"><h1>Мои комнаты</h1><button className="own-film" onClick={() => create()}><Plus size={17}/>Создать комнату</button></div>
        {recent.length ? <div className="session-grid">{recent.map(room => <a className="session-link" key={room.id} href={"/room/" + room.id}>
          {room.poster && <img src={room.poster} alt="" width={88} height={48}/>}<span><strong>{room.videoTitle}</strong><small>{room.title}</small></span><ArrowRight size={17}/>
        </a>)}</div> : <Empty title="Здесь появятся ваши комнаты" text="Создайте комнату или откройте приглашение друга."/>}
      </section>}
      <footer className="cinema-footer"><a href="#rooms" onClick={resetNavigation}>Мои комнаты</a><button onClick={() => { setJoinError(""); setModal("join"); }}>Войти по коду</button><button onClick={() => setModal("help")}>Как смотреть вместе</button></footer>
    </main>
    {(modal === "create" || modal === "add") && <VideoForm key={modal} mode={modal} initialTab={modal === "add" ? "link" : initialTab} selected={selected} onFileRoom={() => create(undefined, "file")} onClose={() => setModal(null)} onSaved={video => { setVideos(old => [video, ...old]); setToast("Фильм добавлен"); }}/>}
    {modal === "join" && <Modal title="Войти в комнату" caption="Вставьте приглашение или код, который прислал ведущий." onClose={() => setModal(null)}>
      <form className="stack-form" onSubmit={join}><label>Приглашение<input autoFocus required value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Ссылка или код комнаты"/></label>
        {joinError && <p className="error" role="alert">{joinError}</p>}<button className="button primary full">Войти</button></form></Modal>}
    {modal === "help" && <Modal title="Как смотреть вместе" onClose={() => setModal(null)}>
      <div className="help-steps"><p><b>Выберите фильм</b>Добавьте ссылку или файл через «Свой фильм». Для карточек из подборки понадобится ваш источник. У короткометражек в каталоге он уже есть.</p>
        <p><b>Пригласите друга</b>Скопируйте ссылку в комнате и отправьте её другу. Приглашение действует семь дней.</p><p><b>Смотрите вместе</b>Ведущий управляет воспроизведением. Фильмом с другого сайта можно поделиться через показ вкладки.</p></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
