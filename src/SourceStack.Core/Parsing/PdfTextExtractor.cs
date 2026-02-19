using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using UglyToad.PdfPig;

namespace SourceStack.Core.Parsing;

public sealed class PdfTextExtractor : IPdfTextExtractor
{
    private readonly IPdfOcrService _ocrService;
    private readonly ILogger<PdfTextExtractor> _logger;

    public PdfTextExtractor(IPdfOcrService ocrService, ILogger<PdfTextExtractor> logger)
    {
        _ocrService = ocrService;
        _logger = logger;
    }

    public async Task<(string Text, bool OcrUsed)> ExtractTextWithOcrFallbackAsync(byte[] data, CancellationToken cancellationToken = default)
    {
        var ocrUsed = false;

        try
        {
            var text = ExtractPdfText(data);
            var hyperlinks = ExtractHyperlinks(data);
            if (hyperlinks.Count > 0)
            {
                text = $"{text}\n{string.Join('\n', hyperlinks)}";
            }

            if (text.Trim().Length < 50)
            {
                ocrUsed = true;
                text = await _ocrService.ExtractTextAsync(data, cancellationToken).ConfigureAwait(false);
            }

            return (text, ocrUsed);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PDF extraction failed. Falling back to OCR");
            ocrUsed = true;
            var text = await _ocrService.ExtractTextAsync(data, cancellationToken).ConfigureAwait(false);
            return (text, ocrUsed);
        }
    }

    private static string ExtractPdfText(byte[] data)
    {
        using var stream = new MemoryStream(data);
        using var document = PdfDocument.Open(stream);

        var text = new StringBuilder();
        foreach (var page in document.GetPages())
        {
            text.AppendLine(page.Text);
        }

        return text.ToString();
    }

    private static IReadOnlyList<string> ExtractHyperlinks(byte[] data)
    {
        // The Python code reads PDF annotations directly. In C#, we include a best-effort
        // fallback by scanning raw bytes for URL-like strings.
        var raw = Encoding.Latin1.GetString(data);
        var matches = Regex.Matches(raw, @"https?://[^\s<>'"")]+", RegexOptions.IgnoreCase);

        if (matches.Count == 0)
        {
            return [];
        }

        return
        [
            .. matches
                .Select(m => m.Value)
                .Distinct(StringComparer.OrdinalIgnoreCase)
        ];
    }
}
