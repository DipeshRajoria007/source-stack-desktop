import { useMemo, useRef } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Home,
  ImageIcon,
  LoaderCircle,
  Lock,
  Shield,
  Upload,
  X,
} from "lucide-react";

import type {
  AuthStatus,
  DriveBrowserFile,
  DriveFolderEntry,
  DrivePathEntry,
  JobStatus,
  ManualAuthChallenge,
  ParsedCandidate,
} from "../lib/types";
import {
  classifyDriveFileType,
  formatDateTime,
  formatDurationSeconds,
  formatElapsedSince,
  formatPercent,
  isSupportedResumeFile,
  isTerminalJobState,
  truncateMiddle,
} from "../lib/utils";

interface DriveBrowserState {
  currentFolderId: string | null;
  error: string | null;
  files: DriveBrowserFile[];
  folders: DriveFolderEntry[];
  loading: boolean;
  path: DrivePathEntry[];
}

interface SelectedDriveFolder {
  id: string;
  loadingCount: boolean;
  name: string;
  resumeCount: number | null;
}

interface DashboardViewProps {
  activeJobId: string | null;
  activeJobStatus: JobStatus | null;
  auth: AuthStatus;
  authBusy: boolean;
  driveBrowsingLocked: boolean;
  driveState: DriveBrowserState;
  manualAuthChallenge: ManualAuthChallenge | null;
  manualAuthError: string;
  manualAuthInput: string;
  manualAuthReason: string;
  manualAuthVisible: boolean;
  onCancelActiveJob: () => void;
  onClearParseFile: () => void;
  onCloseManualAuth: () => void;
  onCompleteManualAuth: () => void;
  onCopyManualAuthUrl: () => void;
  onDeselectDriveFolder: () => void;
  onManualAuthInputChange: (value: string) => void;
  onNavigateDrivePath: (folderId: string | null) => void;
  onOpenDriveFolder: (folder: DriveFolderEntry) => void;
  onOpenManualAuthUrl: () => void;
  onParse: () => void;
  onPickFile: (file: File | null) => void;
  onRefreshActiveJob: () => void;
  onSelectDriveFolder: (folder: DriveFolderEntry) => void;
  onSetParseDragActive: (active: boolean) => void;
  onSignIn: () => void;
  onStartBatchJob: () => void;
  onStartManualAuth: (openImmediately: boolean) => void;
  parseDragActive: boolean;
  parseLoading: boolean;
  parseResult: ParsedCandidate | null;
  selectedDriveFolder: SelectedDriveFolder | null;
  selectedFile: File | null;
  spreadsheetId: string;
  onSpreadsheetIdChange: (value: string) => void;
}

const typeBadgeColors: Record<
  ReturnType<typeof classifyDriveFileType> | "folder",
  { background: string; color: string; label: string }
> = {
  docx: {
    background: "rgba(59,130,246,0.12)",
    color: "#60a5fa",
    label: "DOCX",
  },
  file: {
    background: "rgba(100,116,139,0.12)",
    color: "#94a3b8",
    label: "FILE",
  },
  folder: {
    background: "rgba(45,212,191,0.12)",
    color: "#2dd4bf",
    label: "FOLDER",
  },
  image: {
    background: "rgba(168,85,247,0.12)",
    color: "#c084fc",
    label: "IMAGE",
  },
  pdf: {
    background: "rgba(239,68,68,0.12)",
    color: "#f87171",
    label: "PDF",
  },
  sheet: {
    background: "rgba(34,197,94,0.12)",
    color: "#4ade80",
    label: "SHEET",
  },
};

