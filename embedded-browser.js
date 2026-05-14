(() => {
  const params = new URLSearchParams(window.location.search);
  const override = String(params.get("embeddedBrowser") || "").toLowerCase();
  const userAgent = navigator.userAgent || "";
  const socialAppPattern = /(Pinterest|Pinterestbot|Instagram|FBAN|FBAV|FB_IAB|FB4A|FBIOS|Line\/|Twitter|TikTok|Snapchat|LinkedInApp)/i;
  const isForced = ["1", "true", "yes"].includes(override);
  const isDisabled = ["0", "false", "no"].includes(override);
  const detected = !isDisabled && (isForced || socialAppPattern.test(userAgent));

  const cleanExternalUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("embeddedBrowser");
    return url.href;
  };

  const copyText = async (value) => {
    if (!value) return false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  window.photosByElieEmbeddedBrowser = {
    detected,
    userAgent,
    externalUrl: cleanExternalUrl(),
    copyText,
  };
})();
