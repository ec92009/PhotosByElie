"""Production recovery writes require the installed, sealed Backstage runtime."""

from pathlib import Path
import json
import subprocess

from legacy_r2_evidence import RecoveryError

CANONICAL_ROOT = (Path.home() / "Dev/PhotosByElie").resolve()
APP = Path("/Applications/PhotosByElie Backstage.app")
RUNTIME = APP / "Contents/Resources/OwnerRuntime"


def require_installed_runtime(root: Path) -> None:
    """Keep disposable offline fixtures usable; never mutate live Owner from source."""
    canonical_owner = CANONICAL_ROOT / "assets/owner-actions/Owner.sqlite"
    target = root.resolve() / "assets/owner-actions/Owner.sqlite"
    production = root.resolve() == CANONICAL_ROOT or (
        canonical_owner.exists() and target.exists() and target.samefile(canonical_owner))
    if not production:
        return
    if root.resolve() != CANONICAL_ROOT or Path(__file__).resolve().parent != RUNTIME / "scripts":
        raise RecoveryError("installed_backstage_recovery_runtime_required")
    try:
        from catalog_authority_client import load_credentials, CONFIG_PATH
        load_credentials()  # Existing enrollment, private file and exact repo checks.
        config = json.loads(CONFIG_PATH.read_text())
        if Path(config.get("runtimeRoot", "")).resolve() != RUNTIME:
            raise ValueError()
        requirement = 'anchor apple generic and identifier "com.photosbyelie.backstage" and certificate leaf[subject.OU] = "CB7FE399AL"'
        subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", "-R", requirement, str(APP)],
                       check=True, capture_output=True, timeout=30)
    except Exception:
        raise RecoveryError("installed_backstage_runtime_unverified") from None
