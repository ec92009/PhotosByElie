"""Production recovery writes require the installed, sealed Backstage runtime."""

from pathlib import Path
import json
import subprocess

from legacy_r2_evidence import RecoveryError

CANONICAL_ROOT = (Path.home() / "Dev/PhotosByElie").resolve()
APP = Path("/Applications/PhotosByElie Backstage.app")
RUNTIME = APP / "Contents/Resources/OwnerRuntime"
CODE_SIGNATURE_REQUIREMENT = (
    'anchor apple generic and identifier "com.photosbyelie.backstage" '
    'and certificate leaf[subject.OU] = "CB7FE399AL"'
)


def code_signature_verification_command() -> list[str]:
    """Build codesign's inline custom-requirement argument (not a file path)."""
    return ["/usr/bin/codesign", "--verify", "--deep", "--strict", "-R",
            "=" + CODE_SIGNATURE_REQUIREMENT, str(APP)]


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
        subprocess.run(code_signature_verification_command(), check=True,
                       capture_output=True, timeout=30)
    except Exception:
        raise RecoveryError("installed_backstage_runtime_unverified") from None
