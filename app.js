"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const imageURL = (value) => {
  if (/^(data:image\/(jpeg|png|webp);base64,|assets\/)/.test(value))
    return value;
  try {
    const image = new URL(value);
    const trusted = new URL(window.VSG_CONFIG?.url || "https://invalid.local");
    return image.protocol === "https:" &&
      image.origin === trusted.origin &&
      image.pathname.startsWith("/storage/v1/object/sign/vsg-report-photos/")
      ? image.href
      : "";
  } catch {
    return "";
  }
};
const displayDate = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Almaty",
  }).format(new Date(value));
const displayTime = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Almaty",
  }).format(new Date(value));
const shortDate = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Almaty",
  }).format(new Date(value));
const pointsWord = (count) =>
  count % 10 === 1 && count % 100 !== 11
    ? "точка"
    : count % 10 >= 2 &&
        count % 10 <= 4 &&
        (count % 100 < 12 || count % 100 > 14)
      ? "точки"
      : "точек";
const CITY = "Астана";
// Astana uses Kazakhstan’s UTC+5 zone; Asia/Almaty is the canonical IANA name.
const demoPhotos = [
  "assets/groceries.png",
  "assets/milk.png",
  "assets/fruit.png",
];
const seedStores = [
  {
    id: "polka",
    name: "Маркет «Полка»",
    address: "проспект Мангилик Ел, 24",
    city: CITY,
    x: 43,
    y: 53,
    status: "violation",
    date: "2026-10-21T14:30:00+05:00",
    description:
      "На молочной полке обнаружены три упаковки йогурта с истёкшим сроком годности. Дата на упаковке — 18 октября, проверка проведена 21 октября: просрочка 3 дня. Информация передана сотруднику магазина.",
    photos: [...demoPhotos],
    demo: true,
  },
  {
    id: "green",
    name: "Зелёный маркет",
    address: "улица Достык, 12",
    city: CITY,
    x: 66,
    y: 62,
    status: "clean",
    date: "2026-10-21T12:15:00+05:00",
    description:
      "Проверены молочные продукты, хлеб и готовые салаты. Сроки годности в порядке, упаковки целые. На полках чисто, продукты хранятся в холодильных витринах.",
    photos: [demoPhotos[0], demoPhotos[2]],
    demo: true,
  },
  {
    id: "neighbors",
    name: "Минимаркет «Соседи»",
    address: "проспект Туран, 18",
    city: CITY,
    x: 26,
    y: 36,
    status: "clean",
    date: "2026-10-20T17:40:00+05:00",
    description:
      "Выборочно проверены бакалея, молочные продукты и выпечка. Товаров с истёкшим сроком годности не обнаружено. Даты производства и условия хранения читаются на упаковках.",
    photos: [demoPhotos[0]],
    demo: true,
  },
  {
    id: "seventh",
    name: "Гастроном № 7",
    address: "улица Сарайшык, 7",
    city: CITY,
    x: 76,
    y: 42,
    status: "violation",
    date: "2026-10-20T15:10:00+05:00",
    description:
      "В холодильной витрине обнаружен творог со сроком годности до 19 октября. На момент проверки срок истёк на 1 день. Упаковка и ценник зафиксированы, сотрудник уведомлён.",
    photos: [demoPhotos[1], demoPhotos[0]],
    demo: true,
  },
  {
    id: "home",
    name: "Лавка у дома",
    address: "проспект Кабанбай батыра, 36",
    city: CITY,
    x: 36,
    y: 79,
    status: "clean",
    date: "2026-10-19T11:20:00+05:00",
    description:
      "Проверены фрукты, овощи, крупы и молочная продукция. Просрочки не найдено. Спасибо команде магазина за внимательное отношение к покупателям!",
    photos: [demoPhotos[2]],
    demo: true,
  },
  {
    id: "quarter",
    name: "Маркет «Квартал»",
    address: "улица Сыганак, 15",
    city: CITY,
    x: 87,
    y: 77,
    status: "violation",
    date: "2026-10-19T10:05:00+05:00",
    description:
      "Найдена упаковка готового салата со сроком годности до 17 октября: просрочка 2 дня. Упаковка не повреждена. Товар показали администратору для проверки и снятия с продажи.",
    photos: [demoPhotos[0], demoPhotos[2]],
    demo: true,
  },
  {
    id: "basket",
    name: "Магазин «Корзинка»",
    address: "улица Акмешит, 9",
    city: CITY,
    x: 52,
    y: 30,
    status: "clean",
    date: "2026-10-18T16:00:00+05:00",
    description:
      "Выборочная проверка детского питания и молочной продукции. Сроки годности в норме. Товары с ближайшими датами размещены впереди.",
    photos: [demoPhotos[1]],
    demo: true,
  },
  {
    id: "corner",
    name: "Гастроном «На углу»",
    address: "улица Кунаева, 14",
    city: CITY,
    x: 15,
    y: 65,
    status: "violation",
    date: "2026-10-18T13:45:00+05:00",
    description:
      "На полке с выпечкой найдена упаковка хлеба с истёкшим на 2 дня сроком годности. Зафиксированы маркировка и дата. Сотрудник магазина принял информацию.",
    photos: [demoPhotos[0]],
    demo: true,
  },
];