export function DashboardView({
  activeJobId,
  activeJobStatus,
  auth,
  authBusy,
  driveBrowsingLocked,
  driveState,
  manualAuthChallenge,
  manualAuthError,
  manualAuthInput,
  manualAuthReason,
  manualAuthVisible,
  onCancelActiveJob,
  onClearParseFile,
  onCloseManualAuth,
  onCompleteManualAuth,
  onCopyManualAuthUrl,
  onDeselectDriveFolder,
  onManualAuthInputChange,
  onNavigateDrivePath,
  onOpenDriveFolder,
  onOpenManualAuthUrl,
  onParse,
  onPickFile,
  onRefreshActiveJob,
  onSelectDriveFolder,
  onSetParseDragActive,
  onSignIn,
  onStartBatchJob,
  onStartManualAuth,
  parseDragActive,
  parseLoading,
  parseResult,
  selectedDriveFolder,
  selectedFile,
  spreadsheetId,
  onSpreadsheetIdChange,
}: DashboardViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const supportedResumeCount = useMemo(
    () => driveState.files.filter((file) => isSupportedResumeFile(file)).length,
    [driveState.files],
  );
  const activeJobBusy =
    activeJobStatus !== null && !isTerminalJobState(activeJobStatus.status);

  return (
    <div className="flex h-full gap-px bg-white/4">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-bg)] p-4">
        {auth.signedIn && !manualAuthVisible ? (
          <SignedInBatchPanel
            activeJobBusy={activeJobBusy}
            activeJobId={activeJobId}
            activeJobStatus={activeJobStatus}
            driveBrowsingLocked={driveBrowsingLocked}
            driveState={driveState}
            onCancelActiveJob={onCancelActiveJob}
            onDeselectDriveFolder={onDeselectDriveFolder}
            onNavigateDrivePath={onNavigateDrivePath}
            onOpenDriveFolder={onOpenDriveFolder}
            onRefreshActiveJob={onRefreshActiveJob}
            onSelectDriveFolder={onSelectDriveFolder}
            onStartBatchJob={onStartBatchJob}
            selectedDriveFolder={selectedDriveFolder}
            spreadsheetId={spreadsheetId}
            supportedResumeCount={supportedResumeCount}
            onSpreadsheetIdChange={onSpreadsheetIdChange}
          />
        ) : (
          <AuthPanel
            authBusy={authBusy}
            challenge={manualAuthChallenge}
            error={manualAuthError}
            inputValue={manualAuthInput}
            manualVisible={manualAuthVisible}
            onCloseManualAuth={onCloseManualAuth}
            onCompleteManualAuth={onCompleteManualAuth}
            onCopyUrl={onCopyManualAuthUrl}
            onInputChange={onManualAuthInputChange}
            onOpenUrl={onOpenManualAuthUrl}
            onSignIn={onSignIn}
            onStartManualAuth={onStartManualAuth}
            reason={manualAuthReason}
          />
        )}
      </div>

      <QuickParsePanel
        fileInputRef={fileInputRef}
        onClearParseFile={onClearParseFile}
        onParse={onParse}
        onPickFile={onPickFile}
        onSetParseDragActive={onSetParseDragActive}
        parseDragActive={parseDragActive}
        parseLoading={parseLoading}
        parseResult={parseResult}
        selectedFile={selectedFile}
      />
    </div>
  );
}

