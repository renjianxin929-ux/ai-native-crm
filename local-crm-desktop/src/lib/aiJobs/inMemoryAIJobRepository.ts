import type { AIJob, AIJobRepository, AIReasoningResultRecord } from './types';

export class InMemoryAIJobRepository implements AIJobRepository {
  readonly #jobs = new Map<string, AIJob>();
  readonly #results = new Map<string, AIReasoningResultRecord>();

  async saveJob(job: AIJob): Promise<void> {
    this.#jobs.set(job.jobId, structuredClone(job));
  }

  async getJob(jobId: string): Promise<AIJob | null> {
    const job = this.#jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async saveResult(result: AIReasoningResultRecord): Promise<void> {
    this.#results.set(result.jobId, structuredClone(result));
  }

  async getResultForJob(jobId: string): Promise<AIReasoningResultRecord | null> {
    const result = this.#results.get(jobId);
    return result ? structuredClone(result) : null;
  }
}
