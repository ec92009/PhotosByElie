export const GALLERY_PAGE_SIZE = 24;
export const MAX_RENDERED_GALLERY_PHOTOS = 192;

const boundedInteger = (value, minimum, maximum) => (
  Math.max(minimum, Math.min(maximum, Math.floor(Number(value) || 0)))
);

export const normalizeGalleryWindow = ({ start = 0, end = GALLERY_PAGE_SIZE, total = 0 } = {}) => {
  const boundedTotal = Math.max(0, Math.floor(Number(total) || 0));
  if (!boundedTotal) return { start: 0, end: 0 };
  const boundedEnd = boundedInteger(end, 1, boundedTotal);
  const boundedStart = boundedInteger(start, 0, Math.max(0, boundedEnd - 1));
  return {
    start: Math.max(boundedStart, boundedEnd - MAX_RENDERED_GALLERY_PHOTOS),
    end: boundedEnd,
  };
};

export const moveGalleryWindow = ({ start = 0, end = GALLERY_PAGE_SIZE, total = 0, direction = "forward", count = GALLERY_PAGE_SIZE } = {}) => {
  const current = normalizeGalleryWindow({ start, end, total });
  const step = Math.max(1, Math.floor(Number(count) || GALLERY_PAGE_SIZE));
  if (direction === "backward") {
    const nextStart = Math.max(0, current.start - step);
    return normalizeGalleryWindow({
      start: nextStart,
      end: Math.min(current.end, nextStart + MAX_RENDERED_GALLERY_PHOTOS),
      total,
    });
  }
  const nextEnd = Math.min(Math.max(0, Math.floor(Number(total) || 0)), current.end + step);
  return normalizeGalleryWindow({
    start: Math.max(current.start, nextEnd - MAX_RENDERED_GALLERY_PHOTOS),
    end: nextEnd,
    total,
  });
};
