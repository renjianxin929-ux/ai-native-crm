import { Copy } from 'lucide-react';
import { useCopyFeedback } from '../../lib/battleCardUi/useCopyFeedback';

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const { copied, copy } = useCopyFeedback();
  return (
    <button type="button" className="bc-copy-btn" onClick={() => copy(text)}>
      <Copy size={12} aria-hidden="true" />
      {copied ? '已复制' : label}
    </button>
  );
}
