# AI Native CRM V0.1 — Release Candidate Artifact Manifest

构建时间：2026-08-13 07:37（本地时间）
构建机器：macOS 26.5.2 arm64（darwin/arm64）

## 构建来源

- 仓库：`git@github.com:renjianxin929-ux/ai-native-crm.git`（工作区 `local-crm-desktop/`）
- 分支：`feature/battle-card-macos-v1`
- 基线提交（构建时 HEAD）：`f1a48d5` — fix(crm): close macOS provider and importer release gaps
- 版本：`0.1.0`（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json / src/lib/version.ts 一致）
- 应用标识：`com.localcrm.desktop`（productName `local-crm`）
- 前端构建：`npm run build`（tsc -b && vite build）
- Rust 构建：`cargo build --release`（production 构造，**无** e2e feature）
- 工作树变更集：24 文件（V0_1_RC_FULL_CHANGED_COHORT，含 Mac Real-App Customer Discovery Fix 19 文件 + V0.1 版本元数据 4 文件 + 本 manifest）

## 产物清单

### 1. macOS 应用包

- 路径：`src-tauri/target/release/bundle/macos/local-crm.app`
- 内容：`Contents/MacOS/app`（production release 二进制）+ `Contents/MacOS/migrate_plaintext_credentials`（tauri 默认打包的声明 bin，一次性迁移工具，不随应用自动运行）+ `Contents/Resources/icon.icns` + `Contents/Info.plist`（CFBundleShortVersionString=0.1.0）
- 签名：ad-hoc（`codesign --verify --deep --strict` 通过，2026-08-13 重签修复 tauri CLI 2.11.2 的 resources 签名缺陷）
- 公证：未公证（本环境无 Apple Developer 证书）

### 2. macOS DMG 安装镜像

- 路径：`src-tauri/target/release/bundle/dmg/local-crm_0.1.0_aarch64.dmg`
- 大小：8,361,947 字节
- SHA256：`9e2a75fd38cb4753ae458d0b511502f1e9640d9b969cae9e013e0f2dd6fd9be5`
- 内容：`local-crm.app`（已重签、codesign 验证通过）+ `Applications` 拖放链接 + 卷图标
- 格式：UDZO（zlib 压缩，HFS+）
- 构建方式：tauri CLI 的 `bundle_dmg.sh`（内嵌 create-dmg 1.2.1）在 tauri CLI 直接调用失败（参数契约问题）后，以同脚本手动按 create-dmg 标准用法生成；产物经挂载 + codesign 验证通过

## 生产/E2E 隔离（构建产物级证明）

- production release 二进制：`nm` 查 wdio/webdriver 符号 = **0**
- E2E 构造（`--features e2e` debug 二进制）：wdio/webdriver 符号 6565，WebDriver server 仅绑定 127.0.0.1（loopback）
- production dist（vite build）：0 个文件含 E2E marker
- production capabilities：仅 `capabilities/default.json`（无 wdio-webdriver 权限）
- E2E app identifier `com.localcrm.desktop.e2e`（独立 data directory，`bundle.active=false`）

## 验证汇总（二审）

- `npm test`：2468/2468（191 文件）
- `cargo check`（production）：通过
- `cargo test`：47/47（4 个 macOS Keychain 集成测试因 securityd legacy API 环境挂起过滤；模块未在本变更集内，一审用户会话中 51/51）
- `cargo test --features e2e`：51/51（4 keychain 过滤）
- `git diff --check`：通过
- 真实 GUI E2E：44/44 独立执行全 PASS（2026-08-12，/tmp/e2e-evidence-full2/），production DB 零修改（protection pass=true）
- `cargo build --features migration-tool`：通过（`target/debug/migrate_plaintext_credentials`）

## 已知限制（交付边界）

1. 未 Apple 公证/正式签名（无证书）——首次打开需右键 → 打开，或系统设置放行
2. DMG 由内嵌 create-dmg 脚本手动生成（tauri CLI 的 dmg 子命令在当前环境失败，非产物缺陷）
3. macOS Keychain 集成测试（4 个）未在本轮夜间会话复跑（环境阻塞，见上）
4. 明早真人 Smoke 待用户执行：重装 release app 后复验『广州ABC科技有限公司』名称查询 + 『总结这个客户』
