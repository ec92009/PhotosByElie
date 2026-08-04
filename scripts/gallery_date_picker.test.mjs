import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "gallery-date-picker.js"), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const picker = sandbox.window.photosByElieGalleryDatePicker;
const photosSource = fs.readFileSync(path.join(root, "photos.js"), "utf8");
const filterStart = photosSource.indexOf("window.photosByEliePhotoFilter = (() => {");
const filterEnd = photosSource.indexOf("\n})();", filterStart);
const filterSandbox = { window: { photosByElieIsVideo: () => false } };
vm.runInNewContext(photosSource.slice(filterStart, filterEnd + "\n})();".length), filterSandbox);
const photoFilter = filterSandbox.window.photosByEliePhotoFilter;

test("year-first boundaries expand a year or month into an inclusive date", () => {
  assert.equal(picker.dateValueFromParts({ year: "2022" }, "start"), "2022-01-01");
  assert.equal(picker.dateValueFromParts({ year: "2022" }, "end"), "2022-12-31");
  assert.equal(picker.dateValueFromParts({ year: "2022", month: "02" }, "start"), "2022-02-01");
  assert.equal(picker.dateValueFromParts({ year: "2022", month: "02" }, "end"), "2022-02-28");
});

test("range parts can change multiple years in one apply", () => {
  assert.equal(JSON.stringify(
    picker.rangeValuesFromParts({
      dateFrom: { year: "2018" },
      dateTo: { year: "2024" },
    }),
  ), JSON.stringify({ dateFrom: "2018-01-01", dateTo: "2024-12-31" }));
});

test("exact dates remain compatible with the existing filter contract", () => {
  assert.equal(JSON.stringify(picker.partsFromDateValue("2022-12-10")), JSON.stringify({ year: "2022", month: "12", day: "10" }));
  assert.equal(picker.dateValueFromParts({ year: "2022", month: "12", day: "10" }, "start"), "2022-12-10");
  assert.equal(JSON.stringify(picker.partsFromDateValue("invalid")), JSON.stringify({ year: "", month: "", day: "" }));
});

test("date years are catalog-derived, unique, and newest first", () => {
  assert.equal(JSON.stringify(
    picker.yearsFromPhotos([
      { metadata: [{ label: "Captured", value: "2022:12:10 09:00:00" }] },
      { metadata: [{ label: "Captured", value: "2026:01:02 09:00:00" }] },
      { metadata: [{ label: "Captured", value: "2022:01:01 09:00:00" }] },
    ]),
  ), JSON.stringify(["2026", "2022"]));
});

test("inverted ranges are normalized instead of producing an impossible filter", () => {
  assert.equal(JSON.stringify(
    picker.normalizeRange({ dateFrom: "2023-01-01", dateTo: "2022-12-31" }),
  ), JSON.stringify({ dateFrom: "2022-12-31", dateTo: "2023-01-01", swapped: true }));
});

test("date filtering includes both selected boundaries", () => {
  const captured = (value) => ({
    id: `photo-${value}`,
    metadata: [{ label: "Captured", value: `${value.replaceAll("-", ":")} 23:59:59` }],
  });
  assert.equal(photoFilter.matchesPhoto(captured("2022-01-01"), { dateFrom: "2022-01-01" }), true);
  assert.equal(photoFilter.matchesPhoto(captured("2022-01-01"), { dateTo: "2022-01-01" }), true);
  assert.equal(photoFilter.matchesPhoto(captured("2022-01-02"), { dateTo: "2022-01-01" }), false);
  assert.equal(photoFilter.matchesPhoto(captured("2021-12-31"), { dateFrom: "2022-01-01" }), false);
});
