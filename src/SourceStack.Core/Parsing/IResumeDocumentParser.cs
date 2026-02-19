namespace SourceStack.Core.Parsing;

public interface IResumeDocumentParser
{
    Task<ResumeExtractionResult> ParseResumeBytesAsync(string fileName, byte[] data, CancellationToken cancellationToken = default);
}
