import { useCallback, useRef, useState } from 'react';

/** Copy to clipboard with a short success indicator. */
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
