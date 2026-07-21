(() => {
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const endpoints = [
    "http://127.0.0.1:8766/photosbyelie/owner-active",
    "http://localhost:8766/photosbyelie/owner-active",
  ];
  let holders = 0;
  let timer = null;

  const touch = async () => {
    if (isLocal || holders === 0 || document.visibilityState === "hidden") return;
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          credentials: "omit",
          mode: "cors",
        });
        if (response.ok) return;
      } catch {
        // A missing local connector is normal on non-Owner devices.
      }
    }
  };

  const sync = () => {
    const shouldRun = !isLocal && holders > 0 && document.visibilityState !== "hidden";
    if (shouldRun) {
      touch();
      if (!timer) timer = window.setInterval(touch, 4000);
      return;
    }
    if (timer) window.clearInterval(timer);
    timer = null;
  };

  const hold = () => {
    holders += 1;
    sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holders = Math.max(0, holders - 1);
      sync();
    };
  };

  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", () => {
    holders = 0;
    sync();
  }, { once: true });

  window.photosByElieOwnerActivity = { hold };
})();
