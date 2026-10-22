const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const BASE = process.env.VSG_TEST_BASE_URL || "http://127.0.0.1:8000";
let browser;
(async () => {
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route(BASE + "/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.VSG_CONFIG = {enabled:false};",
    }),
  );
  await context.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  assert.equal(await page.locator("html").getAttribute("lang"), "ru");
  await page.locator("#store-select").selectOption("new");
  await page.locator("#store-name").fill("Всё чисто");
  await page.locator("#store-address").fill("улица Қонаев, 7");
  await page
    .locator("#report-description")
    .fill("Карта рейдов — текст участника, не переводить.");
  await page
    .locator("#photo-input")
    .setInputFiles({
      name: "Фотографии.png",
      mimeType: "image/png",
      buffer: fs.readFileSync(root + "/assets/milk.png"),
    });
  await page.locator("#add-product").click();
  await page.locator(".product-name").fill("Всё чисто");
  await page.locator(".product-quantity").fill("3");
  const check = await page.locator("#checked-date").inputValue();
  const expiry = new Date(Date.parse(check + "T00:00:00Z") - 3 * 86400000)
    .toISOString()
    .slice(0, 10);
  await page.locator(".product-expiry").fill(expiry);
  await page.locator(".product-photo").selectOption("0");
  await page.locator('[data-language="kk"]').click();
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  assert.equal(await page.locator("html").getAttribute("lang"), "kk");
  assert.match(await page.locator("h1").textContent(), /Мерзімі өтті ме/);
  assert.equal(
    await page.locator("#store-search").getAttribute("placeholder"),
    "Дүкен немесе мекенжай",
  );
  assert.match(
    await page.locator(".product-calculation").textContent(),
    /3 күнге өткен/,
  );
  assert.equal(await page.locator("#store-name").inputValue(), "Всё чисто");
  assert.equal(await page.locator(".product-name").inputValue(), "Всё чисто");
  assert.equal(await page.locator(".product-photo").inputValue(), "0");
  assert.match(
    await page.locator(".product-photo option").last().textContent(),
    /1-сурет: Фотографии.png/,
  );
  assert.equal(
    await page.locator("#report-description").inputValue(),
    "Карта рейдов — текст участника, не переводить.",
  );
  assert.equal(await page.locator(".photo-preview").count(), 1);
  await page.evaluate(() => VSGDrafts.flush());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector(".product-name")?.value === "Всё чисто",
  );
  assert.equal(await page.locator("html").getAttribute("lang"), "kk");
  assert.equal(await page.locator(".photo-preview").count(), 1);
  for (const lang of ["ru", "kk"]) {
    await page.evaluate((lang) => VSGI18n.setLanguage(lang), lang);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${lang} document overflow at ${width}`,
      );
      assert.equal(await page.locator(".language-switch").isVisible(), true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/#home", { waitUntil: "networkidle" });
  await page.screenshot({ path: "/tmp/vsg-kazakh-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/vsg-kazakh-desktop.png" });
  await page.evaluate(() =>
    openStore("i18n-fixture", null, {
      id: "i18n-fixture",
      name: "Всё чисто",
      address: "Карта рейдов, 1 <img src=x onerror=alert(1)>",
      city: "Астана",
      date: "2026-10-22T07:00:00Z",
      status: "clean",
      description: "Карта рейдов",
      demo: false,
      photos: [],
      products: [
        {
          name: "Всё чисто",
          quantity: 3,
          expiry: "2026-10-19",
          photo_index: null,
        },
      ],
      checkedDate: "2026-10-22",
    }),
  );
  assert.equal(await page.locator("#detail-title").textContent(), "Всё чисто");
  assert.equal(
    await page.locator(".detail-description").textContent(),
    "Карта рейдов",
  );
  assert.equal(
    await page.locator(".reported-products strong").first().textContent(),
    "Всё чисто",
  );
  assert.equal(await page.locator(".detail-address img").count(), 0);
  assert.match(
    await page.locator(".detail-address").textContent(),
    /<img src=x onerror=alert\(1\)>/,
  );
  assert.match(
    await page.locator("#store-directions").textContent(),
    /Бағыт құру/,
  );
  assert.match(
    await page.locator(".reported-products").first().textContent(),
    /3 күнге өткен/,
  );
  assert.match(
    await page.locator(".detail-status time").textContent(),
    /қазан/,
  );
  const route = await page.locator("#store-directions").getAttribute("href");
  await page.locator(".history-entry summary").click();
  await page.evaluate(() => VSGI18n.setLanguage("ru"));
  assert.match(
    await page.locator("#store-directions").textContent(),
    /Построить маршрут/,
  );
  assert.equal(
    await page.locator("#store-directions").getAttribute("href"),
    route,
  );
  assert.equal(
    await page.locator(".history-entry").first().getAttribute("open"),
    "",
  );
  assert.match(
    await page.locator(".reported-products").first().textContent(),
    /Просрочено на 3/,
  );
  assert.equal(await page.locator("#detail-title").textContent(), "Всё чисто");
  await page.evaluate(() => VSGI18n.setLanguage("kk"));
  assert.match(
    await page.locator(".detail-status time").textContent(),
    /қазан/,
  );
  assert.equal(await page.locator(".product-name").inputValue(), "Всё чисто");
  const missing = await page.evaluate(() => [...VSGI18n.missing]);
  assert.deepEqual(missing, [], "Missing interface translations");
  assert.deepEqual(errors, []);
  const blocked = await browser.newContext();
  await blocked.route(BASE + "/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.VSG_CONFIG={enabled:false};",
    }),
  );
  await blocked.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = Storage.prototype.setItem = () => {
      throw new DOMException("Storage disabled", "SecurityError");
    };
  });
  const fallback = await blocked.newPage();
  await fallback.goto(BASE + "/", { waitUntil: "networkidle" });
  await fallback.locator('[data-language="kk"]').click();
  assert.equal(await fallback.locator("html").getAttribute("lang"), "kk");
  console.log(
    "PASS: RU/KK switching without reload; saved choice; complete interface dictionary in exercised views; Kazakh dates; drafts/photos/products preserved; user text is not translated; safe HTML; route stays unchanged; expanded history stays open; 320–1440 layouts; blocked localStorage fallback.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
