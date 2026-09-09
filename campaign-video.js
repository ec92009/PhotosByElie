/* Optional public YouTube media for first-party campaign pages. */
(() => {
  const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

  const normalize = (value) => {
    if (!value || String(value.provider || "").toLowerCase() !== "youtube") return null;
    const videoId = String(value.videoId || "").trim();
    const shortId = String(value.shortId || "").trim();
    if (!YOUTUBE_ID.test(videoId) || (shortId && !YOUTUBE_ID.test(shortId))) return null;
    if (String(value.visibility || "").toLowerCase() !== "public") return null;
    const durationSeconds = Number(value.durationSeconds);
    return {
      provider: "youtube",
      videoId,
      shortId,
      title: String(value.title || "Photos By Elie on YouTube").trim(),
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      shortUrl: shortId ? `https://youtube.com/shorts/${shortId}` : "",
      visibility: "public",
    };
  };

  const validate = (value, context = "campaign") => {
    if (!value) return null;
    const video = normalize(value);
    if (!video) throw new Error(`${context}: invalid or non-public YouTube video metadata.`);
    return video;
  };

  const render = (section, value) => {
    if (!section) return null;
    const video = normalize(value);
    section.hidden = !video;
    if (!video) return null;

    const title = section.querySelector("[data-campaign-video-title]");
    const frame = section.querySelector("[data-campaign-video-frame]");
    const watch = section.querySelector("[data-campaign-video-watch]");
    const short = section.querySelector("[data-campaign-video-short]");
    if (title) title.textContent = video.title;
    if (frame) {
      const iframe = document.createElement("iframe");
      iframe.src = video.embedUrl;
      iframe.title = video.title;
      iframe.loading = "lazy";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      frame.replaceChildren(iframe);
    }
    if (watch) watch.href = video.watchUrl;
    if (short) {
      short.hidden = !video.shortUrl;
      if (video.shortUrl) short.href = video.shortUrl;
    }
    return video;
  };

  const api = { normalize, validate, render };
  if (typeof module !== "undefined") module.exports = api;
  else window.photosByElieCampaignVideo = api;
})();
