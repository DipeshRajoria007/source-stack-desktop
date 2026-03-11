import {
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";

import type { RuntimeSettingsView } from "../lib/types";
import {
  fromRetentionDays,
  fromRetryDelayMilliseconds,
  toRetentionDays,
  toRetryDelayMilliseconds,
} from "../lib/utils";

interface SettingsViewProps {
  onChange: (patch: Partial<RuntimeSettingsView>) => void;
  onSave: () => void;
  saving: boolean;
  settings: RuntimeSettingsView;
}

export function SettingsView({
  onChange,
  onSave,
  saving,
  settings,
}: SettingsViewProps) {
  const oauthConfigured = Boolean(settings.googleClientId.trim());
  const retentionDays = toRetentionDays(settings.jobRetentionHours);
  const retryDelayMilliseconds = toRetryDelayMilliseconds(settings.retryDelaySeconds);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-[640px] px-4 py-6">
        <h2 className="text-xl font-semibold text-[var(--app-foreground)]">Settings</h2>
        <p className="mt-1 text-sm text-[var(--app-muted)]">
          Runtime tuning for parsing throughput, OCR fallback, and local retention.
        </p>

        <Section title="Google OAuth">
          <div className="mb-3 flex items-center gap-2">
            {oauthConfigured ? (
              <CheckCircle2 className="text-[var(--app-success)]" size={16} />
            ) : (
              <AlertTriangle className="text-[var(--app-warning)]" size={16} />
            )}
            <span
              className="text-sm font-medium"
              style={{
                color: oauthConfigured ? "var(--app-success)" : "var(--app-warning)",
              }}
            >
              {oauthConfigured ? "OAuth configured" : "OAuth not configured"}
            </span>
          </div>

          {!oauthConfigured && (
            <WarningNotice>
              This build is missing a Google OAuth client ID. Drive browsing and Sheets
              export will stay unavailable until engineering ships a configured build.
            </WarningNotice>
          )}

          <InfoNotice>
            End users only use Sign In / Sign Out. OAuth tokens are stored in the OS
            keychain, and any client secret handling remains outside this UI.
          </InfoNotice>
        </Section>

        <Section title="Parsing Engine">
          <FieldLabel>Tesseract Path</FieldLabel>
          <input
            className="surface-muted h-9 w-full rounded-md px-3 font-mono text-xs text-[var(--app-foreground)] outline-none"
            onChange={(event) => onChange({ tesseractPath: event.target.value })}
            value={settings.tesseractPath}
          />
          <p className="mt-2 text-[11px] text-[var(--app-subtle)]">
            Used as OCR fallback for scanned PDFs. Text extraction is attempted first.
          </p>
          {!settings.tesseractPath.trim() && (
            <div className="mt-3">
              <WarningNotice>
                Tesseract path is empty. OCR fallback will fail for scanned PDFs until a
                valid executable path is configured.
              </WarningNotice>
            </div>
          )}
        </Section>

        <Section title="Performance Tuning">
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              label="Max Concurrency"
              onChange={(value) => onChange({ maxConcurrentRequests: value })}
              tooltip="Controls how many files are parsed concurrently."
              value={settings.maxConcurrentRequests}
            />
            <NumberField
              label="Spreadsheet Batch Size"
              onChange={(value) => onChange({ spreadsheetBatchSize: value })}
              tooltip="Rows written to Google Sheets per API call."
              value={settings.spreadsheetBatchSize}
            />
            <NumberField
              label="Max Retries"
              onChange={(value) => onChange({ maxRetries: value })}
              value={settings.maxRetries}
            />
            <NumberField
              label="Retry Delay"
              onChange={(value) =>
                onChange({ retryDelaySeconds: fromRetryDelayMilliseconds(value) })
              }
              suffix="ms"
              value={retryDelayMilliseconds}
            />
          </div>
        </Section>

        <Section title="Data Retention">
          <NumberField
            label="Job Retention"
            onChange={(value) => onChange({ jobRetentionHours: fromRetentionDays(value) })}
            suffix="days"
            value={retentionDays}
          />
          <p className="mt-2 text-[11px] text-[var(--app-subtle)]">
            Completed jobs older than this are automatically cleaned up.
          </p>
        </Section>

        <button
          className="mt-2 h-9 rounded-md bg-[var(--app-primary)] px-6 text-sm font-semibold text-[var(--app-bg)] transition-opacity disabled:opacity-50"
          disabled={saving}
          onClick={onSave}
          type="button"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>

        <div className="mt-6">
          <InfoNotice>
            Settings are stored locally on this device. OAuth tokens are stored in the OS
            keychain and are never surfaced back into this form.
          </InfoNotice>
        </div>
      </div>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="mb-6 border-b border-white/6 pb-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FieldLabel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-[var(--app-foreground)]">
      {children}
    </label>
  );
}

function NumberField({
  label,
  onChange,
  suffix,
  tooltip,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  suffix?: string;
  tooltip?: string;
  value: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <FieldLabel>{label}</FieldLabel>
        {tooltip && (
          <span className="cursor-help text-[var(--app-subtle)]" title={tooltip}>
            <Info size={12} />
          </span>
        )}
      </div>
      <div className="relative">
        <input
          className="surface-muted h-9 w-full rounded-md px-3 font-mono text-xs text-[var(--app-foreground)] outline-none"
          min={1}
          onChange={(event) => onChange(Number(event.target.value || "1"))}
          step={suffix === "ms" ? 100 : 1}
          type="number"
          value={value}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--app-subtle)]">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function InfoNotice({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-blue-500/14 bg-blue-500/8 px-3 py-2.5 text-xs text-blue-100">
      <div className="flex gap-2">
        <Info className="mt-0.5 shrink-0 text-blue-300" size={14} />
        <p>{children}</p>
      </div>
    </div>
  );
}

function WarningNotice({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-amber-400/18 bg-amber-400/8 px-3 py-2.5 text-xs text-amber-200">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={14} />
        <p>{children}</p>
      </div>
    </div>
  );
}
