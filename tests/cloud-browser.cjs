const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const root = require("node:path").resolve(__dirname, "..");
const BASE = process.env.VSG_TEST_BASE_URL || "http://127.0.0.1:8000";
const HOST = "https://tpmhqzqfudcsdzfdhfjc.supabase.co";
const A = "11111111-1111-4111-8111-111111111111",
  ADMIN = "33333333-3333-4333-8333-333333333333",
  P = "44444444-4444-4444-8444-444444444444";
const S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  R = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const members = [
  {
    user_id: A,
    display_name: "Участник",
    email: "member@test.kz",
    role: "member",
  },
  {
    user_id: ADMIN,
    display_name: "Администратор",
    email: "admin@test.kz",
    role: "admin",
  },
  {
    user_id: P,
    display_name: "Новый участник",
    email: "pending@test.kz",
    role: "pending",
  },
];
const shops = [
  {
    id: S,
    name: "Настоящий магазин",
    address: "Астана, проспект Туран, 1",
    city: "Астана",
  },
];
const photoPath = `${A}/${R}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
const reports = [
  {
    id: R,
    store_id: S,
    author_id: A,
    result: "clean",
    description: "Сроки проверены, нарушений не найдено.",
    occurred_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    moderation_state: "approved",
    moderation_note: "",
    photos: [{ storage_path: photoPath, filename: "фото.png", sort_order: 0 }],
  },
];
function user(member) {
  return {
    id: member.user_id,
    aud: "authenticated",
    role: "authenticated",
    email: member.email,
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { display_name: member.display_name },
    app_metadata: { provider: "email" },
    created_at: new Date().toISOString(),
    identities: [],
  };
}
function token(id) {
  return (
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: id,
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        session_id: crypto.randomUUID(),
      }),
    ).toString("base64url") +
    ".test"
  );
}
function actor(request) {
  try {
    return JSON.parse(
      Buffer.from(request.headers().authorization.split(".")[1], "base64url"),
    ).sub;
  } catch {
    return null;
  }
}
let browser;
let debugPage;
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
  const page = await context.newPage();
  debugPage = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let firstFailure = true,
    uploaded = 0,
    signupCalls = 0,
    recoverCalls = 0,
    passwordUpdates = 0,
    publicFailure = false;
  const submitted = [];
  await context.route(BASE + "/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: fs
        .readFileSync(root + "/config.js", "utf8")
        .replace("enabled: false", "enabled: true"),
    }),
  );
  await context.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await context.route(HOST + "/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const headers = {
      "x-supabase-api-version": "2024-01-01",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    const json = (data, status = 200) =>
      route.fulfill({
        status,
        headers,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (path.startsWith("/auth/v1/token")) {
      const body = request.postDataJSON(),
        member = members.find((m) => m.email === body.email);
      if (!member || body.password !== "password123")
        return json(
          { code: "invalid_credentials", msg: "Invalid login credentials" },
          400,
        );
      return json({
        access_token: token(member.user_id),
        refresh_token: "test-refresh-" + member.user_id,
        expires_in: 3600,
        token_type: "bearer",
        user: user(member),
      });
    }
    if (path === "/auth/v1/signup") {
      signupCalls++;
      return json({ user: user(members[2]), session: null });
    }
    if (path === "/auth/v1/recover") {
      recoverCalls++;
      return json({});
    }
    if (path === "/auth/v1/logout")
      return route.fulfill({ status: 204, headers });
    if (path === "/auth/v1/user") {
      if (request.method() === "PUT") passwordUpdates++;
      return json(
        user(members.find((m) => m.user_id === actor(request)) || members[0]),
      );
    }
    if (path === "/rest/v1/vsg_public_reports") {
      if (publicFailure) return json({ message: "Unavailable" }, 503);
      const approved = reports.filter((r) => r.moderation_state === "approved");
      return json(
        approved.map((r) => ({
          ...r,
          store_name: shops.find((s) => s.id === r.store_id).name,
          address: shops.find((s) => s.id === r.store_id).address,
          city: "Астана",
          photos: r.photos.map((p) => ({
            path: p.storage_path,
            filename: p.filename,
            order: p.sort_order,
          })),
        })),
      );
    }
    if (path === "/rest/v1/vsg_public_stats")
      return json({
        stores: new Set(
          reports
            .filter((r) => r.moderation_state === "approved")
            .map((r) => r.store_id),
        ).size,
        violations: reports.filter(
          (r) => r.moderation_state === "approved" && r.result === "violation",
        ).length,
        reports: reports.filter((r) => r.moderation_state === "approved")
          .length,
        members: members.filter((m) => ["admin", "member"].includes(m.role))
          .length,
      });
    if (path === "/rest/v1/vsg_members") {
      const id = url.searchParams.get("user_id");
      return json(
        id
          ? members.filter((m) => m.user_id === id.replace("eq.", ""))
          : members,
      );
    }
    if (path === "/rest/v1/vsg_stores") return json(shops);
    if (path === "/rest/v1/vsg_reports") {
      let rows = reports;
      for (const field of ["id", "author_id", "moderation_state"])
        if (url.searchParams.get(field))
          rows = rows.filter(
            (r) => r[field] === url.searchParams.get(field).replace("eq.", ""),
          );
      return json(
        rows.map((r) => ({
          ...r,
          store: shops.find((s) => s.id === r.store_id),
        })),
      );
    }
    if (path === "/storage/v1/object/sign/vsg-report-photos")
      return json(
        request.postDataJSON().paths.map((p) => ({
          path: p,
          signedURL: "/object/sign/vsg-report-photos/" + p + "?token=test",
          error: null,
        })),
      );
    if (path.startsWith("/storage/v1/object/sign/vsg-report-photos/"))
      return route.fulfill({
        headers,
        contentType: "image/png",
        body: fs.readFileSync(root + "/assets/milk.png"),
      });
    if (path.startsWith("/storage/v1/object/vsg-report-photos/")) {
      uploaded++;
      return json({
        Key: decodeURIComponent(path.replace("/storage/v1/object/", "")),
        Id: crypto.randomUUID(),
      });
    }
    if (path === "/rest/v1/rpc/vsg_submit_report") {
      const data = request.postDataJSON();
      submitted.push(data.p_report_id);
      if (firstFailure) {
        firstFailure = false;
        return json({ code: "P0000", message: "Temporarily unavailable" }, 503);
      }
      let store = shops.find((s) => s.id === data.p_store_id);
      if (!store) {
        store = {
          id: crypto.randomUUID(),
          name: data.p_store_name,
          address: data.p_store_address,
          city: "Астана",
        };
        shops.push(store);
      }
      if (!reports.some((r) => r.id === data.p_report_id))
        reports.push({
          id: data.p_report_id,
          store_id: store.id,
          author_id: actor(request),
          result: data.p_result,
          description: data.p_description,
          occurred_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          moderation_state: "pending",
          moderation_note: "",
          photos: data.p_photos.map((p, i) => ({
            storage_path: p.path,
            filename: p.filename,
            sort_order: i,
          })),
        });
      return json(data.p_report_id);
    }
    if (path === "/rest/v1/rpc/vsg_moderate_report") {
      assert.equal(actor(request), ADMIN);
      const data = request.postDataJSON(),
        report = reports.find((r) => r.id === data.p_report_id);
      report.moderation_state = data.p_decision;
      report.moderation_note = data.p_note;
      return route.fulfill({ status: 204, headers });
    }
    if (path === "/rest/v1/rpc/vsg_set_member_role") {
      assert.equal(actor(request), ADMIN);
      const data = request.postDataJSON();
      members.find((m) => m.user_id === data.p_user_id).role = data.p_role;
      return route.fulfill({ status: 204, headers });
    }
    throw Error("Unexpected request: " + request.method() + " " + path);
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelectorAll(".store-card").length === 1,
  );
  assert.equal(await page.locator("#submit-report").isDisabled(), true);
  assert.match(await page.locator("#stat-stores").textContent(), /^1/);
  assert.equal(
    await page.locator(".store-card").filter({ hasText: "Полка" }).count(),
    0,
  );
  await page.locator("#account-button").click();
  await page.locator("[data-auth-mode=register]").click();
  await page.locator("#auth-name").fill("Тестовый участник");
  await page.locator("#auth-email").fill("new@test.kz");
  await page.locator("#auth-password").fill("password123");
  await page.locator("#auth-password-repeat").fill("different123");
  await page.locator("#auth-form button[type=submit]").click();
  assert.match(await page.locator("#auth-error").textContent(), /не совпадают/);
  await page.locator("#auth-password-repeat").fill("password123");
  await page.locator("#auth-form button[type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#auth-feedback")
      ?.textContent.includes("Проверьте почту"),
  );
  assert.equal(signupCalls, 1);
  await page.locator("[data-auth-mode=reset]").click();
  await page.locator("#auth-email").fill("member@test.kz");
  await page.locator("#auth-form button[type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#auth-feedback")
      ?.textContent.includes("получите ссылку"),
  );
  assert.equal(recoverCalls, 1);
  await page.locator("[data-auth-mode=login]").click();
  async function login(email) {
    await page.locator("#auth-email").fill(email);
    await page.locator("#auth-password").fill("password123");
    await page.locator("#auth-form button[type=submit]").click();
    await page.locator("#sign-out").waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".account-loading"),
    );
  }
  await page.locator("#auth-email").fill("member@test.kz");
  await page.locator("#auth-password").fill("bad-password");
  await page.locator("#auth-form button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector("#auth-error")?.textContent.includes("Неверная"),
  );
  await login("member@test.kz");
  assert.equal(await page.locator("[data-review]").count(), 0);
  await page.locator("#close-account").click();
  assert.equal(await page.locator("#submit-report").isDisabled(), false);
  await page.locator("#store-select").selectOption("new");
  await page.locator("#store-name").fill("Общий магазин");
  await page.locator("#store-address").fill("Астана, улица Достык, 5");
  await page
    .locator("#report-description")
    .fill("На упаковке срок истёк на два дня. Фото маркировки приложено.");
  await page.locator("#photo-input").setInputFiles(root + "/assets/milk.png");
  await page.waitForFunction(
    () => document.querySelectorAll(".photo-preview").length === 1,
  );
  await page.locator("#submit-report").click();
  await page.waitForFunction(() =>
    document.querySelector("#form-error").textContent.includes("повторить"),
  );
  assert.equal(await page.locator(".photo-preview").count(), 1);
  assert.equal(await page.locator(".store-card").count(), 1);
  await page.locator("#submit-report").click();
  await page.locator("#form-success").waitFor({ state: "visible" });
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0], submitted[1]);
  assert.equal(uploaded, 1);
  assert.equal(await page.locator(".store-card").count(), 1);
  assert.match(
    await page.locator("#form-success").textContent(),
    /на проверку/,
  );
  await page.locator("#form-success [data-open-account]").click();
  await page.waitForFunction(() => document.querySelector(".account-report"));
  assert.match(
    await page.locator("#account-data").textContent(),
    /На проверке/,
  );
  await page
    .locator('[data-private-report="' + submitted[1] + '"]')
    .first()
    .click();
  await page.locator(".gallery-photo").first().click();
  await page.locator("#lightbox-image").evaluate((img) => img.decode());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("#sign-out").click();
  await page.locator("#auth-email").waitFor();
  assert.equal(await page.locator("#store-detail").textContent(), "");
  assert.equal(await page.locator("#lightbox-image").getAttribute("src"), null);
  await login("admin@test.kz");
  const approval = page.locator(
    '[data-review=approved][data-report-id="' + submitted[1] + '"]',
  );
  await approval.waitFor();
  await approval.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".store-card").length === 2,
  );
  assert.match(await page.locator("#stat-stores").textContent(), /^2/);
  assert.match(await page.locator("#stat-issues").textContent(), /^1/);
  await page
    .locator('[data-member-id="' + P + '"][data-member-role=member]')
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#stat-members").textContent.startsWith("3"),
  );
  await page.locator("#sign-out").click();
  await page.locator("#auth-email").waitFor();
  await login("pending@test.kz");
  await page.locator("#close-account").click();
  assert.equal(await page.locator("#submit-report").isDisabled(), false);
  for (const width of [320, 375, 390, 640, 700, 701, 768, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "width " + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#account-button").click();
  assert.equal(
    await page
      .locator("#account-dialog")
      .evaluate((d) => d.scrollWidth <= d.clientWidth),
    true,
  );
  await page.locator("#close-account").click();
  publicFailure = true;
  await page.locator("#refresh-cloud").click();
  await page.waitForFunction(() =>
    document.querySelector("#cloud-status").classList.contains("has-error"),
  );
  assert.equal(await page.locator(".store-card").count(), 2);
  publicFailure = false;
  await page.locator("#refresh-cloud").click();
  await page.waitForFunction(
    () =>
      !document.querySelector("#cloud-status").classList.contains("has-error"),
  );
  await page.screenshot({
    path: require("node:path").join(
      require("node:os").tmpdir(),
      "vsg-cloud-mobile.png",
    ),
    fullPage: true,
  });
  await page.locator("#account-button").click();
  await page.locator("#sign-out").click();
  await page.locator("#auth-email").waitFor();
  await page.goto("about:blank");
  await page.goto(
    BASE +
      "/#access_token=" +
      token(A) +
      "&refresh_token=recovery-test&expires_in=3600&token_type=bearer&type=recovery",
    { waitUntil: "networkidle" },
  );
  await page.locator("#auth-password-repeat").waitFor();
  await page.locator("#auth-password").fill("new-password123");
  await page.locator("#auth-password-repeat").fill("new-password123");
  await page.locator("#auth-form button[type=submit]").click();
  await page.locator("#sign-out").waitFor();
  assert.equal(passwordUpdates, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual Supabase SDK against fixture HTTP API; public approved data; signed private photos; auth/signup/reset/error; account roles; upload and retry with stable ID/no duplicate upload; pending report stays private; admin approval updates public map; membership approval; gallery; stale-data error; 320–1440 responsive layout.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (debugPage)
    console.log(
      "Auth diagnostic:",
      await debugPage
        .locator("#auth-error")
        .textContent()
        .catch(() => ""),
    );
  if (browser) await browser.close();
  process.exitCode = 1;
});
