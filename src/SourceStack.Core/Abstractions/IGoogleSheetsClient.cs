namespace SourceStack.Core.Abstractions;

public interface IGoogleSheetsClient
{
    Task<string> CreateSpreadsheetAsync(string title, CancellationToken cancellationToken = default);
    Task AppendRowsAsync(
        string spreadsheetId,
        IReadOnlyList<IReadOnlyList<string>> rows,
        bool skipHeaders,
        CancellationToken cancellationToken = default);
}
