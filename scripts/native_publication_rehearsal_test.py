import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_publication_rehearsal import run_rehearsal


class NativePublicationRehearsalTest(unittest.TestCase):
    def test_rehearsal_is_isolated_complete_and_repeatable(self):
        repo_root = Path(__file__).resolve().parents[1]
        for _attempt in range(2):
            report = run_rehearsal(repo_root, require_installed_app=False)
            self.assertTrue(report["passed"])
            self.assertEqual(
                report["schema"],
                "photosbyelie.nativePublicationRehearsal.v1",
            )
            self.assertEqual(report["ticket"], "PBB-63")
            self.assertEqual(report["scenario"]["externalUploads"], 0)
            self.assertEqual(report["scenario"]["externalDeletes"], 0)
            self.assertTrue(report["checks"]["allGuardedArtifactsUnchanged"])
            self.assertTrue(report["checks"]["failedUploadRetriesCleanly"])
            self.assertTrue(report["checks"]["referencedObjectRestored"])
            self.assertTrue(report["checks"]["orphanDeletedOnlyOnLaterPass"])


if __name__ == "__main__":
    unittest.main()
