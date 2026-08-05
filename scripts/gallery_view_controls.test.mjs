import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const galleryJs = read("photo-gallery.js");
const photosCss = read("photos.css");
const galleryHtml = read("gallery.html");
const photosJs = read("photos.js");

test("gallery density uses a two-button stepper instead of a range slider", () => {
  assert.match(galleryJs, /data-gallery-density-step="1"[^\n]*>\s*<span aria-hidden="true">−<\/span>/);
  assert.match(galleryJs, /data-gallery-density-step="-1"[^\n]*>\s*<span aria-hidden="true">\+<\/span>/);
  assert.match(galleryJs, /stepGalleryDensity\(Number\(button\.dataset\.galleryDensityStep/);
  assert.doesNotMatch(galleryJs, /data-gallery-density\/>/);
  assert.match(photosCss, /\.gallery-density-stepper button \+ button/);
});

test("fit and fill remain standard actions in one segmented pill", () => {
  assert.match(galleryJs, /gallery-fit-control gallery-fit-split/);
  assert.match(galleryJs, /data-gallery-fit-mode="fit"/);
  assert.match(galleryJs, /data-gallery-fit-mode="fill"/);
  assert.match(photosCss, /\.gallery-fit-control\.gallery-fit-split button \+ button/);
  assert.match(photosCss, /\.gallery-fit-control\.gallery-fit-split button\[aria-pressed="true"\]/);
});

test("gallery view and buyer actions share a dedicated row below content-width breadcrumbs", () => {
  assert.match(galleryJs, /gallery-view-controls is-header-mounted/);
  assert.match(galleryJs, /headerControls\.prepend\(viewControls\)/);
  assert.match(galleryJs, /document\.body\.append\(topButton\)/);
  assert.match(photosCss, /body\[data-gallery\] \.version-switch,[\s\S]*?width:max-content;/);
  assert.match(photosCss, /body\[data-gallery\] \.header-controls,[\s\S]*?flex:1 1 100%;[\s\S]*?width:100%;/);
  assert.match(photosCss, /header-controls > \.gallery-view-controls\.is-header-mounted[\s\S]*?order:1;[\s\S]*?width:auto;/);
  assert.match(photosCss, /header-controls > \.header-action-links[\s\S]*?order:2;/);
  assert.match(photosCss, /grid-template-areas:\s*"back brand breadcrumbs spacer utilities"\s*"\. \. \. actions actions"/);
  assert.match(photosCss, /grid-template-areas:\s*"back brand utilities"\s*"breadcrumbs breadcrumbs breadcrumbs"\s*"\. actions actions"/);
  assert.match(photosCss, /\.version-switch,[\s\S]*?grid-area:breadcrumbs;/);
  assert.match(photosCss, /\.header-controls,[\s\S]*?grid-area:actions;/);
  assert.match(photosCss, /\.header-utility-controls,[\s\S]*?grid-area:utilities;/);
  assert.match(photosCss, /@media \(max-width:480px\)[\s\S]*?data-account-entry-signup[\s\S]*?display:none;/);
});

test("density buttons expose localized accessible names and boundary states", () => {
  assert.match(galleryJs, /a11y\.gallery_density_decrease/);
  assert.match(galleryJs, /a11y\.gallery_density_increase/);
  assert.match(photosJs, /'a11y\.gallery_density_decrease': 'Zoom out'/);
  assert.match(photosJs, /'a11y\.gallery_density_increase': 'Zoom in'/);
  assert.match(galleryJs, /columns <= 1/);
  assert.match(galleryJs, /columns >= maxDensityColumns\(\)/);
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
