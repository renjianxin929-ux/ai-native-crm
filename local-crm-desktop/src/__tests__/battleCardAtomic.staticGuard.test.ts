/**
 * Battle Card Atomic Transactions — 静态门禁。
 * 防止生产写路径重新引用跨 plugin execute 的 withTransaction / 裸 BEGIN，
 * 防止 React 传 raw SQL / 数据库路径，防止前端补偿删除。
 */
import { describe, expect, it } from 'vitest';

async function sourceOf(moduleSpec: string): Promise<string> {
  const imported = await import(moduleSpec);
  return (imported.default as string).replace(/\r\n/g, '\n');
}

describe('生产写路径不再引用旧事务 helper', () => {
  it('importService 生产分支不引用旧事务 helper；无裸 BEGIN', async () => {
    const source = await sourceOf('../lib/battleCard/importService?raw');
    // 生产分派存在（defaultAtomicWriteBackend）
    expect(source).toMatch(/defaultAtomicWriteBackend\(\)/);
    // withTransaction 只允许出现在「测试/无 Tauri 传输」注释块之后（测试传输路径）
    const productionPart = source.split('// 测试/无 Tauri 传输')[0] ?? '';
    expect(productionPart).not.toMatch(/withTransaction\(/);
    expect(source).not.toMatch(/execute\('BEGIN'\)/);
    expect(source).not.toMatch(/execute\('COMMIT'\)/);
    expect(source).not.toMatch(/execute\('ROLLBACK'\)/);
  });

  it('repository StageCardRepository.confirm 函数体不包含 withTransaction 调用', async () => {
    const source = await sourceOf('../lib/battleCard/repository?raw');
    // withTransaction 定义本身允许存在（测试适配器使用），但 confirm 生产分支不得调用
    const confirmBlock = source.match(/async confirm\(cardId, by, at\) \{[\s\S]*?\n {4}\},\n {2}\};/);
    expect(confirmBlock).toBeTruthy();
    // 生产分支（atomicBackend）与测试分支共存；withTransaction 仅出现在测试分支
    const productionBranch = confirmBlock![0].split('// 测试/无 Tauri 传输')[0] ?? '';
    expect(productionBranch).not.toMatch(/withTransaction\(/);
    // helper 定义处必须有生产语义警告
    expect(source).toMatch(/仅对\*\*单物理连接\*\*适配器/);
  });

  it('React 组件与页面不传 raw SQL / 数据库路径 / invoke', async () => {
    const targets = [
      '../components/battleCard/ImportWizard?raw',
      '../components/battleCard/AgentSidecar?raw',
      '../pages/CustomerBattleCardPage?raw',
      '../pages/DailyBattleReviewPage?raw',
      '../components/aiNative/SalesAgentBattleCardEntry?raw',
    ];
    for (const target of targets) {
      const source = await sourceOf(target);
      expect(source, target).not.toMatch(/plugin:sql/);
      expect(source, target).not.toMatch(/personal-crm\.db/);
      expect(source, target).not.toMatch(/invoke\(/);
      expect(source, target).not.toMatch(/db\.execute/);
    }
  });

  it('原子写后端无前端补偿删除（不模拟 rollback）', async () => {
    const source = await sourceOf('../lib/battleCardUi/atomicWriteBackend?raw');
    expect(source).not.toMatch(/DELETE FROM/i);
    // 生产后端必须经 invoke 单命令
    expect(source).toMatch(/confirm_battle_card_import_atomic_v1/);
    expect(source).toMatch(/confirm_battle_card_stage_card_atomic_v1/);
  });

  it('DTO 不含 Renderer 正文/最终状态/预序列化 Evidence（statement / verificationStatus / evidenceRefsJson）', async () => {
    const source = await sourceOf('../lib/battleCardUi/atomicWriteBackend?raw');
    // 字段定义形式禁止（注释说明可保留）
    expect(source).not.toMatch(/readonly statement/);
    expect(source).not.toMatch(/readonly factCategory/);
    expect(source).not.toMatch(/readonly confidence/);
    expect(source).not.toMatch(/readonly verificationStatus/);
    expect(source).not.toMatch(/readonly evidenceRefsJson/);
    expect(source).not.toMatch(/readonly evidenceRefs: readonly string\[\]/);
    // 决策字段存在
    expect(source).toMatch(/readonly candidateId: string/);
    expect(source).toMatch(/decision: 'KEEP' \| 'VERIFY'/);
    expect(source).toMatch(/readonly hypothesisCandidateIds: readonly string\[\]/);
  });
});
