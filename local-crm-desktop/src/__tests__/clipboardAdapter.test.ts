import { describe, expect, it, vi } from 'vitest';

import { createSystemClipboardAdapter } from '../lib/clipboard';

describe('system clipboard adapter', () => {
  it('delegates write and read calls to the WebView Clipboard API', async () => {
    const api = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue('clipboard lead text'),
    };
    const clipboard = createSystemClipboardAdapter(api);

    await expect(clipboard.writeText('search keyword')).resolves.toBeUndefined();
    await expect(clipboard.readText()).resolves.toBe('clipboard lead text');
    expect(api.writeText).toHaveBeenCalledWith('search keyword');
    expect(api.readText).toHaveBeenCalledOnce();
  });

  it('reports explicit errors when the WebView Clipboard API is unavailable', async () => {
    const clipboard = createSystemClipboardAdapter(undefined);

    await expect(clipboard.writeText('search keyword')).rejects.toThrow(
      'System clipboard write is unavailable',
    );
    await expect(clipboard.readText()).rejects.toThrow(
      'System clipboard read is unavailable',
    );
  });

  it('does not hide operating-system clipboard failures', async () => {
    const clipboard = createSystemClipboardAdapter({
      writeText: vi.fn().mockRejectedValue(new Error('write denied')),
      readText: vi.fn().mockRejectedValue(new Error('read denied')),
    });

    await expect(clipboard.writeText('search keyword')).rejects.toThrow('write denied');
    await expect(clipboard.readText()).rejects.toThrow('read denied');
  });
});
