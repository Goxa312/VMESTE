"use client";
import { useState } from "react";
import { ArrowRight, Bookmark, Star } from "lucide-react";
import { chartDate, chartFilm, chartKinds, chartNames, charts, scoreSource, type ChartEntry } from "@/lib/charts";
import type { Kind, Video } from "@/lib/shared";
import { Modal } from "./ui";
import { useLanguage } from "./language";

const allLabels = { film:"Все 100 фильмов", series:"Все 100 сериалов", anime:"Все 100 аниме" };
const sources = { film:"IMDb · Wikidata", series:"TVmaze", anime:"Shikimori" };
const snapshotDate = new Date(chartDate+"T00:00:00Z");

export function Rankings({ onWatch, favorites, onSave }: {onWatch:(film:Video)=>void; favorites:string[]; onSave:(id:string)=>void}) {
  const { t, locale } = useLanguage();
  const scoreFormat = new Intl.NumberFormat(locale, { minimumFractionDigits:1, maximumFractionDigits:2 });
  const dateText = locale === "ru"
    ? new Intl.DateTimeFormat("ru",{day:"numeric",month:"long",timeZone:"UTC"}).format(snapshotDate) + " " + snapshotDate.getUTCFullYear() + " года"
    : new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(snapshotDate);
  const [mobileTab, setMobileTab] = useState<Kind>("film");
  const [expanded, setExpanded] = useState<Kind | "sources" | null>(null);
  function row(kind:Kind, item: ChartEntry, index:number, full=false) {
    const film = chartFilm(kind,item,locale), saved = favorites.includes(film.id);
    return <li className="rank-row" key={item.id}>
      <span className="rank-number" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>
      <button className="rank-name" onClick={()=>{setExpanded(null);onWatch(film);}}>{film.title}</button>
      <a className="rank-score" href={scoreSource(kind,item.id)} target="_blank" rel="noreferrer"
        aria-label={t("{0} — {1} из 10. Источник оценки",film.title,scoreFormat.format(item.score))}><Star size={12} aria-hidden="true"/>{scoreFormat.format(item.score)}</a>
      {full && <button className="rank-save" aria-label={`${t(saved?"Убрать из списка":"В список")}: ${film.title}`} aria-pressed={saved} onClick={()=>onSave(film.id)}><Bookmark size={16} fill={saved?"currentColor":"none"}/></button>}
    </li>;
  }
  return <section className="rankings" aria-labelledby="ranking-title">
    <div className="rank-mast"><div><h1 id="ranking-title">{t("Топ-100")}</h1><p>{t("по оценкам зрителей")}</p></div>
      <button className="rank-explainer" onClick={()=>setExpanded("sources")}>{t("Об оценках")}</button></div>
    <div className="rank-mobile-tabs" role="group" aria-label={t("Категория рейтинга")}>{chartKinds.map(kind=>
      <button key={kind} aria-pressed={mobileTab===kind} onClick={()=>setMobileTab(kind)}>{t(chartNames[kind])}</button>)}</div>
    <div className="rank-columns">{chartKinds.map(kind=>
      <section className="rank-column" data-mobile-active={mobileTab===kind} key={kind} aria-label={t("Рейтинг: {0}",t(chartNames[kind]))}>
        <div className="rank-column-head"><h2>{t(chartNames[kind])}</h2><span>{t("Оценка")}</span></div>
        <ol className="rank-list">{charts[kind].slice(0,5).map((item,index)=>row(kind,item,index))}</ol>
        <button className="rank-more" onClick={()=>setExpanded(kind)}>{t(allLabels[kind])}<ArrowRight size={17}/></button>
      </section>)}</div>
    {expanded==="sources" && <Modal focusTitle title={t("Об оценках")} caption={t("Оценки во всех трёх подборках указаны по десятибалльной шкале.")} onClose={()=>setExpanded(null)}>
      <div className="ranking-sources">
        <section><h3>{t("Фильмы")}</h3><p>{t("Берём из Викиданных оценки IMDb для фильмов с русским названием и не менее чем 10 000 голосов. Отбираем 100 фильмов с самыми высокими оценками. При равной оценке выше фильм с большим числом голосов.")}</p><a href={scoreSource("film",charts.film[0].id)} target="_blank" rel="noreferrer">{t("Пример оценки в Викиданных")}</a></section>
        <section><h3>{t("Сериалы")}</h3><p>{t("В подборку вошли 100 сериалов с наивысшими оценками зрителей TVmaze, для которых в Викиданных есть русское название.")}</p><div className="rating-credit"><a href="https://www.tvmaze.com/shows?Show%5Bsort%5D=7" target="_blank" rel="noreferrer">{t("Рейтинг TVmaze")}</a><a href={`https://creativecommons.org/licenses/by-sa/4.0/deed.${locale}`} target="_blank" rel="noreferrer">{t("Лицензия CC BY-SA")}</a></div></section>
        <section><h3>{t("Аниме")}</h3><p>{t("Включаем вышедшие аниме с русским названием из рейтинга Shikimori и сортируем их по оценке. Разные сезоны одного сериала могут занимать отдельные места.")}</p><a href="https://shikimori.one/animes/order-by/ranked" target="_blank" rel="noreferrer">{t("Рейтинг Shikimori")}</a></section>
        <time dateTime={chartDate}>{t("Данные на {0}",dateText)}</time>
      </div></Modal>}
    {expanded && expanded!=="sources" && <Modal title={t(allLabels[expanded])} caption={`${sources[expanded]} · ${dateText}`} onClose={()=>setExpanded(null)}>
      <ol className="rank-list rank-list-full">{charts[expanded].map((item,index)=>row(expanded,item,index,true))}</ol>
    </Modal>}
  </section>;
}
