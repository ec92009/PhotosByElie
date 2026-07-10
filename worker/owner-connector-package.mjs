export const createR2OwnerConnectorPackage = ({
  bucket,
  key = "owner-connectors/photosbyelie-mac-connector.zip",
} = {}) => {
  if (!bucket) throw new Error("createR2OwnerConnectorPackage requires an R2 bucket binding.");
  const cleanKey = String(key || "").replace(/^\/+/, "");

  return {
    getMacPackage: async () => {
      const object = await bucket.get(cleanKey);
      if (!object) return null;
      return {
        body: object.body,
        headers: {
          "content-type": object.httpMetadata?.contentType || "application/zip",
          "content-length": String(object.size || ""),
          "content-disposition": 'attachment; filename="PhotosByElie-Mac-Connector.zip"',
          "cache-control": "private, no-store",
        },
      };
    },
  };
};
