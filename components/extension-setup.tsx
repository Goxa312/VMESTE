"use client";
import { LanguageSwitch, useLanguage } from "./language";
import Link from "next/link";
import { CheckCircle2, Download, RefreshCw } from "lucide-react";
import { useKinogoExtension } from "@/hooks/use-kinogo-extension";
import { EXTENSION_VERSION, needsExtensionUpdate } from "@/lib/kinogo-bridge";
import { Logo, Spinner } from "./ui";

export function ExtensionSetup() {
  const { t } = useLanguage();
  const { extension, checking, reachable, check } = useKinogoExtension();
  const outdated = extension.installed && needsExtensionUpdate(extension.version, "0.4.0");
  return <main className="extension-setup"><div className="setup-bar"><Logo/><LanguageSwitch/></div>
    <span className="eyebrow">{t("КИНОГО · CHROME И EDGE")}</span><h1>{t("Расширение для Киного")}</h1>
    <p>{t("Чтобы взять видеопоток из Киного для плеера комнаты, расширение нужно ведущему. Друзьям достаточно приглашения. Для просмотра в отдельных вкладках Киного расширение устанавливает каждый участник.")}</p>
    <section className={`extension-check ${reachable && !outdated ? "ready" : ""}`} aria-label={t("Проверка расширения")}>
      <div className="extension-check-heading">{checking && !reachable ? <Spinner/> : reachable ? <CheckCircle2 size={24}/> : <RefreshCw size={24}/>}<strong role="status" aria-live="polite">{checking && !reachable ? t("Проверяем расширение…") : reachable ? outdated ? t("Установлена версия {0} · есть обновление", extension.version ?? "—") : t("Расширение {0} готово", extension.version ?? "—") : t("Нет связи с расширением в этом браузере")}</strong></div>
      <p>{reachable && !outdated ? t("Вернитесь в комнату, нажмите «Смотреть на Киного» и запустите фильм. Длинное видео подключится автоматически.") : t("Если расширение уже стоит, откройте его значок в панели Chrome и нажмите «Восстановить связь». Старую версию обновите по инструкции ниже.")}</p>
      <button className="button subtle" disabled={checking} onClick={check}><RefreshCw size={16}/>{t("Проверить ещё раз")}</button>
      {reachable && !outdated && <Link className="button primary" href="/">{t("Перейти к комнатам")}</Link>}
    </section>
    <a className="button primary" href={`/downloads/vmeste-kinogo-extension.zip?v=${EXTENSION_VERSION}`} download><Download size={17}/>{outdated ? t("Скачать обновление") : t("Скачать расширение")} {EXTENSION_VERSION}</a>
    <h2>{t("Уже ставили из папки проекта?")}</h2>
    <p>{t("После обновления файлов откройте ")}<code>chrome://extensions</code>{t(" и нажмите ↻ у расширения для Киного. С версии 0.4.1 оно называется «Together Tonight — просмотр Киного». Версия 0.4.0 по-прежнему работает под прежним именем «Вместе».")}</p>
    <details open={!reachable}><summary>{t("Первая установка или обновление из ZIP")}</summary>
      <ol><li>{t("Скачайте архив и распакуйте. При обновлении замените файлы в прежней папке расширения.")}</li>
        <li>{t("Откройте ")}<code>chrome://extensions</code>{t(" (в Edge — ")}<code>edge://extensions</code>).</li>
        <li>{t("Для первой установки включите «Режим разработчика» → «Загрузить распакованное расширение» и выберите папку с ")}<code>manifest.json</code>{t(". Для обновления нажмите ↻ у установленного расширения.")}</li>
        <li>{t("Вернитесь сюда: статус должен стать зелёным. Если этого не произошло, нажмите значок расширения → «Восстановить связь».")}</li></ol>
    </details>
    <h2>{t("Смотреть в комнате")}</h2>
    <p>{t("Ведущий нажимает «Смотреть в комнате» → «Взять из Киного». После запуска фильма вернитесь в комнату, проверьте видео и нажмите «Открыть для всех». Если у вас уже есть прямая ссылка на видео, её можно вставить без расширения.")}</p>
    <h2>{t("Смотреть во вкладке Киного")}</h2>
    <ol><li>{t("В комнате нажмите ")}<strong>{t("«Смотреть на Киного»")}</strong>.</li><li>{t("Запустите фильм. Через несколько секунд длинное видео подключится автоматически, а панель свернётся. Для коротких роликов остаётся кнопка «Подключить это видео».")}</li></ol>
    <details><summary>{t("Киного открывается только после удаления данных?")}</summary><p>{t("Нажмите значок расширения в Chrome → «Включить автовосстановление Киного» и разрешите восстановление. Это делается один раз. Если страница остаётся пустой около 10 секунд, расширение сбросит данные только kinogo.my и откроет фильм снова. Сам сброс может занять дополнительное время. Возможен выход из аккаунта Киного. Во время подключённого просмотра сброс не выполняется.")}</p></details>
    <details><summary>{t("Расширение установлено, а связи всё равно нет")}</summary><p>{t("Откройте этот сайт и Киного в том же профиле Chrome, где установлено расширение. Проверьте, что расширение включено и ему разрешён доступ к этому сайту. Для инкогнито разрешение задаётся отдельно. Во встроенном браузере Codex расширения Chrome не работают.")}</p><p>{t("В окне расширения видны версия, поддерживаемые адреса и подключённые комнаты. Кнопка «Восстановить связь» повторно подключает уже открытые вкладки.")}</p></details>
    <aside><strong>{t("Звук и управление")}</strong><p>{t("Ведущий управляет паузой и перемоткой, участники следуют за ним. Если браузер блокирует звук, нажмите ▶ в плеере. Комната должна оставаться открытой. Ключ доступа и чат остаются на сайте.")}</p></aside>
    <Link className="text-button" href="/">{t("Вернуться в библиотеку")}</Link>
  </main>;
}
