import sqlite3
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "assets/catalog/photosbyelie.sqlite"


class CatalogGeographyRegressionTest(unittest.TestCase):
    def test_la_jolla_cohort_is_not_labeled_as_nerja(self):
        connection = sqlite3.connect(CATALOG_PATH)
        connection.row_factory = sqlite3.Row
        try:
            leaked = connection.execute(
                """
                SELECT media_items.media_id, media_items.title
                FROM media_items
                JOIN collections USING(collection_id)
                WHERE collections.slug = 'usa'
                  AND lower(media_items.title) LIKE '%nerja%'
                """
            ).fetchall()
            self.assertEqual([], leaked)

            cohort = connection.execute(
                """
                SELECT media_items.media_id, media_items.title,
                       media_items.location, media_items.keyword_ids
                FROM media_items
                JOIN collections USING(collection_id)
                WHERE collections.slug = 'usa'
                  AND captured_at BETWEEN '2018-04-21T15:33:00'
                                      AND '2018-04-21T15:38:00'
                ORDER BY captured_at
                """
            ).fetchall()
            self.assertEqual(12, len(cohort))
            self.assertTrue(
                all(row["title"] == "La Jolla Cove, San Diego" for row in cohort)
            )
            self.assertTrue(all(row["location"] == "USA" for row in cohort))

            keyword_ids = {
                int(keyword_id)
                for row in cohort
                for keyword_id in str(row["keyword_ids"] or "").split(",")
                if keyword_id
            }
            placeholders = ",".join("?" for _ in keyword_ids)
            keywords = {
                row[0]
                for row in connection.execute(
                    f"SELECT keyword FROM keyword_terms WHERE keyword_id IN ({placeholders})",
                    sorted(keyword_ids),
                )
            }
            self.assertTrue({"USA", "La Jolla", "San Diego"}.issubset(keywords))
            self.assertNotIn("Spain", keywords)
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
