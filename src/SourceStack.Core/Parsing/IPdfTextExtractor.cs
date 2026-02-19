namespace SourceStack.Core.Parsing;

public interface IPdfTextExtractor
{
    Task<(string Text, bool OcrUsed)> ExtractTextWithOcrFallbackAsync(byte[] data, CancellationToken cancellationToken = default);
}
