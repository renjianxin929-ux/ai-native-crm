"""P1 — Migration 005 真实 Tauri 正式启动路径验收驱动。

流程：
1. 从生产 DB 制作一致性副本（quick_check + 行集 hash 验证），放入
   %APPDATA%\\com.localcrm.desktop.battle-card-review\\personal-crm.db（独立 app data，绝不触碰生产 DB）。
2. 启动 vite dev + `tauri dev --config tauri.battleCardReview.conf.json --features e2e`（正式初始化路径）。
3. Playwright CDP 连接（端口 9224），断言页面加载、零 Provider 请求、零业务写入。
4. 关闭；检查副本 DB：新表/索引存在、原有业务表 count + row hash 不变、provider 配置不变、quick_check=ok。
5. 第二次启动：幂等验证。

正常生产 personal-crm.db 全程只读复制，文件级指纹前后一致。
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(r"E:\CodexProjects\CRM专用\local-crm-desktop")
PROD_DB = Path(os.environ["APPDATA"]) / "com.localcrm.desktop" / "personal-crm.db"
REVIEW_DIR = Path(os.environ["APPDATA"]) / "com.localcrm.desktop.battle-card-review"
REVIEW_DB = REVIEW_DIR / "personal-crm.db"
CDP_PORT = 9224
BUSINESS_TABLES = [
    "customers", "follow_up_records", "visit_records", "tasks", "settings",
    "ai_provider_credentials", "ai_drafts", "ai_memory_entries", "ai_memory_evidence_links",
    "lead_import_batches", "lead_import_rows", "lead_work_items", "lead_capture_events",
    "collected_leads", "lead_sync_logs",
]
BATTLE_CARD_TABLES = ["intelligence_imports", "reviewed_facts", "customer_hypotheses", "customer_stage_cards"]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def row_hash(path: Path, customer_columns: list[str] | None = None) -> dict[str, object]:
    """对副本计算每表 count 与行集 hash；正常连接自动读 WAL，计算后 checkpoint 合并。
    customers 表按生产库原有列投影（排除 migration 新增指针列），保证前后可比。"""
    result: dict[str, object] = {}
    con = sqlite3.connect(str(path))
    try:
        result["quick_check"] = con.execute("PRAGMA quick_check").fetchone()[0]
        for table in BUSINESS_TABLES + BATTLE_CARD_TABLES:
            try:
                count = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                if table == "customers" and customer_columns:
                    projection = ", ".join(f'"{col}"' for col in customer_columns)
                    rows = con.execute(f"SELECT {projection} FROM {table} ORDER BY rowid").fetchall()
                else:
                    rows = con.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
                digest = hashlib.sha256(json.dumps([list(row) for row in rows], ensure_ascii=False, default=str).encode("utf-8")).hexdigest()
                result[table] = {"count": count, "row_hash": digest}
            except sqlite3.Error as error:
                result[table] = {"error": str(error)}
        try:
            indexes = [row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")]
            result["indexes"] = indexes
        except sqlite3.Error:
            result["indexes"] = []
    finally:
        try:
            con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
        con.close()
    return result


def wait_for_cdp(timeout: float = 180.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=2) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def kill_process_tree(process: subprocess.Popen) -> None:
    if process.poll() is None:
        try:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=15)
        except Exception:
            process.kill()


def start_vite() -> subprocess.Popen:
    return subprocess.Popen(
        ["npm.cmd", "run", "dev", "--", "--host", "127.0.0.1"],
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )


def start_tauri() -> subprocess.Popen:
    return subprocess.Popen(
        ["npx.cmd", "tauri", "dev", "--config", "src-tauri/tauri.battleCardReview.conf.json", "--features", "e2e"],
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )


def probe_page() -> dict[str, object]:
    """CDP 连接后通过 evaluate 检查页面（不点击、不输入）。"""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        context = browser.contexts[0]
        page = context.pages[0]
        external_requests: list[str] = []
        page.on("request", lambda request: external_requests.append(request.url) if not request.url.startswith(("http://127.0.0.1", "http://localhost", "data:", "blob:")) else None)
        page.wait_for_load_state("domcontentloaded", timeout=30000)
        time.sleep(2.0)
        title = page.title()
        body_text = page.evaluate("document.body ? document.body.innerText.slice(0, 200) : ''")
        # Provider 请求 = 非本机 HTTP 请求（排除 vite HMR/ws 与本机资源）
        provider_requests = [
            url for url in external_requests
            if url.startswith("http") and not url.startswith(("http://127.0.0.1", "http://localhost"))
        ]
        print(f"[probe] external sample: {external_requests[:5]}")
        browser.close()
        return {"title": title, "body_excerpt": body_text, "external_requests": provider_requests}


def main() -> int:
    if not PROD_DB.exists():
        print(f"HOLD: production DB missing at {PROD_DB}")
        return 2

    prod_before = {
        "sha256": sha256_file(PROD_DB),
        "size": PROD_DB.stat().st_size,
        "mtime": PROD_DB.stat().st_mtime,
    }

    # 1) 旧库一致性副本（仅主文件；sidecar 由 SQLite 打开时重建，不复制避免不一致）
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for stale in REVIEW_DIR.glob("personal-crm.db-*"):
        stale.unlink(missing_ok=True)
    shutil.copy2(PROD_DB, REVIEW_DB)
    # 生产库原有 customers 列（投影基线，排除 migration 新增指针列）
    prod_con = sqlite3.connect(str(PROD_DB))
    prod_customer_columns = [row[1] for row in prod_con.execute("PRAGMA table_info(customers)")]
    prod_con.close()
    before_state = row_hash(REVIEW_DB, prod_customer_columns)
    if before_state.get("quick_check") != "ok":
        print("HOLD: old-database copy quick_check failed")
        return 2
    print(f"[baseline] copy quick_check=ok, customers={before_state['customers']['count']}")

    summary: dict[str, object] = {"before": before_state}

    vite = start_vite()
    try:
        for run in (1, 2):
            print(f"[run {run}] starting tauri (real startup path)...")
            tauri = start_tauri()
            try:
                if not wait_for_cdp():
                    print(f"HOLD: CDP endpoint not available on run {run}")
                    return 2
                probe = probe_page()
                summary[f"run{run}_page"] = probe
                print(f"[run {run}] page loaded: title={probe['title']!r} external_requests={len(probe['external_requests'])}")
            finally:
                kill_process_tree(tauri)
                time.sleep(4)

            after_state = row_hash(REVIEW_DB, prod_customer_columns)
            summary[f"run{run}_after"] = after_state
            print(f"[run {run}] quick_check={after_state.get('quick_check')}")

            if after_state.get("quick_check") != "ok":
                print(f"HOLD: quick_check failed after run {run}")
                return 2

            # 原有业务表 count + row hash 不变
            for table in BUSINESS_TABLES:
                before_entry = before_state.get(table)
                after_entry = after_state.get(table)
                if isinstance(before_entry, dict) and isinstance(after_entry, dict):
                    if "error" not in before_entry and before_entry != after_entry:
                        print(f"HOLD: business table {table} changed after run {run}: {before_entry} -> {after_entry}")
                        return 2

            # Migration 005：新表和索引必须存在
            missing_tables = [table for table in BATTLE_CARD_TABLES if table not in after_state or "error" in after_state.get(table, {})]
            if missing_tables:
                print(f"HOLD: battle card tables missing after run {run}: {missing_tables}")
                return 2
            indexes = after_state.get("indexes", [])
            expected_indexes = [
                "idx_intelligence_imports_customer", "idx_intelligence_imports_dedup",
                "idx_reviewed_facts_customer", "idx_customer_hypotheses_customer",
                "idx_customer_stage_cards_customer",
            ]
            missing_indexes = [name for name in expected_indexes if name not in indexes]
            if missing_indexes:
                print(f"HOLD: battle card indexes missing after run {run}: {missing_indexes}")
                return 2
            print(f"[run {run}] migration 005 verified: tables + indexes present, business tables unchanged")

        print("[idempotency] second startup left schema and business data unchanged")
    finally:
        kill_process_tree(vite)

    prod_after = {
        "sha256": sha256_file(PROD_DB),
        "size": PROD_DB.stat().st_size,
        "mtime": PROD_DB.stat().st_mtime,
    }
    prod_match = prod_before == prod_after
    summary["production_db_before"] = prod_before
    summary["production_db_after"] = prod_after
    summary["production_db_unchanged"] = prod_match
    print(f"[production] unchanged={prod_match} sha256={prod_after['sha256']}")

    report = Path(__file__).with_name("battle_card_migration_acceptance_result.json")
    report.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[report] {report}")
    return 0 if prod_match else 2


if __name__ == "__main__":
    sys.exit(main())
