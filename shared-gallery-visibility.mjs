export const sharedPhotoCountFrom = (payload = {}) => {
  const ids = new Set();
  (payload.fixtures || []).forEach((fixture) => {
    (fixture.photos || []).forEach((photo) => {
      if (photo?.id) ids.add(photo.id);
    });
  });
  return Math.max(Number(payload.uniquePhotoCount) || 0, ids.size);
};

export const sharedGalleryLoadingState = () => ({
  sharedGalleryChecked: false,
  sharedGalleryLoading: true,
  sharedPhotoCount: 0,
});

export const sharedGalleryResolvedState = (payload = {}) => ({
  sharedGalleryChecked: true,
  sharedGalleryLoading: false,
  sharedPhotoCount: sharedPhotoCountFrom(payload),
});

export const sharedGalleryClearedState = () => ({
  sharedGalleryChecked: true,
  sharedGalleryLoading: false,
  sharedPhotoCount: 0,
});

export const sharedGalleryIsVisible = (state = {}) => Boolean(
  state.authenticated
  && state.sharedGalleryChecked
  && !state.sharedGalleryLoading
  && Number(state.sharedPhotoCount) > 0
);
