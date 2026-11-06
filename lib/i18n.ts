import english from "./locales/en.json";

export type Locale = "ru" | "en";
const catalog: Record<string, string> = english;

export function translate(locale: Locale, message: string, ...values: (string | number)[]) {
  const key = message.trim();
  const pattern = locale === "en" && Object.hasOwn(catalog, key) ? catalog[key] : key;
  const result = pattern.replace(/\{(\d+)\}/g, (token, index) => String(values[index] ?? token));
  return message.replace(key, () => result);
}

// Server, media and extension callbacks return status text independently of the view language.
const notices = [
  "Не удалось загрузить {0} (HTTP {1}). {2}", "Браузер не смог загрузить {0}. Возможны сбой сети или ограничение доступа из комнаты. Попробуйте другой поток.",
  "Видео открылось · {0}. Проверьте фильм и озвучку.", "Размер файла должен быть до {0}.",
  "{0}: от 1 до {1} символов", "{0} ГБ", "{0} МБ",
].map(key => ({
  key,
  pattern: new RegExp("^" + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("(.+?)") + "$"),
}));

export function translateNotice(locale: Locale, message: string): string {
  if (locale === "ru" || !message) return message;
  if (Object.hasOwn(catalog, message.trim())) return translate(locale, message);
  for (const {key,pattern} of notices) {
    const match = message.match(pattern);
    if (match) return translate(locale, key, ...match.slice(1).map(part => translateNotice(locale, part)));
  }
  return message;
}
