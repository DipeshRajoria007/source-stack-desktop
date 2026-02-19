namespace SourceStack.Core.Parsing;

public interface IPdfOcrService
{
    Task<string> ExtractTextAsync(byte[] pdfBytes, CancellationToken cancellationToken = default);
}
