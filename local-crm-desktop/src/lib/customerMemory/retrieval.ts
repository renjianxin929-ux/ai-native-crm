import type { RetrievalProvider } from './types';

/** Deliberate Stage 8 extension seam: persistence is available, retrieval is not. */
export class NoopRetrievalProvider implements RetrievalProvider {
  async retrieve(): Promise<readonly []> {
    return [];
  }
}
