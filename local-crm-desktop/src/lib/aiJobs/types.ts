import type { ReasoningRequest, ReasoningResult } from '../reasoning/types';

export type AIJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AIJob {
  jobId: string;
  request: ReasoningRequest;
  status: AIJobStatus;
  createdAt: string;
  updatedAt: string;
  automaticCRMAction: false;
}

export interface AIReasoningResultRecord {
  resultId: string;
  jobId: string;
  reasoningResult: ReasoningResult;
  createdAt: string;
  persistedToCRM: false;
  executable: false;
}

export interface AIJobRepository {
  saveJob(job: AIJob): Promise<void>;
  getJob(jobId: string): Promise<AIJob | null>;
  saveResult(result: AIReasoningResultRecord): Promise<void>;
  getResultForJob(jobId: string): Promise<AIReasoningResultRecord | null>;
}
