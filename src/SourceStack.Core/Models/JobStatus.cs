namespace SourceStack.Core.Models;

public sealed class JobStatus
{
    public required string JobId { get; init; }
    public JobProcessingState Status { get; init; }
    public int Progress { get; init; }
    public int TotalFiles { get; init; }
    public int ProcessedFiles { get; init; }
    public string? SpreadsheetId { get; init; }
    public int? ResultsCount { get; init; }
    public string? Error { get; init; }
    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? StartedAt { get; init; }
    public DateTimeOffset? CompletedAt { get; init; }
    public double? DurationSeconds { get; init; }
}
