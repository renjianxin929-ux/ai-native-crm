/**
 * V0.2A / A9R — Import Read Capability Manifest (domain: import).
 *
 * Import 域独立可组合 manifest（A1 扩展缝：createCapabilityRegistry(...manifests)）。
 * - 纯声明式：只描述能力，不包含任何执行 / DB / 网络 / 模型语义。
 * - 只注册经独立审计证明在当前产品中真实存在的非写能力（见 inventory.ts）。
 * - 不注册 execute / bulk-write 能力（属于后续 Write Wave）。
 * - 不修改 A1 中心文件（types.ts / registry.ts / index.ts），不创建中央 hub。
 */

import type { CapabilityDefinition } from '../types';
import { IMPORT_READ_CAPABILITY_DEFINITIONS } from './definitions';

/** Import 域生产 manifest：仅含审计证明存在的真实非写能力（2 项；A9R-01 闭合后重复检测已按 NOT_DISTINCT 移除）。 */
export const IMPORT_READ_CAPABILITY_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  ...IMPORT_READ_CAPABILITY_DEFINITIONS,
]);

/** 生产 manifest 中的能力 id 集合（供测试断言库存真相与注册表碰撞安全）。 */
export const IMPORT_READ_CAPABILITY_IDS: readonly string[] = Object.freeze(
  IMPORT_READ_CAPABILITY_MANIFEST.map((definition) => definition.id),
);
