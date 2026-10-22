"use strict";

window.VSGMap = (() => {
  const center = [51.14, 71.43];
  const bounds = [
    [50.8, 70.9],
    [51.5, 72.0],
  ];
  let map,
    layer,
    picker,
    pickerMarker,
    picked = null,
    draft = null;
  let onSave,
    opener,
    lastSelected,
    fitted = false,
    searchRequest = 0;
  let searchController,
    lastSearch = 0;
  const valid = (point) =>
    point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= 50.8 &&
    point.latitude <= 51.5 &&
    point.longitude >= 70.9 &&
    point.longitude <= 72.0;
  const coordinates = (point) =>
    valid(point)
      ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`
      : tr("Место ещё не выбрано");
  const searchCache = new Map();

  function tiles(target, notice) {
    let errors = 0;
    const tileLayer = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    ).addTo(target);
    tileLayer.on("tileerror", () => {
      errors++;
      window.VSGI18n.text(
        notice,
        tr(
          "Не удалось загрузить улицы. Проверьте интернет; адреса и отчёты доступны в списке.",
        ),
      );
      notice.hidden = false;
    });
    tileLayer.on("loading", () => {
      errors = 0;
    });
    tileLayer.on("load", () => {
      if (!errors) notice.hidden = true;
    });
  }

  function createMap(element, zoom = 12) {
    return L.map(element, {
      zoomControl: false,
      scrollWheelZoom: false,
      fadeAnimation: false,
      minZoom: 10,
      maxZoom: 19,
      maxBounds: bounds,
      maxBoundsViscosity: 0.8,
    }).setView(center, zoom);
  }

  function pin(status, selected = false) {
    return L.divIcon({
      className: "vsg-leaflet-icon",
      html: html`<span
        class="real-pin ${status === "violation"
          ? "violation"
          : "clean"} ${selected ? "selected" : ""}"
        >${icon(status === "violation" ? "store" : "check")}</span
      >`,
      iconSize: [38, 44],
      iconAnchor: [19, 42],
      popupAnchor: [0, -36],
    });
  }

  function render(visible, selectedId) {
    if (!map) return;
    layer.clearLayers();
    const points = visible.filter(valid);
    for (const store of points) {
      const marker = L.marker([store.latitude, store.longitude], {
        icon: pin(store.status, store.id === selectedId),
        title: store.name,
        alt: `${store.name}: ${store.status === "clean" ? tr("всё чисто") : tr("есть нарушения")}`,
        keyboard: true,
        riseOnHover: true,
      }).addTo(layer);
      const popup = document.createElement("div");
      popup.className = "real-popup";
      const title = document.createElement("strong");
      window.VSGI18n.text(title, store.name);
      const address = document.createElement("p");
      window.VSGI18n.text(address, store.address);
      const button = document.createElement("button");
      button.type = "button";
      window.VSGI18n.text(button, tr("Фото и отчёт →"));
      button.addEventListener("click", () => openStore(store.id, button));
      popup.append(title, address, button);
      marker.bindPopup(popup);
      marker.on("click", () => {
        selectMarker(store.id);
      });
      marker.getElement()?.setAttribute("data-real-marker", store.id);
      window.VSGI18n.attr(
        marker.getElement(),
        "aria-label",
        tr`${store.name}. Открыть место проверки`,
      );
      if (store.id === selectedId) marker.openPopup();
      if (store.id === selectedId && lastSelected !== selectedId) {
        map.panTo(marker.getLatLng());
      }
    }
    if (!fitted && points.length) {
      fit(points);
      fitted = true;
    }
    lastSelected = selectedId;
    const missing = visible.length - points.length;
    $("#map-location-notice").hidden = !missing;
    window.VSGI18n.text(
      $("#map-location-notice"),
      missing
        ? tr`Без места на карте: ${missing}. Адреса и отчёты доступны справа. Администратор может указать место в кабинете.`
        : "",
    );
  }

  function fit(points = filteredStores().filter(valid)) {
    if (!map) return;
    if (points.length)
      map.fitBounds(
        L.latLngBounds(points.map((p) => [p.latitude, p.longitude])),
        { padding: [65, 65], maxZoom: 16 },
      );
    else map.setView(center, 12);
  }

  function updateDraft(point) {
    draft = valid(point)
      ? { latitude: point.latitude, longitude: point.longitude }
      : null;
    window.VSGI18n.text($("#location-value"), coordinates(draft));
    window.VSGI18n.text(
      $("#choose-location"),
      draft ? tr("Изменить место на карте") : tr("Выбрать место на карте"),
    );
    window.dispatchEvent(new Event("vsg:locationchange"));
  }

  function selectedStore() {
    const id = $("#store-select").value;
    return (cloudMode ? cloudCatalog : stores).find((store) => store.id === id);
  }

  function syncDraft() {
    if (!map) return;
    // Prefer the last approved position; the private catalog has no report coordinates.
    const store = selectedStore();
    updateDraft(stores.find((item) => item.id === store?.id) || store);
  }

  function choose(point) {
    if (!valid(point)) {
      window.VSGI18n.text(
        $("#location-search-status"),
        tr("Выберите место в Астане и ближайших окрестностях."),
      );
      if (pickerMarker && valid(picked))
        pickerMarker.setLatLng([picked.latitude, picked.longitude]);
      return;
    }
    picked = { latitude: point.latitude, longitude: point.longitude };
    if (pickerMarker) picker.removeLayer(pickerMarker);
    pickerMarker = L.marker([point.latitude, point.longitude], {
      draggable: true,
      icon: pin("clean"),
    }).addTo(picker);
    pickerMarker.on("dragend", () => {
      const position = pickerMarker.getLatLng();
      choose({ latitude: position.lat, longitude: position.lng });
    });
    window.VSGI18n.text($("#picked-coordinates"), coordinates(picked));
    $("#save-location").disabled = false;
    window.VSGI18n.text(
      $("#location-search-status"),
      tr(
        "Проверьте точку. Её можно передвинуть или поставить кликом по карте.",
      ),
    );
  }

  function openPicker(point, address, save) {
    if (!window.L) {
      toast(tr("Карта не загрузилась. Обновите страницу."));
      return;
    }
    opener = document.activeElement;
    onSave = save;
    picked = null;
    $("#location-search").value = address || "";
    $("#location-results").replaceChildren();
    window.VSGI18n.text(
      $("#location-search-status"),
      tr("Найдите адрес или нажмите на нужное здание. Точку подтверждаете вы."),
    );
    window.VSGI18n.text(
      $("#picked-coordinates"),
      tr("Выберите точку на карте"),
    );
    $("#save-location").disabled = true;
    window.VSGI18n.text($("#location-error"), "");
    $("#location-dialog").showModal();
    if (!picker) {
      picker = createMap("location-map", 13);
      L.control.zoom({ position: "topright" }).addTo(picker);
      for (const [selector, label] of [
        [".leaflet-control-zoom-in", "Приблизить карту"],
        [".leaflet-control-zoom-out", "Отдалить карту"],
      ]) {
        const control = $(selector, $("#location-map"));
        window.VSGI18n.attr(control, "title", tr(label));
        window.VSGI18n.attr(control, "aria-label", tr(label));
      }
      tiles(picker, $("#picker-tile-notice"));
      picker.on("click", (event) =>
        choose({ latitude: event.latlng.lat, longitude: event.latlng.lng }),
      );
    }
    if (pickerMarker) {
      picker.removeLayer(pickerMarker);
      pickerMarker = null;
    }
    picker.invalidateSize();
    picker.setView(
      valid(point) ? [point.latitude, point.longitude] : center,
      valid(point) ? 17 : 13,
    );
    if (valid(point)) choose(point);
    requestAnimationFrame(() => picker.invalidateSize());
    $("#location-search").focus();
  }

  async function search() {
    const query = $("#location-search").value.trim();
    if (query.length < 3) {
      window.VSGI18n.text(
        $("#location-search-status"),
        tr("Введите улицу и номер дома."),
      );
      return;
    }
    if (Date.now() - lastSearch < 1200) return;
    lastSearch = Date.now();
    const request = ++searchRequest;
    searchController?.abort();
    searchController = new AbortController();
    const controller = searchController;
    const timeout = setTimeout(() => controller.abort(), 12000);
    $("#location-search-button").disabled = true;
    $("#location-results").replaceChildren();
    window.VSGI18n.text(
      $("#location-search-status"),
      tr("Ищем адрес в Астане…"),
    );
    try {
      let results = searchCache.get(query);
      if (!results) {
        const url = new URL("https://photon.komoot.io/api/");
        url.search = new URLSearchParams({
          q: `Астана ${query}`,
          lat: "51.14",
          lon: "71.43",
          limit: "6",
        });
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("search unavailable");
        const data = await response.json();
        results = (data.features || [])
          .map((feature) => {
            const p = feature.properties || {};
            return {
              longitude: Number(feature.geometry?.coordinates?.[0]),
              latitude: Number(feature.geometry?.coordinates?.[1]),
              label: [
                ...new Set(
                  [
                    p.name,
                    [p.street, p.housenumber].filter(Boolean).join(" "),
                    p.district,
                    p.city,
                  ].filter(Boolean),
                ),
              ].join(", "),
            };
          })
          .filter((point) => valid(point) && point.label);
        searchCache.set(query, results);
      }
      if (request !== searchRequest) return;
      for (const point of results) {
        const button = document.createElement("button");
        button.type = "button";
        window.VSGI18n.text(button, point.label);
        button.addEventListener("click", () => {
          choose(point);
          picker.setView([point.latitude, point.longitude], 18);
        });
        $("#location-results").append(button);
      }
      window.VSGI18n.text(
        $("#location-search-status"),
        results.length
          ? tr("Выберите подходящий результат и проверьте здание на карте.")
          : tr(
              "Адрес не найден. Попробуйте другое написание или поставьте точку на карте вручную.",
            ),
      );
    } catch {
      if (request === searchRequest)
        window.VSGI18n.text(
          $("#location-search-status"),
          tr("Поиск адресов недоступен. Можно выбрать место кликом по карте."),
        );
    } finally {
      clearTimeout(timeout);
      if (request === searchRequest)
        $("#location-search-button").disabled = false;
    }
  }

  function init() {
    if (!cloudMode) return;
    $("#map-plane").hidden = true;
    $("#real-map").hidden = false;
    $("#location-fields").hidden = false;
    window.VSGI18n.text($(".map-city > span"), "OPENSTREETMAP");
    $(".map-credit").hidden = true;
    $("#map-view").classList.add("has-real-map");
    window.VSGI18n.attr(
      $("#map-view"),
      "aria-label",
      tr("Карта проверок в Астане. Перемещайте карту и меняйте масштаб."),
    );
    if (!window.L) {
      window.VSGI18n.text(
        $("#map-tile-notice"),
        tr(
          "Карта не загрузилась. Обновите страницу. Отчёты доступны в списке.",
        ),
      );
      $("#map-tile-notice").hidden = false;
      return;
    }
    map = createMap("real-map");
    layer = L.layerGroup().addTo(map);
    map.on("zoomend", () => {
      $("#zoom-in").disabled = map.getZoom() >= 19;
      $("#zoom-out").disabled = map.getZoom() <= 10;
    });
    tiles(map, $("#map-tile-notice"));
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(
      $("#map-view"),
    );
    $("#fit-map").hidden = false;
    $("#fit-map").addEventListener("click", () => fit());
    $("#choose-location").addEventListener("click", () =>
      openPicker(
        draft,
        selectedStore()?.address || $("#store-address").value,
        async (point) => updateDraft(point),
      ),
    );
    $("#store-address").addEventListener("input", () => updateDraft(null));
    $("#clear-location").addEventListener("click", () => updateDraft(null));
    $("#close-location").addEventListener("click", () =>
      $("#location-dialog").close(),
    );
    $("#location-dialog").addEventListener("close", () => {
      ++searchRequest;
      searchController?.abort();
      $("#location-search-button").disabled = false;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    $("#location-search-button").addEventListener("click", search);
    $("#location-search").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        search();
      }
    });
    $("#save-location").addEventListener("click", async () => {
      if (!valid(picked)) return;
      const button = $("#save-location");
      button.disabled = true;
      window.VSGI18n.text($("#location-error"), "");
      try {
        await onSave({ ...picked });
        $("#location-dialog").close();
      } catch (error) {
        window.VSGI18n.text(
          $("#location-error"),
          error?.code === "PGRST202"
            ? tr(
                "Для сохранения точки выполните real-map.sql в SQL Editor проекта Supabase.",
              )
            : tr(
                "Не удалось сохранить место. Проверьте подключение и повторите попытку.",
              ),
        );
      } finally {
        button.disabled = false;
      }
    });
  }

  return {
    init,
    render,
    fit,
    valid,
    syncDraft,
    restoreDraft: updateDraft,
    reset: () => updateDraft(null),
    value: () => (draft ? { ...draft } : null),
    zoom: (step) => {
      if (map) {
        map.setZoom(map.getZoom() + step);
        $("#zoom-in").disabled = map.getZoom() >= 19;
        $("#zoom-out").disabled = map.getZoom() <= 10;
      }
    },
    editReport: (report, save) => openPicker(report, report.address, save),
  };
})();