const cloudMode = Boolean(window.VSG_CONFIG?.enabled);
const cloudState = {
  backend: null,
  profile: null,
  ready: false,
  loading: false,
  stats: null,
};
let cloudCatalog = [];
let submittingReport = false;
let currentDetailStore = null;
let stores = cloudMode ? [] : structuredClone(seedStores);
let userReports = 0;
let userIssues = 0;
let currentFilter = "all";
let selectedId = cloudMode ? null : "polka";
let zoom = 1;
let pendingPhotos = [];
let readingPhotos = false;
let database = null;
let toastTimer;
let lastReportId = null;
let modalOpener = null;

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}

function badge(status) {
  return status === "violation"
    ? `<span class="badge violation"><span class="status-dot violet"></span>Найдена просрочка</span>`
    : `<span class="badge">${icon("check")}Всё чисто</span>`;
}

function filteredStores() {
  const query = $("#store-search").value.trim().toLocaleLowerCase("ru");
  return stores.filter(
    (store) =>
      (currentFilter === "all" || store.status === currentFilter) &&
      `${store.name} ${store.address}`.toLocaleLowerCase("ru").includes(query),
  );
}

function renderList() {
  const visible = filteredStores();
  $("#all-count").textContent = stores.length;
  $("#result-count").textContent =
    `${visible.length} ${pointsWord(visible.length)}`;
  $("#stat-stores").innerHTML =
    `${cloudMode ? (cloudState.ready ? Number(cloudState.stats.stores) : "—") : 128 + userReports}<span>${icon("arrow")}</span>`;
  $("#stat-issues").innerHTML =
    `${cloudMode ? (cloudState.ready ? Number(cloudState.stats.violations) : "—") : 36 + userIssues}<span>${icon("arrow")}</span>`;
  if (cloudMode)
    $("#stat-members").innerHTML =
      `${cloudState.ready ? Number(cloudState.stats.members) : "—"}<span>✦</span>`;
  $("#store-list").innerHTML = visible.length
    ? visible
        .map(
          (store) => `
    <button class="store-card ${store.id === selectedId ? "selected" : ""}" data-store="${escapeHTML(store.id)}" aria-label="${escapeHTML(store.name)}, ${store.status === "clean" ? "всё чисто" : "найдена просрочка"}. Открыть отчёт">
      <span class="store-card-top"><span class="store-name">${escapeHTML(store.name)}</span>${icon("arrow")}</span>
      <span class="store-address">${icon("pin")}${escapeHTML(store.address)}</span>
      <span class="store-card-bottom">${badge(store.status)}<time class="store-date" datetime="${escapeHTML(store.date)}">${shortDate(store.date)} · ${displayTime(store.date)}</time></span>
    </button>`,
        )
        .join("")
    : `<div class="empty-state">${icon("search")}<strong>Пока ни одной точки</strong><span>Попробуйте другое название<br>или измените фильтр.</span><button class="reset-filter" id="reset-filter">Сбросить поиск и фильтры</button></div>`;
  if (cloudMode && !cloudState.ready) {
    $("#result-count").textContent = "";
    $("#store-list").innerHTML =
      `<div class="empty-state">${icon("clock")}<strong>${cloudState.loading ? "Загружаем проверки…" : "Карта временно недоступна"}</strong><span>Обновите карту, чтобы получить отчёты команды.</span></div>`;
  } else if (cloudMode && !stores.length) {
    $("#store-list").innerHTML =
      `<div class="empty-state">${icon("pin")}<strong>Начинаем с первой проверки</strong><span>Одобренные отчёты команды<br>будут появляться здесь.</span><a class="text-link" href="#report">Добавить отчёт →</a></div>`;
  }
  renderMarkers(visible);
}

