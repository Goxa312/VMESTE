export const APP_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'https://vmeste.dadvanigeorgii.workers.dev'];
export const MEDIA_ORIGINS = ['https://kinogo.my', 'https://www.kinogo.my', 'https://kinogomy.stravers.live'];

export function movieId(value) {
  try {
    const u = new URL(value);
    if (!['https://kinogo.my', 'https://www.kinogo.my'].includes(u.origin) || u.username || u.password) return null;
    return u.pathname.match(/\/(?:page,\d+,\d+,)?(\d+)-[^/]+\.html$/i)?.[1] ?? null;
  } catch { return null; }
}

export function isAppSender(sender) {
  try {
    const u = new URL(sender.url);
    return sender.frameId === 0 && Number.isInteger(sender.tab?.id) && APP_ORIGINS.includes(u.origin);
  } catch { return false; }
}

export function appRoom(sender) {
  if (!isAppSender(sender)) return null;
  return new URL(sender.url).pathname.match(/^\/room\/([a-z0-9]{12})\/?$/)?.[1] ?? null;
}

export function playback(data, roomId) {
  if (!data || data.roomId !== roomId || !movieId(data.sourceUrl) ||
      typeof data.isHost !== 'boolean' || typeof data.connected !== 'boolean' || typeof data.playing !== 'boolean' ||
      !Number.isFinite(data.position) || data.position < 0 || data.position > 604800 ||
      !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Number.isFinite(data.sampledAt) || Math.abs(Date.now() - data.sampledAt) > 30000) throw new Error('Некорректное состояние комнаты');
  // Copy only the playback fields. Never relay credentials, chat or membership data.
  return { roomId, sourceUrl: data.sourceUrl, isHost: data.isHost, connected: data.connected,
    playing: data.playing, position: data.position, revision: data.revision, sampledAt: data.sampledAt };
}

export function isMediaSender(sender, session) {
  try {
    return sender.tab?.id === session.mediaTabId &&
      movieId(sender.tab.url) === movieId(session.state.sourceUrl) &&
      MEDIA_ORIGINS.includes(new URL(sender.url).origin);
  } catch { return false; }
}

export function validateControl(data) {
  if (!data || typeof data.playing !== 'boolean' || !Number.isFinite(data.position) || data.position < 0 || data.position > 604800) {
    throw new Error('Некорректная команда плеера');
  }
  return { playing: data.playing, position: data.position };
}
