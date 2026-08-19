import { X } from 'lucide-react';
import type { EvidenceRow } from '../../lib/evidence/types';
import { t, tFormat } from '../../lib/i18n/appLocale';
import { useAppLocale } from '../../lib/i18n/LocaleProvider';

interface Props {
  readonly open: boolean;
  readonly evidence: readonly EvidenceRow[];
  readonly onClose: () => void;
}

export function EvidenceQuietPanel({ open, evidence, onClose }: Props) {
  useAppLocale();
  if (!open) return null;

  return (
    <aside className="agent-drawer agent-drawer-context" data-testid="evidence-quiet-panel" aria-label="依据">
      <header>
        <h3>依据 {evidence.length} 条</h3>
        <button type="button" className="agent-icon-btn" aria-label="关闭依据" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {evidence.length === 0 ? (
        <p>当前客户还没有可展示的依据。</p>
      ) : (
        <ul className="evidence-quiet-list">
          {evidence.map(item => (
            <li key={item.id} className="evidence-quiet-item">
              <strong>{item.source_title || item.source_type}</strong>
              <small>{new Date(item.captured_at).toLocaleString('zh-CN')}</small>
              <p>{item.summary}</p>
              {item.excerpt ? <p className="evidence-excerpt">{item.excerpt}</p> : null}
              {item.source_url ? <small>{item.source_url}</small> : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function evidenceEntryLabel(count: number): string {
  return count > 0 ? tFormat('customer.detail.evidenceCount', { n: count }) : t('customer.detail.evidence');
}
