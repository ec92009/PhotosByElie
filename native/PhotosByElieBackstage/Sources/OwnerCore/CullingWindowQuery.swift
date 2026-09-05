import Foundation

/// Read-only query construction. The caller owns the connection and fixture validation.
struct CullingWindowQuery {
    let fixtureID: String
    let parentFixtureID: String?
    let needsUnavailableIdentityFallback: Bool
    let hasCurrentEquipment: Bool

    func read(using connection: CullingSQLiteConnection) throws -> [[String: JSONValue]] {
        let (fromSQL, bindings) = joins()
        return try connection.query(
            """
            \(exactIdentityCTE)
            \(projectionSQL())
            FROM \(fromSQL)
            WHERE NOT EXISTS (
                SELECT 1
                FROM sidecar_tombstones AS tombstone
                WHERE tombstone.asset_id = asset.asset_id
                  AND tombstone.tombstone_state = 'active'
              )
              AND COALESCE(global_decision.pick_state, '') <> 'hidden'
            ORDER BY asset.captured_at DESC, asset.asset_id
            """,
            bindings: bindings
        )

    }
    private func joins() -> (String, [CullingSQLiteBinding]) {
        var fromSQL = "sidecar_assets AS asset\n"
        var bindings: [CullingSQLiteBinding] = []
        if let parentFixtureID, !parentFixtureID.isEmpty {
            fromSQL += """
                JOIN fixture_asset_decisions AS parent_decision
                  ON parent_decision.asset_id = asset.asset_id
                 AND parent_decision.fixture_id = ?
                 AND parent_decision.placement_state = 'picked'
                 AND parent_decision.eligibility_state = 'active'
                """
            bindings.append(.string(parentFixtureID))
        }
        fromSQL += """
            LEFT JOIN fixture_asset_decisions AS current_decision
              ON current_decision.asset_id = asset.asset_id
             AND current_decision.fixture_id = ?
            LEFT JOIN sidecar_decisions AS global_decision
              ON global_decision.asset_id = asset.asset_id
            LEFT JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = asset.asset_id
            LEFT JOIN asset_delivery_state AS delivery
              ON delivery.asset_id = asset.asset_id
            LEFT JOIN asset_source_versions AS latest_source
              ON latest_source.version_id = (
                SELECT source_version.version_id
                FROM asset_source_versions AS source_version
                WHERE source_version.asset_id = asset.asset_id
                ORDER BY source_version.created_at DESC, source_version.version_id DESC
                LIMIT 1
              )
            """
        if hasCurrentEquipment {
            fromSQL += """
                LEFT JOIN asset_current_equipment AS current_equipment
                  ON current_equipment.asset_id = asset.asset_id
                """
        }
        if needsUnavailableIdentityFallback {
            fromSQL += """
                LEFT JOIN exact_identity_cloud_fallbacks AS exact_identity
                  ON COALESCE(asset.missing_at, '') <> ''
                 AND exact_identity.local_identifier = json_extract(asset.raw_json, '$.localIdentifier')
                """
        }
        bindings.append(.string(fixtureID))

        return (fromSQL, bindings)
    }

    private var exactIdentityCTE: String {
        return needsUnavailableIdentityFallback
            ? """
              WITH exact_identity_cloud_fallbacks AS (
                SELECT local_identifier, MAX(cloud_identifier) AS cloud_identifier
                FROM (
                  SELECT json_extract(raw_json, '$.localIdentifier') AS local_identifier,
                         CASE
                           WHEN source_anchor LIKE 'apple-photos-cloud://%'
                             THEN substr(source_anchor, length('apple-photos-cloud://') + 1)
                           ELSE COALESCE(
                             json_extract(raw_json, '$.cloudIdentifier'),
                             json_extract(raw_json, '$.phCloudIdentifier'),
                             json_extract(raw_json, '$.cloudIdentifierString'),
                             ''
                           )
                         END AS cloud_identifier
                  FROM sidecar_assets
                  WHERE COALESCE(missing_at, '') = ''
                )
                WHERE trim(COALESCE(local_identifier, '')) <> ''
                  AND trim(COALESCE(cloud_identifier, '')) <> ''
                GROUP BY local_identifier
                HAVING COUNT(DISTINCT cloud_identifier) = 1
              )
              """
            : ""
    }

