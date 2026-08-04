import { X } from 'lucide-react';
import { SalesAgentInteractionWorkspace } from '../aiNative/SalesAgentInteractionWorkspace';
import { useSalesAgentRuntime, loadCustomerSnapshot } from '../aiNative/useSalesAgentRuntime';
import { useState } from 'react';

export interface AgentSidecarProps {
  readonly customerId: string;
  readonly customerName: string;
  /** 当前卡引用（card_id/version），用于 Sidecar 头显示。 */
  readonly cardRef: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** 初始指令：让 Agent 基于当前作战卡继续。 */
  readonly initialInstruction?: string | null;
  /** 快捷动作（真实可执行项；模型未配置时由 Agent 层诚实阻断）。 */
  readonly quickActions?: readonly { readonly id: string; readonly label: string; readonly prompt: string }[];
}

/** 作战卡协同区：右侧 Agent Sidecar，绑定当前 customer_id 与 card 引用，Composer 常驻。 */
export function AgentSidecar({
  customerId,
  customerName,
  cardRef,
  open,
  onClose,
  initialInstruction = null,
  quickActions = [],
}: AgentSidecarProps) {
  const runtime = useSalesAgentRuntime(customerId);
  const [instruction, setInstruction] = useState<string | null>(initialInstruction);
  const [instructionConsumed, setInstructionConsumed] = useState(false);

  if (!open) return null;

  const runQuick = (prompt: string) => {
    setInstruction(prompt);
    setInstructionConsumed(false);
  };

  return (
    <aside
      className={`bc-sidecar${open ? ' open' : ''}`}
      data-testid="bc-agent-sidecar"
      aria-label="Sales Agent 协同区"
    >
      <header className="bc-sidecar-header">
        <h3>
          Sales Agent
          <span className="bc-card-ref">当前卡：{cardRef} · 客户：{customerName}</span>
        </h3>
        <button type="button" className="bc-sidecar-close" aria-label="收起 Sales Agent" onClick={onClose} data-testid="bc-sidecar-close">
          <X size={16} />
        </button>
      </header>
      {quickActions.length > 0 ? (
        <div className="bc-sidecar-quick" data-testid="bc-sidecar-quick">
          {quickActions.map(action => (
            <button key={action.id} type="button" onClick={() => runQuick(action.prompt)}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="bc-sidecar-body">
        {runtime.error ? <p className="bc-banner-note" style={{ padding: 10 }}>{runtime.error}</p> : null}
        <SalesAgentInteractionWorkspace
          customerId={customerId}
          customerName={customerName}
          onBindCustomer={id => { void id; }}
          onClearCustomer={() => { void 0; }}
          snapshot={runtime.snapshot}
          context={runtime.context}
          compareContext={runtime.compareContext}
          customerCatalog={[{ id: customerId, name: customerName }]}
          memory={runtime.memory}
          profileId="local-sales-agent"
          host={runtime.host}
          memoryRepository={runtime.memoryRepository}
          loadCustomerSnapshot={loadCustomerSnapshot}
          onRefresh={runtime.refresh}
          contextLoading={runtime.loading}
          initialInstruction={instructionConsumed ? null : instruction}
          onInitialInstructionConsumed={() => { setInstructionConsumed(true); setInstruction(null); }}
          onProcessDrawerOpenChange={() => { void 0; }}
        />
      </div>
    </aside>
  );
}
