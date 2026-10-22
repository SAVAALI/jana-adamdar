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
    "PASS: repeatable schema; pending signup; admin bootstrap; role boundaries; private pending reports/photos; approved-only public view/stats/photos; no personal fields; no direct mutation/escalation; immutable attached photos; orphan cleanup; atomic rejection; idempotent submission.",
  );
  await db.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
