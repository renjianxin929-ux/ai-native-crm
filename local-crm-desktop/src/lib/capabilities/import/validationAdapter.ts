/**
 * V0.2A / A9R — Import Validation Adapter (binding to EXISTING read behavior).
 *
 * 绑定现有产品校验执行器，不复制大段逻辑：
 *
 * - import.mapping.validate → 复用 DataImportPage 导出的 getDuplicateMappingErrors
 *   （DataImportPage.tsx:95-109，产品唯一映射规则来源：同一 CRM 字段不得被多列
 *   重复映射）+ 产品预览门控的 name 必映射规则（hasNameMapping，DataImportPage.tsx:159）。
 *
 * 注（A9R-01 闭合）：import.duplicate.detect 已从生产 manifest 移除——detectDuplicates
 * （lib/importer.ts:347-378）经产品用法审计仅为 Preview 统计（computeImportStats，
 * importer.ts:396）与 Execute 分流（executeImport，importer.ts:535）的内部步骤，
 * 无独立产品表面（分类=PREVIEW_INTERNAL_STEP，NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY）。
 * 本模块不再暴露任何重复检测绑定。
 *
 * 零写保证：本模块只做内存分析，不触碰 DB、不创建客户、不保存批次；
 * 不 import 任何写入口（createCustomer / updateCustomer / importLeadRowsToBatch …）。
 */

import type { FieldMapping } from '../../importer';
import { getDuplicateMappingErrors } from '../../../pages/DataImportPage';

/** 映射校验结果（与产品 UI 门控语义一致：valid=false 时产品禁止执行导入）。 */
export interface ImportMappingValidationResult {
  readonly valid: boolean;
  /** 产品规则的逐条错误消息（重复映射部分 100% 来自产品 getDuplicateMappingErrors）。 */
  readonly errors: readonly string[];
}

/** name 必映射规则的消息（与 DataImportPage.tsx:458-462 预览门控显示原文一致）。 */
const NAME_MAPPING_REQUIRED_MESSAGE = '请至少配置“客户名称”字段映射才能导入';

/**
 * Validate Import Mapping：应用产品预览步骤的精确规则。
 * 1) 至少一列映射到 name（hasNameMapping 等价规则，DataImportPage.tsx:159）；
 * 2) 无 CRM 字段被多列重复映射（getDuplicateMappingErrors，产品函数本体）。
 */
export function validateImportMapping(
  mapping: readonly FieldMapping[],
): ImportMappingValidationResult {
  const errors: string[] = [...getDuplicateMappingErrors([...mapping])];
  if (!mapping.some((item) => item.crmField === 'name')) {
    errors.push(NAME_MAPPING_REQUIRED_MESSAGE);
  }
  return { valid: errors.length === 0, errors };
}
