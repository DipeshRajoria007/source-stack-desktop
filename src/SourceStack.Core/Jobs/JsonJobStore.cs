using System.Text.Json;
using Microsoft.Extensions.Logging;
using SourceStack.Core.Abstractions;
using SourceStack.Core.Models;
using SourceStack.Core.Options;

namespace SourceStack.Core.Jobs;

public sealed class JsonJobStore : IJobStore
{
    private readonly string _jobsRoot;
    private readonly TimeSpan _retentionWindow;
    private readonly ILogger<JsonJobStore> _logger;
    private readonly JsonSerializerOptions _serializerOptions;
    private readonly SemaphoreSlim _mutex = new(1, 1);

    public JsonJobStore(SourceStackOptions options, ILogger<JsonJobStore> logger)
    {
        _jobsRoot = options.JobsRootPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SourceStack",
            "jobs");

        _retentionWindow = TimeSpan.FromHours(Math.Max(1, options.JobRetentionHours));
        _logger = logger;
        _serializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        };

        Directory.CreateDirectory(_jobsRoot);
    }

    public async Task SaveStatusAsync(JobStatus status, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var path = GetStatusPath(status.JobId);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var json = JsonSerializer.Serialize(status, _serializerOptions);
            await File.WriteAllTextAsync(path, json, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task<JobStatus?> LoadStatusAsync(string jobId, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var path = GetStatusPath(jobId);
            if (!File.Exists(path))
            {
                return null;
            }

            var json = await File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false);
            return JsonSerializer.Deserialize<JobStatus>(json, _serializerOptions);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load job status for {JobId}", jobId);
            return null;
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task SaveResultsAsync(string jobId, IReadOnlyList<ParsedCandidate> results, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var path = GetResultsPath(jobId);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var json = JsonSerializer.Serialize(results, _serializerOptions);
            await File.WriteAllTextAsync(path, json, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task<IReadOnlyList<ParsedCandidate>?> LoadResultsAsync(string jobId, CancellationToken cancellationToken = default)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var path = GetResultsPath(jobId);
            if (!File.Exists(path))
            {
                return null;
            }

            var json = await File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false);
            return JsonSerializer.Deserialize<List<ParsedCandidate>>(json, _serializerOptions);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load job results for {JobId}", jobId);
            return null;
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task<IReadOnlyList<string>> ListJobsAsync(CancellationToken cancellationToken = default)
    {
        await CleanupExpiredJobsAsync(cancellationToken).ConfigureAwait(false);

        if (!Directory.Exists(_jobsRoot))
        {
            return [];
        }

        var jobIds = Directory
            .EnumerateDirectories(_jobsRoot)
            .Select(Path.GetFileName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Cast<string>()
            .ToArray();

        return jobIds;
    }

    public async Task CleanupExpiredJobsAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(_jobsRoot))
        {
            return;
        }

        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var directory in Directory.EnumerateDirectories(_jobsRoot))
            {
                var jobId = Path.GetFileName(directory);
                if (string.IsNullOrWhiteSpace(jobId))
                {
                    continue;
                }

                var statusPath = GetStatusPath(jobId);
                DateTimeOffset referenceTime;

                if (File.Exists(statusPath))
                {
                    var json = await File.ReadAllTextAsync(statusPath, cancellationToken).ConfigureAwait(false);
                    var status = JsonSerializer.Deserialize<JobStatus>(json, _serializerOptions);
                    referenceTime = status?.CompletedAt ?? status?.CreatedAt ?? Directory.GetCreationTimeUtc(directory);
                }
                else
                {
                    referenceTime = Directory.GetCreationTimeUtc(directory);
                }

                if (now - referenceTime > _retentionWindow)
                {
                    Directory.Delete(directory, recursive: true);
                    _logger.LogInformation("Deleted expired job folder for {JobId}", jobId);
                }
            }
        }
        finally
        {
            _mutex.Release();
        }
    }

    private string GetStatusPath(string jobId) => Path.Combine(_jobsRoot, jobId, "status.json");
    private string GetResultsPath(string jobId) => Path.Combine(_jobsRoot, jobId, "results.json");
}
