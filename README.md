# SourceStack Desktop

Cross-platform desktop app for local resume parsing and Google Drive to Sheets processing.

## Why This Exists

SourceStack was intentionally moved to a desktop-first, local-compute architecture:

- Resume parsing and batch computation run fully on the local machine.
- No local HTTP backend service is required.
- No Redis/Celery/background worker infrastructure is required.
- External network calls are only for Google OAuth, Google Drive, and Google Sheets APIs.

## Product History (How + Why)

### 1) Web Era: FastAPI + Web App

The original implementation lived in [`source-stack-api`](https://github.com/DipeshRajoria007/source-stack-api) and [`source-stack-web`](https://github.com/DipeshRajoria007/source-stack-web).

How it worked:
- FastAPI handled parsing endpoints and orchestration.
- Web frontend handled auth/session and API proxying.
- Background work depended on service-style runtime patterns.

Why we moved:
- Requirement changed to local-only compute for resume processing.
- Running service infrastructure for desktop usage was unnecessary overhead.
- Needed a native desktop experience instead of browser-only flow.

### 2) Windows Desktop Era: `.NET 8` + WinForms + C# Core

A Windows-native in-process backend was built next.

How it worked:
- Core logic was ported into `.NET` services.
- Job state/results persisted locally as JSON.
- Desktop UI was WinForms-focused.

Why we moved again:
- Development and daily testing needed to run on macOS too.
- Windows-only UI blocked cross-platform product velocity.
- We wanted one cross-platform desktop shell with native packaging on both macOS and Windows.

### 3) Current Era: Tauri 2 + React + Rust Core

Current architecture in this repo:

- App shell: Tauri 2
- UI: React + Vite + TypeScript
- Core backend: Rust (in-process commands, no local compute service)
- OAuth token storage: OS keychain via Rust `keyring`
- Job/result persistence: local JSON files under the app data directory

## Behavior Parity Commitments

The current desktop app keeps SourceStack parsing/orchestration behavior:

- Inputs: `.pdf` and `.docx`
- PDF text extraction first, OCR fallback for low-text PDFs
- Per-file failure does not fail the entire batch job
- Async jobs with progress tracking and cancellation
- Sheets export columns:
  - `Name`
  - `Resume Link`
  - `Phone Number`
  - `Email ID`
  - `LinkedIn`
  - `GitHub`

## Local Runtime Notes

- macOS job/settings data root: `~/Library/Application Support/SourceStack`
- Windows job/settings data root: `%LOCALAPPDATA%\SourceStack`
- OAuth scopes include user profile/email + Drive readonly + Sheets write

## Prerequisites

- Node.js 20+
- `pnpm`
- Rust (stable toolchain)
- Tesseract OCR installed and available in `PATH` (needed for scanned PDFs)

## Run Dev Mode (macOS/Windows)

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri ...` auto-detects Cargo from `~/.cargo/bin` (or `CARGO_HOME/bin`) and exports it for Tauri.

## Build

```bash
pnpm tauri build --debug
```

## Test Rust Core

```bash
cd src-tauri
cargo test
```
