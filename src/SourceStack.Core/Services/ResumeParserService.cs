using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using SourceStack.Core.Abstractions;
using SourceStack.Core.Diagnostics;
using SourceStack.Core.Models;
using SourceStack.Core.Options;
using SourceStack.Core.Parsing;

namespace SourceStack.Core.Services;

public sealed class ResumeParserService : IResumeParserService, IAsyncDisposable
{
    private static readonly IReadOnlyList<string> HeaderColumns =
    [
        "Name",
        "Resume Link",
        "Phone Number",
        "Email ID",
        "LinkedIn",
        "GitHub",
    ];

    private readonly IResumeDocumentParser _documentParser;
    private readonly IGoogleDriveClient _googleDriveClient;
    private readonly IGoogleSheetsClient _googleSheetsClient;
    private readonly IJobStore _jobStore;
    private readonly SourceStackOptions _options;
    private readonly ILogger<ResumeParserService> _logger;

    private readonly Channel<BatchJobWorkItem> _jobQueue;
    private readonly CancellationTokenSource _shutdownCts = new();
    private readonly Task _workerTask;

    public ResumeParserService(
        IResumeDocumentParser documentParser,
        IGoogleDriveClient googleDriveClient,
        IGoogleSheetsClient googleSheetsClient,
        IJobStore jobStore,
        SourceStackOptions options,
        ILogger<ResumeParserService> logger)
    {
        _documentParser = documentParser;
        _googleDriveClient = googleDriveClient;
        _googleSheetsClient = googleSheetsClient;
        _jobStore = jobStore;
        _options = options;
        _logger = logger;

        _jobQueue = Channel.CreateUnbounded<BatchJobWorkItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        _workerTask = Task.Run(ProcessQueueAsync);
    }

    public async Task<ParsedCandidate> ParseSingleAsync(string fileName, byte[] fileBytes, CancellationToken cancellationToken = default)
    {
        var extraction = await _documentParser.ParseResumeBytesAsync(fileName, fileBytes, cancellationToken).ConfigureAwait(false);

        return new ParsedCandidate
        {
            SourceFile = fileName,
            Name = extraction.Name,
            Email = extraction.Email,
            Phone = extraction.Phone,
            LinkedIn = extraction.LinkedIn,
            GitHub = extraction.GitHub,
            Confidence = extraction.Confidence,
            Errors = [.. extraction.Errors],
        };
    }

