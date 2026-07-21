import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const locales = ["en", "zh_TW", "ja"];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test("locale message keys stay aligned", () => {
  const catalogs = Object.fromEntries(locales.map((locale) => [
    locale,
    readJson(`_locales/${locale}/messages.json`)
  ]));
  const expected = Object.keys(catalogs.en).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), expected, `${locale} keys differ from en`);
    for (const [key, entry] of Object.entries(catalogs[locale])) {
      assert.equal(typeof entry.message, "string", `${locale}.${key} must have a message`);
      assert.ok(entry.message.trim(), `${locale}.${key} must not be empty`);
    }
  }
});

test("all extension UI localization references exist", () => {
  const messages = readJson("_locales/en/messages.json");
  const sources = [
    "manifest.json",
    "popup/popup.html",
    "popup/popup.js",
    "onboarding/index.html",
    "onboarding/onboarding.js",
    "src/background.js",
    "src/content.js"
  ].map((file) => read(file)).join("\n");
  const keys = new Set();
  for (const match of sources.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) keys.add(match[1]);
  for (const match of sources.matchAll(/data-i18n(?:-title)?="([A-Za-z0-9_@]+)"/g)) keys.add(match[1]);
  for (const match of sources.matchAll(/\bmsg\("([A-Za-z0-9_@]+)"/g)) keys.add(match[1]);
  for (const key of keys) {
    assert.ok(messages[key], `Missing English message: ${key}`);
  }
});

test("extension UI source has no hard-coded Han text outside locale catalogs", () => {
  for (const file of [
    "manifest.json",
    "popup/popup.html",
    "popup/popup.js",
    "onboarding/index.html",
    "onboarding/onboarding.js",
    "src/background.js",
    "src/content.js"
  ]) {
    assert.doesNotMatch(read(file), /\p{Script=Han}/u, `${file} contains hard-coded Han text`);
  }
});

test("localized pages load the i18n helper before page scripts", () => {
  for (const file of ["popup/popup.html", "onboarding/index.html"]) {
    const html = read(file);
    assert.ok(html.indexOf("../src/i18n.js") < html.lastIndexOf(".js"), `${file} must load i18n first`);
  }
});
