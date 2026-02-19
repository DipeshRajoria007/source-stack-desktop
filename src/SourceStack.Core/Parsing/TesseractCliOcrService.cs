using System.Diagnostics;
using Microsoft.Extensions.Logging;
using SourceStack.Core.Options;

namespace SourceStack.Core.Parsing;

public sealed class TesseractCliOcrService : IPdfOcrService
{
    private readonly SourceStackOptions _options;
    private readonly ILogger<TesseractCliOcrService> _logger;

    public TesseractCliOcrService(SourceStackOptions options, ILogger<TesseractCliOcrService> logger)
    {
        _options = options;
        _logger = logger;
    }

    public async Task<string> ExtractTextAsync(byte[] pdfBytes, CancellationToken cancellationToken = default)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "sourcestack-ocr", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);

        var inputPath = Path.Combine(tempDir, "resume.pdf");
        await File.WriteAllBytesAsync(inputPath, pdfBytes, cancellationToken).ConfigureAwait(false);

        try
        {
            var processInfo = new ProcessStartInfo
            {
                FileName = _options.TesseractExecutablePath,
                Arguments = $"\"{inputPath}\" stdout -l eng",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            using var process = Process.Start(processInfo)
                ?? throw new InvalidOperationException("Failed to start Tesseract OCR process.");

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(_options.OcrTimeout);

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();

            await process.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);

            var stdout = await stdoutTask.ConfigureAwait(false);
            var stderr = await stderrTask.ConfigureAwait(false);

            if (process.ExitCode != 0)
            {
                _logger.LogWarning("Tesseract returned non-zero exit code {ExitCode}: {Error}", process.ExitCode, stderr);
                return string.Empty;
            }

            return stdout;
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Tesseract OCR timed out after {Timeout}", _options.OcrTimeout);
            return string.Empty;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Tesseract OCR failed");
            return string.Empty;
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, recursive: true);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to clean OCR temp folder {TempDir}", tempDir);
            }
        }
    }
}