    public async Task<string> StartBatchJobAsync(BatchParseRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.FolderId))
        {
            throw new ArgumentException("FolderId is required.", nameof(request));
        }

        await _jobStore.CleanupExpiredJobsAsync(cancellationToken).ConfigureAwait(false);

        var jobId = Guid.NewGuid().ToString();
        var createdAt = DateTimeOffset.UtcNow;

        var pendingStatus = new JobStatus
        {
            JobId = jobId,
            Status = JobProcessingState.Pending,
            Progress = 0,
            TotalFiles = 0,
            ProcessedFiles = 0,
            SpreadsheetId = request.SpreadsheetId,
            CreatedAt = createdAt,
        };

        await _jobStore.SaveStatusAsync(pendingStatus, cancellationToken).ConfigureAwait(false);
        await _jobQueue.Writer.WriteAsync(new BatchJobWorkItem(jobId, request), cancellationToken).ConfigureAwait(false);

        _logger.LogInformation("Queued batch parse job {JobId} for folder {FolderId}", jobId, request.FolderId);
        return jobId;
    }

    public async Task<JobStatus> GetJobStatusAsync(string jobId, CancellationToken cancellationToken = default)
    {
        var status = await _jobStore.LoadStatusAsync(jobId, cancellationToken).ConfigureAwait(false);
        return status ?? throw new KeyNotFoundException($"Job {jobId} was not found.");
    }

    public async Task<IReadOnlyList<ParsedCandidate>> GetJobResultsAsync(string jobId, CancellationToken cancellationToken = default)
    {
        var results = await _jobStore.LoadResultsAsync(jobId, cancellationToken).ConfigureAwait(false);
        if (results is not null)
        {
            return results;
        }

        var status = await _jobStore.LoadStatusAsync(jobId, cancellationToken).ConfigureAwait(false)
            ?? throw new KeyNotFoundException($"Job {jobId} was not found.");

        if (status.Status != JobProcessingState.Completed)
        {
            throw new InvalidOperationException($"Job {jobId} is not completed. Current status: {status.Status}.");
        }

        return [];
    }

    public async ValueTask DisposeAsync()
    {
        _shutdownCts.Cancel();
        _jobQueue.Writer.TryComplete();

        try
        {
            await _workerTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            _shutdownCts.Dispose();
        }
    }

    private async Task ProcessQueueAsync()
    {
        try
        {
            await foreach (var workItem in _jobQueue.Reader.ReadAllAsync(_shutdownCts.Token).ConfigureAwait(false))
            {
                await ProcessBatchJobAsync(workItem, _shutdownCts.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Batch processor loop stopped");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fatal error in batch processor loop");
        }
    }

    private async Task ProcessBatchJobAsync(BatchJobWorkItem workItem, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var startTs = DateTimeOffset.UtcNow;
        var createdAt = (await _jobStore.LoadStatusAsync(workItem.JobId, cancellationToken).ConfigureAwait(false))?.CreatedAt;

        var spreadsheetId = workItem.Request.SpreadsheetId;
        var results = new List<ParsedCandidate>();
        var processedCount = 0;
        var totalFiles = 0;

        try
        {
            await _jobStore.SaveStatusAsync(new JobStatus
            {
                JobId = workItem.JobId,
                Status = JobProcessingState.Processing,
                Progress = 0,
                TotalFiles = 0,
                ProcessedFiles = 0,
                SpreadsheetId = spreadsheetId,
                CreatedAt = createdAt,
                StartedAt = startedAt,
            }, cancellationToken).ConfigureAwait(false);

            var driveFiles = await _googleDriveClient.ListResumeFilesAsync(workItem.Request.FolderId, cancellationToken).ConfigureAwait(false);
            if (driveFiles.Count == 0)
            {
                var completedAtNoFiles = DateTimeOffset.UtcNow;
                await _jobStore.SaveResultsAsync(workItem.JobId, Array.Empty<ParsedCandidate>(), cancellationToken).ConfigureAwait(false);
                await _jobStore.SaveStatusAsync(new JobStatus
                {
                    JobId = workItem.JobId,
                    Status = JobProcessingState.Completed,
                    Progress = 100,
                    TotalFiles = 0,
                    ProcessedFiles = 0,
                    SpreadsheetId = spreadsheetId,
                    ResultsCount = 0,
                    CreatedAt = createdAt,
                    StartedAt = startedAt,
                    CompletedAt = completedAtNoFiles,
                    DurationSeconds = (completedAtNoFiles - startTs).TotalSeconds,
                }, cancellationToken).ConfigureAwait(false);
                return;
            }

            totalFiles = driveFiles.Count;

            if (string.IsNullOrWhiteSpace(spreadsheetId))
            {
                spreadsheetId = await _googleSheetsClient
                    .CreateSpreadsheetAsync($"Resume Parse Results - {DateTime.Now:yyyy-MM-dd HH:mm:ss}", cancellationToken)
                    .ConfigureAwait(false);

                await _googleSheetsClient
                    .AppendRowsAsync(spreadsheetId, [HeaderColumns], skipHeaders: false, cancellationToken)
                    .ConfigureAwait(false);
            }

            await _jobStore.SaveStatusAsync(new JobStatus
            {
                JobId = workItem.JobId,
                Status = JobProcessingState.Processing,
                Progress = 0,
                TotalFiles = totalFiles,
                ProcessedFiles = 0,
                SpreadsheetId = spreadsheetId,
                CreatedAt = createdAt,
                StartedAt = startedAt,
            }, cancellationToken).ConfigureAwait(false);

            var semaphore = new SemaphoreSlim(_options.MaxConcurrentRequests, _options.MaxConcurrentRequests);

            for (var index = 0; index < driveFiles.Count; index += _options.SpreadsheetBatchSize)
            {
                var batchFiles = driveFiles.Skip(index).Take(_options.SpreadsheetBatchSize).ToArray();
                var batchTasks = batchFiles.Select(file => ProcessSingleFileWithRetryAsync(file, semaphore, cancellationToken)).ToArray();
                var batchResults = await Task.WhenAll(batchTasks).ConfigureAwait(false);

                var rows = batchResults
                    .Select(candidate => new List<string>
                    {
                        candidate.Name ?? string.Empty,
                        string.IsNullOrWhiteSpace(candidate.DriveFileId) ? string.Empty : BuildDriveFileUrl(candidate.DriveFileId),
                        candidate.Phone ?? string.Empty,
                        candidate.Email ?? string.Empty,
                        candidate.LinkedIn ?? string.Empty,
                        candidate.GitHub ?? string.Empty,
                    })
                    .Where(row => row.Any(cell => !string.IsNullOrWhiteSpace(cell)))
                    .Select(row => (IReadOnlyList<string>)row)
                    .ToArray();

                if (rows.Length > 0 && !string.IsNullOrWhiteSpace(spreadsheetId))
                {
                    await _googleSheetsClient.AppendRowsAsync(spreadsheetId, rows, skipHeaders: true, cancellationToken).ConfigureAwait(false);
                    processedCount += rows.Length;
                }

                results.AddRange(batchResults);

                var progress = totalFiles == 0
                    ? 0
                    : Math.Min(99, (int)Math.Floor(processedCount * 100d / totalFiles));

                await _jobStore.SaveStatusAsync(new JobStatus
                {
                    JobId = workItem.JobId,
                    Status = JobProcessingState.Processing,
                    Progress = progress,
                    TotalFiles = totalFiles,
                    ProcessedFiles = processedCount,
                    SpreadsheetId = spreadsheetId,
                    CreatedAt = createdAt,
                    StartedAt = startedAt,
                }, cancellationToken).ConfigureAwait(false);
            }

            await _jobStore.SaveResultsAsync(workItem.JobId, results, cancellationToken).ConfigureAwait(false);

            var completedAt = DateTimeOffset.UtcNow;
            await _jobStore.SaveStatusAsync(new JobStatus
            {
                JobId = workItem.JobId,
                Status = JobProcessingState.Completed,
                Progress = 100,
                TotalFiles = totalFiles,
                ProcessedFiles = processedCount,
                SpreadsheetId = spreadsheetId,
                ResultsCount = results.Count,
                CreatedAt = createdAt,
                StartedAt = startedAt,
                CompletedAt = completedAt,
                DurationSeconds = (completedAt - startTs).TotalSeconds,
            }, cancellationToken).ConfigureAwait(false);

            _logger.LogInformation("Completed batch job {JobId}. Results={ResultsCount}", workItem.JobId, results.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Batch job {JobId} failed", workItem.JobId);

            var completedAt = DateTimeOffset.UtcNow;
            await _jobStore.SaveStatusAsync(new JobStatus
            {
                JobId = workItem.JobId,
                Status = JobProcessingState.Failed,
                Progress = totalFiles == 0 ? 0 : Math.Min(99, (int)Math.Floor(processedCount * 100d / totalFiles)),
                TotalFiles = totalFiles,
                ProcessedFiles = processedCount,
                SpreadsheetId = spreadsheetId,
                Error = ex.Message,
                CreatedAt = createdAt,
                StartedAt = startedAt,
                CompletedAt = completedAt,
                DurationSeconds = (completedAt - startTs).TotalSeconds,
            }, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<ParsedCandidate> ProcessSingleFileWithRetryAsync(
        DriveFileRef file,
        SemaphoreSlim semaphore,
        CancellationToken cancellationToken)
    {
        await semaphore.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var errors = new List<string>();
            if (string.IsNullOrWhiteSpace(file.Id))
            {
                return ParsedCandidate.Empty(file.Name, null, "Missing file ID");
            }

            for (var attempt = 0; attempt < _options.MaxRetries; attempt++)
            {
                try
                {
                    var fileBytes = await _googleDriveClient.DownloadFileAsync(file.Id, cancellationToken).ConfigureAwait(false);
                    var normalizedFileName = EnsureFilenameExtension(file.Name, file.MimeType);
                    var parsed = await _documentParser.ParseResumeBytesAsync(normalizedFileName, fileBytes, cancellationToken).ConfigureAwait(false);

                    errors.AddRange(parsed.Errors);

                    return new ParsedCandidate
                    {
                        DriveFileId = file.Id,
                        SourceFile = file.Name,
                        Name = parsed.Name,
                        Email = parsed.Email,
                        Phone = parsed.Phone,
                        LinkedIn = parsed.LinkedIn,
                        GitHub = parsed.GitHub,
                        Confidence = parsed.Confidence,
                        Errors = errors,
                    };
                }
                catch (Exception ex) when (attempt < _options.MaxRetries - 1 && IsRetryable(ex))
                {
                    var delay = TimeSpan.FromSeconds(_options.RetryDelaySeconds * Math.Pow(2, attempt));
                    _logger.LogWarning(ex,
                        "Retry {Attempt}/{MaxAttempts} for file {FileName} after {Delay}",
                        attempt + 1,
                        _options.MaxRetries,
                        file.Name,
                        delay);

                    await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    errors.Add($"Error processing file: {ex.Message}");
                    _logger.LogError(ex, "File processing failed for {FileName}", file.Name);
                    break;
                }
            }

            return new ParsedCandidate
            {
                DriveFileId = file.Id,
                SourceFile = file.Name,
                Confidence = 0d,
                Errors = errors,
            };
        }
        finally
        {
            semaphore.Release();
        }
    }

    private static bool IsRetryable(Exception exception)
    {
        if (exception is GoogleApiException googleEx)
        {
            var code = (int)googleEx.StatusCode;
            return code == 429 || code >= 500;
        }

        if (exception is HttpRequestException httpEx)
        {
            if (httpEx.StatusCode is null)
            {
                return true;
            }

            var code = (int)httpEx.StatusCode.Value;
            return code == 429 || code >= 500;
        }

        return exception is TimeoutException or TaskCanceledException;
    }

    private static string EnsureFilenameExtension(string fileName, string mimeType)
    {
        return mimeType switch
        {
            "application/pdf" when !fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) => $"{fileName}.pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" when !fileName.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) => $"{fileName}.docx",
            _ => fileName,
        };
    }

    private static string BuildDriveFileUrl(string fileId) => $"https://drive.google.com/file/d/{fileId}/view";
}
