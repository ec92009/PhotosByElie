(() => {
  const pad2 = (value) => String(value).padStart(2, "0");

  const validDate = (year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year)
      && date.getUTCMonth() === Number(month) - 1
      && date.getUTCDate() === Number(day);
  };

  const daysInMonth = (year, month) => {
    if (!Number(year) || !Number(month)) return 0;
    return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  };

  const partsFromDateValue = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || !validDate(match[1], match[2], match[3])) {
      return { year: "", month: "", day: "" };
    }
    return { year: match[1], month: match[2], day: match[3] };
  };

  const dateValueFromParts = (parts = {}, edge = "start") => {
    const year = String(parts.year || "").trim();
    const month = String(parts.month || "").trim();
    const day = String(parts.day || "").trim();
    if (!/^\d{4}$/.test(year)) return "";
    const resolvedMonth = month ? Number(month) : edge === "end" ? 12 : 1;
    if (resolvedMonth < 1 || resolvedMonth > 12) return "";
    const resolvedDay = day
      ? Number(day)
      : edge === "end"
        ? daysInMonth(year, resolvedMonth)
        : 1;
    if (!validDate(year, resolvedMonth, resolvedDay)) return "";
    return `${year}-${pad2(resolvedMonth)}-${pad2(resolvedDay)}`;
  };

  const normalizeRange = (state = {}) => {
    let dateFrom = partsFromDateValue(state.dateFrom).year ? String(state.dateFrom) : "";
    let dateTo = partsFromDateValue(state.dateTo).year ? String(state.dateTo) : "";
    let swapped = false;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      [dateFrom, dateTo] = [dateTo, dateFrom];
      swapped = true;
    }
    return { dateFrom, dateTo, swapped };
  };

  const rangeValuesFromParts = (parts = {}) => ({
    dateFrom: dateValueFromParts(parts.dateFrom, "start"),
    dateTo: dateValueFromParts(parts.dateTo, "end"),
  });

  const captureDate = (photo) => {
    const metadataDate = (photo?.metadata || []).find((item) => item?.label === "Captured")?.value;
    const values = [metadataDate, photo?.capturedAt, photo?.title, photo?.caption, photo?.id];
    for (const value of values) {
      const match = String(value || "").match(/\b(\d{4})[:/-](\d{2})[:/-](\d{2})\b/);
      if (match && validDate(match[1], match[2], match[3])) return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return "";
  };

  const yearsFromPhotos = (photos = []) => {
    const years = photos.map(captureDate)
      .filter(Boolean)
      .map((value) => Number(value.slice(0, 4)))
      .filter((year) => Number.isInteger(year));
    if (!years.length) return [];
    const newest = Math.max(...years);
    const oldest = Math.min(...years);
    return Array.from({ length: newest - oldest + 1 }, (_, index) => String(newest - index));
  };

  const dateRangeFromPhotos = (photos = []) => {
    const dates = photos.map(captureDate).filter(Boolean).sort();
    return {
      dateFrom: dates[0] || "",
      dateTo: dates.at(-1) || "",
    };
  };

  window.photosByElieGalleryDatePicker = {
    captureDate,
    daysInMonth,
    dateValueFromParts,
    dateRangeFromPhotos,
    partsFromDateValue,
    normalizeRange,
    rangeValuesFromParts,
    yearsFromPhotos,
  };
})();
