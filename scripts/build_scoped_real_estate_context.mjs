#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const usage = () => {
  console.error("Usage: build_scoped_real_estate_context.mjs --source FILE --output FILE --album SLUG --gallery-key KEY --customer NAME [--email EMAIL] [--gallery-title TITLE]");
  process.exit(2);
};

const argsFor = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) usage();
    args[flag.slice(2)] = value;
  }
  return args;
};

const loadContext = (sourcePath) => {
  const sourceUrl = new URL(`file://${path.resolve(sourcePath)}`);
  const sandbox = {
    URL,
    document: { currentScript: { src: sourceUrl.href } },
    window: { location: { href: sourceUrl.href }, photosByElieData: {} },
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), sandbox, { filename: sourcePath });
  return structuredClone(sandbox.window.photosByElieRealEstateImport || {});
};

const contextSource = (payload) => `(() => {
  const payload = ${JSON.stringify(payload, null, 2)};
  const script = document.currentScript;
  const base = script?.src ? new URL("./", script.src) : new URL("./", window.location.href);
  const absoluteUrl = (value) => {
    if (!value || /^(https?:|data:|blob:|\\/)/i.test(value)) return value || "";
    return new URL(value, base).href;
  };
  const photos = (payload.photos || []).map((photo) => {
    const publicPreview = photo.media?.publicPreview || {};
    const pdfSource = photo.cloudPdfSource || {};
    return {
      ...photo,
      media: {
        ...(photo.media || {}),
        publicPreview: {
          ...publicPreview,
          galleryUrl: absoluteUrl(publicPreview.galleryUrl || photo.gallerySrc),
          detailUrl: absoluteUrl(publicPreview.detailUrl || photo.imageSrc),
          previewUrl: absoluteUrl(publicPreview.previewUrl || photo.imageSrc),
          thumbnailUrl: absoluteUrl(publicPreview.thumbnailUrl || photo.gallerySrc),
        },
      },
      cloudPdfSource: {
        ...pdfSource,
        imageUrl: absoluteUrl(pdfSource.imageUrl),
      },
    };
  });
  const gallery = {
    ...(payload.gallery || {}),
    photos,
  };
  window.photosByElieRealEstateImport = {
    ...payload,
    gallery,
    photos,
  };
  window.photosByElieRealEstateGalleryKey = gallery.key;
  window.photosByElieData = {
    ...(window.photosByElieData || {}),
    [gallery.key]: gallery,
  };
})();
`;

export const buildScopedContext = ({ sourcePath, albumSlug, galleryKey, customer, email = "", galleryTitle = "" }) => {
  const payload = loadContext(sourcePath);
  const photos = (payload.photos || [])
    .filter((photo) => String(photo.albumSlug || "") === albumSlug)
    .map((photo, index) => ({
      ...photo,
      sortIndex: index + 1,
      metadata: (photo.metadata || []).map((item) => item?.label === "Client" ? { ...item, value: customer } : item),
      realEstate: { ...(photo.realEstate || {}), customer },
    }));
  if (!photos.length) throw new Error(`No photos found for album slug: ${albumSlug}`);

  const sourceAlbum = (payload.albums || []).find((album) => String(album.slug || "") === albumSlug) || {};
  const workflow = structuredClone(payload.cloudPdfWorkflow || {});
  const oldGalleryKey = String(payload.gallery?.key || "");
  workflow.projectStoreKey = `photosbyelie-real-estate-projects-${galleryKey}`;
  workflow.selectionStoreKey = `photosbyelie-real-estate-liked-${galleryKey}`;
  workflow.titleStoreKey = `photosbyelie-real-estate-titles-${galleryKey}`;
  if (workflow.batchManifest) {
    workflow.batchManifest.storageKeyPattern = `real-estate/pdf-batches/${galleryKey}/{batchId}.json`;
    if (workflow.batchManifest.template) {
      workflow.batchManifest.template.galleryKey = galleryKey;
      workflow.batchManifest.template.customer = customer;
    }
  }

  const scoped = {
    ...payload,
    albums: [{
      ...sourceAlbum,
      displayTitle: sourceAlbum.displayTitle || sourceAlbum.title || albumSlug,
      photoCount: photos.length,
      sortIndex: 1,
    }],
    cloudPdfWorkflow: workflow,
    customer: { email, name: customer, username: customer },
    gallery: {
      ...(payload.gallery || {}),
      key: galleryKey,
      title: galleryTitle || customer,
      description: "Private La Concha Common-area selection gallery.",
      photos,
    },
    photos,
    stats: {
      ...(payload.stats || {}),
      albumCount: 1,
      imageCount: photos.length,
      photoCount: photos.length,
      videoCount: photos.filter((photo) => String(photo.media?.type || "photo") === "video").length,
      sourceBytes: photos.reduce((sum, photo) => sum + Number(photo.realEstate?.sourceBytes || 0), 0),
    },
  };

  const serialized = JSON.stringify(scoped);
  if (oldGalleryKey && serialized.includes(`real-estate/pdf-batches/${oldGalleryKey}/`)) {
    throw new Error("Scoped context still contains the source PDF batch prefix.");
  }
  return scoped;
};

const main = () => {
  const args = argsFor(process.argv.slice(2));
  if (!args.source || !args.output || !args.album || !args["gallery-key"] || !args.customer) usage();
  const scoped = buildScopedContext({
    sourcePath: args.source,
    albumSlug: args.album,
    galleryKey: args["gallery-key"],
    customer: args.customer,
    email: args.email || "",
    galleryTitle: args["gallery-title"] || "",
  });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, contextSource(scoped), "utf8");
  console.log(JSON.stringify({ output: args.output, galleryKey: scoped.gallery.key, albums: scoped.albums.length, photos: scoped.photos.length }));
};

if (import.meta.url === new URL(`file://${path.resolve(process.argv[1] || "")}`).href) main();
