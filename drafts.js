"use strict";

window.VSGDrafts = (() => {
  const project =
    window.VSG_CONFIG?.enabled === true
      ? new URL(window.VSG_CONFIG.url).hostname
      : "demo";
  const ownerSetting = `vsg-draft-owner:${project}`;
  let databasePromise,
    owner = null,
    generation = 0,
    revision = 0;
  let loaded = false,
    dirty = false,
    restoring = false,
    timer,
    pendingRestore,
    submission = null;
  let queue = Promise.resolve(),
    fallback = null;
  const key = (user) => `${project}:${user}`;
  const photoKey = (user, id) => `${key(user)}:${id}`;

  function status(text, error = false) {
    window.VSGI18n.text($("#draft-status"), text);
    $("#draft-panel").classList.toggle("has-error", error);
    $("#discard-draft").hidden = !hasContent() && !pendingRestore;
    $("#restore-draft").hidden = !pendingRestore;
  }

  function hasContent() {
    return !!(
      $("#store-select").value ||
      $("#store-name").value.trim() ||
      $("#store-address").value.trim() ||
      $("#report-description").value.trim() ||
      window.VSGProducts?.hasContent() ||
      pendingPhotos.length ||
      window.VSGMap?.value()
    );
  }

  function openDB() {
    if (!databasePromise)
      databasePromise = new Promise((resolve, reject) => {
        let finished = false;
        const fail = () => {
          if (!finished) {
            finished = true;
            clearTimeout(timeout);
            reject(new Error("Draft storage unavailable"));
          }
        };
        const timeout = setTimeout(fail, 4000);
        try {
          const request = indexedDB.open("vsg-report-drafts", 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore("drafts");
            request.result.createObjectStore("photos");
          };
          request.onsuccess = () => {
            if (finished) {
              request.result.close();
              return;
            }
            finished = true;
            clearTimeout(timeout);
            resolve(request.result);
          };
          request.onerror = fail;
          request.onblocked = fail;
        } catch {
          fail();
        }
      });
    return databasePromise;
  }

  async function read(user) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["drafts", "photos"], "readonly");
      const request = tx.objectStore("drafts").get(key(user));
      let record = null;
      request.onsuccess = () => {
        record = request.result;
        if (!record || record.version !== 1 || !Array.isArray(record.photos)) {
          record = null;
          return;
        }
        const refs = record.photos.slice(0, 6);
        record.photos = new Array(refs.length);
        refs.forEach((ref, index) => {
          if (!ref || typeof ref.id !== "string") {
            record.photos[index] = null;
            return;
          }
          const photo = tx.objectStore("photos").get(photoKey(user, ref.id));
          photo.onsuccess = () => {
            record.photos[index] = photo.result;
          };
        });
      };
      tx.oncomplete = () => {
        resolve(record);
      };
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("Draft read failed"));
    });
  }

  function snapshot() {
    const storeId = $("#store-select").value;
    const store =
      (cloudMode ? cloudCatalog : stores).find((item) => item.id === storeId) ||
      fallback;
    return {
      version: 1,
      user: owner,
      revision,
      updatedAt: Date.now(),
      fields: {
        storeId,
        name: $("#store-name").value,
        address: $("#store-address").value,
        description: $("#report-description").value,
        result: $('input[name="result"]:checked')?.value || "violation",
      },
      store:
        store && storeId === store.id
          ? { id: store.id, name: store.name, address: store.address }
          : null,
      location: window.VSGMap?.value() || null,
      photos: pendingPhotos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        url: photo.url,
      })),
      productDetails: window.VSGProducts.value(),
      submission,
    };
  }

  async function write(record) {
    const db = await openDB(),
      user = record.user;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["drafts", "photos"], "readwrite");
      const photos = tx.objectStore("photos");
      const ids = new Set(record.photos.map((photo) => photo.id));
      const previous = tx.objectStore("drafts").get(key(user));
      previous.onsuccess = () => {
        for (const ref of previous.result?.photos || [])
          if (ref?.id && !ids.has(ref.id))
            photos.delete(photoKey(user, ref.id));
      };
      for (const photo of record.photos) {
        // Check keys, not image bytes: another tab may have removed a cached photo.
        const exists = photos.getKey(photoKey(user, photo.id));
        exists.onsuccess = () => {
          if (exists.result === undefined)
            photos.put(photo, photoKey(user, photo.id));
        };
      }
      tx.objectStore("drafts").put(
        { ...record, photos: record.photos.map((photo) => ({ id: photo.id })) },
        key(user),
      );
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("Draft write failed"));
    });
  }

  async function remove(user) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["drafts", "photos"], "readwrite");
      tx.objectStore("drafts").delete(key(user));
      const prefix = `${key(user)}:`;
      const cursor = tx
        .objectStore("photos")
        .openKeyCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      cursor.onsuccess = () => {
        if (cursor.result) {
          tx.objectStore("photos").delete(cursor.result.primaryKey);
          cursor.result.continue();
        }
      };
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("Draft deletion failed"));
    });
  }

  function flush() {
    clearTimeout(timer);
    if (!owner || !loaded || restoring || pendingRestore || !dirty)
      return queue;
    const record = snapshot(),
      token = generation;
    status(tr("Сохраняем черновик на этом устройстве…"));
    queue = queue
      .then(() => write(record))
      .then(() => {
        if (token === generation && record.revision === revision) {
          dirty = false;
          status(
            navigator.onLine
              ? tr("Черновик сохранён на этом устройстве")
              : tr(
                  "Нет интернета. Черновик сохранён на этом устройстве — отправите позже.",
                ),
          );
        }
        return true;
      })
      .catch(() => {
        if (token === generation)
          status(
            tr(
              "Не удалось сохранить черновик на устройстве. Не закрывайте страницу, пока не отправите отчёт.",
            ),
            true,
          );
        return false;
      });
    return queue;
  }

  function changed() {
    if (restoring) return;
    dirty = true;
    revision++;
    clearTimeout(timer);
    if (pendingRestore) {
      status(
        tr(
          "Есть сохранённый черновик. Восстановите его или удалите, чтобы сохранять новую форму.",
        ),
      );
      return;
    }
    if (!hasContent()) {
      clear({ resetForm: false });
      return;
    }
    status(tr("Сохраняем черновик…"));
    timer = setTimeout(flush, 350);
  }

  function resetForm() {
    const wasRestoring = restoring;
    restoring = true;
    $("#report-form").reset();
    window.VSGProducts.restore();
    pendingPhotos = [];
    renderPhotoPreviews();
    changeNewStoreFields();
    window.VSGI18n.text($("#character-count"), "0 / 1000");
    window.VSGI18n.text($("#form-error"), "");
    window.VSGI18n.text($("#photo-error"), "");
    $("#form-success").hidden = true;
    fallback = null;
    restoring = wasRestoring;
  }

  async function restore(record) {
    const token = generation;
    restoring = true;
    status(tr("Восстанавливаем черновик и фотографии…"));
    try {
      const photos = [];
      for (const photo of (record.photos || []).slice(0, 6)) {
        if (
          !photo ||
          !/^[0-9a-f-]{36}$/i.test(photo.id) ||
          typeof photo.url !== "string" ||
          photo.url.length > 11200000 ||
          !/^data:image\/(jpeg|png|webp);base64,/.test(photo.url)
        )
          continue;
        try {
          photos.push(
            await validatePhoto({
              id: photo.id,
              name: String(photo.name || "Фото").slice(0, 150),
              url: photo.url,
            }),
          );
        } catch {
          /* Corrupt local photos are skipped and reported below. */
        }
      }
      if (token !== generation) return;
      const fields = record.fields || {};
      if (
        fields.storeId === "new" &&
        ![...$("#store-select").options].some(
          (option) => option.value === "new",
        )
      )
        $("#store-select").add(
          window.VSGI18n.option(tr("＋ Добавить новый магазин"), "new"),
        );
      fallback =
        record.store && typeof record.store.id === "string"
          ? {
              id: record.store.id.slice(0, 150),
              name: String(record.store.name || "Магазин").slice(0, 80),
              address: String(record.store.address || "").slice(0, 160),
            }
          : null;
      if (
        fallback &&
        ![...$("#store-select").options].some(
          (option) => option.value === fallback.id,
        )
      )
        $("#store-select").add(
          new Option(`${fallback.name} · ${fallback.address}`, fallback.id),
        );
      $("#store-select").value =
        typeof fields.storeId === "string" ? fields.storeId : "";
      $("#store-name").value = String(fields.name || "").slice(0, 80);
      $("#store-address").value = String(fields.address || "").slice(0, 160);
      $("#report-description").value = String(fields.description || "").slice(
        0,
        1000,
      );
      $(
        `input[name="result"][value="${fields.result === "clean" ? "clean" : "violation"}"]`,
      ).checked = true;
      changeNewStoreFields();
      if (cloudMode) window.VSGMap?.restoreDraft(record.location);
      pendingPhotos = photos;
      renderPhotoPreviews();
      const details = record.productDetails;
      window.VSGProducts.restore(
        details
          ? {
              ...details,
              products: Array.isArray(details.products)
                ? details.products.map((item) => {
                    const savedId = record.photos?.[item.photo_index]?.id;
                    const index = photos.findIndex(
                      (photo) => photo.id === savedId,
                    );
                    return { ...item, photo_index: index >= 0 ? index : null };
                  })
                : [],
            }
          : undefined,
      );
      window.VSGI18n.text(
        $("#character-count"),
        `${$("#report-description").value.length} / 1000`,
      );
      submission =
        record.submission &&
        /^[0-9a-f-]{36}$/i.test(record.submission.id) &&
        typeof record.submission.signature === "string" &&
        record.submission.signature.length < 16384
          ? record.submission
          : null;
      if (submission && cloudState.backend)
        cloudState.backend.attempt = { ...submission, uploaded: new Set() };
      pendingRestore = null;
      dirty = false;
      status(
        photos.length < (record.photos || []).length
          ? tr(
              "Черновик восстановлен. Часть фото повреждена — добавьте их ещё раз.",
            )
          : tr("Черновик восстановлен. Можно продолжить с того же места."),
        photos.length < (record.photos || []).length,
      );
    } finally {
      if (token === generation) restoring = false;
    }
  }

  async function setOwner(user) {
    if (owner === user) return;
    const previousFlush = flush();
    const first = owner === null,
      token = ++generation;
    owner = user;
    loaded = false;
    pendingRestore = null;
    submission = null;
    restoring = false;
    if (!first) resetForm();
    dirty = hasContent();
    revision++;
    try {
      if (user === "guest") localStorage.removeItem(ownerSetting);
      else localStorage.setItem(ownerSetting, user);
    } catch {
      /* Draft data itself is stored in IndexedDB. */
    }
    try {
      await previousFlush;
      const record = await read(user);
      if (token !== generation) return;
      loaded = true;
      if (record) {
        if (dirty) {
          pendingRestore = record;
          status(
            tr(
              "Есть сохранённый черновик. Восстановите его или удалите, чтобы сохранять новую форму.",
            ),
          );
        } else await restore(record);
      } else if (dirty) changed();
      else
        status(
          tr(
            "Форма и фотографии автоматически сохраняются на этом устройстве.",
          ),
        );
    } catch {
      if (token === generation) {
        loaded = true;
        status(
          tr(
            "Хранилище черновиков недоступно. Не закрывайте страницу с неотправленным отчётом.",
          ),
          true,
        );
      }
    }
  }

  async function clear({ resetForm: shouldReset = true } = {}) {
    clearTimeout(timer);
    dirty = false;
    revision++;
    pendingRestore = null;
    submission = null;
    const user = owner,
      token = generation,
      savedRevision = revision;
    if (shouldReset) resetForm();
    if (cloudState.backend) cloudState.backend.attempt = null;
    if (!user) return;
    queue = queue
      .then(() => remove(user))
      .then(() => {
        if (token === generation && revision === savedRevision)
          status(
            tr("Черновик удалён. Новая форма будет сохраняться автоматически."),
          );
        return true;
      })
      .catch(() => {
        if (token === generation)
          status(
            tr("Не удалось удалить черновик с устройства. Попробуйте ещё раз."),
            true,
          );
        return false;
      });
    return queue;
  }

  async function init() {
    $("#report-form").addEventListener("input", (event) => {
      if (event.target.matches("input:not([type=file]),select,textarea"))
        changed();
    });
    $("#report-form").addEventListener("change", (event) => {
      if (event.target.matches("input:not([type=file]),select,textarea"))
        changed();
    });
    window.addEventListener("vsg:locationchange", changed);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flush();
    });
    window.addEventListener("offline", () => {
      if (hasContent()) {
        dirty = true;
        flush();
      }
    });
    window.addEventListener("online", () => {
      if (hasContent()) {
        if (dirty) flush();
        else
          status(
            tr(
              "Соединение восстановлено. Черновик можно отправить кнопкой ниже.",
            ),
          );
      }
      if (cloudMode && cloudState.backend) {
        window.VSGCloudUI.refreshPublic();
        window.VSGCloudUI.refreshIdentity();
      }
    });
    $("#discard-draft").addEventListener("click", () => {
      if (readingPhotos || submittingReport) return;
      if (
        confirm(
          tr("Удалить черновик с этого устройства вместе с фотографиями?"),
        )
      )
        clear();
    });
    $("#restore-draft").addEventListener("click", () => {
      if (pendingRestore && !readingPhotos && !submittingReport)
        restore(pendingRestore);
    });
    let previous;
    try {
      previous = localStorage.getItem(ownerSetting);
    } catch {
      /* Private mode may restrict localStorage. */
    }
    if (!cloudMode) await setOwner("demo");
    else if (previous && /^[0-9a-f-]{36}$/i.test(previous))
      await setOwner(previous);
    else await setOwner("guest");
  }

  return {
    init,
    changed,
    flush,
    clear,
    setOwner,
    contextToken: () => generation,
    storeFallback: (id) => (fallback?.id === id ? fallback : null),
    selectedStore: () => fallback,
    savedAttempt: () =>
      submission ? { ...submission, uploaded: new Set() } : null,
    setSubmission: async (attempt) => {
      submission = { id: attempt.id, signature: attempt.signature };
      changed();
      return flush();
    },
  };
})();
