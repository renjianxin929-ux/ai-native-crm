/**
 * V0.2A / A5R — Follow-up Read Repository Binding.
 *
 * 本模块定义 A5R 读取边界的注入点与 fail-closed 范围校验：
 * - 不包含任何 SQL / DB / 网络 / Provider 实现（SQL 语义完全由现有 db.ts 路径提供）。
 * - createBoundFollowUpReadRepository 接受与 db.listFollowUps / db.listAllFollowUps
 *   签名一致的绑定函数（生产绑定见 ./production.ts，测试可注入隔离实现）。
 * - 客户作用域读取强制显式 customer_id：缺失 / 空白时抛 FollowUpReadScopeError
 *   （fail closed），绝不静默拓宽为全量读取。
 */

import type { FollowUpRecord } from '../../types';

/** A5R 读取边界：与现有 db.ts Follow-up 读取路径同构的只读接口。 */
export interface FollowUpReadRepository {
  /**
   * 客户作用域：仅返回该客户的跟进记录，created_at 倒序
   * （语义 parity：db.listFollowUps）。
   */
  readonly listFollowUpsByCustomer: (customerId: string) => Promise<readonly FollowUpRecord[]>;
  /**
   * 全局：返回全部跟进记录，created_at 倒序
   * （语义 parity：db.listAllFollowUps，支撑 /follow-ups 产品页面）。
   */
  readonly listAllFollowUps: () => Promise<readonly FollowUpRecord[]>;
}

/** 绑定函数集合（与 db.ts 现有导出的签名一致）。 */
export interface FollowUpReadBindings {
  readonly listFollowUps: (customerId: string) => Promise<readonly FollowUpRecord[]>;
  readonly listAllFollowUps: () => Promise<readonly FollowUpRecord[]>;
}

/**
 * 客户作用域失败（fail closed）：customer_id 缺失/空白时抛出，
 * 绝不回退到全局读取或静默使用"第一个客户"。
 */
export class FollowUpReadScopeError extends Error {
  readonly code = 'FOLLOW_UP_READ_SCOPE_ERROR' as const;

  constructor() {
    super('Follow-up read requires a non-empty customer_id; refusing to broaden to global scope.');
    this.name = 'FollowUpReadScopeError';
  }
}

/**
 * 将现有读取路径绑定为 A5R 读取边界。
 * 客户作用域入口在调用底层绑定前强制校验 customer_id。
 */
export function createBoundFollowUpReadRepository(bindings: FollowUpReadBindings): FollowUpReadRepository {
  return {
    async listFollowUpsByCustomer(customerId: string): Promise<readonly FollowUpRecord[]> {
      if (typeof customerId !== 'string' || customerId.trim().length === 0) {
        throw new FollowUpReadScopeError();
      }
      return bindings.listFollowUps(customerId);
    },
    listAllFollowUps: () => bindings.listAllFollowUps(),
  };
}