function SignedInBatchPanel({
  activeJobBusy,
  activeJobId,
  activeJobStatus,
  driveBrowsingLocked,
  driveState,
  onCancelActiveJob,
  onDeselectDriveFolder,
  onNavigateDrivePath,
  onOpenDriveFolder,
  onRefreshActiveJob,
  onSelectDriveFolder,
  onStartBatchJob,
  selectedDriveFolder,
  spreadsheetId,
  supportedResumeCount,
  onSpreadsheetIdChange,
}: {
  activeJobBusy: boolean;
  activeJobId: string | null;
  activeJobStatus: JobStatus | null;
  driveBrowsingLocked: boolean;
  driveState: DriveBrowserState;
  onCancelActiveJob: () => void;
  onDeselectDriveFolder: () => void;
  onNavigateDrivePath: (folderId: string | null) => void;
  onOpenDriveFolder: (folder: DriveFolderEntry) => void;
  onRefreshActiveJob: () => void;
  onSelectDriveFolder: (folder: DriveFolderEntry) => void;
  onStartBatchJob: () => void;
  selectedDriveFolder: SelectedDriveFolder | null;
  spreadsheetId: string;
  supportedResumeCount: number;
  onSpreadsheetIdChange: (value: string) => void;
}) {
  const currentFolderLabel =
    driveState.path[driveState.path.length - 1]?.name ?? "My Drive";

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-[var(--app-foreground)]">
            Batch Processing
          </h2>
          <StatusPill
            color={activeJobBusy ? "var(--app-primary)" : "var(--app-muted)"}
            label={activeJobBusy ? "Processing" : "Idle"}
            pulse={activeJobBusy}
          />
        </div>

        <div className="flex items-center gap-2 text-[11px] text-[var(--app-muted)]">
          <MetricChip label={`${driveState.folders.length} folders`} />
          <MetricChip label={`${driveState.files.length} files`} />
          <MetricChip accent label={`${supportedResumeCount} resumes`} />
        </div>
      </div>

      <div className="panel-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-md">
        <div className="flex h-9 items-center gap-2 border-b border-white/6 px-3">
          <button
            className="rounded p-1 text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
            disabled={driveBrowsingLocked || driveState.loading}
            onClick={() => {
              if (driveState.path.length > 1) {
                onNavigateDrivePath(driveState.path[driveState.path.length - 2]?.id ?? null);
              } else {
                onNavigateDrivePath(null);
              }
            }}
            type="button"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className="rounded p-1 text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
            disabled={driveBrowsingLocked || driveState.loading}
            onClick={() => onNavigateDrivePath(null)}
            type="button"
          >
            <Home size={14} />
          </button>
          <div className="min-w-0 overflow-hidden font-mono text-xs text-[var(--app-muted)]">
            <div className="flex items-center gap-1 overflow-hidden">
              <button
                className="shrink-0 text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
                disabled={driveBrowsingLocked || driveState.loading}
                onClick={() => onNavigateDrivePath(null)}
                type="button"
              >
                My Drive
              </button>
              {driveState.path.map((entry, index) => {
                const active = index === driveState.path.length - 1;

                return (
                  <span key={entry.id} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="shrink-0 text-[var(--app-subtle)]" size={10} />
                    <button
                      className={`truncate transition-colors ${
                        active
                          ? "text-[var(--app-foreground)]"
                          : "text-[var(--app-muted)] hover:text-[var(--app-foreground)]"
                      }`}
                      disabled={driveBrowsingLocked || driveState.loading || active}
                      onClick={() => onNavigateDrivePath(entry.id)}
                      type="button"
                    >
                      {entry.name}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-b border-white/6 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--app-subtle)]">
            Current folder
          </div>
          <div className="mt-1 text-sm font-medium text-[var(--app-foreground)]">
            {currentFolderLabel}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {driveBrowsingLocked && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color:rgba(11,14,20,0.82)]">
              <div className="text-center">
                <Lock className="mx-auto mb-2 text-[var(--app-muted)]" size={20} />
                <p className="text-sm text-[var(--app-muted)]">
                  Browsing locked while job is active
                </p>
                <div className="mt-3 flex justify-center">
                  <LoaderCircle className="animate-spin text-[var(--app-primary)]" size={18} />
                </div>
              </div>
            </div>
          )}

          {driveState.loading ? (
            <EmptyPanel
              title="Loading Drive contents"
              subtitle="Fetching folders and files from Google Drive."
            />
          ) : driveState.error ? (
            <EmptyPanel title="Could not load this folder" subtitle={driveState.error} />
          ) : driveState.folders.length === 0 && driveState.files.length === 0 ? (
            <EmptyPanel title="This folder is empty" subtitle="Choose another path from the breadcrumb trail." />
          ) : (
            <div className="scrollbar-thin h-full overflow-y-auto">
              {driveState.folders.map((folder, index) => (
                <FolderRow
                  disabled={driveBrowsingLocked}
                  folder={folder}
                  index={index}
                  key={folder.id}
                  onOpen={onOpenDriveFolder}
                  onSelect={onSelectDriveFolder}
                  selected={selectedDriveFolder?.id === folder.id}
                />
              ))}
              {driveState.files.map((file, index) => (
                <FileRow
                  file={file}
                  index={driveState.folders.length + index}
                  key={file.id}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex h-8 items-center justify-between border-t border-white/6 bg-[var(--app-primary-soft)] px-3 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[var(--app-primary)]">Selected:</span>
            <span className="truncate text-[var(--app-foreground)]">
              {selectedDriveFolder?.name ?? "No folder selected"}
            </span>
            {selectedDriveFolder && (
              <span className="shrink-0 text-[var(--app-muted)]">
                ·{" "}
                {selectedDriveFolder.loadingCount
                  ? "counting resumes…"
                  : `${selectedDriveFolder.resumeCount ?? 0} resumes`}
              </span>
            )}
          </div>

          {selectedDriveFolder && (
            <button
              className="text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
              onClick={onDeselectDriveFolder}
              type="button"
            >
              Deselect
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <label className="surface-muted flex min-w-0 flex-1 items-center rounded-md px-3">
            <input
              className="h-9 w-full bg-transparent text-sm text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-subtle)]"
              onChange={(event) => onSpreadsheetIdChange(event.target.value)}
              placeholder="Export to Sheet ID (optional)"
              value={spreadsheetId}
            />
          </label>
          <button
            className="h-9 shrink-0 rounded-md bg-[var(--app-primary)] px-5 text-sm font-semibold text-[var(--app-bg)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!selectedDriveFolder || driveBrowsingLocked}
            onClick={onStartBatchJob}
            type="button"
          >
            Start Batch Job
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="surface-muted h-8 rounded-md px-3 text-xs text-[var(--app-foreground)] transition-colors hover:bg-white/6"
            disabled={!activeJobId}
            onClick={onRefreshActiveJob}
            type="button"
          >
            Refresh Status
          </button>
        </div>

        {activeJobId && activeJobStatus && (
          <div className="panel-surface rounded-md px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[var(--app-foreground)]">
                  {truncateMiddle(activeJobId, 30)}
                </span>
                <StatusPill
                  color={
                    activeJobBusy
                      ? "var(--app-primary)"
                      : activeJobStatus.status === "completed"
                        ? "var(--app-success)"
                        : activeJobStatus.status === "failed"
                          ? "var(--app-danger)"
                          : "var(--app-muted)"
                  }
                  label={activeJobStatus.status}
                  pulse={activeJobBusy}
                />
              </div>

              {activeJobBusy && (
                <button
                  className="text-xs text-[var(--app-danger)] transition-colors hover:text-red-300"
                  onClick={onCancelActiveJob}
                  type="button"
                >
                  Cancel Job
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1a1f2e]">
                <div
                  className="h-full rounded-full bg-[var(--app-primary)] transition-[width] duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, activeJobStatus.progress))}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-xs text-[var(--app-foreground)]">
                {activeJobStatus.processedFiles}/{activeJobStatus.totalFiles}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--app-muted)]">
              <span className="font-mono">
                Progress {activeJobStatus.progress}% · Results {activeJobStatus.resultsCount ?? 0}
              </span>
              <span>
                Elapsed{" "}
                {activeJobStatus.durationSeconds
                  ? formatDurationSeconds(activeJobStatus.durationSeconds)
                  : formatElapsedSince(activeJobStatus.startedAt)}
              </span>
            </div>

            {activeJobStatus.error && (
              <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-300">
                {activeJobStatus.error}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function AuthPanel({
  authBusy,
  challenge,
  error,
  inputValue,
  manualVisible,
  onCloseManualAuth,
  onCompleteManualAuth,
  onCopyUrl,
  onInputChange,
  onOpenUrl,
  onSignIn,
  onStartManualAuth,
  reason,
}: {
  authBusy: boolean;
  challenge: ManualAuthChallenge | null;
  error: string;
  inputValue: string;
  manualVisible: boolean;
  onCloseManualAuth: () => void;
  onCompleteManualAuth: () => void;
  onCopyUrl: () => void;
  onInputChange: (value: string) => void;
  onOpenUrl: () => void;
  onSignIn: () => void;
  onStartManualAuth: (openImmediately: boolean) => void;
  reason: string;
}) {
  if (!manualVisible) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm px-6 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--app-primary-soft)]">
            <Shield className="text-[var(--app-primary)]" size={24} />
          </div>
          <h2 className="text-xl font-semibold text-[var(--app-foreground)]">
            Sign in with Google to access Drive
          </h2>
          <p className="mt-2 text-sm text-[var(--app-muted)]">
            SourceStack needs Google authorization to browse Drive and export results to
            Sheets. Resume parsing stays local and works without sign-in.
          </p>
          <button
            className="mt-6 h-10 w-full rounded-md bg-[var(--app-primary)] text-sm font-semibold text-[var(--app-bg)] transition-opacity disabled:opacity-60"
            disabled={authBusy}
            onClick={onSignIn}
            type="button"
          >
            {authBusy ? "Opening browser…" : "Sign in with Google"}
          </button>
          <button
            className="mt-3 text-xs text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
            onClick={() => onStartManualAuth(false)}
            type="button"
          >
            Having trouble? Use manual sign-in →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-xl px-6">
        <h2 className="text-xl font-semibold text-[var(--app-foreground)]">
          Manual Google Authorization
        </h2>
        <p className="mt-2 text-sm text-[var(--app-muted)]">
          {reason ||
            "Use this fallback when the automatic OAuth redirect cannot reach your machine."}
        </p>

        <div className="mt-6 space-y-4">
          <StepBlock index={1} title="Copy this URL and open it in your browser">
            <div className="flex gap-2">
              <input
                className="surface-muted h-9 min-w-0 flex-1 rounded-md px-3 font-mono text-xs text-[var(--app-foreground)] outline-none"
                readOnly
                value={challenge?.authorizeUrl ?? "Generate a manual challenge first"}
              />
              <button
                className="surface-muted flex h-9 shrink-0 items-center gap-1 rounded-md px-3 text-xs text-[var(--app-foreground)] transition-colors hover:bg-white/6 disabled:opacity-50"
                disabled={!challenge}
                onClick={onCopyUrl}
                type="button"
              >
                <Copy size={13} />
                Copy
              </button>
            </div>
          </StepBlock>

          <StepBlock index={2} title="Sign in and authorize SourceStack">
            <div className="flex items-center gap-2">
              <button
                className="flex h-9 items-center gap-1 rounded-md bg-[var(--app-primary)] px-3 text-xs font-semibold text-[var(--app-bg)] transition-opacity disabled:opacity-50"
                disabled={!challenge || authBusy}
                onClick={onOpenUrl}
                type="button"
              >
                <ExternalLink size={13} />
                Open consent page
              </button>
              <button
                className="surface-muted h-9 rounded-md px-3 text-xs text-[var(--app-foreground)] transition-colors hover:bg-white/6"
                disabled={authBusy}
                onClick={() => onStartManualAuth(false)}
                type="button"
              >
                {challenge ? "Regenerate challenge" : "Generate challenge"}
              </button>
            </div>
          </StepBlock>

          <StepBlock index={3} title="Paste the callback URL or authorization code">
            <input
              className="surface-muted h-9 w-full rounded-md px-3 font-mono text-xs text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-subtle)]"
              onChange={(event) => onInputChange(event.target.value)}
              placeholder="Paste callback URL or authorization code"
              value={inputValue}
            />
          </StepBlock>

          {challenge && (
            <div className="surface-muted rounded-md px-3 py-2 font-mono text-[11px] text-[var(--app-muted)]">
              Session {truncateMiddle(challenge.sessionId, 34)} · Expires{" "}
              {formatDateTime(challenge.expiresAt)}
            </div>
          )}

          <div className="rounded-md border border-amber-400/18 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
            This fallback is needed when the automatic OAuth redirect cannot reach your
            machine. That is common on some network configurations.
          </div>

          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              className="h-9 rounded-md bg-[var(--app-primary)] px-4 text-sm font-semibold text-[var(--app-bg)] transition-opacity disabled:opacity-50"
              disabled={authBusy}
              onClick={onCompleteManualAuth}
              type="button"
            >
              {authBusy ? "Verifying…" : "Submit Code"}
            </button>
            <button
              className="text-xs text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
              onClick={onCloseManualAuth}
              type="button"
            >
              ← Back to automatic sign-in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickParsePanel({
  fileInputRef,
  onClearParseFile,
  onParse,
  onPickFile,
  onSetParseDragActive,
  parseDragActive,
  parseLoading,
  parseResult,
  selectedFile,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onClearParseFile: () => void;
  onParse: () => void;
  onPickFile: (file: File | null) => void;
  onSetParseDragActive: (active: boolean) => void;
  parseDragActive: boolean;
  parseLoading: boolean;
  parseResult: ParsedCandidate | null;
  selectedFile: File | null;
}) {
  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    onPickFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    onSetParseDragActive(false);
    onPickFile(event.dataTransfer.files[0] ?? null);
  }

  return (
    <div className="w-[360px] shrink-0 overflow-y-auto bg-[var(--app-bg)] p-4 scrollbar-thin">
      <div className="flex min-h-full flex-col">
        <h2 className="text-base font-semibold text-[var(--app-foreground)]">Quick Parse</h2>
        <p className="mt-1 text-xs text-[var(--app-muted)]">
          Drop a PDF or DOCX to parse locally on this device.
        </p>

        <button
          className={`surface-muted mt-4 flex min-h-[170px] flex-col items-center justify-center rounded-md border border-dashed p-6 text-center transition-colors ${
            parseDragActive ? "border-[var(--app-primary)] bg-[var(--app-primary-soft)]" : ""
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragLeave={() => onSetParseDragActive(false)}
          onDragOver={(event) => {
            event.preventDefault();
            onSetParseDragActive(true);
          }}
          onDrop={handleDrop}
          type="button"
        >
          <input
            accept=".pdf,.docx"
            className="hidden"
            onChange={handleInputChange}
            ref={fileInputRef}
            type="file"
          />
          {selectedFile ? (
            <>
              <div className="flex items-center gap-2 text-sm text-[var(--app-foreground)]">
                <FileText className="text-[var(--app-primary)]" size={16} />
                <span className="max-w-[240px] truncate">{selectedFile.name}</span>
              </div>
              <button
                className="mt-3 flex items-center gap-1 text-xs text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
                onClick={(event) => {
                  event.stopPropagation();
                  onClearParseFile();
                }}
                type="button"
              >
                <X size={13} />
                Clear file
              </button>
            </>
          ) : (
            <>
              <Upload className="mb-2 text-[var(--app-subtle)]" size={20} />
              <span className="text-sm text-[var(--app-muted)]">Drop PDF or DOCX here</span>
              <span className="mt-1 text-[11px] text-[var(--app-subtle)]">
                or click to browse
              </span>
            </>
          )}
        </button>

        <button
          className="mt-3 h-9 rounded-md bg-[var(--app-muted-panel)] text-sm font-semibold text-[var(--app-foreground)] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!selectedFile || parseLoading}
          onClick={onParse}
          type="button"
        >
          {parseLoading ? "Parsing…" : "Parse Resume"}
        </button>

        {parseResult ? (
          <div className="mt-4 rounded-md border border-white/6 bg-[var(--app-panel)] px-3 py-1">
            {[
              { label: "Name", value: parseResult.name },
              { label: "Email", value: parseResult.email },
              { label: "Phone", value: parseResult.phone },
              { label: "LinkedIn", value: parseResult.linkedIn },
              { label: "GitHub", value: parseResult.gitHub },
            ].map((field) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-white/6 py-2 last:border-b-0"
                key={field.label}
              >
                <span className="text-xs text-[var(--app-muted)]">{field.label}</span>
                <span className="max-w-[190px] truncate text-right font-mono text-xs text-[var(--app-foreground)]">
                  {field.value ?? "—"}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 border-b border-white/6 py-2">
              <span className="text-xs text-[var(--app-muted)]">Confidence</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#1a1f2e]">
                  <div
                    className="h-full rounded-full bg-[var(--app-success)]"
                    style={{ width: formatPercent(parseResult.confidence) }}
                  />
                </div>
                <span className="font-mono text-xs text-[var(--app-success)]">
                  {formatPercent(parseResult.confidence)}
                </span>
              </div>
            </div>
            {parseResult.errors.length > 0 && (
              <div className="py-2">
                <span className="text-xs text-[var(--app-muted)]">Errors</span>
                <p className="mt-1 text-xs text-amber-200">
                  {parseResult.errors.join("; ")}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-8 text-center text-xs text-[var(--app-subtle)]">
            <FileText className="mx-auto mb-2 text-[var(--app-subtle)]" size={18} />
            Select a resume to parse
          </div>
        )}
      </div>
    </div>
  );
}

function FolderRow({
  disabled,
  folder,
  index,
  onOpen,
  onSelect,
  selected,
}: {
  disabled: boolean;
  folder: DriveFolderEntry;
  index: number;
  onOpen: (folder: DriveFolderEntry) => void;
  onSelect: (folder: DriveFolderEntry) => void;
  selected: boolean;
}) {
  return (
    <div
      className="group flex h-[34px] items-center px-3"
      style={{
        backgroundColor: selected
          ? "rgba(45,212,191,0.08)"
          : index % 2 === 0
            ? "transparent"
            : "rgba(255,255,255,0.015)",
        borderLeft: selected ? "2px solid var(--app-primary)" : "2px solid transparent",
      }}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        disabled={disabled}
        onClick={() => onSelect(folder)}
        type="button"
      >
        <FolderOpen className="shrink-0 text-[var(--app-primary)]" size={14} />
        <span className="truncate text-sm text-[var(--app-foreground)]">{folder.name}</span>
      </button>

      <div className="flex items-center gap-2">
        <TypeBadge type="folder" />
        <button
          className="text-[11px] text-[var(--app-subtle)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--app-foreground)]"
          disabled={disabled}
          onClick={() => onOpen(folder)}
          type="button"
        >
          Open →
        </button>
      </div>
    </div>
  );
}

function FileRow({
  file,
  index,
}: {
  file: DriveBrowserFile;
  index: number;
}) {
  const type = classifyDriveFileType(file);

  return (
    <div
      className="flex h-[34px] items-center px-3"
      style={{
        backgroundColor: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TypeIcon type={type} />
        <span className="truncate text-sm text-[var(--app-foreground)]">{file.name}</span>
      </div>
      <TypeBadge type={type} />
    </div>
  );
}

function TypeBadge({
  type,
}: {
  type: ReturnType<typeof classifyDriveFileType> | "folder";
}) {
  const colors = typeBadgeColors[type];

  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: colors.background, color: colors.color }}
    >
      {colors.label}
    </span>
  );
}

function TypeIcon({
  type,
}: {
  type: ReturnType<typeof classifyDriveFileType>;
}) {
  switch (type) {
    case "pdf":
    case "docx":
      return <FileText className="shrink-0 text-[var(--app-foreground)]" size={14} />;
    case "sheet":
      return <FileSpreadsheet className="shrink-0 text-[#4ade80]" size={14} />;
    case "image":
      return <ImageIcon className="shrink-0 text-[#c084fc]" size={14} />;
    default:
      return <File className="shrink-0 text-[var(--app-muted)]" size={14} />;
  }
}

function EmptyPanel({
  subtitle,
  title,
}: {
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div>
        <p className="text-sm font-medium text-[var(--app-foreground)]">{title}</p>
        <p className="mt-1 text-xs text-[var(--app-muted)]">{subtitle}</p>
      </div>
    </div>
  );
}

function MetricChip({
  accent = false,
  label,
}: {
  accent?: boolean;
  label: string;
}) {
  return (
    <span
      className="rounded-full border px-2 py-0.5"
      style={{
        borderColor: accent ? "rgba(45,212,191,0.22)" : "rgba(255,255,255,0.08)",
        color: accent ? "var(--app-primary)" : "var(--app-muted)",
      }}
    >
      {label}
    </span>
  );
}

function StatusPill({
  color,
  label,
  pulse = false,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: withAlpha(color, 0.12), color }}
    >
      {pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: color }} />}
      {label}
    </span>
  );
}

function StepBlock({
  children,
  index,
  title,
}: {
  children: React.ReactNode;
  index: number;
  title: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--app-primary)] text-[11px] font-bold text-[var(--app-bg)]">
          {index}
        </span>
        <span className="text-sm text-[var(--app-foreground)]">{title}</span>
      </div>
      {children}
    </div>
  );
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("var(")) {
    return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
  }

  return color;
}
