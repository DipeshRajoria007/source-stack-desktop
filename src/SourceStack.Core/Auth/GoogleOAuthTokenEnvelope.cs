namespace SourceStack.Core.Auth;

public sealed class GoogleOAuthTokenEnvelope
{
    public required string AccessToken { get; init; }
    public string? RefreshToken { get; init; }
    public DateTimeOffset ExpiresAtUtc { get; init; }

    public bool IsExpiringWithin(TimeSpan window) => DateTimeOffset.UtcNow.Add(window) >= ExpiresAtUtc;
}
