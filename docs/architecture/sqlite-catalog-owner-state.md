# SQLite Catalog And Owner State

Date: 2026-05-16

PhotosByElie is moving toward two SQLite files with different trust boundaries:

- `assets/catalog/photosbyelie.sqlite`: public/deployable catalog truth.
- `assets/owner-actions/Owner.sqlite`: local Owner-only workflow truth, ignored by Git.

The goal is to eliminate alternate sources of truth. During migration, TSV and JSON files may still exist as compatibility exports, but the durable direction is that they are generated from SQLite or retired.

## Public Catalog DB

The public catalog database is intentionally small in table count:

```text
collections
cameras
lenses
media_items
keywords
media_assets
```

The populated test database currently contains:

```text
collections:   9
cameras:       12
lenses:        18
media_items:   5,844
keywords:      85,560
media_assets:  35,064
```

Size check from the first populated pass:

```text
Raw SQLite:        18.28 MiB
SQLite gzip -9:     1.75 MiB
SQLite brotli -11:  0.84 MiB
Current TSV gzip:   0.55 MiB
```

The SQLite catalog is larger than gzipped TSV, but still comfortably small for the public site. On the main page, replacing TSV with the brotli-compressed SQLite catalog adds roughly 500 KiB to the first visit. Later pages should reopen the same database from browser cache instead of downloading catalog data again.

## Catalog Tables

```sql
CREATE TABLE collections (
  collection_id TEXT PRIMARY KEY,
  title         TEXT NOT NULL CHECK (trim(title) <> ''),
  description   TEXT,
  scope         TEXT,
  sort_order    INTEGER,
  created_at    TEXT,
  updated_at    TEXT
) WITHOUT ROWID;
```

```sql
CREATE TABLE cameras (
  camera_id TEXT PRIMARY KEY,
  name      TEXT NOT NULL CHECK (trim(name) <> ''),
  maker     TEXT,
  model     TEXT
) WITHOUT ROWID;
```

```sql
CREATE TABLE lenses (
  lens_id TEXT PRIMARY KEY,
  name    TEXT NOT NULL CHECK (trim(name) <> ''),
  maker   TEXT,
  model   TEXT
) WITHOUT ROWID;
```

```sql
CREATE TABLE media_items (
  media_id         TEXT PRIMARY KEY,
  collection_id    TEXT NOT NULL,
  media_type       TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  camera_id        TEXT,
  lens_id          TEXT,
  title            TEXT NOT NULL CHECK (trim(title) <> ''),
  description      TEXT,
  keywords         TEXT,
  source_origin    TEXT,
  width            INTEGER NOT NULL CHECK (width > 0),
  height           INTEGER NOT NULL CHECK (height > 0),
  duration_seconds REAL,
  captured_at      TEXT,
  exposure         TEXT,
  focal_length     TEXT,
  original_file    TEXT,
  original_format  TEXT NOT NULL CHECK (original_format IN ('jpg','tif','png','heic','mp4','mov')),
  location         TEXT,
  gps_latitude     REAL CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
  gps_longitude    REAL CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
  created_at       TEXT,
  updated_at       TEXT,

  FOREIGN KEY (collection_id) REFERENCES collections(collection_id),
  FOREIGN KEY (camera_id) REFERENCES cameras(camera_id),
  FOREIGN KEY (lens_id) REFERENCES lenses(lens_id),

  CHECK (
    (media_type = 'photo' AND duration_seconds IS NULL)
    OR
    (media_type = 'video' AND duration_seconds IS NOT NULL AND duration_seconds > 0)
  ),
  CHECK (
    (gps_latitude IS NULL AND gps_longitude IS NULL)
    OR
    (gps_latitude IS NOT NULL AND gps_longitude IS NOT NULL)
  )
) WITHOUT ROWID;
```

```sql
CREATE TABLE keywords (
  keyword  TEXT NOT NULL CHECK (trim(keyword) <> ''),
  media_id TEXT NOT NULL,

  PRIMARY KEY (media_id, keyword),
  FOREIGN KEY (media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
) WITHOUT ROWID;
```

```sql
CREATE TABLE media_assets (
  media_id          TEXT NOT NULL,
  asset_type        TEXT NOT NULL CHECK (
    asset_type IN (
      'still_900',
      'still_1800',
      'short_5s_720p',
      'jpeg_1mp',
      'jpeg_3mp',
      'jpeg_6mp',
      'full'
    )
  ),
  width             INTEGER NOT NULL CHECK (width > 0),
  height            INTEGER NOT NULL CHECK (height > 0),
  duration_seconds  REAL CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  bytes             INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  format            TEXT NOT NULL CHECK (format IN ('jpg','tif','png','heic','mp4','mov')),

  PRIMARY KEY (media_id, asset_type),
  FOREIGN KEY (media_id) REFERENCES media_items(media_id) ON DELETE CASCADE,

  CHECK (
    asset_type <> 'short_5s_720p'
    OR
    (
      duration_seconds IS NOT NULL
      AND duration_seconds > 0
      AND duration_seconds <= 5.5
      AND format = 'mp4'
    )
  ),
  CHECK (
    asset_type NOT IN ('still_900', 'still_1800')
    OR
    (duration_seconds IS NULL AND format = 'jpg')
  ),
  CHECK (
    asset_type NOT IN ('jpeg_1mp', 'jpeg_3mp', 'jpeg_6mp')
    OR
    (duration_seconds IS NULL AND format = 'jpg')
  )
) WITHOUT ROWID;
```

```sql
CREATE TRIGGER media_assets_photo_deliverable_insert
BEFORE INSERT ON media_assets
WHEN NEW.asset_type IN ('jpeg_1mp', 'jpeg_3mp', 'jpeg_6mp')
  AND NOT EXISTS (
    SELECT 1 FROM media_items
    WHERE media_id = NEW.media_id AND media_type = 'photo'
  )
BEGIN
  SELECT RAISE(ABORT, 'photo JPEG deliverables require media_type photo');
END;

CREATE TRIGGER media_assets_photo_detail_preview_insert
BEFORE INSERT ON media_assets
WHEN NEW.asset_type = 'still_1800'
  AND NOT EXISTS (
    SELECT 1 FROM media_items
    WHERE media_id = NEW.media_id AND media_type = 'photo'
  )
BEGIN
  SELECT RAISE(ABORT, 'photo detail previews require media_type photo');
END;

CREATE TRIGGER media_assets_short_video_insert
BEFORE INSERT ON media_assets
WHEN NEW.asset_type = 'short_5s_720p'
  AND NOT EXISTS (
    SELECT 1 FROM media_items
    WHERE media_id = NEW.media_id AND media_type = 'video'
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
full            -> masters/<media_id>.<original_format>
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
masters/<media_id>.<original_format>
```

and keep old keys temporarily. Public photo previews at `expo/<media_id>_900.jpg` and `expo/<media_id>_1800.jpg` remain first-class assets. Private photo render triplets should be copied from the old nested keys to the flatter `renders/<media_id>_{1,3,6}mp.jpg` keys and kept in both places until the runtime no longer references the old keys.
