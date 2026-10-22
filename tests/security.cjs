const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const nodePath = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,storage to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace($1,'/[^/]+$',''),'/') $$;
    grant execute on function storage.foldername(text) to anon,authenticated;`);
  const setup = fs.readFileSync(
    nodePath.join(__dirname, "../supabase/setup.sql"),
    "utf8",
  );
  await db.exec(setup);
  await db.exec(setup);
  const historyMigration = fs.readFileSync(
    nodePath.join(__dirname, "../supabase/history.sql"),
    "utf8",
  );
  await db.exec(historyMigration);
  await db.exec(historyMigration);
  const A = "11111111-1111-4111-8111-111111111111",
    B = "22222222-2222-4222-8222-222222222222",
    ADMIN = "33333333-3333-4333-8333-333333333333",
    PENDING = "44444444-4444-4444-8444-444444444444";
  for (const [id, email] of [
    [A, "a@test.kz"],
    [B, "b@test.kz"],
    [ADMIN, "owner@test.kz"],
    [PENDING, "pending@test.kz"],
  ])
    await db.query(
      `insert into auth.users values($1,$2,'{"display_name":"Участник","role":"admin"}',now())`,
      [id, email],
    );
  assert.equal(
    (
      await db.query("select role from public.vsg_members where user_id=$1", [
        PENDING,
      ])
    ).rows[0].role,
    "pending",
  );
  await db.exec(
    fs
      .readFileSync(
        nodePath.join(__dirname, "../supabase/make-admin.sql"),
        "utf8",
      )
      .replace("ВАША_ПОЧТА", "owner@test.kz"),
  );
  await db.query(
    "update public.vsg_members set role='member' where user_id=any($1::uuid[])",
    [[A, B]],
  );
  async function run(user, sql, params = []) {
    await db.exec(`begin; set local role ${user ? "authenticated" : "anon"};`);
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user || "",
      ]);
      const result = await db.query(sql, params);
      await db.exec("commit");
      return result;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  async function denied(user, sql, params = []) {
    await assert.rejects(() => run(user, sql, params));
  }
  await denied(null, "select * from public.vsg_members");
  const visibleMembers = (await run(A, "select * from public.vsg_members"))
    .rows;
  assert.equal(visibleMembers.length, 1);
  assert.equal(visibleMembers[0].user_id, A);
  assert.equal(
    (await run(null, "select * from public.vsg_public_reports")).rows.length,
    0,
  );
  assert.equal(
    (await run(null, "select * from public.vsg_public_stats")).rows[0].members,
    3,
  );
  await denied(
    A,
    "update public.vsg_members set role='admin' where user_id=$1",
    [A],
  );
  await denied(A, "select public.vsg_set_member_role($1,'member')", [PENDING]);
  await run(ADMIN, "select public.vsg_set_member_role($1,'member')", [PENDING]);
  await run(ADMIN, "select public.vsg_set_member_role($1,'blocked')", [
    PENDING,
  ]);
  const productMigration = fs.readFileSync(
    nodePath.join(__dirname, "../supabase/products.sql"),
    "utf8",
  );
  await db.exec(productMigration);
  await db.exec(productMigration);
  const productId = "ffffffff-ffff-4fff-8fff-ffffffffffff",
    productFile = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const productPath = `${A}/${productId}/${productFile}.png`;
  await run(
    A,
    "insert into storage.objects(bucket_id,name) values('vsg-report-photos',$1)",
    [productPath],
  );
  const date = (
    await db.query(
      "select to_char((now() at time zone 'Asia/Almaty')::date,'YYYY-MM-DD') d",
    )
  ).rows[0].d;
  const expiry = (
    await db.query(
      "select to_char((now() at time zone 'Asia/Almaty')::date-3,'YYYY-MM-DD') d",
    )
  ).rows[0].d;
  const goods = [
    { name: "Йогурт", quantity: 4, expiry, photo_index: 0, expired_days: 999 },
    { name: "Нечитаемая дата", quantity: 2, expiry: null, photo_index: 0 },
  ];
  const productParams = [
    productId,
    null,
    "Товарная проверка",
    "Достык, 8",
    "violation",
    "Фотографии маркировки приложены.",
    JSON.stringify([{ path: productPath, filename: "маркировка.png" }]),
    date,
    JSON.stringify(goods),
    51.14,
    71.43,
  ];
  const productSubmit =
    "select public.vsg_submit_product_report($1,$2,$3,$4,$5,$6,$7::jsonb,$8::date,$9::jsonb,$10,$11)";
  await denied(null, productSubmit, productParams);
  await denied(PENDING, productSubmit, productParams);
  for (const invalid of [
    { ...goods[0], quantity: 1.5 },
    { ...goods[0], quantity: 0 },
    { ...goods[0], photo_index: 5 },
    { ...goods[0], expiry: "2026-02-30" },
  ])
    await denied(A, productSubmit, [
      ...productParams.slice(0, 8),
      JSON.stringify([invalid]),
      51.14,
      71.43,
    ]);
  await denied(A, productSubmit, [
    ...productParams.slice(0, 7),
    "2200-01-01",
    ...productParams.slice(8),
  ]);
  const cleanParams = [...productParams];
  cleanParams[4] = "clean";
  await denied(A, productSubmit, cleanParams);
  const sameDay = [...cleanParams];
  sameDay[8] = JSON.stringify([{ ...goods[0], expiry: date }]);
  await run(A, productSubmit, sameDay);
  assert.equal(
    (
      await run(A, "select products from public.vsg_reports where id=$1", [
        productId,
      ])
    ).rows[0].products[0].expired_days,
    0,
  );
  await db.query("delete from public.vsg_report_photos where report_id=$1", [
    productId,
  ]);
  await db.query("delete from public.vsg_reports where id=$1", [productId]);
  await db.query(
    "delete from public.vsg_stores where name='Товарная проверка'",
  );
  await run(A, productSubmit, productParams);
  await run(A, productSubmit, productParams);
  let productReport = (
    await run(A, "select * from public.vsg_reports where id=$1", [productId])
  ).rows[0];
  assert.equal(productReport.products[0].expired_days, 3);
  assert.equal(productReport.products[1].expired_days, null);
  assert.equal(
    (
      await run(null, "select * from public.vsg_public_history where id=$1", [
        productId,
      ])
    ).rows.length,
    0,
  );
  await run(ADMIN, "select public.vsg_moderate_report($1,'approved','')", [
    productId,
  ]);
  productReport = (
    await run(null, "select * from public.vsg_public_history where id=$1", [
      productId,
    ])
  ).rows[0];
  assert.equal(productReport.products[0].quantity, 4);
  assert.equal(productReport.products[0].expired_days, 3);
  await db.query("delete from public.vsg_report_photos where report_id=$1", [
    productId,
  ]);
  await db.query("delete from public.vsg_reports where id=$1", [productId]);
  await db.query(
    "delete from public.vsg_stores where name='Товарная проверка'",
  );
  await db.query("delete from storage.objects where name=$1", [productPath]);
  const R = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    F = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const path = `${A}/${R}/${F}.png`;
  await denied(
    B,
    "insert into storage.objects(bucket_id,name) values('vsg-report-photos',$1)",
    [path],
  );
  await denied(
    PENDING,
    "insert into storage.objects(bucket_id,name) values('vsg-report-photos',$1)",
    [`${PENDING}/${R}/${F}.png`],
  );
  await run(
    A,
    "insert into storage.objects(bucket_id,name) values('vsg-report-photos',$1)",
    [path],
  );
  const params = [
    R,
    null,
    "Лавка",
    "Проспект Туран, 1",
    "violation",
    "Проверка срока годности товара.",
    JSON.stringify([{ path, filename: "товар.png" }]),
  ];
  const submit = "select public.vsg_submit_report($1,$2,$3,$4,$5,$6,$7::jsonb)";
  await denied(PENDING, submit, params);
  await run(A, submit, params);
  await run(A, submit, params);
  const mapMigration = fs.readFileSync(
    nodePath.join(__dirname, "../supabase/real-map.sql"),
    "utf8",
  );
  await db.exec(mapMigration);
  await db.exec(mapMigration);
  const locate = "select public.vsg_set_report_location($1,$2,$3)";
  await denied(null, locate, [R, 51.14, 71.43]);
  await denied(A, locate, [R, 51.14, 71.43]);
  await denied(ADMIN, locate, [R, 43.25, 76.9]);
  await denied(ADMIN, locate, [R, null, 71.43]);
  await denied(ADMIN, locate, [R, "NaN", 71.43]);
  await run(ADMIN, locate, [R, 51.14, 71.43]);
  // A retry of the new RPC cannot relocate an existing report.
  const locatedSubmit =
    "select public.vsg_submit_located_report($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)";
  await run(A, locatedSubmit, [...params, 51.2, 71.5]);
  assert.equal(
    (await run(A, "select latitude from public.vsg_reports where id=$1", [R]))
      .rows[0].latitude,
    51.14,
  );
  await denied(PENDING, locatedSubmit, [...params, 51.2, 71.5]);
  const R2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const path2 = `${A}/${R2}/${F}.png`;
  await run(
    A,
    "insert into storage.objects(bucket_id,name) values('vsg-report-photos',$1)",
    [path2],
  );
  const locatedParams = [
    R2,
    null,
    "Точная точка",
    "Достык, 5",
    "clean",
    "Сроки проверены, всё хорошо.",
    JSON.stringify([{ path: path2, filename: "товар.png" }]),
    51.15,
    71.44,
  ];
  await denied(A, locatedSubmit, [...locatedParams.slice(0, 7), 43.25, 76.9]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.vsg_reports where id=$1",
        [R2],
      )
    ).rows[0].n,
    0,
  );
  await run(A, locatedSubmit, locatedParams);
  assert.equal(
    (await run(A, "select longitude from public.vsg_reports where id=$1", [R2]))
      .rows[0].longitude,
    71.44,
  );
  assert.equal(
    (await run(null, "select * from public.vsg_public_reports")).rows.length,
    0,
  );
  // Remove only this test fixture; continue the original one-report scenarios below.
  await db.query("delete from public.vsg_report_photos where report_id=$1", [
    R2,
  ]);
  await db.query("delete from public.vsg_reports where id=$1", [R2]);
  await db.query("delete from public.vsg_stores where name='Точная точка'");
  await db.query("delete from storage.objects where name=$1", [path2]);
  assert.equal(
    (await db.query("select count(*)::int n from public.vsg_reports")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await run(null, "select * from public.vsg_public_reports")).rows.length,
    0,
  );
  assert.equal(
    (await run(B, "select * from public.vsg_reports")).rows.length,
    0,
  );
  assert.equal(
    (await run(A, "select * from public.vsg_reports")).rows.length,
    1,
  );
  assert.equal(
    (await run(null, "select * from storage.objects")).rows.length,
    0,
  );
  assert.equal((await run(B, "select * from storage.objects")).rows.length, 0);
  assert.equal((await run(A, "select * from storage.objects")).rows.length, 1);
  await denied(A, "select public.vsg_moderate_report($1,'approved','')", [R]);
  await denied(
    A,
    "update public.vsg_reports set moderation_state='approved' where id=$1",
    [R],
  );
  await run(
    ADMIN,
    "select public.vsg_moderate_report($1,'approved','Внутренняя заметка')",
    [R],
  );
  const published = (await run(null, "select * from public.vsg_public_reports"))
    .rows;
  assert.equal(published.length, 1);
  assert.equal(published[0].latitude, 51.14);
  assert.equal(published[0].longitude, 71.43);
  const storeId = published[0].store_id;
  const historyIds = [
    "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ];
  for (let index = 0; index < historyIds.length; index++) {
    await db.query(
      "insert into public.vsg_reports(id,store_id,author_id,result,description,occurred_at,moderation_state,moderation_note) values($1,$2,$3,'clean',$4,now()-interval '1 day',$5,'Личная заметка администратора')",
      [
        historyIds[index],
        storeId,
        B,
        `История проверки номер ${index}`,
        ["approved", "pending", "rejected"][index],
      ],
    );
  }
  for (const viewer of [null, A, B, ADMIN]) {
    const history = (
      await run(
        viewer,
        "select * from public.vsg_public_history where store_id=$1 order by occurred_at desc,id desc",
        [storeId],
      )
    ).rows;
    assert.deepEqual(
      history.map((row) => row.id),
      [R, historyIds[0]],
    );
    assert.equal(
      (
        await run(
          viewer,
          "select * from public.vsg_public_reports where store_id=$1",
          [storeId],
        )
      ).rows[0].id,
      R,
    );
    for (const entry of history)
      for (const privateField of [
        "author_id",
        "email",
        "moderation_note",
        "moderated_by",
      ])
        assert.ok(!(privateField in entry));
  }
  for (const row of (await run(null, "select * from public.vsg_public_history"))
    .rows)
    for (const photo of row.photos) assert.ok(!("filename" in photo));
  await denied(
    null,
    "delete from public.vsg_public_history where store_id=$1",
    [storeId],
  );
  await denied(
    A,
    "update public.vsg_public_history set description='Изменено' where id=$1",
    [R],
  );
  await run(
    ADMIN,
    "select public.vsg_moderate_report($1,'rejected','Снято с публикации')",
    [historyIds[0]],
  );
  assert.equal(
    (
      await run(
        null,
        "select * from public.vsg_public_history where store_id=$1",
        [storeId],
      )
    ).rows.length,
    1,
  );
  await db.query("delete from public.vsg_reports where id=any($1::uuid[])", [
    historyIds,
  ]);
  assert.ok(!("author_id" in published[0]));
  assert.ok(!("moderation_note" in published[0]));
  assert.ok(!("email" in published[0]));
  assert.ok(!("filename" in published[0].photos[0]));
  assert.equal(
    (await run(null, "select * from storage.objects")).rows.length,
    1,
  );
  assert.equal(
    (await run(null, "select * from public.vsg_public_stats")).rows[0]
      .violations,
    1,
  );
  assert.equal(
    (
      await run(A, "delete from storage.objects where name=$1 returning id", [
        path,
      ])
    ).rows.length,
    0,
  );
  await run(
    ADMIN,
    "select public.vsg_moderate_report($1,'rejected','Нужны даты на фото')",
    [R],
  );
  assert.equal(
    (await run(null, "select * from public.vsg_public_history")).rows.length,
    0,
  );
  assert.equal(
    (await run(null, "select * from public.vsg_public_reports")).rows.length,
    0,
  );
  assert.equal(
    (await run(null, "select * from storage.objects")).rows.length,
    0,
  );
  assert.equal((await run(A, "select * from storage.objects")).rows.length, 1);
  const orphan = `${A}/${R}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
  await run(
    A,
    "insert into storage.objects(bucket_id,name) values('vsg-report-photos',$1)",
    [orphan],
  );
  assert.equal(
    (
      await run(A, "delete from storage.objects where name=$1 returning id", [
        orphan,
      ])
    ).rows.length,
    1,
  );
  const invalid = [...params];
  invalid[0] = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  invalid[2] = "Не должна появиться";
  await denied(A, submit, invalid);
  assert.equal(
    (await db.query("select count(*)::int n from public.vsg_stores")).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select public from storage.buckets where id='vsg-report-photos'",
      )
    ).rows[0].public,
    false,
  );
  console.log(
    "PASS: repeatable schema/map migration; pending signup; admin bootstrap; role boundaries; private pending reports/photos/coordinates; approved-only public view/stats/photos/coordinates; full approved history without private fields; history unpublication; history read-only; admin-only location correction; coordinate bounds; atomic located submission; no personal fields; no direct mutation/escalation; immutable attached photos; orphan cleanup; atomic rejection; idempotent submission.",
  );
  await db.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
