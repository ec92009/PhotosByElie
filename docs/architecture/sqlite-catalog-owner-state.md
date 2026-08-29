# SQLite Catalog And Owner State

Date: 2026-08-29

PhotosByElie uses two SQLite files with different trust boundaries and one
normal editable authority:

- `assets/owner-actions/Owner.sqlite`: the local Owner-only, sole normal editable
  authority for identity, workflow, public metadata, collection membership,
  and publication state; ignored by Git.
- `assets/catalog/photosbyelie.sqlite`: a deterministic, privacy-safe, read-only
  projection and deployment artifact for public browser use.

The projection boundary is one-way: supported Owner operations write
`Owner.sqlite`, then guarded projection and deployment paths regenerate and
verify the public catalog. The browser loads plain `photosbyelie.sqlite`
directly; normal catalog rebuilds do not generate or prefer a Brotli-compressed
copy. Owner JSON files are compatibility views, handoff files, or audit
artifacts, never alternate write authorities. The dated migration and parity
receipt is [PBE-173 Owner/catalog migration audit](../audits/pbe-173-owner-catalog-migration.md).

## Public Catalog DB

The public catalog database keeps the main media row dense and readable. The
rule is:

- keep stable external identities as text, especially `media_id`, because it
  drives URLs and R2 key conventions;
- keep descriptive/free-text media fields in place, such as `title`,
  `description`, `exposure`, `focal_length`, and `location`;
- store original source provenance through `source_folders` and `source_files`,
  with `media_items.source_file_id` pointing to the original file record;
- store original dimensions, duration, bytes, and format on the `full`
  `media_assets` row instead of duplicating those facts in `media_items`;
- store controlled/repeated values as short integer references into lookup
  tables;
- store a media item's keywords as a comma-separated list of short integer
  keyword ids in `media_items.keyword_ids`.

The public catalog tables are:

```text
collections
cameras
lenses
media_types
source_origins
formats
asset_types
keyword_terms
source_folders
source_files
media_items
media_assets
price_tiers
products
product_prices
frame_options
frame_prices
shipping_handling_prices
video_price_tiers
pod_settings
pod_suppliers
pod_quality_tiers
pod_options
```

Historical size check from the 2026-05-17 compact-id rebuild:

```text
Raw SQLite:         6.6 MiB
SQLite gzip -9:     1.04 MiB
SQLite brotli -11:  0.50 MiB
```

Live row counts are deliberately omitted from this architecture contract. Use
the current Owner projection and deployment receipts for operational counts.
The validator rejects discarded or tombstoned identities in the public catalog
and Expo manifest.

Plain `assets/catalog/photosbyelie.sqlite` is the active public transfer artifact.
Later pages should reopen the same database from browser cache instead of
downloading catalog data again.

## Catalog Tables

```sql
CREATE TABLE collections (
  collection_id INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (trim(slug) <> ''),
  title         TEXT NOT NULL CHECK (trim(title) <> ''),
  description   TEXT,
  scope         TEXT,
  sort_order    INTEGER,
  created_at    TEXT,
  updated_at    TEXT
);
```

```sql
CREATE TABLE cameras (
  camera_id INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE CHECK (trim(name) <> ''),
  maker     TEXT,
  model     TEXT
);
```

```sql
CREATE TABLE lenses (
  lens_id INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE CHECK (trim(name) <> ''),
  maker   TEXT,
  model   TEXT
);
```

```sql
CREATE TABLE media_types (
  media_type_id INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE CHECK (code IN ('photo', 'video'))
);
```

```sql
CREATE TABLE source_origins (
  source_origin_id INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE CHECK (trim(code) <> '')
);
```

```sql
CREATE TABLE formats (
  format_id  INTEGER PRIMARY KEY,
  extension  TEXT NOT NULL UNIQUE CHECK (
    extension IN ('jpg','tif','png','heic','mp4','mov')
  )
);
```

```sql
CREATE TABLE asset_types (
  asset_type_id INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE CHECK (
    code IN (
      'still_900',
      'still_1800',
      'short_5s_720p',
      'jpeg_1mp',
      'jpeg_3mp',
      'jpeg_6mp',
      'full'
    )
  )
);
```

