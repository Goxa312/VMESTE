import snapshot from "./rankings.json";
import type { Kind, Video } from "./shared";
import type { Locale } from "./i18n";

export const chartDate = snapshot.date;
export const chartKinds: Kind[] = ["film", "series", "anime"];
export const chartNames: Record<Kind,string> = { film:"Фильмы", series:"Сериалы", anime:"Аниме" };
export type ChartEntry = { id:string; title:string; titleEn:string; score:number; votes?:number };
export const charts: Record<Kind,ChartEntry[]> = snapshot;

export function chartFilm(kind:Kind, item:ChartEntry, locale:Locale): Video {
  return { id:`chart-${kind}-${item.id}`, title:locale === "en" ? item.titleEn : item.title, kind, poster:"", url:"", demo:true };
}
export function scoreSource(kind:Kind, id:string) {
  if (kind === "film") return "https://www.wikidata.org/wiki/" + id + "#P444";
  if (kind === "series") return "https://www.tvmaze.com/shows/" + id;
  return "https://shikimori.one/animes/" + id;
}
function filmsFor(locale:Locale) {
  return chartKinds.flatMap(kind => charts[kind].map(item => chartFilm(kind,item,locale)));
}
export const chartFilms = {ru:filmsFor("ru"), en:filmsFor("en")};
export const chartAliases = new Map(chartKinds.flatMap(kind => charts[kind].map(entry =>
  [`chart-${kind}-${entry.id}`, [entry.title,entry.titleEn]] as const)));
