const safeMp4Filename = (value = "slideshow.webm") => {
  const clean = String(value || "slideshow.webm").split(/[\\/]/).pop().replace(/["\r\n\0]+/g, "").trim();
  return `${clean.replace(/\.[^.]+$/i, "") || "slideshow"}.mp4`;
};

export const createCloudflareMediaVideoTranscoder = ({ media } = {}) => {
  if (!media || typeof media.input !== "function") return null;
  return {
    async toMp4({ body, filename = "slideshow.webm", width = 1280, height = 720 } = {}) {
      if (!body) throw new Error("Cloud video transcoding requires an input stream.");
      const targetWidth = Math.max(10, Math.min(2000, Math.round(Number(width) || 1280)));
      const targetHeight = Math.max(10, Math.min(2000, Math.round(Number(height) || 720)));
      // A real resize step prevents the beta Media binding from merely remuxing
      // browser-recorded VP9/Opus into an MP4 wrapper. The resulting H.264/AAC
      // stream is playable by iPhone as well as desktop browsers.
      const result = media
        .input(body)
        .transform({ width: targetWidth, height: targetHeight, fit: "contain" })
        .output({ mode: "video", audio: true });
      const [outputBody, contentType] = await Promise.all([
        result.media(),
        result.contentType(),
      ]);
      return {
        body: outputBody,
        contentType: String(contentType || "video/mp4").split(";")[0].trim().toLowerCase(),
        filename: safeMp4Filename(filename),
      };
    },
  };
};
