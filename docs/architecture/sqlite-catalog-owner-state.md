# SQLite Catalog And Owner State

Date: 2026-05-16

PhotosByElie is moving toward two SQLite files with different trust boundaries:

- `assets/catalog/photosbyelie.sqlite`: public/deployable catalog truth.
- `assets/owner-actions/Owner.sqlite`: local Owner-only workflow truth, ignored by Git.

The goal is to eliminate alternate sources of truth. During migration, TSV and JSON files may still exist as compatibility exports, but the durable direction is that they are generated from SQLite or retired.

## Public Catalog DB

The public catalog database keeps the main media row dense and readable. The
rule is:

- keep stable external identities as text, especially `media_id`, because it
  drives URLs and R2 key conventions;
- keep descriptive/free-text fields in place, such as `title`, `description`,
  `exposure`, `focal_length`, `original_file`, and `location`;
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
media_items
media_assets
```

The populated compact-id database currently contains:

```text
collections:     9
cameras:         12
lenses:          18
media_types:     2
source_origins:  2
formats:         6
asset_types:     7
keyword_terms:   3,112
media_items:     5,827
media_assets:    34,962
```

Size check from the compact-id rebuild:

```text
Raw SQLite:         6.6 MiB
SQLite gzip -9:     0.89 MiB
SQLite brotli -11:  0.46 MiB
Current TSV gzip:   0.55 MiB
```

The active count dropped from 5,844 to 5,827 after 17 discarded/tombstoned rows
were removed from the public catalog. Those media objects had already been
purged from R2, so keeping them in public metadata caused missing-preview cards.
The validator now rejects discarded/tombstoned ids in the public catalog and
Expo manifest.

The brotli-compressed SQLite catalog is smaller than the current gzipped TSV
catalog. Later pages should reopen the same database from browser cache instead
of downloading catalog data again.

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
CREATE TABLE media_items (
  media_id            TEXT PRIMARY KEY,
  collection_id       INTEGER NOT NULL,
  media_type_id       INTEGER NOT NULL,
  camera_id           INTEGER,
  lens_id             INTEGER,
  title               TEXT NOT NULL CHECK (trim(title) <> ''),
  description         TEXT,
  keyword_ids         TEXT,
  source_origin_id    INTEGER,
  width               INTEGER NOT NULL CHECK (width > 0),
  height              INTEGER NOT NULL CHECK (height > 0),
  duration_seconds    REAL,
  captured_at         TEXT,
  exposure            TEXT,
  focal_length        TEXT,
  original_file       TEXT,
  original_format_id INTEGER NOT NULL,
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
  FOREIGN KEY (original_format_id) REFERENCES formats(format_id),
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
media_type_id:       1
camera_id:           1
lens_id:             11
title:               IMG 1219
description:         null
keyword_ids:         1583
source_origin_id:    1
width:               4284
height:              5712
duration_seconds:    null
captured_at:         2025-05-12T18:37:28
exposure:            1/731, f/1.6, ISO 50
focal_length:        6.0 mm / 26 mm equivalent
original_file:       IMG_1219.jpeg
original_format_id:  1
location:            Italy
gps_latitude:        null
gps_longitude:       null
created_at:          null
updated_at:          null
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

Existing private render triplets are still sellable photo deliverables. Their current R2 keys use the older `renders/<media_id>/<original-file>-jpg-1mp.jpg`, `...-jpg-3mp.jpg`, and `...-jpg-6mp.jpg` shape. The SQLite-era target is the flatter `renders/<media_id>_1mp.jpg`, `renders/<media_id>_3mp.jpg`, and `renders/<media_id>_6mp.jpg` shape. Keep old keys until checkout, delivery, and migration audit confirm the new keys are live.

## Owner DB

`Owner.sqlite` is local-only and ignored:

```text
assets/owner-actions/Owner.sqlite
assets/owner-actions/Owner.sqlite-*
```

It replaces Owner workflow JSON as the private source of truth. Accepted review decisions update the public catalog DB; pending, rejected, parked, blocked, and proposal history remain local.

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

The populated test database currently contains:

```text
owner_settings:           2
keyword_blacklist:        30
country_assignments:      1,553
title_keyword_batches:    5
title_keyword_queue:      662
title_keyword_proposals:  500
title_keyword_decisions:  398
```

Important migration finding: 162 queue rows refer to batch ids whose current batch files no longer contain proposal detail. That confirms the alternate-source-of-truth problem. SQLite can preserve the current queue state, but it cannot reconstruct proposal bodies that were already overwritten or orphaned in JSON.

## R2 Migration Strategy

R2 has no native atomic rename. The safe move is:

```text
CopyObject old_key -> new_key
HEAD/verify new_key
record success
delete old_key only after all code and manifests use the new convention
```

Phase 1 should copy private masters from:

```text
masters/<media_id>/<original_file>
```

to:

```text
masters/<media_id>.<format extension>
```

and keep old keys temporarily. Public preview assets remain first-class at `expo/<media_id>_900.jpg` for photo/video gallery previews, `expo/<media_id>_1800.jpg` for photo detail previews, and `expo/<media_id>_short_5s_720p.mp4` for video detail previews. Private photo render triplets should be copied from the old nested keys to the flatter `renders/<media_id>_{1,3,6}mp.jpg` keys and kept in both places until the runtime no longer references the old keys.