```sql
CREATE TABLE keyword_terms (
  keyword_id INTEGER PRIMARY KEY,
  keyword    TEXT NOT NULL UNIQUE CHECK (trim(keyword) <> '')
);
```

```sql
CREATE TABLE source_folders (
  source_folder_id INTEGER PRIMARY KEY,
  source_folder    TEXT NOT NULL UNIQUE
);
```

```sql
CREATE TABLE source_files (
  source_file_id   INTEGER PRIMARY KEY,
  source_folder_id INTEGER NOT NULL,
  filename         TEXT NOT NULL CHECK (trim(filename) <> ''),
  format_id        INTEGER NOT NULL,

  FOREIGN KEY (source_folder_id) REFERENCES source_folders(source_folder_id),
  FOREIGN KEY (format_id) REFERENCES formats(format_id)
);
```

```sql
CREATE TABLE price_tiers (
  price_tier_id  TEXT PRIMARY KEY CHECK (trim(price_tier_id) <> ''),
  label          TEXT NOT NULL CHECK (trim(label) <> ''),
  sort_order     INTEGER NOT NULL CHECK (sort_order > 0)
) WITHOUT ROWID;
```

```sql
CREATE TABLE products (
  product_id             TEXT PRIMARY KEY CHECK (trim(product_id) <> ''),
  product_type           TEXT NOT NULL CHECK (product_type IN ('digital', 'print')),
  label                  TEXT NOT NULL CHECK (trim(label) <> ''),
  detail                 TEXT,
  dimensions_imperial    TEXT,
  dimensions_metric      TEXT,
  min_megapixels         REAL CHECK (min_megapixels IS NULL OR min_megapixels >= 0),
  delivery_asset_type_id INTEGER,
  base_price_cents       INTEGER NOT NULL CHECK (base_price_cents >= 0),
  sort_order             INTEGER NOT NULL CHECK (sort_order > 0),
  active                 INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  FOREIGN KEY (delivery_asset_type_id) REFERENCES asset_types(asset_type_id)
) WITHOUT ROWID;
```

```sql
CREATE TABLE product_prices (
  product_id      TEXT NOT NULL,
  price_tier_id   TEXT NOT NULL,
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (product_id, price_tier_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  FOREIGN KEY (price_tier_id) REFERENCES price_tiers(price_tier_id)
) WITHOUT ROWID;
```

```sql
CREATE TABLE frame_options (
  frame_id          TEXT PRIMARY KEY CHECK (trim(frame_id) <> ''),
  label             TEXT NOT NULL CHECK (trim(label) <> ''),
  base_price_cents  INTEGER NOT NULL CHECK (base_price_cents >= 0),
  sort_order        INTEGER NOT NULL CHECK (sort_order > 0),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) WITHOUT ROWID;
```

```sql
CREATE TABLE frame_prices (
  frame_id      TEXT NOT NULL,
  product_id    TEXT NOT NULL,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (frame_id, product_id),
  FOREIGN KEY (frame_id) REFERENCES frame_options(frame_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
) WITHOUT ROWID;
```

```sql
CREATE TABLE shipping_handling_prices (
  product_id    TEXT PRIMARY KEY,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
) WITHOUT ROWID;
```

```sql
CREATE TABLE video_price_tiers (
  video_price_tier_id   TEXT PRIMARY KEY CHECK (trim(video_price_tier_id) <> ''),
  label                 TEXT NOT NULL CHECK (trim(label) <> ''),
  min_duration_seconds  REAL NOT NULL CHECK (min_duration_seconds >= 0),
  max_duration_seconds  REAL CHECK (max_duration_seconds IS NULL OR max_duration_seconds > min_duration_seconds),
  price_cents           INTEGER NOT NULL CHECK (price_cents >= 0),
  sort_order            INTEGER NOT NULL CHECK (sort_order > 0)
) WITHOUT ROWID;
```

