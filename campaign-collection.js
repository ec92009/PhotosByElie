/* Shared membership rules for the directory and campaign detail pages. */
(() => {
  const publicCampaign = (campaign) => campaign && campaign.public !== false
    && ![campaign.visibility, campaign.status].some((value) => ["private", "draft", "unpublished", "archived"].includes(String(value || "").toLowerCase()));
  const memberIds = (campaign) => [...new Set([
    ...(campaign.primaryPhotoIds || []), campaign.heroPhotoId,
    ...(campaign.relatedPhotoIds || []),
  ].filter(Boolean))];
  const entries = (ids, index) => [...new Set(ids || [])].map((id) => index.get(id)).filter((entry) => {
    const preview = entry?.photo?.media?.publicPreview;
    return preview && (preview.galleryKey || preview.detailKey);
  });
  const api = { publicCampaign, memberIds, entries };
  if (typeof module !== "undefined") module.exports = api;
  else window.photosByElieCampaignCollection = api;
})();
