"use client";
import { useState } from "react";
import { ArrowRight, Bookmark, Star } from "lucide-react";
import { chartDate, chartFilm, chartKinds, chartNames, charts, scoreSource, type ChartEntry } from "@/lib/charts";
import type { Kind, Video } from "@/lib/shared";
import { Modal } from "./ui";

const allLabels = { film:"Все 100 фильмов", series:"Все 100 сериалов", anime:"Все 100 аниме" };
const sources = { film:"Викиданные", series:"ТВмейз", anime:"Шикимори" };
const scoreFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits:1, maximumFractionDigits:2 });
const dateText = new Intl.DateTimeFormat("ru-RU", { day:"numeric", month:"long", year:"numeric", timeZone:"UTC" }).format(new Date(chartDate+"T00:00:00Z"));

export function Rankings({ onWatch, favorites, onSave }: {onWatch:(film:Video)=>void; favorites:string[]; onSave:(id:string)=>void}) {
  const [mobileTab, setMobileTab] = useState<Kind>("film");
  const [expanded, setExpanded] = useState<Kind | "sources" | null>(null);
  function row(kind:Kind, item: ChartEntry, index:number, full=false) {
    const film = chartFilm(kind,item), saved = favorites.includes(film.id);
    return <li className="rank-row" key={item.id}>
      <span className="rank-number" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>
      <button className="rank-name" onClick={()=>{setExpanded(null);onWatch(film);}}>{item.title}</button>
      <a className="rank-score" href={scoreSource(kind,item.id)} target="_blank" rel="noreferrer"
        aria-label={`${item.title} — ${scoreFormat.format(item.score)} из 10. Источник оценки`}><Star size={12} aria-hidden="true"/>{scoreFormat.format(item.score)}</a>
      {full && <button className="rank-save" aria-label={`${saved?"Убрать из списка":"В список"}: ${item.title}`} aria-pressed={saved} onClick={()=>onSave(film.id)}><Bookmark size={16} fill={saved?"currentColor":"none"}/></button>}
    </li>;
  }
  return <section className="rankings" aria-labelledby="ranking-title">
    <div className="rank-mast"><div><h1 id="ranking-title">Топ-100</h1><p>по оценкам зрителей</p></div>
      <button className="rank-explainer" onClick={()=>setExpanded("sources")}>Об оценках</button></div>
    <div className="rank-mobile-tabs" role="group" aria-label="Категория рейтинга">{chartKinds.map(kind=>
      <button key={kind} aria-pressed={mobileTab===kind} onClick={()=>setMobileTab(kind)}>{chartNames[kind]}</button>)}</div>
    <div className="rank-columns">{chartKinds.map(kind=>
      <section className="rank-column" data-mobile-active={mobileTab===kind} key={kind} aria-label={`Рейтинг: ${chartNames[kind]}`}>
        <div className="rank-column-head"><h2>{chartNames[kind]}</h2><span>Оценка</span></div>
        <ol className="rank-list">{charts[kind].slice(0,5).map((item,index)=>row(kind,item,index))}</ol>
        <button className="rank-more" onClick={()=>setExpanded(kind)}>{allLabels[kind]}<ArrowRight size={17}/></button>
      </section>)}</div>
    {expanded==="sources" && <Modal title="Об оценках" caption={`Подборка обновлена ${dateText}. Оценки приведены к шкале из 10 баллов.`} onClose={()=>setExpanded(null)}>
      <div className="ranking-sources">
        <p><b>Фильмы</b>Русские карточки Викиданных с оценкой зрителей IMDb и минимум 10 000 голосов. При равной оценке выше фильм с большим числом голосов. Это выборка по доступным записям. <a href="https://www.wikidata.org/wiki/Property:P444" target="_blank" rel="noreferrer">Данные об оценках</a></p>
        <p><b>Сериалы</b>Из рейтинга ТВмейз взяты первые сто сериалов с русским названием в Викиданных. <a href="https://www.tvmaze.com/shows?Show%5Bsort%5D=7" target="_blank" rel="noreferrer">Рейтинг источника</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ru" target="_blank" rel="noreferrer">Лицензия на данные</a></p>
        <p><b>Аниме</b>Вышедшие аниме из рейтинга Шикимори с русским названием. Отдельные сезоны могут иметь свою оценку. <a href="https://shikimori.one/animes/order-by/ranked" target="_blank" rel="noreferrer">Рейтинг источника</a></p>
      </div></Modal>}
    {expanded && expanded!=="sources" && <Modal title={allLabels[expanded]} caption={`${sources[expanded]} · ${dateText}`} onClose={()=>setExpanded(null)}>
      <ol className="rank-list rank-list-full">{charts[expanded].map((item,index)=>row(expanded,item,index,true))}</ol>
    </Modal>}
  </section>;
}