```sql
CREATE TABLE pod_settings (
  setting_key   TEXT PRIMARY KEY CHECK (trim(setting_key) <> ''),
  setting_value TEXT NOT NULL
) WITHOUT ROWID;
```

```sql
CREATE TABLE pod_suppliers (
  supplier_id         TEXT PRIMARY KEY CHECK (trim(supplier_id) <> ''),
  label               TEXT NOT NULL CHECK (trim(label) <> ''),
  role                TEXT NOT NULL CHECK (trim(role) <> ''),
  automation_status   TEXT NOT NULL CHECK (trim(automation_status) <> ''),
  api_base_url        TEXT,
  api_docs_url        TEXT,
  quote_support       TEXT,
  order_support       TEXT,
  webhook_support     TEXT,
  sandbox_support     TEXT,
  fulfillment_regions TEXT,
  notes               TEXT,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order          INTEGER NOT NULL CHECK (sort_order > 0)
) WITHOUT ROWID;
```

```sql
CREATE TABLE pod_quality_tiers (
  quality_tier_id   TEXT PRIMARY KEY CHECK (trim(quality_tier_id) <> ''),
  label             TEXT NOT NULL CHECK (trim(label) <> ''),
  supplier_id       TEXT NOT NULL,
  buyer_label       TEXT,
  quality_position  TEXT,
  print_profile     TEXT,
  frame_profile     TEXT,
  price_position    TEXT,
  automation_status TEXT NOT NULL CHECK (trim(automation_status) <> ''),
  notes             TEXT,
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order        INTEGER NOT NULL CHECK (sort_order > 0),

  FOREIGN KEY (supplier_id) REFERENCES pod_suppliers(supplier_id) ON DELETE CASCADE
) WITHOUT ROWID;
```

```sql
CREATE TABLE pod_options (
  pod_option_id              TEXT PRIMARY KEY CHECK (trim(pod_option_id) <> ''),
  supplier_id                TEXT NOT NULL,
  product_id                 TEXT NOT NULL,
  frame_id                   TEXT NOT NULL,
  market_region              TEXT NOT NULL CHECK (trim(market_region) <> ''),
  currency                   TEXT NOT NULL CHECK (trim(currency) <> ''),
  supplier_product_id        TEXT,
  supplier_variant_id        TEXT,
  supplier_sku               TEXT,
  supplier_size              TEXT,
  supplier_item_cost_cents   INTEGER CHECK (supplier_item_cost_cents IS NULL OR supplier_item_cost_cents >= 0),
  supplier_shipping_cents    INTEGER CHECK (supplier_shipping_cents IS NULL OR supplier_shipping_cents >= 0),
  supplier_total_cents       INTEGER CHECK (supplier_total_cents IS NULL OR supplier_total_cents >= 0),
  quote_supported            INTEGER NOT NULL DEFAULT 0 CHECK (quote_supported IN (0, 1)),
  order_supported            INTEGER NOT NULL DEFAULT 0 CHECK (order_supported IN (0, 1)),
  requires_account           INTEGER NOT NULL DEFAULT 1 CHECK (requires_account IN (0, 1)),
  fulfillment_model          TEXT,
  api_quote_mode             TEXT,
  api_order_mode             TEXT,
  source_url                 TEXT,
  notes                      TEXT,
  active                     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order                 INTEGER NOT NULL CHECK (sort_order > 0),

  FOREIGN KEY (supplier_id) REFERENCES pod_suppliers(supplier_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  FOREIGN KEY (frame_id) REFERENCES frame_options(frame_id)
) WITHOUT ROWID;
```

