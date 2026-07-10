const textBytes = (value) => new TextEncoder().encode(String(value || ""));

const digest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", textBytes(value)));

const timingSafeDigestEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
};

const bearerToken = (request) => {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers.get("authorization") || "").trim());
  return match ? match[1].trim() : "";
};

const connectorError = (status, code, message) => Object.assign(new Error(message), { status, code });

const normalizeCredentials = (credentials) => Object.entries(credentials || {})
  .map(([id, token]) => ({
    id: String(id || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80),
    token: String(token || "").trim(),
  }))
  .filter((entry) => entry.id && entry.token);

export const createOwnerConnectorAuth = ({ credentials = {} } = {}) => {
  const entries = normalizeCredentials(credentials);

  return {
    requireConnector: async (request) => {
      if (!entries.length) {
        throw connectorError(503, "owner_connector_auth_unavailable", "Owner connector authentication is not configured.");
      }
      const token = bearerToken(request);
      if (!token) throw connectorError(401, "owner_connector_auth_required", "Owner connector authentication is required.");
      const candidateDigest = await digest(token);
      for (const entry of entries) {
        if (timingSafeDigestEqual(candidateDigest, await digest(entry.token))) {
          return { connectorId: entry.id };
        }
      }
      throw connectorError(403, "owner_connector_auth_forbidden", "Owner connector credential was not accepted.");
    },
  };
};
