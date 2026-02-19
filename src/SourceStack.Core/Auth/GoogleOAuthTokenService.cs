using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using SourceStack.Core.Abstractions;
using SourceStack.Core.Options;

namespace SourceStack.Core.Auth;

public sealed class GoogleOAuthTokenService : IGoogleAccessTokenProvider
{
    private readonly HttpClient _httpClient;
    private readonly GoogleOAuthOptions _options;
    private readonly DpapiTokenStore _tokenStore;
    private readonly ILogger<GoogleOAuthTokenService> _logger;

    public GoogleOAuthTokenService(
        HttpClient httpClient,
        GoogleOAuthOptions options,
        DpapiTokenStore tokenStore,
        ILogger<GoogleOAuthTokenService> logger)
    {
        _httpClient = httpClient;
        _options = options;
        _tokenStore = tokenStore;
        _logger = logger;
    }

    public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        var cached = await _tokenStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        if (cached is not null && !cached.IsExpiringWithin(_options.AccessTokenEarlyRefreshWindow))
        {
            return cached.AccessToken;
        }

        if (!string.IsNullOrWhiteSpace(cached?.RefreshToken))
        {
            var refreshed = await RefreshWithRetryAsync(cached!.RefreshToken!, cancellationToken).ConfigureAwait(false);
            if (refreshed is not null)
            {
                await _tokenStore.SaveAsync(refreshed, cancellationToken).ConfigureAwait(false);
                return refreshed.AccessToken;
            }
        }

        var interactive = await AuthorizeInteractiveAsync(cached?.RefreshToken, cancellationToken).ConfigureAwait(false);
        await _tokenStore.SaveAsync(interactive, cancellationToken).ConfigureAwait(false);
        return interactive.AccessToken;
    }

    public Task ClearAsync(CancellationToken cancellationToken = default) => _tokenStore.ClearAsync(cancellationToken);

    private async Task<GoogleOAuthTokenEnvelope?> RefreshWithRetryAsync(string refreshToken, CancellationToken cancellationToken)
    {
        try
        {
            return await RefreshAsync(refreshToken, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to refresh Google token");
            return null;
        }
    }

    private async Task<GoogleOAuthTokenEnvelope> RefreshAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var form = new Dictionary<string, string>
        {
            ["client_id"] = _options.ClientId,
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token",
        };

        if (!string.IsNullOrWhiteSpace(_options.ClientSecret))
        {
            form["client_secret"] = _options.ClientSecret!;
        }

        using var response = await _httpClient.PostAsync(
            GoogleApiEndpoints.AuthToken,
            new FormUrlEncodedContent(form),
            cancellationToken).ConfigureAwait(false);

        var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Failed to refresh token: {(int)response.StatusCode} {content}");
        }

        var tokenResponse = JsonSerializer.Deserialize<TokenResponse>(content)
            ?? throw new InvalidOperationException("Google token response was empty.");

        return new GoogleOAuthTokenEnvelope
        {
            AccessToken = tokenResponse.AccessToken,
            RefreshToken = tokenResponse.RefreshToken ?? refreshToken,
            ExpiresAtUtc = DateTimeOffset.UtcNow.AddSeconds(tokenResponse.ExpiresIn),
        };
    }

    private async Task<GoogleOAuthTokenEnvelope> AuthorizeInteractiveAsync(string? fallbackRefreshToken, CancellationToken cancellationToken)
    {
        var state = Guid.NewGuid().ToString("N");
        var verifier = GenerateCodeVerifier();
        var challenge = GenerateCodeChallenge(verifier);

        var listenerPort = ReserveLoopbackPort();
        var redirectUri = $"http://127.0.0.1:{listenerPort}/callback/";

        using var listener = new HttpListener();
        listener.Prefixes.Add(redirectUri);
        listener.Start();

        var authUrl = BuildAuthorizeUrl(state, challenge, redirectUri);
        Process.Start(new ProcessStartInfo
        {
            FileName = authUrl,
            UseShellExecute = true,
        });

        var context = await WaitForContextAsync(listener, cancellationToken).ConfigureAwait(false);
        var query = context.Request.QueryString;

        if (!string.Equals(query["state"], state, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("OAuth state mismatch.");
        }

        var code = query["code"];
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new InvalidOperationException("Authorization code not returned by Google.");
        }

        await RespondToBrowserAsync(context, cancellationToken).ConfigureAwait(false);

        var form = new Dictionary<string, string>
        {
            ["client_id"] = _options.ClientId,
            ["code"] = code,
            ["code_verifier"] = verifier,
            ["grant_type"] = "authorization_code",
            ["redirect_uri"] = redirectUri,
        };

        if (!string.IsNullOrWhiteSpace(_options.ClientSecret))
        {
            form["client_secret"] = _options.ClientSecret!;
        }

        using var tokenResponse = await _httpClient.PostAsync(
            GoogleApiEndpoints.AuthToken,
            new FormUrlEncodedContent(form),
            cancellationToken).ConfigureAwait(false);

        var content = await tokenResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!tokenResponse.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Failed to exchange code for token: {(int)tokenResponse.StatusCode} {content}");
        }

        var payload = JsonSerializer.Deserialize<TokenResponse>(content)
            ?? throw new InvalidOperationException("Google token response was empty.");

        return new GoogleOAuthTokenEnvelope
        {
            AccessToken = payload.AccessToken,
            RefreshToken = payload.RefreshToken ?? fallbackRefreshToken,
            ExpiresAtUtc = DateTimeOffset.UtcNow.AddSeconds(payload.ExpiresIn),
        };
    }

    private string BuildAuthorizeUrl(string state, string codeChallenge, string redirectUri)
    {
        var query = new Dictionary<string, string>
        {
            ["client_id"] = _options.ClientId,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = string.Join(' ', _options.Scopes),
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["state"] = state,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256",
        };

        var queryString = string.Join("&", query.Select(pair =>
            $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));

        return $"{GoogleApiEndpoints.AuthAuthorize}?{queryString}";
    }

    private static async Task<HttpListenerContext> WaitForContextAsync(HttpListener listener, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(TimeSpan.FromMinutes(5));

        var contextTask = listener.GetContextAsync();
        var completed = await Task.WhenAny(contextTask, Task.Delay(Timeout.Infinite, timeoutCts.Token)).ConfigureAwait(false);
        if (completed != contextTask)
        {
            throw new TimeoutException("Timed out waiting for Google OAuth callback.");
        }

        return await contextTask.ConfigureAwait(false);
    }

    private static async Task RespondToBrowserAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        const string html = "<html><body><h3>SourceStack authentication completed.</h3><p>You can close this window.</p></body></html>";
        var bytes = Encoding.UTF8.GetBytes(html);

        context.Response.ContentType = "text/html";
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        context.Response.OutputStream.Close();
    }

    private static int ReserveLoopbackPort()
    {
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static string GenerateCodeVerifier()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Base64UrlEncode(bytes);
    }

    private static string GenerateCodeChallenge(string codeVerifier)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(codeVerifier));
        return Base64UrlEncode(hash);
    }

    private static string Base64UrlEncode(ReadOnlySpan<byte> bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private sealed class TokenResponse
    {
        [JsonPropertyName("access_token")]
        public required string AccessToken { get; init; }

        [JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; init; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; init; }
    }
}
