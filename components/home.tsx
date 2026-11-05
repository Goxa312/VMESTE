"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Bookmark, Check, ChevronDown, Trash2 } from "lucide-react";
import { api, libraryKey, readLocal, saveLocal } from "@/lib/client";
import { demos, kinds, type Video } from "@/lib/shared";
import { Empty, Logo, Modal, Spinner } from "./ui";
import { VideoForm } from "./video-form";

type View = "home" | "library" | "saved" | "rooms";
type Recent = { id: string; title: string; videoTitle: string; poster: string };
const featuredFilm = demos.find(film => film.id === "tears")!;
const categories = [["all", "Все"], ["film", "Фильмы"], ["series", "Сериалы"], ["anime", "Аниме"]] as const;

function currentView(): View {
  const section = window.location.hash.slice(1);
  return section === "library" || section === "saved" || section === "rooms" ? section : "home";
}

function FilmEntry({ film, preview = false, saved = false, onWatch, onSave, onDelete }: {
  film: Video; preview?: boolean; saved?: boolean; onWatch: (film: Video) => void;
  onSave?: (id: string) => void; onDelete?: (id: string) => void;
}) {
  return <article className={preview ? "film-entry featured-entry" : "film-entry"}>
    <button className="film-choice" aria-label={`Смотреть вместе: ${film.title}`} onClick={() => onWatch(film)}>
      {film.poster && <img className="film-image" src={film.poster} loading="lazy" alt=""/>}
      <span className="film-caption"><strong>{film.title}</strong>
        {film.duration && <span> · &nbsp;{film.duration}</span>}
      </span>
    </button>
    {!preview && <div className="film-library-info">
      <small>{[film.year, film.subtitle || kinds[film.kind]].filter(Boolean).join(" · ")}</small>
      {onSave && <button className="icon-button" aria-label={`На потом: ${film.title}`} aria-pressed={saved} onClick={() => onSave(film.id)}><Bookmark size={16} fill={saved ? "currentColor" : "none"}/></button>}
      {!film.demo && onDelete && <button className="icon-button" aria-label={`Удалить ${film.title}`} onClick={() => onDelete(film.id)}><Trash2 size={15}/></button>}
    </div>}
  </article>;
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [search, setSearch] = useState(""), [sort, setSort] = useState("new"), [category, setCategory] = useState("all");
  const [videos, setVideos] = useState<Video[]>([]), [favorites, setFavorites] = useState<string[]>([]), [recent, setRecent] = useState<Recent[]>([]);
  const [modal, setModal] = useState<"create" | "add" | "join" | "help" | null>(null), [selected, setSelected] = useState<Video>();
  const [startUrl, setStartUrl] = useState(""), [initialUrl, setInitialUrl] = useState("");
  const [initialTab, setInitialTab] = useState<"link" | "file">("link"), [toast, setToast] = useState("");
  const [libraryError, setLibraryError] = useState(""), [loading, setLoading] = useState(true), [interactive, setInteractive] = useState(false);
  const [joinCode, setJoinCode] = useState(""), [joinError, setJoinError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ videos: Video[] }>("/api/library", libraryKey());
      setVideos(data.videos); setLibraryError("");
    } catch { setLibraryError("Не удалось открыть вашу фильмотеку."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    setInteractive(true);
    setFavorites(readLocal("vm-favorites", []));
    setRecent(readLocal("vm-recent", []));
    const navigate = () => {
      setView(currentView()); setCategory("all"); setSearch("");
    };
    const showSection = () => {
      navigate();
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    navigate(); void load();
    window.addEventListener("hashchange", showSection);
    return () => window.removeEventListener("hashchange", showSection);
  }, []);
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
  function create(video?: Video, tab: "link" | "file" = "link", url = "") {
    setSelected(video); setInitialTab(tab); setInitialUrl(url); setModal("create");
  }
  function join(event: FormEvent) {
    event.preventDefault();
    let code = joinCode.trim();
    try { if (code.includes("/")) code = new URL(code).pathname.split("/").filter(Boolean).pop() || ""; }
    catch { /* Invalid invitations are handled below. */ }
    if (!/^[a-z0-9]{12}$/.test(code)) { setJoinError("Вставьте приглашение или код комнаты из 12 символов."); return; }
    window.location.assign("/room/" + code);
  }
  const films = [...videos, ...demos].filter(film =>
    (!search || film.title.toLowerCase().includes(search.toLowerCase())) &&
    (category === "all" || film.kind === category) &&
    (view !== "saved" || favorites.includes(film.id)));
  if (sort === "az") films.sort((a, b) => a.title.localeCompare(b.title, "ru"));

  return <div className="cinema-home">
    <header className="cinema-header">
      <Logo/>
      <nav aria-label="Разделы сайта">
        <a href="#rooms" aria-current={view === "rooms" ? "page" : undefined}>Мои комнаты</a>
        <button onClick={() => { setJoinError(""); setModal("join"); }}>Войти по коду</button>
      </nav>
    </header>
    <main className="cinema-main">
      {view === "home" && <>
        <section className="lobby-entry" aria-labelledby="start-title">
          <div className="lobby-desk">
            <h1 id="start-title">Что смотрим?</h1>
            <form onSubmit={event => { event.preventDefault(); create(undefined, "link", startUrl.trim()); }}>
              <label htmlFor="movie-url">Ссылка на фильм</label>
              <input id="movie-url" type="url" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://…" maxLength={4000} value={startUrl} onChange={e => setStartUrl(e.target.value)}/>
              <div className="lobby-actions">
                <button className="button primary" disabled={!interactive}>Создать комнату</button>
                <button type="button" className="text-link" onClick={() => create(undefined, "file")}>Загрузить файл</button>
              </div>
            </form>
          </div>
          <img className="lobby-photo" src="/images/cinema-seats.webp" alt="" width={1280} height={853} fetchPriority="high"/>
        </section>
        <section className="library-preview" aria-labelledby="preview-title">
          <div className="section-heading"><h2 id="preview-title">Фильмотека</h2><a className="text-link" href="#library">Все фильмы</a></div>
          <FilmEntry film={videos[0] ?? featuredFilm} preview onWatch={create}/>
        </section>
      </>}
      {(view === "library" || view === "saved") && <section className="catalog">
        <div className="section-heading"><h1>Фильмотека</h1>
          <button className="text-link" onClick={() => { setSelected(undefined); setModal("add"); }}>Добавить видео</button>
        </div>
        <nav className="library-nav" aria-label="Коллекции фильмов"><a href="#library" aria-current={view === "library" ? "page" : undefined}>Все фильмы</a><a href="#saved" aria-current={view === "saved" ? "page" : undefined}>На потом</a></nav>
        <div className="catalog-tools">
          <div className="catalog-filters" role="group" aria-label="Раздел фильмотеки">{categories.map(([key,label]) =>
            <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}</div>
          <input className="catalog-search" type="search" aria-label="Искать фильм" placeholder="Найти фильм" value={search} onChange={e => setSearch(e.target.value)}/>
          <label className="sort-label"><select aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}><option value="new">Сначала новые</option><option value="az">От А до Я</option></select><ChevronDown size={14} aria-hidden="true"/></label>
        </div>
        {libraryError && <p className="notice">{libraryError}<button onClick={() => void load()}>Повторить</button></p>}
        {loading && <div className="loading-small"><Spinner/>Открываем фильмотеку…</div>}
        {films.length > 0 ? <div className="film-grid">{films.map(film =>
          <FilmEntry key={film.id} film={film} saved={favorites.includes(film.id)} onWatch={create} onSave={favorite} onDelete={deleteFilm}/>)}</div>
          : !loading && <Empty title={search ? "Фильм не найден" : view === "saved" ? "Здесь будут ваши закладки" : "Пока нет фильмов"} text={search ? "Попробуйте другое название." : "Сохраните фильм из фильмотеки."}/>}
      </section>}
      {view === "rooms" && <section className="catalog">
        <div className="section-heading"><h1>Мои комнаты</h1><button className="text-link" onClick={() => create()}>Создать комнату</button></div>
        {recent.length ? <div className="session-grid">{recent.map(room => <a className="session-link" key={room.id} href={"/room/" + room.id}>
          {room.poster && <img src={room.poster} alt="" width={88} height={48}/>}
          <span><strong>{room.title}</strong><small>{room.videoTitle}</small></span><ArrowRight size={17}/>
        </a>)}</div> : <Empty title="Здесь появятся ваши комнаты" text="Создайте комнату или откройте приглашение друга."/>}
      </section>}
      <footer className="cinema-footer"><Logo/><a href="#library">Фильмотека</a><a href="#saved">На потом</a><button onClick={() => setModal("help")}>Помощь</button></footer>
    </main>
    {(modal === "create" || modal === "add") && <VideoForm key={modal} mode={modal} initialTab={modal === "add" ? "link" : initialTab} initialUrl={modal === "create" ? initialUrl : undefined} selected={selected} onFileRoom={() => create(undefined,"file")} onClose={() => setModal(null)} onSaved={video => { setVideos(old => [video, ...old]); setToast("Фильм добавлен"); }}/>}
    {modal === "join" && <Modal title="Войти в комнату" caption="Вставьте приглашение или код, который прислал ведущий." onClose={() => setModal(null)}>
      <form className="stack-form" onSubmit={join}><label>Приглашение<input autoFocus required value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Ссылка или код комнаты"/></label>
        {joinError && <p className="error" role="alert">{joinError}</p>}<button className="button primary full">Войти</button></form></Modal>}
    {modal === "help" && <Modal title="Как смотреть вместе" onClose={() => setModal(null)}>
      <div className="help-steps"><p><b>Ссылка на сайт</b>Откройте фильм и покажите его вкладку в комнате.</p><p><b>Файл или прямая ссылка</b>Фильм откроется в общем плеере. Паузой и перемоткой управляет ведущий.</p><p><b>Приглашение</b>Отправьте другу ссылку из комнаты. Ссылка действует семь дней.</p>
        <a className="text-link" href="https://www.blender.org/about/projects/" target="_blank" rel="noreferrer">Открытые фильмы Blender</a></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={15}/>{toast}</div>}
  </div>;
}
