(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const localEnabled = localHosts.has(window.location.hostname);
  const config = window.photosByElieOwnerAuthConfig || {};
  const mediaConfig = window.photosByElieMediaConfig || {};
  const cleanBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
  const cloudBaseUrl = cleanBaseUrl(config.baseUrl || config.workerBaseUrl || mediaConfig.authWorkerBaseUrl || "");
  const mode = localEnabled ? "local" : cloudBaseUrl ? "cloud" : "unavailable";
  const enabled = mode !== "unavailable";
  const endpointFor = (localPath, cloudPath) => mode === "cloud" ? `${cloudBaseUrl}${cloudPath}` : localPath;
  const sessionEndpoint = endpointFor("/__photosbyelie/owner-session", config.ownerSessionPath || "/owner/session");
  const loginEndpoint = endpointFor("/__photosbyelie/owner-session", config.loginPath || "/auth/login");
  const logoutEndpoint = endpointFor("/__photosbyelie/owner-logout", config.logoutPath || "/auth/logout");
  const credentialsMode = mode === "cloud" ? "include" : "same-origin";
  let state = {
    checked: false,
    mode,
    available: false,
    authenticated: false,
    tier: "user",
    roles: ["user"],
    email: "",
    admin: false,
    realEstateClients: [],
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
    if (!enabled) return setState({ available: false, authenticated: false, mode });
    if (refreshPromise) return refreshPromise;
    refreshPromise = fetch(sessionEndpoint, { cache: "no-store", credentials: credentialsMode })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error?.message || payload?.error || "Owner authorization is unavailable.");
        }
        const user = payload.user || payload.owner || {};
        return setState({
          mode,
          available: true,
          authenticated: payload.authenticated !== false,
          tier: payload.tier || user.tier || "owner",
          roles: Array.isArray(payload.roles) ? payload.roles : ["owner"],
          email: user.email || payload.email || "",
          admin: payload.admin === true,
          realEstateClients: Array.isArray(payload.realEstateClients) ? payload.realEstateClients : [],
          sessionSeconds: Number(payload.sessionSeconds || 0),
        });
      })
      .catch(() => setState({
        mode,
        available: false,
        authenticated: false,
        tier: "user",
        roles: ["user"],
        email: "",
        admin: false,
        realEstateClients: [],
        sessionSeconds: 0,
      }))
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  };

  const login = () => {
    if (mode === "cloud") {
      const url = new URL(loginEndpoint, window.location.href);
      url.searchParams.set("returnTo", window.location.href);
      window.location.href = url.href;
      return Promise.resolve({ ...state });
    }
    return refresh();
  };

  const logout = async () => {
    if (!enabled) return setState({ authenticated: false });
    await fetch(logoutEndpoint, { method: "POST", credentials: credentialsMode }).catch(() => {});
    return refresh();
  };

  const markSignedOut = () => setState({ authenticated: false });

  const requireAuth = async (message = "Owner helper unavailable.") => {
    if (!enabled) return false;
    const latest = state.checked ? state : await refresh();
    if (latest.authenticated) return true;
    if (!latest.available) {
      if (mode === "cloud") {
        login();
      } else {
        window.alert?.("Start the local Photos By Elie server to use owner actions.");
      }
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