```sql
CREATE TABLE media_items (
  media_id            TEXT PRIMARY KEY,
  collection_id       INTEGER NOT NULL,
  sort_index          INTEGER NOT NULL CHECK (sort_index >= 0),
  media_type_id       INTEGER NOT NULL,
  camera_id           INTEGER,
  lens_id             INTEGER,
  title               TEXT NOT NULL CHECK (trim(title) <> ''),
  description         TEXT,
  keyword_ids         TEXT,
  source_origin_id    INTEGER,
  captured_at         TEXT,
  exposure            TEXT,
  focal_length        TEXT,
  source_file_id      INTEGER NOT NULL,
  location            TEXT,
  gps_latitude        REAL CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
  gps_longitude       REAL CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
  created_at          TEXT,
  updated_at          TEXT,

  FOREIGN KEY (collection_id) REFERENCES collections(collection_id),
  FOREIGN KEY (media_type_id) REFERENCES media_types(media_type_id),
  FOREIGN KEY (camera_id) REFERENCES cameras(camera_id),
  FOREIGN KEY (lens_id) REFERENCES lenses(lens_id),
  FOREIGN KEY (source_origin_id) REFERENCES source_origins(source_origin_id),
  FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id),
  CHECK (
    (gps_latitude IS NULL AND gps_longitude IS NULL)
    OR
    (gps_latitude IS NOT NULL AND gps_longitude IS NOT NULL)
  )
) WITHOUT ROWID;
```

```sql
CREATE TABLE media_assets (
  media_id          TEXT NOT NULL,
  asset_type_id     INTEGER NOT NULL,
  width             INTEGER NOT NULL CHECK (width > 0),
  height            INTEGER NOT NULL CHECK (height > 0),
  duration_seconds  REAL CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  bytes             INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  format_id         INTEGER NOT NULL,

  PRIMARY KEY (media_id, asset_type_id),
  FOREIGN KEY (media_id) REFERENCES media_items(media_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_type_id) REFERENCES asset_types(asset_type_id),
  FOREIGN KEY (format_id) REFERENCES formats(format_id)
) WITHOUT ROWID;
```

Example `media_items` row in the compact-id shape:

```text
media_id:            img-1219-570b09bebb
collection_id:       6
sort_index:          0
media_type_id:       1
camera_id:           1
lens_id:             11
title:               IMG 1219
description:         null
keyword_ids:         1583
source_origin_id:    1
captured_at:         2025-05-12T18:37:28
exposure:            1/731, f/1.6, ISO 50
focal_length:        6.0 mm / 26 mm equivalent
source_file_id:      42
location:            Italy
gps_latitude:        null
gps_longitude:       null
created_at:          null
updated_at:          null
```

The original file facts are reconstructed by joining through `source_files`,
`source_folders`, and the `full` `media_assets` row:

```text
source_folders.source_folder: 2025 Cordoba, la Mezquita
source_files.filename:        IMG_1219.jpeg
source_files.format_id:       1
media_assets(full).width:     4284
media_assets(full).height:    5712
```

```sql
CREATE TRIGGER media_assets_photo_deliverable_insert
BEFORE INSERT ON media_assets
WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id)
       IN ('jpeg_1mp', 'jpeg_3mp', 'jpeg_6mp')
  AND NOT EXISTS (
    SELECT 1
    FROM media_items
    JOIN media_types USING (media_type_id)
    WHERE media_items.media_id = NEW.media_id
      AND media_types.code = 'photo'
  )
BEGIN
  SELECT RAISE(ABORT, 'photo JPEG deliverables require media_type photo');
END;

CREATE TRIGGER media_assets_photo_detail_preview_insert
BEFORE INSERT ON media_assets
WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id)
       = 'still_1800'
  AND NOT EXISTS (
    SELECT 1
    FROM media_items
    JOIN media_types USING (media_type_id)
    WHERE media_items.media_id = NEW.media_id
      AND media_types.code = 'photo'
  )
BEGIN
  SELECT RAISE(ABORT, 'photo detail previews require media_type photo');
END;

CREATE TRIGGER media_assets_short_video_insert
BEFORE INSERT ON media_assets
WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id)
       = 'short_5s_720p'
  AND NOT EXISTS (
    SELECT 1
    FROM media_items
    JOIN media_types USING (media_type_id)
    WHERE media_items.media_id = NEW.media_id
      AND media_types.code = 'video'
  )
BEGIN
  SELECT RAISE(ABORT, 'short video previews require media_type video');
END;
```

The database also has matching update triggers for the same media-type rules.

## Asset Key Convention

