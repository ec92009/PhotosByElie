import tempfile
import unittest
from pathlib import Path

from scripts.native_owner_parity_rehearsal import run_rehearsal


class NativeOwnerParityRehearsalTest(unittest.TestCase):
    def test_old_and_native_paths_match_without_touching_guarded_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "assets/owner-actions").mkdir(parents=True)
            (root / "assets/owner-actions/Owner.sqlite").write_bytes(
                b"live-owner-sentinel"
            )
            (root / "index.html").write_text(
                "public sentinel", encoding="utf-8"
            )

            report = run_rehearsal(root)

            self.assertTrue(report["passed"])
            self.assertTrue(report["checks"]["semanticParity"])
            self.assertTrue(report["checks"]["legacyFailedMoveAtomic"])
            self.assertTrue(report["checks"]["nativeFailedMoveAtomic"])
            self.assertTrue(report["checks"]["nativeSqliteBackupRecovery"])
            self.assertTrue(report["checks"]["liveOwnerDatabaseUnchanged"])
            self.assertTrue(report["checks"]["publicClientArtifactsUnchanged"])
            self.assertEqual(
                (root / "assets/owner-actions/Owner.sqlite").read_bytes(),
                b"live-owner-sentinel",
            )
            self.assertEqual(
                (root / "index.html").read_text(encoding="utf-8"),
                "public sentinel",
            )


if __name__ == "__main__":
    unittest.main()
