-- Reconcile the E2E fixture with Apple Photos assets that have durable cloud photo IDs.

DELETE FROM pbe_access_fixture_assets
WHERE fixture_id IN ('fxt-1e7e6e2c4211422f', 'fxt-170cc94c51b34414', 'fxt-ba96968a42d5433c');

INSERT INTO pbe_access_fixture_assets (fixture_id, photo_id, ordinal, state, synced_at, synced_by) VALUES
  ('fxt-1e7e6e2c4211422f', 'w8b-231d6b977b', 1, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-6e5b31e882', 2, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-af2786f08b', 3, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-27108463a4', 4, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-2aa0020369', 5, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-10325afd73', 6, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-0f75d9872e', 7, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-e98642322a', 8, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-6bc0f6435b', 9, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-728151e696', 10, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-b091bc2f24', 11, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-3f183d6653', 12, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-03d8705912', 13, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-fd98db150c', 14, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-fcd3577790', 15, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-710c3fb1cd', 16, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-f88ddcac55', 17, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-b4789863d7', 18, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-8df7d839c6', 19, 'active', datetime('now'), 'migration:0011'),
  ('fxt-1e7e6e2c4211422f', '001-abe89b52cf', 20, 'active', datetime('now'), 'migration:0011');

INSERT INTO pbe_access_fixture_assets
SELECT 'fxt-170cc94c51b34414', photo_id, ordinal, 'active', datetime('now'), 'migration:0011'
FROM pbe_access_fixture_assets
WHERE fixture_id = 'fxt-1e7e6e2c4211422f' AND ordinal <= 10;

INSERT INTO pbe_access_fixture_assets
SELECT 'fxt-ba96968a42d5433c', photo_id, ordinal, 'active', datetime('now'), 'migration:0011'
FROM pbe_access_fixture_assets
WHERE fixture_id = 'fxt-1e7e6e2c4211422f' AND ordinal <= 5;
