"use strict";

window.VSGHistory = (() => {
  let generation = 0,
    currentStore = null,
    offset = 0,
    loading = false;
  const reports = new Map();

  function row(report, index) {
    const photos = report.photos.filter((photo) => imageURL(photo));
    const key = String(report.reportId || `local-${index}`);
    reports.set(key, report);
    return `<details class="history-entry"><summary><span class="history-dot ${report.status}"></span><span class="history-date"><time datetime="${escapeHTML(report.date)}">${displayDate(report.date)}</time><small>${report.checkedDate ? "Дата проверки" : displayTime(report.date)} · Астана${report.demo ? " · Демо" : ""}</small></span>${badge(report.status)}<span class="history-chevron">⌄</span></summary><div class="history-entry-body"><p>${escapeHTML(report.description)}</p>${window.VSGProducts.render(report, key)}<div class="history-photos">${photos.map((photo, photoIndex) => `<button type="button" data-history-report="${escapeHTML(key)}" data-history-photo="${photoIndex}" aria-label="Фото ${photoIndex + 1} проверки от ${escapeHTML(displayDate(report.date))}"><img src="${escapeHTML(imageURL(photo))}" alt="Фотография проверки от ${escapeHTML(displayDate(report.date))}" loading="lazy"></button>`).join("")}</div></div></details>`;
  }

  function clear() {
    generation++;
    currentStore = null;
    loading = false;
    reports.clear();
  }

  async function load(reset = false) {
    if (!currentStore || loading) return;
    const token = generation,
      store = currentStore;
    loading = true;
    const status = $("#history-status"),
      more = $("#history-more");
    if (!status || !more) return;
    more.disabled = true;
    status.textContent = "Загружаем опубликованные проверки…";
    try {
      const data = await cloudState.backend.history(
        store.id,
        reset ? 0 : offset,
      );
      if (token !== generation || !$("#history-list")) return;
      if (reset) {
        offset = 0;
        reports.clear();
        $("#history-list").replaceChildren();
      }
      const unique = data.reports.filter(
        (report) => !reports.has(String(report.reportId)),
      );
      $("#history-list").insertAdjacentHTML(
        "beforeend",
        unique.map((report, index) => row(report, offset + index)).join(""),
      );
      offset += data.reports.length;
      status.textContent = reports.size
        ? `Показано опубликованных проверок: ${reports.size}`
        : "Опубликованных проверок этого магазина пока нет.";
      more.hidden = !data.hasMore;
      $("#history-retry").hidden = true;
    } catch (error) {
      if (token !== generation || !$("#history-status")) return;
      status.textContent = ["PGRST205", "42P01"].includes(error?.code)
        ? "История проверок пока не подключена."
        : "Не удалось загрузить историю. Проверьте подключение и повторите попытку.";
      if (
        ["PGRST205", "42P01"].includes(error?.code) &&
        cloudState.profile?.role === "admin"
      )
        status.textContent += " Выполните history.sql в SQL Editor Supabase.";
      $("#history-retry").hidden = false;
    } finally {
      if (token === generation) {
        loading = false;
        if ($("#history-more")) $("#history-more").disabled = false;
      }
    }
  }

  function open(store) {
    clear();
    currentStore = store;
    offset = 0;
    const section = $("#store-history");
    section.innerHTML = `<div class="history-heading"><p class="eyebrow">КАК МЕНЯЛАСЬ СИТУАЦИЯ</p><h3>История проверок</h3><p>Дата, результат и фотографии каждой опубликованной проверки. Новые — сверху.</p></div><div id="history-list"></div><p id="history-status" class="history-status" role="status"></p><div class="history-actions"><button type="button" id="history-more" hidden>Показать ещё</button><button type="button" id="history-retry" hidden>Повторить загрузку</button></div>`;
    if (cloudMode) load(true);
    else {
      const entries = [store, ...(store.history || [])].sort(
        (a, b) => Date.parse(b.date) - Date.parse(a.date),
      );
      $("#history-list").innerHTML = entries.map(row).join("");
      $("#history-status").textContent =
        "История из этого браузера. Демо-примеры отмечены отдельно.";
    }
  }

  function handleClick(event) {
    if (event.target.closest("#history-more")) load();
    if (event.target.closest("#history-retry")) load(offset === 0);
    const photo = event.target.closest("[data-history-photo]");
    if (!photo) return;
    const report = reports.get(photo.dataset.historyReport);
    const index = Number(photo.dataset.historyPhoto);
    const url = report?.photos.filter((item) => imageURL(item))[index];
    if (!url) return;
    $("#lightbox-image").src = imageURL(url);
    $("#lightbox-image").alt =
      `Проверка ${report.name || currentStore.name}, ${displayDate(report.date)}, фото ${index + 1}`;
    $("#lightbox-caption").textContent =
      `${report.name || currentStore.name} · ${displayDate(report.date)} · Фото ${index + 1}`;
    $("#photo-dialog").showModal();
  }

  return { open, clear, handleClick };
})();
