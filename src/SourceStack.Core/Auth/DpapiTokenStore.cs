using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace SourceStack.Core.Auth;

public sealed class DpapiTokenStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("SourceStack.GoogleToken.v1");
    private readonly string _tokenFile;
    private readonly ILogger<DpapiTokenStore> _logger;

    public DpapiTokenStore(string? tokenFile, ILogger<DpapiTokenStore> logger)
    {
        var defaultPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SourceStack",
            "auth",
            "google-token.bin");

        _tokenFile = tokenFile ?? defaultPath;
        _logger = logger;
    }

    public async Task SaveAsync(GoogleOAuthTokenEnvelope token, CancellationToken cancellationToken = default)
    {
        var directory = Path.GetDirectoryName(_tokenFile);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(token);
        byte[] encrypted;

        if (OperatingSystem.IsWindows())
        {
            encrypted = ProtectedData.Protect(jsonBytes, Entropy, DataProtectionScope.CurrentUser);
        }
        else
        {
            _logger.LogWarning("DPAPI unavailable on this platform. Token data is being stored unencrypted.");
            encrypted = jsonBytes;
        }

        await File.WriteAllBytesAsync(_tokenFile, encrypted, cancellationToken).ConfigureAwait(false);
    }

    public async Task<GoogleOAuthTokenEnvelope?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_tokenFile))
        {
            return null;
        }

        try
        {
            var encrypted = await File.ReadAllBytesAsync(_tokenFile, cancellationToken).ConfigureAwait(false);
            byte[] decrypted;

            if (OperatingSystem.IsWindows())
            {
                decrypted = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
            }
            else
            {
                decrypted = encrypted;
            }

            return JsonSerializer.Deserialize<GoogleOAuthTokenEnvelope>(decrypted);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load token cache, discarding cached token");
            return null;
        }
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        if (File.Exists(_tokenFile))
        {
            File.Delete(_tokenFile);
        }

        return Task.CompletedTask;
    }
}