    private func projectionSQL() -> String {
        let exactIdentitySelection = needsUnavailableIdentityFallback
            ? "COALESCE(exact_identity.cloud_identifier, '')"
            : "''"
        let currentCameraSelection = hasCurrentEquipment
            ? "NULLIF(current_equipment.camera_body, '')"
            : "NULL"
        let currentLensSelection = hasCurrentEquipment
            ? "NULLIF(current_equipment.lens, '')"
            : "NULL"
        let currentFocalLengthSelection = hasCurrentEquipment
            ? "NULLIF(current_equipment.focal_length, '')"
            : "NULL"
        return """
            SELECT asset.asset_id,
                   COALESCE(asset.source_anchor, '') AS source_anchor,
                   COALESCE(asset.raw_json, '{}') AS raw_json,
                   COALESCE(asset.filename, '') AS filename,
                   COALESCE(asset.media_type, 'photo') AS media_type,
                   COALESCE(asset.captured_at, '') AS captured_at,
                   COALESCE(asset.photos_title, '') AS photos_title,
                   COALESCE(asset.photos_keywords_json, '[]') AS photos_keywords_json,
                   COALESCE(asset.location_label, '') AS location_label,
                   COALESCE(asset.location_keywords_json, '[]') AS location_keywords_json,
                   COALESCE(asset.pixel_width, 0) AS pixel_width,
                   COALESCE(asset.pixel_height, 0) AS pixel_height,
                   COALESCE(
                     \(currentCameraSelection),
                     json_extract(asset.raw_json, '$.cameraMetadata.model'),
                     json_extract(asset.raw_json, '$.cameraMetadata.name'),
                     json_extract(asset.raw_json, '$.camera.model'),
                     json_extract(asset.raw_json, '$.camera.name'),
                     json_extract(asset.raw_json, '$.cameraBody'),
                     ''
                   ) AS search_camera_body,
                   COALESCE(
                     \(currentLensSelection),
                     json_extract(asset.raw_json, '$.lensMetadata.model'),
                     json_extract(asset.raw_json, '$.lensMetadata.name'),
                     json_extract(asset.raw_json, '$.lens.model'),
                     json_extract(asset.raw_json, '$.lens.name'),
                     json_extract(asset.raw_json, '$.cameraMetadata.lensModel'),
                     json_extract(asset.raw_json, '$.camera.lensModel'),
                     ''
                   ) AS search_lens,
                   COALESCE(
                     \(currentFocalLengthSelection),
                     json_extract(asset.raw_json, '$.focalLength'),
                     json_extract(asset.raw_json, '$.cameraMetadata.focalLength'),
                     json_extract(asset.raw_json, '$.camera.focalLength'),
                     ''
                   ) AS search_focal_length,
                   COALESCE(global_decision.title, '') AS decision_title,
                   COALESCE(global_decision.keywords_json, '[]') AS decision_keywords_json,
                   COALESCE(current_decision.placement_state, 'undecided') AS placement_state,
                   COALESCE(current_decision.eligibility_state, 'active') AS eligibility_state,
                   COALESCE(global_decision.rating, 0) AS rating,
                   COALESCE(global_decision.color, '') AS color,
                   COALESCE(editorial.editorial_state, global_decision.metadata_state, 'unreviewed') AS editorial_state,
                   CASE WHEN EXISTS (
                     SELECT 1
                     FROM asset_ai_proposals AS proposal
                     WHERE proposal.asset_id = asset.asset_id
                       AND proposal.status IN ('ready', 'loaded')
                   ) THEN 1 ELSE 0 END AS proposal_available,
                   COALESCE(delivery.delivery_state, 'not-ready') AS delivery_state,
                   CASE
                     WHEN COALESCE(asset.missing_at, '') <> '' THEN 0
                     WHEN COALESCE(latest_source.source_exists, 1) = 0 THEN 0
                     WHEN COALESCE(latest_source.state, '') = 'source-missing' THEN 0
                     ELSE 1
                   END AS source_available,
                   \(exactIdentitySelection) AS exact_identity_cloud_fallback,
                   COALESCE((
                     SELECT CAST(COALESCE(
                       json_extract(upload.value, '$.bytes'),
                       json_extract(upload.value, '$.existing.bytes')
                     ) AS INTEGER)
                     FROM sidecar_upload_bridge_run_items AS run_item,
                          json_each(COALESCE(run_item.upload_keys_json, '[]')) AS upload
                     WHERE run_item.asset_id = asset.asset_id
                       AND json_extract(upload.value, '$.kind') = 'private-master'
                       AND CAST(COALESCE(
                         json_extract(upload.value, '$.bytes'),
                         json_extract(upload.value, '$.existing.bytes'),
                         0
                       ) AS INTEGER) > 0
                     ORDER BY run_item.updated_at DESC
                     LIMIT 1
                   ), CAST(COALESCE(
                     json_extract(asset.raw_json, '$.originalByteCount'),
                     json_extract(asset.raw_json, '$.original_byte_count'),
                     0
                   ) AS INTEGER)) AS original_byte_count
            """
    }

}
