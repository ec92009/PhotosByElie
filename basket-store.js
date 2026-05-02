(() => {
  const basketKey = "photosbyelie-basket";
  const resolutions = () => window.photosByElieResolutions || [];
  const collections = () => window.photosByElieData || {};

  const optionById = (id) => resolutions().find((option) => option.id === id);
  const photoById = (photoId) => {
    const collection = Object.values(collections()).find((entry) =>
      entry.photos.some((photo) => photo.id === photoId)
    );
    return collection?.photos.find((photo) => photo.id === photoId);
  };

  const availableOptionsForPhotoId = (photoId) => {
    const photo = photoById(photoId);
    if (!photo || !window.photosByElieAvailableResolutions) return resolutions();
    return window.photosByElieAvailableResolutions(photo, resolutions());
  };

  const normalizeOptions = (options = [], photoId = null) => {
    const availableIds = new Set(availableOptionsForPhotoId(photoId).map((option) => option.id));
    const seen = new Set();
    return options.reduce((next, option) => {
      const source = optionById(option.id) || option;
      if (!source?.id || !availableIds.has(source.id) || seen.has(source.id)) return next;
      seen.add(source.id);
      next.push({ id: source.id, label: source.label, price: source.price });
      return next;
    }, []);
  };

  const normalizeBasket = (items = []) => {
    const byPhoto = new Map();
    items.forEach((item) => {
      if (!item?.photoId) return;
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
      const options = normalizeOptions(item.options, item.photoId);
      return {
        ...item,
        options,
        total: options.reduce((sum, option) => sum + option.price, 0)
      };
    }).filter((item) => item.options.length);
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
    items[index].options = normalizeOptions(optionIds.map((id) => ({ id })), items[index].photoId);
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
