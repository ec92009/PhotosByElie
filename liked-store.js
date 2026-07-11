(() => {
  const likedKey = "photosbyelie-liked";
  const collectionEntries = () => [
    ...Object.entries(window.photosByElieData || {}),
    ...Object.entries(window.photosByElieReserveData || {}),
  ];

  const photoEntryForId = (photoId) => {
    const collectionEntry = collectionEntries().find(([, collection]) =>
      collection.photos.some((photo) => photo.id === photoId)
    );
    if (!collectionEntry) return {};
    const [collectionKey, collection] = collectionEntry;
    const photo = collection.photos.find((item) => item.id === photoId);
    return { collection, collectionKey, photo };
  };

  const normalizeLiked = (items = []) => {
    const seen = new Set();
    return items.reduce((next, item) => {
      const photoId = typeof item === "string" ? item : item?.photoId;
      if (!photoId || seen.has(photoId)) return next;
      const { collection, collectionKey, photo } = photoEntryForId(photoId);
      if (!photo) return next;
      seen.add(photoId);
      next.push({
        photoId,
        title: photo.title,
        collection: collection.title,
        collectionKey,
      });
      return next;
    }, []);
  };

  const read = () => {
    try {
      return normalizeLiked(JSON.parse(localStorage.getItem(likedKey) || "[]"));
    } catch {
      return [];
    }
  };

  const write = (items) => {
    const normalized = normalizeLiked(items);
    localStorage.setItem(likedKey, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("photosbyelie:likedchange", { detail: { items: normalized } }));
    return normalized;
  };

  const add = (item) => {
    const photoId = typeof item === "string" ? item : item?.photoId;
    if (!photoId) return read();
    return write([...read(), { photoId }]);
  };

  const remove = (photoId) => {
    const nextLiked = write(read().filter((item) => item.photoId !== photoId));
    const basketStore = window.photosByElieBasket;
    if (basketStore?.read && basketStore?.write) {
      basketStore.write(basketStore.read().filter((item) => item.photoId !== photoId));
    }
    return nextLiked;
  };

  const has = (photoId) => read().some((item) => item.photoId === photoId);

  window.photosByElieLiked = {
    add,
    clear: () => write([]),
    has,
    read,
    remove,
    write,
  };
})();
