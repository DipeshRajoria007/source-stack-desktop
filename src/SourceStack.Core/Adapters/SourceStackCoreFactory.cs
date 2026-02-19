using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SourceStack.Core.Auth;
using SourceStack.Core.Google;
using SourceStack.Core.Jobs;
using SourceStack.Core.Options;
using SourceStack.Core.Parsing;
using SourceStack.Core.Services;

namespace SourceStack.Core.Adapters;

public static class SourceStackCoreFactory
{
    public static ResumeProcessingController Create(
        SourceStackOptions sourceStackOptions,
        GoogleOAuthOptions oauthOptions,
        ILoggerFactory? loggerFactory = null)
    {
        loggerFactory ??= NullLoggerFactory.Instance;

        var httpClient = new HttpClient();

        var tokenStore = new DpapiTokenStore(
            sourceStackOptions.GoogleTokenCachePath,
            loggerFactory.CreateLogger<DpapiTokenStore>());

        var tokenProvider = new GoogleOAuthTokenService(
            httpClient,
            oauthOptions,
            tokenStore,
            loggerFactory.CreateLogger<GoogleOAuthTokenService>());

        var drive = new GoogleDriveClient(httpClient, tokenProvider, loggerFactory.CreateLogger<GoogleDriveClient>());
        var sheets = new GoogleSheetsClient(httpClient, tokenProvider, loggerFactory.CreateLogger<GoogleSheetsClient>());

        var ocr = new TesseractCliOcrService(sourceStackOptions, loggerFactory.CreateLogger<TesseractCliOcrService>());
        var pdfExtractor = new PdfTextExtractor(ocr, loggerFactory.CreateLogger<PdfTextExtractor>());
        var parser = new ResumeDocumentParser(pdfExtractor, loggerFactory.CreateLogger<ResumeDocumentParser>());

        var jobStore = new JsonJobStore(sourceStackOptions, loggerFactory.CreateLogger<JsonJobStore>());

        var parserService = new ResumeParserService(
            parser,
            drive,
            sheets,
            jobStore,
            sourceStackOptions,
            loggerFactory.CreateLogger<ResumeParserService>());

        return new ResumeProcessingController(parserService);
    }
}
