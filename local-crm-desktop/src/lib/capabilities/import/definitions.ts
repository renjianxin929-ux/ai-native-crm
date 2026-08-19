/**
 * V0.2A / A9R — Import Read Capability Definitions.
 *
 * 仅注册经审计证明存在于当前产品中的 Import 非写能力（见 inventory.ts）。
 * 每项定义完全符合 A1 CapabilityDefinition 契约：全部语义字段显式声明，无静默默认。
 *
 * 语义边界（A9R 核心原则）：PREVIEW / VALIDATE != EXECUTE IMPORT。
 * - effect 只用 READ/ANALYZE；本域生产 manifest 绝不使用 WRITE/BULK_WRITE/DELETE。
 * - data_target 只用 NONE（文件内容分析，不触及 CRM）与 CRM_FACT（重复检测只读
 *   现有客户做匹配）；预览行绝不声明为持久化 CRM_FACT。
 * - executor_ref 引用现有产品执行路径（A1 声明的引用风格），执行器绑定见
 *   previewAdapter.ts / validationAdapter.ts。
 * - requires_confirmation=false：与现有产品预览/校验语义一致（非写、幂等 SAFE），
 *   A9R 不实现 A10 Policy Engine。
 *
 * error_contract 如实声明 UNSPECIFIED：现有产品解析/校验路径（parseExcelFile 等）
 * 以普通 Error message 区分失败，无稳定错误码体系（与 A4R/A5R 对 db.ts 路径的处理一致）。
 *
 * 导出集合经深度冻结：元素对象（含 audit_contract）不可变，不引入可变契约状态。
 * 组合进 A1 registry 后，registry 的 clone+deepFreeze 机制再次保证不可变性。
 */

import type { CapabilityDefinition } from '../types';

/** 深度冻结（与 A1 registry 相同的防御模式；元素深度仅两层：definition + audit_contract）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 分析类能力的审计契约：记录输入输出、不产生效果（与 A4R/A5R READ 惯例一致）。 */
const IMPORT_READ_AUDIT: CapabilityDefinition['audit_contract'] = Object.freeze({
  audit_required: true,
  record_input: true,
  record_output: true,
  record_effect: false,
});

/**
 * Preview Import File — 解析 .xlsx/.csv 文件并返回产品 ImportPreview。
 *
 * 真实产品来源：lib/importer.ts parseExcelFile（xlsx 解析）→ findBestImportTable
 * （自动挑选最佳工作表/表头行）→ autoDetectFields（表头→CRM 字段自动映射），
 * 由 DataImportPage handleFile 在预览步骤消费。非写：不创建客户、不保存批次。
 *
 * effect=ANALYZE：解析并依据确定性规则评估文件结构（表头检测评分、字段映射识别），
 * 返回校验/结果语义，而非简单检索既有信息。
 * data_target=NONE：分析对象是文件内容，绝不写入或声称触及 CRM 数据。
 */
const IMPORT_FILE_PREVIEW_DEFINITION: CapabilityDefinition = {
  id: 'import.file.preview',
  version: '1.0.0',
  domain: 'import',
  description:
    'Parse a user-selected .xlsx/.csv import file through the real product path (importer.ts parseExcelFile → findBestImportTable → autoDetectFields) and return the exact product ImportPreview (best sheet name, detected headers, parsed rows, auto mapping). Non-mutating: no customer row is created and no import batch is saved; previewed rows are file content, not persisted CRM facts.',
  input_schema: 'import.file.v1',
  output_schema: 'import.preview.v1',
  effect: 'ANALYZE',
  data_target: 'NONE',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'NONE',
  idempotency: 'SAFE',
  executor_ref: 'crm:parseExcelFile→findBestImportTable→autoDetectFields',
  audit_contract: { ...IMPORT_READ_AUDIT },
  error_contract: 'UNSPECIFIED',
};

/**
 * Validate Import Mapping — 按产品 UI 的现有规则校验列→字段映射。
 *
 * 真实产品来源：DataImportPage 预览确认步骤的独立门控 — name 必须被映射
 * （hasNameMapping，DataImportPage.tsx:159）且同一 CRM 字段不得被多列重复映射
 * （getDuplicateMappingErrors，DataImportPage.tsx:95-109）；映射无效时导入按钮
 * 被禁用（DataImportPage.tsx:331）。
 *
 * 只保留产品真实规则：不发明“完美校验器”。
 */
const IMPORT_MAPPING_VALIDATE_DEFINITION: CapabilityDefinition = {
  id: 'import.mapping.validate',
  version: '1.0.0',
  domain: 'import',
  description:
    'Validate a column→field mapping against exactly the rules of the current product import UI (DataImportPage preview-step gate): at least one column must map to name, and no CRM field may be mapped by more than one column. Returns the same per-rule errors the product derives (getDuplicateMappingErrors + name-mapping gate). Non-mutating.',
  input_schema: 'import.mapping.v1',
  output_schema: 'import.mapping.validation.v1',
  effect: 'ANALYZE',
  data_target: 'NONE',
  risk_level: 'LOW',
  authority_policy: 'AUTO',
  requires_confirmation: false,
  scope_requirement: 'NONE',
  idempotency: 'SAFE',
  executor_ref: 'crm:DataImportPage.getDuplicateMappingErrors+nameMappingGate',
  audit_contract: { ...IMPORT_READ_AUDIT },
  error_contract: 'UNSPECIFIED',
};

/**
 * 全部真实 Import 读取/分析能力定义（只读、冻结）。
 * - validate_import_rows 经审计为 NOT_DISTINCT（Preview/Execute 内部步骤），有意不进入本集合。
 * - detect_import_duplicates 经 A9R-01 闭合审计为 NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY：
 *   detectDuplicates（lib/importer.ts:347-378）仅作为 Preview 统计（computeImportStats，
 *   importer.ts:396）与 Execute 分流（executeImport，importer.ts:535）的内部步骤存在，
 *   无独立产品表面（无独立 UI/入口直接消费），故不进入本集合。
 * - execute_customer_import 真实存在但属于 Write Wave（VERIFIED_EXISTS_BUT_OUT_OF_SCOPE），
 *   有意不进入本集合（inventory.ts 中记录写边界证据）。
 */
export const IMPORT_READ_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = deepFreeze([
  IMPORT_FILE_PREVIEW_DEFINITION,
  IMPORT_MAPPING_VALIDATE_DEFINITION,
]);
