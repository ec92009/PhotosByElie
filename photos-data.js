window.photosByElieData = {
  france: {
    number: "01",
    title: "France",
    description: "Ready for the next developed-photo import.",
    accent: "france-gallery",
    photos: [],
  },
  usa: {
    number: "02",
    title: "USA",
    description: "Ready for the next developed-photo import.",
    accent: "usa-gallery",
    photos: [],
  },
  spain: {
    number: "03",
    title: "Spain",
    description: "Ready for the next developed-photo import.",
    accent: "spain-gallery",
    photos: [],
  },
  mexico: {
    number: "04",
    title: "Mexico",
    description: "Ready for the next developed-photo import.",
    accent: "mexico-gallery",
    photos: [],
  },
  ai: {
    number: "05",
    title: "AI",
    description: "Ready for the next developed-photo import.",
    accent: "ai-gallery",
    photos: [],
  },
  portugal: {
    number: "06",
    title: "Portugal",
    description: "Ready for the next developed-photo import.",
    accent: "portugal-gallery",
    photos: [],
  },
  slovakia: {
    number: "07",
    title: "Slovakia",
    description: "Ready for the next developed-photo import.",
    accent: "slovakia-gallery",
    photos: [],
  },
};

window.photosByElieOwnerData = {
  unknown: {
    number: "08",
    title: "Unknown",
    description: "Reserve photos that still need a country assignment.",
    accent: "unknown-gallery",
    photos: [],
  },
};

window.photosByElieResolutions = [
  { id: "full", label: "Full resolution", detail: "Original source file at native resolution", price: 45 },
  { id: "jpg-6mp", label: "JPG 6 MP", detail: "Long edge export for print and premium web", price: 18, minMegapixels: 6 },
  { id: "jpg-3mp", label: "JPG 3 MP", detail: "Listing, portfolio, and editorial web use", price: 10, minMegapixels: 3 },
  { id: "jpg-1mp", label: "JPG 1 MP", detail: "Small web preview and social draft use", price: 5, minMegapixels: 1 },
];

window.photosByEliePreviewMegapixels = (photo) => {
  const preview = (photo?.metadata || []).find((item) => item.label === "Preview file")?.value || "";
  const match = preview.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return 0;
  return Math.round((Number(match[1]) * Number(match[2]) / 1000000) * 10) / 10;
};

window.photosByElieVerifiedMegapixels = (photo) => {
  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) return Number(photo.megapixels) || 0;
  return window.photosByEliePreviewMegapixels(photo);
};

window.photosByElieAvailableResolutions = (photo, options = window.photosByElieResolutions || []) => {
  const megapixels = window.photosByElieVerifiedMegapixels(photo);
  if (!megapixels) return [];
  return options.filter((option) => !option.minMegapixels || megapixels >= option.minMegapixels);
};

window.photosByElieFormatLabel = (source) => {
  const value = String(source || "");
  const checks = [
    { label: "JPG", pattern: /\b(JPG|JPEG)\b/i },
    { label: "TIFF", pattern: /\b(TIF|TIFF)\b/i },
    { label: "PSD", pattern: /\bPSD\b/i },
  ];
  const formats = checks.filter((item) => item.pattern.test(value)).map((item) => item.label);
  return formats.length ? formats.join(" + ") : value;
};

window.photosByElieSourceFormats = (photo) => {
  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) {
    const formats = [...new Set(photo.sourceFiles.map((file) => file.type || window.photosByElieFormatLabel(file.path)).filter(Boolean))];
    return formats.join(" + ");
  }
  return photo?.imageSrc ? `${window.photosByElieFormatLabel(photo.imageSrc)} preview/export` : "Source file unverified";
};

window.photosByElieOriginalSize = (photo) => {
  const megapixels = window.photosByElieVerifiedMegapixels(photo);
  const sizeLabel = Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length ? "source" : "verified";
  return [window.photosByElieSourceFormats(photo), megapixels ? `${megapixels} MP ${sizeLabel}` : ""].filter(Boolean).join(", ");
};

window.photosByElieResolutionDetail = (photo, option) => {
  if (option.id !== "full") return option.detail;
  return `Original: ${window.photosByElieOriginalSize(photo)}`;
};
