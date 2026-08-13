# AI Native CRM V0.1 — Release Candidate Artifact Manifest

构建时间：2026-08-13 11:46（本地时间；第二次打包，含 Golden Journey Fix）
构建机器：macOS 26.5.2 arm64（darwin/arm64）

## 构建来源

- 仓库：`git@github.com:renjianxin929-ux/ai-native-crm.git`（工作区 `local-crm-desktop/`）
- 分支：`feature/battle-card-macos-v1`
- 基线提交（构建时 HEAD）：`889ec11` — test(crm): add live DeepSeek provider contract evidence for golden journey fix (BUG B)
- 包含提交：`1799a48`（Golden Journey 三修复：命名客户 scope 解析 / 结构化输出契约 / 运行时状态语义）+ `889ec11`（真实 provider 证据）
- 版本：`0.1.0`（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json / src/lib/version.ts 一致）
- 应用标识：`com.localcrm.desktop`（productName `local-crm`）
- 前端构建：`npm run build`（tsc -b && vite build）
- Rust 构建：`cargo build --release`（production 构造，**无** e2e feature）
- 打包时工作树：干净（0 未提交变更）

## 产物清单

### 1. macOS 应用包

- 路径：`src-tauri/target/release/bundle/macos/local-crm.app`
- 内容：`Contents/MacOS/app`（production release 二进制，2026-08-13 11:45 构建，17,921,424 字节）+ `Contents/MacOS/migrate_plaintext_credentials`（tauri 默认打包的声明 bin，一次性迁移工具，不随应用自动运行）+ `Contents/Resources/icon.icns` + `Contents/Info.plist`（CFBundleShortVersionString=0.1.0）
- 签名：ad-hoc（`codesign --verify --deep --strict` 通过，重签修复 tauri CLI 2.11.2 的 resources 签名缺陷）
- 公证：未公证（本环境无 Apple Developer 证书）

### 2. macOS DMG 安装镜像

- 路径：`src-tauri/target/release/bundle/dmg/local-crm_0.1.0_aarch64.dmg`
- 大小：8,363,116 字节
- SHA256：`302d39141dda96e0734c95ca11e3f259c9705473b8513bc3cddc21abd5f181e7`
- 内容：`local-crm.app`（已重签、codesign 验证通过）+ `Applications` 拖放链接 + 卷图标
- 格式：UDZO（zlib 压缩，HFS+）
- 构建方式：tauri CLI 的 `bundle_dmg.sh`（内嵌 create-dmg 1.2.1）在 tauri CLI 直接调用失败（参数契约问题，与首轮打包相同）后，以同脚本手动按 create-dmg 标准用法生成；产物经挂载 + codesign 验证通过

## 生产/E2E 隔离（构建产物级证明）

- production release 二进制：无 e2e feature（构建命令无 `--features e2e`）
- production dist（vite build）：0 个文件含 E2E marker
- production capabilities：仅 `capabilities/default.json`（无 wdio-webdriver 权限）
- E2E app identifier `com.localcrm.desktop.e2e`（独立 data directory，`bundle.active=false`）

## 验证汇总（本轮 Golden Journey Fix）

- `npm test`：2482 passed + 1 skipped（live 测试无 key 自动 skip），193 文件
- `cargo test`（production）：55/55
- `cargo test --features e2e`：59/59
- `npm run build` / `cargo check` / `git diff --check`：通过
- 真实 GUI E2E：FAM-045（新会话"总结一下广州ABC科技有限公司"→ SEARCH_CUSTOMERS→CUSTOMER_SUMMARY，自动建 scope）PASS；FAM-046（"总结客户现状"）PASS；FAM-006/011 回归 PASS；production DB 零污染
- 真实 provider（用户提供 DeepSeek key）：真实响应经 production 解析规则 + closed validator = valid(true)（详见 V0_1_FINAL_FIX_REPORT.md REAL_PROVIDER 节）

## 已知限制（交付边界）

1. 未 Apple 公证/正式签名（无证书）——首次打开需右键 → 打开，或系统设置放行
2. DMG 由内嵌 create-dmg 脚本手动生成（tauri CLI 的 dmg 子命令在当前环境失败，非产物缺陷）
3. 明早真人 Smoke 待用户执行：①新会话输入"总结一下广州ABC科技有限公司"必须直接找到客户并完成真实 AI 总结；②紧接着"这个客户下一步应该怎么推进？"必须保持同一 scope 并产生真实 AI reasoning。两条 PASS 后才允许 READY_FOR_OSS_RELEASE=true / tag v0.1.0 / GitHub Release
