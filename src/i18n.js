(() => {
  if (globalThis.AnySubtitleI18n) {
    return;
  }

  function msg(key, substitutions, fallback = "") {
    const value = chrome.i18n.getMessage(key, substitutions);
    return value || fallback || key;
  }

  function localizeDocument(root = document) {
    const locale = msg("@@ui_locale", undefined, "en").replaceAll("_", "-");
    root.documentElement.lang = locale;
    for (const element of root.querySelectorAll("[data-i18n]")) {
      element.textContent = msg(element.dataset.i18n, undefined, element.textContent);
    }
    for (const element of root.querySelectorAll("[data-i18n-title]")) {
      element.title = msg(element.dataset.i18nTitle, undefined, element.title);
    }
  }

  globalThis.AnySubtitleI18n = { localizeDocument, msg };
})();
