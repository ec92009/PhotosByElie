(() => {
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const workerBase = String(window.photosByElieMediaConfig?.authWorkerBaseUrl || "").trim().replace(/\/+$/, "");
  const holders = [];
  let timer = null;

  const touch = async () => {
    if (isLocal || !workerBase || holders.length === 0 || document.visibilityState === "hidden") return;
    const active = holders[holders.length - 1];
    try {
      await fetch(`${workerBase}/api/v1/owner/interactive`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: active.connectorId,
          surface: active.surface,
        }),
      });
    } catch {
      // Owner actions will surface authentication or network failures themselves.
    }
  };

  const sync = () => {
    const shouldRun = !isLocal && Boolean(workerBase) && holders.length > 0 && document.visibilityState !== "hidden";
    if (shouldRun) {
      touch();
      if (!timer) timer = window.setInterval(touch, 10000);
      return;
    }
    if (timer) window.clearInterval(timer);
    timer = null;
  };

  const hold = (surface = "owner", connectorId = "max") => {
    const token = { surface: String(surface || "owner"), connectorId: String(connectorId || "max") };
    holders.push(token);
    sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const index = holders.indexOf(token);
      if (index >= 0) holders.splice(index, 1);
      sync();
    };
  };

  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", () => {
    holders.length = 0;
    sync();
  }, { once: true });

  window.photosByElieOwnerActivity = { hold };
})();
