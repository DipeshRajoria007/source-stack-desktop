import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CircleUserRound,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  LogIn,
  LogOut,
  RefreshCw,
  Settings,
} from "lucide-react";

import type { AuthStatus } from "../lib/types";
import { formatDateTime, truncateMiddle } from "../lib/utils";

export type AppView = "dashboard" | "jobs" | "settings";
export type StatusTone = "neutral" | "info" | "success" | "error";

interface AppShellProps {
  activeView: AppView;
  auth: AuthStatus;
  authBusy: boolean;
  centerLabel: string;
  children: ReactNode;
  onManualSignIn: () => void;
  onNavigate: (view: AppView) => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  refreshing: boolean;
  statusText: string;
  statusTone: StatusTone;
}

const navItems: Array<{
  icon: typeof LayoutDashboard;
  id: AppView;
  label: string;
}> = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "jobs", icon: ListTodo, label: "Jobs" },
  { id: "settings", icon: Settings, label: "Settings" },
];

export function AppShell({
  activeView,
  auth,
  authBusy,
  centerLabel,
  children,
  onManualSignIn,
  onNavigate,
  onOpenSettings,
  onRefresh,
  onSignIn,
  onSignOut,
  refreshing,
  statusText,
  statusTone,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--app-bg)]">
      <header className="flex h-12 items-center justify-between border-b border-white/6 bg-[var(--app-panel-strong)] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--app-primary)] text-[11px] font-bold text-[var(--app-bg)]">
            S
          </div>
          <span className="text-sm font-semibold text-[var(--app-foreground)]">
            SourceStack
          </span>
          <span className="text-xs text-[var(--app-subtle)]">Desktop · v0.1</span>
        </div>

        <div className="min-w-0 flex-1 px-6 text-center text-xs font-medium text-[var(--app-subtle)]">
          <span className="font-mono">{centerLabel}</span>
        </div>

        <AccountChip
          auth={auth}
          busy={authBusy || refreshing}
          onManualSignIn={onManualSignIn}
          onOpenSettings={onOpenSettings}
          onRefresh={onRefresh}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
        />
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-white/6 bg-[var(--app-panel-strong)] py-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;

            return (
              <button
                key={item.id}
                aria-label={item.label}
                className="group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors"
                onClick={() => onNavigate(item.id)}
                style={{
                  backgroundColor: active ? "rgba(45,212,191,0.1)" : "transparent",
                  color: active ? "var(--app-primary)" : "var(--app-muted)",
                }}
                title={item.label}
                type="button"
              >
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-[var(--app-primary)]" />
                )}
                <Icon size={18} />
              </button>
            );
          })}

          <div className="mt-auto border-t border-white/6 pt-2">
            <button
              aria-label="Refresh workspace"
              className="flex h-10 w-10 items-center justify-center rounded-md text-[var(--app-muted)] transition-colors hover:text-[var(--app-foreground)]"
              disabled={refreshing}
              onClick={onRefresh}
              title="Refresh workspace"
              type="button"
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
            </button>
          </div>
        </aside>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <footer className="flex h-7 items-center border-t border-white/6 bg-[var(--app-panel-strong)] px-4 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: toneColor(statusTone) }}
          />
          <span className="text-[var(--app-muted)]">{statusText}</span>
        </div>
      </footer>
    </div>
  );
}

interface AccountChipProps {
  auth: AuthStatus;
  busy: boolean;
  onManualSignIn: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

function AccountChip({
  auth,
  busy,
  onManualSignIn,
  onOpenSettings,
  onRefresh,
  onSignIn,
  onSignOut,
}: AccountChipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initials = useMemo(() => {
    const source = auth.name?.trim() || auth.email?.trim() || "SS";
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2);
  }, [auth.email, auth.name]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        className="flex h-8 items-center gap-2 rounded-full border border-white/8 bg-white/3 px-2.5 transition-colors hover:border-white/14 hover:bg-white/6"
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor: auth.signedIn ? "var(--app-success)" : "var(--app-subtle)",
          }}
        />
        <span className="max-w-[180px] truncate text-xs text-[var(--app-foreground)]">
          {auth.signedIn ? truncateMiddle(auth.email ?? auth.name ?? "Signed in") : "Not signed in"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[color:rgba(13,17,23,0.98)] shadow-[0_20px_40px_rgba(0,0,0,0.38)] backdrop-blur">
          <div className="flex items-center gap-3 border-b border-white/6 px-4 py-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--app-primary-soft)] text-sm font-semibold text-[var(--app-primary)]">
              {auth.picture ? (
                <img
                  alt={auth.email ?? "Account"}
                  className="h-full w-full rounded-full object-cover"
                  src={auth.picture}
                />
              ) : (
                initials
              )}
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--app-foreground)]">
                {auth.name ?? (auth.signedIn ? "Connected account" : "Guest session")}
              </p>
              <p className="truncate text-xs text-[var(--app-muted)]">
                {auth.email ?? "Google Drive disconnected"}
              </p>
            </div>
          </div>

          {auth.expiresAt && auth.signedIn && (
            <div className="border-b border-white/6 px-4 py-2 font-mono text-[11px] text-[var(--app-muted)]">
              Token expires {formatDateTime(auth.expiresAt)}
            </div>
          )}

          <div className="grid gap-1 p-2">
            {auth.signedIn ? (
              <ActionButton
                icon={LogOut}
                label="Sign out"
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
              />
            ) : (
              <ActionButton
                icon={LogIn}
                label="Sign in with Google"
                onClick={() => {
                  setOpen(false);
                  onSignIn();
                }}
              />
            )}

            <ActionButton
              icon={KeyRound}
              label="Manual authorization"
              onClick={() => {
                setOpen(false);
                onManualSignIn();
              }}
            />
            <ActionButton
              icon={RefreshCw}
              label="Refresh workspace"
              onClick={() => {
                setOpen(false);
                onRefresh();
              }}
            />
            <ActionButton
              icon={Settings}
              label="Open settings"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof CircleUserRound;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left text-sm text-[var(--app-foreground)] transition-colors hover:border-white/8 hover:bg-white/4"
      onClick={onClick}
      type="button"
    >
      <Icon size={15} className="text-[var(--app-muted)]" />
      <span>{label}</span>
    </button>
  );
}

function toneColor(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "var(--app-success)";
    case "error":
      return "var(--app-danger)";
    case "info":
      return "var(--app-primary)";
    default:
      return "var(--app-muted)";
  }
}
