using SourceStack.Core.Abstractions;
using SourceStack.Core.Models;

namespace SourceStack.Core.Adapters;

// UI adapter for WPF/WinUI consumers.
public sealed class ResumeProcessingController
{
    private readonly IResumeParserService _parserService;

    public ResumeProcessingController(IResumeParserService parserService)
    {
        _parserService = parserService;
    }

    public Task<ParsedCandidate> ParseSingleAsync(string fileName, byte[] fileBytes, CancellationToken cancellationToken = default) =>
        _parserService.ParseSingleAsync(fileName, fileBytes, cancellationToken);

    public Task<string> StartFolderProcessingAsync(string folderId, string? spreadsheetId = null, CancellationToken cancellationToken = default) =>
        _parserService.StartBatchJobAsync(
            new BatchParseRequest
            {
                FolderId = folderId,
                SpreadsheetId = spreadsheetId,
            },
            cancellationToken);

    public Task<JobStatus> GetJobStatusAsync(string jobId, CancellationToken cancellationToken = default) =>
        _parserService.GetJobStatusAsync(jobId, cancellationToken);

    public Task<IReadOnlyList<ParsedCandidate>> GetJobResultsAsync(string jobId, CancellationToken cancellationToken = default) =>
        _parserService.GetJobResultsAsync(jobId, cancellationToken);
}
