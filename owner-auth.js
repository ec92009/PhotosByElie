(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const enabled = localHosts.has(window.location.hostname);
  const sessionEndpoint = "/__photosbyelie/owner-session";
  const logoutEndpoint = "/__photosbyelie/owner-logout";
  let state = {
    checked: false,
    available: false,
    authenticated: false,
    sessionSeconds: 0,
  };
  let refreshPromise = null;

  const emit = () => {
    window.dispatchEvent(new CustomEvent("photosbyelie:ownerauthchange", { detail: { ...state } }));
    return { ...state };
  };

  const setState = (next) => {
    state = { ...state, ...next, checked: true };
    return emit();
  };

  const refresh = async () => {
    if (!enabled) return setState({ available: false, authenticated: false });
    if (refreshPromise) return refreshPromise;
    refreshPromise = fetch(sessionEndpoint, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Owner helper is unavailable.");
        return setState({
          available: true,
          authenticated: true,
          sessionSeconds: Number(payload.sessionSeconds || 0),
        });
      })
      .catch(() => setState({
        available: false,
        authenticated: false,
        sessionSeconds: 0,
      }))
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  };

  const login = () => refresh();

  const logout = async () => {
    if (!enabled) return setState({ authenticated: false });
    await fetch(logoutEndpoint, { method: "POST", credentials: "same-origin" }).catch(() => {});
    return refresh();
  };

  const markSignedOut = () => setState({ authenticated: true });

  const requireAuth = async (message = "Owner helper unavailable.") => {
    if (!enabled) return false;
    const latest = state.checked ? state : await refresh();
    if (latest.authenticated) return true;
    if (!latest.available) {
      window.alert?.("Start the local Photos By Elie server to use owner actions.");
      return false;
    }
    try {
      await refresh();
      return true;
    } catch (error) {
      window.alert?.(error?.message || message);
      return false;
    }
  };

  window.photosByElieOwnerAuth = {
    enabled,
    get state() {
      return { ...state };
    },
    login,
    logout,
    markSignedOut,
    refresh,
    requireAuth,
  };
})();
