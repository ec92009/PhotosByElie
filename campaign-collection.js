/* Shared membership rules for the directory and campaign detail pages. */
(() => {
  const publicCampaign = (campaign) => campaign && campaign.public !== false
    && ![campaign.visibility, campaign.status].some((value) => ["private", "draft", "unpublished", "archived"].includes(String(value || "").toLowerCase()));
  const memberIds = (campaign) => [...new Set([
    ...(campaign.primaryPhotoIds || []), campaign.heroPhotoId,
    ...(campaign.relatedPhotoIds || []),
  ].filter(Boolean))];
  // The directory cover is an editorial sample of the existing campaign
  // manifest. Keep the full membership available to the detail view while
  // choosing frames that avoid obvious near-duplicates in the cover.
  const compositeOverrides = Object.freeze({
    "etsy-alhaurin-sunset-wall-art-2026-06-12": ["img-1981-eeff6a8f2a", "img-1985-ae65a693ca", "img-1989-2a77a202cb"],
    "facebook-alhaurin-sunset-hills-2026-06-12": ["img-1981-eeff6a8f2a", "img-1986-93cc12b8bc", "img-1989-2a77a202cb"],
    "pinterest-alhaurin-sunset-hill-light-2026-07-12": ["img-1981-eeff6a8f2a", "img-1989-2a77a202cb"],
    "facebook-benalmadena-seaport-evening-color-2026-07-09": ["001-0cd1b0212f", "001-283d863371", "001-f917ca47a2"],
    "facebook-malaga-aerial-city-light-2026-07-13": ["001-16030596db", "001-d18ed98cff", "001-908c4a86a2", "001-6951fdf3ff"],
    "etsy-fuengirola-moon-wall-art-2026-06-12": ["img-2438-769d2c55da", "img-2443-ad375ec1e2", "img-2445-86fcda40d1"],
    "instagram-fuengirola-moon-mediterranean-2026-06-12": ["img-2438-769d2c55da", "img-2443-ad375ec1e2", "img-2445-86fcda40d1"],
    "instagram-fuengirola-moon-mediterranean-2026-07-14": ["img-2438-769d2c55da", "img-2448-d30fa46324", "img-2439-acda9a345e", "img-2445-86fcda40d1"],
    "pinterest-gibraltar-rock-and-bay-light-2026-06-10": ["img-5705-d13a56dbb8", "img-5688-774fc51bff", "img-5690-7733fd1086"],
    "pinterest-gibraltar-rock-and-bay-views-2026-05-27": ["img-5669-31d9551dd4", "img-5687-46f0da658f", "img-5695-eb987f9f53", "img-5698-87c60eb06c"],
    "pinterest-gibraltar-rock-mediterranean-light-2026-07-08": ["img-5669-31d9551dd4", "img-5687-46f0da658f", "img-5689-7b0f2b33e9"],
    "etsy-lisbon-ancient-art-wall-art-2026-06-14": ["20180520-1617-00730-5ef53e0579", "20180520-1627-00732-0df4ba1830", "20180520-1559-00722-c5fc561a78", "20180520-1605-00724-c27b7d6b75"],
    "pinterest-lisbon-ancient-art-museum-light-2026-06-14": ["20180520-1617-00730-5ef53e0579", "20180520-1627-00732-0df4ba1830", "20180520-1559-00722-c5fc561a78", "20180520-1605-00724-c27b7d6b75"],
    "pinterest-lisbon-ancient-art-museum-light-2026-07-13": ["20180520-1617-00730-5ef53e0579", "20180520-1627-00732-0df4ba1830", "20180520-1559-00722-c5fc561a78", "20180520-1605-00724-c27b7d6b75"],
    "pinterest-paris-carnavalet-museum-rooms-2026-06-11": ["20221219-165333-03460-a83d1b36e7", "20221219-165356-03462-304e23d1ae", "20221219-165421-03464-f8085c9ad2", "20221219-165426-03465-52b31d0632"],
    "etsy-paris-carnavalet-rooms-wall-art-2026-06-11": ["20221219-165333-03460-a83d1b36e7", "20221219-165356-03462-304e23d1ae", "20221219-165421-03464-f8085c9ad2", "20221219-165426-03465-52b31d0632"],
    "facebook-paris-carnavalet-interior-color-2026-06-30": ["20221219-155607-00136-8c488a1ba6", "20221219-165333-03460-a83d1b36e7", "20221219-170201-03493-21090b7b47", "20221219-165844-03479-31cf914707"],
    "instagram-paris-carnavalet-rooms-color-2026-07-13": ["20221219-155607-00136-8c488a1ba6", "20221219-165333-03460-a83d1b36e7", "20221219-170201-03493-21090b7b47", "20221219-165844-03479-31cf914707"],
    "pinterest-pisa-cathedral-marble-facade-2026-07-09": ["001-b726a850c3", "001-862e1c98fe", "001-ca3691704b"],
    "facebook-ronda-white-town-gorge-light-2026-07-08": ["img-1041-ebc7a0b91d", "img-1044-6c1c81f667", "img-1045-f0bb5afd06", "img-1047-3f423c66d0"],
    "facebook-ronda-gorge-white-town-light-2026-06-11": ["d5h-2676-0da4f3c9cf", "d5h-2680-b9d3890d28", "d5h-2683-67d01abd63", "d5h-2697-1209ca7c26"],
    "etsy-ronda-gorge-white-town-wall-art-2026-06-11": ["d5h-2676-0da4f3c9cf", "d5h-2680-b9d3890d28", "d5h-2683-67d01abd63", "d5h-2697-1209ca7c26"],
    "instagram-ronda-gorge-white-town-views-2026-05-27": ["d5h-2761-c86320d0bf", "d5h-2749-2f1d7f391b", "d5h-2747-5e7d6bc190", "d5h-2755-e3846b9f48"],
    "facebook-paris-musee-dorsay-gallery-light-2026-07-06": ["001-064ce7f9ff", "001-578055d7e9", "001-424542638a", "001-07cd6cc63a"],
  });
  const compositePhotoIds = (campaign) => {
    const members = memberIds(campaign);
    const allowed = new Set(members);
    const requested = compositeOverrides[campaign?.id] || members.slice(0, 4);
    return [...new Set(requested)].filter((id) => allowed.has(id));
  };
  const entries = (ids, index) => [...new Set(ids || [])].map((id) => index.get(id)).filter((entry) => {
    const preview = entry?.photo?.media?.publicPreview;
    return preview && (preview.galleryKey || preview.detailKey);
  });
  const api = { publicCampaign, memberIds, compositePhotoIds, entries };
  if (typeof module !== "undefined") module.exports = api;
  else window.photosByElieCampaignCollection = api;
})();
