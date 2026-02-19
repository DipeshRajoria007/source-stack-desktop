using Microsoft.Extensions.Logging.Abstractions;
using SourceStack.Core.Jobs;
using SourceStack.Core.Models;
using SourceStack.Core.Options;

namespace SourceStack.Core.Tests;

public sealed class JsonJobStoreTests
{
    [Fact]
    public async Task SaveAndLoadStatusAndResults_RoundTrips()
    {
        var root = Path.Combine(Path.GetTempPath(), "sourcestack-jobstore-tests", Guid.NewGuid().ToString("N"));
        var store = new JsonJobStore(
            new SourceStackOptions
            {
                JobsRootPath = root,
                JobRetentionHours = 24,
            },
            NullLogger<JsonJobStore>.Instance);

        var status = new JobStatus
        {
            JobId = "job-123",
            Status = JobProcessingState.Processing,
            Progress = 55,
            TotalFiles = 200,
            ProcessedFiles = 110,
            SpreadsheetId = "sheet-1",
            CreatedAt = DateTimeOffset.UtcNow,
            StartedAt = DateTimeOffset.UtcNow,
        };

        var results = new[]
        {
            new ParsedCandidate
            {
                SourceFile = "resume.pdf",
                Name = "John Doe",
                Email = "john@example.com",
                Confidence = 0.95,
                Errors = [],
            },
        };

        await store.SaveStatusAsync(status);
        await store.SaveResultsAsync("job-123", results);

        var loadedStatus = await store.LoadStatusAsync("job-123");
        var loadedResults = await store.LoadResultsAsync("job-123");

        Assert.NotNull(loadedStatus);
        Assert.Equal(JobProcessingState.Processing, loadedStatus!.Status);
        Assert.Equal(55, loadedStatus.Progress);

        Assert.NotNull(loadedResults);
        Assert.Single(loadedResults!);
        Assert.Equal("John Doe", loadedResults[0].Name);

        Directory.Delete(root, recursive: true);
    }

    [Fact]
    public async Task CleanupExpiredJobs_RemovesOldJobFolders()
    {
        var root = Path.Combine(Path.GetTempPath(), "sourcestack-jobstore-tests", Guid.NewGuid().ToString("N"));
        var store = new JsonJobStore(
            new SourceStackOptions
            {
                JobsRootPath = root,
                JobRetentionHours = 1,
            },
            NullLogger<JsonJobStore>.Instance);

        var oldStatus = new JobStatus
        {
            JobId = "old-job",
            Status = JobProcessingState.Completed,
            Progress = 100,
            TotalFiles = 0,
            ProcessedFiles = 0,
            CreatedAt = DateTimeOffset.UtcNow.AddHours(-5),
            StartedAt = DateTimeOffset.UtcNow.AddHours(-5),
            CompletedAt = DateTimeOffset.UtcNow.AddHours(-4),
        };

        await store.SaveStatusAsync(oldStatus);
        await store.CleanupExpiredJobsAsync();

        var ids = await store.ListJobsAsync();
        Assert.DoesNotContain("old-job", ids);

        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
