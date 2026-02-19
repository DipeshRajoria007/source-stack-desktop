using SourceStack.Core.Models;

namespace SourceStack.Core.Abstractions;

public interface IResumeParserService
{
    Task<ParsedCandidate> ParseSingleAsync(string fileName, byte[] fileBytes, CancellationToken cancellationToken = default);
    Task<string> StartBatchJobAsync(BatchParseRequest request, CancellationToken cancellationToken = default);
    Task<JobStatus> GetJobStatusAsync(string jobId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ParsedCandidate>> GetJobResultsAsync(string jobId, CancellationToken cancellationToken = default);
}
