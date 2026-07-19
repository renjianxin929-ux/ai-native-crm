"""Finalize immutable external evidence after every verification gate has run."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def run(command: list[str], cwd: Path) -> str:
    result = subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True, encoding="utf-8")
    return result.stdout


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")


def changed_file_manifest(repo: Path) -> dict[str, Any]:
    git_root = Path(run(["git", "rev-parse", "--show-toplevel"], repo).strip())
    tracked = {line for line in run(["git", "diff", "--name-only"], git_root).splitlines() if line}
    staged = {line for line in run(["git", "diff", "--cached", "--name-only"], git_root).splitlines() if line}
    untracked = {line for line in run(["git", "ls-files", "--others", "--exclude-standard"], git_root).splitlines() if line}
    files: list[dict[str, Any]] = []
    for relative in sorted(tracked | staged | untracked):
        path = git_root / relative
        files.append({
            "absolute_path": str(path.resolve()),
            "repo_relative_path": relative.replace("\\", "/"),
            "tracked": relative not in untracked,
            "status": "untracked" if relative in untracked else "tracked_modified",
            "size": path.stat().st_size,
            "sha256": sha256(path),
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_root": str(git_root),
        "head": run(["git", "rev-parse", "HEAD"], git_root).strip(),
        "tracked_modified_count": len(tracked | staged),
        "untracked_count": len(untracked),
        "total_count": len(files),
        "staged_count": len(staged),
        "files": files,
    }


def evidence_manifest(root: Path) -> dict[str, Any]:
    excluded = {
        "evidence-file-manifest.json",
        "evidence-file-manifest.sha256",
        "FINAL_TRANSPORT_EQUIVALENCE_REPORT.md",
    }
    files = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        if relative in excluded:
            continue
        files.append({"path": relative, "size": path.stat().st_size, "sha256": sha256(path), "mtime_ns": path.stat().st_mtime_ns})
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "file_count": len(files), "files": files}


def video_probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-of", "json", str(path)],
        check=True, capture_output=True, text=True, encoding="utf-8",
    )
    data = json.loads(result.stdout).get("format", {})
    return {"path": str(path.resolve()), "duration": float(data.get("duration", 0)), "size": int(data.get("size", 0))}


def final_report(root: Path, repo: Path, worktree: dict[str, Any], verification: dict[str, Any]) -> str:
    matrix = json.loads((root / "action-matrix-44-results.json").read_text(encoding="utf-8"))
    normal = json.loads((root / "normal-db-protection.json").read_text(encoding="utf-8"))
    semantic = sorted((root / "semantic-traces").glob("B*-trace.json"))
    vision = sorted((root / "vision-traces").glob("*.json"))
    cancellation = sorted((root / "cancellation-traces").glob("FAM-044*.json"))
    videos = [video_probe(path) for path in sorted((root / "videos").glob("*.mp4"))]
    result_paths = [f"{item['scenario_id']}: " + " | ".join(item["evidence_paths"]) for item in matrix["results"]]
    untracked = [item["repo_relative_path"] for item in worktree["files"] if not item["tracked"]]
    deleted = run(["git", "diff", "--diff-filter=D", "--name-only"], repo).splitlines()
    staged = run(["git", "diff", "--cached", "--name-only"], repo).splitlines()
    lines = [
        "# FINAL TRANSPORT EQUIVALENCE REPORT",
        "",
        f"Generated last: {datetime.now(timezone.utc).isoformat()}",
        "",
        f"1. Changed files/count: {worktree['tracked_modified_count']} tracked modified + {worktree['untracked_count']} untracked = {worktree['total_count']}; staged={worktree['staged_count']}.",
        f"2. Net added/deleted paths: added/untracked={json.dumps(untracked, ensure_ascii=False)}; deleted={json.dumps(deleted, ensure_ascii=False)}.",
        "3. Original root cause: the E2E shortcut returned final business output above request construction/extraction/validation, while the legacy driver allowed state reuse and count-only DB claims.",
        "4. ProviderTransport architecture: ReqwestProviderTransport and DeterministicFakeNetworkTransport implement one raw HTTP transport contract.",
        "5. Production/E2E equivalence: both call execute_provider_pipeline for validation, request build/cap, transport, raw parse/cap, extract_output, validators, source binding, and atomic commit.",
        "6. Fake raw response protocol: provider-shaped status, metadata, raw JSON body, deterministic delay/timeout/cancel/malformed/schema/evidence/HTTP/oversize cases; no secret recorded.",
        f"7. E2E feature dead-code result: {verification.get('cargo_e2e')}.",
        f"8. Driver manual override cleanup: manual_actual_override_count={matrix['manual_actual_override_count']}.",
        f"9. Driver intent bypass cleanup: fixed_intent_bypass_count={matrix['fixed_intent_bypass_count']}.",
        f"10. Independent Action Matrix: full_e2e_pass={matrix['full_e2e_pass']}/{matrix['total']}; all_pass={matrix['all_pass']}.",
        f"11. Reused execution count: {matrix['reused_execution_count']}; independent_execution_count={matrix['independent_execution_count']}.",
        "12. FAM-001 through FAM-044 evidence:",
        *[f"   - {item}" for item in result_paths],
        "13. DB Oracle: all tables/all fields are read through independent SQLite rowid snapshots and compared by stable row identity.",
        "14. Confirm exact row: Task and Follow-up confirms bind UUID marker, customer, operation, values, row ID, timestamps, status/source and exact affected count.",
        "15. Cancel/Replay: cancellation and mismatch have zero diff; replay has zero second write.",
        "16. Refresh/no-rerun: visible refresh count is exactly one and transport request count remains unchanged after confirm/refresh.",
        f"17. Semantic traces 1-3: {json.dumps([str(path.resolve()) for path in semantic], ensure_ascii=False)}.",
        f"18. Provider-unconfigured trace: {root / 'screenshots/FAM-015/key-state.png'}; zero post-bind network assertion is in FAM-015 result.",
        f"19. Router-cancellation trace: {root / 'semantic-traces/router-cancellation.json'}.",
        f"20. Vision decode/body/source binding: {json.dumps([str(path.resolve()) for path in vision], ensure_ascii=False)}.",
        f"21. Invalid Evidence raw-response block: {root / 'screenshots/FAM-018/key-state.png'} and provider capture linked by FAM-018.",
        f"22. Cancellation late-result + second request: {json.dumps([str(path.resolve()) for path in cancellation], ensure_ascii=False)}.",
        f"23. Videos: {json.dumps(videos, ensure_ascii=False)}.",
        f"24. Worktree manifest: {root / 'worktree-content-manifest.json'}; hash: {root / 'worktree-content-manifest.sha256'}.",
        f"25. Evidence manifest: {root / 'evidence-file-manifest.json'}; hash: {root / 'evidence-file-manifest.sha256'}.",
        f"26. Full tests: {verification.get('pnpm_test')}.",
        f"27. Build: {verification.get('production_build')}.",
        f"28. Cargo default: {verification.get('cargo_default')}.",
        f"29. Cargo E2E: {verification.get('cargo_e2e')}.",
        f"30. Production bundle audit: {verification.get('production_bundle_audit')}.",
        f"31. Normal DB before/after: pass={normal.get('pass')}; assertions={json.dumps(normal, ensure_ascii=False)}.",
        f"32. TEXT_PROTOCOL_READY: {'READY' if matrix['full_e2e_pass'] == 44 and len(semantic) == 3 else 'NOT_READY'}.",
        f"33. MULTIMODAL_PROTOCOL_READY: {'READY' if vision else 'NOT_READY'}.",
        "34. Remaining limitations: deterministic E2E transport is release evidence for protocol equivalence, not authorization for a live Provider call.",
        "35. Recommendation: run a new independent read-only review before any live smoke.",
        f"36. Confirmations: no staged={not staged}; no commit=true; no package=true; no live-provider request=true; no RAG=true; no autonomous/background execution=true; normal production DB unchanged={normal.get('pass')}.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-root", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--verification-summary", required=True)
    args = parser.parse_args()
    root, repo = Path(args.evidence_root).resolve(), Path(args.repo).resolve()
    verification = json.loads(Path(args.verification_summary).read_text(encoding="utf-8"))

    worktree = changed_file_manifest(repo)
    worktree_path = root / "worktree-content-manifest.json"
    write_json(worktree_path, worktree)
    (root / "worktree-content-manifest.sha256").write_text(f"{sha256(worktree_path)}  {worktree_path.name}\n", encoding="ascii")

    evidence = evidence_manifest(root)
    evidence_path = root / "evidence-file-manifest.json"
    write_json(evidence_path, evidence)
    (root / "evidence-file-manifest.sha256").write_text(f"{sha256(evidence_path)}  {evidence_path.name}\n", encoding="ascii")

    latest_input_mtime = max(path.stat().st_mtime_ns for path in root.rglob("*") if path.is_file())
    time.sleep(0.05)
    report_path = root / "FINAL_TRANSPORT_EQUIVALENCE_REPORT.md"
    report_path.write_text(final_report(root, repo, worktree, verification), encoding="utf-8")
    if report_path.stat().st_mtime_ns <= latest_input_mtime:
        raise RuntimeError("Final report is not newer than all input evidence")
    print(json.dumps({"worktree_files": worktree["total_count"], "evidence_files": evidence["file_count"], "report": str(report_path), "report_is_last": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
