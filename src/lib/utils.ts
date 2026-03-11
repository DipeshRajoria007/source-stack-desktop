import type {
  DriveBrowserFile,
  JobProcessingState,
  JobStatus,
} from "./types";

export type DriveDisplayType =
  | "folder"
  | "pdf"
  | "docx"
  | "sheet"
  | "image"
  | "file";

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

export function confidenceToPercent(value?: number | null): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  const normalized = value <= 1 ? value * 100 : value;
  return clamp(Math.round(normalized), 0, 100);
}

export function formatPercent(value?: number | null): string {
  return `${confidenceToPercent(value)}%`;
}

export function formatDurationSeconds(value?: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

export function formatElapsedSince(value?: string | null): string {
  if (!value) {
    return "-";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "-";
  }

  return formatDurationSeconds((Date.now() - timestamp) / 1000);
}

export function truncateMiddle(value?: string | null, maxLength = 28): string {
  if (!value) {
    return "-";
  }

  if (value.length <= maxLength) {
    return value;
  }

  const keep = Math.max(4, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function isTerminalJobState(state?: JobProcessingState | null): boolean {
  return state === "completed" || state === "failed" || state === "revoked";
}

export function isSupportedResumeFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".docx");
}

export function isSupportedResumeFile(file: Pick<DriveBrowserFile, "name" | "mimeType">): boolean {
  const mime = file.mimeType.toLowerCase();
  return (
    isSupportedResumeFileName(file.name) ||
    mime === "application/pdf" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export function classifyDriveFileType(
  file: Pick<DriveBrowserFile, "name" | "mimeType">,
): DriveDisplayType {
  const mime = file.mimeType.toLowerCase();
  const lowerName = file.name.toLowerCase();

  if (mime.includes("spreadsheet") || lowerName.endsWith(".xlsx")) {
    return "sheet";
  }

  if (mime.startsWith("image/")) {
    return "image";
  }

  if (mime === "application/pdf" || lowerName.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    return "docx";
  }

  return "file";
}

export function sortTimestampForJob(status: JobStatus): number {
  const value = status.createdAt ?? status.startedAt ?? status.completedAt;
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getJobTimestampLabel(status: JobStatus): string {
  return formatDateTime(status.createdAt ?? status.startedAt ?? status.completedAt);
}

export function toRetentionDays(hours: number): number {
  return Math.max(1, Math.ceil(hours / 24));
}

export function fromRetentionDays(days: number): number {
  return Math.max(1, Math.ceil(days)) * 24;
}

export function toRetryDelayMilliseconds(seconds: number): number {
  return Math.max(100, Math.round(seconds * 1000));
}

export function fromRetryDelayMilliseconds(milliseconds: number): number {
  return Math.max(0.1, milliseconds / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
