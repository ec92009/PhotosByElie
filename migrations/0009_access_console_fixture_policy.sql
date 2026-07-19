-- Converge production ACS on the universal fixture policy:
-- Expo/Travel public, RE private, Corine exclusive from La Concha downward.

UPDATE pbe_access_role_grants
SET state = 'revoked', revoked_at = datetime('now'), revoked_by = 'migration:0009',
    updated_at = datetime('now'), updated_by = 'migration:0009'
WHERE state = 'active'
  AND email IN (SELECT email FROM pbe_access_people WHERE fixture = 1);

UPDATE pbe_access_gallery_grants
SET state = 'revoked', revoked_at = datetime('now'), revoked_by = 'migration:0009',
    updated_at = datetime('now'), updated_by = 'migration:0009'
WHERE state = 'active'
  AND (
    email IN (SELECT email FROM pbe_access_people WHERE fixture = 1)
    OR (
      gallery_kind = 'real_estate'
      AND gallery_key IN ('corine-real-estate', 'agnes-la-concha-common')
      AND email <> 'corine.bn2007@yahoo.fr'
    )
  );

UPDATE pbe_access_group_memberships
SET state = 'revoked', revoked_at = datetime('now'), revoked_by = 'migration:0009',
    updated_at = datetime('now'), updated_by = 'migration:0009'
WHERE state = 'active'
  AND (
    email IN (SELECT email FROM pbe_access_people WHERE fixture = 1)
    OR (group_id = 're-la-concha' AND email <> 'corine.bn2007@yahoo.fr')
  );

UPDATE pbe_access_role_grants
SET state = 'revoked', revoked_at = datetime('now'), revoked_by = 'migration:0009',
    updated_at = datetime('now'), updated_by = 'migration:0009'
WHERE role = 're_client' AND state = 'active'
  AND email <> 'corine.bn2007@yahoo.fr'
  AND NOT EXISTS (
    SELECT 1 FROM pbe_access_gallery_grants gallery
    WHERE gallery.email = pbe_access_role_grants.email
      AND gallery.gallery_kind = 'real_estate'
      AND gallery.state = 'active'
  );

UPDATE pbe_access_people
SET disabled_at = COALESCE(disabled_at, datetime('now')), disabled_by = 'migration:0009',
    updated_at = datetime('now'), updated_by = 'migration:0009'
WHERE fixture = 1;

UPDATE pbe_access_group_memberships
SET state = 'revoked', revoked_at = datetime('now'), revoked_by = 'migration:0009',
    updated_at = datetime('now'), updated_by = 'migration:0009'
WHERE group_id IN ('agnes-bday', 'johnson-palmer-wedding') AND state = 'active';

UPDATE pbe_access_audience_groups
SET state = 'archived', archived_at = datetime('now'), archived_by = 'migration:0009',
    updated_at = datetime('now'), updated_by = 'migration:0009'
WHERE id IN ('agnes-bday', 'johnson-palmer-wedding') AND fixture = 1;

INSERT INTO pbe_access_audience_groups (
  id, label, kind, gallery_kind, gallery_key, access_policy,
  capabilities_json, gallery_defaults_json, state, archived_at, archived_by,
  fixture, created_at, created_by, updated_at, updated_by
) VALUES (
  're-la-concha', 'RE La Concha', 'real_estate', 'real_estate', 'corine-real-estate',
  'Private La Concha access inherited by every descendant fixture.',
  '["view_gallery","view_originals","download_items","download_pdf","download_video"]',
  '{"watermarked":false,"saleEnabled":false,"downloads":true,"pdf":true,"video":true,"memberOriginals":true,"ownerOriginals":true}',
  'active', NULL, '', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'
) ON CONFLICT(id) DO UPDATE SET
  label = excluded.label, kind = excluded.kind, gallery_kind = excluded.gallery_kind,
  gallery_key = excluded.gallery_key, access_policy = excluded.access_policy,
  capabilities_json = excluded.capabilities_json, gallery_defaults_json = excluded.gallery_defaults_json,
  state = 'active', archived_at = NULL, archived_by = '', fixture = 1,
  updated_at = excluded.updated_at, updated_by = excluded.updated_by;

INSERT INTO pbe_access_people (
  email, display_name, source, fixture, notes, disabled_at, disabled_by,
  created_at, created_by, updated_at, updated_by
) VALUES (
  'corine.bn2007@yahoo.fr', 'Corine', 'manual', 0,
  'La Concha client; access inherits to every La Concha sub-fixture.',
  NULL, '', datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'
) ON CONFLICT(email) DO UPDATE SET
  fixture = 0, disabled_at = NULL, disabled_by = '',
  updated_at = excluded.updated_at, updated_by = excluded.updated_by;

