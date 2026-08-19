/**
 * V0.2A / A5R — Follow-up Read Production Binding.
 *
 * 生产组合根：把现有受保护的 db.ts 读取路径（listFollowUps / listAllFollowUps）
 * 原样绑定为 A5R 读取边界。本文件不复制任何业务 SQL —— 记录过滤与排序语义
 * 100% 来自现有路径（T12 EXISTING PATH PARITY 由同一函数本体保证）。
 *
 * 零写 / 零网络 / 零模型：本模块只 import 现有只读函数，从不 import 或调用
 * createFollowUp / updateCustomer / createTask / createVisit / confirmedWrite 等写入口。
 */

import { listAllFollowUps, listFollowUps } from '../../db';
import { createBoundFollowUpReadRepository } from './repository';

/** 生产读取边界：绑定现有 db.ts 真实执行路径。 */
export function createProductionFollowUpReadRepository() {
  return createBoundFollowUpReadRepository({
    listFollowUps,
    listAllFollowUps,
  });
}
