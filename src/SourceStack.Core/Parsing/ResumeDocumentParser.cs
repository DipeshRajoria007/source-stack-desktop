using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Microsoft.Extensions.Logging;

namespace SourceStack.Core.Parsing;

public sealed class ResumeDocumentParser : IResumeDocumentParser
{
    private readonly IPdfTextExtractor _pdfTextExtractor;
    private readonly ILogger<ResumeDocumentParser> _logger;

    public ResumeDocumentParser(IPdfTextExtractor pdfTextExtractor, ILogger<ResumeDocumentParser> logger)
    {
        _pdfTextExtractor = pdfTextExtractor;
        _logger = logger;
    }

    public async Task<ResumeExtractionResult> ParseResumeBytesAsync(string fileName, byte[] data, CancellationToken cancellationToken = default)
    {
        var errors = new List<string>();
        var ocrUsed = false;
        string text;

        try
        {
            var extension = Path.GetExtension(fileName).ToLowerInvariant();

            if (extension == ".pdf")
            {
                var result = await _pdfTextExtractor.ExtractTextWithOcrFallbackAsync(data, cancellationToken).ConfigureAwait(false);
                text = result.Text;
                ocrUsed = result.OcrUsed;
            }
            else if (extension == ".docx")
            {
                text = ExtractDocxText(data);
            }
            else
            {
                errors.Add($"Unsupported file type: {fileName}");
                return new ResumeExtractionResult
                {
                    Confidence = 0d,
                    Errors = errors,
                };
            }

            var (email, phone, linkedIn, gitHub) = ResumeFieldExtractor.ExtractFields(text);
            var name = ResumeFieldExtractor.GuessName(text);
            var confidence = ResumeFieldExtractor.ScoreConfidence(name, email, phone, linkedIn, gitHub, ocrUsed);

            return new ResumeExtractionResult
            {
                Name = name,
                Email = email,
                Phone = phone,
                LinkedIn = linkedIn,
                GitHub = gitHub,
                OcrUsed = ocrUsed,
                Confidence = confidence,
                Errors = errors,
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to parse resume {FileName}", fileName);
            errors.Add($"Parse error: {ex.Message}");

            return new ResumeExtractionResult
            {
                Confidence = 0d,
                Errors = errors,
            };
        }
    }

    private static string ExtractDocxText(byte[] data)
    {
        using var stream = new MemoryStream(data);
        using var document = WordprocessingDocument.Open(stream, isEditable: false);

        var paragraphs = document.MainDocumentPart?.Document.Body?.Descendants<Paragraph>()
            ?? Enumerable.Empty<Paragraph>();

        var lines = paragraphs
            .Select(paragraph => string.Concat(paragraph.Descendants<Text>().Select(text => text.Text)))
            .Where(line => !string.IsNullOrWhiteSpace(line));

        return string.Join('\n', lines);
    }
}
