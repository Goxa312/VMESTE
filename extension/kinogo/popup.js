const byId = id => document.getElementById(id);
const send = async (type, data = {}) => {
  const response = await chrome.runtime.sendMessage({ channel: 'vmeste-extension', type, ...data });
  if (response?.error) throw new Error(response.error);
  return response;
};
const feedback = message => { byId('feedback').textContent = message; };
async function action(type, data) {
  try { await send(type, data); if (type !== 'popup-disconnect') window.close(); else await refresh(); }
  catch (error) { feedback(error.message); }
}
async function refresh() {
  try {
    const result = await send('popup-status');
    byId('version').textContent = `v${result.version}`;
    byId('heading').textContent = result.rooms.length ? 'Просмотр подключён' : 'Расширение готово';
    byId('description').textContent = result.rooms.length ? 'К комнате и фильму можно вернуться одним нажатием.' : 'В комнате нажмите «Смотреть на Киного», затем запустите фильм. Длинное видео подключится автоматически.';
    byId('sites').textContent = `Адреса приложения: ${result.origins.join(', ')}`;
    byId('rooms').replaceChildren();
    for (const room of result.rooms) {
      const card = document.createElement('div'); card.className = 'room';
      const title = document.createElement('strong'); title.textContent = `Комната ${room.roomId}`;
      const status = document.createElement('p'); status.textContent = room.error || (room.hasPlayer ? 'Плеер подключён · синхронизация включена' : room.pageReady ? 'Запустите фильм во вкладке Киного' : 'Ждём загрузку Киного');
      const buttons = document.createElement('div'); buttons.className = 'actions';
      for (const [label, type] of [['К комнате', 'popup-room'], ['К фильму', 'popup-film'], ['Отключить', 'popup-disconnect']]) {
        const button = document.createElement('button'); button.textContent = label;
        button.addEventListener('click', () => void action(type, { roomTabId: room.roomTabId })); buttons.append(button);
      }
      card.append(title, status, buttons); byId('rooms').append(card);
    }
  } catch (error) { feedback(error.message); }
}
byId('open').addEventListener('click', () => void action('open-app'));
byId('repair').addEventListener('click', async () => {
  const button = byId('repair'); button.disabled = true; feedback('Восстанавливаем подключение…');
  try {
    const result = await send('repair');
    feedback(result.repaired ? `Связь восстановлена в ${result.repaired} вкладках. Вернитесь в комнату.` : result.found ? 'Проверьте доступ расширения к этому сайту в настройках Chrome, затем повторите.' : 'Откройте сайт кнопкой выше, затем создайте комнату или войдите по приглашению.');
    await refresh();
  } catch (error) { feedback(error.message); }
  finally { button.disabled = false; }
});
void refresh();
