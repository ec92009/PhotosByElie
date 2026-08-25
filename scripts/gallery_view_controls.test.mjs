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
const photoHtml = read("photo.html");
const photosJs = read("photos.js");
const detailJs = read("photo-detail.js");
const galleryCardJs = read("gallery-card.js");
const ownerSessionJs = read("pbe-owner-session.js");
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

test("Owner rating and color controls match the compact Backstage contract", () => {
  assert.match(galleryJs, /data-gallery-rating-slider/);
  assert.match(galleryJs, /role="slider"/);
  assert.match(galleryJs, /aria-valuemin="0" aria-valuemax="5"/);
  assert.match(galleryJs, /ratingFromPointer/);
  assert.match(galleryJs, /ratingSlider\.setPointerCapture/);
  assert.match(galleryJs, /event\.key === "Home" \? 0/);
  assert.match(galleryJs, /event\.key === "End" \? 5/);
  assert.match(galleryJs, /colorSwatchHtml/);
  assert.match(photosCss, /\.gallery-rating-slider\{/);
  assert.match(photosCss, /\.gallery-color-swatch\.is-red\{--owner-swatch:#ff453a\}/);
  assert.match(ownerSessionJs, /ownerState:[\s\S]*rating:[\s\S]*color:[\s\S]*placement:[\s\S]*editorial:/);
});

test("hosted PBE Owner removes Pick and keeps Review capability-gated", () => {
  const pickCommand = galleryJs.slice(
    galleryJs.indexOf('id: "pick"'),
    galleryJs.indexOf('id: "hide"'),
  );
  const reviewCommand = galleryJs.slice(
    galleryJs.indexOf('id: "review"'),
    galleryJs.indexOf('id: "waste-basket"'),
  );
  assert.match(pickCommand, /isPBEOwnerGallery[\s\S]*hidden: true/);
  assert.match(reviewCommand, /ownerCapabilityState\("review"\)/);
});

test("gallery cards bound native Owner preview bursts and retry transient failures", () => {
  assert.match(galleryCardJs, /loading="lazy" decoding="async"/);
  assert.match(galleryCardJs, /const ownerPreviewRetryDelays = \[250, 750, 1500\]/);
  assert.match(galleryCardJs, /source\.pathname\.startsWith\("\/__photosbyelie\/source-preview\/"\)/);
  assert.match(galleryCardJs, /source\.searchParams\.set\("retry", String\(retry \+ 1\)\)/);
  assert.match(galleryCardJs, /if \(retryOwnerPreview\(image\)\) return;/);
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

test("density changes update the grid without leaving a stale Grid status helper", () => {
  const densityMoreCommand = galleryJs.slice(
    galleryJs.indexOf('id: "density-more"'),
    galleryJs.indexOf('id: "density-less"'),
  );
  const densityLessCommand = galleryJs.slice(
    galleryJs.indexOf('id: "density-less"'),
    galleryJs.indexOf('id: "fit-fill"'),
  );
  assert.match(densityMoreCommand, /stepGalleryDensity\(1\)/);
  assert.match(densityLessCommand, /stepGalleryDensity\(-1\)/);
  assert.match(galleryJs, /galleryCommandRegistry\.dispatch\(button\.dataset\.galleryCommand/);
  assert.match(galleryJs, /galleryCommandRegistry\.commandForKeyboard\(event\)/);
  assert.doesNotMatch(galleryJs, /densityControl\.addEventListener\("click"/);
  assert.doesNotMatch(galleryJs, /if \(event\.key === "g" \|\| event\.key === "G"\)/);
  assert.doesNotMatch(densityMoreCommand, /setGalleryStatus|Grid /);
  assert.doesNotMatch(densityLessCommand, /setGalleryStatus|Grid /);
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

test("pagination anchors every append to the first new card and keeps it keyboard-reachable", () => {
  assert.match(galleryJs, /const paginationPhotoIdAtCurrentLimit = \(\) =>/);
  assert.match(galleryJs, /return photos\[visibleLimit\]\?\.id \|\| "";/);
  assert.match(galleryJs, /targetTop: controls\.getBoundingClientRect\(\)\.top/);
  assert.match(galleryJs, /top: Math\.max\(0, \(window\.scrollY \|\| 0\) \+ delta\)/);
  assert.match(galleryJs, /link\.focus\(\{ preventScroll: true \}\)/);
  assert.match(galleryJs, /new window\.ResizeObserver\(schedulePaginationAnchorRestore\)/);
  assert.doesNotMatch(galleryJs, /preserveScrollAfterRender/);

  const moreHandler = galleryJs.slice(
    galleryJs.indexOf('moreButton.addEventListener("click"'),
    galleryJs.indexOf('moreDoubleButton.addEventListener("click"'),
  );
  const remainingHandler = galleryJs.slice(
    galleryJs.indexOf('moreDoubleButton.addEventListener("click"'),
    galleryJs.indexOf('showAllButton.addEventListener("click"'),
  );
  for (const handler of [moreHandler, remainingHandler]) {
    assert.match(handler, /paginationPhotoIdAtCurrentLimit\(\)/);
    assert.match(handler, /beginPaginationAnchor\(anchorPhotoId\)/);
    assert.match(handler, /renderGallery\(\{ scrollSelection: false \}\);/);
    assert.match(handler, /schedulePaginationAnchorRestore\(\);/);
  }

  const showAllHandler = galleryJs.slice(galleryJs.indexOf('showAllButton.addEventListener("click"'));
  assert.match(showAllHandler, /setPaginationBusy\(true\)/);
  assert.match(showAllHandler, /beginPaginationAnchor\(anchorPhotoId, \{ focusEachRender: true \}\)/);
  assert.match(showAllHandler, /setPaginationBusy\(false\)/);
  assert.doesNotMatch(showAllHandler, /showAllButton\.blur\(\)/);
  assert.match(galleryHtml, /data-gallery-status aria-live="polite"/);
});

test("public gallery filter bar compacts every control without changing its markup contract", () => {
  const filterMarkupStart = galleryJs.indexOf("filterBar.innerHTML = `");
  const filterMarkupEnd = galleryJs.indexOf("`;", filterMarkupStart);
  const filterMarkup = galleryJs.slice(filterMarkupStart, filterMarkupEnd);
  assert.match(filterMarkup, /gallery-search-label/);
  assert.match(filterMarkup, /data-gallery-search/);
  assert.match(galleryJs, /datePickerControlMarkup\("dateFrom", "gallery\.date_from"\)/);
  assert.match(galleryJs, /datePickerControlMarkup\("dateTo", "gallery\.date_to"\)/);
  const dateMarkupStart = galleryJs.indexOf("const datePickerControlMarkup");
  const dateMarkupEnd = galleryJs.indexOf("const ensureGalleryFilterControls", dateMarkupStart);
  const dateMarkup = galleryJs.slice(dateMarkupStart, dateMarkupEnd);
  assert.match(dateMarkup, /gallery-date-label/);
  assert.match(dateMarkup, /gallery-date-control/);
  assert.doesNotMatch(filterMarkup, /data-gallery-filter="mediaType"/);
  assert.doesNotMatch(filterMarkup, />Media</);
  assert.doesNotMatch(filterMarkup, />All media</);
  assert.match(filterMarkup, /data-gallery-filter="orientation"/);
  assert.match(filterMarkup, /gallery-sort-label/);
  assert.match(filterMarkup, /data-gallery-filter="sort"/);
  assert.match(filterMarkup, /gallery-filter-clear/);
  assert.match(filterMarkup, /data-clear-gallery-filters/);

  const filterCssStart = photosCss.indexOf(".gallery-filter-bar{\n");
  const filterCssEnd = photosCss.indexOf(".gallery-filter-toggle", filterCssStart);
  const filterCss = photosCss.slice(filterCssStart, filterCssEnd);
  assert.match(filterCss, /--gallery-filter-control-size:34px;/);
  assert.match(filterCss, /column-gap:6px;[\s\S]*?row-gap:0;/);
  assert.match(filterCss, /margin-top:15px;/);
  assert.match(filterCss, /padding:15px;/);
  assert.match(photosCss, /grid-template-rows:auto var\(--gallery-filter-control-size\);/);
  assert.match(photosCss, /\.gallery-filter-bar label\{[\s\S]*?gap:1px;/);
  assert.match(photosCss, /\.gallery-filter-bar label > span\{[\s\S]*?min-height:1em;/);
  assert.match(photosCss, /flex:2 1 220px;[\s\S]*?max-width:340px;/);
  assert.match(photosCss, /flex:1 1 180px;[\s\S]*?max-width:230px;/);
  assert.match(photosCss, /height:var\(--gallery-filter-control-size\);[\s\S]*?min-height:var\(--gallery-filter-control-size\);/);
  assert.match(photosCss, /\.gallery-filter-bar select:focus-visible,[\s\S]*?outline:2px solid currentColor;/);

  const responsiveStart = photosCss.indexOf("  .gallery-filter-toggle{\n    display:inline-flex;");
  const responsiveCss = photosCss.slice(responsiveStart);
  assert.match(responsiveCss, /\.gallery-filter-bar\{\n    display:flex;\n  \}/);
  assert.match(responsiveCss, /\.gallery-filter-bar\.is-open\{\n    display:flex;\n  \}/);
  assert.match(responsiveCss, /\.gallery-filter-bar:not\(\.is-open\) > :not\(\.gallery-search-label\)\{\n    display:none;\n  \}/);
  assert.match(responsiveCss, /\.gallery-filter-bar:not\(\.is-open\) \.gallery-search-label\{\n    flex-basis:100%;[\s\S]*?\n  \}/);
  assert.doesNotMatch(responsiveCss, /\.gallery-filter-bar\{\n    display:none;\n  \}/);
  assert.match(responsiveCss, /\.gallery-filter-bar label,[\s\S]*?flex:1 1 calc\(50% - 6px\);/);
  assert.match(responsiveCss, /\.gallery-filter-bar label:has\(\.gallery-date-control\)[\s\S]*?flex-basis:100%;/);
  assert.match(responsiveCss, /\.gallery-filter-bar \.gallery-search-label,[\s\S]*?\.gallery-sort-label\{[\s\S]*?flex-basis:100%;/);
  assert.match(responsiveCss, /\.gallery-filter-clear\{\n    flex:1 1 100%;/);
});

test("primary search stays visible at and below the 760px secondary-filter breakpoint", () => {
  assert.match(galleryJs, /galleryFilterCollapseBreakpoint = 760;/);
  const toggleRuleStart = photosCss.indexOf("  .gallery-filter-toggle{\n    display:inline-flex;");
  const responsiveStart = photosCss.lastIndexOf("@media (max-width:760px){", toggleRuleStart);
  const responsiveEnd = photosCss.indexOf("@media ", responsiveStart + 10);
  const responsiveCss = photosCss.slice(responsiveStart, responsiveEnd === -1 ? undefined : responsiveEnd);
  assert.match(responsiveCss, /\.gallery-filter-toggle\{\n    display:inline-flex;/);
  assert.match(responsiveCss, /\.gallery-filter-bar\{\n    display:flex;/);
  assert.match(responsiveCss, /\.gallery-filter-bar:not\(\.is-open\) > :not\(\.gallery-search-label\)/);
  assert.match(responsiveCss, /\.gallery-filter-bar:not\(\.is-open\) \.gallery-search-label/);
  assert.match(photosCss, /\.gallery-filter-bar\{[\s\S]*?box-sizing:border-box;[\s\S]*?width:100%;[\s\S]*?max-width:100%;[\s\S]*?min-width:0;/);
  assert.match(responsiveCss, /\.gallery-filter-bar:not\(\.is-open\) \.gallery-search-label\{[\s\S]*?max-width:none;/);
});

test("filter disclosure keeps one canonical search state through URL, storage, clear, reload, and focus", () => {
  assert.match(galleryJs, /const persistedFilterKeys = \["query", "orientation", "dateFrom", "dateTo"\];/);
  assert.match(galleryJs, /const urlQueryKey = \["q", "search"\]\.find\(\(key\) => params\.has\(key\)\);/);
  assert.match(galleryJs, /query: urlQueryPresent \? urlQuery : persistedState\.query/);
  assert.match(galleryJs, /const syncSearchFilterUrl = \(state\) =>/);
  assert.match(galleryJs, /writeFilterState\(\);\n    syncSearchFilterUrl\(filterState\);\n    syncFilterToggle\(\);/);
  assert.match(galleryJs, /const label = t\("gallery\.filters"\);/);
  assert.match(galleryJs, /window\.addEventListener\("resize", syncFilterResponsiveFocus\);/);
  assert.match(galleryJs, /searchInput\.focus\(\{ preventScroll: true \}\)/);
  const filterMarkupStart = galleryJs.indexOf("filterBar.innerHTML = `");
  const filterMarkupEnd = galleryJs.indexOf("`;", filterMarkupStart);
  const filterMarkup = galleryJs.slice(filterMarkupStart, filterMarkupEnd);
  assert.equal((filterMarkup.match(/data-gallery-search/g) || []).length, 1);
  assert.equal((photosJs.match(/['"]gallery\.filters['"]\s*:/g) || []).length, 3);
});

test("public gallery retires Media state without changing the private generic filter engine", () => {
  assert.doesNotMatch(galleryJs, /data-gallery-filter="mediaType"/);
  assert.doesNotMatch(galleryJs, /persistedFilterKeys[^\n]*mediaType/);
  assert.doesNotMatch(galleryJs, /galleryFilterKeys[^\n]*mediaType/);
  assert.match(galleryJs, /\["q", "search", "mediaType", "media_type"\]\.forEach\(\(key\) => url\.searchParams\.delete\(key\)\)/);
  assert.match(galleryJs, /const publicFilterState = \(state = \{\}\) => Object\.fromEntries/);
  assert.match(galleryJs, /window\.photosByElieI18n\?\.apply\?\.\(\);\n  writeFilterState\(\);\n  syncFilterControls\(\);/);
  assert.match(galleryJs, /matchesPhoto\(photo, \{ \.\.\.filterState, mediaType: "all" \}/);
  assert.match(detailJs, /Object\.entries\(payload\.filterState\)\.filter\(\(\[key\]\) => !\["mediaType", "media_type"\]\.includes\(key\)\)/);
  assert.match(detailJs, /filterState: publicFilterState/);
  assert.match(photosJs, /window\.photosByEliePhotoFilter = \(\(\) => \{[\s\S]*const defaultState = \{[\s\S]*mediaType: 'all'/);
  assert.match(photosJs, /if \(filterState\.mediaType !== 'all'/);
  for (const key of ["gallery.media", "gallery.all_media"]) {
    const escaped = key.replaceAll(".", "\\.");
    assert.equal((photosJs.match(new RegExp(`['"]${escaped}['"]\\s*:`, "g")) || []).length, 0);
  }
});

test("detail round trips restore the loaded boundary and focus after click or double-click navigation", () => {
  assert.match(galleryJs, /visibleLimit: visibleLimit >= photos\.length \? "all" : visibleLimit/);
  assert.match(galleryJs, /pendingGalleryReturnState\?\.visibleLimit === "all"/);
  assert.match(galleryJs, /expandGalleryToIncludeIndex\(returnIndex\)/);
  assert.match(galleryJs, /restorePendingGalleryReturn\(\)/);
  assert.match(galleryJs, /card\.querySelector\("\[data-photo-link\]"\)\?\.focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(galleryJs, /card\.addEventListener\("dblclick"[\s\S]*window\.location\.assign/);
  assert.match(detailJs, /link\.addEventListener\("click", writeGalleryReturnState\)/);
  assert.match(detailJs, /visibleLimit: payload\?\.visibleLimit \|\| null/);
});

test("Back to top is body-mounted above the version pill with safe-area and reduced-motion support", () => {
  const headerControlsStart = photoHtml.indexOf('<div class="header-controls">');
  const headerControlsEnd = photoHtml.indexOf("</div>", headerControlsStart);
  assert.doesNotMatch(photoHtml.slice(headerControlsStart, headerControlsEnd), /data-header-back-to-top/);
  assert.match(photoHtml, /<\/header>\s*<button class="gallery-top-button floating-back-to-top"[^>]*data-header-back-to-top/);
  assert.match(galleryJs, /topButton\.className = "gallery-top-button floating-back-to-top"/);
  assert.match(galleryJs, /document\.body\.append\(topButton\)/);
  assert.match(photosCss, /\.floating-back-to-top\{[\s\S]*right:max\(12px,calc\(env\(safe-area-inset-right\) \+ 8px\)\);[\s\S]*safe-area-inset-bottom/);
  assert.match(photosCss, /main\.detail-main\.has-basket-rail > \.basket-rail\{\n    margin-bottom:62px;/);
  assert.ok(photosJs.indexOf("const backToTopButtons") < photosJs.indexOf("const syncFixedHeaderOffset"));
  assert.match(photosJs, /if \(button\.parentElement !== document\.body\) document\.body\.append\(button\)/);
  assert.match(photosJs, /backToTopButtons\.forEach[\s\S]*prefers-reduced-motion: reduce[\s\S]*behavior: prefersReducedMotion \? "auto" : "smooth"/);
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