INSERT INTO pbe_access_role_grants (
  id, email, role, state, granted_at, granted_by, revoked_at, revoked_by, updated_at, updated_by
) VALUES (
  'policy-corine-re-client', 'corine.bn2007@yahoo.fr', 're_client', 'active',
  datetime('now'), 'migration:0009', NULL, '', datetime('now'), 'migration:0009'
) ON CONFLICT(email, role) DO UPDATE SET
  state = 'active', revoked_at = NULL, revoked_by = '',
  updated_at = excluded.updated_at, updated_by = excluded.updated_by;

INSERT INTO pbe_access_gallery_grants (
  id, email, gallery_kind, gallery_key, state, granted_at, granted_by,
  revoked_at, revoked_by, updated_at, updated_by
) VALUES (
  'policy-corine-la-concha', 'corine.bn2007@yahoo.fr', 'real_estate', 'corine-real-estate',
  'active', datetime('now'), 'migration:0009', NULL, '', datetime('now'), 'migration:0009'
) ON CONFLICT(email, gallery_kind, gallery_key) DO UPDATE SET
  state = 'active', revoked_at = NULL, revoked_by = '',
  updated_at = excluded.updated_at, updated_by = excluded.updated_by;

INSERT INTO pbe_access_group_memberships (
  id, email, group_id, state, granted_at, granted_by,
  revoked_at, revoked_by, updated_at, updated_by
) VALUES (
  'policy-corine-re-la-concha', 'corine.bn2007@yahoo.fr', 're-la-concha',
  'active', datetime('now'), 'migration:0009', NULL, '', datetime('now'), 'migration:0009'
) ON CONFLICT(email, group_id) DO UPDATE SET
  state = 'active', revoked_at = NULL, revoked_by = '',
  updated_at = excluded.updated_at, updated_by = excluded.updated_by;

DELETE FROM pbe_access_fixture_events WHERE fixture = 1;

INSERT INTO pbe_access_fixture_events (
  id, label, kind, parent_id, visibility, gallery_key, group_id,
  access_policy, fixture, created_at, created_by, updated_at, updated_by
) VALUES
  ('fixture-expo', 'Expo', 'public', '', 'public', 'expo', '', 'Public: every visitor and signed-in user can browse.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-re', 'RE', 'real_estate', '', 'private', '', '', 'Private root: owner/admin only; client grants at child fixtures only.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha', 'La Concha', 'real_estate', 'fixture-re', 'private', 'corine-real-estate', 're-la-concha', 'Private: Corine only; access inherits to every descendant.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha-apartment-1', 'Apartment 1', 'real_estate', 'fixture-la-concha', 'inherit', 'corine-real-estate', '', 'Inherits La Concha access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha-apartment-2', 'Apartment 2', 'real_estate', 'fixture-la-concha', 'inherit', 'corine-real-estate', '', 'Inherits La Concha access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha-common', 'Common', 'real_estate', 'fixture-la-concha', 'inherit', 'corine-real-estate', '', 'Inherits La Concha access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha-main-lobby', 'Main lobby', 'real_estate', 'fixture-la-concha-common', 'inherit', 'corine-real-estate', '', 'Inherits La Concha access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha-pool', 'Pool', 'real_estate', 'fixture-la-concha-common', 'inherit', 'corine-real-estate', '', 'Inherits La Concha access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha-street', 'Street', 'real_estate', 'fixture-la-concha-common', 'inherit', 'corine-real-estate', '', 'Inherits La Concha access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-la-concha-tennis-court', 'Tennis court', 'real_estate', 'fixture-la-concha-common', 'inherit', 'corine-real-estate', '', 'Inherits La Concha access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-travel', 'Travel', 'public', '', 'public', 'travel', '', 'Public: every visitor and signed-in user can browse.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-travel-gibraltar', 'Gibraltar', 'public', 'fixture-travel', 'inherit', 'gibraltar', '', 'Inherits public Travel access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-travel-granada', 'Granada', 'public', 'fixture-travel', 'inherit', 'granada', '', 'Inherits public Travel access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-travel-nerja', 'Nerja', 'public', 'fixture-travel', 'inherit', 'nerja', '', 'Inherits public Travel access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-travel-paris', 'Paris', 'public', 'fixture-travel', 'inherit', 'paris', '', 'Inherits public Travel access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009'),
  ('fixture-travel-ronda', 'Ronda', 'public', 'fixture-travel', 'inherit', 'ronda', '', 'Inherits public Travel access.', 1, datetime('now'), 'migration:0009', datetime('now'), 'migration:0009');
