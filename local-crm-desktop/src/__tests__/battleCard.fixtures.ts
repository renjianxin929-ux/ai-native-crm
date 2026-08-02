/**
 * Battle Card V1 测试夹具。
 * 黄金样本：Reviewer 证据目录附录 A 真实输入（字节原样复制）：
 *   E:\AI_NATIVE_CRM_BATTLE_CARD_V1_FINAL_REVIEW\20260802_120626\appendix-a-full-raw.txt
 *   9510 bytes / 233 lines / SHA-256 c75e31d0dff10a4700ef5fa6cbb4b9740c0a2f6cdc317848a541db804d29aba9
 * 旧重建样本已重命名 RECONSTRUCTED_TINSOL_LEGACY（SYNTHETIC / RECONSTRUCTED，不再作为真实黄金样本）。
 */
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';

export const CLOCK = () => '2026-08-01T12:00:00.000Z';
export const NOW = CLOCK();

/** 附录 A 真实输入（字节原样，LF 换行）。 */
export const APPENDIX_A_RAW = readFileSync(
  new URL('./fixtures/battle-card/guangzhou-dianxiu-appendix-a-raw.txt', import.meta.url),
  'utf8',
);

/** 黄金样本 = 附录 A 真实原文。 */
export const GOLDEN_SAMPLE_TINSOL = APPENDIX_A_RAW;

/** 旧重建样本（RECONSTRUCTED，非真实输入；仅作兼容性/回归样本，不得作为真实原文验收依据）。 */
export const RECONSTRUCTED_TINSOL_LEGACY = `广州电秀科技发展有限公司 战前卡

1. 主体与公开事实
广州电秀科技发展有限公司（TINSOL）个人护理小家电品牌出海，覆盖多国家和多平台。
官方案例披露的销售及业务信息：多平台店铺运营，海外渠道布局成熟。
公司同时存在功效表达、内容与达人营销、国家版本、电压与插头、电气认证、包装与说明书、售后与 VOC 等业务属性，属复合业务。

2. 五维战前画像
出海渠道：亚马逊、TikTok Shop 等多平台
产品线：个人护理小家电（美容仪、脱毛仪等）
组织：跨境电商团队 + 内容团队

3. 当前问题假设
H1：出海团队缺乏统一客户信息底座，客户资产散落在平台后台与表格中
H2：多国家版本（电压/插头/认证）差异导致售前咨询效率低
H3：内容与达人营销依赖人工跟进，达人合作进度不可见
H4：售后 VOC 无法回流到选品与内容团队

4. FDE/FDA推荐落地点
客户信息底座：统一管理平台客户、询盘、售后反馈
内容协作：达人库与内容审阅流程
售后 VOC 回流：评价数据结构化

4A. 为什么确认这个痛点值得优先验证
多平台多国家运营，客户数据量随扩张快速放大
官方案例披露的业务规模说明投入价值

4B. 可以直接复述的飞书解决方法话术
飞书多维表格可以把亚马逊、TikTok Shop 的客户与售后数据统一收口，业务团队在同一个地方跟进，不用再在各平台后台和 Excel 之间切换。

4C. 针对本公司的具体实现路径
第一层：用多维表格搭建客户信息底座，接入平台导出数据，统一字段。验收指标：字段统一且首批 50 条记录迁移完成。
第二层：达人合作表管理内容排期与素材审阅。验收指标：达人库覆盖当前全部合作达人。
第三层：售后 VOC 分类标签，按周回流给选品团队。验收指标：VOC 标签化率达到 80%。
第四层：国家版本与认证知识库，售前咨询按版本应答。验收指标：多版本咨询应答时长缩短 30%。
第五层：多平台店铺运营视图，销售与运营共用一张表。验收指标：周会数据准备时间减半。
第六层：POC 阶段用两周最小闭环验证再扩展。验收指标：两周内完成 POC 演示。

4D. 同体量、同阶段与同行校准
SUPRENT：同品类出海，用表格+协作工具管理客户与内容，可借鉴其客户字段设计；但他们的多平台深度不同，不能照搬其流程。
触沃电子：同品类出海，内容与渠道打法可参考；硬件产品线结构不同，不能照搬其售后分类。
FF FlashFish：出海消费电子，达人营销流程可借鉴；其团队规模与渠道结构不同，不能照搬其组织分工。

5. 首轮挖需问题
Q1：目前客户信息主要存在哪里？平台后台还是表格？
Q2：多国家版本的售前咨询是如何处理的？
Q3：达人合作目前怎么跟进？
Q4：售后反馈怎么回流给团队？

6. 人工确认门禁
客户信息底座的真实使用人数需当面确认
是否已有在用的 CRM/表格体系需确认
达人合作规模需确认

7. 两周POC最小路径
先用一个平台（亚马逊）导出数据搭出客户信息底座原型，1 周内给客户演示字段与视图。

8. 对抗式审查
客户可能已有 ERP/CRM，信息底座假设可能被证伪
平台 API 权限可能受限，数据导出方式需验证
售后数据回流涉及团队协作流程，需业务负责人参与

9. 建议推进
首轮挖需会议验证 H1-H4，随后给出 POC 方案。

10. 来源
官方案例公开信息（销售及业务信息）、行业公开资料、企业公开主页
`;

