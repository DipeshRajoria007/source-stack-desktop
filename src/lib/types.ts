export type JobProcessingState =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "revoked";

export interface ParsedCandidate {
  driveFileId?: string | null;
  sourceFile?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedIn?: string | null;
  gitHub?: string | null;
  confidence: number;
  errors: string[];
}

export interface BatchParseRequest {
  folderId: string;
  spreadsheetId?: string | null;
}

export interface JobStatus {
  jobId: string;
  status: JobProcessingState;
  progress: number;
  totalFiles: number;
  processedFiles: number;
  spreadsheetId?: string | null;
  resultsCount?: number | null;
  error?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
}

export interface RuntimeSettings {
  googleClientId: string;
  googleClientSecret: string;
  tesseractPath: string;
  maxConcurrentRequests: number;
  spreadsheetBatchSize: number;
  maxRetries: number;
  retryDelaySeconds: number;
  jobRetentionHours: number;
}

export interface AuthStatus {
  signedIn: boolean;
  email?: string | null;
  expiresAt?: string | null;
}

export interface StartJobResponse {
  jobId: string;
}

export interface CommandOk {
  ok: boolean;
}
