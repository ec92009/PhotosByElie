import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const galleryJs = read("photo-gallery.js");
const photosCss = read("photos.css");
const galleryHtml = read("gallery.html");
const photosJs = read("photos.js");
const detailJs = read("photo-detail.js");
const { GROUP_ORDER, MAX_SELECTION, createRegistry, matchesKeyboardShortcut } = createRequire(import.meta.url)("../gallery-commands.js");

test("command registry keeps role gating, stable group order, and disabled positions", () => {
  let role = "visitor";
  let selected = 0;
  const registry = createRegistry({
    getContext: () => ({ role, surface: "gallery", workflow: "gallery", selected }),
    commands: [
      { id: "workflow", roles: ["owner"], surfaces: ["gallery"], group: "workflow", order: 1, label: "Owner workflow" },
      { id: "preview", roles: ["visitor", "owner"], surfaces: ["gallery"], group: "view", order: 1, label: "Preview" },
      {
        id: "clear", roles: ["visitor", "owner"], surfaces: ["gallery"], group: "selection", order: 1, label: "Clear",
        state: (context) => ({ enabled: context.selected > 0, disabledReason: "Nothing selected." }),
      },
    ],
  });

  assert.deepEqual(GROUP_ORDER, ["selection", "view", "rating-color", "workflow"]);
  assert.equal(MAX_SELECTION, 500);
  assert.deepEqual(registry.list().map((command) => command.id), ["clear", "preview"]);
  assert.equal(registry.command("clear").enabled, false);
  assert.equal(registry.command("clear").disabledReason, "Nothing selected.");

  role = "owner";
  selected = 1;
  assert.deepEqual(registry.list().map((command) => command.id), ["clear", "preview", "workflow"]);
});

