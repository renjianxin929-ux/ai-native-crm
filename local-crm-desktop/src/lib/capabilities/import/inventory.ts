/**
 * V0.2A / A9R — Import Read Capability Inventory (audit evidence).
 *
 * 审计结论基于当前产品源码（Phase 6-12 调查）。生产 manifest（definitions.ts /
 * manifest.ts）只允许包含 product_capability_exists=true 且 final_status='VERIFIED'
 * 的能力；任何 helper / 内部步骤 / 写行为都不得进入生产 manifest。
 *
 * 真实产品 Import 表面（两条路径，均已确认）：
 *
 * 1) 文件导入（本域范围）：pages/DataImportPage.tsx + lib/importer.ts
 *    - 文件选择：<input type="file" accept=".xlsx,.csv"> + 拖拽（浏览器 File 对象，
 *      用户显式选择；.xls 在 UI 明确拒绝，提示另存为 .xlsx）
 *    - 解析：parseExcelFile(file)（lib/importer.ts:473-503，xlsx@^0.18.5 动态
 *      import，XLSX.read + sheet_to_json(header:1)）→ findBestImportTable
 *      （lib/importer.ts:193-239，自动挑选最佳工作表/表头行）→
 *      autoDetectFields（lib/importer.ts:177-191，FIELD_SYNONYMS 精确+包含匹配）
 *      → ImportPreview { sheetName?, headers, rows, autoMapping }
 *    - 映射校验：UI 预览步骤的独立门控 — name 必须被映射（DataImportPage.tsx:159
 *      hasNameMapping）且无重复映射目标（DataImportPage.tsx:95-109 导出的
 *      getDuplicateMappingErrors / hasDuplicateMappings）；导入按钮
 *      disabled=!hasNameMapping||hasMappingErrors（DataImportPage.tsx:331）
 *    - 行校验：buildImportableRecord（lib/importer.ts:249-343，返回 errors，
 *      如“缺少客户名称”）是 Preview 统计（computeImportStats，lib/importer.ts:382-408）
 *      与 Execute 共用的内部步骤 — NOT_DISTINCT，不注册
 *    - 重复检测：detectDuplicates（lib/importer.ts:347-378，优先级
 *      wechat_id > phone_number > name；wechat/name 大小写不敏感、phone 精确），
 *      仅作为 Preview 统计（computeImportStats，importer.ts:396，UI 以“疑似重复”
 *      统计卡片呈现 DataImportPage.tsx:354-357）与 Execute 分流（executeImport，
 *      importer.ts:535，skip/update/always_add）的内部步骤存在，无独立产品表面
 *      — NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY（A9R-01 闭合），不注册
 *    - 执行（写）：executeImport（lib/importer.ts:507-604）→ createCustomer /
 *      updateCustomer（lib/db.ts）— 第一 CRM 写边界，OUT_OF_SCOPE
 *
 * 2) JSON 名单导入（旁路体系，不在本域注册）：pages/LeadImportCenterPage.tsx +
 *    lib/leadWorkbench/（粘贴 JSON → buildLeadImportPreview → 保存批次写入
 *    lead_import_batches / lead_import_rows [非 CRM 客户] → 执行分流创建 CRM 客户/
 *    获客任务）。属于 lead 分流工作流域，不是“文件 → 预览 → 校验 → 客户导入”
 *    的文件导入路径；A9R 不注册其任何能力（保存批次即写 DB，执行分流即 CRM 写）。
 *
 * 文件格式真相：仅 .xlsx / .csv（UI accept=".xlsx,.csv"，扩展名校验
 * DataImportPage.tsx:181-183 明确拒绝 .xls）。不存在其他格式支持。
 *
 * 文件访问边界：浏览器 File 对象（用户选择/拖拽），A9R adapter 复用同一输入
 * 边界（File），不暴露任意路径读取。
 */

export type ImportReadCandidateId =
  | 'preview_import_file'
  | 'validate_import_mapping'
  | 'validate_import_rows'
  | 'detect_import_duplicates'
  | 'execute_customer_import';

export type ImportReadA9RAction = 'REGISTER_EXISTING' | 'NOT_APPLICABLE';

export type ImportReadFinalStatus =
  | 'VERIFIED'
  | 'NOT_DISTINCT'
  | 'VERIFIED_EXISTS_BUT_OUT_OF_SCOPE';

export interface ImportReadInventoryEntry {
  readonly candidate: ImportReadCandidateId;
  readonly label: string;
  readonly product_capability_exists: boolean;
  /** 现有产品源码位置（只读审计证据）。 */
  readonly existing_source_path: readonly string[];
  /** 现有执行路径（生产行为）。 */
  readonly existing_execution_path: string;
  readonly a9r_action: ImportReadA9RAction;
  readonly final_status: ImportReadFinalStatus;
  /** NOT_DISTINCT / OUT_OF_SCOPE 时必须给出精确理由。 */
  readonly not_distinct_reason?: string;
}

