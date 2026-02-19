using SourceStack.Core.Models;

namespace SourceStack.Core.Abstractions;

public interface IJobStore
{
    Task SaveStatusAsync(JobStatus status, CancellationToken cancellationToken = default);
    Task<JobStatus?> LoadStatusAsync(string jobId, CancellationToken cancellationToken = default);
    Task SaveResultsAsync(string jobId, IReadOnlyList<ParsedCandidate> results, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ParsedCandidate>?> LoadResultsAsync(string jobId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<string>> ListJobsAsync(CancellationToken cancellationToken = default);
    Task CleanupExpiredJobsAsync(CancellationToken cancellationToken = default);
}
