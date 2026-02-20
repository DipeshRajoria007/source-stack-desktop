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

export interface RuntimeSettingsView {
  googleClientId: string;
  googleClientSecretConfigured: boolean;
  legacySecretScrubbed: boolean;
  tesseractPath: string;
  maxConcurrentRequests: number;
  spreadsheetBatchSize: number;
  maxRetries: number;
  retryDelaySeconds: number;
  jobRetentionHours: number;
}

export interface RuntimeSettingsUpdate {
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

export type GoogleSignInResult =
  | {
      state: "signed_in";
      status: AuthStatus;
    }
  | {
      state: "manual_required";
      reason: string;
      message: string;
    };

export interface ManualAuthChallenge {
  sessionId: string;
  authorizeUrl: string;
  redirectUri: string;
  expiresAt: string;
  instructions: string;
}

export interface ManualAuthCompleteRequest {
  sessionId: string;
  callbackUrlOrCode: string;
}

export interface StartJobResponse {
  jobId: string;
}

export interface CommandOk {
  ok: boolean;
}
