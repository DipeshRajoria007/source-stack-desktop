import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  BatchParseRequest,
  CommandOk,
  JobStatus,
  ParsedCandidate,
  RuntimeSettings,
  StartJobResponse,
} from "./types";

export async function parseSingle(
  fileName: string,
  fileBytesBase64: string,
): Promise<ParsedCandidate> {
  return invoke<ParsedCandidate>("parse_single", {
    fileName,
    fileBytesBase64,
  });
}

export async function startBatchJob(
  request: BatchParseRequest,
): Promise<StartJobResponse> {
  return invoke<StartJobResponse>("start_batch_job", { request });
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return invoke<JobStatus>("get_job_status", { jobId });
}

export async function getJobResults(jobId: string): Promise<ParsedCandidate[]> {
  return invoke<ParsedCandidate[]>("get_job_results", { jobId });
}

export async function listJobs(): Promise<string[]> {
  return invoke<string[]>("list_jobs");
}

export async function cancelJob(jobId: string): Promise<CommandOk> {
  return invoke<CommandOk>("cancel_job", { jobId });
}

export async function googleAuthSignIn(): Promise<AuthStatus> {
  return invoke<AuthStatus>("google_auth_sign_in");
}

export async function googleAuthSignOut(): Promise<CommandOk> {
  return invoke<CommandOk>("google_auth_sign_out");
}

export async function googleAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("google_auth_status");
}

export async function getSettings(): Promise<RuntimeSettings> {
  return invoke<RuntimeSettings>("get_settings");
}

export async function saveSettings(
  settings: RuntimeSettings,
): Promise<RuntimeSettings> {
  return invoke<RuntimeSettings>("save_settings", { settings });
}
