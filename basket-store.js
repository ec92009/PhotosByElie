(() => {
  const basketKey = "photosbyelie-basket";
  const resolutions = () => {
    window.photosByElieProductSettings?.applyPriceOverrides?.();
    return window.photosByElieResolutions || [];
  };
  const frameOptions = () => window.photosByElieFrameOptions || [];
  const collectionEntries = () => [
    ...Object.entries(window.photosByElieData || {}),
    ...Object.entries(window.photosByElieReserveData || {}),
  ];
  const framePriceFor = (frame, option) => window.photosByElieFramePrice?.(frame, option) || Number(frame?.price) || 0;

  const optionById = (id) => resolutions().find((option) => option.id === id);
  const photoEntryById = (photoId) => {
    const collectionEntry = collectionEntries().find(([, entry]) =>
      entry.photos.some((photo) => photo.id === photoId)
    );
    if (!collectionEntry) return {};
    const [collectionKey, collection] = collectionEntry;
    const photo = collection.photos.find((item) => item.id === photoId);
    return { collection, collectionKey, photo };
  };
  const photoById = (photoId) => photoEntryById(photoId).photo;

  const availableOptionsForPhotoId = (photoId) => {
    const photo = photoById(photoId);
    if (!photo) return [];
    if (!window.photosByElieAvailableResolutions) return resolutions();
    return window.photosByElieAvailableResolutions(photo, resolutions());
  };

  const normalizeOptions = (options = [], photoId = null) => {
    const availableOptions = availableOptionsForPhotoId(photoId);
    const availableById = new Map(availableOptions.map((option) => [option.id, option]));
    const availableIds = new Set(availableOptions.map((option) => option.id));
    const seen = new Set();
    return options.reduce((next, option) => {
      const source = availableById.get(option.id) || optionById(option.id) || option;
      if (!source?.id || !availableIds.has(source.id) || seen.has(source.id)) return next;
      seen.add(source.id);
      const normalized = { id: source.id, type: source.type || "digital", label: source.label, detail: source.detail, dimensions: source.dimensions, price: source.price };
      if (normalized.type === "print") {
        const quantity = Math.max(1, Math.min(99, Math.round(Number(option.quantity) || 1)));
        const frame = frameOptions().find((item) => item.id === option.frame?.id || item.id === option.frameId) || frameOptions()[0] || { id: "none", label: "No frame", price: 0 };
        normalized.quantity = quantity;
        normalized.frame = { id: frame.id, label: frame.label, price: framePriceFor(frame, normalized) };
      }
      next.push(normalized);
      return next;
    }, []);
  };

  const normalizeBasket = (items = []) => {
    const byPhoto = new Map();
    items.forEach((item) => {
      if (!item?.photoId) return;
      if (!photoById(item.photoId)) return;
      const existing = byPhoto.get(item.photoId);
      if (!existing) {
        byPhoto.set(item.photoId, {
          photoId: item.photoId,
          title: item.title,
          collection: item.collection,
          options: normalizeOptions(item.options, item.photoId)
        });
        return;
      }
      existing.title = existing.title || item.title;
      existing.collection = existing.collection || item.collection;
      existing.options = normalizeOptions([...(existing.options || []), ...(item.options || [])], item.photoId);
    });

    return Array.from(byPhoto.values()).map((item) => {
      const { collection, photo } = photoEntryById(item.photoId);
      const options = normalizeOptions(item.options, item.photoId);
      return {
        ...item,
        title: photo.title,
        collection: collection.title,
        options,
        total: options.reduce((sum, option) => sum + (window.photosByElieOptionTotal?.(option) || option.price), 0)
      };
    }).filter((item) => item.options.length);
  };

  const syncBasketLikes = (items) => {
    const likedStore = window.photosByElieLiked;
    if (!likedStore?.write || !likedStore?.read) return;
    likedStore.write([
      ...likedStore.read(),
      ...items.map((item) => ({ photoId: item.photoId })),
    ]);
  };

  const read = () => {
    try {
      return normalizeBasket(JSON.parse(localStorage.getItem(basketKey) || "[]"));
    } catch {
      return [];
    }
  };

  const write = (items) => {
    const normalized = normalizeBasket(items);
    localStorage.setItem(basketKey, JSON.stringify(normalized));
    syncBasketLikes(normalized);
    window.dispatchEvent(new CustomEvent("photosbyelie:basketchange", { detail: { items: normalized } }));
    return normalized;
  };

  const add = (item) => {
    const options = normalizeOptions(item.options, item.photoId);
    if (!options.length) return read();
    return write([...read(), { ...item, options }]);
  };

  const setPhotoOptions = (item) => {
    const options = normalizeOptions(item.options, item.photoId);
    const items = read().filter((existing) => existing.photoId !== item.photoId);
    if (!options.length) return write(items);
    return write([...items, { ...item, options }]);
  };

  const updateOptions = (index, optionIds) => {
    const items = read();
    if (!items[index]) return items;
    items[index].options = normalizeOptions(optionIds.map((option) => typeof option === "string" ? { id: option } : option), items[index].photoId);
    return write(items);
  };

  const remove = (index) => {
    const items = read();
    items.splice(index, 1);
    return write(items);
  };

  window.photosByElieBasket = {
    add,
    clear: () => write([]),
    read,
    remove,
    setPhotoOptions,
    updateOptions,
    write
  };
})();
