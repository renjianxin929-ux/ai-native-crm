import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');
const tauriRoot = join(projectRoot, 'src-tauri');
const nodeExecutable = resolve(process.env.CRM_BUNDLED_CLI_NODE ?? process.execPath);

function fail(message) {
  throw new Error(`bundled CRM CLI build: ${message}`);
}

function commandOrFail(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) fail(`could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status ?? 'an unknown status'}`);
}

function normalizedPlatform(value) {
  if (value === 'windows' || value === 'win32') return 'win32';
  if (value === 'macos' || value === 'darwin') return 'darwin';
  if (value === 'linux') return 'linux';
  fail(`unsupported Tauri target platform ${JSON.stringify(value)}`);
}

function targetTripleFor(platform, arch) {
  const normalized = normalizedPlatform(platform);
  const architecture = arch === 'x64' || arch === 'x86_64'
    ? 'x86_64'
    : arch === 'arm64' || arch === 'aarch64'
      ? 'aarch64'
      : null;
  if (architecture === null) fail(`unsupported target architecture ${JSON.stringify(arch)}`);
  if (normalized === 'win32') return `${architecture}-pc-windows-msvc`;
  if (normalized === 'darwin') return `${architecture}-apple-darwin`;
  return `${architecture}-unknown-linux-gnu`;
}

function configuredTarget() {
  const targetTriple = process.env.CRM_BUNDLED_CLI_TARGET_TRIPLE
    ?? process.env.TAURI_ENV_TARGET_TRIPLE
    ?? targetTripleFor(process.env.TAURI_ENV_PLATFORM ?? process.platform, process.env.TAURI_ENV_ARCH ?? process.arch);
  const platform = targetTriple.includes('windows')
    ? 'win32'
    : targetTriple.includes('apple-darwin')
      ? 'darwin'
      : targetTriple.includes('linux')
        ? 'linux'
        : null;
  if (platform === null) fail(`unsupported target triple ${JSON.stringify(targetTriple)}`);
  return { targetTriple, platform };
}

function copyRequired(source, destination) {
  if (!existsSync(source)) fail(`required build input is missing: ${source}`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function stageRuntime(platform) {
  const runtimeDir = join(tauriRoot, 'resources', 'crm-runtime');
  const bundledNodeName = platform === 'win32' ? 'node.exe' : 'node';
  const addonSource = join(projectRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const packageSource = join(projectRoot, 'node_modules', 'better-sqlite3', 'lib');
  const packageManifestSource = join(projectRoot, 'node_modules', 'better-sqlite3', 'package.json');

  if (!existsSync(nodeExecutable)) fail(`the build Node runtime is missing: ${nodeExecutable}`);
  if (!statSync(nodeExecutable).isFile()) fail(`the build Node runtime is not a file: ${nodeExecutable}`);
  if (!existsSync(packageSource)) fail('better-sqlite3 JavaScript runtime files are missing from node_modules.');

  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  copyRequired(nodeExecutable, join(runtimeDir, bundledNodeName));
  cpSync(packageSource, join(runtimeDir, 'better-sqlite3', 'lib'), { recursive: true });
  // Keep the staged package inside an explicit CommonJS package boundary even
  // while this build runs beneath the desktop project's `type: module` root.
  copyRequired(packageManifestSource, join(runtimeDir, 'better-sqlite3', 'package.json'));
  copyRequired(addonSource, join(runtimeDir, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'));
  if (platform !== 'win32') chmodSync(join(runtimeDir, bundledNodeName), 0o755);

  return {
    runtimeDir,
    nodePath: join(runtimeDir, bundledNodeName),
    packageEntry: join(runtimeDir, 'better-sqlite3', 'lib', 'index.js'),
    addonPath: join(runtimeDir, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  };
}

function verifyStagedNativeAddon(runtime) {
  const probe = [
    "const Database = require(process.env.CRM_BETTER_SQLITE3_ENTRY);",
    "const db = new Database(':memory:', { nativeBinding: process.env.CRM_BETTER_SQLITE3_ADDON });",
    "db.prepare('SELECT 1 AS value').get();",
    'db.close();',
  ].join(' ');
  commandOrFail(runtime.nodePath, ['-e', probe], {
    env: {
      ...process.env,
      CRM_BETTER_SQLITE3_ENTRY: runtime.packageEntry,
      CRM_BETTER_SQLITE3_ADDON: runtime.addonPath,
      NODE_OPTIONS: '',
      NODE_PATH: '',
    },
  });
}

function buildNativeLauncher(targetTriple) {
  const hostTriple = targetTripleFor(process.platform, process.arch);
  const cargo = process.env.CARGO ?? 'cargo';
  const crossCompile = targetTriple !== hostTriple;
  const args = [
    'build',
    '--manifest-path', join(tauriRoot, 'Cargo.toml'),
    '--bin', 'crm',
    '--release',
    ...(crossCompile ? ['--target', targetTriple] : []),
  ];
  commandOrFail(cargo, args, {
    env: { ...process.env, CRM_BUNDLED_CLI_LAUNCHER_BUILD: '1' },
  });

  const targetRoot = process.env.CARGO_TARGET_DIR
    ? resolve(projectRoot, process.env.CARGO_TARGET_DIR)
    : join(tauriRoot, 'target');
  const extension = targetTriple.includes('windows') ? '.exe' : '';
  const launcherSource = join(targetRoot, ...(crossCompile ? [targetTriple] : []), 'release', `crm${extension}`);
  const launcherDestination = join(tauriRoot, 'binaries', `crm-${targetTriple}${extension}`);
  copyRequired(launcherSource, launcherDestination);
  if (extension.length === 0) chmodSync(launcherDestination, 0o755);
}

function buildFrontendAndCli() {
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const vite = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  commandOrFail(nodeExecutable, [tsc, '-b']);
  commandOrFail(nodeExecutable, [vite, 'build']);
  commandOrFail(nodeExecutable, [
    vite,
    'build',
    '--ssr', 'src/cli/main.ts',
    '--outDir', 'dist/cli',
    '--emptyOutDir', 'false',
  ], {
    env: { ...process.env, CRM_BUNDLED_CLI_BUILD: '1' },
  });
  const cliOutputDir = join(projectRoot, 'dist', 'cli');
  const runtimeDir = join(tauriRoot, 'resources', 'crm-runtime');
  if (!existsSync(cliOutputDir)) fail('the bundled CLI output directory was not created.');
  for (const entry of readdirSync(cliOutputDir)) {
    cpSync(join(cliOutputDir, entry), join(runtimeDir, entry), { recursive: true, force: true });
  }
}

function main() {
  const target = configuredTarget();
  const runtime = stageRuntime(target.platform);
  buildFrontendAndCli();

  // An executable for a different target cannot be launched on the host. The
  // normal Windows/macOS release path is native, and performs this ABI check.
  if (target.platform === process.platform) verifyStagedNativeAddon(runtime);
  buildNativeLauncher(target.targetTriple);
}

main();
