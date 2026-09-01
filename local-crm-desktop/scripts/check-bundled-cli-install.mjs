import { chmodSync, copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');
const tauriRoot = join(projectRoot, 'src-tauri');

function fail(message) {
  throw new Error(`bundled CRM CLI install check: ${message}`);
}

function targetTriple() {
  const platform = process.platform === 'win32' ? 'pc-windows-msvc'
    : process.platform === 'darwin' ? 'apple-darwin'
      : 'unknown-linux-gnu';
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : null;
  if (arch === null) fail(`unsupported host architecture ${process.arch}`);
  return `${arch}-${platform}`;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) fail(`could not start ${command}: ${result.error.message}`);
  return result;
}

function parseEnvelope(result, label) {
  if (result.status !== 0) {
    fail(`${label} exited ${result.status}; stderr=${JSON.stringify(result.stderr.trim())}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail(`${label} did not emit one JSON envelope`);
  }
}

function cleanEnvironment(profileHome, legacyAppData) {
  const base = process.platform === 'win32'
    ? {
      SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
      ComSpec: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
      USERPROFILE: profileHome,
      HOME: profileHome,
      TEMP: profileHome,
      TMP: profileHome,
    }
    : {
      HOME: profileHome,
      TMPDIR: profileHome,
      TMP: profileHome,
      TEMP: profileHome,
    };
  return {
    ...base,
    APPDATA: legacyAppData,
    LOCALAPPDATA: legacyAppData,
    PATH: '',
  };
}

function stageMockInstall(root, sourceCli, sourceRuntime) {
  if (process.platform === 'darwin') {
    const contents = join(root, 'Local CRM.app', 'Contents');
    const installBinDir = join(contents, 'MacOS');
    mkdirSync(installBinDir, { recursive: true });
    copyFileSync(sourceCli, join(installBinDir, 'crm'));
    chmodSync(join(installBinDir, 'crm'), 0o755);
    const runtimeDir = join(contents, 'Resources', 'crm-runtime');
    cpSync(sourceRuntime, runtimeDir, { recursive: true });
    chmodSync(join(runtimeDir, 'node'), 0o755);
    return { cliPath: join(installBinDir, 'crm'), runtimeDir };
  }

  const installBinDir = join(root, 'installed');
  mkdirSync(installBinDir, { recursive: true });
  const extension = process.platform === 'win32' ? '.exe' : '';
  const cliPath = join(installBinDir, `crm${extension}`);
  copyFileSync(sourceCli, cliPath);
  if (extension.length === 0) chmodSync(cliPath, 0o755);
  const runtimeDir = process.platform === 'win32'
    ? join(installBinDir, 'crm-runtime')
    : join(installBinDir, 'resources', 'crm-runtime');
  cpSync(sourceRuntime, runtimeDir, { recursive: true });
  if (extension.length === 0) chmodSync(join(runtimeDir, 'node'), 0o755);
  return { cliPath, runtimeDir };
}

function queryCustomerCount(runtimeDir, profileDatabase, customerName, environment) {
  const nodePath = join(runtimeDir, process.platform === 'win32' ? 'node.exe' : 'node');
  const packageEntry = join(runtimeDir, 'better-sqlite3', 'lib', 'index.js');
  const addonPath = join(runtimeDir, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const query = [
    "const Database = require(process.env.CRM_BETTER_SQLITE3_ENTRY);",
    "const db = new Database(process.env.CRM_PROFILE_DATABASE, { readonly: true, fileMustExist: true, nativeBinding: process.env.CRM_BETTER_SQLITE3_ADDON });",
    "const row = db.prepare('SELECT COUNT(*) AS count FROM customers WHERE name = ?').get(process.env.CRM_TEST_CUSTOMER_NAME);",
    'db.close();',
    'process.stdout.write(JSON.stringify(row));',
  ].join(' ');
  const result = run(nodePath, ['-e', query], {
    cwd: runtimeDir,
    env: {
      ...environment,
      CRM_BETTER_SQLITE3_ENTRY: packageEntry,
      CRM_BETTER_SQLITE3_ADDON: addonPath,
      CRM_PROFILE_DATABASE: profileDatabase,
      CRM_TEST_CUSTOMER_NAME: customerName,
    },
  });
  if (result.status !== 0) fail(`staged native SQLite probe exited ${result.status}`);
  const parsed = JSON.parse(result.stdout.trim());
  if (!parsed || parsed.count !== 0) fail('customer.create proposal unexpectedly wrote a customer row');
}

function main() {
  const triple = targetTriple();
  const extension = process.platform === 'win32' ? '.exe' : '';
  const sourceCli = join(tauriRoot, 'binaries', `crm-${triple}${extension}`);
  const sourceRuntime = join(tauriRoot, 'resources', 'crm-runtime');
  if (!existsSync(sourceCli) || !existsSync(sourceRuntime)) {
    fail('generated sidecar inputs are missing; run npm run build:bundled-cli or tauri build first.');
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'localcrm-bundled-cli-install-'));
  try {
    const { cliPath, runtimeDir } = stageMockInstall(temporaryRoot, sourceCli, sourceRuntime);
    const profileHome = join(temporaryRoot, 'profile-home');
    const legacyAppData = join(temporaryRoot, 'legacy-app-data');
    const legacyDatabase = join(legacyAppData, 'com.localcrm.desktop', 'personal-crm.db');
    const legacySentinel = 'bundled-cli-production-db-sentinel';
    mkdirSync(profileHome, { recursive: true });
    mkdirSync(dirname(legacyDatabase), { recursive: true });
    writeFileSync(legacyDatabase, legacySentinel, 'utf8');
    const environment = cleanEnvironment(profileHome, legacyAppData);

    const catalog = parseEnvelope(run(cliPath, ['--profile', 'demo', 'catalog'], {
      cwd: temporaryRoot,
      env: environment,
    }), 'catalog');
    if (catalog.ok !== true || catalog.status !== 'COMPLETED' || catalog.profile !== 'demo' || catalog.command !== 'catalog') {
      fail('catalog envelope does not match the bundled CLI contract');
    }

    const productionPathAttempt = run(cliPath, ['--profile', 'sqlite:personal-crm.db', 'catalog'], {
      cwd: temporaryRoot,
      env: environment,
    });
    const productionEnvelope = JSON.parse(productionPathAttempt.stdout.trim());
    if (productionPathAttempt.status !== 5 || productionEnvelope.code !== 'PROFILE_INVALID') {
      fail('bundled CLI did not reject the production database path as a profile');
    }

    const customerName = 'Bundled CLI no-write proposal';
    const proposal = parseEnvelope(run(cliPath, [
      '--profile', 'demo', 'cap', 'customer.create', '--args', JSON.stringify({ name: customerName }),
    ], {
      cwd: temporaryRoot,
      env: environment,
    }), 'customer.create proposal');
    if (proposal.ok !== true || proposal.status !== 'CONFIRMATION_REQUIRED' || proposal.capability_id !== 'customer.create') {
      fail('customer.create did not remain a confirmation-required proposal');
    }
    queryCustomerCount(
      runtimeDir,
      join(profileHome, '.localcrm', 'profiles', 'demo', 'crm.sqlite'),
      customerName,
      environment,
    );
    if (readFileSync(legacyDatabase, 'utf8') !== legacySentinel) {
      fail('bundled CLI changed the legacy production database sentinel');
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      command: 'bundled-cli-install-check',
      cli_path: cliPath,
      catalog_json: true,
      production_db_rejected: true,
      production_db_unchanged: true,
      customer_create_confirmation_required: true,
      customer_rows_written: 0,
      system_node_or_npm_required: false,
    })}\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
