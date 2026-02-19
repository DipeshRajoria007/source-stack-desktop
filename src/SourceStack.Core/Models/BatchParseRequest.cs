namespace SourceStack.Core.Models;

public sealed class BatchParseRequest
{
    public required string FolderId { get; init; }
    public string? SpreadsheetId { get; init; }
}
