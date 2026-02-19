# SourceStack Desktop

Cross-platform desktop app for local resume parsing and Google Drive to Sheets processing.

## Stack

- Tauri 2
- React + Vite + TypeScript
- Rust core backend (in-process, no local HTTP service)

## Local Runtime

- Supported resume inputs: `.pdf`, `.docx`
- PDF text extraction with OCR fallback (`tesseract`)
- Async batch jobs with progress/cancel and local JSON persistence
- Google OAuth + Drive + Sheets APIs only for network calls

## Run Dev Mode (macOS/Windows)

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri ...` now auto-detects cargo from `~/.cargo/bin` (or `CARGO_HOME/bin`) and exports it for Tauri.

## Build

```bash
pnpm tauri build --debug
```

## Test Rust Core

```bash
cd src-tauri
source $HOME/.cargo/env
cargo test
```
