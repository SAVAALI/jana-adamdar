"use strict";

// All authorization and moderation rules also run on the server (setup.sql).
window.VSGBackend = class VSGBackend {
  constructor(config) {
    if (!window.supabase?.createClient)
      throw new Error("Не удалось загрузить подключение. Обновите страницу.");
    this.config = config;
    this.attempt = null;
    this.client = window.supabase.createClient(
      config.url,
      config.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        global: {
          fetch: async (url, options = {}) => {
            const controller = new AbortController();
            const abort = () => controller.abort();
            if (options.signal?.aborted) controller.abort();
            options.signal?.addEventListener("abort", abort, { once: true });
            const timer = setTimeout(abort, 60000);
            try {
              return await fetch(url, {
                ...options,
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timer);
              options.signal?.removeEventListener("abort", abort);
            }
          },
        },
      },
    );
  }

  check(response) {
    if (response.error) throw response.error;
    return response.data;
  }

  async session() {
    return this.check(await this.client.auth.getSession()).session;
  }

  async profile() {
    const session = await this.session();
    if (!session) return null;
    return this.check(
      await this.client
        .from("vsg_members")
        .select("user_id,display_name,email,role")
        .eq("user_id", session.user.id)
        .maybeSingle(),
    );
  }

  watchAuth(callback) {
    // Do not make Auth calls inside the SDK callback's internal session lock.
    return this.client.auth.onAuthStateChange((event, session) => {
      setTimeout(() => callback(event, session), 0);
    }).data.subscription;
  }

  async signIn(email, password) {
    return this.check(
      await this.client.auth.signInWithPassword({ email, password }),
    );
  }
  async signUp(email, password, displayName) {
    return this.check(
      await this.client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: this.config.siteUrl,
          data: { display_name: displayName },
        },
      }),
    );
  }
  async resetPassword(email) {
    return this.check(
      await this.client.auth.resetPasswordForEmail(email, {
        redirectTo: this.config.siteUrl,
      }),
    );
  }
  async updatePassword(password) {
    return this.check(await this.client.auth.updateUser({ password }));
  }
  async signOut() {
    this.check(await this.client.auth.signOut());
    this.attempt = null;
  }

  async allRows(table, columns, order) {
    const records = [];
    for (let page = 0; ; page++) {
      let query = this.client
        .from(table)
        .select(columns)
        .order(order, { ascending: false });
      if (order !== "id") query = query.order("id", { ascending: true });
      const rows = this.check(await query.range(page * 200, page * 200 + 199));
      records.push(...rows);
      if (rows.length < 200) return records;
      if (page >= 499)
        throw new Error(
          "Слишком много записей для карты. Обратитесь к администратору.",
        );
    }
  }

  async hydrate(rows, isPublic = false) {
    const paths = [
      ...new Set(
        rows.flatMap((row) =>
          (row.photos || []).map((photo) => photo.path || photo.storage_path),
        ),
      ),
    ];
    const signed = new Map();
    for (let offset = 0; offset < paths.length; offset += 100) {
      const batch = this.check(
        await this.client.storage
          .from(this.config.bucket)
          .createSignedUrls(paths.slice(offset, offset + 100), 3600),
      );
      for (const photo of batch)
        if (photo.signedUrl && !photo.error)
          signed.set(photo.path, photo.signedUrl);
    }
    return rows.map((row, index) => ({
      id: row.store_id,
      reportId: row.id,
      name: isPublic ? row.store_name : row.store?.name || "Магазин",
      address: isPublic ? row.address : row.store?.address || "",
      city: isPublic ? row.city : row.store?.city || "Астана",
      x: 24 + ((index * 17) % 54),
      y: 44 + ((index * 13) % 39),
      latitude: typeof row.latitude === "number" ? row.latitude : null,
      longitude: typeof row.longitude === "number" ? row.longitude : null,
      status: row.result,
      date: row.occurred_at,
      description: row.description,
      photos: [...(row.photos || [])]
        .sort((a, b) => (a.order ?? a.sort_order) - (b.order ?? b.sort_order))
        .map((photo) => signed.get(photo.path || photo.storage_path))
        .filter(Boolean),
      demo: false,
      moderationState: row.moderation_state || "approved",
      moderationNote: row.moderation_note || "",
      authorId: row.author_id,
    }));
  }

  async publicData() {
    const [rows, stats] = await Promise.all([
      this.allRows("vsg_public_reports", "*", "occurred_at"),
      this.client
        .from("vsg_public_stats")
        .select("*")
        .single()
        .then((response) => this.check(response)),
    ]);
    return { stores: await this.hydrate(rows, true), stats };
  }

  async catalog() {
    return this.allRows("vsg_stores", "id,name,address,city", "id");
  }

  async reports(pending = false) {
    let query = this.client
      .from("vsg_reports")
      .select(
        "*,store:vsg_stores(name,address,city),photos:vsg_report_photos(storage_path,filename,sort_order)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (pending === true) query = query.eq("moderation_state", "pending");
    else if (pending !== "all") {
      const session = await this.session();
      if (!session) return [];
      query = query.eq("author_id", session.user.id);
    }
    return this.hydrate(this.check(await query));
  }

  async members() {
    return this.check(
      await this.client
        .from("vsg_members")
        .select("user_id,display_name,email,role,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    );
  }
  async moderate(id, decision, note = "") {
    this.check(
      await this.client.rpc("vsg_moderate_report", {
        p_report_id: id,
        p_decision: decision,
        p_note: note,
      }),
    );
  }
  async setLocation(reportId, location) {
    this.check(
      await this.client.rpc("vsg_set_report_location", {
        p_report_id: reportId,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
      }),
    );
  }

  async setMemberRole(id, role) {
    this.check(
      await this.client.rpc("vsg_set_member_role", {
        p_user_id: id,
        p_role: role,
      }),
    );
  }

  async submit(
    { storeId, name, address, result, description, photos, location },
    progress,
  ) {
    const session = await this.session();
    if (!session) throw new Error("Войдите в аккаунт, чтобы отправить отчёт.");
    const signature = JSON.stringify([
      session.user.id,
      storeId,
      name,
      address,
      result,
      description,
      location,
      photos.map((photo) => photo.id),
    ]);
    if (this.attempt?.signature !== signature)
      this.attempt = {
        id: crypto.randomUUID(),
        signature,
        uploaded: new Set(),
      };
    const attempt = this.attempt;
    const attachments = [];
    for (const [index, photo] of photos.entries()) {
      progress(`Загружаем фото ${index + 1} из ${photos.length}…`);
      const blob = await (await fetch(photo.url)).blob();
      const extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      }[blob.type];
      if (!extension) throw new Error("Нужны фотографии JPG, PNG или WEBP.");
      const path = `${session.user.id}/${attempt.id}/${photo.id}.${extension}`;
      if (!attempt.uploaded.has(path)) {
        const response = await this.client.storage
          .from(this.config.bucket)
          .upload(path, blob, {
            contentType: blob.type,
            upsert: false,
            cacheControl: "3600",
          });
        if (
          response.error &&
          String(response.error.statusCode) !== "409" &&
          response.error.error !== "Duplicate"
        )
          throw response.error;
        attempt.uploaded.add(path);
      }
      attachments.push({
        path,
        filename: photo.name.slice(0, 150) || `Фото ${index + 1}`,
      });
    }
    progress("Отправляем на проверку…");
    const response = await this.client.rpc(
      location ? "vsg_submit_located_report" : "vsg_submit_report",
      {
        ...(location
          ? { p_latitude: location.latitude, p_longitude: location.longitude }
          : {}),
        p_report_id: attempt.id,
        p_store_id: storeId || null,
        p_store_name: name || null,
        p_store_address: address || null,
        p_result: result,
        p_description: description,
        p_photos: attachments,
      },
    );
    if (response.error) {
      // A lost response may follow a successful transaction. Confirm before retrying.
      const saved = await this.client
        .from("vsg_reports")
        .select("id")
        .eq("id", attempt.id)
        .maybeSingle();
      if (!saved.data?.id) throw response.error;
    }
    this.attempt = null;
    return attempt.id;
  }
};
