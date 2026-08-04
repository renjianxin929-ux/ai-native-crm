import { useCallback, useRef, useState } from 'react';
import { Copy } from 'lucide-react';

/** 复制到剪贴板（带 1.4s 成功反馈；失败静默降级为选中文本）。 */
export function useCopyFeedback(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useCallback((text: string) => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => done());
    } else {
      done();
    }
  }, []);
  return { copied, copy };
}

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const { copied, copy } = useCopyFeedback();
  return (
    <button type="button" className="bc-copy-btn" onClick={() => copy(text)}>
      <Copy size={12} aria-hidden="true" />
      {copied ? '已复制' : label}
    </button>
  );
}
