-- Bind the universal fixture hierarchy to authenticated shared galleries.

CREATE TABLE IF NOT EXISTS pbe_access_fixture_assets (
  fixture_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'removed')),
  synced_at TEXT NOT NULL,
  synced_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (fixture_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_pbe_access_fixture_assets_fixture
  ON pbe_access_fixture_assets(fixture_id, state, ordinal);

INSERT INTO pbe_access_people (
  email, display_name, source, fixture, notes, disabled_at, disabled_by,
  created_at, created_by, updated_at, updated_by
) VALUES (
  'ec92009pt@gmail.com', 'Avery Morgan', 'manual', 0,
  'Elie test alias for the Friends and Family end-to-end access rehearsal.',
  NULL, '', datetime('now'), 'migration:0010', datetime('now'), 'migration:0010'
) ON CONFLICT(email) DO UPDATE SET
  display_name = excluded.display_name,
  disabled_at = NULL,
  disabled_by = '',
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;

UPDATE pbe_access_group_memberships
SET state = 'revoked', revoked_at = datetime('now'), revoked_by = 'migration:0010',
    updated_at = datetime('now'), updated_by = 'migration:0010'
WHERE email = 'avery.morgan.ff-e2e-20260724@example.test' AND state = 'active';

UPDATE pbe_access_people
SET disabled_at = COALESCE(disabled_at, datetime('now')), disabled_by = 'migration:0010',
    updated_at = datetime('now'), updated_by = 'migration:0010'
WHERE email = 'avery.morgan.ff-e2e-20260724@example.test';

INSERT INTO pbe_access_group_memberships (
  id, email, group_id, state, granted_at, granted_by, revoked_at, revoked_by, updated_at, updated_by
) VALUES
  ('ff-e2e-avery-root', 'ec92009pt@gmail.com', 'friends-and-family', 'active', datetime('now'), 'migration:0010', NULL, '', datetime('now'), 'migration:0010'),
  ('ff-e2e-avery-family', 'ec92009pt@gmail.com', 'friends-and-family-family', 'active', datetime('now'), 'migration:0010', NULL, '', datetime('now'), 'migration:0010'),
  ('ff-e2e-avery-blood', 'ec92009pt@gmail.com', 'friends-and-family-blood', 'active', datetime('now'), 'migration:0010', NULL, '', datetime('now'), 'migration:0010')
ON CONFLICT(email, group_id) DO UPDATE SET
  state = 'active', revoked_at = NULL, revoked_by = '',
  updated_at = excluded.updated_at, updated_by = excluded.updated_by;

INSERT INTO pbe_access_fixture_events (
  id, label, kind, parent_id, visibility, gallery_key, group_id,
  access_policy, fixture, created_at, created_by, updated_at, updated_by
) VALUES
  ('fxt-1e7e6e2c4211422f', 'Friends and Family', 'family', '', 'private', 'friends-and-family', 'friends-and-family', 'Assigned members only.', 1, datetime('now'), 'migration:0010', datetime('now'), 'migration:0010'),
  ('fxt-170cc94c51b34414', 'Family', 'family', 'fxt-1e7e6e2c4211422f', 'private', 'friends-and-family-family', 'friends-and-family-family', 'Assigned family members only.', 1, datetime('now'), 'migration:0010', datetime('now'), 'migration:0010'),
  ('fxt-ba96968a42d5433c', 'Blood', 'family', 'fxt-170cc94c51b34414', 'private', 'friends-and-family-blood', 'friends-and-family-blood', 'Assigned blood-family members only.', 1, datetime('now'), 'migration:0010', datetime('now'), 'migration:0010')
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label, kind = excluded.kind, parent_id = excluded.parent_id,
  visibility = excluded.visibility, gallery_key = excluded.gallery_key,
  group_id = excluded.group_id, access_policy = excluded.access_policy,
  fixture = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

DELETE FROM pbe_access_fixture_assets
WHERE fixture_id IN ('fxt-1e7e6e2c4211422f', 'fxt-170cc94c51b34414', 'fxt-ba96968a42d5433c');

INSERT INTO pbe_access_fixture_assets (fixture_id, photo_id, ordinal, state, synced_at, synced_by) VALUES
  ('fxt-1e7e6e2c4211422f', '20160714-1357-07255-pano-735b2de8ed', 1, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '20180511-0222-00303-7409745ec9', 2, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-90fa7bdfb0', 3, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-1d8f934327', 4, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', 'umfjfqfhrf-a97976b143', 5, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-08437559bb', 6, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', 'img-5217-19271b7eda', 7, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '20180515-1633-00437-f9e3bd9336', 8, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', 'img-1296-57d10180dd', 9, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '20230114-174915-00328-41b1aa24ef', 10, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '20230812-164732-00125-3d55fc68d8', 11, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-e49952e59e', 12, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-982aeec357', 13, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-c61c4f7b67', 14, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-908c4a86a2', 15, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-2d6b06ec57', 16, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-d72ef6e8e0', 17, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '782f4628-8af0-4b50-8efd-52ee1801ea90-001-axiufxd2w4mzt2rf1b8wqze2gzjl-eabf1a7975', 18, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '001-42b41c8c5a', 19, 'active', datetime('now'), 'migration:0010'),
  ('fxt-1e7e6e2c4211422f', '20201122-0516-00056-pano-665f19e925', 20, 'active', datetime('now'), 'migration:0010');

INSERT INTO pbe_access_fixture_assets
SELECT 'fxt-170cc94c51b34414', photo_id, ordinal, 'active', datetime('now'), 'migration:0010'
FROM pbe_access_fixture_assets
WHERE fixture_id = 'fxt-1e7e6e2c4211422f' AND ordinal <= 10;

INSERT INTO pbe_access_fixture_assets
SELECT 'fxt-ba96968a42d5433c', photo_id, ordinal, 'active', datetime('now'), 'migration:0010'
FROM pbe_access_fixture_assets
WHERE fixture_id = 'fxt-1e7e6e2c4211422f' AND ordinal <= 5;
