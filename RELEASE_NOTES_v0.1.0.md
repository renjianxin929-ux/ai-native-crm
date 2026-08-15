# AI Native CRM v0.1.0

AI Native CRM 的第一个可运行 OSS Foundation 版本。

V0.1 建立了跨平台本地 CRM、Sales Agent、真实模型接入和客户上下文能力的第一条完整产品基线。

## Highlights

- Local-first CRM with SQLite persistence
- Sales Agent customer context and reasoning
- Natural-language customer resolution
- Customer timeline / context / active memory
- Battle Card and evidence foundation
- Excel customer import
- Real LLM provider integration
- Encrypted provider credential storage
  - Windows DPAPI
  - macOS Keychain
- macOS / Windows application architecture
- Human-confirmed CRM write boundaries

## Golden Journey

已验证：

“总结一下广州ABC科技有限公司”

→ 自动解析客户
→ 建立 Customer Scope
→ 加载真实 CRM Context
→ 调用真实模型
→ 返回 AI Summary

后续：

“这个客户下一步应该怎么推进？”

→ 保持同一 Customer Scope
→ 继续真实模型推理

## macOS

Current asset:

Apple Silicon macOS DMG

Version:
0.1.0

说明：

当前 build 未进行 Apple notarization。

如 macOS 首次运行阻止打开：

右键应用 → 打开

本地数据库和 Provider Key 不上传到项目仓库。

## Windows

V0.1 does not publish a Windows installer.

Windows support remains part of the cross-platform codebase
and future releases will be validated separately.

不要创建：

v0.1.0-windows
或
v0.1.0-macos

两个平台属于同一个产品版本。

## Provenance

Binary production source baseline:

`421ef53a6a832284b019c10274f4b43009af960c`

Final OSS tag additionally includes docs + MIT LICENSE only.

The macOS DMG was built from the source baseline above
and was not rebuilt from the docs-only final tag.

## License

License: MIT

See [LICENSE](LICENSE) for the full text.

## Known Limitations

- V0.1 仍属于 OSS Foundation，不是最终 Agent First 架构
- macOS voice dictation 尚未完成原生实现
- Excel batch Battle Card import 尚未实现
- Windows/macOS 本地数据库默认不自动同步
- Provider API Key 每台设备单独配置
- macOS 当前 package 未 Apple notarized

## Next

下一阶段战略路线：

V0.2:
Capability Complete
+ External Reach
+ UI Ready

V0.3:
Agent First Foundation
