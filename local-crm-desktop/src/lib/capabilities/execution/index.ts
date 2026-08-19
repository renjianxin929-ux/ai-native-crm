/**
 * V0.2A / W3-1 — Capability Execution 公共出口。
 *
 * 导出面 = 契约 + 绑定模型 + 执行引擎 + 调用身份生成 + 观察桥 + 生产组合点。
 * 注意：本层唯一的"统一执行入口"是 engine.invoke（总是先评估 A10）；
 * 不导出任何可直接调用执行器而跳过 A10 的公开函数。
 */

export * from './contract';
export * from './binding';
export * from './engine';
export * from './invocationId';
export * from './observationBridge';
export * from './production';
