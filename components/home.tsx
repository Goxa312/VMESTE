"use client";
import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { ArrowRight, Bookmark, Check, ChevronDown, Clapperboard, FolderOpen, LogIn, Play, Plus, Search, Trash2, X } from "lucide-react";
import { demos, kinds, type Video } from "@/lib/shared";
import { api, libraryKey, readLocal, saveLocal } from "@/lib/client";
import { Logo, Modal, Empty, Spinner } from "./ui";
import { VideoForm } from "./video-form";

const featuredFilm = demos[0];

type View = "home" | "favorites" | "rooms";
type Recent = { id: string; title: string; videoTitle: string; poster: string };
export default function Home() {
  const [view, setView] = useState<View>("home"), [search, setSearch] = useState(""), [sort, setSort] = useState("new"), [category, setCategory] = useState("all");
  const [videos, setVideos] = useState<Video[]>([]), [favorites, setFavorites] = useState<string[]>([]), [recent, setRecent] = useState<Recent[]>([]);
  const [modal, setModal] = useState<"create" | "add" | "join" | "help" | null>(null), [selected, setSelected] = useState<Video>();
  const [startUrl, setStartUrl] = useState(""), [initialUrl, setInitialUrl] = useState("");
  const [initialTab, setInitialTab] = useState<"link" | "file">("link"), [toast, setToast] = useState(""), [libraryError, setLibraryError] = useState(""), [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState(""), [joinError, setJoinError] = useState("");
  async function load() {
    setLoading(true);
    try { const data = await api<{ videos: Video[] }>("/api/library", libraryKey()); setVideos(data.videos); setLibraryError(""); }
    catch { setLibraryError("Не удалось открыть вашу библиотеку."); }
    finally { setLoading(false); }
  }
  useEffect(() => { setFavorites(readLocal("vm-favorites", [])); setRecent(readLocal("vm-recent", [])); void load(); }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 2600); return () => clearTimeout(timer); } }, [toast]);
  function navigate(v: View) { setView(v); setCategory("all"); setSearch(""); }
  function favorite(id: string) { const next = favorites.includes(id) ? favorites.filter(i => i !== id) : [...favorites, id]; setFavorites(next); saveLocal("vm-favorites", next); }
  function create(video?: Video, tab: "link" | "file" = "link", url = "") { setSelected(video); setInitialTab(tab); setInitialUrl(url); setModal("create"); }
  function join(e: FormEvent) {
    e.preventDefault(); let code = joinCode.trim();
    try { if (code.includes("/")) code = new URL(code).pathname.split("/").filter(Boolean).pop() || ""; } catch { /* Validated below */ }
    if (!/^[a-z0-9]{12}$/.test(code)) { setJoinError("Вставьте приглашение или код комнаты из 12 символов."); return; }
    window.location.assign("/room/" + code);
  }
  const shown = [...videos, ...demos].filter(v => (!search || v.title.toLowerCase().includes(search.toLowerCase())) &&
    (category === "all" || v.kind === category) && (view !== "favorites" || favorites.includes(v.id)))
    .sort((a,b) => sort === "az" ? a.title.localeCompare(b.title, "ru") : 0);
  const title = view === "home" ? "Фильмотека" : view === "favorites" ? "На потом" : "Мои комнаты";
  return <div className="cinema-home">
    <header className="cinema-header"><div className="masthead-signature"><Logo/><span>Частный кинозал</span></div><nav aria-label="Разделы сайта">{([["home","Обзор"],["rooms","Мои комнаты"],["favorites","На потом"]] as const).map(([id,label]) =>
      <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav>
      <button className="cinema-join" onClick={() => setModal("join")}><span>Войти по коду</span><LogIn size={17} aria-hidden="true"/></button></header>
    <main className="cinema-main">
      {view === "home" && <>
        <section className="feature" aria-labelledby="feature-title">
          <div className="feature-still"><img src={featuredFilm.poster} fetchPriority="high" alt="Синтел с посохом на заснеженном перевале"/></div>
          <div className="feature-copy"><p className="section-label">Фильм вечера</p><h1 id="feature-title">{featuredFilm.title}</h1>
            <p className="feature-meta">{featuredFilm.year}<span>Фэнтези</span>{featuredFilm.duration}</p>
            <p className="feature-description">Девушка ищет дракона, которого когда-то спасла. Короткий трейлер Blender Foundation.</p>
            <button className="feature-play" onClick={() => create(featuredFilm)}><Play size={15} fill="currentColor" aria-hidden="true"/>Смотреть трейлер</button></div>
        </section>
        <section className="start-desk" aria-labelledby="start-title"><div className="desk-title"><h2 id="start-title">Свой фильм</h2><p>Смотрите с друзьями в своей комнате.</p></div>
          <form className="desk-form" onSubmit={e => { e.preventDefault(); create(undefined,"link",startUrl.trim()); }}><label className="desk-link"><span className="visually-hidden">Ссылка на фильм</span><input type="url" value={startUrl} onChange={e => setStartUrl(e.target.value)} placeholder="Ссылка на фильм" maxLength={4000}/></label><button className="button primary">Создать комнату</button></form>
          <div className="desk-file"><span>или</span><button type="button" onClick={() => create(undefined,"file")}><FolderOpen size={19} aria-hidden="true"/>Загрузить файл</button></div>
        </section></>}
      <section className="catalog"><div className="catalog-heading"><div>{view === "home" ? <h2>{title}</h2> : <h1>{title}</h1>}</div>
        <button className="button subtle" onClick={() => view === "rooms" ? create() : (setSelected(undefined), setModal("add"))}><Plus size={16}/>{view === "rooms" ? "Создать комнату" : "Добавить видео"}</button></div>
        {view !== "rooms" ? <><div className="catalog-tools"><div className="catalog-filters" role="group" aria-label="Раздел фильмотеки">{[["all","Все"],["film","Фильмы"],["series","Сериалы"],["anime","Аниме"]].map(([key,label]) =>
          <button key={key} aria-pressed={category===key} className={category === key ? "selected" : ""} onClick={() => setCategory(key)}>{label}</button>)}</div>
          <label className="catalog-search"><Search size={16}/><input aria-label="Искать фильм" placeholder="Найти фильм" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button aria-label="Очистить поиск" onClick={() => setSearch("")}><X size={14}/></button>}</label>
          <label className="sort-label"><select aria-label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}><option value="new">Сначала новые</option><option value="az">От А до Я</option></select><ChevronDown size={13}/></label></div>
          {libraryError && <p className="notice">{libraryError} <button onClick={() => void load()}>Повторить</button></p>}
          {loading && <div className="loading-small"><Spinner/>Открываем библиотеку…</div>}
          {shown.length ? <div className="film-grid">{shown.map(v => <article className="film-card" key={v.id}>
            <div className="film-art"><button className="art-play" aria-label={`Смотреть вместе: ${v.title}`} onClick={() => create(v)}>
              {v.poster ? <img src={v.poster} alt="" loading="lazy"/> : <Clapperboard size={38}/>}<span className="art-play-icon"><Play size={20} fill="currentColor"/></span></button>
              <button className={"save-film" + (favorites.includes(v.id) ? " saved" : "")} aria-label={`На потом: ${v.title}`} aria-pressed={favorites.includes(v.id)} onClick={() => favorite(v.id)}><Bookmark size={16} fill={favorites.includes(v.id) ? "currentColor" : "none"}/></button>
              {v.duration && <span className="film-duration">{v.duration}</span>}</div>
            <button className="film-title" onClick={() => create(v)}>{v.title}</button><div className="film-meta">{[v.year, v.subtitle || kinds[v.kind]].filter(Boolean).join(" · ")}
            {!v.demo && <button aria-label={`Удалить ${v.title}`} onClick={async () => { try { await api("/api/library", libraryKey(), { id:v.id }, "DELETE"); setVideos(old=>old.filter(x=>x.id!==v.id)); } catch { setToast("Не удалось удалить фильм"); } }}><Trash2 size={14}/></button>}</div>
          </article>)}</div> : !loading && <Empty title={search ? "Фильм не найден" : view === "favorites" ? "Здесь будут ваши закладки" : "Пока нет фильмов"} text={search ? "Попробуйте другое название." : view === "favorites" ? "Нажмите значок закладки на карточке фильма." : "Добавьте ссылку на фильм в свою коллекцию."} />}
        </> : recent.length ? <div className="session-grid">{recent.map(r => <a className="session-link" key={r.id} href={"/room/"+r.id}>{r.poster && <Image unoptimized width={68} height={38} className="session-poster" src={r.poster} alt=""/>}<span><strong>{r.title}</strong><small>{r.videoTitle}</small></span><ArrowRight size={18}/></a>)}</div> :
          <Empty title="Здесь появятся ваши комнаты" text="Создайте комнату или присоединитесь по приглашению." action="Создать комнату" onClick={() => create()}/>}</section>
      <footer className="cinema-footer"><Logo/><a href="https://www.blender.org/about/projects/" target="_blank" rel="noreferrer">Открытые фильмы Blender</a><button onClick={() => setModal("help")}>Помощь</button></footer>
    </main>
    {(modal === "create" || modal === "add") && <VideoForm key={modal} mode={modal} initialTab={modal === "add" ? "link" : initialTab} initialUrl={modal === "create" ? initialUrl : undefined} selected={selected} onFileRoom={() => create(undefined,"file")} onClose={() => setModal(null)} onSaved={v => { setVideos(old=>[v,...old]); setToast("Фильм добавлен"); }}/>}
    {modal === "join" && <Modal title="Войти в комнату" caption="Вставьте приглашение или код, который прислал ведущий." onClose={() => setModal(null)}><form className="stack-form" onSubmit={join}><label>Приглашение<input autoFocus required value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Ссылка или код комнаты"/></label>{joinError && <p className="error">{joinError}</p>}<button className="button primary full">Войти<ArrowRight size={17}/></button></form></Modal>}
    {modal === "help" && <Modal title="Как смотреть вместе" onClose={() => setModal(null)}><div className="help-steps"><p><b>Ссылка на сайт</b>Откройте фильм, затем в комнате выберите его вкладку для показа. Передачу звука можно включить отдельно. Некоторые сайты блокируют захват защищённого видео.</p><p><b>Файл или прямая ссылка</b>Фильм откроется в общем плеере. Пауза и перемотка ведущего применяются у всех зрителей.</p><p><b>Приглашение</b>Отправьте друзьям ссылку из комнаты. Она действует семь дней. Для просмотра в комнате друзьям достаточно браузера.</p></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={15}/>{toast}</div>}
  </div>;
}
