"use strict";

// Interface translations only. Report contents and addresses are always parameters,
// never translation keys. Bindings update text in place without rebuilding forms.
window.VSGI18n = (() => {
  const storageKey = "vsg-interface-language";
  let language = "ru";
  try {
    if (localStorage.getItem(storageKey) === "kk") language = "kk";
  } catch {
    /* Language switching also works when browser storage is blocked. */
  }
  const bindings = new WeakMap();
  const attributes = ["aria-label", "placeholder", "alt", "title", "content"];
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const missing = new Set();
  class Message {
    constructor(key, values = [], kind = "text") {
      this.key = key;
      this.values = values;
      this.kind = kind;
    }
    toString() {
      return format(this);
    }
    toJSON() {
      return {
        vsgMessage: true,
        key: this.key,
        values: this.values,
        kind: this.kind,
      };
    }
  }
  function format(value) {
    if (!(value instanceof Message) && !value?.vsgMessage)
      return String(value ?? "");
    if (value.kind === "date") {
      const options = value.values[1],
        date = new Date(value.values[0]);
      if (language === "kk" && options.month === "long") {
        // Some browsers ship incomplete Kazakh month names (e.g. "M10").
        // Keep the Astana timezone calculation in Intl and supply native names.
        const parts = new Intl.DateTimeFormat("en-GB", {
          ...options,
          month: "numeric",
        }).formatToParts(date);
        const part = (name) => parts.find((item) => item.type === name)?.value;
        const months = [
          "қаңтар",
          "ақпан",
          "наурыз",
          "сәуір",
          "мамыр",
          "маусым",
          "шілде",
          "тамыз",
          "қыркүйек",
          "қазан",
          "қараша",
          "желтоқсан",
        ];
        return `${part("day")} ${months[Number(part("month")) - 1]} ${part("year")} ж.`;
      }
      return new Intl.DateTimeFormat(locale(), options).format(date);
    }
    if (value.kind === "number")
      return Number(value.values[0]).toLocaleString(locale());
    if (value.kind === "join") return value.values.map(format).join(value.key);
    const key = normalize(value.key);
    const translated = window.VSG_KK?.[key];
    if (/[А-Яа-яЁё]/.test(key) && translated === undefined) missing.add(key);
    const pattern =
      language === "kk" && translated !== undefined
        ? (value.key.match(/^\s*/)?.[0] || "") +
          translated +
          (value.key.match(/\s*$/)?.[0] || "")
        : value.key;
    return pattern.replace(/\{(\d+)\}/g, (_, index) =>
      format(value.values[Number(index)]),
    );
  }
  function tr(key, ...values) {
    if (Array.isArray(key) && Object.hasOwn(key, "raw"))
      return new Message(
        key.reduce((out, part, i) => out + (i ? `{${i - 1}}` : "") + part, ""),
        values,
      );
    return key instanceof Message ? key : new Message(key, values);
  }
  function locale() {
    return language === "kk" ? "kk-KZ" : "ru-RU";
  }
  function bind(node, property, value) {
    if (!node) return;
    let record = bindings.get(node);
    if (!record) {
      record = {};
      bindings.set(node, record);
    }
    record[property] = value;
    if (node.nodeType === Node.ELEMENT_NODE)
      node.setAttribute("data-i18n-bound", "");
    if (property === "textContent") node.textContent = format(value);
    else node.setAttribute(property, format(value));
  }
  const text = (node, value) => bind(node, "textContent", value);
  const attr = (node, property, value) => bind(node, property, value);
  function option(label, value) {
    const node = new Option("", value);
    text(node, label);
    return node;
  }
  const appendText = (node, value) =>
    text(
      node,
      new Message(
        "",
        [bindings.get(node)?.textContent ?? node.textContent, value],
        "join",
      ),
    );
  function encode(value) {
    return btoa(
      Array.from(new TextEncoder().encode(JSON.stringify(value)), (byte) =>
        String.fromCharCode(byte),
      ).join(""),
    );
  }
  function decode(value) {
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
      ),
    );
  }
  const decodeText = (value) => {
    const node = document.createElement("textarea");
    node.innerHTML = value;
    return node.value;
  };
  function html(strings, ...values) {
    const template = document.createElement("template");
    template.innerHTML = strings.reduce((out, part, i) => {
      if (!i) return part;
      const open = out.lastIndexOf("<") > out.lastIndexOf(">");
      const inside = out.slice(out.lastIndexOf("<") + 1);
      const quoted = [...inside.matchAll(/["']/g)].length % 2;
      // A conditional attribute is trusted markup supplied by the calling template.
      return (
        out +
        (open && !quoted ? String(values[i - 1] ?? "") : `vsgslot${i - 1}end`) +
        part
      );
    }, "");
    const slot = /vsgslot(\d+)end/g;
    function recipe(source) {
      const params = [];
      const key = source.replace(slot, (_, id) => {
        const value = values[Number(id)];
        params.push(
          value instanceof Message ? value : decodeText(String(value ?? "")),
        );
        return `{${params.length - 1}}`;
      });
      return new Message(key, params);
    }
    const walker = document.createTreeWalker(
      template.content,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const record = {};
        for (const name of attributes) {
          const source = node.getAttribute(name);
          if (
            source &&
            (/[А-Яа-яЁё]/.test(source) ||
              [...source.matchAll(slot)].some(
                (m) => values[Number(m[1])] instanceof Message,
              ))
          ) {
            record[name] = recipe(source);
            node.setAttribute(name, format(record[name]));
          }
        }
        if (Object.keys(record).length)
          node.setAttribute("data-i18n-attrs", encode(record));
        continue;
      }
      // Markup interpolations (icons, badges, nested cards) stay markup. Only
      // interface text and plain parameters become translatable text bindings.
      const pieces = node.data.split(/(vsgslot\d+end)/);
      let segment = "";
      const fragments = [];
      const flush = () => {
        if (!segment) return;
        const message = recipe(segment);
        const localized =
          /[А-Яа-яЁё]/.test(segment) ||
          message.values.some((v) => v instanceof Message);
        if (localized) {
          fragments.push(
            `<!--vsg-i18n:${encode(message)}-->${escape(format(message))}<!--/vsg-i18n-->`,
          );
        } else fragments.push(segment);
        segment = "";
      };
      for (const piece of pieces) {
        const match = /^vsgslot(\d+)end$/.exec(piece);
        const value = match && values[Number(match[1])];
        if (
          match &&
          !(value instanceof Message) &&
          /<[a-z/!]/i.test(String(value))
        ) {
          flush();
          fragments.push(piece);
        } else segment += piece;
      }
      flush();
      if (fragments.some((f) => f.includes("<!--vsg-i18n:"))) {
        // Options may contain text only; keep their recipe on the option itself.
        if (["OPTION", "TITLE"].includes(node.parentElement?.tagName)) {
          const message = recipe(node.data);
          node.parentElement.setAttribute("data-i18n-text", encode(message));
          node.data = format(message);
        } else {
          const fragment = document.createElement("template");
          fragment.innerHTML = fragments.join("");
          node.replaceWith(fragment.content);
        }
      }
    }
    return template.innerHTML.replace(slot, (_, id) =>
      String(values[Number(id)] ?? ""),
    );
  }
  function refresh() {
    document.documentElement.lang = language;
    const walker = document.createTreeWalker(
      document,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_ELEMENT,
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const record = bindings.get(node);
      if (record)
        for (const [property, value] of Object.entries(record)) {
          if (property === "textContent") node.textContent = format(value);
          else node.setAttribute(property, format(value));
        }
      if (
        node.nodeType === Node.COMMENT_NODE &&
        node.data.startsWith("vsg-i18n:")
      ) {
        const next = node.nextSibling;
        const value = format(decode(node.data.slice(9)));
        if (next?.nodeType === Node.TEXT_NODE) next.data = value;
        else node.after(document.createTextNode(value));
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.hasAttribute("data-i18n-text"))
          node.textContent = format(
            decode(node.getAttribute("data-i18n-text")),
          );
        if (node.hasAttribute("data-i18n-attrs"))
          for (const [name, value] of Object.entries(
            decode(node.getAttribute("data-i18n-attrs")),
          ))
            node.setAttribute(name, format(value));
      }
    }
    for (const button of document.querySelectorAll("[data-language]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.language === language),
      );
  }
  function setLanguage(next) {
    if (!["ru", "kk"].includes(next)) return;
    language = next;
    try {
      localStorage.setItem(storageKey, language);
    } catch {
      /* Optional preference storage. */
    }
    refresh();
    window.dispatchEvent(new Event("vsg:languagechange"));
  }
  function init() {
    // Only the original HTML is scanned. Later user content is never matched
    // against the dictionary, even if it happens to equal an interface label.
    const walker = document.createTreeWalker(
      document,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (
        node.parentElement?.closest(
          "script, style, svg, [data-language], [data-i18n-skip]",
        )
      )
        continue;
      if (node.nodeType === Node.TEXT_NODE && /[А-Яа-яЁё]/.test(node.data)) {
        const source = node.data;
        bind(node, "textContent", tr(source));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (const name of attributes) {
          const source = node.getAttribute(name);
          if (source && /[А-Яа-яЁё]/.test(source)) attr(node, name, tr(source));
        }
      }
    }
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-language]");
      if (button) setLanguage(button.dataset.language);
    });
    refresh();
  }
  return {
    tr,
    html,
    text,
    attr,
    option,
    appendText,
    setLanguage,
    locale,
    init,
    refresh,
    isMessage: (value) => value instanceof Message,
    date: (value, options) => new Message("", [value, options], "date"),
    number: (value) => new Message("", [value], "number"),
    join: (values, separator = " ") => new Message(separator, values, "join"),
    get language() {
      return language;
    },
    missing,
  };
})();
const tr = window.VSGI18n.tr;
const html = window.VSGI18n.html;
window.VSGI18n.init();
