/**
 * V0.2A / W3-2 — Capability Observation / Audit 公共出口。
 * 只 re-export 本层；不 import 任何执行 / DB / 网络 / UI 模块。
 * 依赖边界：本层允许 type-only 引用 A1 契约（../types）与 A10 词汇（../authority/types）。
 */

export * from './events';
export * from './emitter';
