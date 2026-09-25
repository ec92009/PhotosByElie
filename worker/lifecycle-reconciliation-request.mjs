/** Parse the connector-only reconciliation body without trusting Content-Length.
 * Existing apply envelopes have a 1 MiB ceiling; the new preparation request
 * is limited to 64 KiB. Authentication must happen before this reader is used.
 */
export async function readReconciliationRequest(request) {
  const tooLarge = () => Object.assign(new Error("Lifecycle reconciliation request exceeds its size limit."), {
    status: 413, code: "lifecycle_reconciliation_too_large",
  });
  const reader = request.body?.getReader();
  const chunks = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1048576) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let payload;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch {
    throw Object.assign(new Error("Request body must be valid UTF-8 JSON."), { status: 400, code: "invalid_json" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("Reconciliation requires a JSON object."), { status: 400, code: "invalid_json" });
  }
  if (payload.prepareOnly === true && bytes > 65536) throw tooLarge();
  return payload;
}
