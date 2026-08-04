import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Layers, ShieldAlert } from 'lucide-react';
import { getBattleCardUiClient } from '../../lib/battleCardUi/battleCardClient';
import { formatUserFacingErrorMessage } from '../../lib/salesAgentUi/formatUserFacingError';
import { BATTLE_CARD_STATUS_LABELS, formatDateTime, stageLabel } from '../../lib/battleCardUi/battleCardLabels';

export interface SalesAgentBattleCardEntryProps {
  readonly customerId: string;
  readonly customerName: string;
}

/**
 * Sales Agent 工作台的作战卡入口条。
 * 已绑定时展示：查看作战卡 / 当前阶段 / 当前卡版本 / 最近更新时间 / 待验证假设数 / 今日复盘入口。
 * 无卡时展示：导入战前材料 / 从已有客户数据生成草稿（跳转作战卡页执行）。
 * 全部数据来自真实后端；不展示伪造作战建议。
 */
export function SalesAgentBattleCardEntry({ customerId, customerName }: SalesAgentBattleCardEntryProps) {  const navigate = useNavigate();
  const client = getBattleCardUiClient();
  const [status, setStatus] = useState<{
    card: { stage_code: string; version: number; updated_at: string; card_status: string } | null;
    openHypotheses: number;
    error: string;
  }>({ card: null, openHypotheses: 0, error: '' });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const [current, context] = await Promise.all([
        client.getCurrentStageCard(customerId),
        client.getCustomerBattleContext(customerId),
      ]);
      setStatus({
        card: current ? { stage_code: current.stage_code, version: current.version, updated_at: current.confirmed_at ?? current.created_at, card_status: current.card_status } : null,
        openHypotheses: context.hypotheses.filter(hypothesis => hypothesis.status === 'PENDING' || hypothesis.status === 'PARTIALLY_CONFIRMED').length,
        error: '',
      });
    } catch (cause) {
      setStatus(current => ({ ...current, error: formatUserFacingErrorMessage(cause) }));
    } finally {
      setLoading(false);
    }
  }, [customerId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!customerId) return null;

  const hasCard = status.card !== null;

  return (
    <div className="agent-battle-entry" data-testid="agent-battle-entry" data-has-card={hasCard ? 'true' : 'false'}>
      <div className="agent-battle-entry-info">
        <strong>作战卡{customerName ? ` · ${customerName}` : ''}</strong>
        {loading ? <span>加载中…</span> : status.error ? <span role="alert">{status.error}</span> : hasCard ? (
          <>
            <span>阶段：{stageLabel(status.card!.stage_code)}</span>
            <span>版本：v{status.card!.version}</span>
            <span>更新：{formatDateTime(status.card!.updated_at)}</span>
            <span>待验证假设：{status.openHypotheses} 条</span>
            <span>状态：{BATTLE_CARD_STATUS_LABELS[status.card!.card_status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED']}</span>
          </>
        ) : (
          <span>尚未生成作战卡（不展示伪造作战建议）</span>
        )}
      </div>
      <div className="agent-battle-entry-actions">
        {hasCard ? (
          <button type="button" className="btn btn-sm" data-testid="agent-battle-open-card" onClick={() => navigate(`/customers/${customerId}/battle-card`)}>
            <Layers size={14} aria-hidden="true" />查看作战卡
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-sm" data-testid="agent-battle-import" onClick={() => navigate(`/customers/${customerId}/battle-card`, { state: { openImport: true } })}>
              <FileText size={14} aria-hidden="true" />导入战前材料
            </button>
            <button type="button" className="btn btn-sm" data-testid="agent-battle-draft" onClick={() => navigate(`/customers/${customerId}/battle-card`, { state: { openGenerateDraft: true } })}>
              <FileText size={14} aria-hidden="true" />从已有客户数据生成草稿
            </button>
          </>
        )}
        <button type="button" className="btn btn-sm" data-testid="agent-battle-review" onClick={() => navigate('/battle-review')}>
          <ShieldAlert size={14} aria-hidden="true" />今日复盘
        </button>
      </div>
    </div>
  );
}
