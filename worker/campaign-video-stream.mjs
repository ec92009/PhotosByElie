import { videoError } from "./campaign-video-contract.mjs";

/** Parse one byte range; never pass arbitrary request headers through to R2. */
export function videoRange(value, size) {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw videoError(416, "campaign_video_range_invalid");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start
      || (!match[1] && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1))) {
    throw videoError(416, "campaign_video_range_invalid");
  }
  return { offset: start, length: end - start + 1 };
}

/** Inspect just the leading MP4 box, count all bytes, and preserve backpressure. */
function mp4Validator(expectedLength, beforeCommit) {
  const prefix = new Uint8Array(12);
  let count = 0;
  let signatureChecked = false;
  let tail = null;
  return new TransformStream({
    transform(chunk, controller) {
      if (!(chunk instanceof Uint8Array) || count + chunk.byteLength > expectedLength) {
        throw videoError(400, "campaign_video_length_mismatch");
      }
      if (count < prefix.length) prefix.set(chunk.subarray(0, prefix.length - count), count);
      count += chunk.byteLength;
      if (!signatureChecked && count >= prefix.length) {
        const boxSize = new DataView(prefix.buffer).getUint32(0);
        if (String.fromCharCode(...prefix.subarray(4, 8)) !== "ftyp" || boxSize < 12 || boxSize > expectedLength) {
          throw videoError(415, "campaign_video_mp4_required");
        }
        signatureChecked = true;
      }
      // Do not deliver the final declared byte to R2 before actual source EOF.
      // A fixed-length consumer may otherwise commit a valid prefix before a
      // later oversized/truncated source failure is observed by the pump.
      if (chunk.byteLength) {
        if (tail) controller.enqueue(tail);
        if (chunk.byteLength > 1) controller.enqueue(chunk.subarray(0, chunk.byteLength - 1));
        tail = chunk.slice(-1);
      }
    },
    async flush(controller) {
      if (count !== expectedLength || !signatureChecked) throw videoError(400, "campaign_video_length_mismatch");
      // Recheck catalog and lifecycle after input EOF but before R2 can commit.
      await beforeCommit?.();
      controller.enqueue(tail);
    },
  });
}

/** Conditional R2 streaming PUT; all pumps settle even on cancellation/conflict. */
export async function putVideoStream(bucket, key, request, record,
  fixedLength = (size) => new FixedLengthStream(size), beforeCommit) {
  const { video } = record.binding;
  if (!request.body) throw videoError(400, "campaign_video_body_required");
  const stream = fixedLength(video.size);
  const abort = new AbortController();
  const pump = request.body.pipeThrough(mp4Validator(video.size, beforeCommit)).pipeTo(stream.writable, { signal: abort.signal });
  const upload = (async () => {
    try {
      return await bucket.put(key, stream.readable, {
        onlyIf: new Headers({ "if-none-match": "*" }),
        sha256: video.sha256,
        httpMetadata: { contentType: "video/mp4", cacheControl: "private, no-store, max-age=0" },
        customMetadata: { bindingSha256: record.bindingSha256, videoSha256: video.sha256 },
      });
    } finally { abort.abort(); }
  })();
  const [written, streamed] = await Promise.allSettled([upload, pump]);
  if (written.status === "fulfilled" && written.value === null) return null;
  if (streamed.status === "rejected" && streamed.reason?.code?.startsWith("campaign_video_")) {
    throw streamed.reason;
  }
  if (written.status !== "fulfilled" || streamed.status !== "fulfilled") {
    throw videoError(503, "campaign_video_upload_unconfirmed");
  }
  return written.value;
}
