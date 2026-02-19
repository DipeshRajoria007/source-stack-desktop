using Microsoft.Extensions.Logging.Abstractions;
using SourceStack.Core.Abstractions;
using SourceStack.Core.Diagnostics;
using SourceStack.Core.Jobs;
using SourceStack.Core.Models;
using SourceStack.Core.Options;
using SourceStack.Core.Parsing;
using SourceStack.Core.Services;

namespace SourceStack.Core.Tests;

public sealed class ResumeParserServiceTests
{
    [Fact]
    public async Task StartBatchJob_Completes_WhenFolderHasNoFiles()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "sourcestack-service-tests", Guid.NewGuid().ToString("N"));

        var options = new SourceStackOptions
        {
            JobsRootPath = tempRoot,
            SpreadsheetBatchSize = 2,
            MaxConcurrentRequests = 2,
            JobRetentionHours = 24,
        };

        var service = new ResumeParserService(
            new FakeParser(),
            new FakeDriveClient(),
            new FakeSheetsClient(),
            new JsonJobStore(options, NullLogger<JsonJobStore>.Instance),
            options,
            NullLogger<ResumeParserService>.Instance);

        try
        {
            var jobId = await service.StartBatchJobAsync(new BatchParseRequest { FolderId = "folder-1" });

            JobStatus? status = null;
            for (var i = 0; i < 50; i++)
            {
                status = await service.GetJobStatusAsync(jobId);
                if (status.Status == JobProcessingState.Completed)
                {
                    break;
                }

                await Task.Delay(50);
            }

            Assert.NotNull(status);
            Assert.Equal(JobProcessingState.Completed, status!.Status);
            Assert.Equal(0, status.TotalFiles);
            Assert.Equal(0, status.ProcessedFiles);

            var results = await service.GetJobResultsAsync(jobId);
            Assert.Empty(results);
        }
        finally
        {
            await service.DisposeAsync();
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
        }
    }

    private sealed class FakeParser : IResumeDocumentParser
    {
        public Task<ResumeExtractionResult> ParseResumeBytesAsync(string fileName, byte[] data, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(new ResumeExtractionResult
            {
                Confidence = 0d,
                Errors = [],
            });
        }
    }

    private sealed class FakeDriveClient : IGoogleDriveClient
    {
        public Task<IReadOnlyList<DriveFileRef>> ListResumeFilesAsync(string folderId, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<DriveFileRef>>([]);

        public Task<byte[]> DownloadFileAsync(string fileId, CancellationToken cancellationToken = default)
            => throw new GoogleApiException(System.Net.HttpStatusCode.NotFound, "unused");
    }

    private sealed class FakeSheetsClient : IGoogleSheetsClient
    {
        public Task<string> CreateSpreadsheetAsync(string title, CancellationToken cancellationToken = default)
            => Task.FromResult("sheet-1");

        public Task AppendRowsAsync(
            string spreadsheetId,
            IReadOnlyList<IReadOnlyList<string>> rows,
            bool skipHeaders,
            CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}
