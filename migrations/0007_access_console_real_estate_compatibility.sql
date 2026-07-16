UPDATE pbe_access_audience_groups
SET gallery_key = 'corine-real-estate'
WHERE id = 're-la-concha'
  AND gallery_kind = 'real_estate'
  AND gallery_key = 're-la-concha';

UPDATE pbe_access_gallery_grants
SET gallery_key = 'corine-real-estate'
WHERE gallery_kind = 'real_estate'
  AND gallery_key = 're-la-concha'
  AND NOT EXISTS (
    SELECT 1
    FROM pbe_access_gallery_grants AS canonical
    WHERE canonical.email = pbe_access_gallery_grants.email
      AND canonical.gallery_kind = 'real_estate'
      AND canonical.gallery_key = 'corine-real-estate'
  );

UPDATE pbe_access_gallery_grants
SET state = 'revoked'
WHERE gallery_kind = 'real_estate'
  AND gallery_key = 're-la-concha'
  AND EXISTS (
    SELECT 1
    FROM pbe_access_gallery_grants AS canonical
    WHERE canonical.email = pbe_access_gallery_grants.email
      AND canonical.gallery_kind = 'real_estate'
      AND canonical.gallery_key = 'corine-real-estate'
  );

UPDATE pbe_access_real_estate_credentials
SET gallery_key = 'corine-real-estate'
WHERE gallery_key = 're-la-concha'
  AND NOT EXISTS (
    SELECT 1
    FROM pbe_access_real_estate_credentials AS canonical
    WHERE canonical.email = pbe_access_real_estate_credentials.email
      AND canonical.gallery_key = 'corine-real-estate'
  );

UPDATE pbe_access_real_estate_credentials
SET state = 'revoked'
WHERE gallery_key = 're-la-concha'
  AND EXISTS (
    SELECT 1
    FROM pbe_access_real_estate_credentials AS canonical
    WHERE canonical.email = pbe_access_real_estate_credentials.email
      AND canonical.gallery_key = 'corine-real-estate'
  );
