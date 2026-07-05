ALTER TABLE pbe_access_audience_groups
  ADD COLUMN gallery_defaults_json TEXT NOT NULL DEFAULT '{}';
