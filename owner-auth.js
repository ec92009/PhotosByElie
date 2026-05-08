(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const enabled = localHosts.has(window.location.hostname);
  const sessionEndpoint = "/__photosbyelie/owner-session";
  const loginEndpoint = "/__photosbyelie/owner-login";
  const logoutEndpoint = "/__photosbyelie/owner-logout";
  let state = {
    checked: false,
    available: false,
    authenticated: false,
    passwordConfigured: false,
    passwordSource: "",
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
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Owner auth is unavailable.");
        return setState({
          available: true,
          authenticated: payload.authenticated === true,
          passwordConfigured: payload.passwordConfigured === true,
          passwordSource: payload.passwordSource || "",
          sessionSeconds: Number(payload.sessionSeconds || 0),
        });
      })
      .catch(() => setState({
        available: false,
        authenticated: false,
        passwordConfigured: false,
        passwordSource: "",
        sessionSeconds: 0,
      }))
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  };

  const login = async (password) => {
    if (!enabled) throw new Error("Owner login is only available on localhost.");
    const response = await fetch(loginEndpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok || payload.authenticated !== true) {
      setState({ available: true, authenticated: false });
      throw new Error(payload?.error || "Owner login failed.");
    }
    return setState({
      available: true,
      authenticated: true,
      passwordConfigured: payload.passwordConfigured === true,
      passwordSource: payload.passwordSource || "",
      sessionSeconds: Number(payload.sessionSeconds || 0),
    });
  };

  const logout = async () => {
    if (!enabled) return setState({ authenticated: false });
    await fetch(logoutEndpoint, { method: "POST", credentials: "same-origin" }).catch(() => {});
    return setState({ available: true, authenticated: false });
  };

  const markSignedOut = () => setState({ authenticated: false });

  const requireAuth = async (message = "Owner login required.") => {
    if (!enabled) return false;
    const latest = state.checked ? state : await refresh();
    if (latest.authenticated) return true;
    if (!latest.available) {
      window.alert?.("Start the local Photos By Elie server to use owner actions.");
      return false;
    }
    const password = window.prompt?.(message);
    if (!password) return false;
    try {
      await login(password);
      return true;
    } catch (error) {
      window.alert?.(error?.message || "Owner login failed.");
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
