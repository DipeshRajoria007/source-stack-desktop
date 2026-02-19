namespace SourceStack.Core.Models;

public sealed class ParsedCandidate
{
    public string? DriveFileId { get; init; }
    public string? SourceFile { get; init; }
    public string? Name { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? LinkedIn { get; init; }
    public string? GitHub { get; init; }
    public double Confidence { get; init; }
    public List<string> Errors { get; init; } = [];

    public static ParsedCandidate Empty(string? sourceFile, string? driveFileId, params string[] errors) =>
        new()
        {
            SourceFile = sourceFile,
            DriveFileId = driveFileId,
            Confidence = 0d,
            Errors = [.. errors],
        };
}