test("buttons and keyboard dispatch the same command execution path", async () => {
  const sources = [];
  const registry = createRegistry({
    commands: [{
      id: "like", roles: ["visitor"], surfaces: ["gallery"], group: "workflow", label: "Like", shortcut: "l",
      execute: (_context, metadata) => sources.push(metadata.source),
    }],
  });
  await registry.dispatch("like", { source: "button" });
  await registry.dispatchKeyboard({ key: "l", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false });
  assert.deepEqual(sources, ["button", "keyboard"]);
  assert.equal(matchesKeyboardShortcut(
    { key: "a", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
    { key: "a", primary: true },
  ), true);
  assert.equal(matchesKeyboardShortcut(
    { key: "a", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
    { key: "a", primary: true },
  ), false);
});

test("contextual gallery bar replaces the passive hint and owns view commands", () => {
  assert.ok(galleryHtml.indexOf("gallery-commands.js") < galleryHtml.indexOf("photo-gallery.js"));
  assert.match(galleryJs, /galleryCommandModel\.createRegistry/);
  assert.match(galleryJs, /data-gallery-command=/);
  assert.match(galleryJs, /galleryCommandRegistry\.dispatch\(button\.dataset\.galleryCommand/);
  assert.match(galleryJs, /galleryCommandRegistry\.commandForKeyboard\(event\)/);
  assert.match(galleryJs, /id: "density-more"/);
  assert.match(galleryJs, /id: "density-less"/);
  assert.match(galleryJs, /id: "fit-fill"/);
  assert.doesNotMatch(galleryJs, /data-gallery-shortcut-hint/);
  assert.doesNotMatch(galleryHtml, /data-owner-cull-touch-actions/);
  assert.match(photosCss, /\.gallery-command-bar\{[\s\S]*position:fixed;[\s\S]*var\(--fixed-header-offset/);
  assert.match(photosCss, /\.gallery-command-scroll\{[\s\S]*overflow-x:auto;/);
  assert.match(photosCss, /html\[data-gallery-action-labels="true"\] \.gallery-command-label/);
  assert.match(photosCss, /html\.is-tap-first \.gallery-command-shortcut/);
  assert.match(galleryJs, /document\.body\.append\(topButton\)/);
});

test("selection, round-trip state, and Quick Look follow the integrated contract", () => {
  assert.match(galleryJs, /data-gallery-select-photo/);
  assert.match(galleryJs, /class="gallery-card-selection"/);
  assert.match(galleryJs, /const selectionLimit = galleryCommandModel\.MAX_SELECTION/);
  assert.match(galleryJs, /id: "clear-selection"[\s\S]*roles: \["visitor"\]/);
  assert.match(galleryJs, /id: "keep-primary"[\s\S]*roles: \["owner"\]/);
  assert.match(galleryJs, /ownerCullingEnabled && selectedPhotoIds\.size === 1/);
  assert.match(galleryJs, /navigationNonce: detailRoundTripNonce/);
  assert.match(galleryJs, /selectionIds: \[\.\.\.selectedPhotoIds\]/);
  assert.match(galleryJs, /const selectedNavigation = selectedItems\.length > 1/);
  assert.match(galleryJs, /wrapNavigation: selectedNavigation/);
  assert.match(galleryJs, /navigationKind: selectedNavigation \? "selected" : "loaded"/);
  assert.match(galleryJs, /restoreFocus: \(\) =>/);
  assert.match(galleryJs, /commandButton \|\| cardButton/);
  assert.match(galleryJs, /id: "toggle-selection"[\s\S]*shortcut: "s"/);
  assert.match(detailJs, /selectionIds: Array\.isArray\(payload\?\.selectionIds\)/);
  assert.match(detailJs, /navigationNonce: payload\?\.navigationNonce/);
  assert.match(photosJs, /data-finder-preview-key-legend/);
  assert.match(photosJs, /data-finder-preview-fit/);
  assert.match(photosJs, /wrapNavigation/);
  assert.match(photosJs, /window\.setTimeout\(\(\) => keyLegend\.classList\.remove\("is-visible"\), 4000\)/);
  assert.match(photosJs, /dispatchQuickLookCommand/);
  assert.match(photosJs, /close\(\{ restoreFocus: false \}\)/);
  assert.match(photosJs, /returnFocus\?\.isConnected/);
  assert.match(photosJs, /showQuickLookKeyLegend/);
  assert.match(photosCss, /\.finder-preview-key-legend/);
  assert.match(photosCss, /\.detail-fullscreen-preview\.is-fill-preview/);
});

test("search and filter changes keep the filter controls in view", () => {
  const filterControls = galleryJs.slice(
    galleryJs.indexOf("filterBar.addEventListener(\"change\""),
    galleryJs.indexOf("reviewVisibleButton = filterBar.querySelector"),
  );
  assert.ok(
    (filterControls.match(/renderGallery\(\{ scrollSelection: false \}\);/g)?.length || 0) >= 3,
  );

  const emptyFilterReset = galleryJs.slice(
    galleryJs.indexOf("data-clear-gallery-empty"),
    galleryJs.indexOf("if (moreButton) moreButton.hidden = true", galleryJs.indexOf("data-clear-gallery-empty")),
  );
  assert.match(emptyFilterReset, /renderGallery\(\{ scrollSelection: false \}\);/);
});

test("gallery date filters use inline DD MMM YYYY controls", () => {
  assert.match(galleryJs, /data-gallery-date-part="\$\{part\}"/);
  assert.match(galleryJs, /gallery-date-\$\{part\}/);
  assert.match(galleryJs, /inlineDatePickerPartOrder/);
  assert.match(galleryJs, /dateLocale\(\)\.startsWith\("en"\)/);
  assert.match(galleryJs, /inlineDatePickerMonthLabel[\s\S]*\.toUpperCase\(\)/);
  assert.match(galleryJs, /gallery-date-select/);
  assert.match(galleryJs, /yearsFromPhotos/);
  assert.match(galleryJs, /dateValueFromParts/);
  assert.match(galleryJs, /normalizeRange/);
  assert.match(photosCss, /\.gallery-date-control/);
  assert.match(photosCss, /\.gallery-date-select/);
});

test("gallery filter bar omits removed advanced filters and batch review", () => {
  assert.doesNotMatch(galleryJs, /data-gallery-filter="minSize"/);
  assert.doesNotMatch(galleryJs, /data-gallery-filter="mood"/);
  assert.doesNotMatch(galleryJs, /data-gallery-filter="subject"/);
  assert.doesNotMatch(galleryJs, /data-owner-review-visible/);
  assert.doesNotMatch(galleryJs, /Review all visible/);
});

test("gallery date picker preserves URL and persisted date contracts", () => {
  assert.match(galleryJs, /queryDate\(\["dateFrom", "date_from", "from"\]\)/);
  assert.match(galleryJs, /localStorage\.getItem\(filterStateKey\)/);
  assert.match(galleryJs, /normalizeDateFilterState/);
  assert.match(galleryJs, /history\.replaceState/);
  assert.match(galleryJs, /dateFrom:\s*"",\s*dateTo:\s*""/);
});

test("date picker wiring stays keyboard- and localization-aware", () => {
  assert.ok(galleryHtml.indexOf("gallery-date-picker.js") < galleryHtml.indexOf("photo-gallery.js"));
  assert.match(galleryJs, /aria-label="\$\{escapeHtml\(\`\$\{t\(titleKey\)\} \$\{t\(\`gallery\.date_\$\{part\}\`\)\}\`\)\}"/);
  assert.match(galleryJs, /commitInlineDatePickerControl/);
  assert.match(galleryJs, /control\.dataset\.galleryDatePart/);
  for (const key of [
    "gallery.date_picker",
    "gallery.date_year",
    "gallery.any_year",
    "gallery.date_month",
    "gallery.any_month",
    "gallery.date_day",
    "gallery.any_day",
    "gallery.all_dates",
    "gallery.date_apply",
    "gallery.date_close",
    "gallery.date_range_swapped",
  ]) {
    const escaped = key.replaceAll(".", "\\.");
    assert.equal((photosJs.match(new RegExp(`['"]${escaped}['"]\\s*:`, "g")) || []).length, 3, `${key} should be localized in English, French, and Spanish`);
  }
});
