import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ executablePath:process.env.QA_CHROME, headless:true, args:["--mute-audio"] });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const context = await browser.newContext({viewport:{width:1487,height:1000},locale:"ru-RU"});
const page = await context.newPage(), errors = [];
page.on("pageerror", e=>errors.push(e.message));
async function capture(name) {
  if (!process.env.QA_SCREEN_DIR) return;
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(process.env.QA_SCREEN_DIR,name+".png"),animations:"disabled"});
}
try {
  await page.goto(base);
  const nav = page.getByRole("navigation");
  await page.getByRole("heading",{name:"Мои комнаты"}).waitFor();
  await page.waitForFunction(()=>!document.querySelector(".create-nav").disabled);
  await capture("home");
  assert.equal(await page.getByRole("button",{name:"Свой фильм",exact:true}).count(),0);
  for(const label of ["Все 100 фильмов","Все 100 сериалов","Все 100 аниме"]) {
    await page.getByRole("button",{name:label,exact:true}).click();
    const dialog=page.getByRole("dialog",{name:label});
    assert.equal(await dialog.getByRole("listitem").count(),100);
    const names = await dialog.locator(".rank-name").allTextContents();
    assert.ok(names.every(Boolean));
    const scores = (await dialog.locator(".rank-score").allTextContents()).map(s=>Number(s.replace(",",".")));
    assert.ok(scores.every((v,i)=>v>0 && v<=10 && (!i || scores[i-1]>=v)));
    if(label==="Все 100 фильмов") {
      await dialog.locator(".rank-save").first().click();
      await dialog.locator(".rank-save[aria-pressed=true]").first().waitFor();
    }
    await dialog.getByRole("button",{name:"Закрыть"}).click();
  }
  await nav.getByRole("link",{name:"Наш список"}).click();
  await page.reload();
  await page.locator(".chart-results article").first().waitFor();
  await page.locator(".chart-results .rank-save").first().click();
  await page.getByRole("heading",{name:"Список пока пуст"}).waitFor();
  await nav.getByRole("link",{name:"Главная"}).click();
  await page.getByRole("searchbox").fill("дЮнА");
  await page.getByRole("button",{name:"Смотреть: Дюна",exact:true}).waitFor();
  await page.getByRole("button",{name:"Очистить поиск"}).click();
  await page.getByRole("button",{name:"Регистрация",exact:true}).click();
  await page.getByRole("dialog",{name:"Регистрация"}).getByLabel("Логин").waitFor();
  await page.getByRole("button",{name:"Закрыть"}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("group",{name:"Категория рейтинга"}).getByRole("button",{name:"Аниме"}).click();
  await page.getByRole("button",{name:"Все 100 аниме"}).waitFor();
  await capture("mobile");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await nav.getByRole("button",{name:"Создать комнату"}).click();
  const own=page.getByRole("dialog");
  await own.getByRole("button",{name:"С компьютера"}).click();
  await own.getByRole("button",{name:/Выбрать файл/}).waitFor();
  await own.getByRole("button",{name:"По ссылке"}).click();
  await own.getByLabel("Ссылка на фильм").fill("https://example.org/watch/party");
  await own.getByLabel("Ваше имя").fill("Зритель");
  await own.getByLabel("Название фильма",{exact:true}).fill("Проверка комнаты");
  await own.getByRole("button",{name:"Создать комнату"}).click();
  await page.waitForURL(/\/room\/[a-f0-9]{12}$/);
  const room=new URL(page.url()).pathname;
  await page.getByRole("button",{name:"Пригласить друга",exact:true}).waitFor();
  await page.getByRole("link",{name:"Together Tonight — на главную"}).click();
  const resume=page.getByRole("link",{name:/Открыть комнату:.*Проверка комнаты/});
  assert.equal(await resume.getAttribute("href"),room);
  // Earlier releases saved room credentials, but no host/guest label in local history.
  await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem("vm-recent")); rows.forEach(row=>delete row.isHost); localStorage.setItem("vm-recent",JSON.stringify(rows));});
  await page.reload(); await page.getByRole("button",{name:/^Удалить или убрать комнату:.*Проверка комнаты/}).click();
  const erase=page.getByRole("dialog",{name:"Удалить комнату для всех?"});
  await erase.getByRole("button",{name:"Удалить комнату",exact:true}).click();
  await page.getByText("Комната удалена для всех").waitFor();
  await page.reload(); await page.getByText(/Здесь появятся комнаты, которые/).waitFor();
  assert.equal(await resume.count(),0);
  assert.deepEqual(errors,[]);
  console.log("PASS: 3 × 100 rankings, score order, bookmarks, global search, registration entry, mobile and guest rooms");
} finally { await browser.close(); }
