import type { Video } from "./shared";

function selection(id: string, title: string, kind: Video["kind"], subtitle: string): Video {
  return { id, title, kind, subtitle, poster: `/images/program/${id}.webp`, url: "", demo: true };
}

// These selections carry artwork. The viewer supplies the film when starting a room.
export const tonight = selection("after-sunset", "После заката", "film", "Драма");
export const eveningFilms = [
  selection("severance", "Разделение", "series", "Триллер"),
  selection("dandadan", "Дандадан", "anime", "Приключения"),
  selection("dune", "Дюна", "film", "Фантастика"),
];
export const listSuggestions = [
  selection("sunshine", "Вечное сияние чистого разума", "film", "Драма, мелодрама"),
  selection("totoro", "Мой сосед Тоторо", "film", "Аниме, фэнтези"),
];
export const program = [tonight, ...eveningFilms, ...listSuggestions];
