/**
 * V0.2A / A2 — Customer Capability Manifest.
 *
 * 领域 manifest:只读 CapabilityDefinition 数组,通过 A1 的领域扩展缝
 * (createCapabilityRegistry(...manifests))组合进注册表,无需修改任何中央文件。
 *
 * 组合用法(由调用方/测试执行):
 *   import { createCapabilityRegistry } from '../registry';
 *   import { CUSTOMER_CAPABILITY_MANIFEST } from './manifest';
 *   const registry = createCapabilityRegistry(CUSTOMER_CAPABILITY_MANIFEST);
 */

import type { CapabilityDefinition } from '../types';
import { CUSTOMER_READ_CAPABILITY_DEFINITIONS } from './definitions';

/** Customer 域能力清单:仅含审计证明存在的真实能力(3 项)。 */
export const CUSTOMER_CAPABILITY_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  ...CUSTOMER_READ_CAPABILITY_DEFINITIONS,
]);