function renderMarkers(visible) {
  if (cloudMode && window.VSGMap) {
    window.VSGMap.render(visible, selectedId);
    return;
  }
  // Positions are illustrative; this prototype deliberately does not geocode addresses.
  const popupStore = visible.find((store) => store.id === selectedId);
  $("#map-markers").innerHTML =
    visible
      .map(
        (store) => `
    <button class="map-marker ${store.status} ${store.id === selectedId ? "selected" : ""}" data-marker="${escapeHTML(store.id)}" style="left:${store.x}%;top:${store.y}%" aria-label="${escapeHTML(store.name)}: ${store.status === "clean" ? "всё чисто" : "найдена просрочка"}" aria-pressed="${store.id === selectedId}">${icon(store.status === "clean" ? "check" : "store")}</button>`,
      )
      .join("") +
    (popupStore
      ? `
    <div class="map-popup" style="left:${Math.max(24, Math.min(76, popupStore.x))}%;top:${popupStore.y}%">
      <div class="map-popup-top"><strong>${escapeHTML(popupStore.name)}</strong><button data-detail="${escapeHTML(popupStore.id)}" aria-label="Открыть отчёт ${escapeHTML(popupStore.name)}">${icon("arrow")}</button></div>
      <small>${escapeHTML(popupStore.address)}</small>${badge(popupStore.status)}
    </div>`
      : "");
}

function renderStoreOptions() {
  const previous = $("#store-select").value;
  const catalog = [...(cloudMode ? cloudCatalog : stores)];
  const draftStore = window.VSGDrafts?.selectedStore();
  if (draftStore && !catalog.some((store) => store.id === draftStore.id))
    catalog.push(draftStore);
  $("#store-select").innerHTML =
    '<option value="">Выберите магазин</option>' +
    catalog
      .map(
        (store) =>
          `<option value="${escapeHTML(store.id)}">${escapeHTML(store.name)} · ${escapeHTML(store.address)}</option>`,
      )
      .join("") +
    '<option value="new">＋ Добавить новый магазин</option>';
  if (previous === "new" || catalog.some((store) => store.id === previous))
    $("#store-select").value = previous;
}

function selectMarker(id) {
  selectedId = id;
  renderList();
  const card = $(`[data-store="${CSS.escape(id)}"]`);
  if (card) {
    const list = $("#store-list");
    list.scrollTop = card.offsetTop - list.offsetTop;
  }
}

