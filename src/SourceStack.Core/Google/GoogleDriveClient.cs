using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using SourceStack.Core.Abstractions;
using SourceStack.Core.Diagnostics;
using SourceStack.Core.Models;
using SourceStack.Core.Options;

namespace SourceStack.Core.Google;

public sealed class GoogleDriveClient : IGoogleDriveClient
{
    private const string PdfMimeType = "application/pdf";
    private const string DocxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    private readonly HttpClient _httpClient;
    private readonly IGoogleAccessTokenProvider _tokenProvider;
    private readonly ILogger<GoogleDriveClient> _logger;

    public GoogleDriveClient(
        HttpClient httpClient,
        IGoogleAccessTokenProvider tokenProvider,
        ILogger<GoogleDriveClient> logger)
    {
        _httpClient = httpClient;
        _tokenProvider = tokenProvider;
        _logger = logger;
    }

    public async Task<IReadOnlyList<DriveFileRef>> ListResumeFilesAsync(string folderId, CancellationToken cancellationToken = default)
    {
        var query = $"'{folderId}' in parents and trashed=false and (mimeType='{PdfMimeType}' or mimeType='{DocxMimeType}')";
        var files = new List<DriveFileRef>();
        string? pageToken = null;

        do
        {
            var queryParts = new Dictionary<string, string?>
            {
                ["q"] = query,
                ["fields"] = "files(id,name,mimeType),nextPageToken",
                ["pageSize"] = "1000",
                ["pageToken"] = pageToken,
            };

            var url = $"{GoogleApiEndpoints.DriveFiles}?{BuildQueryString(queryParts)}";
            using var request = await CreateAuthorizedRequestAsync(HttpMethod.Get, url, cancellationToken).ConfigureAwait(false);
            using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            EnsureSuccess(response.StatusCode, body);

            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;

            if (root.TryGetProperty("files", out var filesElement) && filesElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var file in filesElement.EnumerateArray())
                {
                    var id = file.GetProperty("id").GetString();
                    var name = file.GetProperty("name").GetString();
                    var mimeType = file.GetProperty("mimeType").GetString();

                    if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(mimeType))
                    {
                        continue;
                    }

                    files.Add(new DriveFileRef
                    {
                        Id = id,
                        Name = name,
                        MimeType = mimeType,
                    });
                }
            }

            pageToken = root.TryGetProperty("nextPageToken", out var tokenElement)
                ? tokenElement.GetString()
                : null;

        } while (!string.IsNullOrWhiteSpace(pageToken));

        _logger.LogInformation("Listed {Count} resume files for folder {FolderId}", files.Count, folderId);
        return files;
    }

    public async Task<byte[]> DownloadFileAsync(string fileId, CancellationToken cancellationToken = default)
    {
        var url = $"{GoogleApiEndpoints.DriveFiles}/{Uri.EscapeDataString(fileId)}?alt=media";
        using var request = await CreateAuthorizedRequestAsync(HttpMethod.Get, url, cancellationToken).ConfigureAwait(false);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var error = body.Length == 0 ? string.Empty : System.Text.Encoding.UTF8.GetString(body);
            throw new GoogleApiException(response.StatusCode, error);
        }

        return body;
    }

    private async Task<HttpRequestMessage> CreateAuthorizedRequestAsync(HttpMethod method, string url, CancellationToken cancellationToken)
    {
        var accessToken = await _tokenProvider.GetAccessTokenAsync(cancellationToken).ConfigureAwait(false);
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return request;
    }

    private static void EnsureSuccess(System.Net.HttpStatusCode statusCode, string body)
    {
        if ((int)statusCode is >= 200 and < 300)
        {
            return;
        }

        throw new GoogleApiException(statusCode, body);
    }

    private static string BuildQueryString(IDictionary<string, string?> values)
    {
        return string.Join("&", values
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Value))
            .Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value!)}"));
    }
}
