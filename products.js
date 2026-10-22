"use strict";
window.VSGProducts = (() => {
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Almaty",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const days = (check, expiry) =>
    Math.round(
      (Date.parse(check + "T00:00:00Z") - Date.parse(expiry + "T00:00:00Z")) /
        86400000,
    );
  const label = (check, expiry) =>
    !check
      ? "Укажите дату проверки"
      : !expiry
        ? "Срок требует уточнения"
        : days(check, expiry) > 0
          ? `Просрочено на ${days(check, expiry)} дн. на дату проверки`
          : days(check, expiry) === 0
            ? "Срок истекает в день проверки"
            : "Срок на дату проверки не истёк";
  function value() {
    return {
      checkedDate: $("#checked-date").value,
      products: $$(".product-row").map((row) => ({
        name: $(".product-name", row).value.trim(),
        quantity: Number($(".product-quantity", row).value),
        expiry: $(".product-unknown", row).checked
          ? null
          : $(".product-expiry", row).value,
        photo_index:
          $(".product-photo", row).value === ""
            ? null
            : Number($(".product-photo", row).value),
      })),
    };
  }
  function add(item = {}) {
    if ($$(".product-row").length >= 20) return;
    const row = document.createElement("fieldset");
    row.className = "product-row";
    row.innerHTML = `<legend>Товар ${$$(".product-row").length + 1}</legend><label>Название<input class="text-input product-name" required maxlength="120" placeholder="Йогурт, марка, объём"></label><div class="product-grid"><label>Количество упаковок<input type="number" class="text-input product-quantity" min="1" max="9999" step="1" required value="1"></label><label>Годен до<input type="date" class="text-input product-expiry" required min="1900-01-01" max="2200-12-31"></label></div><label class="product-unknown-label"><input type="checkbox" class="product-unknown"> Дата не читается / срок указан иначе</label><label>Фото маркировки<select class="text-input product-photo" required></select></label><p class="product-calculation"></p><button type="button" class="remove-product">Убрать товар</button>`;
    $(".product-name", row).value = String(item.name || "").slice(0, 120);
    $(".product-quantity", row).value = item.quantity ?? 1;
    $(".product-expiry", row).value = item.expiry || "";
    $(".product-unknown", row).checked = item.expiry === null;
    $("#product-list").append(row);
    photos();
    $(".product-photo", row).value =
      item.photo_index == null ? "" : String(item.photo_index);
    update();
  }
  function photos() {
    for (const row of $$(".product-row")) {
      const select = $(".product-photo", row),
        old = select.value;
      select.innerHTML =
        '<option value="">Выберите загруженное фото</option>' +
        pendingPhotos
          .map(
            (p, i) =>
              `<option value="${i}">Фото ${i + 1}: ${escapeHTML(p.name)}</option>`,
          )
          .join("");
      select.value = old;
    }
  }
  function update() {
    $("#add-product").disabled = $$(".product-row").length >= 20;
    let index = 0;
    for (const row of $$(".product-row")) {
      $("legend", row).textContent = `Товар ${++index}`;
      const unknown = $(".product-unknown", row).checked;
      $(".product-expiry", row).disabled = unknown;
      $(".product-expiry", row).required = !unknown;
      $(".product-calculation", row).textContent = label(
        $("#checked-date").value,
        unknown ? null : $(".product-expiry", row).value,
      );
    }
  }
  function restore(data) {
    $("#checked-date").value = data?.checkedDate || today();
    $("#product-list").replaceChildren();
    for (const item of (Array.isArray(data?.products)
      ? data.products
      : []
    ).slice(0, 20))
      if (item && typeof item === "object") add(item);
    update();
  }
  function render(report, historyKey) {
    if (!report.products?.length) return "";
    const date = report.checkedDate || String(report.date).slice(0, 10);
    return `<section class="reported-products"><h3>Товары на дату проверки ${escapeHTML(date)}</h3>${report.products.map((p) => `<article><strong>${escapeHTML(p.name)}</strong><p>${Number(p.quantity)} уп. · ${p.expiry ? "Годен до " + escapeHTML(p.expiry) : "Дата не читается / срок указан иначе"}</p><p>${escapeHTML(label(date, p.expiry))}</p>${p.evidence_unavailable ? "<small>Фото маркировки временно недоступно</small>" : ""}${p.photo_index != null && imageURL(report.photos?.[p.photo_index]) ? `<button type="button" class="product-evidence" ${historyKey ? `data-history-report="${escapeHTML(historyKey)}" data-history-photo="${Number(p.photo_index)}"` : `data-photo-index="${Number(p.photo_index)}"`}><img src="${escapeHTML(imageURL(report.photos[p.photo_index]))}" alt="Маркировка: ${escapeHTML(p.name)}" loading="lazy"><span>Фото маркировки ${Number(p.photo_index) + 1} ↗</span></button>` : ""}</article>`).join("")}</section>`;
  }
  function init() {
    $("#checked-date").max = today();
    restore();
    $("#add-product").addEventListener("click", () => {
      add();
      window.VSGDrafts?.changed();
    });
    $("#product-list").addEventListener("click", (event) => {
      if (event.target.closest(".remove-product")) {
        event.target.closest(".product-row").remove();
        update();
        window.VSGDrafts?.changed();
      }
    });
    $("#report-form").addEventListener("input", update);
    $("#report-form").addEventListener("change", update);
  }
  return {
    init,
    value,
    restore,
    photos,
    render,
    days,
    hasContent: () =>
      !!$$(".product-row").length || $("#checked-date").value !== today(),
  };
})();
