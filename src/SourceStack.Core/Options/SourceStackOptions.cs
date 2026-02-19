namespace SourceStack.Core.Options;

public sealed class SourceStackOptions
{
    public int MaxConcurrentRequests { get; init; } = 10;
    public int SpreadsheetBatchSize { get; init; } = 100;
    public int MaxRetries { get; init; } = 3;
    public double RetryDelaySeconds { get; init; } = 1.0;
    public int JobRetentionHours { get; init; } = 24;
    public string? JobsRootPath { get; init; }
    public string? GoogleTokenCachePath { get; init; }
    public string TesseractExecutablePath { get; init; } = "tesseract";
    public TimeSpan OcrTimeout { get; init; } = TimeSpan.FromMinutes(2);
}
