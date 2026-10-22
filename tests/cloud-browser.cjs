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
    latitude: 51.13,
    longitude: 71.425,
    moderation_state: "approved",
    moderation_note: "",
    photos: [{ storage_path: photoPath, filename: "фото.png", sort_order: 0 }],
  },
];
for (let i = 1; i <= 22; i++)
  reports.push({
    ...reports[0],
    id: crypto.randomUUID(),
    description: `Прошлая опубликованная проверка ${i}`,
    occurred_at: new Date(Date.now() - i * 86400000).toISOString(),
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
  });
reports.push({
  ...reports[0],
  id: crypto.randomUUID(),
  description: "СЕКРЕТНЫЙ ЧЕРНОВОЙ ОТЧЁТ",
  moderation_state: "pending",
});
reports.push({
  ...reports[0],
  id: crypto.randomUUID(),
  description: "СКРЫТЫЙ ОТКЛОНЁННЫЙ ОТЧЁТ",
  moderation_state: "rejected",
});
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
    publicFailure = false,
    historyFailure = false,
    historyMissing = false,
    adminFailure = false,
    adminMissing = false,
    moderationFailure = false;
  const submitted = [];
  const uploadedPaths = new Set();
  await context.route(BASE + "/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: fs
        .readFileSync(root + "/config.js", "utf8")
        .replace("enabled: false", "enabled: true"),
    }),
  );
  await context.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  let tilesFail = false,
    searchFail = false;
  await context.route("https://tile.openstreetmap.org/**", (route) =>
    tilesFail
      ? route.abort()
      : route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
            "base64",
          ),
        }),
  );
  await context.route("https://photon.komoot.io/**", (route) =>
    searchFail
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            features: [
              {
                geometry: { coordinates: [71.43, 51.14] },
                properties: {
                  name: "Магазин <test>",
                  street: "Достык",
                  housenumber: "5",
                  city: "Астана",
                },
              },
              {
                geometry: { coordinates: [76.9, 43.25] },
                properties: { name: "Другой город" },
              },
            ],
          }),
        }),
  );
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
    if (
      ["/rest/v1/vsg_public_reports", "/rest/v1/vsg_public_history"].includes(
        path,
      )
    ) {
      const history = path.endsWith("history");
      if (history && historyMissing)
        return json({ code: "PGRST205", message: "Missing view" }, 404);
      if ((history && historyFailure) || (!history && publicFailure))
        return json({ message: "Unavailable" }, 503);
      let approved = reports
        .filter((r) => r.moderation_state === "approved")
        .sort(
          (a, b) =>
            b.occurred_at.localeCompare(a.occurred_at) ||
            b.created_at.localeCompare(a.created_at) ||
            b.id.localeCompare(a.id),
        );
      if (history) {
        const storeId = url.searchParams.get("store_id")?.replace("eq.", "");
        approved = approved.filter((r) => r.store_id === storeId);
        const from = Number(url.searchParams.get("offset") || 0),
          count = Number(url.searchParams.get("limit") || 21);
        approved = approved.slice(from, from + count);
      } else
        approved = approved.filter(
          (r, index, all) =>
            all.findIndex((item) => item.store_id === r.store_id) === index,
        );
      return json(
        approved.map((r) => ({
          id: r.id,
          store_id: r.store_id,
          store_name: shops.find((s) => s.id === r.store_id).name,
          address: shops.find((s) => s.id === r.store_id).address,
          city: "Астана",
          checked_date: r.checked_date,
          products: r.products || [],
          result: r.result,
          description: r.description,
          occurred_at: r.occurred_at,
          created_at: r.created_at,
          latitude: r.latitude,
          longitude: r.longitude,
          photos: r.photos.map((p) => ({
            path: p.storage_path,
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
      if (uploadedPaths.has(path))
        return json(
          {
            statusCode: "409",
            error: "Duplicate",
            message: "The resource already exists",
          },
          409,
        );
      uploadedPaths.add(path);
      return json({
        Key: decodeURIComponent(path.replace("/storage/v1/object/", "")),
        Id: crypto.randomUUID(),
      });
    }
    if (
      [
        "/rest/v1/rpc/vsg_submit_report",
        "/rest/v1/rpc/vsg_submit_located_report",
        "/rest/v1/rpc/vsg_submit_product_report",
      ].includes(path)
    ) {
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
          latitude: data.p_latitude ?? null,
          longitude: data.p_longitude ?? null,
          checked_date: data.p_checked_date,
          products: data.p_products || [],
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
      if (moderationFailure) return json({ message: "Unavailable" }, 503);
      const data = request.postDataJSON(),
        report = reports.find((r) => r.id === data.p_report_id);
      report.moderation_state = data.p_decision;
      if (data.p_decision === "rejected")
        assert.ok(data.p_note.trim().length >= 5);
      report.moderation_note = data.p_note;
      return route.fulfill({ status: 204, headers });
    }
    if (path === "/rest/v1/rpc/vsg_set_report_location") {
      assert.equal(actor(request), ADMIN);
      const data = request.postDataJSON();
      const report = reports.find((r) => r.id === data.p_report_id);
      report.latitude = data.p_latitude;
      report.longitude = data.p_longitude;
      return route.fulfill({ status: 204, headers });
    }
    if (path === "/rest/v1/rpc/vsg_admin_dashboard") {
      assert.equal(actor(request), ADMIN);
      if (adminMissing)
        return json({ code: "PGRST202", message: "Missing function" }, 404);
      if (adminFailure) return json({ message: "Unavailable" }, 503);
      const data = request.postDataJSON();
      const counts = {
        reports_pending: reports.filter((r) => r.moderation_state === "pending")
          .length,
        reports_approved: reports.filter(
          (r) => r.moderation_state === "approved",
        ).length,
        reports_rejected: reports.filter(
          (r) => r.moderation_state === "rejected",
        ).length,
        members_pending: members.filter((m) => m.role === "pending").length,
        members_active: members.filter((m) =>
          ["member", "admin"].includes(m.role),
        ).length,
        members_blocked: members.filter((m) => m.role === "blocked").length,
      };
      const query = (data.p_query || "").trim().toLowerCase();
      let items = [];
      if (data.p_tab === "reports")
        items = reports
          .filter(
            (r) =>
              (data.p_state === "all" || r.moderation_state === data.p_state) &&
              [
                shops.find((s) => s.id === r.store_id).name,
                shops.find((s) => s.id === r.store_id).address,
                members.find((m) => m.user_id === r.author_id)?.display_name,
              ]
                .join(" ")
                .toLowerCase()
                .includes(query),
          )
          .sort(
            (a, b) =>
              b.created_at.localeCompare(a.created_at) ||
              b.id.localeCompare(a.id),
          )
          .map((r) => ({
            ...r,
            author_name:
              members.find((m) => m.user_id === r.author_id)?.display_name ||
              "Участник",
            store: shops.find((s) => s.id === r.store_id),
          }));
      if (data.p_tab === "members")
        items = members
          .filter(
            (m) =>
              (data.p_state === "all" || m.role === data.p_state) &&
              [m.display_name, m.email].join(" ").toLowerCase().includes(query),
          )
          .map((m) => ({ ...m, created_at: new Date().toISOString() }));
      return json({
        counts,
        total: items.length,
        items: items.slice(data.p_offset, data.p_offset + 20),
      });
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
  const mapping = await page.evaluate(async () => {
    const fake = {
      config: { bucket: "vsg-report-photos" },
      check: (response) => response.data,
      client: {
        storage: {
          from: () => ({
            createSignedUrls: async () => ({
              data: [
                { path: "a", error: "Missing" },
                { path: "b", signedUrl: "https://example.test/b" },
              ],
            }),
          }),
        },
      },
    };
    const rows = await window.VSGBackend.prototype.hydrate.call(
      fake,
      [
        {
          store_id: "shop",
          products: [
            { name: "Первый", photo_index: 0 },
            { name: "Второй", photo_index: 1 },
          ],
          photos: [
            { path: "a", order: 0 },
            { path: "b", order: 1 },
          ],
        },
      ],
      true,
    );
    return rows[0].products.map((p) => ({
      index: p.photo_index,
      missing: p.evidence_unavailable,
    }));
  });
  assert.deepEqual(mapping, [
    { index: null, missing: true },
    { index: 0, missing: false },
  ]);
  assert.equal(await page.locator("#submit-report").isDisabled(), true);
  assert.match(await page.locator("#stat-stores").textContent(), /^1/);
  assert.equal(
    await page.locator(".store-card").filter({ hasText: "Полка" }).count(),
    0,
  );
  assert.equal(await page.locator("#real-map.leaflet-container").count(), 1);
  await page.locator("[data-real-marker]").first().waitFor();
  assert.equal(await page.locator("[data-real-marker]").count(), 1);
  assert.equal(await page.locator("#map-plane").isVisible(), false);
  assert.equal(
    await page.locator("#real-map .leaflet-control-attribution").isVisible(),
    true,
  );
  const zoomBefore = await page
    .locator("#real-map .leaflet-proxy")
    .getAttribute("style");
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(350);
  assert.notEqual(
    await page.locator("#real-map .leaflet-proxy").getAttribute("style"),
    zoomBefore,
  );
  await page.locator("#fit-map").click();
  await page.locator("[data-real-marker]").first().click();
  await page.locator(".real-popup button").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-entry").length === 20,
  );
  assert.equal(
    await page
      .locator("#store-history")
      .textContent()
      .then((t) => t.includes("СЕКРЕТНЫЙ")),
    false,
  );
  assert.equal(
    await page
      .locator("#store-history")
      .textContent()
      .then((t) => t.includes("СКРЫТЫЙ")),
    false,
  );
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page
        .locator("#store-dialog")
        .evaluate((d) => d.scrollWidth <= d.clientWidth),
      true,
      "history width " + width,
    );
  }
  await page.locator("#store-history").scrollIntoViewIfNeeded();
  await page
    .locator("#store-dialog")
    .screenshot({ path: "/tmp/vsg-history-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#history-more").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-entry").length === 23,
  );
  assert.equal(await page.locator("#history-more").isVisible(), false);
  await page.locator(".history-entry summary").last().click();
  await page
    .locator(".history-entry")
    .last()
    .locator(".history-photos button")
    .first()
    .click();
  await page.locator("#lightbox-image").evaluate((img) => img.decode());
  await page.keyboard.press("Escape");
  await page.locator("#close-detail").click();
  await page.locator('[data-filter="violation"]').click();
  assert.equal(await page.locator("[data-real-marker]").count(), 0);
  await page.locator('[data-filter="all"]').click();
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
      () =>
        !document.querySelector(".account-loading") &&
        !document.querySelector("#admin-results[inert]"),
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
  await page.locator("#choose-location").click();
  assert.equal(await page.locator("#save-location").isDisabled(), true);
  await page.locator("#location-search-button").click();
  await page.locator("#location-results button").waitFor();
  assert.equal(await page.locator("#location-results button").count(), 1);
  assert.match(await page.locator("#location-results").textContent(), /<test>/);
  assert.equal(await page.locator("#location-results test").count(), 0);
  await page.locator("#location-results button").click();
  await page.locator("#save-location").click();
  assert.match(
    await page.locator("#location-value").textContent(),
    /51.140000/,
  );
  await page
    .locator("#report-description")
    .fill("На упаковке срок истёк на два дня. Фото маркировки приложено.");
  await page.locator("#photo-input").setInputFiles(root + "/assets/milk.png");
  await page.waitForFunction(
    () => document.querySelectorAll(".photo-preview").length === 1,
  );
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  assert.equal(
    await page.evaluate(() =>
      window.VSGProducts.days("2024-03-01", "2024-02-29"),
    ),
    1,
  );
  assert.equal(
    await page.evaluate(() =>
      window.VSGProducts.days("2026-10-22", "2026-10-23"),
    ),
    -1,
  );
  const checkedDate = await page.locator("#checked-date").inputValue();
  const expiryDate = new Date(
    Date.parse(checkedDate + "T00:00:00Z") - 3 * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  await page.locator("#add-product").click();
  await page.locator(".product-name").first().fill("Йогурт <Danone>");
  await page.locator(".product-quantity").first().fill("4");
  await page.locator(".product-expiry").first().fill(expiryDate);
  await page.locator(".product-photo").first().selectOption("0");
  assert.match(
    await page.locator(".product-calculation").first().textContent(),
    /на 3 дн/,
  );
  await page.locator(".product-expiry").first().fill(checkedDate);
  assert.match(
    await page.locator(".product-calculation").first().textContent(),
    /в день проверки/,
  );
  await page.locator(".product-expiry").first().fill(expiryDate);
  await page.locator("#add-product").click();
  await page.locator(".product-name").nth(1).fill("Хлеб");
  await page.locator(".product-unknown").nth(1).check();
  await page.locator(".product-photo").nth(1).selectOption("0");
  assert.match(
    await page.locator(".product-calculation").nth(1).textContent(),
    /уточнения/,
  );
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  const draftPhoto = await page
    .locator(".photo-preview img")
    .getAttribute("src");
  // Another tab can remove the shared draft's photo. Editing this open form
  // must store the still-selected image again, without trusting an old cache.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("vsg-report-drafts", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("photos", "readwrite");
          tx.objectStore("photos").clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page
    .locator("#report-description")
    .fill("На упаковке срок истёк на два дня. Дополнено перед перезагрузкой.");
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelectorAll(".photo-preview").length === 1,
  );
  assert.equal(await page.locator("#store-name").inputValue(), "Общий магазин");
  assert.equal(await page.locator("#store-select").inputValue(), "new");
  assert.equal(
    await page.locator(".product-name").first().inputValue(),
    "Йогурт <Danone>",
  );
  assert.equal(await page.locator(".product-photo").first().inputValue(), "0");
  assert.equal(await page.locator(".product-unknown").nth(1).isChecked(), true);
  await page.locator("input[name=result][value=clean]").check();
  await page.locator("#submit-report").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#form-error")
      .textContent.includes("просроченный товар"),
  );
  await page.locator("input[name=result][value=violation]").check();
  assert.equal(
    await page.locator(".photo-preview img").getAttribute("src"),
    draftPhoto,
  );
  assert.match(
    await page.locator("#location-value").textContent(),
    /51.140000/,
  );
  await context.setOffline(true);
  await page
    .locator("#report-description")
    .fill("На упаковке срок истёк на два дня. Сохранено без интернета.");
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  await context.setOffline(false);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    document
      .querySelector("#report-description")
      .value.includes("без интернета"),
  );
  await page.locator("#submit-report").click();
  await page.waitForFunction(() =>
    document.querySelector("#form-error").textContent.includes("повторить"),
  );
  assert.equal(await page.locator(".photo-preview").count(), 1);
  assert.equal(await page.locator(".store-card").count(), 1);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelectorAll(".photo-preview").length === 1,
  );
  await page.locator("#submit-report").click();
  await page.locator("#form-success").waitFor({ state: "visible" });
  assert.equal(submitted.length, 2);
  assert.equal(submitted[0], submitted[1]);
  assert.equal(uploaded, 2);
  assert.equal(uploadedPaths.size, 1);
  assert.deepEqual(
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("vsg-report-drafts", 1);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction(["drafts", "photos"]),
              counts = {};
            for (const name of ["drafts", "photos"]) {
              const count = tx.objectStore(name).count();
              count.onsuccess = () => (counts[name] = count.result);
            }
            tx.oncomplete = () => {
              db.close();
              resolve(counts);
            };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        }),
    ),
    { drafts: 0, photos: 0 },
  );
  assert.equal(await page.locator(".store-card").count(), 1);
  assert.equal(await page.locator("[data-real-marker]").count(), 1);
  assert.equal(reports.at(-1).latitude, 51.14);
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
  assert.equal(
    await page.locator('[data-admin-count="reports_pending"]').textContent(),
    "2",
  );
  assert.equal(
    await page.locator('[data-admin-count="members_pending"]').textContent(),
    "1",
  );
  const seedPending = reports.find(
    (r) => r.description === "СЕКРЕТНЫЙ ЧЕРНОВОЙ ОТЧЁТ",
  ).id;
  const seedCard = page.locator('[data-admin-report="' + seedPending + '"]');
  const rejectionReason =
    "Фото срока годности не читается. Нужен крупный план.";
  await seedCard.locator(".rejection-editor summary").click();
  await seedCard.locator('[data-review="rejected"]').click();
  assert.match(
    await seedCard.locator(".field-error").textContent(),
    /Выберите причину/,
  );
  await seedCard.locator("[data-rejection-preset]").selectOption("custom");
  await seedCard.locator("[data-rejection-note]").fill(rejectionReason);
  // Changing language must preserve the open editor, its selected reason, and
  // the original report contents while translating administrative actions.
  await page.evaluate(() => VSGI18n.setLanguage("kk"));
  assert.match(
    await page.locator("#account-title").textContent(),
    /Әкімші кабинеті/,
  );
  assert.match(
    await seedCard.locator('[data-review="approved"]').textContent(),
    /Есепті жариялау/,
  );
  assert.equal(
    await seedCard.locator("[data-rejection-note]").inputValue(),
    rejectionReason,
  );
  assert.equal(
    await seedCard.locator("[data-rejection-preset]").inputValue(),
    "custom",
  );
  assert.equal(
    await seedCard.locator(".rejection-editor").getAttribute("open"),
    "",
  );
  assert.match(
    await seedCard.locator(".account-report-description").textContent(),
    /СЕКРЕТНЫЙ ЧЕРНОВОЙ ОТЧЁТ/,
  );
  await page.locator('[data-admin-filter="all"]').click();
  await page.waitForFunction(
    () => !document.querySelector("#admin-results").inert,
  );
  assert.match(await page.locator("#admin-live").textContent(), /Табылған/);
  await page.evaluate(() => VSGI18n.setLanguage("ru"));
  await page.locator('[data-admin-filter="all"]').click();
  await page.locator('[data-admin-filter="pending"]').click();
  await seedCard.locator(".rejection-editor summary").click();
  assert.equal(
    await seedCard.locator("[data-rejection-note]").inputValue(),
    rejectionReason,
  );
  moderationFailure = true;
  await seedCard.locator('[data-review="rejected"]').click();
  await page.waitForFunction(
    () => !!document.querySelector("#account-error").textContent,
  );
  assert.equal(
    await seedCard.locator("[data-rejection-note]").inputValue(),
    rejectionReason,
  );
  moderationFailure = false;
  await seedCard.locator('[data-review="rejected"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-admin-count="reports_pending"]')
        .textContent === "1",
  );
  await approval.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".store-card").length === 2,
  );
  assert.equal(await page.locator("[data-real-marker]").count(), 2);
  await page.locator('[data-admin-filter="approved"]').click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#admin-results .account-report").length === 20,
  );
  await page.locator("#admin-next").click();
  await page.waitForFunction(
    () => document.querySelector("#admin-page").textContent === "21–24 из 24",
  );
  await page.locator("#admin-prev").click();
  await page.waitForFunction(
    () => document.querySelector("#admin-page").textContent === "1–20 из 24",
  );
  await page.locator("#admin-search").fill("%");
  await page.locator(".admin-empty").waitFor();
  assert.match(await page.locator("#admin-live").textContent(), /найдено: 0/);
  await page.locator("#admin-search").fill("Общий магазин");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#admin-results .account-report").length === 1,
  );
  adminFailure = true;
  await page.locator("#account-refresh").click();
  await page.waitForFunction(() =>
    document.querySelector("#admin-live").textContent.includes("Не удалось"),
  );
  assert.equal(
    await page.locator("#admin-search").inputValue(),
    "Общий магазин",
  );
  adminFailure = false;
  await page.locator("#account-refresh").click();
  await page.waitForFunction(() =>
    document.querySelector("#admin-live").textContent.includes("найдено: 1"),
  );
  for (const width of [320, 375, 390, 640, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page
        .locator("#account-dialog")
        .evaluate((d) => d.scrollWidth <= d.clientWidth),
      true,
      "admin width " + width,
    );
  }
  const extraPending = {
    ...reports[0],
    id: crypto.randomUUID(),
    moderation_state: "pending",
  };
  reports.push(extraPending);
  await page.evaluate(() => window.VSGAdmin.refreshCounters());
  assert.equal(
    await page.locator('[data-admin-count="reports_pending"]').textContent(),
    "1",
  );
  assert.equal(
    await page.locator("#admin-search").inputValue(),
    "Общий магазин",
  );
  reports.splice(
    reports.findIndex((r) => r.id === extraPending.id),
    1,
  );
  await page.evaluate(() => window.VSGAdmin.refreshCounters());
  adminMissing = true;
  await page.locator("#account-refresh").click();
  await page.locator(".admin-setup-note").waitFor();
  adminMissing = false;
  await page.locator("#account-refresh").click();
  await page.waitForFunction(() =>
    document.querySelector("#admin-live")?.textContent.includes("найдено: 1"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator("#account-dialog")
      .evaluate((d) => d.scrollWidth <= d.clientWidth),
    true,
  );
  await page
    .locator("#account-dialog")
    .screenshot({ path: "/tmp/vsg-admin-reports-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.locator('[data-report-location="' + submitted[1] + '"]').click();
  await page.locator("#location-map").click({ position: { x: 180, y: 180 } });
  await page.locator("#save-location").click();
  await page.locator("#location-dialog").waitFor({ state: "hidden" });
  assert.notEqual(reports.at(-1).latitude, 51.14);
  assert.equal(await page.locator("[data-real-marker]").count(), 2);
  await page.locator("#close-account").click();
  await page
    .locator(".store-card")
    .filter({ hasText: "Общий магазин" })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-entry").length === 1,
  );
  assert.match(
    await page.locator(".detail-body > .reported-products").textContent(),
    /Йогурт <Danone>/,
  );
  assert.match(
    await page.locator(".detail-body > .reported-products").textContent(),
    /4 уп/,
  );
  assert.match(
    await page.locator(".detail-body > .reported-products").textContent(),
    /на 3 дн/,
  );
  assert.equal(await page.locator("Danone").count(), 0);
  await page
    .locator(".detail-body > .reported-products .product-evidence")
    .first()
    .click();
  await page.locator("#lightbox-image").evaluate((img) => img.decode());
  await page.keyboard.press("Escape");
  await page.locator(".history-entry summary").click();
  await page.locator(".history-entry .product-evidence").first().click();
  await page.locator("#lightbox-image").evaluate((img) => img.decode());
  await page.keyboard.press("Escape");
  await page.locator("#close-detail").click();
  await page.locator("#account-button").click();
  assert.match(await page.locator("#stat-stores").textContent(), /^2/);
  assert.match(await page.locator("#stat-issues").textContent(), /^1/);
  await page.locator('[data-admin-tab="members"]').click();
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
  await page.locator("#store-select").selectOption("new");
  await page.locator("#choose-location").click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page
        .locator("#location-dialog")
        .evaluate((d) => d.scrollWidth <= d.clientWidth),
      true,
      "picker width " + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("#location-dialog")
    .screenshot({ path: "/tmp/vsg-real-map-picker-mobile.png" });
  searchFail = true;
  await page.locator("#location-search").fill("Неизвестный адрес");
  await page.locator("#location-search-button").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#location-search-status")
      .textContent.includes("недоступен"),
  );
  await page.locator("#location-map").click({ position: { x: 100, y: 100 } });
  assert.equal(await page.locator("#save-location").isDisabled(), false);
  await page.keyboard.press("Escape");
  searchFail = false;
  // Drafts are isolated by account and survive leaving/rejoining that account.
  await page.locator("#store-select").selectOption("new");
  await page.locator("#store-name").fill("Черновик участника");
  await page.locator("#store-address").fill("Достык, 10");
  await page
    .locator("#report-description")
    .fill("Личный черновик участника, не показывать другому аккаунту.");
  await page.locator("#photo-input").setInputFiles(root + "/assets/milk.png");
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  await page.locator(".remove-photo").click();
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".photo-preview").count(), 0);
  assert.equal(
    await page.locator("#store-name").inputValue(),
    "Черновик участника",
  );
  await page.locator("#photo-input").setInputFiles(root + "/assets/milk.png");
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  await page.locator("#account-button").click();
  await page.locator("#sign-out").click();
  await page.locator("#auth-email").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("#report-description").value === "" &&
      document.querySelectorAll(".photo-preview").length === 0,
  );
  await login("admin@test.kz");
  assert.equal(await page.locator("#report-description").inputValue(), "");
  assert.equal(await page.locator(".photo-preview").count(), 0);
  await page.locator("#close-account").click();
  await page.locator("#store-select").selectOption(S);
  await page
    .locator("#report-description")
    .fill("Отдельный черновик администратора.");
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("сохранён"),
  );
  await page.locator("#account-button").click();
  await page.locator("#sign-out").click();
  await page.locator("#auth-email").waitFor();
  await login("pending@test.kz");
  await page.locator("#close-account").click();
  assert.equal(
    await page.locator("#store-name").inputValue(),
    "Черновик участника",
  );
  assert.equal(await page.locator(".photo-preview").count(), 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#discard-draft").click();
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("удалён"),
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#report-description").inputValue(), "");
  assert.equal(await page.locator(".photo-preview").count(), 0);
  await page.locator("#account-button").click();
  await page.locator("#sign-out").click();
  await page.locator("#auth-email").waitFor();
  await login("admin@test.kz");
  await page.locator("#close-account").click();
  assert.equal(await page.locator("#store-select").inputValue(), S);
  assert.equal(
    await page.locator("#report-description").inputValue(),
    "Отдельный черновик администратора.",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#discard-draft").click();
  await page.waitForFunction(() =>
    document.querySelector("#draft-status").textContent.includes("удалён"),
  );
  historyFailure = true;
  await page
    .locator(".store-card")
    .filter({ hasText: "Настоящий магазин" })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#history-status")
      .textContent.includes("Не удалось"),
  );
  historyFailure = false;
  await page.locator("#history-retry").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-entry").length === 20,
  );
  await page.locator("#close-detail").click();
  historyMissing = true;
  await page
    .locator(".store-card")
    .filter({ hasText: "Общий магазин" })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#history-status")
      .textContent.includes("history.sql"),
  );
  historyMissing = false;
  await page.locator("#history-retry").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".history-entry").length === 1,
  );
  await page.locator("#close-detail").click();
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
  await page.waitForFunction(() => !document.querySelector(".account-loading"));
  assert.match(
    await page.locator("#account-data").textContent(),
    new RegExp(rejectionReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  await page.locator("#close-account").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator("#map-view")
    .screenshot({ path: "/tmp/vsg-real-map-desktop.png" });
  // A published report without coordinates stays in the list; never invent a pin.
  reports[0].latitude = null;
  reports[0].longitude = null;
  await page.locator("#refresh-cloud").click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-real-marker]").length === 1,
  );
  assert.match(
    await page.locator("#map-location-notice").textContent(),
    /Без места на карте: 1/,
  );
  assert.equal(await page.locator(".store-card").count(), 2);
  tilesFail = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#map-tile-notice").waitFor({ state: "visible" });
  assert.equal(await page.locator(".store-card").count(), 2);
  assert.equal(await page.locator("[data-real-marker]").count(), 1);
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...args) {
      if (name === "vsg-report-drafts")
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      return open.call(this, name, ...args);
    };
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#store-select").selectOption("new");
  await page
    .locator("#report-description")
    .fill("Этот черновик нельзя сохранить, потому что хранилище недоступно.");
  await page.waitForFunction(() =>
    document.querySelector("#draft-panel").classList.contains("has-error"),
  );
  assert.equal(await page.locator("#submit-report").isDisabled(), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    await page.evaluate(() => [...VSGI18n.missing]),
    [],
    "Missing cloud interface translations",
  );
  console.log(
    "PASS: actual Supabase SDK against fixture HTTP API; public approved data; signed private photos; auth/signup/reset/error; account roles; upload and retry with stable ID/no duplicate upload; pending report stays private; draft form/photos/location survive reload/offline; stable submission ID after reload; sent/deleted drafts removed; account draft isolation; storage error feedback; published history pagination/photos/privacy/retry; real OSM map/attribution; address search/escaping/bounds; coordinate picker; saved coordinates; admin location correction; admin approval updates public map; admin exact counters/filter/search/pagination; rejection reason validation/persistence/author feedback; membership approval; gallery; stale-data error; 320–1440 responsive layout.",
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
