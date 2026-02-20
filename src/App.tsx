import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";
import {
  cancelJob,
  getJobResults,
  getJobStatus,
  getSettings,
  googleAuthBeginManual,
  googleAuthCompleteManual,
  googleAuthSignIn,
  googleAuthSignOut,
  googleAuthStatus,
  listJobs,
  parseSingle,
  saveSettings,
  startBatchJob,
} from "./lib/api";
import type {
  AuthStatus,
  JobStatus,
  ManualAuthChallenge,
  ParsedCandidate,
  RuntimeSettingsUpdate,
  RuntimeSettingsView,
} from "./lib/types";
import { arrayBufferToBase64, formatDateTime } from "./lib/utils";

type TabKey = "dashboard" | "jobs" | "settings";

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

function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [message, setMessage] = useState("Ready");

  const [settings, setSettings] = useState<RuntimeSettingsView>(defaultSettings);
  const [auth, setAuth] = useState<AuthStatus>({ signedIn: false });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseResult, setParseResult] = useState<ParsedCandidate | null>(null);

  const [folderId, setFolderId] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobResults, setJobResults] = useState<ParsedCandidate[]>([]);
  const [jobs, setJobs] = useState<string[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const [busyAuth, setBusyAuth] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [manualAuthVisible, setManualAuthVisible] = useState(false);
  const [manualAuthReason, setManualAuthReason] = useState("");
  const [manualAuthChallenge, setManualAuthChallenge] =
    useState<ManualAuthChallenge | null>(null);
  const [manualAuthInput, setManualAuthInput] = useState("");
  const [manualAuthBusy, setManualAuthBusy] = useState(false);
  const [manualAuthError, setManualAuthError] = useState("");

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!activeJobId) {
      return;
    }

    const interval = setInterval(() => {
      void refreshStatus(activeJobId, false);
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJobId]);

  const progressText = useMemo(() => {
    if (!jobStatus) {
      return "No active job";
    }

    return `${jobStatus.status} • ${jobStatus.progress}% • ${jobStatus.processedFiles}/${jobStatus.totalFiles} files`;
  }, [jobStatus]);

  async function bootstrap() {
    try {
      const [loadedSettings, loadedAuth] = await Promise.all([
        getSettings(),
        googleAuthStatus(),
      ]);
      setSettings(loadedSettings);
      setAuth(loadedAuth);
      await refreshJobs();
      if (!loadedSettings.googleClientId.trim()) {
        setMessage(
          "This app build is missing Google OAuth configuration. Contact Dipesh from engineering team.",
        );
      } else {
        setMessage("Workspace ready");
      }
    } catch (error) {
      setMessage(`Failed to initialize: ${String(error)}`);
    }
  }

  async function refreshJobs() {
    setLoadingJobs(true);
    try {
      const ids = await listJobs();
      setJobs(ids);
    } catch (error) {
      setMessage(`Failed to load jobs: ${String(error)}`);
    } finally {
      setLoadingJobs(false);
    }
  }

  async function handleParseSingle() {
    if (!selectedFile) {
      setMessage("Choose a .pdf or .docx file first");
      return;
    }

    const fileName = selectedFile.name.toLowerCase();
    if (!fileName.endsWith(".pdf") && !fileName.endsWith(".docx")) {
      setMessage("Only .pdf and .docx are supported");
      return;
    }

    setParseLoading(true);
    setMessage("Parsing resume locally...");

    try {
      const buffer = await selectedFile.arrayBuffer();
      const encoded = arrayBufferToBase64(buffer);
      const result = await parseSingle(selectedFile.name, encoded);
      setParseResult(result);
      setMessage("Local parse completed");
    } catch (error) {
      setMessage(`Parse failed: ${String(error)}`);
    } finally {
      setParseLoading(false);
    }
  }

  async function handleStartBatchJob() {
    if (!folderId.trim()) {
      setMessage("Google Drive folder ID is required");
      return;
    }

    setMessage("Queueing batch job...");
    try {
      const response = await startBatchJob({
        folderId: folderId.trim(),
        spreadsheetId: spreadsheetId.trim() ? spreadsheetId.trim() : undefined,
      });

      setActiveJobId(response.jobId);
      setJobResults([]);
      setMessage(`Started job ${response.jobId}`);
      await refreshJobs();
      await refreshStatus(response.jobId, true);
    } catch (error) {
      const text = String(error);
      if (text.toLowerCase().includes("authentication required")) {
        setMessage("Google sign-in is required before starting a batch job.");
        setManualAuthVisible(true);
      } else {
        setMessage(`Batch start failed: ${text}`);
      }
    }
  }

  async function refreshStatus(jobId: string, focusJobsTab: boolean) {
    try {
      const status = await getJobStatus(jobId);
      setJobStatus(status);
      setActiveJobId(jobId);

      if (focusJobsTab) {
        setTab("jobs");
      }

      if (status.status === "completed") {
        const results = await getJobResults(jobId);
        setJobResults(results);
        setMessage(`Job ${jobId} completed (${results.length} results)`);
      } else if (status.status === "failed") {
        setMessage(`Job ${jobId} failed: ${status.error ?? "unknown error"}`);
      } else if (status.status === "revoked") {
        setMessage(`Job ${jobId} canceled`);
      }
    } catch (error) {
      setMessage(`Failed to get job status: ${String(error)}`);
    }
  }

  async function handleCancelActiveJob() {
    if (!activeJobId) {
      return;
    }

    try {
      const response = await cancelJob(activeJobId);
      if (response.ok) {
        setMessage(`Cancel requested for ${activeJobId}`);
      }
    } catch (error) {
      setMessage(`Cancel failed: ${String(error)}`);
    }
  }

  async function handleSignIn() {
    setBusyAuth(true);
    setMessage("Opening browser for Google sign-in...");
    try {
      const result = await googleAuthSignIn();
      if (result.state === "signed_in") {
        setAuth(result.status);
        setManualAuthVisible(false);
        setManualAuthChallenge(null);
        setManualAuthInput("");
        setManualAuthError("");
        setMessage(`Signed in${result.status.email ? ` as ${result.status.email}` : ""}`);
      } else {
        setManualAuthVisible(true);
        setManualAuthReason(result.message);
        setMessage("Automatic callback did not finish. Use manual sign-in fallback.");
        await handleBeginManualAuth(true);
      }
    } catch (error) {
      setMessage(`Google sign-in failed: ${String(error)}`);
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
      setMessage("Signed out from Google");
    } catch (error) {
      setMessage(`Sign-out failed: ${String(error)}`);
    } finally {
      setBusyAuth(false);
    }
  }

  async function handleBeginManualAuth(openImmediately: boolean) {
    setManualAuthBusy(true);
    setManualAuthError("");
    try {
      const challenge = await googleAuthBeginManual();
      setManualAuthChallenge(challenge);
      setManualAuthVisible(true);
      if (openImmediately) {
        await openUrl(challenge.authorizeUrl);
      }
      setMessage("Manual sign-in challenge ready");
    } catch (error) {
      setManualAuthError(String(error));
      setMessage(`Failed to start manual sign-in: ${String(error)}`);
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
    }
  }

  async function handleCompleteManualAuth() {
    if (!manualAuthChallenge) {
      setManualAuthError("Generate a manual challenge first.");
      return;
    }

    if (!manualAuthInput.trim()) {
      setManualAuthError("Paste callback URL or authorization code.");
      return;
    }

    setManualAuthBusy(true);
    setManualAuthError("");
    try {
      const status = await googleAuthCompleteManual({
        sessionId: manualAuthChallenge.sessionId,
        callbackUrlOrCode: manualAuthInput.trim(),
      });
      setAuth(status);
      setManualAuthVisible(false);
      setManualAuthChallenge(null);
      setManualAuthInput("");
      setMessage(`Signed in${status.email ? ` as ${status.email}` : ""}`);
    } catch (error) {
      setManualAuthError(String(error));
      setMessage(`Manual sign-in failed: ${String(error)}`);
    } finally {
      setManualAuthBusy(false);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      const payload: RuntimeSettingsUpdate = {
        tesseractPath: settings.tesseractPath,
        maxConcurrentRequests: settings.maxConcurrentRequests,
        spreadsheetBatchSize: settings.spreadsheetBatchSize,
        maxRetries: settings.maxRetries,
        retryDelaySeconds: settings.retryDelaySeconds,
        jobRetentionHours: settings.jobRetentionHours,
      };
      const saved = await saveSettings(payload);
      setSettings(saved);
      setMessage("Settings saved");
    } catch (error) {
      setMessage(`Settings save failed: ${String(error)}`);
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>SourceStack Desktop</h1>
          <p>Local resume parsing with Google Drive and Sheets sync</p>
        </div>
        <div className="topbar-status">
          <span className={`chip ${auth.signedIn ? "chip-ok" : "chip-muted"}`}>
            {auth.signedIn
              ? `Google: ${auth.email ?? "Signed In"}`
              : "Google: Signed Out"}
          </span>
          <span className="chip chip-muted">{progressText}</span>
        </div>
      </header>

      <aside className="sidebar">
        <button
          className={tab === "dashboard" ? "nav active" : "nav"}
          onClick={() => setTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={tab === "jobs" ? "nav active" : "nav"}
          onClick={() => setTab("jobs")}
        >
          Jobs
        </button>
        <button
          className={tab === "settings" ? "nav active" : "nav"}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>

        <div className="sidebar-footer">
          <button
            className="secondary"
            disabled={busyAuth}
            onClick={auth.signedIn ? handleSignOut : handleSignIn}
          >
            {busyAuth
              ? "Working..."
              : auth.signedIn
                ? "Sign Out Google"
                : "Sign In Google"}
          </button>
          <button className="secondary" onClick={() => void refreshJobs()}>
            {loadingJobs ? "Refreshing..." : "Refresh Jobs"}
          </button>
        </div>
      </aside>

      <main className="content">
        {manualAuthVisible && (
          <section className="card auth-card">
            <h2>Manual Google Sign-In</h2>
            <p>
              {manualAuthReason ||
                "Use this fallback when automatic browser callback cannot complete."}
            </p>

            <div className="auth-actions">
              <button
                className="secondary"
                disabled={manualAuthBusy}
                onClick={() => void handleBeginManualAuth(false)}
              >
                {manualAuthBusy ? "Preparing..." : "Generate Challenge"}
              </button>
              <button
                className="primary"
                disabled={!manualAuthChallenge || manualAuthBusy}
                onClick={() => void handleOpenManualAuthUrl()}
              >
                Open Google Consent
              </button>
            </div>

            {manualAuthChallenge && (
              <div className="auth-meta">
                <ResultRow label="Session ID" value={manualAuthChallenge.sessionId} />
                <ResultRow label="Redirect URI" value={manualAuthChallenge.redirectUri} />
                <ResultRow
                  label="Expires"
                  value={formatDateTime(manualAuthChallenge.expiresAt)}
                />
              </div>
            )}

            <label className="field">
              <span>Callback URL or Authorization Code</span>
              <input
                value={manualAuthInput}
                onChange={(event) => setManualAuthInput(event.target.value)}
                placeholder="Paste callback URL from browser or code"
              />
            </label>

            {manualAuthError && <p className="alert-error">{manualAuthError}</p>}

            <div className="auth-actions">
              <button
                className="primary"
                disabled={manualAuthBusy}
                onClick={() => void handleCompleteManualAuth()}
              >
                {manualAuthBusy ? "Verifying..." : "Complete Manual Sign-In"}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setManualAuthVisible(false);
                  setManualAuthError("");
                }}
              >
                Close
              </button>
            </div>
          </section>
        )}

        {tab === "dashboard" && (
          <section className="grid-two">
            <article className="card">
              <h2>Local Resume Parse</h2>
              <p>Upload one PDF/DOCX and parse on-device.</p>

              <label className="field">
                <span>Resume File</span>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={(event) =>
                    setSelectedFile(event.target.files?.[0] ?? null)
                  }
                />
              </label>

              <button
                className="primary"
                disabled={parseLoading}
                onClick={() => void handleParseSingle()}
              >
                {parseLoading ? "Parsing..." : "Parse Resume"}
              </button>

              {parseResult && (
                <div className="result-grid">
                  <ResultRow label="Name" value={parseResult.name} />
                  <ResultRow label="Email" value={parseResult.email} />
                  <ResultRow label="Phone" value={parseResult.phone} />
                  <ResultRow label="LinkedIn" value={parseResult.linkedIn} />
                  <ResultRow label="GitHub" value={parseResult.gitHub} />
                  <ResultRow
                    label="Confidence"
                    value={parseResult.confidence.toFixed(2)}
                  />
                  <ResultRow
                    label="Errors"
                    value={
                      parseResult.errors.length > 0
                        ? parseResult.errors.join("; ")
                        : "-"
                    }
                  />
                </div>
              )}
            </article>

            <article className="card">
              <h2>Drive Batch Parse</h2>
              <p>Run an async local job against a Google Drive folder.</p>

              <label className="field">
                <span>Drive Folder ID</span>
                <input
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  placeholder="Folder ID"
                />
              </label>

              <label className="field">
                <span>Spreadsheet ID (optional)</span>
                <input
                  value={spreadsheetId}
                  onChange={(e) => setSpreadsheetId(e.target.value)}
                  placeholder="Existing sheet ID"
                />
              </label>

              <div className="button-row">
                <button
                  className="primary"
                  onClick={() => void handleStartBatchJob()}
                >
                  Start Batch Job
                </button>
                <button
                  className="secondary"
                  disabled={!activeJobId}
                  onClick={() =>
                    activeJobId ? void refreshStatus(activeJobId, true) : undefined
                  }
                >
                  Refresh Status
                </button>
              </div>

              {activeJobId && (
                <div className="job-box">
                  <p>
                    <strong>Active Job:</strong> {activeJobId}
                  </p>
                  <p>
                    <strong>Status:</strong> {jobStatus?.status ?? "-"}
                  </p>
                  <p>
                    <strong>Progress:</strong> {jobStatus?.progress ?? 0}%
                  </p>
                  <button
                    className="danger"
                    onClick={() => void handleCancelActiveJob()}
                  >
                    Cancel Active Job
                  </button>
                </div>
              )}
            </article>
          </section>
        )}

        {tab === "jobs" && (
          <section className="card jobs-card">
            <h2>Jobs</h2>
            <p>Inspect local persisted jobs and results.</p>

            <div className="jobs-layout">
              <div className="jobs-list">
                {jobs.length === 0 && <p>No jobs yet.</p>}
                {jobs.map((jobId) => (
                  <button
                    key={jobId}
                    className="job-item"
                    onClick={() => void refreshStatus(jobId, false)}
                  >
                    {jobId}
                  </button>
                ))}
              </div>

              <div className="jobs-details">
                {jobStatus ? (
                  <>
                    <h3>Job Status</h3>
                    <ResultRow label="Job ID" value={jobStatus.jobId} />
                    <ResultRow label="State" value={jobStatus.status} />
                    <ResultRow
                      label="Progress"
                      value={`${jobStatus.progress}% (${jobStatus.processedFiles}/${jobStatus.totalFiles})`}
                    />
                    <ResultRow label="Spreadsheet" value={jobStatus.spreadsheetId} />
                    <ResultRow
                      label="Created"
                      value={formatDateTime(jobStatus.createdAt)}
                    />
                    <ResultRow
                      label="Started"
                      value={formatDateTime(jobStatus.startedAt)}
                    />
                    <ResultRow
                      label="Completed"
                      value={formatDateTime(jobStatus.completedAt)}
                    />
                    <ResultRow label="Error" value={jobStatus.error} />
                  </>
                ) : (
                  <p>Select a job to view status.</p>
                )}
              </div>
            </div>

            {jobResults.length > 0 && (
              <div className="results-table-wrap">
                <h3>Results ({jobResults.length})</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>LinkedIn</th>
                      <th>GitHub</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobResults.map((candidate, idx) => (
                      <tr key={`${candidate.sourceFile ?? "candidate"}-${idx}`}>
                        <td>{candidate.name ?? "-"}</td>
                        <td>{candidate.email ?? "-"}</td>
                        <td>{candidate.phone ?? "-"}</td>
                        <td>{candidate.linkedIn ?? "-"}</td>
                        <td>{candidate.gitHub ?? "-"}</td>
                        <td>{candidate.confidence.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "settings" && (
          <section className="card settings-card">
            <h2>Settings</h2>
            <p>Runtime tuning. Google OAuth is managed by this app build.</p>

            <div className="notice notice-info">
              End users only use Sign In / Sign Out. OAuth client credentials are
              bundled by Dipesh from engineering team.
            </div>

            {!settings.googleClientId.trim() && (
              <div className="notice notice-warning">
                This build is missing OAuth client configuration
                (`SOURCESTACK_GOOGLE_CLIENT_ID`).
              </div>
            )}

            <div className="settings-grid">
              <div className="field">
                <span>OAuth Secret Status</span>
                <div className="secret-pill">
                  {settings.googleClientSecretConfigured
                    ? "Configured"
                    : "Not configured (only needed for clients that require secret)"}
                </div>
              </div>

              <label className="field">
                <span>Tesseract Path</span>
                <input
                  value={settings.tesseractPath}
                  onChange={(e) =>
                    setSettings({ ...settings, tesseractPath: e.target.value })
                  }
                />
              </label>

              <label className="field">
                <span>Max Concurrency</span>
                <input
                  type="number"
                  min={1}
                  value={settings.maxConcurrentRequests}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxConcurrentRequests: Number(e.target.value || "1"),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Spreadsheet Batch Size</span>
                <input
                  type="number"
                  min={1}
                  value={settings.spreadsheetBatchSize}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      spreadsheetBatchSize: Number(e.target.value || "1"),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Max Retries</span>
                <input
                  type="number"
                  min={1}
                  value={settings.maxRetries}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxRetries: Number(e.target.value || "1"),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Retry Delay (seconds)</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={settings.retryDelaySeconds}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      retryDelaySeconds: Number(e.target.value || "0.1"),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Job Retention (hours)</span>
                <input
                  type="number"
                  min={1}
                  value={settings.jobRetentionHours}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      jobRetentionHours: Number(e.target.value || "1"),
                    })
                  }
                />
              </label>
            </div>

            <button
              className="primary"
              disabled={savingSettings}
              onClick={() => void handleSaveSettings()}
            >
              {savingSettings ? "Saving..." : "Save Settings"}
            </button>
          </section>
        )}
      </main>

      <footer className="statusbar">{message}</footer>
    </div>
  );
}

function ResultRow({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="result-row">
      <span>{label}</span>
      <strong>
        {value !== undefined && value !== null && value !== "" ? String(value) : "-"}
      </strong>
    </div>
  );
}

export default App;
