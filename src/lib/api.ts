import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  BatchParseRequest,
  CommandOk,
  GoogleSignInResult,
  JobStatus,
  ManualAuthChallenge,
  ManualAuthCompleteRequest,
  ParsedCandidate,
  RuntimeSettingsUpdate,
  RuntimeSettingsView,
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

export async function googleAuthSignIn(): Promise<GoogleSignInResult> {
  return invoke<GoogleSignInResult>("google_auth_sign_in");
}

export async function googleAuthBeginManual(): Promise<ManualAuthChallenge> {
  return invoke<ManualAuthChallenge>("google_auth_begin_manual");
}

export async function googleAuthCompleteManual(
  request: ManualAuthCompleteRequest,
): Promise<AuthStatus> {
  return invoke<AuthStatus>("google_auth_complete_manual", { request });
}

export async function googleAuthSignOut(): Promise<CommandOk> {
  return invoke<CommandOk>("google_auth_sign_out");
}

export async function googleAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("google_auth_status");
}

export async function getSettings(): Promise<RuntimeSettingsView> {
  return invoke<RuntimeSettingsView>("get_settings");
}

export async function saveSettings(
  settings: RuntimeSettingsUpdate,
): Promise<RuntimeSettingsView> {
  return invoke<RuntimeSettingsView>("save_settings", { settings });
}
