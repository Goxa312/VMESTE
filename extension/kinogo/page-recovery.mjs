// Recovery is limited to Kinogo's own pages. Player, room and browser data
// outside these two origins must never be included, even via page messages.
export const KINOGO_DATA_ORIGINS = Object.freeze(['https://kinogo.my', 'https://www.kinogo.my']);
export const PAGE_TIMEOUT_MS = 10000;
export const recoveryAlarm = key => `vmeste-page:${key}`;

export function pageTimedOut(session) {
  return !!session && !session.pageReady && !Number.isInteger(session.frameId) && !session.recovering &&
    Date.now() - (session.openedAt || session.state.sampledAt) >= PAGE_TIMEOUT_MS;
}

export function createPageRecovery({ current, all, enqueue, save, movieId, enabled, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const jobs = new WeakSet();
  const timers = new Map();
  const active = session => current(String(session.roomTabId)) === session;
  const blank = session => active(session) && !session.pageReady && !Number.isInteger(session.frameId);
  async function watch(session) {
    const key = String(session.roomTabId);
    clearTimer(timers.get(key));
    // An alarm may be delayed by Chrome. The short timer handles a newly opened
    // tab while this worker is still awake; the alarm survives worker suspension.
    timers.set(key, setTimer(() => {
      timers.delete(key);
      void enqueue(async () => { const s = current(key); if (s) await start(s); }).catch(() => {});
    }, PAGE_TIMEOUT_MS + 50));
    await chrome.alarms.create(recoveryAlarm(key), { when: Date.now() + PAGE_TIMEOUT_MS });
  }
  async function cancel(key) {
    clearTimer(timers.get(String(key))); timers.delete(String(key));
    await chrome.alarms.clear(recoveryAlarm(key));
  }

  async function target(session) {
    if (!blank(session)) return null;
    const tab = await chrome.tabs.get(session.mediaTabId).catch(() => null);
    // A pending navigation away also revokes permission to reload this tab.
    if (!tab || movieId(tab.pendingUrl || tab.url) !== movieId(session.state.sourceUrl)) return null;
    return tab;
  }

  async function run(session, attempt) {
    let tab = await target(session);
    if (!tab) return;
    if (attempt === 2) {
      if (!enabled() || !await chrome.permissions.contains({ permissions: ['browsingData'] })) {
        throw new Error('Откройте значок расширения и включите «Автовосстановление Киного».');
      }
      if (tab.incognito) throw new Error('В инкогнито доступна повторная загрузка без кэша. Автовосстановление данных работает в обычном окне.');
      if (!await chrome.permissions.contains({ origins: KINOGO_DATA_ORIGINS.map(origin => `${origin}/*`) })) {
        throw new Error('Разрешите расширению доступ к Киного в настройках Chrome, затем повторите загрузку.');
      }
      // Origin data is shared between tabs. Never reset it under another film.
      const other = Object.values(all()).some(s => s !== session && (s.pageReady || Number.isInteger(s.frameId) || s.recovering));
      if (other) throw new Error('Завершите другой подключённый просмотр Киного, затем повторите загрузку.');
      const otherTabs = await chrome.tabs.query({ url: KINOGO_DATA_ORIGINS.map(origin => `${origin}/*`) });
      if (otherTabs.some(item => item.id !== session.mediaTabId && !item.incognito)) {
        throw new Error('Закройте остальные вкладки Киного, затем нажмите «Повторить загрузку». Данные общие для этих вкладок.');
      }
      tab = await target(session);
      if (!tab) return;
      await chrome.browsingData.remove({ origins: [...KINOGO_DATA_ORIGINS] }, {
        cache: true, cacheStorage: true, serviceWorkers: true, cookies: true, localStorage: true, indexedDB: true
      });
    }
    // Deleting site data may take seconds. Revalidate after it finishes so a
    // closed room, a newly selected player or another page is never reloaded.
    if (!await target(session)) return;
    await chrome.tabs.reload(session.mediaTabId, { bypassCache: true });
  }

  async function start(session, manual = false) {
    if (!blank(session) || jobs.has(session) || (!manual && !pageTimedOut(session))) return false;
    const previous = session.recoveryAttempts || 0;
    if (!manual && previous >= (enabled() ? 2 : 1)) return false;
    // Enabling recovery means site-data cleanup is already the selected remedy.
    // Don't make the user wait through another ineffective cache-only reload.
    const attempt = enabled() ? 2 : 1;
    session.recoveryAttempts = attempt;
    session.recovering = true;
    session.error = '';
    jobs.add(session);
    await save();
    // Don't hold the room-message queue during a slow browser cleanup.
    void run(session, attempt).then(() => '', error => error.message || 'Не удалось восстановить загрузку Киного.')
      .then(error => enqueue(async () => {
        if (!active(session)) return;
        session.recovering = false;
        if (error && blank(session)) { session.error = error; session.recoveryAttempts = 2; }
        else session.openedAt = Date.now();
        await save();
        if (blank(session) && !error) await watch(session);
      })).catch(() => {}).finally(() => jobs.delete(session));
    return true;
  }

  return { start, watch, cancel };
}
