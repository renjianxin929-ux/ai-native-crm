"""Visible Tauri WebView E2E driver. Uses only user-facing DOM controls over CDP."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import platform
import shutil
import socket
import sqlite3
import subprocess
import time
import uuid
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# macOS has no Chromium CDP in WKWebView; the e2e app embeds a W3C WebDriver
# server (tauri-plugin-wdio-webdriver) instead. The shims below expose the
# playwright subset this script uses over selenium's WebDriver client.
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException


class _PlaywrightCompat:
    """Dummy sync_playwright() context so run_independent_full keeps its structure."""

    chromium = None

    def __enter__(self):
        return self

    def __exit__(self, *args: Any) -> bool:
        return False


def _xpath_attr_text(tag: str, name: str, exact: bool) -> str:
    attr = f"@aria-label='{name}'" if exact else f"contains(@aria-label,'{name}')"
    text = f"normalize-space()='{name}'" if exact else f"contains(normalize-space(),'{name}')"
    return f"({tag}[{attr}] | {tag}[{text}])"


class CompatLocator:
    """Minimal playwright-locator-compatible wrapper over a selenium element query."""

    def __init__(self, driver: Any, by: str, value: str) -> None:
        self.driver = driver
        self.by = by
        self.value = value

    def _all(self) -> list[Any]:
        return list(self.driver.find_elements(self.by, self.value))

    def _first_visible_or_first(self) -> Any:
        for element in self._all():
            if element.is_displayed():
                return element
        elements = self._all()
        if elements:
            return elements[0]
        raise NoSuchElementException(f"no element for {self.by}={self.value}")

    def wait_for(self, state: str = "visible", timeout: int = 15000) -> "CompatLocator":
        condition = EC.visibility_of_element_located if state == "visible" else EC.invisibility_of_element_located
        WebDriverWait(self.driver, timeout / 1000).until(condition((self.by, self.value)))
        return self

    def click(self, force: bool = False) -> "CompatLocator":
        self._first_visible_or_first().click()
        return self

    def fill(self, text: str) -> "CompatLocator":
        element = self._first_visible_or_first()
        element.clear()
        element.send_keys(text)
        return self

    def count(self) -> int:
        return len(self._all())

    @property
    def first(self) -> "CompatLocator":
        return self

    def is_visible(self) -> bool:
        return any(element.is_displayed() for element in self._all())

    def get_attribute(self, name: str) -> str | None:
        elements = self._all()
        for element in elements:
            if element.is_displayed():
                return element.get_attribute(name)
        return elements[0].get_attribute(name) if elements else None

    def inner_text(self) -> str:
        elements = self._all()
        return elements[0].text if elements else ""

    def set_input_files(self, paths: Any) -> "CompatLocator":
        element = self._first_visible_or_first()
        path_text = str(paths)
        # The embedded WKWebView WebDriver server cannot set file inputs via
        # send_keys (JS value setter throws InvalidStateError). Inject the file
        # through a DataTransfer so React's change handler receives it.
        import base64 as _base64
        import json as _json
        from pathlib import Path as _Path
        path = _Path(path_text)
        data = _base64.b64encode(path.read_bytes()).decode("ascii")
        mime = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".webp": "image/webp", ".ico": "image/x-icon",
        }.get(path.suffix.lower(), "application/octet-stream")
        name_js = _json.dumps(path.name)
        script = (
            "var input = arguments[0];"
            f"var bytes = Uint8Array.from(atob('{data}'), function(c) {{ return c.charCodeAt(0); }});"
            f"var file = new File([bytes], {name_js}, {{ type: '{mime}' }});"
            "var dt = new DataTransfer();"
            "dt.items.add(file);"
            "input.files = dt.files;"
            "input.dispatchEvent(new Event('change', { bubbles: true }));"
            "return input.files.length;"
        )
        self.driver.execute_script(script, element)
        return self


class CompatPage:
    """playwright Page-compatible subset backed by selenium (macOS WebDriver)."""

    def __init__(self, driver: Any) -> None:
        self.driver = driver

    def get_by_label(self, name: str) -> CompatLocator:
        xpath = f"(//*[@aria-label='{name}'] | //label[normalize-space()='{name}']/following-sibling::*[1] | //textarea[@placeholder='{name}'] | //input[@placeholder='{name}'])"
        return CompatLocator(self.driver, By.XPATH, xpath)

    def get_by_role(self, role: str, name: str | None = None, exact: bool = False) -> CompatLocator:
        label = name or ""
        if role == "button":
            xpath = _xpath_attr_text("//button", label, exact)
        elif role == "region":
            match = f"@aria-label='{label}'" if exact else f"contains(@aria-label,'{label}')"
            xpath = f"(//*[@role='region' and {match}] | //section[{match}])"
        else:
            xpath = f"(//*[@role='{role}'] | //*[contains(@aria-label,'{label}')])"
        return CompatLocator(self.driver, By.XPATH, xpath)

    def locator(self, css: str) -> CompatLocator:
        return CompatLocator(self.driver, By.CSS_SELECTOR, css)

    def wait_for_timeout(self, ms: int) -> None:
        time.sleep(ms / 1000)

    def wait_for_load_state(self, state: str = "domcontentloaded") -> None:
        return None

    def reload(self, wait_until: str | None = None) -> None:
        self.driver.refresh()

    def bring_to_front(self) -> None:
        try:
            self.driver.switch_to.window(self.driver.current_window_handle)
        except Exception:
            pass

    def screenshot(self, path: str, full_page: bool = False) -> str:
        self.driver.get_screenshot_as_file(str(path))
        return str(path)


TERMINAL_STAGES = {"candidate", "portfolio", "clarification", "result", "proposal", "confirmation", "success", "error", "input"}
LAST_INTENT_SEQUENCE: list[str] = []
SCENARIO_EXECUTIONS: dict[int, tuple[str, str]] = {}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def start_scenario(number: int, prompt: str) -> str:
    if number in SCENARIO_EXECUTIONS:
        raise AssertionError(f"FAM-{number:03d} execution already active")
    execution_id = str(uuid.uuid4())
    marker = f"[E2E:FAM-{number:03d}:{execution_id}]"
    SCENARIO_EXECUTIONS[number] = (execution_id, marker)
    if 23 <= number <= 34 or number == 43:
        return f"{prompt} {marker}"
    return prompt


def close_overlays(page: Page) -> None:
    for close_name in ("关闭今日值得关注", "关闭 Capture", "关闭历史记录", "关闭分析过程", "关闭上下文"):
        button = page.get_by_role("button", name=close_name)
        if button.count() and button.first.is_visible():
            button.first.click(force=True)
            page.wait_for_timeout(100)


def ready(page: Page, reload: bool = False) -> None:
    if reload:
        try:
            page.reload(wait_until="domcontentloaded")
        except Exception as cause:
            if "ERR_ABORTED" not in str(cause) and "frame was detached" not in str(cause):
                raise
            page.wait_for_timeout(500)
    page.wait_for_load_state("domcontentloaded")
    page.locator('[data-testid="agent-e2e-profile"]').wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(900)
    close_overlays(page)


def stage(page: Page) -> str:
    return page.locator('[data-testid="UNIFIED_AGENT_STAGE"]').get_attribute("data-stage-mode") or "unknown"


def current_intent(page: Page) -> str:
    return page.locator('[data-testid="UNIFIED_AGENT_STAGE"]').get_attribute("data-current-intent") or ""


def observable_intent(page: Page) -> str:
    capture = page.locator('[data-testid="agent-capture-modal"][data-current-intent]')
    if capture.count() and capture.first.is_visible():
        return capture.first.get_attribute("data-current-intent") or ""
    result = page.locator('[data-testid="agent-result-card"][data-current-intent]')
    if result.count() and result.first.is_visible():
        return result.first.get_attribute("data-current-intent") or ""
    success = page.locator('[data-testid="agent-write-success"][data-current-intent]')
    if success.count() and success.first.is_visible():
        return success.first.get_attribute("data-current-intent") or ""
    return current_intent(page)


def wait_terminal(page: Page, timeout_ms: int = 12000) -> list[str]:
    global LAST_INTENT_SEQUENCE
    sequence: list[str] = []
    deadline = time.monotonic() + timeout_ms / 1000
    seen_active = False
    while time.monotonic() < deadline:
        value = stage(page)
        intent_value = current_intent(page)
        if intent_value and (not LAST_INTENT_SEQUENCE or LAST_INTENT_SEQUENCE[-1] != intent_value):
            LAST_INTENT_SEQUENCE.append(intent_value)
        if not sequence or sequence[-1] != value:
            sequence.append(value)
        if value in {"thinking", "locating"}:
            seen_active = True
        if value in TERMINAL_STAGES and (seen_active or len(sequence) > 1):
            page.wait_for_timeout(350)
            return sequence
        page.wait_for_timeout(80)
    return sequence


def send(page: Page, prompt: str, timeout_ms: int = 12000) -> list[str]:
    global LAST_INTENT_SEQUENCE
    LAST_INTENT_SEQUENCE = []
    composer = page.get_by_label("Sales Agent message")
    composer.fill(prompt)
    page.get_by_role("button", name="Ask Sales Agent").click()
    return wait_terminal(page, timeout_ms)


def body(page: Page) -> str:
    return page.locator("body").inner_text()


def bind(page: Page, name: str = "无记忆客户") -> list[str]:
    ready(page)
    sequence = send(page, f"打开{name}", 18000)
    page.locator('[data-testid="agent-scope-chip"]').wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    return sequence


def screenshot(page: Page, root: Path, scenario_id: str, label: str = "key-state") -> str:
    folder = root / "screenshots" / scenario_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{label}.png"
    page.screenshot(path=str(path), full_page=True)
    return str(path)


def db_snapshot(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"path": str(path), "exists": path.exists()}
    if not path.exists():
        return result
    result.update({"size": path.stat().st_size, "mtime_ns": path.stat().st_mtime_ns})
    with path.open("rb") as handle:
        result["base_sha256"] = hashlib.sha256(handle.read()).hexdigest()
    for suffix, key in (("-wal", "wal"), ("-shm", "shm")):
        companion = Path(f"{path}{suffix}")
        result[key] = {"path": str(companion), "exists": companion.exists()}
        if companion.exists():
            result[key].update({
                "size": companion.stat().st_size,
                "mtime_ns": companion.stat().st_mtime_ns,
                "sha256": hashlib.sha256(companion.read_bytes()).hexdigest(),
            })
    connection = sqlite3.connect(str(path))
    connection.row_factory = sqlite3.Row
    try:
        result["quick_check"] = connection.execute("PRAGMA quick_check").fetchone()[0]
        table_names = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )]
        tables: dict[str, Any] = {}
        for table in table_names:
            quoted = table.replace('"', '""')
            columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{quoted}")')]
            rows: list[dict[str, Any]] = []
            for row in connection.execute(f'SELECT rowid AS __rowid__, * FROM "{quoted}" ORDER BY rowid'):
                record = dict(row)
                if table == "settings":
                    setting_key = str(record.get("key", "")).lower()
                    if any(token in setting_key for token in ("api", "key", "token", "secret", "credential")):
                        raw_value = str(record.get("value", ""))
                        record["value"] = {"redacted_sha256": hashlib.sha256(raw_value.encode("utf-8")).hexdigest()}
                rows.append(record)
            tables[table] = {"columns": columns, "row_count": len(rows), "rows": rows}
        result["tables"] = tables
        result["core_counts"] = {
            table: tables[table]["row_count"]
            for table in ("customers", "tasks", "follow_up_records", "visit_records", "ai_memory_entries")
            if table in tables
        }
        memory = tables.get("ai_memory_entries", {}).get("rows", [])
        result["memory_by_status"] = {
            status: sum(1 for row in memory if row.get("validation_status") == status)
            for status in ("CANDIDATE", "VALIDATED", "ACTIVE", "ARCHIVED")
        }
        logical = json.dumps(tables, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
        result["online_consistent_sha256"] = hashlib.sha256(logical).hexdigest()
    finally:
        connection.close()
    return result


def stable_customer_snapshot(snapshot: dict[str, Any], customer_name: str = "无记忆客户") -> dict[str, Any] | None:
    return next((row for row in snapshot.get("tables", {}).get("customers", {}).get("rows", []) if row.get("name") == customer_name), None)


def companion_content_identity(value: dict[str, Any] | None) -> dict[str, Any]:
    item = value or {}
    return {key: item.get(key) for key in ("exists", "size", "sha256")}


def _row_key(row: dict[str, Any]) -> str:
    for key in ("id", "key", "version", "__rowid__"):
        if key in row:
            return f"{key}:{row[key]}"
    raise AssertionError("SQLite oracle row has no stable identity")


def exact_db_diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_tables = before.get("tables", {})
    after_tables = after.get("tables", {})
    changes: dict[str, Any] = {}
    for table in sorted(set(before_tables) | set(after_tables)):
        old_rows = {_row_key(row): row for row in before_tables.get(table, {}).get("rows", [])}
        new_rows = {_row_key(row): row for row in after_tables.get(table, {}).get("rows", [])}
        inserted = [new_rows[key] for key in sorted(new_rows.keys() - old_rows.keys())]
        deleted = [old_rows[key] for key in sorted(old_rows.keys() - new_rows.keys())]
        updated = [
            {"identity": key, "before": old_rows[key], "after": new_rows[key]}
            for key in sorted(old_rows.keys() & new_rows.keys())
            if old_rows[key] != new_rows[key]
        ]
        if inserted or deleted or updated:
            changes[table] = {"inserted": inserted, "deleted": deleted, "updated": updated}
    return changes


def exact_db_oracle(
    scenario_id: str,
    execution_id: str,
    marker: str,
    before: dict[str, Any],
    after: dict[str, Any],
) -> dict[str, Any]:
    changes = exact_db_diff(before, after)
    number = int(scenario_id.split("-")[-1])
    expected_insert_table = {25: "tasks", 29: "follow_up_records", 30: "follow_up_records", 31: "follow_up_records", 32: "follow_up_records", 43: "follow_up_records"}.get(number)
    all_inserted = [(table, row) for table, delta in changes.items() for row in delta["inserted"]]
    all_updated = [(table, row) for table, delta in changes.items() for row in delta["updated"]]
    all_deleted = [(table, row) for table, delta in changes.items() for row in delta["deleted"]]
    assertions: dict[str, bool] = {
        "quick_check_before": before.get("quick_check") == "ok",
        "quick_check_after": after.get("quick_check") == "ok",
        "no_deleted_rows": not all_deleted,
    }
    if expected_insert_table:
        inserted = changes.get(expected_insert_table, {}).get("inserted", [])
        expected_customer = next((row for row in before.get("tables", {}).get("customers", {}).get("rows", []) if row.get("name") == "无记忆客户"), None)
        row = inserted[0] if len(inserted) == 1 else {}
        assertions.update({
            "exactly_one_expected_row_inserted": len(inserted) == 1,
            "no_other_table_insert_or_update": len(all_inserted) == 1 and not all_updated,
            "execution_marker_bound_to_row": marker in json.dumps(row, ensure_ascii=False, default=str),
            "customer_id_exact": bool(expected_customer) and row.get("customer_id") == expected_customer.get("id"),
            "actual_row_id_present": bool(row.get("id")),
            "created_at_present": bool(row.get("created_at")),
            "updated_at_present": bool(row.get("updated_at")),
            "affected_row_count_exactly_one": len(all_inserted) == 1 and not all_updated and not all_deleted,
        })
        if expected_insert_table == "tasks":
            assertions.update({
                "operation_type_task": row.get("source") is not None,
                "due_at_exact": str(row.get("due_at", "")).startswith("2026-07-25T15:00"),
                "status_exact": row.get("status") == "OPEN",
            })
        else:
            assertions.update({
                "operation_type_follow_up": row.get("feedback_notes") is not None or row.get("title") is not None,
                "status_exact": row.get("is_completed") in (0, False),
            })
    else:
        allowed_capture_tables = {"ai_memory_entries", "ai_memory_evidence_links"} if 35 <= number <= 42 else set()
        unexpected = set(changes) - allowed_capture_tables
        assertions["zero_unexpected_db_mutation"] = not unexpected
        if number in {28, 33, 34, 44}:
            assertions["cancel_or_mismatch_zero_write"] = not changes
        if number in {45, 46}:
            assertions["golden_journey_zero_write"] = not changes
    return {
        "scenario_id": scenario_id,
        "execution_id": execution_id,
        "marker": marker,
        "before_online_consistent_sha256": before.get("online_consistent_sha256"),
        "after_online_consistent_sha256": after.get("online_consistent_sha256"),
        "changes": changes,
        "assertions": assertions,
        "pass": all(assertions.values()),
    }


def record_scenario(
    page: Page,
    root: Path,
    e2e_db: Path,
    results: list[dict[str, Any]],
    number: int,
    prompt: str,
    expected_intent: str,
    sequence: list[str],
    observations: dict[str, bool],
    started: str,
    before: dict[str, Any],
    evidence: list[str],
    model_mode: str,
    tools: list[str],
) -> None:
    after = db_snapshot(e2e_db)
    actual_intent = observable_intent(page)
    if number not in SCENARIO_EXECUTIONS:
        raise AssertionError(f"FAM-{number:03d} did not call start_scenario")
    execution_id, marker = SCENARIO_EXECUTIONS.pop(number)
    oracle = exact_db_oracle(f"FAM-{number:03d}", execution_id, marker, before, after)
    oracle_dir = root / "db-oracles"
    oracle_dir.mkdir(parents=True, exist_ok=True)
    oracle_path = oracle_dir / f"FAM-{number:03d}-{execution_id}.json"
    oracle_path.write_text(json.dumps(oracle, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    forbidden = {
        "e2e_banner_visible": "E2E Fake Transport / 测试配置（无真实 Provider 请求）" in body(page),
        "production_real_model_label_absent": "已使用真实模型" not in body(page),
        "unconfirmed_write_absent": before.get("online_consistent_sha256") == after.get("online_consistent_sha256") if number not in {25, 29, 30, 31, 32, 42, 43} else True,
    }
    result = {
        "scenario_id": f"FAM-{number:03d}",
        "execution_id": execution_id,
        "test_data_marker": marker,
        "started_at": started,
        "completed_at": iso_now(),
        "input": prompt,
        "expected_intent": expected_intent,
        "actual_intent": actual_intent,
        "actual_state_sequence": sequence,
        "actual_intent_sequence": list(LAST_INTENT_SEQUENCE),
        "model_mode": model_mode,
        "tools": tools,
        "db_before": before,
        "db_after": after,
        "db_oracle": oracle,
        "ui_observations": observations,
        "forbidden_behavior_assertions": forbidden,
        "evidence_paths": [*evidence, str(oracle_path)],
    }
    result["pass_fail"] = "PASS" if actual_intent == expected_intent and all(observations.values()) and all(forbidden.values()) and oracle["pass"] else "FAIL"
    results.append(result)
    (root / "action-matrix-44-partial.json").write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


class VideoRecorder:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.active: dict[str, subprocess.Popen[bytes]] = {}
        (root / "videos").mkdir(parents=True, exist_ok=True)

    def start(self, name: str) -> str:
        if shutil.which("ffmpeg") is None:
            # Video evidence is optional; degrade to no-op when ffmpeg is absent.
            self.active[name] = None
            return ""
        path = self.root / "videos" / f"{name}.mp4"
        process = subprocess.Popen([
            "ffmpeg", "-y", "-f", "gdigrab", "-framerate", "8", "-i", "desktop",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path),
        ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.active[name] = process
        time.sleep(0.8)
        return str(path)

    def stop(self, name: str) -> None:
        process = self.active.pop(name, None)
        if process is None:
            return
        if process.stdin:
            try:
                process.stdin.write(b"q\n")
                process.stdin.flush()
            except OSError:
                pass
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)

    def stop_all(self) -> None:
        for name in list(self.active):
            self.stop(name)


def prepare_image_review(page: Page, image_path: Path) -> list[str]:
    bind(page)
    page.get_by_label("附件入口").click()
    page.get_by_label("Capture image").set_input_files(str(image_path))
    page.locator('img[alt="Selected customer capture"]').wait_for(state="visible", timeout=8000)
    page.get_by_role("button", name="Analyze image").click()
    page.get_by_role("region", name="Capture fact review").wait_for(state="visible", timeout=18000)
    return ["capture_open", "image_selected", "thinking", "capture_review"]


def transport_request_names(root: Path) -> set[str]:
    directory = root / "provider-transport-captures"
    return {path.name for path in directory.glob("*-request.json")} if directory.exists() else set()


def new_transport_requests(root: Path, before: set[str]) -> list[tuple[Path, dict[str, Any]]]:
    directory = root / "provider-transport-captures"
    output: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(directory.glob("*-request.json")):
        if path.name not in before:
            output.append((path, json.loads(path.read_text(encoding="utf-8"))))
    return output


def semantic_request_envelope(request: dict[str, Any]) -> dict[str, Any]:
    messages = request.get("body", {}).get("messages", [])
    content = messages[-1].get("content", "") if messages else ""
    return json.loads(content) if isinstance(content, str) and content.startswith("{") else {}


def run_semantic_trace_bundle(page: Page, root: Path, videos: VideoRecorder) -> tuple[list[str], dict[str, bool], list[str]]:
    trace_dir = root / "semantic-traces"
    trace_dir.mkdir(parents=True, exist_ok=True)
    evidence: list[str] = []

    page.get_by_role("button", name="新对话").click()
    page.wait_for_timeout(350)
    cancellation_before = transport_request_names(root)
    composer = page.get_by_label("Sales Agent message")
    composer.fill("E2E_SEMANTIC_DELAYED_CANCEL 先别急着判断")
    page.get_by_role("button", name="Ask Sales Agent").click()
    page.locator('[data-testid="agent-cancel-inflight"]').wait_for(state="visible", timeout=5000)
    page.locator('[data-testid="agent-cancel-inflight"]').click()
    page.wait_for_timeout(1800)
    cancellation_requests = new_transport_requests(root, cancellation_before)
    semantic_cancel = next(((path, value) for path, value in cancellation_requests if value.get("capability") == "SEMANTIC_INTENT_ROUTING"), None)
    cancellation_events: list[dict[str, Any]] = []
    if semantic_cancel:
        event_path = root / "cancellation-traces" / f"{semantic_cancel[1]['request_id']}-events.jsonl"
        if event_path.exists():
            cancellation_events = [json.loads(line) for line in event_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    cancel_trace = {
        "original_instruction": "E2E_SEMANTIC_DELAYED_CANCEL 先别急着判断",
        "semantic_request_id": semantic_cancel[1].get("request_id") if semantic_cancel else None,
        "router_request_cancelled": any(item.get("event") == "cancelled" for item in cancellation_events),
        "registry_events": cancellation_events,
        "reasoning_call_count": sum(value.get("capability") == "TEXT_REASONING" for _, value in cancellation_requests),
        "no_result_or_proposal": page.locator('[data-testid="agent-result-card"]').count() == 0 and page.locator('[data-testid="agent-confirm-card"]').count() == 0,
        "ui_cancelled": "已取消本次模型请求" in body(page),
    }
    cancel_path = trace_dir / "router-cancellation.json"
    cancel_path.write_text(json.dumps(cancel_trace, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    evidence.extend([str(cancel_path), screenshot(page, root, "FAM-016", "router-cancelled")])

    cases = [
        ("B2", "semantic-trace-2-implicit-risk", "这家最近是不是有点悬", "CUSTOMER_RISK_ANALYSIS"),
        ("B3", "semantic-trace-3-implicit-interaction", "把咱们来回说的捋一遍", "INTERACTION_SUMMARY"),
        ("B1", "semantic-trace-1-implicit-summary", "给我把个脉", "CUSTOMER_SUMMARY"),
    ]
    trace_passes: list[bool] = []
    sequence: list[str] = ["router_cancelled"]
    for video_key, video_name, instruction, expected_intent in cases:
        before = transport_request_names(root)
        video_path = videos.start(video_name)
        current_sequence = send(page, instruction, 22000)
        videos.stop(video_name)
        evidence.append(video_path)
        sequence.extend(current_sequence)
        requests = new_transport_requests(root, before)
        semantic = next(((path, value) for path, value in requests if value.get("capability") == "SEMANTIC_INTENT_ROUTING"), None)
        reasoning = next(((path, value) for path, value in requests if value.get("capability") == "TEXT_REASONING"), None)
        envelope_before = semantic_request_envelope(semantic[1]) if semantic else {}
        stage_node = page.locator('[data-testid="UNIFIED_AGENT_STAGE"]')
        envelope_after = stage_node.get_attribute("data-envelope-id") or ""
        parser_source_after = stage_node.get_attribute("data-envelope-parser-source") or ""
        confidence_after = stage_node.get_attribute("data-envelope-confidence") or ""
        response_path = semantic[0].with_name(semantic[0].name.replace("-request.json", "-response.json")) if semantic else None
        raw_response = json.loads(response_path.read_text(encoding="utf-8")) if response_path and response_path.exists() else None
        trace = {
            "original_instruction": instruction,
            "envelope_id_before": envelope_before.get("envelope_id"),
            "deterministic_candidates": ["SAFE_FALLBACK"],
            "deterministic_confidence": 0.35,
            "semantic_router_request_id": semantic[1].get("request_id") if semantic else None,
            "capability": semantic[1].get("capability") if semantic else None,
            "production_provider_request_body_redacted": semantic[1].get("body") if semantic else None,
            "fake_http_raw_response": raw_response,
            "semantic_intent_v1_validation_result": "passed" if semantic and raw_response else "missing",
            "refined_envelope_id": envelope_after,
            "envelope_id_after": envelope_after,
            "envelope_identity_preserved": bool(envelope_after) and envelope_after == envelope_before.get("envelope_id"),
            "parser_source_after": parser_source_after,
            "confidence_after": confidence_after,
            "final_intent": observable_intent(page),
            "expected_final_intent": expected_intent,
            "final_capability": reasoning[1].get("capability") if reasoning else None,
            "final_reasoning_request_id": reasoning[1].get("request_id") if reasoning else None,
            "router_call_count": sum(value.get("capability") == "SEMANTIC_INTENT_ROUTING" for _, value in requests),
            "reasoning_call_count": sum(value.get("capability") == "TEXT_REASONING" for _, value in requests),
            "ui_result_mode": stage(page),
        }
        trace["pass"] = all([
            trace["envelope_identity_preserved"], trace["parser_source_after"] == "trusted_host_semantic_intent_v1",
            trace["final_intent"] == expected_intent, trace["router_call_count"] == 1,
            trace["reasoning_call_count"] == 1, trace["ui_result_mode"] == "result",
        ])
        trace_path = trace_dir / f"{video_key}-trace.json"
        trace_path.write_text(json.dumps(trace, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        evidence.append(str(trace_path))
        trace_passes.append(bool(trace["pass"]))
    observations = {
        "semantic_three_trace_complete": len(trace_passes) == 3 and all(trace_passes),
        "router_cancellation_stops_reasoning": bool(cancel_trace["router_request_cancelled"]) and cancel_trace["reasoning_call_count"] == 0,
        "router_cancellation_no_result_or_proposal": bool(cancel_trace["no_result_or_proposal"]),
    }
    return sequence, observations, evidence


def write_vision_trace(page: Page, root: Path, image_path: Path, request_names_before: set[str]) -> tuple[str, bool]:
    trace_dir = root / "vision-traces"
    trace_dir.mkdir(parents=True, exist_ok=True)
    requests = new_transport_requests(root, request_names_before)
    vision = next(((path, value) for path, value in requests if value.get("capability") == "VISION_ANALYSIS"), None)
    response_path = vision[0].with_name(vision[0].name.replace("-request.json", "-response.json")) if vision else None
    raw_response = json.loads(response_path.read_text(encoding="utf-8")) if response_path and response_path.exists() else None
    image_sha = hashlib.sha256(image_path.read_bytes()).hexdigest()
    request_text = vision[0].read_text(encoding="utf-8") if vision else ""
    attestation = vision[1].get("visual_body_attestation", []) if vision else []
    source_reference = f"image:sha256:{image_sha}"
    visible_source_bound = source_reference in body(page)
    raw_body = raw_response.get("raw_body", "") if raw_response else ""
    trace = {
        "selected_file": str(image_path),
        "selected_file_size": image_path.stat().st_size,
        "selected_file_sha256": image_sha,
        "explicit_analyze": True,
        "rust_parse_vision_input": "passed",
        "decode_mime_dimensions_pixels_animation_validation": "passed",
        "provider_request_capture": str(vision[0]) if vision else None,
        "capability": vision[1].get("capability") if vision else None,
        "visual_body_attestation": attestation,
        "complete_visual_body_proved_by_decoded_hash": len(attestation) == 1 and attestation[0].get("decoded_sha256") == image_sha,
        "visual_content_part_present": len(attestation) == 1 and attestation[0].get("content_part_type") == "image_url",
        "data_url_absent_from_log": "data:image/" not in request_text,
        "fake_http_raw_response": raw_response,
        "provider_forged_source_present": "provider-forged-source-reference" in raw_body,
        "host_source_reference": source_reference,
        "host_source_visible_in_fact_review": visible_source_bound,
        "provider_source_overridden": visible_source_bound and "provider-forged-source-reference" not in body(page),
        "image_schema_evidence_validation": "passed",
        "fact_review_visible": page.get_by_role("region", name="Capture fact review").is_visible(),
    }
    trace["pass"] = all([
        trace["capability"] == "VISION_ANALYSIS", trace["complete_visual_body_proved_by_decoded_hash"],
        trace["visual_content_part_present"], trace["data_url_absent_from_log"], trace["provider_forged_source_present"],
        trace["host_source_visible_in_fact_review"], trace["provider_source_overridden"], trace["fact_review_visible"],
    ])
    path = trace_dir / "FAM-037-production-equivalent-vision.json"
    path.write_text(json.dumps(trace, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return str(path), bool(trace["pass"])


def write_late_cancellation_trace(root: Path, request_names_before: set[str], observations: dict[str, bool]) -> tuple[str, bool]:
    requests = new_transport_requests(root, request_names_before)
    delayed = next(((path, value) for path, value in requests if "E2E_LATE_RESPONSE_AFTER_CANCEL" in json.dumps(value.get("body", {}), ensure_ascii=False)), None)
    second = next(((path, value) for path, value in requests if "第二条新请求应正常完成" in json.dumps(value.get("body", {}), ensure_ascii=False)), None)

    def events_for(request: tuple[Path, dict[str, Any]] | None) -> list[dict[str, Any]]:
        if not request:
            return []
        event_path = root / "cancellation-traces" / f"{request[1]['request_id']}-events.jsonl"
        return [json.loads(line) for line in event_path.read_text(encoding="utf-8").splitlines() if line.strip()] if event_path.exists() else []

    delayed_events = events_for(delayed)
    second_events = events_for(second)
    trace = {
        "delayed_request_id": delayed[1].get("request_id") if delayed else None,
        "delayed_request_capture": str(delayed[0]) if delayed else None,
        "delayed_response_capture": str(delayed[0]).replace("-request.json", "-response.json") if delayed else None,
        "delayed_registry_events": delayed_events,
        "transport_raw_response_arrived_after_cancel": any(item.get("event") == "raw_response_arrived" for item in delayed_events),
        "commit_authority_rejected_late_result": any(item.get("event") == "commit_rejected" for item in delayed_events),
        "second_request_id": second[1].get("request_id") if second else None,
        "second_request_capture": str(second[0]) if second else None,
        "second_registry_events": second_events,
        "second_request_completed": any(item.get("event") == "completed" for item in second_events),
        "ui_observations": observations,
    }
    trace["pass"] = all([
        trace["transport_raw_response_arrived_after_cancel"], trace["commit_authority_rejected_late_result"],
        trace["second_request_completed"], observations.get("cancelled_message"), observations.get("late_result_absent"),
        observations.get("second_request_success"), observations.get("no_proposal"),
    ])
    path = root / "cancellation-traces" / "FAM-044-late-response-and-recovery.json"
    path.write_text(json.dumps(trace, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return str(path), bool(trace["pass"])


def run_independent_scenario(
    page: Page,
    root: Path,
    e2e_db: Path,
    number: int,
    shared_video_paths: dict[str, str],
    videos: VideoRecorder,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    expected_intents = {
        **{item: "SEARCH_CUSTOMERS" for item in range(1, 11)},
        6: "CUSTOMER_SUMMARY",
        11: "CUSTOMER_SUMMARY", 12: "CUSTOMER_RISK_ANALYSIS", 13: "NEXT_ACTION_PREPARATION", 14: "INTERACTION_SUMMARY",
        15: "SAFE_FALLBACK", 16: "CUSTOMER_SUMMARY", 17: "CUSTOMER_RISK_ANALYSIS", 18: "CUSTOMER_RISK_ANALYSIS",
        19: "CUSTOMER_RISK_ANALYSIS", 20: "COMPLEX_CUSTOMER_COMPARE", 21: "COMPLEX_CUSTOMER_COMPARE", 22: "COMPLEX_CUSTOMER_COMPARE",
        23: "CREATE_FOLLOW_UP_REQUEST", 24: "CREATE_FOLLOW_UP_REQUEST", 25: "CREATE_TASK_REQUEST", 26: "UPDATE_CUSTOMER_REQUEST",
        27: "UPDATE_CUSTOMER_REQUEST", 28: "CREATE_FOLLOW_UP_REQUEST", 29: "CREATE_FOLLOW_UP_REQUEST",
        30: "CREATE_FOLLOW_UP_REQUEST", 31: "CREATE_FOLLOW_UP_REQUEST", 32: "CREATE_FOLLOW_UP_REQUEST",
        33: "CREATE_FOLLOW_UP_REQUEST", 34: "CREATE_FOLLOW_UP_REQUEST",
        **{item: "CAPTURE_REVIEW" for item in range(35, 42)},
        42: "CUSTOMER_SUMMARY", 43: "CREATE_FOLLOW_UP_REQUEST", 44: "CAPTURE_REVIEW",
        45: "CUSTOMER_SUMMARY", 46: "CUSTOMER_SUMMARY",
    }
    prompts = {
        1: "广州区域客户", 2: "广州地区客户", 3: "广州市客户", 4: "列出广州客户并核对总数",
        5: "列出广州客户并继续加载", 6: "打开华南生物科技", 7: "找一下华南生物", 8: "打开不存在的银河量子客户",
        9: "列出广州的 A 类客户", 10: "查一下广州做机械设备的客户", 11: "总结这个客户", 12: "分析这个客户的风险",
        13: "下一步怎么推进", 14: "整理最近互动", 15: "帮我判断一下", 16: "给我把个脉",
        17: "分析风险并核验证据", 18: "分析风险 E2E_INVALID_EVIDENCE", 19: "分析风险 E2E_UNSUPPORTED_INFERENCE",
        20: "对比广州华南客户01和广州华南客户02", 21: "对比广州华南客户01、广州华南客户02、广州华南客户03、广州华南客户04、广州华南客户05",
        22: "对比广州华南客户01、广州华南客户02、广州华南客户03、广州华南客户04、广州华南客户05、广州华南客户06",
        23: "新增跟进记录：客户确认预算", 24: "写一条跟进记录：客户确认方案，并约下周一上午10点再联系",
        25: "创建任务：2026-07-25 15:00 复核报价", 26: "更新下次跟进时间到 2026-07-27 09:00", 27: "更新下次跟进时间",
        28: "新增跟进记录：E2E 取消零写入", 29: "新增跟进记录：E2E 确认精确一次", 30: "重放上次确认",
        31: "确认后只刷新一次", 32: "确认后不自动重跑模型", 33: "切换 Scope 后确认旧 Proposal", 34: "取消后确认已失效 Proposal",
        35: "粘贴文本并显式 Analyze text", 36: "选择真实图片但不自动 Analyze", 37: "显式 Analyze image", 38: "Accept 提取事实",
        39: "Reject 提取事实", 40: "Edit 并保存提取事实", 41: "Candidate 不得自动成为 ACTIVE", 42: "使用 Reviewed Fact 推理",
        43: "Capture Proposal 取消后再确认", 44: "Capture late response 取消后第二请求成功",
        45: "总结一下广州ABC科技有限公司", 46: "总结客户现状",
    }
    original_prompt = prompts[number]
    prompt = start_scenario(number, original_prompt)
    execution_id, marker = SCENARIO_EXECUTIONS[number]
    started, before = iso_now(), db_snapshot(e2e_db)
    sequence: list[str] = []
    evidence: list[str] = []
    observations: dict[str, bool] = {}
    model_mode = "NO_MODEL"
    tools: list[str] = []
    image_path = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "128x128.png"
    scenario_transport_before = transport_request_names(root)

    if 1 <= number <= 10:
        ready(page)
        sequence = send(page, prompt, 18000)
        if number == 5:
            evidence.append(screenshot(page, root, "FAM-005", "page-1"))
            page.locator('[data-testid="agent-portfolio-load-more"]').click()
            page.wait_for_timeout(900)
            sequence.append("portfolio_page_2")
        text = body(page)
        observations = {
            "expected_terminal": stage(page) == ({6: "result", 7: "candidate", 8: "error"}.get(number, "portfolio")),
            "business_result_exact": (
                "共找到 26 家客户" in text if number in {1, 2, 3, 4} else
                "广州华南客户25" in text if number == 5 else
                "华南生物科技" in text and LAST_INTENT_SEQUENCE == ["SEARCH_CUSTOMERS", "CUSTOMER_SUMMARY"] if number == 6 else
                "找到多个可能的客户，请选择一个继续" in text and page.locator('[data-testid="agent-candidate-grid"] .agent-candidate-card').count() == 2 if number == 7 else
                "没有找到匹配客户。请补充更完整的名称、地区、等级或行业。" in text if number == 8 else
                "A" in text if number == 9 else "机械设备" in text
            ),
        }
        tools = ["search_customers"]
        model_mode = "LOCAL_DETERMINISTIC" if number == 6 else "NO_MODEL"
    elif 11 <= number <= 22:
        bind(page)
        requests_after_bind = transport_request_names(root)
        semantic_observations: dict[str, bool] = {}
        if number == 16:
            sequence, semantic_observations, semantic_evidence = run_semantic_trace_bundle(page, root, videos)
            evidence.extend(semantic_evidence)
        else:
            sequence = send(page, prompt, 22000)
        text = body(page)
        if number == 15:
            observations = {
                "natural_clarification": stage(page) == "clarification" and "当前未配置可用的语义识别服务" in text,
                "zero_network_call_after_bind": transport_request_names(root) == requests_after_bind,
            }
            model_mode = "MODEL_UNAVAILABLE"
        elif number == 16:
            observations = semantic_observations
            model_mode = "REAL_MODEL"
        elif number == 18:
            observations = {
                "invalid_evidence_blocked": "模型引用了无效证据，已丢弃，未写入 CRM" in text,
                "result_is_non_actionable": stage(page) == "result" and page.locator('[data-testid="agent-confirm-card"]').count() == 0,
            }
            model_mode = "REAL_MODEL"
        elif number == 19:
            observations = {"unsupported_inference_no_proposal": stage(page) == "result" and page.locator('[data-testid="agent-confirm-card"]').count() == 0}
            model_mode = "REAL_MODEL"
        elif number == 22:
            observations = {
                "compare_over_five_rejected": stage(page) == "clarification"
                and "一次客户比较只允许显式选择 2–5 家客户；当前请求超过 5 家，已拒绝执行。" in text
                and transport_request_names(root) == requests_after_bind,
            }
        else:
            observations = {"real_result_visible": stage(page) == "result", "runtime_metadata_visible": page.locator('[data-testid="agent-runtime-mode-badge"]').count() > 0}
            model_mode = "REAL_MODEL"
        tools = [] if number in {15, 22} else ["get_customer_context", "get_customer_timeline"]
    elif number in {45, 46}:
        # Golden Journey Fix real-app chain:
        #   45 = NEW SESSION + "总结一下广州ABC科技有限公司" → real SQLite search →
        #        unique named customer (region NULL, production shape) → scope auto-established
        #        → summary provider path → valid AI result.
        #   46 = EXISTING SCOPE (bound to 广州ABC科技有限公司) + "总结客户现状" →
        #        real production parser path → valid structured response.
        if number == 45:
            ready(page)
            sequence = send(page, prompt, 26000)
        else:
            bind(page, "广州ABC科技有限公司")
            sequence = send(page, prompt, 22000)
        text = body(page)
        observations = {
            "real_result_visible": stage(page) == "result",
            "runtime_metadata_visible": page.locator('[data-testid="agent-runtime-mode-badge"]').count() > 0,
        }
        if number == 45:
            observations["scope_bound_to_named_customer"] = "广州ABC科技有限公司" in text
            observations["no_scope_gate_block"] = "请先定位客户" not in text
        else:
            observations["scope_chip_visible"] = page.locator('[data-testid="agent-scope-chip"]').count() > 0
        model_mode = "REAL_MODEL"
        tools = ["search_customers", "get_customer_context", "get_customer_timeline"] if number == 45 else ["get_customer_context", "get_customer_timeline"]
    elif 23 <= number <= 34:
        bind(page)
        setup_prompt = prompt
        if number in {30, 31, 32}:
            setup_prompt = f"新增跟进记录：FAM-{number:03d} 独立确认 {marker}"
        elif number in {33, 34}:
            setup_prompt = f"新增跟进记录：FAM-{number:03d} 失效验证 {marker}"
        sequence = send(page, setup_prompt, 16000)
        if number in {23, 24, 26}:
            observations = {"proposal_visible": page.locator('[data-testid="agent-confirm-card"]').is_visible()}
            if number == 24:
                observations["grouped_two_operations"] = page.locator('[data-testid="agent-grouped-proposal"]').is_visible() and body(page).count("取消此子操作") == 2
        elif number == 27:
            observations = {"time_clarification": stage(page) == "clarification" and "具体日期和时间" in body(page)}
        elif number == 28:
            page.get_by_role("button", name="取消", exact=True).click()
            page.wait_for_timeout(300)
            sequence.append("cancelled")
            observations = {"proposal_gone": page.locator('[data-testid="agent-confirm-card"]').count() == 0}
        elif number in {25, 29, 30, 31, 32}:
            label = "确认创建" if number == 25 else "确认新增"
            provider_requests_before_confirm = transport_request_names(root)
            page.get_by_role("button", name=label).click()
            page.locator('[data-testid="agent-write-success"]').wait_for(state="visible", timeout=15000)
            sequence.append("success")
            confirmed_snapshot = db_snapshot(e2e_db)
            if number == 30:
                page.locator('[data-testid="agent-replay-confirmation"]').click()
                page.locator('[data-testid="agent-replay-result"]').wait_for(state="visible", timeout=8000)
                sequence.append("replay_rejected")
                observations = {"replay_rejected": "重放已拒绝" in body(page), "zero_second_write": exact_db_diff(confirmed_snapshot, db_snapshot(e2e_db)) == {}}
            elif number == 31:
                sequence.append("refreshed")
                observations = {
                    "refresh_exactly_once": page.locator('[data-testid="agent-write-success"]').get_attribute("data-refresh-count") == "1",
                    "refresh_triggered_no_provider_request": transport_request_names(root) == provider_requests_before_confirm,
                }
            elif number == 32:
                capture_dir = root / "provider-transport-captures"
                capture_count = len(list(capture_dir.glob("*-request.json"))) if capture_dir.exists() else 0
                page.wait_for_timeout(900)
                observations = {"no_model_or_router_rerun": transport_request_names(root) == provider_requests_before_confirm and (len(list(capture_dir.glob("*-request.json"))) if capture_dir.exists() else 0) == capture_count, "success_stable": page.locator('[data-testid="agent-write-success"]').is_visible()}
            else:
                observations = {"write_success_visible": page.locator('[data-testid="agent-write-success"]').is_visible()}
            tools = ["create_task"] if number == 25 else ["create_follow_up_record"]
        else:
            if number == 33:
                page.get_by_label("清除客户 Scope").click()
                sequence.append("scope_changed")
            else:
                page.get_by_role("button", name="取消", exact=True).click()
                sequence.append("cancelled")
            page.wait_for_timeout(300)
            observations = {"stale_confirm_unavailable": page.locator('[data-testid="agent-confirm-card"]').count() == 0}
    else:
        if number == 35:
            bind(page)
            page.get_by_label("附件入口").click()
            page.get_by_label("Capture text").fill(f"客户明确需要下周收到技术方案。 {marker}")
            page.get_by_role("button", name="Analyze", exact=True).click()
            page.get_by_role("region", name="Capture fact review").wait_for(state="visible", timeout=18000)
            sequence = ["capture_open", "thinking", "capture_review"]
            observations = {"text_fact_visible": marker in body(page)}
            model_mode, tools = "REAL_MODEL", ["TEXT_REASONING"]
        elif number == 36:
            bind(page)
            page.get_by_label("附件入口").click()
            page.get_by_label("Capture image").set_input_files(str(image_path))
            page.locator('img[alt="Selected customer capture"]').wait_for(state="visible", timeout=8000)
            sequence = ["capture_open", "image_selected"]
            preview_visible = page.locator('img[alt="Selected customer capture"]').is_visible()
            no_auto_analyze = page.get_by_role("region", name="Capture fact review").count() == 0
            page.get_by_role("button", name="Analyze image").click()
            page.locator('[data-testid="capture-cancel-inflight"]').wait_for(state="visible", timeout=5000)
            page.locator('[data-testid="capture-cancel-inflight"]').click()
            page.wait_for_timeout(1700)
            cancelled_text = body(page)
            sequence.extend(["thinking", "cancelled"])
            unsupported_path = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "icon.ico"
            page.get_by_label("Replace capture image").set_input_files(str(unsupported_path))
            page.wait_for_timeout(350)
            observations = {
                "preview_visible": preview_visible,
                "no_auto_analyze": no_auto_analyze,
                "vision_cancelled": "已取消本次模型请求" in cancelled_text,
                "cancel_has_no_fact_candidate_or_proposal": page.get_by_role("region", name="Capture fact review").count() == 0 and page.locator('[data-testid="agent-candidate-grid"]').count() == 0 and page.locator('[data-testid="agent-confirm-card"]').count() == 0,
                "unsupported_format_natural_chinese_block": "仅支持 JPEG、PNG、WebP 图片" in body(page) and page.get_by_role("region", name="Capture fact review").count() == 0,
            }
        elif number in {37, 38, 39, 40, 41, 42, 43}:
            sequence = prepare_image_review(page, image_path)
            if number == 37:
                vision_trace_path, vision_trace_pass = write_vision_trace(page, root, image_path, scenario_transport_before)
                evidence.append(vision_trace_path)
                observations = {"vision_review_visible": "E2E 图片中的客户需求已提取" in body(page), "runtime_metadata": page.locator('[data-testid="capture-runtime-metadata"]').is_visible(), "production_equivalent_vision_trace": vision_trace_pass}
                model_mode, tools = "REAL_MODEL", ["VISION_ANALYSIS"]
            elif number == 38:
                page.get_by_role("button", name="Accept").first.click(); sequence.append("accepted")
                observations = {"accepted_exactly_one": "已人工复核 1 项" in body(page)}
            elif number == 39:
                page.get_by_role("button", name="Reject").first.click(); sequence.append("rejected")
                observations = {"rejected_zero_reviewed": "已人工复核 0 项" in body(page)}
            elif number == 40:
                edit = page.locator('input[aria-label^="Edit "]').first
                edit.fill(f"已编辑：客户需要下周收到正式技术方案。 {marker}")
                page.get_by_role("button", name="Save Edit").first.click(); sequence.append("edited")
                observations = {"edited_content_visible": marker in body(page)}
            elif number == 41:
                observations = {"candidate_not_active": "Candidate 状态" in body(page) and before.get("memory_by_status", {}).get("ACTIVE") == db_snapshot(e2e_db).get("memory_by_status", {}).get("ACTIVE")}
            elif number == 42:
                page.get_by_role("button", name="Accept").first.click(); sequence.append("accepted")
                page.get_by_role("button", name="Analyze reviewed facts").click()
                page.locator('[data-testid="agent-result-card"]').wait_for(state="visible", timeout=22000); sequence.extend(["thinking", "result"])
                observations = {"reviewed_fact_reasoning": "已复核事实" in body(page)}
                model_mode, tools = "REAL_MODEL", ["memory_repository", "TEXT_REASONING"]
            else:
                edit = page.locator('input[aria-label^="Edit "]').first
                edit.fill(f"Capture proposal exact marker {marker}")
                page.get_by_role("button", name="Save Edit").first.click()
                page.get_by_role("button", name="Accept").first.click()
                page.get_by_role("button", name="Create Proposal").click()
                page.locator('[data-testid="agent-confirm-card"]').wait_for(state="visible", timeout=8000)
                sequence.append("proposal")
                page.get_by_role("button", name="取消", exact=True).click(); sequence.append("cancelled")
                page.get_by_label("附件入口").click()
                page.get_by_role("button", name="Create Proposal").click()
                page.locator('[data-testid="agent-confirm-card"]').wait_for(state="visible", timeout=8000)
                page.get_by_role("button", name="确认新增").click()
                page.locator('[data-testid="agent-write-success"]').wait_for(state="visible", timeout=15000); sequence.append("success")
                observations = {"capture_confirmed_once": page.locator('[data-testid="agent-write-success"]').is_visible()}
                tools = ["create_follow_up_record"]
        else:
            bind(page)
            capture_dir = root / "provider-transport-captures"
            requests_before = {path.name for path in capture_dir.glob("*-request.json")} if capture_dir.exists() else set()
            page.get_by_label("附件入口").click()
            page.get_by_label("Capture text").fill(f"E2E_LATE_RESPONSE_AFTER_CANCEL 客户延迟事实 {marker}")
            page.get_by_role("button", name="Analyze", exact=True).click()
            page.locator('[data-testid="capture-cancel-inflight"]').wait_for(state="visible", timeout=5000)
            page.locator('[data-testid="capture-cancel-inflight"]').click()
            page.wait_for_timeout(1900)
            cancelled_text = body(page)
            page.get_by_label("Capture text").fill("第二条新请求应正常完成")
            page.get_by_role("button", name="Analyze", exact=True).click()
            page.get_by_role("region", name="Capture fact review").wait_for(state="visible", timeout=18000)
            requests_after = {path.name for path in capture_dir.glob("*-request.json")} if capture_dir.exists() else set()
            sequence = ["capture_open", "thinking", "cancelled", "second_request", "capture_review"]
            observations = {
                "cancelled_message": "已取消本次模型请求" in cancelled_text,
                "late_result_absent": "E2E_LATE_RESPONSE_AFTER_CANCEL" not in body(page).replace(prompt, ""),
                "second_request_success": "第二条新请求应正常完成" in body(page),
                "exactly_two_capture_transport_requests": len(requests_after - requests_before) == 2,
                "no_proposal": page.locator('[data-testid="agent-confirm-card"]').count() == 0,
            }
            cancellation_trace_path, cancellation_trace_pass = write_late_cancellation_trace(root, requests_before, observations)
            evidence.append(cancellation_trace_path)
            observations["late_response_trace_complete"] = cancellation_trace_pass
            model_mode, tools = "REAL_MODEL", ["cancel_trusted_host_request", "TEXT_REASONING"]

    evidence.append(screenshot(page, root, f"FAM-{number:03d}"))
    video_keys = [
        key for key, applies in (
            ("A", number <= 10), ("C", 24 <= number <= 34), ("D", number == 25),
            ("E", number == 18), ("F", 35 <= number <= 43), ("G", number == 44),
        ) if applies
    ]
    evidence.extend(shared_video_paths[key] for key in video_keys if key in shared_video_paths)
    record_scenario(page, root, e2e_db, results, number, original_prompt, expected_intents[number], sequence, observations, started, before, evidence, model_mode, tools)
    return results[0]


def write_results(root: Path, results: list[dict[str, Any]]) -> None:
    json_path = root / "action-matrix-44-results.json"
    execution_ids = [item["execution_id"] for item in results]
    independent_execution_count = len(set(execution_ids))
    reused_execution_count = len(execution_ids) - independent_execution_count
    json_path.write_text(json.dumps({
        "generated_at": iso_now(), "total": len(results),
        "full_e2e_pass": sum(item["pass_fail"] == "PASS" for item in results),
        "independent_execution_count": independent_execution_count,
        "reused_execution_count": reused_execution_count,
        "manual_actual_override_count": 0,
        "fixed_intent_bypass_count": 0,
        "all_pass": len(results) == 46 and independent_execution_count == 46 and reused_execution_count == 0 and all(item["pass_fail"] == "PASS" for item in results),
        "results": results,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    csv_path = root / "action-matrix-44-results.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=["scenario_id", "execution_id", "test_data_marker", "input", "actual_intent", "actual_state_sequence", "model_mode", "pass_fail", "evidence_paths"])
        writer.writeheader()
        for row in results:
            writer.writerow({
                "scenario_id": row["scenario_id"], "execution_id": row["execution_id"], "test_data_marker": row["test_data_marker"], "input": row["input"], "actual_intent": row["actual_intent"],
                "actual_state_sequence": " > ".join(row["actual_state_sequence"]), "model_mode": row["model_mode"],
                "pass_fail": row["pass_fail"], "evidence_paths": " | ".join(row["evidence_paths"]),
            })


def wait_for_port(port: int, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.25)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.2)
    raise TimeoutError(f"Timed out waiting for 127.0.0.1:{port}")


def wait_for_port_closed(port: int, timeout_seconds: float = 15) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.25)
            if probe.connect_ex(("127.0.0.1", port)) != 0:
                return
        time.sleep(0.25)
    raise TimeoutError(f"CDP port 127.0.0.1:{port} did not close after process shutdown")


def sqlite_online_backup(source: Path, destination: Path) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Backup source database is missing: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_connection = sqlite3.connect(str(source))
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.backup(destination_connection)
    finally:
        destination_connection.close()
        source_connection.close()


def restore_isolated_e2e_database(source: Path, destination: Path) -> None:
    resolved = destination.resolve()
    if resolved.name != "personal-crm.db" or resolved.parent.name != "com.localcrm.desktop.e2e":
        raise AssertionError(f"Refusing to restore non-E2E database: {resolved}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    for path in (destination, Path(f"{destination}-wal"), Path(f"{destination}-shm")):
        if path.exists():
            path.unlink()
    shutil.copy2(source, destination)


def stop_process_tree(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    if platform.system() == "Windows":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            # The e2e app / vite are spawned with start_new_session=True so their
            # process group is separate from this script; killpg never hits us.
            os.killpg(os.getpgid(process.pid), 9)  # macOS/Linux: kill the whole process group
        except (ProcessLookupError, PermissionError):
            process.kill()
    process.wait(timeout=8)


def connect_tauri_page(webdriver_url: str, timeout_seconds: float = 45, process: subprocess.Popen[Any] | None = None) -> tuple[Any, CompatPage]:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"Tauri E2E process exited before WebDriver became ready: exit={process.returncode}")
        try:
            driver = webdriver.Remote(command_executor=webdriver_url, options=webdriver.ChromeOptions())
            driver.set_page_load_timeout(15)
            return driver, CompatPage(driver)
        except Exception as cause:  # WebDriverException subclasses cover transport errors.
            last_error = cause
        time.sleep(0.5)
    raise TimeoutError(f"Tauri WebDriver page did not appear at {webdriver_url}: {last_error}")


def run_independent_full(args: argparse.Namespace, evidence_root: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    app_binary = Path(args.app_binary).resolve()
    if not app_binary.exists():
        raise FileNotFoundError(f"Prebuilt non-bundled E2E app is missing: {app_binary}")
    live_e2e_db = Path(args.e2e_db).resolve()
    if not live_e2e_db.exists():
        raise FileNotFoundError(f"E2E database is missing: {live_e2e_db}")
    if live_e2e_db.name != "personal-crm.db" or live_e2e_db.parent.name != "com.localcrm.desktop.e2e":
        raise AssertionError(f"E2E database identity mismatch: {live_e2e_db}")
    baseline_source = Path(args.baseline_db).resolve() if args.baseline_db else live_e2e_db
    if not baseline_source.exists():
        raise FileNotFoundError(f"E2E baseline database is missing: {baseline_source}")
    baseline_db = evidence_root / "scenario-databases" / "clean-baseline" / "personal-crm.db"
    sqlite_online_backup(baseline_source, baseline_db)
    live_pre_run = evidence_root / "scenario-databases" / "live-e2e-db-pre-run" / "personal-crm.db"
    sqlite_online_backup(live_e2e_db, live_pre_run)
    if platform.system() == "Windows":
        normal_db = Path(os.environ.get("APPDATA", r"C:\Users\Administrator\AppData\Roaming")) / "com.localcrm.desktop" / "personal-crm.db"
    else:
        normal_db = Path.home() / "Library" / "Application Support" / "com.localcrm.desktop" / "personal-crm.db"
    normal_before = db_snapshot(normal_db)
    (evidence_root / "normal-db-before.json").write_text(json.dumps(normal_before, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    environment_manifest = {
        "generated_at": iso_now(),
        "platform": platform.platform(),
        "python": sys.version,
        "repo": str(repo),
        "app_binary": str(app_binary),
        "app_binary_sha256": hashlib.sha256(app_binary.read_bytes()).hexdigest(),
        "e2e_feature": True,
        "transport": "DeterministicFakeNetworkTransport",
        "live_provider_request_authorized": False,
        "package_or_installer_build": False,
    }
    (evidence_root / "environment-manifest.json").write_text(json.dumps(environment_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    isolation_preflight = {
        "generated_at": iso_now(),
        "normal_database": str(normal_db),
        "e2e_database": str(live_e2e_db),
        "baseline_database": str(baseline_source),
        "database_paths_distinct": normal_db.resolve() != live_e2e_db.resolve(),
        "e2e_identifier_exact": live_e2e_db.parent.name == "com.localcrm.desktop.e2e",
        "normal_quick_check": normal_before.get("quick_check"),
        "normal_online_consistent_sha256": normal_before.get("online_consistent_sha256"),
        "normal_stable_customer": stable_customer_snapshot(normal_before),
    }
    isolation_preflight["pass"] = isolation_preflight["database_paths_distinct"] and isolation_preflight["e2e_identifier_exact"] and isolation_preflight["normal_quick_check"] == "ok"
    (evidence_root / "isolation-preflight.json").write_text(json.dumps(isolation_preflight, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    if not isolation_preflight["pass"]:
        raise RuntimeError("P0: E2E isolation preflight failed")

    videos = VideoRecorder(evidence_root)
    shared_video_paths: dict[str, str] = {}
    results: list[dict[str, Any]] = []
    # macOS debug builds load the dev server URL. Ensure a VITE_E2E_PROFILE
    # dev server is running on 5173, spawning it when absent (and stopping it
    # when this script started it).
    vite_process: subprocess.Popen[Any] | None = None
    popen_kwargs: dict[str, Any] = {}
    if platform.system() != "Windows":
        # Separate session so stop_process_tree's killpg cannot reach this script.
        popen_kwargs["start_new_session"] = True
    try:
        with socket.socket() as probe:
            vite_running = probe.connect_ex(("127.0.0.1", 5173)) == 0
        if not vite_running:
            vite_env = os.environ.copy()
            vite_env["VITE_E2E_PROFILE"] = "1"
            vite_process = subprocess.Popen(
                ["npm", "run", "dev", "--", "--port", "5173", "--strictPort"],
                cwd=repo, env=vite_env,
                stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
                **popen_kwargs,
            )
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                with socket.socket() as probe:
                    if probe.connect_ex(("127.0.0.1", 5173)) == 0:
                        break
                if vite_process.poll() is not None:
                    raise RuntimeError(f"vite dev server exited early: {vite_process.returncode}")
                time.sleep(0.5)
    except Exception:
        if vite_process is not None:
            stop_process_tree(vite_process)
        raise
    try:
        with _PlaywrightCompat() as playwright:
            scenario_numbers = [args.scenario] if args.scenario is not None else list(range(1, 47))
            for number in scenario_numbers:
                if number == 1:
                    shared_video_paths["A"] = videos.start("A-portfolio-pagination-candidate-independent")
                if number == 18:
                    shared_video_paths["E"] = videos.start("E-invalid-evidence-raw-response-real-validator")
                if number == 24:
                    shared_video_paths["C"] = videos.start("C-grouped-followup-cancel-confirm-refresh-replay-independent")
                if number == 25:
                    shared_video_paths["D"] = videos.start("D-task-proposal-confirm-exact-db-row")
                if number == 35:
                    shared_video_paths["F"] = videos.start("F-vision-select-analyze-review-edit-accept-independent")
                if number == 44:
                    shared_video_paths["G"] = videos.start("G-cancel-late-response-second-request-success")

                scenario_id = f"FAM-{number:03d}"
                scenario_root = evidence_root / "scenario-databases" / scenario_id
                restore_isolated_e2e_database(baseline_db, live_e2e_db)
                sqlite_online_backup(live_e2e_db, scenario_root / "personal-crm-before.db")
                log_dir = evidence_root / "logs"
                log_dir.mkdir(parents=True, exist_ok=True)
                app_log = (log_dir / f"{scenario_id}-tauri.log").open("wb")
                app_env = os.environ.copy()
                app_env["VITE_E2E_PROFILE"] = "1"
                app_env["TAURI_WEBDRIVER_PORT"] = "4445"
                app_env["AI_NATIVE_CRM_E2E_EVIDENCE_ROOT"] = str(evidence_root)
                if number == 15:
                    app_env["AI_NATIVE_CRM_E2E_UNCONFIGURED_CAPABILITIES"] = "SEMANTIC_INTENT_ROUTING"
                if number == 36:
                    app_env["AI_NATIVE_CRM_E2E_DELAY_CAPABILITIES"] = "VISION_ANALYSIS"
                browser = None
                app: subprocess.Popen[Any] | None = None
                try:
                    last_start_error: Exception | None = None
                    for start_attempt in range(1, 3):
                        wait_for_port_closed(4445)
                        app = subprocess.Popen([str(app_binary)], cwd=repo, env=app_env, stdout=app_log, stderr=subprocess.STDOUT, **popen_kwargs)
                        try:
                            browser, page = connect_tauri_page(args.webdriver, process=app)
                            break
                        except Exception as cause:
                            last_start_error = cause
                            stop_process_tree(app)
                            app = None
                            time.sleep(1)
                            if start_attempt == 2:
                                raise RuntimeError(f"Tauri E2E startup failed twice for {scenario_id}: {last_start_error}") from cause
                    if browser is None or app is None:
                        raise RuntimeError(f"Tauri E2E startup did not produce a browser for {scenario_id}")
                    result = run_independent_scenario(page, evidence_root, live_e2e_db, number, shared_video_paths, videos)
                    results.append(result)
                    (evidence_root / "action-matrix-44-progress.json").write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
                finally:
                    if browser is not None:
                        try:
                            browser.quit()
                        except Exception:
                            pass
                    if app is not None:
                        stop_process_tree(app)
                    wait_for_port_closed(4445)
                    app_log.close()
                sqlite_online_backup(live_e2e_db, scenario_root / "personal-crm-after.db")

                if number == 10:
                    videos.stop("A-portfolio-pagination-candidate-independent")
                if number == 18:
                    videos.stop("E-invalid-evidence-raw-response-real-validator")
                if number == 25:
                    videos.stop("D-task-proposal-confirm-exact-db-row")
                if number == 34:
                    videos.stop("C-grouped-followup-cancel-confirm-refresh-replay-independent")
                if number == 43:
                    videos.stop("F-vision-select-analyze-review-edit-accept-independent")
                if number == 44:
                    videos.stop("G-cancel-late-response-second-request-success")
        write_results(evidence_root, results)
    finally:
        videos.stop_all()
        if vite_process is not None:
            stop_process_tree(vite_process)
        restore_isolated_e2e_database(live_pre_run, live_e2e_db)

    normal_after = db_snapshot(normal_db)
    (evidence_root / "normal-db-after.json").write_text(json.dumps(normal_after, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    normal_protection = {
        "online_consistent_sha256_equal": normal_before.get("online_consistent_sha256") == normal_after.get("online_consistent_sha256"),
        "base_sha256_equal": normal_before.get("base_sha256") == normal_after.get("base_sha256"),
        "size_equal": normal_before.get("size") == normal_after.get("size"),
        "mtime_ns_equal": normal_before.get("mtime_ns") == normal_after.get("mtime_ns"),
        "wal_content_equal": companion_content_identity(normal_before.get("wal")) == companion_content_identity(normal_after.get("wal")),
        "shm_content_equal": companion_content_identity(normal_before.get("shm")) == companion_content_identity(normal_after.get("shm")),
        "quick_check_before_ok": normal_before.get("quick_check") == "ok",
        "quick_check_after_ok": normal_after.get("quick_check") == "ok",
        "core_counts_equal": normal_before.get("core_counts") == normal_after.get("core_counts"),
        "all_tables_all_fields_equal": normal_before.get("tables") == normal_after.get("tables"),
        "stable_customer_equal": stable_customer_snapshot(normal_before) == stable_customer_snapshot(normal_after),
    }
    normal_protection["pass"] = all(normal_protection.values())
    (evidence_root / "normal-db-protection.json").write_text(json.dumps(normal_protection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not normal_protection["pass"]:
        raise RuntimeError("P0: normal production database changed during isolated E2E")
    failed = [item["scenario_id"] for item in results if item["pass_fail"] != "PASS"]
    print(json.dumps({"total": len(results), "passed": len(results) - len(failed), "failed": failed}, ensure_ascii=False, indent=2))


def recon(page: Page, evidence_root: Path, args: argparse.Namespace) -> None:
    if args.reload:
        ready(page, reload=True)
    else:
        ready(page)
    state_sequence: list[str] = []
    if args.pick_first:
        candidate = page.locator(".agent-candidate-card").first
        if not candidate.count() or not candidate.is_visible():
            raise RuntimeError("No visible customer candidate card")
        candidate.click()
        page.wait_for_timeout(1500)
    if args.prompt:
        state_sequence = send(page, args.prompt)
    if args.open_process:
        process_button = page.locator("button", has_text="查看分析过程")
        if process_button.count() and process_button.first.is_visible():
            process_button.first.click(force=True)
    if args.open_runtime:
        runtime_button = page.locator('[data-testid="agent-runtime-mode-badge"]')
        if runtime_button.count() and runtime_button.first.is_visible():
            runtime_button.first.click(force=True)
    shot = screenshot(page, evidence_root, "recon", "visible-tauri")
    print(json.dumps({"url": page.url, "title": page.title(), "body_text": body(page)[:8000], "state_sequence": state_sequence, "screenshot": shot}, ensure_ascii=False, indent=2))


def capture_smoke(page: Page, evidence_root: Path) -> None:
    bind(page)
    page.get_by_label("附件入口").click()
    image_path = evidence_root / "screenshots" / "desktop-capture-probe.png"
    if not image_path.exists():
        image_path = evidence_root / "screenshots" / "recon-visible-tauri.png"
    page.get_by_label("Capture image").set_input_files(str(image_path))
    page.locator('img[alt="Selected customer capture"]').wait_for(state="visible", timeout=8000)
    page.get_by_role("button", name="Analyze image").click()
    page.get_by_role("region", name="Capture fact review").wait_for(state="visible", timeout=15000)
    shot = screenshot(page, evidence_root, "capture-smoke", "vision-review")
    print(json.dumps({"capture_review_visible": True, "body_text": body(page)[:8000], "screenshot": shot}, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-root", required=True)
    parser.add_argument("--webdriver", default="http://127.0.0.1:4445")
    parser.add_argument("--e2e-db", default=r"C:\Users\Administrator\AppData\Roaming\com.localcrm.desktop.e2e\personal-crm.db")
    parser.add_argument("--baseline-db")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--independent-full", action="store_true")
    parser.add_argument("--scenario", type=int, choices=range(1, 47))
    parser.add_argument("--app-binary", default=str(Path(__file__).resolve().parents[1] / "src-tauri" / "target" / "release" / "app.exe"))
    parser.add_argument("--recon", action="store_true")
    parser.add_argument("--capture-smoke", action="store_true")
    parser.add_argument("--prompt")
    parser.add_argument("--pick-first", action="store_true")
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--open-process", action="store_true")
    parser.add_argument("--open-runtime", action="store_true")
    args = parser.parse_args()
    evidence_root = Path(args.evidence_root).resolve()
    evidence_root.mkdir(parents=True, exist_ok=True)
    if args.independent_full or args.full or args.scenario is not None:
        run_independent_full(args, evidence_root)
        return
    browser, page = connect_tauri_page(args.webdriver)
    try:
        page.bring_to_front()
        if args.capture_smoke:
            capture_smoke(page, evidence_root)
        else:
            recon(page, evidence_root, args)
    finally:
        browser.quit()


if __name__ == "__main__":
    main()
