export type ClipboardWriter = {
  writeText(text: string): Promise<void>;
};

export type ClipboardReader = {
  readText(): Promise<string>;
};

export type ClipboardAdapter = ClipboardWriter & ClipboardReader;

type SystemClipboardApi = {
  writeText?: (text: string) => Promise<void>;
  readText?: () => Promise<string>;
};

export function createSystemClipboardAdapter(
  api: SystemClipboardApi | undefined = getNavigatorClipboard(),
): ClipboardAdapter {
  return {
    async writeText(text: string) {
      if (!api?.writeText) {
        throw new Error('System clipboard write is unavailable');
      }
      await api.writeText(text);
    },
    async readText() {
      if (!api?.readText) {
        throw new Error('System clipboard read is unavailable');
      }
      return api.readText();
    },
  };
}

function getNavigatorClipboard(): SystemClipboardApi | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.clipboard;
}
