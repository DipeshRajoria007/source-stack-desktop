using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using SourceStack.Core.Models;
using SourceStack.Core.Options;
using SourceStack.Core.Parsing;

static int ShowUsage()
{
    Console.WriteLine("SourceStack.Desktop.Cli");
    Console.WriteLine("Usage:");
    Console.WriteLine("  SourceStack.Desktop.Cli parse-file <absolute-or-relative-path-to-pdf-or-docx>");
    Console.WriteLine();
    Console.WriteLine("Optional env vars:");
    Console.WriteLine("  SOURCESTACK_TESSERACT_PATH   Path to tesseract executable");
    return 1;
}

if (args.Length < 2)
{
    return ShowUsage();
}

var command = args[0].Trim().ToLowerInvariant();
if (command != "parse-file")
{
    Console.Error.WriteLine($"Unknown command: {args[0]}");
    return ShowUsage();
}

var filePath = args[1];
if (!File.Exists(filePath))
{
    Console.Error.WriteLine($"File not found: {filePath}");
    return 2;
}

var fileName = Path.GetFileName(filePath);
var extension = Path.GetExtension(fileName).ToLowerInvariant();
if (extension is not ".pdf" and not ".docx")
{
    Console.Error.WriteLine($"Unsupported file extension: {extension}. Supported: .pdf, .docx");
    return 3;
}

var tesseractPath = Environment.GetEnvironmentVariable("SOURCESTACK_TESSERACT_PATH");
var options = string.IsNullOrWhiteSpace(tesseractPath)
    ? new SourceStackOptions()
    : new SourceStackOptions { TesseractExecutablePath = tesseractPath };

var ocr = new TesseractCliOcrService(options, NullLogger<TesseractCliOcrService>.Instance);
var pdf = new PdfTextExtractor(ocr, NullLogger<PdfTextExtractor>.Instance);
var parser = new ResumeDocumentParser(pdf, NullLogger<ResumeDocumentParser>.Instance);

var bytes = await File.ReadAllBytesAsync(filePath);
var parsed = await parser.ParseResumeBytesAsync(fileName, bytes);

var candidate = new ParsedCandidate
{
    SourceFile = fileName,
    Name = parsed.Name,
    Email = parsed.Email,
    Phone = parsed.Phone,
    LinkedIn = parsed.LinkedIn,
    GitHub = parsed.GitHub,
    Confidence = parsed.Confidence,
    Errors = [.. parsed.Errors],
};

var json = JsonSerializer.Serialize(candidate, new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = true,
});

Console.WriteLine(json);
return 0;
