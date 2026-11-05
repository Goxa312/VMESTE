"use client";
import Link from "next/link";
import { CheckCircle2, Download, ExternalLink, RefreshCw } from "lucide-react";
import { useKinogoExtension } from "@/hooks/use-kinogo-extension";
import { EXTENSION_VERSION, needsExtensionUpdate } from "@/lib/kinogo-bridge";
import { Spinner } from "./ui";

export function ExtensionSetup() {
  const { extension, checking, reachable, check } = useKinogoExtension();
  const outdated = extension.installed && needsExtensionUpdate(extension.version);
  return <main className="extension-setup"><Link className="brand" href="/">вместе.</Link>
    <span className="eyebrow">КИНОГО · CHROME И EDGE</span><h1>Подключились — и смотрите</h1>
    <p>Чтобы взять видеопоток из Киного для плеера комнаты, расширение нужно ведущему. Друзьям достаточно приглашения. Для просмотра в отдельных вкладках Киного расширение устанавливает каждый участник.</p>
    <section className={`extension-check ${reachable && !outdated ? "ready" : ""}`} aria-label="Проверка расширения">
      <div className="extension-check-heading">{checking && !reachable ? <Spinner/> : reachable ? <CheckCircle2 size={24}/> : <RefreshCw size={24}/>}<strong role="status" aria-live="polite">{checking && !reachable ? "Проверяем расширение…" : reachable ? outdated ? `Установлена версия ${extension.version} · есть обновление` : `Расширение ${extension.version} готово` : "Нет связи с расширением в этом браузере"}</strong></div>
      <p>{reachable && !outdated ? "Вернитесь в комнату, нажмите «Смотреть на Киного» и запустите фильм. Длинное видео подключится автоматически." : "Если расширение уже стоит, откройте его значок в панели Chrome и нажмите «Восстановить связь». Старую версию обновите по инструкции ниже."}</p>
      <button className="button subtle" disabled={checking} onClick={check}><RefreshCw size={16}/>Проверить ещё раз</button>
      {reachable && !outdated && <Link className="button primary" href="/">Перейти к комнатам <ExternalLink size={16}/></Link>}
    </section>
    <a className="button primary" href={`/downloads/vmeste-kinogo-extension.zip?v=${EXTENSION_VERSION}`} download><Download size={17}/>{outdated ? "Скачать обновление" : "Скачать расширение"} {EXTENSION_VERSION}</a>
    <h2>Уже ставили из папки проекта?</h2>
    <p>Если эта папка обновлена вместе с проектом, достаточно открыть <code>chrome://extensions</code> и нажать ↻ у «Вместе — просмотр Киного». Должна появиться версия <strong>{EXTENSION_VERSION}</strong>. В этой версии уже прописан адрес опубликованного сайта.</p>
    <details open={!reachable}><summary>Первая установка или обновление из ZIP</summary>
      <ol><li>Скачайте архив и распакуйте. При обновлении замените файлы в прежней папке расширения.</li>
        <li>Откройте <code>chrome://extensions</code> (в Edge — <code>edge://extensions</code>).</li>
        <li>Для первой установки включите «Режим разработчика» → «Загрузить распакованное расширение» и выберите папку с <code>manifest.json</code>. Для обновления нажмите ↻ у установленного расширения.</li>
        <li>Вернитесь сюда: статус должен стать зелёным. Если этого не произошло, нажмите значок расширения → «Восстановить связь».</li></ol>
    </details>
    <h2>Смотреть в комнате</h2>
    <p>Ведущий нажимает «Смотреть в комнате» → «Взять из Киного». После запуска фильма вернитесь в комнату, проверьте видео и нажмите «Открыть для всех». Если у вас уже есть прямая ссылка на видео, её можно вставить без расширения.</p>
    <h2>Смотреть во вкладке Киного</h2>
    <ol><li>В комнате нажмите <strong>«Смотреть на Киного»</strong>.</li><li>Запустите фильм. Через несколько секунд длинное видео подключится автоматически, а панель свернётся. Для коротких роликов остаётся кнопка «Подключить это видео».</li></ol>
    <details><summary>Киного открывается только после удаления данных?</summary><p>Нажмите значок расширения в Chrome → «Включить автовосстановление Киного» и разрешите восстановление. Это делается один раз. Если страница остаётся пустой около 10 секунд, расширение сбросит данные только kinogo.my и откроет фильм снова. Сам сброс может занять дополнительное время. Возможен выход из аккаунта Киного. Во время подключённого просмотра сброс не выполняется.</p></details>
    <details><summary>Расширение установлено, а связи всё равно нет</summary><p>Откройте этот сайт и Киного в том же профиле Chrome, где установлено расширение. Проверьте, что расширение включено и ему разрешён доступ к этому сайту. Для инкогнито разрешение задаётся отдельно. Во встроенном браузере Codex расширения Chrome не работают.</p><p>В окне расширения видны версия, поддерживаемые адреса и подключённые комнаты. Кнопка «Восстановить связь» повторно подключает уже открытые вкладки.</p></details>
    <aside><strong>Звук и управление</strong><p>Ведущий управляет паузой и перемоткой, участники следуют за ним. Если браузер блокирует звук, нажмите ▶ в плеере. Комната должна оставаться открытой. Ключ доступа и чат остаются на сайте.</p></aside>
    <Link className="text-button" href="/">Вернуться в библиотеку</Link>
  </main>;
}
