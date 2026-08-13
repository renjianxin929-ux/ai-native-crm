# AI Native CRM

Local-first, agent-oriented CRM foundation for building AI-native sales workflows.

## What It Is

AI Native CRM 是一个本地优先的实验性开源 CRM，
目标不是简单在 CRM 旁边增加聊天框，
而是逐步探索 Agent 成为主要 CRM 操作者的产品架构。

V0.1 是基础版本。

## Current V0.1 Capabilities

- Customer / Contact / Context
- Timeline / Interaction
- Follow-up
- Battle Card
- Evidence
- Excel Import
- Sales Agent
- Provider configuration
- Local SQLite
- Encrypted credentials

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

Windows:
DPAPI

macOS:
Keychain

## Local-first

用户 CRM 数据保存在本机。

AI Provider Key 使用系统安全能力保护。

本产品不是完全离线应用：真实模型调用需要网络连接。

## Getting Started

```bash
npm install
npm test          # 运行测试套件
npm run dev       # 开发模式（Vite + Tauri）
npm run build     # 前端构建
npx tauri build   # 桌面安装包（按当前平台生成 NSIS/MSI 或 DMG）
```

产品代码位于 `local-crm-desktop/`。

## AI Provider

用户自行配置 Provider API Key。

Key 不随 Release 分发。

## Build

### macOS（Apple Silicon）

在 macOS 真机上：

```bash
cd local-crm-desktop
npm install
npx tauri build
```

产物：

- `src-tauri/target/release/bundle/macos/local-crm.app`
- `src-tauri/target/release/bundle/dmg/local-crm_0.1.0_aarch64.dmg`

### Windows（x64）

在 Windows 真机上（需要 WebView2）：

```bash
cd local-crm-desktop
npm install
npx tauri build
```

产物：

- `src-tauri/target/release/bundle/nsis/local-crm_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/local-crm_0.1.0_x64_en-US.msi`

## Current Limitations

- V0.1 仍属于 OSS Foundation，不是最终 Agent First 架构
- macOS voice dictation 尚未完成原生实现
- Excel batch Battle Card import 尚未实现
- Windows/macOS 本地数据库默认不自动同步
- Provider API Key 每台设备单独配置
- macOS 当前 package 未 Apple notarized

## Roadmap

V0.2:
Capability Complete + External Reach + UI Ready

V0.3:
Agent First Foundation

## Security

- Local-first：CRM 数据保存在本机
- OS credential protection：Windows DPAPI / macOS Keychain
- Human-confirmed high-risk writes
- No bundled API keys

## License

尚未选择 License（仓库无 LICENSE 文件）。

仓库保持 Private，License 确定并完成发布检查后再转为 Public。
