/* Public campaign films: approved portrait MP4s with YouTube fallbacks. */
(() => {
  const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

  const normalize = (value) => {
    if (!value || String(value.provider || "").toLowerCase() !== "youtube") return null;
    const videoId = String(value.videoId || "").trim();
    const shortId = String(value.shortId || "").trim();
    if (!YOUTUBE_ID.test(videoId) || (shortId && !YOUTUBE_ID.test(shortId))) return null;
    if (String(value.visibility || "").toLowerCase() !== "public") return null;
    const portraitMp4 = String(value.portraitMp4 || "").trim();
    // Only deployed promotional derivatives, never arbitrary URLs or private media.
    if (portraitMp4 && !/^\.\/assets\/campaign-media\/[a-z0-9-]+\.mp4$/.test(portraitMp4)) return null;
    const durationSeconds = Number(value.durationSeconds);
    return {
      provider: "youtube",
      videoId,
      shortId,
      title: String(value.title || "Photos By Elie on YouTube").trim(),
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
      portraitEmbedUrl: shortId ? `https://www.youtube-nocookie.com/embed/${shortId}?rel=0` : "",
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      shortUrl: shortId ? `https://youtube.com/shorts/${shortId}` : "",
      visibility: "public",
      ...(portraitMp4 ? { portraitMp4, musicCredit: String(value.musicCredit || "").trim() } : {}),
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
    const status = section.querySelector("[data-campaign-video-status]");
    if (status) status.textContent = "";
    if (title) title.textContent = video.title;
    if (frame) {
      frame.classList.toggle("campaign-video-frame--portrait", Boolean(video.portraitMp4));
      if (video.portraitMp4) {
        const player = document.createElement("video");
        player.src = video.portraitMp4;
        player.controls = true;
        player.playsInline = true;
        player.preload = "metadata";
        player.setAttribute("aria-label", video.title);
        player.textContent = "Video playback is unavailable here. Use the YouTube links below.";
        player.addEventListener("error", () => {
          if (status) status.textContent = "The film could not load. You can still watch it on YouTube below.";
        });
        frame.replaceChildren(player);
      } else {
        const iframe = document.createElement("iframe");
        iframe.src = video.embedUrl;
        iframe.title = video.title;
        iframe.loading = "lazy";
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        frame.replaceChildren(iframe);
      }
    }
    const credit = section.querySelector("[data-campaign-video-credit]");
    if (credit) {
      credit.textContent = video.musicCredit || "";
      credit.hidden = !video.musicCredit;
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
