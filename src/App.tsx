import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { AppShell } from "./components/AppShell";
import type { AppView, StatusTone } from "./components/AppShell";
import { DashboardView } from "./components/DashboardView";
import { JobsView } from "./components/JobsView";
import { SettingsView } from "./components/SettingsView";
import {
  cancelJob,
  getDriveFolderPath,
  getJobResults,
  getJobStatus,
  getSettings,
  googleAuthBeginManual,
  googleAuthCompleteManual,
  googleAuthSignIn,
  googleAuthSignOut,
  googleAuthStatus,
  killJob,
  listDriveFiles,
  listDriveFolders,
  listJobs,
  parseSingle,
  saveSettings,
  startBatchJob,
} from "./lib/api";
import type {
  AuthStatus,
  DriveBrowserFile,
  DriveFolderEntry,
  DrivePathEntry,
  JobStatus,
  ManualAuthChallenge,
  ParsedCandidate,
  RuntimeSettingsView,
} from "./lib/types";
import {
  arrayBufferToBase64,
  isSupportedResumeFile,
  isSupportedResumeFileName,
  isTerminalJobState,
  sortTimestampForJob,
  truncateMiddle,
} from "./lib/utils";

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

interface JobListItem {
  sortTimestamp: number;
  status: JobStatus;
}

interface WorkspaceStatus {
  text: string;
  tone: StatusTone;
}

const defaultSettings: RuntimeSettingsView = {
  googleClientId: "",
  googleClientSecretConfigured: false,
  legacySecretScrubbed: false,
  tesseractPath: "tesseract",
  maxConcurrentRequests: 10,
  spreadsheetBatchSize: 100,
  maxRetries: 3,
  retryDelaySeconds: 1,
  jobRetentionHours: 24,
};

const emptyDriveState: DriveBrowserState = {
  currentFolderId: null,
  error: null,
  files: [],
  folders: [],
  loading: false,
  path: [],
};

