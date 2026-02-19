import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  cancelJob,
  getJobResults,
  getJobStatus,
  getSettings,
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
  ParsedCandidate,
  RuntimeSettings,
} from "./lib/types";
import { arrayBufferToBase64, formatDateTime } from "./lib/utils";

type TabKey = "dashboard" | "jobs" | "settings";

const defaultSettings: RuntimeSettings = {
  googleClientId: "",
  googleClientSecret: "",
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

  const [settings, setSettings] = useState<RuntimeSettings>(defaultSettings);
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
      setMessage("Workspace ready");
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
      setMessage(`Batch start failed: ${String(error)}`);
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
      const status = await googleAuthSignIn();
      setAuth(status);
      setMessage(`Signed in${status.email ? ` as ${status.email}` : ""}`);
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
      setMessage("Signed out from Google");
    } catch (error) {
      setMessage(`Sign-out failed: ${String(error)}`);
    } finally {
      setBusyAuth(false);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      const saved = await saveSettings(settings);
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
            {auth.signedIn ? `Google: ${auth.email ?? "Signed In"}` : "Google: Signed Out"}
          </span>
          <span className="chip chip-muted">{progressText}</span>
        </div>
      </header>

      <aside className="sidebar">
        <button className={tab === "dashboard" ? "nav active" : "nav"} onClick={() => setTab("dashboard")}>
          Dashboard
        </button>
        <button className={tab === "jobs" ? "nav active" : "nav"} onClick={() => setTab("jobs")}>
          Jobs
        </button>
        <button className={tab === "settings" ? "nav active" : "nav"} onClick={() => setTab("settings")}>
          Settings
        </button>

        <div className="sidebar-footer">
          <button className="secondary" disabled={busyAuth} onClick={auth.signedIn ? handleSignOut : handleSignIn}>
            {busyAuth ? "Working..." : auth.signedIn ? "Sign Out Google" : "Sign In Google"}
          </button>
          <button className="secondary" onClick={() => void refreshJobs()}>
            {loadingJobs ? "Refreshing..." : "Refresh Jobs"}
          </button>
        </div>
      </aside>

      <main className="content">
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
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
              </label>

              <button className="primary" disabled={parseLoading} onClick={() => void handleParseSingle()}>
                {parseLoading ? "Parsing..." : "Parse Resume"}
              </button>

              {parseResult && (
                <div className="result-grid">
                  <ResultRow label="Name" value={parseResult.name} />
                  <ResultRow label="Email" value={parseResult.email} />
                  <ResultRow label="Phone" value={parseResult.phone} />
                  <ResultRow label="LinkedIn" value={parseResult.linkedIn} />
                  <ResultRow label="GitHub" value={parseResult.gitHub} />
                  <ResultRow label="Confidence" value={parseResult.confidence.toFixed(2)} />
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
                <input value={folderId} onChange={(e) => setFolderId(e.target.value)} placeholder="Folder ID" />
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
                <button className="primary" onClick={() => void handleStartBatchJob()}>
                  Start Batch Job
                </button>
                <button
                  className="secondary"
                  disabled={!activeJobId}
                  onClick={() => (activeJobId ? void refreshStatus(activeJobId, true) : undefined)}
                >
                  Refresh Status
                </button>
              </div>

              {activeJobId && (
                <div className="job-box">
                  <p><strong>Active Job:</strong> {activeJobId}</p>
                  <p><strong>Status:</strong> {jobStatus?.status ?? "-"}</p>
                  <p><strong>Progress:</strong> {jobStatus?.progress ?? 0}%</p>
                  <button className="danger" onClick={() => void handleCancelActiveJob()}>
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
                  <button key={jobId} className="job-item" onClick={() => void refreshStatus(jobId, false)}>
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
                    <ResultRow label="Created" value={formatDateTime(jobStatus.createdAt)} />
                    <ResultRow label="Started" value={formatDateTime(jobStatus.startedAt)} />
                    <ResultRow label="Completed" value={formatDateTime(jobStatus.completedAt)} />
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
            <p>Google OAuth and local runtime tuning.</p>

            <div className="settings-grid">
              <label className="field">
                <span>Google Client ID</span>
                <input
                  value={settings.googleClientId}
                  onChange={(e) => setSettings({ ...settings, googleClientId: e.target.value })}
                />
              </label>

              <label className="field">
                <span>Google Client Secret</span>
                <input
                  value={settings.googleClientSecret}
                  onChange={(e) => setSettings({ ...settings, googleClientSecret: e.target.value })}
                />
              </label>

              <label className="field">
                <span>Tesseract Path</span>
                <input
                  value={settings.tesseractPath}
                  onChange={(e) => setSettings({ ...settings, tesseractPath: e.target.value })}
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

            <button className="primary" disabled={savingSettings} onClick={() => void handleSaveSettings()}>
              {savingSettings ? "Saving..." : "Save Settings"}
            </button>
          </section>
        )}
      </main>

      <footer className="statusbar">{message}</footer>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="result-row">
      <span>{label}</span>
      <strong>{value !== undefined && value !== null && value !== "" ? String(value) : "-"}</strong>
    </div>
  );
}

export default App;
