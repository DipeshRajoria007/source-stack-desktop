namespace SourceStack.Core.Parsing;

public sealed class ResumeExtractionResult
{
    public string? Name { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? LinkedIn { get; init; }
    public string? GitHub { get; init; }
    public double Confidence { get; init; }
    public bool OcrUsed { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = [];
}
