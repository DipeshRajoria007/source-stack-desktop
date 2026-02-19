using Microsoft.Extensions.DependencyInjection;
using SourceStack.Core.Abstractions;
using SourceStack.Core.Auth;
using SourceStack.Core.Google;
using SourceStack.Core.Jobs;
using SourceStack.Core.Options;
using SourceStack.Core.Parsing;
using SourceStack.Core.Services;

namespace SourceStack.Core.Adapters;

public static class SourceStackCoreServiceCollectionExtensions
{
    public static IServiceCollection AddSourceStackCore(
        this IServiceCollection services,
        SourceStackOptions sourceStackOptions,
        GoogleOAuthOptions googleOAuthOptions)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(sourceStackOptions);
        ArgumentNullException.ThrowIfNull(googleOAuthOptions);

        services.AddSingleton(sourceStackOptions);
        services.AddSingleton(googleOAuthOptions);
        services.AddSingleton<HttpClient>();

        services.AddSingleton(provider =>
            new DpapiTokenStore(
                sourceStackOptions.GoogleTokenCachePath,
                provider.GetRequiredService<Microsoft.Extensions.Logging.ILogger<DpapiTokenStore>>()));

        services.AddSingleton<IGoogleAccessTokenProvider, GoogleOAuthTokenService>();
        services.AddSingleton<IGoogleDriveClient, GoogleDriveClient>();
        services.AddSingleton<IGoogleSheetsClient, GoogleSheetsClient>();

        services.AddSingleton<IPdfOcrService, TesseractCliOcrService>();
        services.AddSingleton<IPdfTextExtractor, PdfTextExtractor>();
        services.AddSingleton<IResumeDocumentParser, ResumeDocumentParser>();

        services.AddSingleton<IJobStore, JsonJobStore>();
        services.AddSingleton<IResumeParserService, ResumeParserService>();

        services.AddSingleton<ResumeProcessingController>();

        return services;
    }
}
