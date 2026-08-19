/**
 * V0.2A / A8R — Evidence capability domain public entry.
 * 独立可导入/可组合的 Evidence 域模块；不触碰 A1 中央 registry/types/index，
 * 不创建中央 switch / ALL_CAPABILITIES 数组（§14 平行合并安全）。
 */

export * from './inventory';
export * from './manifest';
