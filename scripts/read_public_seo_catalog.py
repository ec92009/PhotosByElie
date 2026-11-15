#!/usr/bin/env python3
"""Read only public SEO fields from an already validated public SQLite catalog."""

import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path


def read_catalog(path: Path) -> list[dict]:
    """Exclude unknown scopes/origins/types and require a public still preview."""
    resolved = path.resolve(strict=True)
    wal = Path(f"{resolved}-wal")
    if wal.exists() and wal.stat().st_size:
        raise ValueError("SEO input must be a checkpointed public catalog snapshot")
    with closing(sqlite3.connect(f"{resolved.as_uri()}?mode=ro&immutable=1", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        return [dict(row) for row in conn.execute("""
            SELECT m.media_id AS id, m.title, m.description,
                   c.slug AS collectionKey, c.title AS collectionTitle
            FROM media_items AS m
            JOIN collections AS c USING (collection_id)
            JOIN source_origins AS o USING (source_origin_id)
            JOIN media_types AS t USING (media_type_id)
            WHERE c.scope = 'public' AND o.code = 'camera' AND t.code = 'photo'
              AND EXISTS (
                SELECT 1 FROM media_assets AS a
                JOIN asset_types AS k USING (asset_type_id)
                WHERE a.media_id = m.media_id AND k.code = 'still_900'
                  AND a.width > 0 AND a.height > 0
              )
            ORDER BY c.sort_order, c.slug, m.sort_index, m.media_id
        """)]


if __name__ == "__main__":
    print(json.dumps(read_catalog(Path(sys.argv[1])), ensure_ascii=False))