/** 深度冻结（条目对象含只读字符串字段，冻结对象本身即可防篡改）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export const IMPORT_READ_INVENTORY: readonly ImportReadInventoryEntry[] = deepFreeze([
  {
    candidate: 'preview_import_file',
    label: 'Preview Import File (.xlsx/.csv)',
    product_capability_exists: true,
    existing_source_path: [
      'src/lib/importer.ts',
      'src/pages/DataImportPage.tsx',
    ],
    existing_execution_path:
      'parseExcelFile → XLSX.read + sheet_to_json → findBestImportTable → autoDetectFields → ImportPreview (DataImportPage handleFile → preview step)',
    a9r_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
  },
  {
    candidate: 'validate_import_mapping',
    label: 'Validate Import Mapping',
    product_capability_exists: true,
    existing_source_path: [
      'src/pages/DataImportPage.tsx',
    ],
    existing_execution_path:
      'preview-step gate: hasNameMapping (name must be mapped) + getDuplicateMappingErrors (no CRM field mapped twice); import button disabled when invalid',
    a9r_action: 'REGISTER_EXISTING',
    final_status: 'VERIFIED',
  },
  {
    candidate: 'validate_import_rows',
    label: 'Validate Import Rows',
    product_capability_exists: false,
    existing_source_path: ['src/lib/importer.ts', 'src/pages/DataImportPage.tsx'],
    existing_execution_path:
      'buildImportableRecord errors are an internal step shared by Preview stats (computeImportStats) and Execute; no standalone row-validation product behavior',
    a9r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    not_distinct_reason:
      'Row-level validation only exists as buildImportableRecord (lib/importer.ts:249-343) inside Preview statistics (computeImportStats) and Execute (executeImport). The product has no distinct user-facing row-validation behavior separable from Preview/Execute; A9R must not inflate it into import.row.validate.',
  },
  {
    candidate: 'detect_import_duplicates',
    label: 'Detect Import Duplicates',
    // 函数真实存在且有生产调用者（importer.ts:396 / :535），但作为独立产品
    // 能力并不存在：产品没有在 Import Execute 之前暴露独立的重复检测行为。
    product_capability_exists: false,
    existing_source_path: [
      'src/lib/importer.ts',
      'src/pages/DataImportPage.tsx',
    ],
    existing_execution_path:
      'detectDuplicates (importer.ts:347-378) is consumed only inside computeImportStats (importer.ts:396 → preview “疑似重复” stat card) and inside executeImport (importer.ts:535 → skip/update/always_add routing); no independent product surface consumes it',
    a9r_action: 'NOT_APPLICABLE',
    final_status: 'NOT_DISTINCT',
    not_distinct_reason:
      'DETECT_DUPLICATES_PRODUCTION_CALLER_EXISTS=true; callers=src/lib/importer.ts:396 (inside computeImportStats, a Preview statistics internal step) and src/lib/importer.ts:535 (inside executeImport, an Execute/write-preparation internal step). The product has no standalone duplicate-detection behavior reachable before Import Execute: the “疑似重复” card is one derived stat of the Preview page (DataImportPage.tsx:354-357), and the skip/update/always_add mode is an Execute configuration, not an independently callable detection behavior. Classification=PREVIEW_INTERNAL_STEP (also reused inside Execute). A9R-01 closure: NOT_DISTINCT_CURRENT_PRODUCT_CAPABILITY, removed from the production manifest.',
  },
  {
    candidate: 'execute_customer_import',
    label: 'Execute Customer Import',
    product_capability_exists: true,
    existing_source_path: [
      'src/lib/importer.ts',
      'src/lib/db.ts',
    ],
    existing_execution_path:
      'executeImport → createCustomer / updateCustomer (first mutation boundary; lib/importer.ts:507-604)',
    a9r_action: 'NOT_APPLICABLE',
    final_status: 'VERIFIED_EXISTS_BUT_OUT_OF_SCOPE',
    not_distinct_reason:
      'IMPORT_EXECUTE_PRODUCT_CAPABILITY_EXISTS=true; IMPORT_FIRST_MUTATION_PATH=local-crm-desktop/src/lib/importer.ts:507-604 (executeImport → createCustomer/updateCustomer). A9R MUST NOT call or register it — it belongs to the later Write wave.',
  },
]);

/** 仅真实存在且 VERIFIED 的能力才进入生产 manifest 的候选集合（供测试断言 manifest 与清单一致）。 */
export const VERIFIED_IMPORT_READ_CANDIDATES: readonly ImportReadCandidateId[] = deepFreeze(
  IMPORT_READ_INVENTORY
    .filter((entry) => entry.product_capability_exists && entry.final_status === 'VERIFIED')
    .map((entry) => entry.candidate),
);
