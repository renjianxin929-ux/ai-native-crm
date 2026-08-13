/**
 * V0.2A / A6R — Task Read Capabilities 域模块出口。
 * 独立可组合：不修改 A1 核心文件，不依赖任何中央 hub / switch。
 */

export { TASK_READ_MANIFEST, TASK_READ_CAPABILITY_IDS } from './manifest';
export { readTasksByCustomer, TaskReadScopeError } from './adapter';