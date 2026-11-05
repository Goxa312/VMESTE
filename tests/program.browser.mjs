import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ executablePath: process.env.QA_CHROME, headless: true, args: ["--mute-audio"] });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const context = await browser.newContext({ viewport: { width: 1487, height: 1058 }, locale: "ru-RU" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
async function capture(name) {
  if (!process.env.QA_SCREEN_DIR) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(process.env.QA_SCREEN_DIR, name + ".png"), animations: "disabled" });
}
try {
  await page.goto(base);
  await page.getByRole("button", { name: "В список", exact: true }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Наш список" }).click();
  await page.getByRole("button", { name: "Смотреть: После заката" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Убрать из списка: После заката" }).click();
  await page.getByRole("heading", { name: "Список пока пуст" }).waitFor();
  await page.getByRole("navigation").getByRole("link", { name: "Главная" }).click();
  await page.getByRole("heading", { name: "Что посмотреть" }).waitFor();
  await capture("home");
  const search = page.getByRole("searchbox");
  await search.fill("дЮнА");
  const results = page.locator(".film-card");
  await results.getByRole("button", { name: "Смотреть: Дюна" }).waitFor();
  assert.equal(await results.count(), 1);
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await page.getByRole("button", { name: "Смотреть", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "После заката" });
  assert.equal(await dialog.getByLabel("Название фильма", { exact: true }).inputValue(), "После заката");
  await dialog.getByRole("button", { name: "С компьютера" }).click();
  await dialog.getByRole("button", { name: /Выбрать файл/ }).waitFor();
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("home-mobile");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Меню просмотра" }).click();
  await page.getByRole("button", { name: "Загрузить файл" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Выбрать файл/ }).waitFor();
  await page.getByRole("button", { name: "Закрыть" }).click();

  // An actual visit must appear on the home screen with a link back to that same room.
  await page.getByRole("button", { name: "Свой фильм" }).click();
  const own = page.getByRole("dialog");
  await own.getByLabel("Ссылка на фильм").fill("https://example.org/watch/party");
  await own.getByLabel("Ваше имя").fill("Зритель");
  await own.getByLabel("Название фильма", { exact: true }).fill("Проверка комнаты");
  await own.getByRole("button", { name: "Создать комнату" }).click();
  await page.waitForURL(/\/room\/[a-f0-9]{12}$/);
  const room = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Пригласить друга", exact: true }).waitFor();
  await page.getByRole("link", { name: "Together Tonight — на главную" }).click();
  await page.getByRole("heading", { name: "Продолжить просмотр" }).waitFor();
  const resume = page.getByRole("link", { name: "Продолжить просмотр: Проверка комнаты" });
  assert.equal(await resume.getAttribute("href"), room);
  await resume.click();
  await page.getByRole("button", { name: "Пригласить друга", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, room);
  assert.deepEqual(errors, []);
  console.log("PASS: saved list persists, search, source selection, mobile file entry, creating and resuming a room");
} finally {
  await browser.close();
}
