# Migration Map: FastAPI -> In-Process .NET

## Endpoint to Method Mapping

- `POST /parse`
  - `IResumeParserService.ParseSingleAsync(fileName, fileBytes)`

- `POST /batch-parse-job`
  - `IResumeParserService.StartBatchJobAsync(new BatchParseRequest { FolderId, SpreadsheetId })`

- `GET /batch-parse-job/{jobId}/status`
  - `IResumeParserService.GetJobStatusAsync(jobId)`

- `GET /batch-parse-job/{jobId}/results`
  - `IResumeParserService.GetJobResultsAsync(jobId)`

## Legacy Components and Local Replacements

- FastAPI request handling -> direct in-process service calls
- Celery queue -> `Channel<BatchJobWorkItem>` background worker
- Redis status/results -> JSON file store (`IJobStore` / `JsonJobStore`)
- API key auth -> removed (same-process trust boundary)

## Field and Scoring Compatibility

The C# implementation preserves the current extraction + scoring rules:

- Email: regex + `mailto:` handling
- Phone: libphonenumber normalization + `+91` default for 10-digit local pattern
- LinkedIn/GitHub: URL and href pattern extraction
- Name: heuristic from early lines and contact-adjacent lines
- Confidence weights: `0.4 + 0.25 + 0.15 + 0.1 + 0.05 + 0.05(non-OCR)`

## Job State Persistence

Status and results are stored in:

- `%LOCALAPPDATA%\SourceStack\jobs\<jobId>\status.json`
- `%LOCALAPPDATA%\SourceStack\jobs\<jobId>\results.json`

Default retention is 24 hours (`SourceStackOptions.JobRetentionHours`).