export function createSqliteDb(): DatabaseLike & { close(): void; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  return {
    sqlite,
    async execute(sql: string, bindings: unknown[] = []) {
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: Number(result.changes) };
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      return sqlite.prepare(sql).all(bindings as never[]) as T[];
    },
    close() {
      sqlite.close();
    },
  };
}

export async function createSchema(db: DatabaseLike): Promise<void> {
  await initializeDatabaseSchema(db);
}

export async function seedCustomer(
  db: DatabaseLike,
  overrides: { id?: string; name?: string; stage?: string; grade?: string; next_follow_up_at?: string | null; last_contacted_at?: string | null; next_action?: string | null; battle_card_status?: string } = {},
): Promise<string> {
  const id = overrides.id ?? 'cust-tinsol';
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, last_contacted_at, next_action, battle_card_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'HIGH', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      overrides.name ?? '广州电秀科技发展有限公司',
      overrides.grade ?? 'A',
      overrides.stage ?? 'NEW_LEAD',
      overrides.next_follow_up_at ?? null,
      overrides.last_contacted_at ?? null,
      overrides.next_action ?? null,
      overrides.battle_card_status ?? 'NONE',
      NOW,
      NOW,
    ],
  );
  return id;
}

/** 中文数字 + 全角标点变体（SYNTHETIC）：验证 `一、` / `１．` 等合理变体。 */
export const SYNTHETIC_NUMBERED_VARIANTS = `编号｜样本科技有限公司（SYNTHETIC）

一、主体与公开事实
样本科技有限公司生产消费电子（SYNTHETIC）。

二、五维战前画像
渠道：独立站为主（SYNTHETIC）

三、当前问题假设
H1：客服处理多版本咨询耗时（SYNTHETIC）

４．可以直接复述的飞书解决方法话术
话术内容一（SYNTHETIC）。

５．来源
SYNTHETIC 测试样本
`;

// ── SYNTHETIC 边界样本（明确标注，非真实企业）──

export const SYNTHETIC_COMPOSITE_TERMS = `# 主体与公开事实
样本企业（SYNTHETIC）生产个人护理小家电，同时涉及功效表达、内容营销、电气认证、国家版本、电压与插头、包装与说明书、售后与 VOC。
产品配方与成分属于在售商品的一部分。

# 当前问题假设
H1：客服处理多版本咨询耗时（SYNTHETIC）

# 来源
SYNTHETIC 测试样本
`;

export const SYNTHETIC_FORMULA_NO_PRODUCT_LINE = `# 主体与公开事实
样本企业（SYNTHETIC）宣称其产品配方温和，成分安全。
没有提到任何具体产品线或型号依据。

# 来源
SYNTHETIC 测试样本
`;

export const SYNTHETIC_NO_TITLES = `一段没有标题的纯文本（SYNTHETIC）。
广州某某贸易有限公司，做跨境电商。
另一行没有结构的内容。`;

export const SYNTHETIC_UNKNOWN_TITLES = `# 随便写的小标题
内容 A（SYNTHETIC）

# 另一个未知标题
内容 B（SYNTHETIC）

# 来源
SYNTHETIC 测试样本
`;

export const SYNTHETIC_PEERS_NO_BOUNDARY = `# 主体与公开事实
样本企业（SYNTHETIC）做消费电子出海。

# 同行校准
某同行公司做得很好，很值得我们学习。

# 来源
SYNTHETIC 测试样本
`;

export const SYNTHETIC_EMPTY = `   `;
