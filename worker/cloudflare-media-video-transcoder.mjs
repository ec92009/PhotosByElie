const safeMp4Filename = (value = "slideshow.webm") => {
  const clean = String(value || "slideshow.webm").split(/[\\/]/).pop().replace(/["\r\n\0]+/g, "").trim();
  return `${clean.replace(/\.[^.]+$/i, "") || "slideshow"}.mp4`;
};

export const createCloudflareMediaVideoTranscoder = ({ media } = {}) => {
  if (!media || typeof media.input !== "function") return null;
  return {
    async toMp4({ body, filename = "slideshow.webm" } = {}) {
      if (!body) throw new Error("Cloud video transcoding requires an input stream.");
      const result = media.input(body).output({ mode: "video", audio: true });
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
