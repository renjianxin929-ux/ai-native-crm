/**
 * V0.2A / A9R — Import Preview Adapter (binding to EXISTING read behavior).
 *
 * 复用规则（任务第 6 节）优先级 1：绑定现有产品解析执行器，不复制任何解析逻辑。
 *
 * - import.file.preview → parseExcelFile（lib/importer.ts:473-503）
 *   （XLSX.read + sheet_to_json(header:1) → findBestImportTable → autoDetectFields），
 *   与 DataImportPage handleFile 预览步骤使用同一函数本体（PRODUCT_EXECUTOR_PARITY）。
 *
 * 文件访问边界：与产品一致，仅接受浏览器 File 对象（用户显式选择/拖拽；
 * DataImportPage accept=".xlsx,.csv"）。本模块绝不接受任意路径字符串，不读文件系统。
 *
 * 零写保证：parseExcelFile 只做内存解析（xlsx 库），不触碰 DB、不创建客户、
 * 不保存导入批次；本模块不 import 任何写入口。
 */

import { parseExcelFile } from '../../importer';

/** Preview Import File：直接绑定现有产品解析路径（同一函数引用，语义 100% 一致）。 */
export const previewImportFile: typeof parseExcelFile = parseExcelFile;