Asset keys are conventions, not stored database fields:

```text
still_900       -> expo/<media_id>_900.jpg
still_1800      -> expo/<media_id>_1800.jpg
short_5s_720p   -> expo/<media_id>_short_5s_720p.mp4
jpeg_1mp        -> renders/<media_id>_1mp.jpg
jpeg_3mp        -> renders/<media_id>_3mp.jpg
jpeg_6mp        -> renders/<media_id>_6mp.jpg
full            -> masters/<media_id>.<format extension>
```

For photos:

- gallery uses `still_900`;
- detail uses `still_1800`;
- buyer delivery can use `jpeg_1mp`, `jpeg_3mp`, `jpeg_6mp`, or `full`.

For video:

- the gallery uses `still_900`, generated from 10% into the source video;
- the detail page uses `short_5s_720p`, a 5-second watermarked 720p clip;
- customer delivery is the `full` original only.

Private render triplets remain sellable photo deliverables, but only under the flat SQLite-era keys: `renders/<media_id>_1mp.jpg`, `renders/<media_id>_3mp.jpg`, and `renders/<media_id>_6mp.jpg`. The older nested render paths are retired and should stay out of runtime checkout, delivery, sidecar generation, and routine purge code.

## Owner DB

`Owner.sqlite` is local-only and ignored:

```text
assets/owner-actions/Owner.sqlite
assets/owner-actions/Owner.sqlite-*
```

It replaces Owner workflow JSON as the sole normal editable authority. Accepted
review decisions become public only through the guarded catalog projection;
pending, rejected, parked, blocked, and proposal history remain local.

Current draft tables:

```text
owner_settings
keyword_blacklist
country_assignments
title_keyword_batches
title_keyword_queue
title_keyword_proposals
title_keyword_decisions
```

Because this database never travels on the public internet, size is not a constraint. It carries explicit workflow indexes for review state, batch lookup, proposal status/confidence, decision timing, country assignment, and blacklist maintenance.

Live workflow counts are deliberately omitted from this architecture contract.
Use Backstage and the current Owner receipts for operational queue totals.

`Owner.sqlite` owns title/keyword batches, queue state, proposals, decisions, country assignments, and keyword blacklist entries. The localhost helper writes decisions, country assignments, and blacklist changes into the DB, then exports only the JSON views that the current UI, handoff path, or audit trail still needs. `title-keyword-review-queue/proposed-state.json` is retired; the corresponding state lives in `title_keyword_queue`, `title_keyword_proposals`, and `title_keyword_decisions`.

## R2 Media Key Contract

The PhotosByElie gallery storage migration to flat media keys is complete. Runtime checkout, delivery validation, Owner purge, and generated sidecars use only the active key families:

```text
photosbyelie-public/expo/<media_id>_900.jpg
photosbyelie-public/expo/<media_id>_1800.jpg
photosbyelie-public/expo/<media_id>_short_5s_720p.mp4
photosbyelie-private/masters/<media_id>.<format extension>
photosbyelie-private/renders/<media_id>_6mp.jpg
photosbyelie-private/renders/<media_id>_3mp.jpg
photosbyelie-private/renders/<media_id>_1mp.jpg
```

Photo media uses the `_900`, `_1800`, master, and 6/3/1 MP render keys. Video media uses `_900`, `_short_5s_720p.mp4`, and the private master only; it should not generate private JPG render delete probes.

The old migration shapes are retired:

```text
masters/<media_id>/<original_file>
renders/<media_id>/<original_file>-jpg-6mp.jpg
renders/<media_id>/<original_file>-jpg-3mp.jpg
renders/<media_id>/<original_file>-jpg-1mp.jpg
expo/<collection>/<media_id>_900.jpg
expo/<collection>/<media_id>_1800.jpg
```

They may remain in historical manifests or `deleted_confirmed` Owner.sqlite rows for audit purposes only. If a future audit finds legacy-shaped keys in `current` or `marked_for_delete`, use `scripts/cleanup_legacy_r2_keys.mjs` to delete and mark them confirmed instead of putting those paths back into routine purge code.
