namespace SourceStack.Core.Options;

public sealed class GoogleOAuthOptions
{
    public required string ClientId { get; init; }
    public string? ClientSecret { get; init; }
    public IReadOnlyList<string> Scopes { get; init; } =
    [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
    ];

    public TimeSpan AccessTokenEarlyRefreshWindow { get; init; } = TimeSpan.FromMinutes(5);
}
