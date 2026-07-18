const REAL_ESTATE_GALLERY_ALIASES = new Map([
  ["corine-gallery", "corine-real-estate"],
  ["re-la-concha", "corine-real-estate"],
]);

export const canonicalRealEstateGalleryKey = (value) => {
  const key = String(value || "").trim();
  return REAL_ESTATE_GALLERY_ALIASES.get(key.toLowerCase()) || key;
};
