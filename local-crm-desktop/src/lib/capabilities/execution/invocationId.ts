/**
 * V0.2A / W3-1 Closure 2 — Invocation Identity Generation.
 *
 * 唯一职责：为"一次进入统一执行的一次 Capability 调用"产生一个受信任的
 * invocation_id（生命周期关联身份）。
 *
 * 所有权语义（本分支锁定）：
 * - 公共生产执行边界（engine.invoke）拥有 invocation_id 的生成；调用方不能通过
 *   在业务输入里放置 invocation_id 来覆盖生产身份（T2：CALLER_CANNOT_SMUGGLE）。
 * - invocation_id 只标识"一次被尝试的调用"，绝不当作：幂等键 / 确认 nonce /
 *   提案 id / 重放 token（各身份保持独立，见 contract.ts 不变式）。
 * - 不从 capability_id / customer_id / timestamp / prompt / 会话 id 推断。
 * - 不用时间戳单独作为身份。
 *
 * 生成模型（ID_GENERATION_MODEL）：
 * - 生产：crypto 安全的随机 UUID v4 —— 复用项目既有本地运行时惯例
 *   （uuid 已是 package.json 既有依赖，db.ts / importer.ts / salesAgentTools
 *   等项目模块全部使用 v4；无网络、无新依赖）。
 * - 测试：经 CapabilityExecutionEngineOptions.generateInvocationId 注入确定性
 *   生成器；生产生成器与测试生成器在代码与语义上完全分离
 *   （PRODUCTION_ID_SOURCE=uuidv4 / TEST_ID_SOURCE=注入）。
 */

import { v4 as uuidv4 } from 'uuid';

/** 受信任 invocation_id 生成器（执行边界注入点；生产默认 uuidv4）。 */
export type InvocationIdGenerator = () => string;

/** 生产身份源：随机 UUID v4（既有项目惯例；进程内、无网络、无新依赖）。 */
export const createInvocationId: InvocationIdGenerator = (): string => uuidv4();

/** invocation_id 基本形状校验（非空字符串；供防御性检查，不是安全令牌）。 */
export function isNonEmptyInvocationId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