export default function App() {
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>({
    text: "Workspace ready",
    tone: "neutral",
  });
  const [workspaceRefreshing, setWorkspaceRefreshing] = useState(false);

  const [settings, setSettings] = useState<RuntimeSettingsView>(defaultSettings);
  const [savingSettings, setSavingSettings] = useState(false);

  const [auth, setAuth] = useState<AuthStatus>({ signedIn: false });
  const [busyAuth, setBusyAuth] = useState(false);

  const [driveState, setDriveState] = useState<DriveBrowserState>(emptyDriveState);
  const [selectedDriveFolder, setSelectedDriveFolder] =
    useState<SelectedDriveFolder | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState("");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseResult, setParseResult] = useState<ParsedCandidate | null>(null);
  const [parseDragActive, setParseDragActive] = useState(false);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobStatus, setActiveJobStatus] = useState<JobStatus | null>(null);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobActionBusyId, setJobActionBusyId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobResults, setSelectedJobResults] = useState<ParsedCandidate[]>([]);
  const [selectedJobResultsLoading, setSelectedJobResultsLoading] = useState(false);
  const [selectedJobResultsError, setSelectedJobResultsError] = useState<string | null>(null);

  const [manualAuthVisible, setManualAuthVisible] = useState(false);
  const [manualAuthReason, setManualAuthReason] = useState("");
  const [manualAuthChallenge, setManualAuthChallenge] =
    useState<ManualAuthChallenge | null>(null);
  const [manualAuthInput, setManualAuthInput] = useState("");
  const [manualAuthError, setManualAuthError] = useState("");
  const [manualAuthBusy, setManualAuthBusy] = useState(false);

  const driveRequestIdRef = useRef(0);
  const folderCountRequestIdRef = useRef(0);
  const selectedJobResultsRequestIdRef = useRef(0);

  const driveBrowsingLocked = Boolean(
    activeJobId && (!activeJobStatus || !isTerminalJobState(activeJobStatus.status)),
  );

  const selectedJobStatus = useMemo(() => {
    if (selectedJobId === activeJobStatus?.jobId) {
      return activeJobStatus;
    }

    return jobs.find((item) => item.status.jobId === selectedJobId)?.status ?? null;
  }, [activeJobStatus, jobs, selectedJobId]);

  const centerLabel = useMemo(() => {
    if (activeView === "jobs" && selectedJobId) {
      return `Jobs -> ${truncateMiddle(selectedJobId, 22)}`;
    }

    if (activeView === "settings") {
      return "Settings";
    }

    if (selectedDriveFolder) {
      return `Dashboard -> ${truncateMiddle(selectedDriveFolder.name, 24)}`;
    }

    return "Dashboard";
  }, [activeView, selectedDriveFolder, selectedJobId]);

  useEffect(() => {
    void refreshWorkspace(false);
  }, []);

  useEffect(() => {
    if (workspaceStatus.tone === "neutral" || workspaceStatus.tone === "error") {
      return;
    }

    const timer = window.setTimeout(() => {
      setWorkspaceStatus({ text: "Workspace ready", tone: "neutral" });
    }, 3600);

    return () => window.clearTimeout(timer);
  }, [workspaceStatus]);

  useEffect(() => {
    if (!auth.signedIn) {
      setDriveState(emptyDriveState);
      setSelectedDriveFolder(null);
    }
  }, [auth.signedIn]);

  useEffect(() => {
    if (!selectedDriveFolder) {
      return;
    }

    if (selectedDriveFolder.id !== driveState.currentFolderId) {
      return;
    }

    const resumeCount = driveState.files.filter((file) => isSupportedResumeFile(file)).length;
    setSelectedDriveFolder((current) =>
      current && current.id === selectedDriveFolder.id
        ? { ...current, loadingCount: false, resumeCount }
        : current,
    );
  }, [driveState.currentFolderId, driveState.files, selectedDriveFolder]);

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || isTerminalJobState(activeJobStatus.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshActiveJobStatus(activeJobId, false);
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeJobId, activeJobStatus]);

  useEffect(() => {
    if (!jobs.length) {
      setSelectedJobId(null);
      return;
    }

    setSelectedJobId((current) => {
      if (current && jobs.some((item) => item.status.jobId === current)) {
        return current;
      }

      if (activeJobId && jobs.some((item) => item.status.jobId === activeJobId)) {
        return activeJobId;
      }

      return jobs[0]?.status.jobId ?? null;
    });
  }, [activeJobId, jobs]);

  useEffect(() => {
    if (!selectedJobId || !selectedJobStatus) {
      setSelectedJobResults([]);
      setSelectedJobResultsError(null);
      setSelectedJobResultsLoading(false);
      return;
    }

    const shouldLoadResults =
      (selectedJobStatus.resultsCount ?? 0) > 0 || selectedJobStatus.processedFiles > 0;

    if (!shouldLoadResults) {
      setSelectedJobResults([]);
      setSelectedJobResultsError(null);
      setSelectedJobResultsLoading(false);
      return;
    }

    const requestId = ++selectedJobResultsRequestIdRef.current;
    setSelectedJobResultsLoading(true);
    setSelectedJobResultsError(null);

    void getJobResults(selectedJobId)
      .then((results) => {
        if (selectedJobResultsRequestIdRef.current !== requestId) {
          return;
        }

        setSelectedJobResults(results);
      })
      .catch((error) => {
        if (selectedJobResultsRequestIdRef.current !== requestId) {
          return;
        }

        setSelectedJobResults([]);
        setSelectedJobResultsError(String(error));
      })
      .finally(() => {
        if (selectedJobResultsRequestIdRef.current === requestId) {
          setSelectedJobResultsLoading(false);
        }
      });
  }, [selectedJobId, selectedJobStatus]);

  async function refreshWorkspace(showSuccessMessage: boolean) {
    setWorkspaceRefreshing(true);
    const errors: string[] = [];

    try {
      try {
        const loadedSettings = await getSettings();
        setSettings(loadedSettings);
      } catch (error) {
        errors.push(`Settings refresh failed: ${String(error)}`);
      }

      let loadedAuth = auth;
      try {
        loadedAuth = await googleAuthStatus();
        setAuth(loadedAuth);
      } catch (error) {
        errors.push(`Google session refresh failed: ${String(error)}`);
      }

      const jobsOk = await refreshJobsSummary(false);
      if (!jobsOk) {
        errors.push("Job history refresh failed.");
      }

      if (loadedAuth.signedIn) {
        const driveOk = await loadDriveFolder(driveState.currentFolderId, loadedAuth.signedIn, false);
        if (!driveOk) {
          errors.push("Drive refresh failed.");
        }
      } else {
        setDriveState(emptyDriveState);
        setSelectedDriveFolder(null);
      }

      if (errors.length > 0) {
        pushStatus(errors[0], "error");
      } else if (showSuccessMessage) {
        pushStatus("Workspace refreshed", "success");
      }
    } finally {
      setWorkspaceRefreshing(false);
    }
  }

  async function refreshJobsSummary(showErrorMessage: boolean): Promise<boolean> {
    setJobsLoading(true);

    try {
      const jobIds = await listJobs();
      const settledStatuses = await Promise.allSettled(jobIds.map((jobId) => getJobStatus(jobId)));
      const nextJobs = settledStatuses
        .flatMap((result) =>
          result.status === "fulfilled"
            ? [{ sortTimestamp: sortTimestampForJob(result.value), status: result.value }]
            : [],
        )
        .sort((left, right) => right.sortTimestamp - left.sortTimestamp);

      setJobs(nextJobs);
      syncActiveJobFromSummaries(nextJobs);
      return true;
    } catch (error) {
      if (showErrorMessage) {
        pushStatus(`Failed to load jobs: ${String(error)}`, "error");
      }

      return false;
    } finally {
      setJobsLoading(false);
    }
  }

  async function loadDriveFolder(
    folderId: string | null,
    signedIn = auth.signedIn,
    showErrorMessage = true,
  ): Promise<boolean> {
    if (!signedIn) {
      setDriveState(emptyDriveState);
      return true;
    }

    const requestId = ++driveRequestIdRef.current;
    setDriveState((current) => ({ ...current, error: null, loading: true }));

    try {
      const [folders, files] = await Promise.all([
        listDriveFolders(folderId ?? undefined),
        folderId ? listDriveFiles(folderId) : Promise.resolve([]),
      ]);
      const path = folderId ? await getDriveFolderPath(folderId) : [];

      if (driveRequestIdRef.current !== requestId) {
        return false;
      }

      setDriveState({
        currentFolderId: folderId,
        error: null,
        files,
        folders,
        loading: false,
        path,
      });
      return true;
    } catch (error) {
      if (driveRequestIdRef.current === requestId) {
        setDriveState((current) => ({
          ...current,
          error: String(error),
          loading: false,
        }));
      }

      if (showErrorMessage) {
        pushStatus(`Drive load failed: ${String(error)}`, "error");
      }

      return false;
    }
  }

  async function handleParseSingle() {
    if (!selectedFile) {
      pushStatus("Choose a PDF or DOCX file first.", "error");
      return;
    }

    if (!isSupportedResumeFileName(selectedFile.name)) {
      pushStatus("Only .pdf and .docx files are supported.", "error");
      return;
    }

    setParseLoading(true);
    pushStatus("Parsing resume locally…", "info");

    try {
      const encoded = arrayBufferToBase64(await selectedFile.arrayBuffer());
      const result = await parseSingle(selectedFile.name, encoded);
      setParseResult(result);
      pushStatus("Local parse completed", "success");
    } catch (error) {
      setParseResult(null);
      pushStatus(`Parse failed: ${String(error)}`, "error");
    } finally {
      setParseLoading(false);
    }
  }

  async function handleStartBatchJob() {
    if (!selectedDriveFolder) {
      pushStatus("Select a Drive folder before starting a batch job.", "error");
      return;
    }

    pushStatus("Queueing batch job…", "info");

    try {
      const response = await startBatchJob({
        folderId: selectedDriveFolder.id,
        spreadsheetId: spreadsheetId.trim() ? spreadsheetId.trim() : undefined,
      });

      setActiveJobId(response.jobId);
      setActiveJobStatus(null);
      setSelectedJobId(response.jobId);
      await refreshActiveJobStatus(response.jobId, true);
      await refreshJobsSummary(false);
      pushStatus(`Started job ${truncateMiddle(response.jobId, 18)}`, "success");
    } catch (error) {
      const text = String(error);
      if (text.toLowerCase().includes("authentication required")) {
        setManualAuthVisible(true);
        setManualAuthReason("Google sign-in is required before starting a batch job.");
        pushStatus("Google sign-in is required before batch processing.", "error");
      } else {
        pushStatus(`Batch start failed: ${text}`, "error");
      }
    }
  }

  async function refreshActiveJobStatus(jobId: string, refreshJobsAfter: boolean) {
    try {
      const status = await getJobStatus(jobId);
      setActiveJobId(jobId);
      setActiveJobStatus(status);
      upsertJobStatus(status);

      if (refreshJobsAfter) {
        await refreshJobsSummary(false);
      }
    } catch (error) {
      pushStatus(`Failed to get job status: ${String(error)}`, "error");
    }
  }

  async function handleCancelActiveJob() {
    if (!activeJobId) {
      return;
    }

    setJobActionBusyId(activeJobId);
    try {
      const response = await cancelJob(activeJobId);
      if (response.ok) {
        pushStatus(`Cancel requested for ${truncateMiddle(activeJobId, 18)}`, "info");
        await refreshJobAfterAction(activeJobId);
      }
    } catch (error) {
      pushStatus(`Cancel failed: ${String(error)}`, "error");
    } finally {
      setJobActionBusyId((current) => (current === activeJobId ? null : current));
    }
  }

  async function handleKillJob(jobId: string) {
    setJobActionBusyId(jobId);

    try {
      const response = await killJob(jobId);
      if (!response.ok) {
        pushStatus(`Job ${truncateMiddle(jobId, 18)} could not be killed.`, "error");
        return;
      }

      pushStatus(`Kill requested for ${truncateMiddle(jobId, 18)}`, "info");
      await refreshJobAfterAction(jobId);
    } catch (error) {
      pushStatus(`Kill failed: ${String(error)}`, "error");
    } finally {
      setJobActionBusyId((current) => (current === jobId ? null : current));
    }
  }

  async function handleSignIn() {
    setBusyAuth(true);
    pushStatus("Opening browser for Google sign-in…", "info");

    try {
      const result = await googleAuthSignIn();
      if (result.state === "signed_in") {
        setAuth(result.status);
        setManualAuthVisible(false);
        setManualAuthChallenge(null);
        setManualAuthInput("");
        setManualAuthError("");
        await loadDriveFolder(driveState.currentFolderId, true, false);
        pushStatus(
          `Signed in${result.status.email ? ` as ${result.status.email}` : ""}`,
          "success",
        );
      } else {
        setManualAuthVisible(true);
        setManualAuthReason(result.message);
        await handleBeginManualAuth(true);
        pushStatus("Automatic callback did not finish. Use manual sign-in fallback.", "error");
      }
    } catch (error) {
      pushStatus(`Google sign-in failed: ${String(error)}`, "error");
    } finally {
      setBusyAuth(false);
    }
  }

  async function handleSignOut() {
    setBusyAuth(true);

    try {
      await googleAuthSignOut();
      const status = await googleAuthStatus();
      setAuth(status);
      setManualAuthVisible(false);
      setManualAuthChallenge(null);
      setManualAuthInput("");
      setManualAuthError("");
      setDriveState(emptyDriveState);
      setSelectedDriveFolder(null);
      pushStatus("Signed out from Google", "success");
    } catch (error) {
      pushStatus(`Sign-out failed: ${String(error)}`, "error");
    } finally {
      setBusyAuth(false);
    }
  }

  async function handleBeginManualAuth(openImmediately: boolean) {
    setManualAuthVisible(true);
    setManualAuthBusy(true);
    setManualAuthError("");

    try {
      const challenge = await googleAuthBeginManual();
      setManualAuthChallenge(challenge);
      if (openImmediately) {
        await openUrl(challenge.authorizeUrl);
      }
      pushStatus("Manual sign-in challenge ready", "info");
    } catch (error) {
      setManualAuthError(String(error));
      pushStatus(`Failed to start manual sign-in: ${String(error)}`, "error");
    } finally {
      setManualAuthBusy(false);
    }
  }

  async function handleOpenManualAuthUrl() {
    if (!manualAuthChallenge) {
      return;
    }

    try {
      await openUrl(manualAuthChallenge.authorizeUrl);
    } catch (error) {
      setManualAuthError(`Failed to open URL: ${String(error)}`);
      pushStatus(`Failed to open URL: ${String(error)}`, "error");
    }
  }

  async function handleCopyManualAuthUrl() {
    if (!manualAuthChallenge) {
      return;
    }

    try {
      await navigator.clipboard.writeText(manualAuthChallenge.authorizeUrl);
      pushStatus("Authorization URL copied", "success");
    } catch (error) {
      pushStatus(`Copy failed: ${String(error)}`, "error");
    }
  }

  async function handleCompleteManualAuth() {
    if (!manualAuthChallenge) {
      setManualAuthError("Generate a manual challenge first.");
      return;
    }

    if (!manualAuthInput.trim()) {
      setManualAuthError("Paste the callback URL or authorization code.");
      return;
    }

    setManualAuthBusy(true);
    setManualAuthError("");

    try {
      const status = await googleAuthCompleteManual({
        callbackUrlOrCode: manualAuthInput.trim(),
        sessionId: manualAuthChallenge.sessionId,
      });

      setAuth(status);
      setManualAuthVisible(false);
      setManualAuthChallenge(null);
      setManualAuthInput("");
      await loadDriveFolder(driveState.currentFolderId, true, false);
      pushStatus(`Signed in${status.email ? ` as ${status.email}` : ""}`, "success");
    } catch (error) {
      setManualAuthError(String(error));
      pushStatus(`Manual sign-in failed: ${String(error)}`, "error");
    } finally {
      setManualAuthBusy(false);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);

    try {
      const saved = await saveSettings({
        jobRetentionHours: settings.jobRetentionHours,
        maxConcurrentRequests: settings.maxConcurrentRequests,
        maxRetries: settings.maxRetries,
        retryDelaySeconds: settings.retryDelaySeconds,
        spreadsheetBatchSize: settings.spreadsheetBatchSize,
        tesseractPath: settings.tesseractPath,
      });
      setSettings(saved);
      pushStatus("Settings saved", "success");
    } catch (error) {
      pushStatus(`Settings save failed: ${String(error)}`, "error");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handlePickParseFile(file: File | null) {
    setParseDragActive(false);

    if (!file) {
      return;
    }

    if (!isSupportedResumeFileName(file.name)) {
      pushStatus("Only PDF and DOCX files can be parsed.", "error");
      return;
    }

    setSelectedFile(file);
    setParseResult(null);
  }

  async function handleSelectDriveFolder(folder: DriveFolderEntry) {
    if (selectedDriveFolder?.id === folder.id) {
      setSelectedDriveFolder(null);
      return;
    }

    const currentFolderSelected = driveState.currentFolderId === folder.id;
    const immediateResumeCount = currentFolderSelected
      ? driveState.files.filter((file) => isSupportedResumeFile(file)).length
      : null;

    setSelectedDriveFolder({
      id: folder.id,
      loadingCount: !currentFolderSelected,
      name: folder.name,
      resumeCount: immediateResumeCount,
    });

    if (currentFolderSelected) {
      return;
    }

    const requestId = ++folderCountRequestIdRef.current;

    try {
      const files = await listDriveFiles(folder.id);
      if (folderCountRequestIdRef.current !== requestId) {
        return;
      }

      const resumeCount = files.filter((file) => isSupportedResumeFile(file)).length;
      setSelectedDriveFolder((current) =>
        current && current.id === folder.id
          ? { ...current, loadingCount: false, resumeCount }
          : current,
      );
    } catch (error) {
      if (folderCountRequestIdRef.current !== requestId) {
        return;
      }

      setSelectedDriveFolder((current) =>
        current && current.id === folder.id
          ? { ...current, loadingCount: false }
          : current,
      );
      pushStatus(`Failed to inspect folder contents: ${String(error)}`, "error");
    }
  }

  async function handleOpenSpreadsheet(spreadsheetId: string) {
    try {
      await openUrl(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
    } catch (error) {
      pushStatus(`Failed to open spreadsheet: ${String(error)}`, "error");
    }
  }

  async function handleOpenDriveFile(fileId: string) {
    try {
      await openUrl(`https://drive.google.com/file/d/${fileId}/view`);
    } catch (error) {
      pushStatus(`Failed to open Drive file: ${String(error)}`, "error");
    }
  }

  function pushStatus(text: string, tone: StatusTone) {
    setWorkspaceStatus({ text, tone });
  }

  async function refreshJobAfterAction(jobId: string) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const status = await getJobStatus(jobId);
        if (activeJobId === jobId) {
          setActiveJobStatus(status);
        }
        upsertJobStatus(status);

        if (isTerminalJobState(status.status)) {
          break;
        }
      } catch {
        break;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    await refreshJobsSummary(false);
  }

  function syncActiveJobFromSummaries(nextJobs: JobListItem[]) {
    const current = activeJobId
      ? nextJobs.find((item) => item.status.jobId === activeJobId)?.status ?? null
      : null;
    const discovered = nextJobs.find((item) => !isTerminalJobState(item.status.status))?.status ?? null;
    const nextActive = current ?? discovered;

    setActiveJobId(nextActive?.jobId ?? null);
    setActiveJobStatus(nextActive ?? null);
  }

  function upsertJobStatus(status: JobStatus) {
    setJobs((current) => {
      const next = current
        .filter((item) => item.status.jobId !== status.jobId)
        .concat([{ sortTimestamp: sortTimestampForJob(status), status }]);
      next.sort((left, right) => right.sortTimestamp - left.sortTimestamp);
      return next;
    });
  }

  return (
    <AppShell
      activeView={activeView}
      auth={auth}
      authBusy={busyAuth || manualAuthBusy}
      centerLabel={centerLabel}
      onManualSignIn={() => void handleBeginManualAuth(false)}
      onNavigate={setActiveView}
      onOpenSettings={() => setActiveView("settings")}
      onRefresh={() => void refreshWorkspace(true)}
      onSignIn={() => void handleSignIn()}
      onSignOut={() => void handleSignOut()}
      refreshing={workspaceRefreshing}
      statusText={workspaceStatus.text}
      statusTone={workspaceStatus.tone}
    >
      {activeView === "dashboard" && (
        <DashboardView
          activeJobId={activeJobId}
          activeJobStatus={activeJobStatus}
          auth={auth}
          authBusy={busyAuth || manualAuthBusy}
          driveBrowsingLocked={driveBrowsingLocked}
          driveState={driveState}
          manualAuthChallenge={manualAuthChallenge}
          manualAuthError={manualAuthError}
          manualAuthInput={manualAuthInput}
          manualAuthReason={manualAuthReason}
          manualAuthVisible={manualAuthVisible}
          onCancelActiveJob={() => void handleCancelActiveJob()}
          onClearParseFile={() => {
            setSelectedFile(null);
            setParseResult(null);
          }}
          onCloseManualAuth={() => {
            setManualAuthVisible(false);
            setManualAuthError("");
          }}
          onCompleteManualAuth={() => void handleCompleteManualAuth()}
          onCopyManualAuthUrl={() => void handleCopyManualAuthUrl()}
          onDeselectDriveFolder={() => setSelectedDriveFolder(null)}
          onManualAuthInputChange={setManualAuthInput}
          onNavigateDrivePath={(folderId) => void loadDriveFolder(folderId)}
          onOpenDriveFolder={(folder) => void loadDriveFolder(folder.id)}
          onKillActiveJob={() =>
            activeJobId ? void handleKillJob(activeJobId) : undefined
          }
          onOpenManualAuthUrl={() => void handleOpenManualAuthUrl()}
          onParse={() => void handleParseSingle()}
          onPickFile={(file) => void handlePickParseFile(file)}
          onRefreshActiveJob={() =>
            activeJobId ? void refreshActiveJobStatus(activeJobId, true) : undefined
          }
          onSelectDriveFolder={(folder) => void handleSelectDriveFolder(folder)}
          onSetParseDragActive={setParseDragActive}
          onSignIn={() => void handleSignIn()}
          onStartBatchJob={() => void handleStartBatchJob()}
          onStartManualAuth={(openImmediately) =>
            void handleBeginManualAuth(openImmediately)
          }
          parseDragActive={parseDragActive}
          jobActionBusy={jobActionBusyId === activeJobId}
          parseLoading={parseLoading}
          parseResult={parseResult}
          selectedDriveFolder={selectedDriveFolder}
          selectedFile={selectedFile}
          spreadsheetId={spreadsheetId}
          onSpreadsheetIdChange={setSpreadsheetId}
        />
      )}

      {activeView === "jobs" && (
        <JobsView
          jobActionBusy={jobActionBusyId === selectedJobId}
          jobs={jobs}
          jobsLoading={jobsLoading}
          onKillJob={(jobId) => void handleKillJob(jobId)}
          onOpenDriveFile={(fileId) => void handleOpenDriveFile(fileId)}
          onOpenSpreadsheet={(id) => void handleOpenSpreadsheet(id)}
          onSelectJob={setSelectedJobId}
          selectedJobId={selectedJobId}
          selectedJobResults={selectedJobResults}
          selectedJobResultsError={selectedJobResultsError}
          selectedJobResultsLoading={selectedJobResultsLoading}
        />
      )}

      {activeView === "settings" && (
        <SettingsView
          onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
          onSave={() => void handleSaveSettings()}
          saving={savingSettings}
          settings={settings}
        />
      )}
    </AppShell>
  );
}