function openStore(id, opener = document.activeElement, override = null) {
  const store = override || stores.find((item) => item.id === id);
  if (!store) return;
  selectedId = id;
  renderList();
  modalOpener = opener;
  currentDetailStore = store;
  const photos = store.photos.filter((photo) => imageURL(photo));
  $("#store-detail").innerHTML = `
    <div class="detail-header"><p class="eyebrow">${store.demo ? "ДЕМО-ОТЧЁТ" : "ОТЧЁТ УЧАСТНИКА"} · АСТАНА</p><button class="icon-button detail-close" id="close-detail" aria-label="Закрыть карточку магазина">${icon("close")}</button><h2 id="detail-title">${escapeHTML(store.name)}</h2><p class="detail-address">${icon("pin")}${store.city ? escapeHTML(store.city) + ", " : ""}${escapeHTML(store.address)}</p></div>
    <div class="detail-body"><div class="detail-status">${badge(store.status)}<time datetime="${escapeHTML(store.date)}">${displayDate(store.date)}, ${displayTime(store.date)} (Астана)</time></div><h3>Результат проверки</h3><p class="detail-description">${escapeHTML(store.description)}</p><h3>Фотографии <span class="gallery-count">(${photos.length})</span></h3><div class="detail-gallery">${photos.map((photo, index) => `<button class="gallery-photo" data-photo-index="${index}" aria-label="Открыть фотографию ${index + 1} из ${photos.length}"><img src="${escapeHTML(imageURL(photo))}" alt="${store.demo ? "Иллюстрация товаров для демонстрационного отчёта" : "Фото проверки магазина"} ${index + 1}" loading="lazy">${icon("search")}</button>`).join("")}</div><p class="detail-photo-note">${store.demo ? "Учебный пример. Магазин и результат вымышлены, фотографии используются как иллюстрации и не являются доказательством нарушения." : cloudMode ? "Фотографии участника команды. Точку на карте указывает участник или администратор. Адрес магазина указан выше." : "Фотографии добавлены участником. Отчёт хранится в этом браузере и не отправляется на сервер. Положение на карте схематичное."}</p><section id="store-history" class="store-history" aria-label="История проверок магазина"></section><div class="detail-footer"><span>ВРЕМЯ И СТЕКЛО<br>Внимание к деталям. Забота о каждом.</span><button class="button button-purple" id="report-this-store" data-id="${escapeHTML(store.id)}">Добавить проверку ${icon("plus")}</button></div></div>`;
  $("#store-detail").dataset.storeId = id;
  if (!$("#store-dialog").open) $("#store-dialog").showModal();
  $("#close-detail").focus();
  window.VSGHistory?.open(store);
}

function closeStore() {
  window.VSGHistory?.clear();
  $("#store-dialog").close();
  const card = $(`[data-store="${CSS.escape(selectedId)}"]`);
  if (modalOpener?.isConnected) modalOpener.focus({ preventScroll: true });
  else card?.focus({ preventScroll: true });
}

function changeNewStoreFields() {
  const isNew = $("#store-select").value === "new";
  $("#new-store-fields").hidden = !isNew;
  $("#store-name").required = isNew;
  $("#store-address").required = isNew;
  if (cloudMode) window.VSGMap?.syncDraft();
}

function renderPhotoPreviews() {
  $("#photo-previews").innerHTML = pendingPhotos
    .map(
      (photo, index) =>
        `<div class="photo-preview"><img src="${escapeHTML(imageURL(photo.url))}" alt="Превью: ${escapeHTML(photo.name)}"><button type="button" class="remove-photo" data-remove-photo="${index}" aria-label="Удалить фотографию ${index + 1}">${icon("close")}</button></div>`,
    )
    .join("");
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ id: crypto.randomUUID(), url: reader.result, name: file.name });
    reader.onerror = () =>
      reject(
        new Error(
          "Не удалось прочитать фото. Попробуйте выбрать файл ещё раз.",
        ),
      );
    reader.readAsDataURL(file);
  });
}

async function validatePhoto(photo) {
  const image = new Image();
  image.src = photo.url;
  await image.decode();
  return photo;
}

async function addPhotos(files) {
  if (readingPhotos) return;
  const scope = window.VSGDrafts?.contextToken();
  const selected = [...files];
  const errors = [];
  const valid = [];
  for (const file of selected) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      errors.push(`«${file.name}»: нужен JPG, PNG или WEBP.`);
    else if (file.size > 8 * 1024 * 1024)
      errors.push(`«${file.name}»: файл больше 8 МБ.`);
    else valid.push(file);
  }
  const available = Math.max(0, 6 - pendingPhotos.length);
  if (valid.length > available)
    errors.push(
      "Можно прикрепить не больше 6 фотографий. Лишние не добавлены.",
    );
  readingPhotos = true;
  $("#submit-report").disabled = true;
  const results = await Promise.allSettled(
    valid
      .slice(0, available)
      .map(async (file) => validatePhoto(await readFile(file))),
  );
  if (scope !== window.VSGDrafts?.contextToken()) {
    readingPhotos = false;
    syncSubmitButton();
    return;
  }
  for (const result of results) {
    if (result.status === "fulfilled") pendingPhotos.push(result.value);
    else
      errors.push(
        "Один из файлов повреждён или не является изображением. Выберите другое фото.",
      );
  }
  readingPhotos = false;
  syncSubmitButton();
  $("#photo-error").textContent = errors.join(" ");
  $("#photo-input").value = "";
  renderPhotoPreviews();
  window.VSGDrafts?.changed();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vremya-i-steklo-prototype", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Хранилище заблокировано другой вкладкой."));
  });
}

