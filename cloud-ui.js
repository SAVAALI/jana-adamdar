"use strict";

window.VSGCloudUI = (() => {
  let authMode = "login";
  let authFeedback = "";
  let identityRequest = 0;
  let accountRequest = 0;
  let publicRequest = null;
  const accountReports = new Map();
  const roles = {
    pending: "Ожидает доступа",
    member: "Участник",
    admin: "Администратор",
    blocked: "Доступ приостановлен",
  };
  const reviewStates = {
    pending: "На проверке",
    approved: "Опубликован",
    rejected: "Не опубликован",
  };
  const canSubmit = () =>
    ["member", "admin"].includes(cloudState.profile?.role);

  function message(error) {
    const known = {
      invalid_credentials: "Неверная почта или пароль.",
      email_not_confirmed:
        "Подтвердите почту по ссылке из письма, затем войдите.",
      user_already_exists: "Такой аккаунт уже существует. Попробуйте войти.",
      over_email_send_rate_limit:
        "Письмо уже отправлено. Подождите немного перед повторной попыткой.",
      email_address_invalid: "Проверьте адрес почты.",
      weak_password: "Выберите более надёжный пароль: не меньше 8 символов.",
      signup_disabled:
        "Регистрация сейчас закрыта. Свяжитесь с администратором команды.",
    };
    if (error?.code === "PGRST202")
      return "Для сохранения места на карте выполните real-map.sql в SQL Editor Supabase.";
    if (known[error?.code]) return known[error.code];
    if (error?.message === "Invalid login credentials")
      return known.invalid_credentials;
    if (error?.message === "Email not confirmed")
      return known.email_not_confirmed;
    if (/^[А-ЯЁа-яё]/.test(error?.message || "")) return error.message;
    return "Не удалось выполнить запрос. Проверьте подключение и повторите попытку.";
  }

  function updateAccess() {
    const profile = cloudState.profile;
    $("#account-button span").textContent = profile ? "Кабинет" : "Войти";
    const text = !profile
      ? "Войдите в аккаунт, чтобы отправить отчёт команде."
      : profile.role === "pending"
        ? "Ваш аккаунт ожидает одобрения администратора."
        : profile.role === "blocked"
          ? "Доступ к отправке приостановлен. Обратитесь к администратору."
          : `Вы в команде, ${profile.display_name}. Отчёт появится после проверки.`;
    $("#report-access").innerHTML =
      `<p>${escapeHTML(text)}</p><button type="button" data-open-account>${profile ? "Кабинет" : "Войти"} ${icon("arrow")}</button>`;
    syncSubmitButton();
  }

  async function refreshIdentity() {
    const request = ++identityRequest;
    try {
      const profile = await cloudState.backend.profile();
      if (request !== identityRequest) return;
      let catalog = [...stores];
      if (["member", "admin"].includes(profile?.role)) {
        try {
          catalog = await cloudState.backend.catalog();
        } catch {
          catalog = [...stores];
        }
      }
      if (request !== identityRequest) return;
      cloudState.profile = profile;
      cloudCatalog = catalog;
      renderStoreOptions();
      updateAccess();
      if ($("#account-dialog").open && authMode !== "password") renderAccount();
    } catch (error) {
      if (request !== identityRequest) return;
      cloudState.profile = null;
      authFeedback = message(error);
      updateAccess();
      if ($("#account-dialog").open) renderAccount();
    }
  }

  function refreshPublic() {
    if (publicRequest) return publicRequest;
    publicRequest = (async () => {
      cloudState.loading = true;
      renderList();
      $("#refresh-cloud").disabled = true;
      try {
        const data = await cloudState.backend.publicData();
        stores = data.stores;
        cloudState.stats = data.stats;
        cloudState.ready = true;
        if (!stores.some((store) => store.id === selectedId))
          selectedId = stores[0]?.id || null;
        if (!canSubmit()) cloudCatalog = [...stores];
        renderStoreOptions();
        $("#cloud-notice").textContent =
          "Общие отчёты команды · обновляются каждую минуту";
        $("#cloud-status").classList.remove("has-error");
      } catch {
        $("#cloud-notice").textContent = cloudState.ready
          ? "Не удалось обновить карту. Показаны последние загруженные проверки."
          : "Не удалось загрузить проверки команды. Попробуйте обновить карту.";
        $("#cloud-status").classList.add("has-error");
      } finally {
        cloudState.loading = false;
        renderList();
        updateAccess();
        $("#refresh-cloud").disabled = false;
      }
    })().finally(() => {
      publicRequest = null;
    });
    return publicRequest;
  }

  function openAccount() {
    renderAccount();
    if (!$("#account-dialog").open) $("#account-dialog").showModal();
    $("#auth-email")?.focus();
  }

  function renderAccount() {
    accountRequest++;
    const profile = cloudState.profile;
    if (profile && authMode !== "password") {
      $("#account-content").innerHTML =
        `<p class="eyebrow">ВРЕМЯ И СТЕКЛО · АСТАНА</p><h2 id="account-title">Кабинет участника</h2><p class="account-identity">${escapeHTML(profile.display_name)}<br><span>${escapeHTML(profile.email)}</span></p><span class="review-badge ${profile.role}">${roles[profile.role] || "Участник"}</span><div class="account-toolbar"><button type="button" id="account-refresh">Обновить кабинет</button><button type="button" id="sign-out">Выйти</button></div>${!canSubmit() ? `<p class="account-hint">${profile.role === "pending" ? "Аккаунт создан. Администратор команды должен разрешить отправку отчётов. После одобрения нажмите «Обновить кабинет»." : "Отправка отчётов приостановлена. Ранее отправленные проверки доступны ниже."}</p>` : ""}<p id="account-error" class="field-error" role="alert"></p><div id="account-data" aria-live="polite"><p class="account-loading">Загружаем ваши отчёты…</p></div>`;
      loadAccount();
      return;
    }
    const isRegister = authMode === "register";
    const isReset = authMode === "reset";
    const isPassword = authMode === "password";
    const title = isPassword
      ? "Новый пароль"
      : isReset
        ? "Восстановить доступ"
        : isRegister
          ? "Присоединиться к команде"
          : "Вход в команду";
    $("#account-content").innerHTML =
      `<p class="eyebrow">ВРЕМЯ И СТЕКЛО · АСТАНА</p><h2 id="account-title">${title}</h2><p class="account-hint">${isPassword ? "Укажите новый пароль для своего аккаунта." : isReset ? "Отправим на вашу почту ссылку для смены пароля." : isRegister ? "Подтвердите почту после регистрации. Отправку отчётов откроет администратор команды." : "Войдите, чтобы отправлять проверки и смотреть их статус."}</p><form id="auth-form">${isRegister ? `<label class="field-label" for="auth-name">Как вас зовут</label><input id="auth-name" class="text-input" autocomplete="name" required minlength="2" maxlength="60">` : ""}${!isPassword ? `<label class="field-label" for="auth-email">Электронная почта</label><input id="auth-email" class="text-input" type="email" autocomplete="email" required maxlength="254">` : ""}${!isReset ? `<label class="field-label" for="auth-password">${isPassword ? "Новый пароль" : "Пароль"}</label><input id="auth-password" class="text-input" type="password" autocomplete="${isRegister || isPassword ? "new-password" : "current-password"}" required minlength="${isRegister || isPassword ? 8 : 1}" maxlength="128">` : ""}${isRegister || isPassword ? `<label class="field-label" for="auth-password-repeat">Повторите пароль</label><input id="auth-password-repeat" class="text-input" type="password" autocomplete="new-password" required minlength="8" maxlength="128">` : ""}<p id="auth-error" class="field-error" role="alert"></p><p id="auth-feedback" class="auth-feedback" role="status">${escapeHTML(authFeedback)}</p><button class="button button-purple auth-submit" type="submit">${isPassword ? "Сохранить пароль" : isReset ? "Отправить ссылку" : isRegister ? "Создать аккаунт" : "Войти"} ${icon("arrow")}</button></form><div class="auth-links">${authMode !== "login" ? `<button type="button" data-auth-mode="login">К входу</button>` : `<button type="button" data-auth-mode="register">Создать аккаунт</button><button type="button" data-auth-mode="reset">Забыли пароль?</button>`}</div>`;
  }

  function reportCard(report, admin = false) {
    accountReports.set(report.reportId, report);
    return `<article class="account-report"><div class="account-report-heading"><strong>${escapeHTML(report.name)}</strong><span class="review-badge ${report.moderationState}">${reviewStates[report.moderationState]}</span></div><p class="account-report-address">${escapeHTML(report.address)} · ${displayDate(report.date)}</p><p class="account-report-description">${escapeHTML(report.description.slice(0, 160))}${report.description.length > 160 ? "…" : ""}</p>${report.moderationNote ? `<p class="moderation-note">Комментарий: ${escapeHTML(report.moderationNote)}</p>` : ""}<button type="button" class="account-text-button" data-private-report="${report.reportId}">Фото и подробности ${icon("arrow")}</button>${admin ? `<button type="button" class="account-text-button" data-report-location="${report.reportId}">${window.VSGMap?.valid(report) ? "Изменить место на карте" : "Указать место на карте"}</button><div class="moderation-controls">${report.moderationState !== "approved" ? `<button type="button" data-review="approved" data-report-id="${report.reportId}">Опубликовать</button>` : ""}${report.moderationState !== "rejected" ? `<label class="field-label" for="note-${report.reportId}">Комментарий к отклонению</label><input class="text-input" id="note-${report.reportId}" maxlength="500" placeholder="Например, не видна дата на упаковке"><button type="button" class="reject-button" data-review="rejected" data-report-id="${report.reportId}">${report.moderationState === "approved" ? "Снять с публикации" : "Отклонить"}</button>` : ""}</div>` : ""}</article>`;
  }

  async function loadAccount() {
    const request = ++accountRequest;
    const admin = cloudState.profile?.role === "admin";
    try {
      const [own, review, members] = await Promise.all([
        cloudState.backend.reports(),
        admin ? cloudState.backend.reports("all") : [],
        admin ? cloudState.backend.members() : [],
      ]);
      if (request !== accountRequest || !$("#account-data")) return;
      accountReports.clear();
      const reviewSorted = [...review].sort(
        (a, b) =>
          Number(b.moderationState === "pending") -
          Number(a.moderationState === "pending"),
      );
      $("#account-data").innerHTML =
        `<section><h3>Мои отчёты <small>последние 100</small></h3>${own.length ? own.map((report) => reportCard(report)).join("") : `<p class="account-hint">Здесь появятся ваши отправленные проверки.</p>`}</section>${admin ? `<section><h3>Проверка отчётов <small>последние 100</small></h3>${reviewSorted.length ? reviewSorted.map((report) => reportCard(report, true)).join("") : `<p class="account-hint">Отчётов для проверки пока нет.</p>`}</section><section><h3>Участники <small>последние 100 регистраций</small></h3>${members.map((member) => `<article class="member-row"><div><strong>${escapeHTML(member.display_name)}</strong><small>${escapeHTML(member.email)}</small><span class="review-badge ${member.role}">${roles[member.role]}</span></div>${member.role !== "admin" ? `<div class="member-actions">${member.role !== "member" ? `<button type="button" data-member-id="${member.user_id}" data-member-role="member">Разрешить</button>` : ""}${member.role !== "blocked" ? `<button type="button" data-member-id="${member.user_id}" data-member-role="blocked">${member.role === "pending" ? "Отклонить" : "Приостановить"}</button>` : ""}</div>` : ""}</article>`).join("")}</section>` : ""}`;
    } catch (error) {
      if (request !== accountRequest || !$("#account-data")) return;
      $("#account-data").innerHTML =
        `<p class="account-hint">Не удалось загрузить кабинет. Нажмите «Обновить кабинет».</p>`;
      $("#account-error").textContent = message(error);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    const mode = authMode;
    const email = $("#auth-email")?.value.trim();
    const password = $("#auth-password")?.value;
    if (
      $("#auth-password-repeat") &&
      password !== $("#auth-password-repeat").value
    ) {
      $("#auth-error").textContent = "Пароли не совпадают.";
      return;
    }
    const button = $("#auth-form button[type=submit]");
    button.disabled = true;
    $("#auth-error").textContent = "";
    authFeedback = "";
    try {
      if (mode === "login") {
        await cloudState.backend.signIn(email, password);
        await refreshIdentity();
      } else if (mode === "register") {
        const data = await cloudState.backend.signUp(
          email,
          password,
          $("#auth-name").value.trim(),
        );
        authFeedback =
          "Проверьте почту и перейдите по ссылке из письма. После входа администратор сможет открыть вам доступ.";
        authMode = "login";
        if (data.session) await refreshIdentity();
      } else if (mode === "reset") {
        await cloudState.backend.resetPassword(email);
        authFeedback =
          "Если аккаунт с этой почтой существует, вы получите ссылку для смены пароля.";
      } else {
        await cloudState.backend.updatePassword(password);
        authFeedback = "Пароль обновлён.";
        authMode = "login";
        await refreshIdentity();
      }
      renderAccount();
    } catch (error) {
      if ($("#auth-error")) $("#auth-error").textContent = message(error);
      else toast(message(error));
    } finally {
      button.disabled = false;
    }
  }

  async function submit(details) {
    if (!cloudState.ready) {
      $("#form-error").textContent =
        "Дождитесь загрузки карты и повторите отправку.";
      return;
    }
    if (!canSubmit()) {
      openAccount();
      return;
    }
    submittingReport = true;
    const controls = [...$("#report-form").elements].map((control) => [
      control,
      control.disabled,
    ]);
    controls.forEach(([control]) => {
      control.disabled = true;
    });
    syncSubmitButton();
    const button = $("#submit-report");
    try {
      await cloudState.backend.submit(
        { ...details, photos: details.photos.map((photo) => ({ ...photo })) },
        (text) => {
          button.textContent = text;
        },
      );
      $("#report-form").reset();
      $("#character-count").textContent = "0 / 1000";
      pendingPhotos = [];
      renderPhotoPreviews();
      changeNewStoreFields();
      $("#form-success").innerHTML =
        `${icon("check")} <strong>Отчёт отправлен на проверку!</strong> После одобрения он появится на общей карте.<button type="button" data-open-account>Посмотреть мои отчёты →</button>`;
      $("#form-success").hidden = false;
      toast("Спасибо! Команда получила ваш отчёт.");
      await refreshIdentity();
    } catch (error) {
      $("#form-error").textContent =
        `${message(error)} Форма и фото сохранены на экране — можно повторить отправку.`;
    } finally {
      controls.forEach(([control, disabled]) => {
        control.disabled = disabled;
      });
      submittingReport = false;
      button.innerHTML = `Отправить отчёт на сайт ${icon("arrow")}`;
      syncSubmitButton();
    }
  }

  function bindCloudEvents() {
    $("#account-button").addEventListener("click", openAccount);
    $("#close-account").addEventListener("click", () =>
      $("#account-dialog").close(),
    );
    $("#refresh-cloud").addEventListener("click", () => {
      refreshPublic();
      refreshIdentity();
    });
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-open-account]")) openAccount();
    });
    $("#account-content").addEventListener("submit", (event) => {
      if (event.target.id === "auth-form") submitAuth(event);
    });
    $("#account-content").addEventListener("click", async (event) => {
      const modeButton = event.target.closest("[data-auth-mode]");
      if (modeButton) {
        authMode = modeButton.dataset.authMode;
        authFeedback = "";
        renderAccount();
        return;
      }
      if (event.target.closest("#account-refresh")) {
        await refreshIdentity();
        return;
      }
      if (event.target.closest("#sign-out")) {
        try {
          await cloudState.backend.signOut();
          cloudState.profile = null;
          authMode = "login";
          authFeedback = "Вы вышли из аккаунта.";
          await refreshIdentity();
          renderAccount();
        } catch (error) {
          toast(message(error));
        }
        return;
      }
      const locationButton = event.target.closest("[data-report-location]");
      if (locationButton) {
        const report = accountReports.get(
          locationButton.dataset.reportLocation,
        );
        if (report && cloudState.profile?.role === "admin")
          window.VSGMap.editReport(report, async (point) => {
            await cloudState.backend.setLocation(report.reportId, point);
            await Promise.all([loadAccount(), refreshPublic()]);
            toast("Место проверки сохранено.");
          });
        return;
      }
      const reportButton = event.target.closest("[data-private-report]");
      if (reportButton) {
        const report = accountReports.get(reportButton.dataset.privateReport);
        if (report) openStore(report.id, reportButton, report);
        return;
      }
      const reviewButton = event.target.closest("[data-review]");
      const memberButton = event.target.closest("[data-member-role]");
      const action = reviewButton || memberButton;
      if (!action) return;
      action.disabled = true;
      try {
        if (reviewButton)
          await cloudState.backend.moderate(
            reviewButton.dataset.reportId,
            reviewButton.dataset.review,
            $(
              `#note-${CSS.escape(reviewButton.dataset.reportId)}`,
            )?.value.trim() || "",
          );
        else
          await cloudState.backend.setMemberRole(
            memberButton.dataset.memberId,
            memberButton.dataset.memberRole,
          );
        await Promise.all([loadAccount(), refreshPublic()]);
        toast(
          reviewButton
            ? "Статус отчёта обновлён."
            : "Доступ участника обновлён.",
        );
      } catch (error) {
        if ($("#account-error"))
          $("#account-error").textContent = message(error);
        else toast(message(error));
      } finally {
        action.disabled = false;
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshPublic();
        refreshIdentity();
      }
    });
  }

  async function init() {
    $("#account-button").hidden = false;
    $("#cloud-status").hidden = false;
    $("#report-access").hidden = false;
    $(".demo-stats-note").textContent = "Только одобренные проверки команды";
    $(".form-note").innerHTML =
      `${icon("shield")} Фото доступны команде. Публичными они станут после проверки отчёта.`;
    $(".map-disclaimer").innerHTML =
      `${icon("clock")} На карте — последние опубликованные проверки. Место указывает участник или администратор; адрес и фотографии — в карточке.`;
    $(".hero-note").textContent = "Реальные проверки. Общая забота об Астане.";

    $("#current-year").textContent = new Date().getFullYear();
    bindEvents();
    bindCloudEvents();
    renderList();
    renderStoreOptions();
    updateZoom();
    updateAccess();
    try {
      cloudState.backend = new window.VSGBackend(window.VSG_CONFIG);
      cloudState.backend.watchAuth(async (event) => {
        if (event === "PASSWORD_RECOVERY") {
          authMode = "password";
          authFeedback = "";
          openAccount();
        }
        if (event === "SIGNED_OUT") {
          cloudState.profile = null;
          authMode = "login";
          accountReports.clear();
          $("#photo-dialog").close();
          $("#lightbox-image").removeAttribute("src");
          if (
            currentDetailStore?.moderationState &&
            currentDetailStore.moderationState !== "approved"
          ) {
            $("#store-dialog").close();
            $("#store-detail").replaceChildren();
            currentDetailStore = null;
          }
          pendingPhotos = [];
          $("#report-form").reset();
          changeNewStoreFields();
          renderPhotoPreviews();
          $("#character-count").textContent = "0 / 1000";
        }
        await refreshIdentity();
      });
      await Promise.all([refreshPublic(), refreshIdentity()]);
      setInterval(() => {
        if (!document.hidden) {
          refreshPublic();
          refreshIdentity();
        }
      }, 60000);
    } catch {
      $("#cloud-notice").textContent =
        "Подключение временно недоступно. Обновите страницу.";
      $("#cloud-status").classList.add("has-error");
      syncSubmitButton();
    }
  }

  return { init, submit, refreshPublic, refreshIdentity, openAccount };
})();
