# AI Native CRM

Local-first, agent-oriented CRM foundation for building AI-native sales workflows.

AI Native CRM 是一个本地优先的实验性开源 CRM，
目标不是简单在 CRM 旁边增加聊天框，
而是逐步探索 Agent 成为主要 CRM 操作者的产品架构。

V0.1 是基础版本。

## Current V0.1 Capabilities

- **Customer / Contact / Context** — 客户、联系人、上下文管理
- **Timeline / Interaction** — 跟进 / 拜访 / 互动时间线
- **Follow-up** — 今日跟进与逾期分组
- **Battle Card** — 客户作战卡片（`src-tauri` 权威层 + 前端页面）
- **Evidence** — 作战卡片证据基础
- **Excel Import** — Excel 客户导入
- **Sales Agent** — 只读 Agent / 建议模式 Agent / 真实模型推理
- **Provider configuration** — 用户自配 LLM Provider（DeepSeek 等 OpenAI-compatible API）
- **Local SQLite** — 本地数据库持久化（`src-tauri/migrations/` 版本化 schema）
- **Encrypted credentials** — Windows DPAPI / macOS Keychain 保护 Provider Key

## Architecture

```
React / TypeScript
        ↓
Sales Agent / Product Logic
        ↓
Tauri Rust Host
        ↓
SQLite / Native OS Security
```

## Local-first

用户 CRM 数据保存在本机（SQLite 单文件，位于应用数据目录）。

AI Provider Key 使用系统安全能力保护：
Windows 使用 DPAPI（Current User Scope），
macOS 使用 Keychain（AES-256-GCM 主密钥存钥匙串）。

本产品不是完全离线应用：真实模型调用需要网络连接。

## Getting Started

```bash
npm install
npm test          # 运行测试套件（Vitest）
npm run dev       # 开发模式（Vite + Tauri）
npm run build     # 前端构建
npx tauri build   # 桌面安装包（按当前平台生成 NSIS/MSI 或 DMG）
```

## AI Provider

在设置页配置 Provider API Key（例如 DeepSeek 的 OpenAI-compatible endpoint）。

Key 不随 Release 分发，按设备独立存储。

## Build

### macOS（Apple Silicon）

```bash
npm install
npx tauri build
```

产物：

- `src-tauri/target/release/bundle/macos/local-crm.app`
- `src-tauri/target/release/bundle/dmg/local-crm_0.1.0_aarch64.dmg`

### Windows（x64）

在 Windows 真机上执行（需要 WebView2）：

```bash
npm install
npx tauri build
```

产物：

- `src-tauri/target/release/bundle/nsis/local-crm_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/local-crm_0.1.0_x64_en-US.msi`

## Database

- 类型：SQLite 单文件
- Windows: `%APPDATA%/com.localcrm.desktop/`
- macOS: `~/Library/Application Support/com.localcrm.desktop/`
- 迁移：`src-tauri/migrations/`（版本化 SQL）

## Current Limitations

- V0.1 仍属于 OSS Foundation，不是最终 Agent First 架构
- macOS voice dictation 尚未完成原生实现
- Excel batch Battle Card import 尚未实现
- Windows/macOS 本地数据库默认不自动同步
- Provider API Key 每台设备单独配置
- macOS 当前 package 未 Apple notarized（首次打开如被拦截：右键应用 → 打开）

## Roadmap

V0.2:
Capability Complete + External Reach + UI Ready

V0.3:
Agent First Foundation

## Security

- Local-first：CRM 数据保存在本机
- OS credential protection：Windows DPAPI / macOS Keychain
- Human-confirmed high-risk writes（AI 建议 → 人工确认后写入）
- No bundled API keys

## License

尚未选择 License（仓库无 LICENSE 文件）。License 确定后再公开。