function loadState() {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("state")
      .objectStore("state")
      .get("reports");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveState() {
  if (!database)
    return Promise.reject(new Error("Локальное хранилище недоступно."));
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("state", "readwrite");
    transaction
      .objectStore("state")
      .put({ version: 1, stores, userReports, userIssues }, "reports");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function syncSubmitButton() {
  $("#submit-report").disabled =
    readingPhotos ||
    submittingReport ||
    (cloudMode &&
      (!cloudState.ready ||
        !["member", "admin"].includes(cloudState.profile?.role)));
}

async function submitReport(event) {
  event.preventDefault();
  $("#form-error").textContent = "";
  $("#photo-error").textContent = "";
  $("#form-success").hidden = true;
  if (readingPhotos) return;
  if (!pendingPhotos.length) {
    $("#photo-error").textContent =
      "Добавьте хотя бы одну фотографию, чтобы подтвердить результат проверки.";
    $("#photo-input").focus();
    return;
  }
  const description = $("#report-description").value.trim();
  const name = $("#store-name").value.trim();
  const address = $("#store-address").value.trim();
  if (description.length < 10) {
    $("#form-error").textContent = "Опишите результат хотя бы в 10 символах.";
    $("#report-description").focus();
    return;
  }
  const isNew = $("#store-select").value === "new";
  if (isNew && (!name || !address)) {
    $("#form-error").textContent = "Укажите название и адрес нового магазина.";
    (name ? $("#store-address") : $("#store-name")).focus();
    return;
  }
  const status = $('input[name="result"]:checked').value;
  const existing =
    (cloudMode ? cloudCatalog : stores).find(
      (store) => store.id === $("#store-select").value,
    ) || window.VSGDrafts?.storeFallback($("#store-select").value);
  if (!isNew && !existing) {
    $("#form-error").textContent = "Выберите магазин из списка.";
    return;
  }
  if (cloudMode) {
    await window.VSGCloudUI.submit({
      storeId: isNew ? null : existing.id,
      name,
      address,
      result: status,
      description,
      photos: pendingPhotos,
      location: window.VSGMap?.value(),
    });
    return;
  }
  const duplicate =
    isNew &&
    stores.find(
      (store) =>
        store.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru") &&
        store.address.toLocaleLowerCase("ru") ===
          address.toLocaleLowerCase("ru"),
    );
  const target = duplicate || existing;
  const id =
    target?.id ||
    `report-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
  const index = stores.length;
  const entry = {
    id,
    city: target?.city || CITY,
    name: target?.name || name,
    address: target?.address || address,
    x: target?.x ?? 24 + ((index * 17) % 54),
    y: target?.y ?? 44 + ((index * 13) % 39),
    status,
    date: new Date().toISOString(),
    description,
    photos: pendingPhotos.map((photo) => photo.url),
    demo: false,
    history: target
      ? [
          {
            date: target.date,
            status: target.status,
            description: target.description,
            photos: target.photos,
            demo: target.demo,
          },
          ...(target.history || []),
        ]
      : [],
  };
  const submitButton = $("#submit-report");
  submitButton.disabled = true;
  submitButton.textContent = "Сохраняем отчёт…";
  stores = [entry, ...stores.filter((store) => store.id !== id)];
  userReports++;
  if (status === "violation") userIssues++;
  let persisted = true;
  try {
    await saveState();
  } catch {
    persisted = false;
  }
  selectedId = id;
  lastReportId = id;
  currentFilter = "all";
  $("#store-search").value = "";
  $$(".filter-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === "all");
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.filter === "all"),
    );
  });
  await window.VSGDrafts?.clear({ resetForm: false });
  $("#report-form").reset();
  $("#character-count").textContent = "0 / 1000";
  pendingPhotos = [];
  renderPhotoPreviews();
  changeNewStoreFields();
  renderStoreOptions();
  renderList();
  $("#store-list").scrollTop = 0;
  zoom = 1;
  updateZoom();
  submitButton.disabled = false;
  submitButton.innerHTML = `Отправить отчёт на сайт ${icon("arrow")}`;
  const success = $("#form-success");
  success.innerHTML = `${icon("check")} <strong>Отчёт добавлен!</strong> ${target ? "Карточка магазина обновлена." : "Новая точка появилась на карте."} ${persisted ? "Результат сохранён в этом браузере." : "Хранилище браузера недоступно: отчёт останется только до перезагрузки страницы. Сохраните фотографии у себя."}<button type="button" id="view-new-report">Посмотреть отчёт на карте →</button>`;
  success.hidden = false;
  toast(
    persisted
      ? "Спасибо! Ещё одна проверка на карте города."
      : "Отчёт добавлен на время этой сессии. Постоянное сохранение недоступно.",
  );
}

function updateZoom() {
  if (cloudMode) {
    $("#zoom-in").disabled = false;
    $("#zoom-out").disabled = false;
    return;
  }
  $("#map-plane").style.transform = `scale(${zoom})`;
  $("#zoom-in").disabled = zoom >= 1.6;
  $("#zoom-out").disabled = zoom <= 1;
}

function bindEvents() {
  $$(".filter-button").forEach((button) =>
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;
      $$(".filter-button").forEach((item) => {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      });
      renderList();
      $("#store-list").scrollTop = 0;
    }),
  );
  $("#store-search").addEventListener("input", renderList);
  $("#store-list").addEventListener("click", (event) => {
    const card = event.target.closest("[data-store]");
    if (card) openStore(card.dataset.store, card);
    if (event.target.closest("#reset-filter")) {
      $("#store-search").value = "";
      $('[data-filter="all"]').click();
      $("#store-search").focus();
    }
  });
  $("#map-markers").addEventListener("click", (event) => {
    const marker = event.target.closest("[data-marker]");
    const detail = event.target.closest("[data-detail]");
    if (marker) {
      selectMarker(marker.dataset.marker);
      $(`[data-marker="${CSS.escape(marker.dataset.marker)}"]`)?.focus({
        preventScroll: true,
      });
    }
    if (detail) openStore(detail.dataset.detail, detail);
  });
  $("#zoom-in").addEventListener("click", () => {
    if (cloudMode) {
      window.VSGMap?.zoom(1);
      return;
    }
    zoom = Math.min(1.6, +(zoom + 0.2).toFixed(1));
    updateZoom();
  });
  $("#zoom-out").addEventListener("click", () => {
    if (cloudMode) {
      window.VSGMap?.zoom(-1);
      return;
    }
    zoom = Math.max(1, +(zoom - 0.2).toFixed(1));
    updateZoom();
  });
  $("#store-detail").addEventListener("click", (event) => {
    window.VSGHistory?.handleClick(event);
    if (event.target.closest("#close-detail")) closeStore();
    const photo = event.target.closest("[data-photo-index]");
    if (photo) {
      const store = currentDetailStore;
      const index = Number(photo.dataset.photoIndex);
      $("#lightbox-image").src = imageURL(
        store.photos.filter((item) => imageURL(item))[index],
      );
      $("#lightbox-image").alt =
        `Фотография ${index + 1} из отчёта: ${store.name}`;
      $("#lightbox-caption").textContent =
        `${store.name} · Фото ${index + 1} из ${store.photos.length}${store.demo ? " · Иллюстрация" : ""}`;
      $("#photo-dialog").showModal();
    }
    const reportButton = event.target.closest("#report-this-store");
    if (reportButton) {
      closeStore();
      $("#store-select").value = reportButton.dataset.id;
      changeNewStoreFields();
      $("#report").scrollIntoView({ behavior: "smooth" });
      $("#store-select").focus({ preventScroll: true });
    }
  });
  $("#close-photo").addEventListener("click", () => $("#photo-dialog").close());
  $("#store-dialog").addEventListener("close", () => {
    if (!$("#store-dialog").open) window.VSGHistory?.clear();
    const target = modalOpener?.isConnected
      ? modalOpener
      : $(`[data-store="${CSS.escape(selectedId)}"]`);
    if (
      document.activeElement === document.body ||
      $("#store-dialog").contains(document.activeElement)
    )
      target?.focus({ preventScroll: true });
  });
  for (const dialog of [$("#store-dialog"), $("#photo-dialog")]) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog === $("#store-dialog") ? closeStore() : dialog.close();
    });
  }
  $("#store-select").addEventListener("change", changeNewStoreFields);
  $("#photo-input").addEventListener("change", (event) =>
    addPhotos(event.target.files),
  );
  $("#photo-previews").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-photo]");
    if (!remove) return;
    pendingPhotos.splice(Number(remove.dataset.removePhoto), 1);
    renderPhotoPreviews();
    window.VSGDrafts?.changed();
  });
  const zone = $("#upload-zone");
  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("dragging");
    }),
  );
  ["dragleave", "drop"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove("dragging");
    }),
  );
  zone.addEventListener("drop", (event) => addPhotos(event.dataTransfer.files));
  $("#report-description").addEventListener("input", (event) => {
    $("#character-count").textContent = `${event.target.value.length} / 1000`;
  });
  $("#report-form").addEventListener("submit", submitReport);
  $("#form-success").addEventListener("click", (event) => {
    if (event.target.closest("#view-new-report")) {
      $("#raids").scrollIntoView({ behavior: "smooth" });
      openStore(lastReportId);
    }
  });
  $("#menu-button").addEventListener("click", () => {
    const open = $("#menu-button").getAttribute("aria-expanded") !== "true";
    $("#menu-button").setAttribute("aria-expanded", String(open));
    $("#menu-button").setAttribute(
      "aria-label",
      open ? "Закрыть меню" : "Открыть меню",
    );
    $("#mobile-nav").hidden = !open;
    $("#menu-button").innerHTML = icon(open ? "close" : "menu");
  });
  $$("#mobile-nav a").forEach((link) =>
    link.addEventListener("click", () => {
      if (!$("#mobile-nav").hidden) $("#menu-button").click();
    }),
  );
}

async function init() {
  if (cloudMode) {
    window.VSGMap?.init();
    await window.VSGDrafts?.init();
    await window.VSGCloudUI.init();
    return;
  }
  await window.VSGDrafts?.init();
  // Render immediately; unavailable/private browser storage must not block the UI.
  renderList();
  renderStoreOptions();
  updateZoom();
  $("#current-year").textContent = new Date().getFullYear();
  $("#submit-report").disabled = true;
  try {
    database = await openDatabase();
    const saved = await loadState();
    if (
      saved?.version === 1 &&
      Array.isArray(saved.stores) &&
      saved.stores.length &&
      saved.stores.every(
        (store) =>
          typeof store.id === "string" &&
          typeof store.name === "string" &&
          typeof store.address === "string" &&
          typeof store.description === "string" &&
          Array.isArray(store.photos) &&
          Number.isFinite(store.x) &&
          Number.isFinite(store.y) &&
          ["clean", "violation"].includes(store.status) &&
          Number.isFinite(Date.parse(store.date)),
      )
    ) {
      // Refresh only fictional demo points. Preserve all participant reports and photos.
      stores = saved.stores.map((store) => {
        const updatedDemo = seedStores.find((seed) => seed.id === store.id);
        return store.demo && updatedDemo ? structuredClone(updatedDemo) : store;
      });
      userReports = Number.isFinite(saved.userReports) ? saved.userReports : 0;
      userIssues = Number.isFinite(saved.userIssues) ? saved.userIssues : 0;
      selectedId = stores[0].id;
      renderList();
      renderStoreOptions();
    }
  } catch {
    database = null;
    $(".form-note").innerHTML =
      `${icon("shield")} Хранилище недоступно. Отчёты останутся только до перезагрузки.`;
  }
  $("#submit-report").disabled = false;
  bindEvents();
}

init();
