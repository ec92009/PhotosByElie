(() => {
  const cleanBase = (value) => String(value || "").trim().replace(/\/+$/, "");
  const mediaConfig = window.photosByElieMediaConfig || {};
  const workerBase = cleanBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  const status = document.querySelector("[data-backstage-setup-status]");
  const session = document.querySelector("[data-backstage-setup-session]");
  const loginButton = document.querySelector("[data-backstage-setup-login]");
  const logoutButton = document.querySelector("[data-backstage-setup-logout]");
  const createButton = document.querySelector("[data-backstage-enroll-create]");
  const copyButton = document.querySelector("[data-backstage-enroll-copy]");
  const codeWrap = document.querySelector("[data-backstage-enroll-code-wrap]");
  const codeField = document.querySelector("[data-backstage-enroll-code]");
  const enrollmentStatus = document.querySelector("[data-backstage-enroll-status]");
  const refreshButton = document.querySelector("[data-backstage-devices-refresh]");
  const deviceList = document.querySelector("[data-backstage-device-list]");
  let currentSession = null;

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const canProvision = () => currentSession?.canProvisionBackstage === true;
  const ownerPath = (path) => `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const apiURL = (path) => workerBase ? `${workerBase}${path}` : path;
  const idempotencyKey = (scope) => `backstage-setup-${scope}-${Date.now().toString(36)}-${crypto.randomUUID()}`;

  const apiFetch = async (path, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const response = await fetch(apiURL(path), {
      cache: "no-store",
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(!["GET", "HEAD", "OPTIONS"].includes(method)
          ? { "idempotency-key": options.idempotencyKey || idempotencyKey(path.replace(/[^a-z0-9]+/gi, "-")) }
          : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false || body?.error) {
      throw new Error(body?.error?.message || body?.error || `Setup request failed with HTTP ${response.status}.`);
    }
    return body;
  };

  const renderSession = () => {
    if (!session) return;
    session.replaceChildren();
    const strong = document.createElement("strong");
    const detail = document.createElement("small");
    if (!currentSession?.authenticated) {
      strong.textContent = "Signed out";
      detail.textContent = "Direct Google verification is required for setup.";
    } else if (!canProvision()) {
      strong.textContent = "Setup locked";
      detail.textContent = "This account cannot provision Backstage devices.";
    } else {
      strong.textContent = "Provisioning identity verified";
      detail.textContent = "Enrollment and revocation only.";
    }
    session.append(strong, document.createElement("br"), detail);
  };

  const encodeEnrollment = ({ deviceId, deviceCredential }) => {
    const bytes = new TextEncoder().encode(JSON.stringify({ deviceId, deviceCredential }));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };

  const renderDevices = (devices = []) => {
    if (!deviceList) return;
    deviceList.replaceChildren();
    if (!devices.length) {
      deviceList.textContent = canProvision() ? "No Backstage devices are enrolled." : "Sign in with the provisioning identity to inspect devices.";
      return;
    }
    devices.forEach((device) => {
      const row = document.createElement("div");
      row.className = "backstage-device-row";
      const copy = document.createElement("span");
      const revoked = Boolean(device.revokedAt);
      const created = device.createdAt ? new Date(device.createdAt).toLocaleString() : "date unavailable";
      copy.textContent = `${device.name || "Backstage Mac"} · ${device.platform || "macOS"} · created ${created}${revoked ? " · revoked" : ""}`;
      row.append(copy);
      if (!revoked) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn secondary";
        button.textContent = "Revoke";
        button.setAttribute("aria-label", `Revoke ${device.name || "Backstage device"}`);
        button.addEventListener("click", () => revokeDevice(device));
        row.append(button);
      }
      deviceList.append(row);
    });
  };

  const loadDevices = async () => {
    if (!canProvision()) {
      renderDevices();
      return;
    }
    if (refreshButton) refreshButton.disabled = true;
    try {
      const body = await apiFetch(ownerPath("/devices"));
      renderDevices(Array.isArray(body.devices) ? body.devices : []);
    } catch (error) {
      if (deviceList) deviceList.textContent = error.message || "Could not load Backstage devices.";
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  };

  const loadSession = async () => {
    if (!workerBase) {
      currentSession = null;
      renderSession();
      renderDevices();
      setStatus("The credential service is unavailable.");
      return;
    }
    setStatus("Checking the provisioning identity…");
    try {
      currentSession = await apiFetch(ownerPath("/owner/session"));
      renderSession();
      setStatus(canProvision()
        ? "Provisioning identity verified. This browser can manage Backstage credentials only."
        : "Sign in directly with the provisioning identity to manage Backstage devices.");
      await loadDevices();
    } catch (error) {
      currentSession = null;
      renderSession();
      renderDevices();
      setStatus(error.message || "Backstage setup is unavailable.");
    }
  };

  const navigateToAuth = (path) => {
    if (!workerBase) return;
    const url = new URL(`${workerBase}${path}`);
    url.searchParams.set("returnTo", window.location.href);
    window.location.href = url.href;
  };

  const createEnrollment = async () => {
    if (!canProvision()) {
      if (enrollmentStatus) enrollmentStatus.textContent = "Direct provisioning identity verification is required.";
      return;
    }
    if (!window.confirm("Create a revocable Backstage credential for this Mac? The secret is shown once and must be pasted into the native app.")) return;
    if (createButton) createButton.disabled = true;
    if (enrollmentStatus) enrollmentStatus.textContent = "Creating the one-time device credential…";
    try {
      const body = await apiFetch(ownerPath("/devices"), {
        method: "POST",
        body: JSON.stringify({ name: "Backstage Mac", platform: navigator.platform || "macOS" }),
      });
      const code = encodeEnrollment({
        deviceId: body.device?.id || "",
        deviceCredential: body.deviceCredential || "",
      });
      if (!body.device?.id || !body.deviceCredential || !code) throw new Error("The credential service returned an incomplete enrollment.");
      if (codeField) codeField.value = code;
      if (codeWrap) codeWrap.hidden = false;
      if (copyButton) copyButton.disabled = false;
      if (enrollmentStatus) enrollmentStatus.textContent = "Code created once. Paste it into Backstage, then clear the clipboard.";
      await loadDevices();
    } catch (error) {
      if (enrollmentStatus) enrollmentStatus.textContent = error.message || "Could not create the Backstage enrollment code.";
    } finally {
      if (createButton) createButton.disabled = false;
    }
  };

  const copyEnrollment = async () => {
    const code = String(codeField?.value || "");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      if (enrollmentStatus) enrollmentStatus.textContent = "Copied. Paste into Backstage now; the app stores it in Keychain.";
    } catch {
      codeField?.focus();
      codeField?.select();
      if (enrollmentStatus) enrollmentStatus.textContent = "Clipboard access was blocked. The code is selected for manual copy.";
    }
  };

  const revokeDevice = async (device) => {
    if (!canProvision() || !device?.id) return;
    if (!window.confirm(`Revoke ${device.name || "this Backstage device"}? Its sessions will stop working and it cannot mint another access token.`)) return;
    try {
      await apiFetch(ownerPath(`/devices/${encodeURIComponent(device.id)}/revoke`), { method: "POST", body: "{}" });
      if (enrollmentStatus) enrollmentStatus.textContent = `${device.name || "Backstage device"} revoked.`;
      await loadDevices();
    } catch (error) {
      if (enrollmentStatus) enrollmentStatus.textContent = error.message || "Could not revoke the Backstage device.";
    }
  };

  loginButton?.addEventListener("click", () => navigateToAuth("/auth/google/login"));
  logoutButton?.addEventListener("click", () => navigateToAuth("/auth/logout"));
  createButton?.addEventListener("click", createEnrollment);
  copyButton?.addEventListener("click", copyEnrollment);
  refreshButton?.addEventListener("click", loadDevices);
  loadSession();
})();
