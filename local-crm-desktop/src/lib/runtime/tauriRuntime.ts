/**
 * Single production runtime boundary: Tauri WebView exposes __TAURI_INTERNALS__.
 * Vitest / Node has no window, so destructive DB lifecycle stays on the
 * same-connection test adapter instead of silently calling a non-atomic path.
 */

type AtomicInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

let testAtomicInvoke: AtomicInvoke | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Test-only seam to inject a failing/successful Tauri atomic command. */
export function __setTauriAtomicInvokeForTests(fn: AtomicInvoke | null): void {
  testAtomicInvoke = fn;
}

export async function invokeTauriAtomicCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  if (testAtomicInvoke) return testAtomicInvoke(command, args);
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}
