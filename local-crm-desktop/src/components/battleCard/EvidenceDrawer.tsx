import { X } from 'lucide-react';
import type { EvidenceSummary } from '../../lib/battleCardUi/battleCardViewModels';
import { evidenceRefLabel } from '../../lib/battleCardUi/battleCardLabels';

export interface EvidenceDrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly evidence: readonly EvidenceSummary[];
  readonly onClose: () => void;
}

/** Evidence 抽屉：弱化但可随时展开；原文与完整历史可进入抽屉。 */
export function EvidenceDrawer({ open, title, evidence, onClose }: EvidenceDrawerProps) {
  if (!open) return null;
  const sections = evidence.length > 0
    ? evidence
    : [{ refs: [], import_refs: [], crm_refs: [], derived_refs: [] }];

  return (
    <div className="bc-drawer-backdrop" role="presentation" onClick={onClose} data-testid="bc-evidence-drawer">
      <aside
        className="bc-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="依据"
        onClick={event => event.stopPropagation()}
      >
        <header className="bc-drawer-header">
          <h3>{title} · 依据</h3>
          <button type="button" className="bc-sidecar-close" aria-label="关闭证据" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="bc-drawer-body">
          {sections.map((section, sectionIndex) => {
            const entries = [...section.import_refs, ...section.crm_refs, ...section.derived_refs, ...section.refs];
            if (entries.length === 0) {
              return <p key={sectionIndex} className="bc-section-body">该卡片暂无证据引用。</p>;
            }
            return (
              <div className="bc-evidence-group" key={sectionIndex}>
                <h4>证据引用（{entries.length}）</h4>
                {[...new Set(entries)].map(ref => (
                  <div key={ref} className="bc-evidence-ref" data-testid="bc-evidence-ref">
                    {evidenceRefLabel(ref)}
                    <span style={{ color: 'var(--bc-text-muted)' }}> · {ref}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <p className="bc-talk-note">Evidence 来自导入材料章节（import:）、CRM 记录（CUSTOMER/FOLLOW_UP_RECORD/VISIT_RECORD/TASK）与派生引用。仅作审计展示，不可编辑。</p>
        </div>
      </aside>
    </div>
  );
}
