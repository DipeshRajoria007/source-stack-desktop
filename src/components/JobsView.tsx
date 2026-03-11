import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  ExternalLink,
  Search,
} from "lucide-react";

import type { JobStatus, ParsedCandidate } from "../lib/types";
import {
  confidenceToPercent,
  formatDateTime,
  formatDurationSeconds,
  getJobTimestampLabel,
  truncateMiddle,
} from "../lib/utils";

interface JobListItem {
  sortTimestamp: number;
  status: JobStatus;
}

interface JobsViewProps {
  jobs: JobListItem[];
  jobsLoading: boolean;
  onOpenDriveFile: (fileId: string) => void;
  onOpenSpreadsheet: (spreadsheetId: string) => void;
  onSelectJob: (jobId: string) => void;
  selectedJobId: string | null;
  selectedJobResults: ParsedCandidate[];
  selectedJobResultsError: string | null;
  selectedJobResultsLoading: boolean;
}

type SortColumn =
  | "name"
  | "resume"
  | "phone"
  | "email"
  | "linkedIn"
  | "gitHub"
  | "confidence";

export function JobsView({
  jobs,
  jobsLoading,
  onOpenDriveFile,
  onOpenSpreadsheet,
  onSelectJob,
  selectedJobId,
  selectedJobResults,
  selectedJobResultsError,
  selectedJobResultsLoading,
}: JobsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>("confidence");
  const [sortAscending, setSortAscending] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const nextJobs = [...jobs].sort((left, right) => right.sortTimestamp - left.sortTimestamp);

    if (!query) {
      return nextJobs;
    }

    return nextJobs.filter((item) => {
      const timestamp = getJobTimestampLabel(item.status).toLowerCase();
      return (
        item.status.jobId.toLowerCase().includes(query) ||
        item.status.status.toLowerCase().includes(query) ||
        timestamp.includes(query)
      );
    });
  }, [jobs, searchQuery]);

  const selectedJobStatus =
    jobs.find((item) => item.status.jobId === selectedJobId)?.status ?? null;

  const sortedResults = useMemo(() => {
    return [...selectedJobResults].sort((left, right) => {
      const direction = sortAscending ? 1 : -1;
      if (sortColumn === "confidence") {
        return (left.confidence - right.confidence) * direction;
      }

      const leftValue = readResultColumn(left, sortColumn);
      const rightValue = readResultColumn(right, sortColumn);
      return leftValue.localeCompare(rightValue) * direction;
    });
  }, [selectedJobResults, sortAscending, sortColumn]);

  const stats = selectedJobStatus
    ? [
        { label: "Total Files", value: selectedJobStatus.totalFiles, tone: "#94a3b8" },
        { label: "Processed", value: selectedJobStatus.processedFiles, tone: "var(--app-primary)" },
        {
          label: "Results",
          value: selectedJobStatus.resultsCount ?? selectedJobResults.length,
          tone: "var(--app-success)",
        },
        {
          label: "Remaining",
          value: Math.max(selectedJobStatus.totalFiles - selectedJobStatus.processedFiles, 0),
          tone: "#64748b",
        },
      ]
    : [];

  return (
    <div className="flex h-full gap-px bg-white/4">
      <div className="flex w-[300px] shrink-0 flex-col overflow-hidden bg-[var(--app-bg)]">
        <div className="px-3 pb-2 pt-3">
          <h2 className="text-base font-semibold text-[var(--app-foreground)]">Jobs</h2>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-subtle)]" size={13} />
            <input
              className="surface-muted h-8 w-full rounded-md pl-8 pr-3 text-xs text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-subtle)]"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter jobs..."
              value={searchQuery}
            />
          </div>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {jobsLoading && jobs.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--app-muted)]">Loading jobs…</div>
          ) : filteredJobs.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--app-muted)]">No jobs found.</div>
          ) : (
            filteredJobs.map((item) => {
              const active = item.status.jobId === selectedJobId;

              return (
                <button
                  className="w-full px-3 py-2.5 text-left transition-colors"
                  key={item.status.jobId}
                  onClick={() => onSelectJob(item.status.jobId)}
                  style={{
                    backgroundColor: active ? "rgba(45,212,191,0.06)" : "transparent",
                    borderLeft: active
                      ? "2px solid var(--app-primary)"
                      : "2px solid transparent",
                  }}
                  type="button"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span
                      className="truncate font-mono text-xs text-[var(--app-foreground)]"
                      title={item.status.jobId}
                    >
                      {truncateMiddle(item.status.jobId, 18)}
                    </span>
                    <JobStatusPill status={item.status.status} />
                  </div>
                  <div className="text-[11px] text-[var(--app-muted)]">
                    {getJobTimestampLabel(item.status)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-bg)] p-4">
        {!selectedJobStatus ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--app-subtle)]">
            Select a job to view details.
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate font-mono text-sm text-[var(--app-foreground)]">
                  {selectedJobStatus.jobId}
                </span>
                <JobStatusPill status={selectedJobStatus.status} />
              </div>

              {selectedJobStatus.spreadsheetId && (
                <button
                  className="flex h-8 items-center gap-1 rounded-md bg-[var(--app-primary)] px-3 text-xs font-semibold text-[var(--app-bg)]"
                  onClick={() => onOpenSpreadsheet(selectedJobStatus.spreadsheetId ?? "")}
                  type="button"
                >
                  <ExternalLink size={12} />
                  Open Sheet
                </button>
              )}
            </div>

            <div className="mb-3 flex flex-wrap gap-4 text-xs">
              <Metadata label="Created" value={formatDateTime(selectedJobStatus.createdAt)} />
              <Metadata label="Started" value={formatDateTime(selectedJobStatus.startedAt)} />
              <Metadata label="Completed" value={formatDateTime(selectedJobStatus.completedAt)} />
              <Metadata
                label="Duration"
                value={formatDurationSeconds(selectedJobStatus.durationSeconds)}
              />
            </div>

            <div className="mb-3 grid grid-cols-4 gap-2">
              {stats.map((stat) => (
                <div
                  className="panel-surface rounded-md px-3 py-2"
                  key={stat.label}
                >
                  <div
                    className="font-mono text-xl font-semibold"
                    style={{ color: stat.tone }}
                  >
                    {stat.value}
                  </div>
                  <div className="text-[11px] text-[var(--app-subtle)]">{stat.label}</div>
                </div>
              ))}
            </div>

            {selectedJobStatus.error && (
              <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-300">
                {selectedJobStatus.error}
              </div>
            )}

            <div className="panel-surface min-h-0 flex-1 overflow-hidden rounded-md">
              {selectedJobResultsLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-[var(--app-muted)]">
                  Loading results…
                </div>
              ) : selectedJobResultsError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-300">
                  {selectedJobResultsError}
                </div>
              ) : sortedResults.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-[var(--app-muted)]">
                  No parsed results recorded for this job.
                </div>
              ) : (
                <div className="scrollbar-thin h-full overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-[var(--app-panel)]">
                      <tr className="border-b border-white/6">
                        <th className="px-3 py-2 text-left text-[11px] font-medium text-[var(--app-subtle)]">
                          #
                        </th>
                        {[
                          ["name", "Name"],
                          ["resume", "Resume Link"],
                          ["phone", "Phone Number"],
                          ["email", "Email ID"],
                          ["linkedIn", "LinkedIn"],
                          ["gitHub", "GitHub"],
                          ["confidence", "Confidence"],
                        ].map(([column, label]) => (
                          <th
                            className="px-3 py-2 text-left text-[11px] font-medium text-[var(--app-subtle)]"
                            key={column}
                          >
                            <button
                              className="flex items-center gap-1 transition-colors hover:text-[var(--app-foreground)]"
                              onClick={() => toggleSort(column as SortColumn)}
                              type="button"
                            >
                              {label}
                              <ArrowUpDown size={10} />
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((result, index) => {
                        const rowKey =
                          result.driveFileId ?? result.sourceFile ?? `${index}-${result.email ?? "result"}`;
                        const expanded = expandedRows[rowKey] ?? false;
                        const percent = confidenceToPercent(result.confidence);
                        const confidenceColor =
                          percent >= 80
                            ? "var(--app-success)"
                            : percent >= 50
                              ? "var(--app-warning)"
                              : "var(--app-danger)";

                        return (
                          <Fragment key={rowKey}>
                            <tr
                              className="border-b border-white/4"
                              style={{
                                backgroundColor:
                                  result.errors.length > 0
                                    ? "rgba(245,158,11,0.05)"
                                    : "transparent",
                              }}
                            >
                              <td className="px-3 py-2 font-mono text-[var(--app-muted)]">
                                {index + 1}
                              </td>
                              <td className="px-3 py-2 text-[var(--app-foreground)]">
                                <div className="flex items-center gap-2">
                                  <span>{result.name ?? "—"}</span>
                                  {result.errors.length > 0 && (
                                    <button
                                      className="flex items-center gap-1 text-[11px] text-amber-300"
                                      onClick={() =>
                                        setExpandedRows((current) => ({
                                          ...current,
                                          [rowKey]: !current[rowKey],
                                        }))
                                      }
                                      type="button"
                                    >
                                      <AlertTriangle size={12} />
                                      {expanded ? "Hide issue" : "Show issue"}
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {result.driveFileId ? (
                                  <button
                                    className="flex items-center gap-1 text-[var(--app-primary)] transition-colors hover:text-teal-200"
                                    onClick={() => onOpenDriveFile(result.driveFileId ?? "")}
                                    type="button"
                                  >
                                    <ExternalLink size={12} />
                                    Open
                                  </button>
                                ) : (
                                  <span className="font-mono text-[11px] text-[var(--app-muted)]">
                                    {truncateMiddle(result.sourceFile, 24)}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--app-foreground)]">
                                {result.phone ?? "—"}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--app-foreground)]">
                                {result.email ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-[var(--app-muted)]">
                                {result.linkedIn ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-[var(--app-muted)]">
                                {result.gitHub ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[#1a1f2e]">
                                    <div
                                      className="h-full rounded-full"
                                      style={{
                                        backgroundColor: confidenceColor,
                                        width: `${percent}%`,
                                      }}
                                    />
                                  </div>
                                  <span
                                    className="font-mono text-[11px]"
                                    style={{ color: confidenceColor }}
                                  >
                                    {percent}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="border-b border-white/4">
                                <td className="px-3 py-2" colSpan={8}>
                                  <div className="rounded-md border border-amber-400/18 bg-amber-400/8 px-3 py-2 text-[11px] text-amber-200">
                                    {result.errors.join("; ")}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortAscending((value) => !value);
      return;
    }

    setSortColumn(column);
    setSortAscending(column === "name");
  }
}

function Metadata({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span className="text-[var(--app-subtle)]">{label}: </span>
      <span className="font-mono text-[var(--app-foreground)]">{value}</span>
    </div>
  );
}

function JobStatusPill({
  status,
}: {
  status: JobStatus["status"];
}) {
  const tone =
    status === "completed"
      ? { background: "rgba(34,197,94,0.12)", color: "var(--app-success)" }
      : status === "failed"
        ? { background: "rgba(239,68,68,0.12)", color: "var(--app-danger)" }
        : status === "processing"
          ? { background: "rgba(45,212,191,0.12)", color: "var(--app-primary)" }
          : { background: "rgba(100,116,139,0.12)", color: "#94a3b8" };

  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: tone.background, color: tone.color }}
    >
      {status}
    </span>
  );
}

function readResultColumn(result: ParsedCandidate, column: SortColumn): string {
  switch (column) {
    case "resume":
      return result.sourceFile ?? result.driveFileId ?? "";
    case "phone":
      return result.phone ?? "";
    case "email":
      return result.email ?? "";
    case "linkedIn":
      return result.linkedIn ?? "";
    case "gitHub":
      return result.gitHub ?? "";
    case "name":
      return result.name ?? "";
    default:
      return String(result.confidence);
  }
}
