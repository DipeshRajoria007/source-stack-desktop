# SourceStack.Core

`SourceStack.Core` is a native .NET 8 in-process backend for resume parsing and Google Drive-to-Sheets orchestration.

## What It Replaces

- FastAPI `/parse`
- FastAPI `/batch-parse` + `/batch-parse-job`
- Celery + Redis job queue/status tracking

## Capabilities

- Parse single `.pdf` or `.docx` resume bytes
- PDF text extraction with OCR fallback trigger when extracted text length is `< 50`
- Field extraction heuristics for name, email, phone, LinkedIn, GitHub
- Confidence scoring identical to legacy weights
- Batch Drive folder processing with:
  - configurable concurrency
  - retry/backoff for `429`, `5xx`, and transient failures
  - incremental Google Sheets writes
  - per-file error isolation
- Local JSON job persistence under `%LOCALAPPDATA%\SourceStack\jobs`
- Installed-app Google OAuth with local token cache encrypted with DPAPI on Windows

## Package Layout

- `src/SourceStack.Core/Models`: core DTOs (`ParsedCandidate`, `JobStatus`, etc.)
- `src/SourceStack.Core/Abstractions`: service interfaces
- `src/SourceStack.Core/Parsing`: parser engine and extraction heuristics
- `src/SourceStack.Core/Auth`: Google OAuth token service + encrypted token store
- `src/SourceStack.Core/Google`: Drive and Sheets clients
- `src/SourceStack.Core/Jobs`: JSON job store
- `src/SourceStack.Core/Services`: channel-backed batch worker
- `src/SourceStack.Core/Adapters`: UI/controller integration helpers
- `tests/SourceStack.Core.Tests`: parser/store/service tests

## Minimal Integration Example

```csharp
using Microsoft.Extensions.DependencyInjection;
using SourceStack.Core.Adapters;
using SourceStack.Core.Options;

var services = new ServiceCollection();

services.AddLogging();
services.AddSourceStackCore(
    new SourceStackOptions
    {
        MaxConcurrentRequests = 10,
        SpreadsheetBatchSize = 100,
        MaxRetries = 3,
        RetryDelaySeconds = 1.0,
        JobRetentionHours = 24,
    },
    new GoogleOAuthOptions
    {
        ClientId = "<google-client-id>",
    });

var provider = services.BuildServiceProvider();
var controller = provider.GetRequiredService<ResumeProcessingController>();

var jobId = await controller.StartFolderProcessingAsync("<google-drive-folder-id>");
```

## Notes

- This library is designed for local app embedding, not as a hosted HTTP service.
- OCR implementation uses a local `tesseract` executable (`SourceStackOptions.TesseractExecutablePath`).
- See `docs/MIGRATION_FROM_FASTAPI.md` for endpoint-to-method mapping.
