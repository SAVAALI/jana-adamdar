"use strict";
window.VSGAdmin = (() => {
  let owner = null,
    tab = "reports",
    request = 0,
    debounce,
    lastCounts = "";
  const state = {
    reports: { filter: "pending", query: "", offset: 0 },
    members: { filter: "pending", query: "", offset: 0 },
  };
  const notes = new Map();
  const choices = {
    reports: [
      ["pending", "На проверке"],
      ["approved", "Опубликованные"],
      ["rejected", "Отклонённые"],
      ["all", "Все отчёты"],
    ],
    members: [
      ["pending", "Заявки"],
      ["member", "Участники"],
      ["admin", "Администраторы"],
      ["blocked", "Без доступа"],
      ["all", "Все"],
    ],
  };
  const names = {
    pending: "Ожидает доступа",
    member: "Участник",
    admin: "Администратор",
    blocked: "Без доступа",
  };
  function reset() {
    owner = null;
    request++;
    clearTimeout(debounce);
    notes.clear();
    tab = "reports";
    lastCounts = "";
    for (const value of Object.values(state))
      Object.assign(value, { filter: "pending", query: "", offset: 0 });
  }
  function captureNotes() {
    for (const select of $$("[data-rejection-preset]"))
      notes.set(select.dataset.rejectionPreset, {
        preset: select.value,
        note:
          $("#note-" + CSS.escape(select.dataset.rejectionPreset))?.value || "",
      });
  }
  function restoreNotes() {
    for (const select of $$("[data-rejection-preset]")) {
      const saved = notes.get(select.dataset.rejectionPreset);
      if (saved) {
        select.value = saved.preset;
        $("#note-" + CSS.escape(select.dataset.rejectionPreset)).value =
          saved.note;
      }
      $("#custom-" + CSS.escape(select.dataset.rejectionPreset)).hidden =
        select.value !== "custom";
    }
  }
  function shell() {
    const target = $("#account-data"),
      current = state[tab];
    if (!$("#admin-dashboard"))
      target.innerHTML = `<section id="admin-dashboard" aria-label="Управление командой"><div class="admin-stats"><button type="button" data-admin-shortcut="reports:pending"><span>На проверке</span><strong data-admin-count="reports_pending">—</strong><small>открыть очередь →</small></button><button type="button" data-admin-shortcut="members:pending"><span>Заявки участников</span><strong data-admin-count="members_pending">—</strong><small>разрешить доступ →</small></button><button type="button" data-admin-shortcut="reports:approved"><span>Опубликовано</span><strong data-admin-count="reports_approved">—</strong><small>проверки на сайте →</small></button></div><div class="admin-tabs" role="tablist" aria-label="Управление"><button type="button" role="tab" id="admin-tab-reports" data-admin-tab="reports" aria-controls="admin-panel">Отчёты</button><button type="button" role="tab" id="admin-tab-members" data-admin-tab="members" aria-controls="admin-panel">Участники</button></div><div id="admin-panel" role="tabpanel"><label class="admin-search"><span id="admin-search-label">Поиск</span><input id="admin-search" class="text-input" type="search" maxlength="160" autocomplete="off"></label><div id="admin-filters" class="admin-filters" role="group" aria-label="Статус"></div><p id="admin-live" class="admin-live" role="status"></p><div id="admin-results"></div><nav class="admin-pagination" aria-label="Страницы очереди"><button type="button" id="admin-prev">← Назад</button><span id="admin-page"></span><button type="button" id="admin-next">Далее →</button></nav></div></section>`;
    for (const button of $$("[data-admin-tab]")) {
      const active = button.dataset.adminTab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    $("#admin-panel").setAttribute("aria-labelledby", `admin-tab-${tab}`);
    $("#admin-search").placeholder =
      tab === "reports"
        ? "Магазин, адрес или автор"
        : "Имя или почта участника";
    $("#admin-search-label").textContent =
      tab === "reports" ? "Найти проверку" : "Найти участника";
    if (document.activeElement !== $("#admin-search"))
      $("#admin-search").value = current.query;
    $("#admin-filters").innerHTML = choices[tab]
      .map(
        ([value, label]) =>
          `<button type="button" data-admin-filter="${value}" aria-pressed="${current.filter === value}">${label}</button>`,
      )
      .join("");
  }
  function counts(data) {
    for (const element of $$("[data-admin-count]"))
      element.textContent = Number(
        data[element.dataset.adminCount],
      ).toLocaleString("ru-RU");
  }
  function memberCard(member) {
    return `<article class="member-row admin-member"><div><strong>${escapeHTML(member.display_name)}</strong><small>${escapeHTML(member.email)}</small><span class="review-badge ${member.role}">${names[member.role] || "Участник"}</span><small>Регистрация: ${member.created_at ? displayDate(member.created_at) : "дата не указана"}</small></div>${member.role !== "admin" ? `<div class="member-actions">${member.role !== "member" ? `<button type="button" class="member-allow" data-member-id="${member.user_id}" data-member-role="member">Разрешить доступ</button>` : ""}${member.role !== "blocked" ? `<button type="button" data-member-id="${member.user_id}" data-member-role="blocked">${member.role === "pending" ? "Отклонить заявку" : "Приостановить доступ"}</button>` : ""}</div>` : `<span class="admin-role-note">Права администратора</span>`}</article>`;
  }
  async function load() {
    if (cloudState.profile?.role !== "admin" || !$("#account-data"))
      return false;
    if (owner !== cloudState.profile.user_id) {
      reset();
      owner = cloudState.profile.user_id;
    }
    captureNotes();
    shell();
    const token = ++request,
      current = { ...state[tab] },
      currentTab = tab;
    $("#admin-live").textContent = "Загружаем очередь…";
    $("#admin-results").inert = true;
    $("#admin-results").setAttribute("aria-busy", "true");
    $("#admin-prev").disabled = true;
    $("#admin-next").disabled = true;
    try {
      const data = await cloudState.backend.adminDashboard(currentTab, current);
      if (
        token !== request ||
        !$("#admin-dashboard") ||
        cloudState.profile?.role !== "admin"
      )
        return true;
      if (data.total > 0 && current.offset >= data.total) {
        state[tab].offset = Math.floor((data.total - 1) / 20) * 20;
        return load();
      }
      if (data.total === 0) {
        state[tab].offset = 0;
        current.offset = 0;
      }
      counts(data.counts);
      lastCounts = JSON.stringify(data.counts);
      window.VSGCloudUI.setAccountReports(data.reports || []);
      $("#admin-results").innerHTML = data.items.length
        ? currentTab === "reports"
          ? data.reports
              .map((report) => window.VSGCloudUI.reportCard(report, true))
              .join("")
          : data.items.map(memberCard).join("")
        : `<div class="admin-empty">${icon(currentTab === "reports" ? "check" : "shield")}<strong>${current.query ? "Ничего не найдено" : current.filter === "pending" ? (currentTab === "reports" ? "Все проверки разобраны" : "Новых заявок пока нет") : "Здесь пока нет записей"}</strong><p>${current.query ? "Попробуйте другое название или сбросьте фильтры." : "Новые записи появятся в этой очереди."}</p><button type="button" data-admin-reset>Сбросить поиск и фильтры</button></div>`;
      restoreNotes();
      $("#admin-live").textContent =
        `${currentTab === "reports" ? "Проверок" : "Участников"} найдено: ${data.total}. ${currentTab === "reports" ? "Фото и подробности открываются в карточке." : "Разрешение доступа не публикует отчёты автоматически."}`;
      $("#admin-page").textContent = data.total
        ? `${current.offset + 1}–${current.offset + data.items.length} из ${data.total}`
        : "0 записей";
      $("#admin-prev").disabled = current.offset === 0;
      $("#admin-next").disabled =
        current.offset + data.items.length >= data.total;
      return true;
    } catch (error) {
      if (token !== request || !$("#admin-live")) return true;
      if (error?.code === "PGRST202") return false;
      $("#admin-live").textContent =
        "Не удалось обновить очередь. Поиск и причины отклонения сохранены. Нажмите «Обновить кабинет», чтобы повторить.";
      return true;
    } finally {
      if (token === request && $("#admin-results")) {
        $("#admin-results").inert = false;
        $("#admin-results").setAttribute("aria-busy", "false");
      }
    }
  }
  function selectTab(next) {
    captureNotes();
    tab = next;
    clearTimeout(debounce);
    load();
  }
  function init() {
    $("#account-content").addEventListener("input", (event) => {
      if (event.target.id === "admin-search") {
        state[tab].query = event.target.value;
        state[tab].offset = 0;
        request++;
        clearTimeout(debounce);
        debounce = setTimeout(load, 350);
      } else if (event.target.matches("[data-rejection-note]")) captureNotes();
    });
    $("#account-content").addEventListener("change", (event) => {
      if (event.target.matches("[data-rejection-preset]")) {
        captureNotes();
        restoreNotes();
      }
    });
    $("#account-content").addEventListener("click", (event) => {
      const shortcut = event.target.closest("[data-admin-shortcut]");
      if (shortcut) {
        captureNotes();
        const [nextTab, nextFilter] = shortcut.dataset.adminShortcut.split(":");
        tab = nextTab;
        state[tab].filter = nextFilter;
        state[tab].query = "";
        state[tab].offset = 0;
        load();
        return;
      }
      const next = event.target.closest("[data-admin-tab]");
      if (next) {
        selectTab(next.dataset.adminTab);
        return;
      }
      const filter = event.target.closest("[data-admin-filter]");
      if (filter) {
        state[tab].filter = filter.dataset.adminFilter;
        state[tab].offset = 0;
        load();
        return;
      }
      if (event.target.closest("#admin-prev")) {
        state[tab].offset = Math.max(0, state[tab].offset - 20);
        load();
      }
      if (event.target.closest("#admin-next")) {
        state[tab].offset += 20;
        load();
      }
      if (event.target.closest("[data-admin-reset]")) {
        Object.assign(state[tab], { query: "", filter: "all", offset: 0 });
        load();
      }
    });
    $("#account-content").addEventListener("keydown", (event) => {
      if (
        event.target.matches("[data-admin-tab]") &&
        ["ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        selectTab(tab === "reports" ? "members" : "reports");
        $("#admin-tab-" + tab).focus();
      }
    });
  }
  function forgetNote(id) {
    notes.delete(id);
    const select = $(`#reason-${CSS.escape(id)}`),
      text = $(`#note-${CSS.escape(id)}`);
    if (select) select.value = "";
    if (text) text.value = "";
  }
  async function refreshCounters() {
    if (
      !$("#admin-dashboard") ||
      !$("#account-dialog").open ||
      cloudState.profile?.role !== "admin"
    )
      return;
    const token = request,
      user = owner;
    try {
      const data = await cloudState.backend.adminDashboard("summary");
      if (
        token !== request ||
        user !== owner ||
        cloudState.profile?.role !== "admin" ||
        !$("#admin-dashboard")
      )
        return;
      const next = JSON.stringify(data.counts);
      if (lastCounts && next !== lastCounts) {
        counts(data.counts);
        lastCounts = next;
        $("#admin-live").textContent =
          "В очереди есть изменения. Нажмите «Обновить кабинет», чтобы загрузить актуальные записи. Введённые причины сохранятся.";
      }
    } catch {
      /* The visible queue and unsent notes remain intact. */
    }
  }
  function showPending() {
    captureNotes();
    tab = "reports";
    Object.assign(state.reports, { filter: "pending", query: "", offset: 0 });
    request++;
  }
  return {
    init,
    load,
    reset,
    forgetNote,
    refreshCounters,
    restoreNotes,
    showPending,
  };
})();
