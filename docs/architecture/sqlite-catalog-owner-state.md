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
media_assets:  11,688
```

Size check from the first populated pass:

```text
Raw SQLite:        20.88 MiB
SQLite gzip -9:     1.71 MiB
SQLite brotli -11:  0.86 MiB
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
    asset_type IN ('preview_still_900', 'preview_video_720p', 'full')
  ),
  width             INTEGER NOT NULL CHECK (width > 0),
  height            INTEGER NOT NULL CHECK (height > 0),
  duration_seconds  REAL CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  bytes             INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  format            TEXT NOT NULL CHECK (format IN ('jpg','tif','png','heic','mp4','mov')),

  PRIMARY KEY (media_id, asset_type),
  FOREIGN KEY (media_id) REFERENCES media_items(media_id) ON DELETE CASCADE,

  CHECK (
    asset_type <> 'preview_video_720p'
    OR
    (duration_seconds IS NOT NULL AND duration_seconds > 0 AND format = 'mp4')
  ),
  CHECK (
    asset_type <> 'preview_still_900'
    OR
    (duration_seconds IS NULL AND format = 'jpg')
  )
) WITHOUT ROWID;
```

## Asset Key Convention

Asset keys are conventions, not stored database fields:

```text
preview_still_900   -> expo/<media_id>_900.jpg
preview_video_720p  -> expo/<media_id>_preview_720p.mp4
full                -> masters/<media_id>.<original_format>
```

For video:

- the gallery uses `preview_still_900`, generated from 10% into the source video;
- the detail page may use `preview_video_720p`, a 5-second watermarked clip;
- customer delivery is the `full` original only.

The old private render triplets are retired in the new model. Existing `renders/...jpg-1mp/3mp/6mp.jpg` R2 objects should be removed only after checkout/worker delivery is switched to full-original delivery and the migration audit proves they are unused.

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

and keep old keys temporarily. Public `expo/<media_id>_900.jpg` previews already match the new convention. The older `expo/<media_id>_1800.jpg` previews and private render triplets are cleanup candidates after the runtime no longer references them.
