using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using SourceStack.Core.Abstractions;
using SourceStack.Core.Diagnostics;
using SourceStack.Core.Options;

namespace SourceStack.Core.Google;

public sealed class GoogleSheetsClient : IGoogleSheetsClient
{
    private readonly HttpClient _httpClient;
    private readonly IGoogleAccessTokenProvider _tokenProvider;
    private readonly ILogger<GoogleSheetsClient> _logger;

    public GoogleSheetsClient(
        HttpClient httpClient,
        IGoogleAccessTokenProvider tokenProvider,
        ILogger<GoogleSheetsClient> logger)
    {
        _httpClient = httpClient;
        _tokenProvider = tokenProvider;
        _logger = logger;
    }

    public async Task<string> CreateSpreadsheetAsync(string title, CancellationToken cancellationToken = default)
    {
        var payload = JsonSerializer.Serialize(new
        {
            properties = new { title },
            sheets = new[]
            {
                new
                {
                    properties = new
                    {
                        title = "Resume Data",
                    },
                },
            },
        });

        using var request = await CreateAuthorizedJsonRequestAsync(
            HttpMethod.Post,
            GoogleApiEndpoints.SheetsSpreadsheets,
            payload,
            cancellationToken).ConfigureAwait(false);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        EnsureSuccess(response.StatusCode, body);

        using var document = JsonDocument.Parse(body);
        var spreadsheetId = document.RootElement.GetProperty("spreadsheetId").GetString();

        if (string.IsNullOrWhiteSpace(spreadsheetId))
        {
            throw new InvalidOperationException("Google Sheets create response did not include spreadsheetId.");
        }

        return spreadsheetId;
    }

    public async Task AppendRowsAsync(
        string spreadsheetId,
        IReadOnlyList<IReadOnlyList<string>> rows,
        bool skipHeaders,
        CancellationToken cancellationToken = default)
    {
        if (rows.Count == 0)
        {
            return;
        }

        var checkUrl = $"{GoogleApiEndpoints.SheetsSpreadsheets}/{Uri.EscapeDataString(spreadsheetId)}/values/A1:Z1";
        using var checkRequest = await CreateAuthorizedRequestAsync(HttpMethod.Get, checkUrl, cancellationToken).ConfigureAwait(false);
        using var checkResponse = await _httpClient.SendAsync(checkRequest, cancellationToken).ConfigureAwait(false);
        var checkBody = await checkResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        var hasData = false;
        if (checkResponse.IsSuccessStatusCode)
        {
            using var checkDoc = JsonDocument.Parse(checkBody);
            if (checkDoc.RootElement.TryGetProperty("values", out var valuesElement) &&
                valuesElement.ValueKind == JsonValueKind.Array &&
                valuesElement.GetArrayLength() > 0)
            {
                var firstRow = valuesElement[0];
                hasData = firstRow.ValueKind == JsonValueKind.Array && firstRow.GetArrayLength() > 0;
            }
        }

        if (!hasData)
        {
            var putUrl = $"{GoogleApiEndpoints.SheetsSpreadsheets}/{Uri.EscapeDataString(spreadsheetId)}/values/A1?valueInputOption=USER_ENTERED";
            var payload = JsonSerializer.Serialize(new { values = rows });

            using var putRequest = await CreateAuthorizedJsonRequestAsync(HttpMethod.Put, putUrl, payload, cancellationToken).ConfigureAwait(false);
            using var putResponse = await _httpClient.SendAsync(putRequest, cancellationToken).ConfigureAwait(false);
            var putBody = await putResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            EnsureSuccess(putResponse.StatusCode, putBody);
            return;
        }

        IReadOnlyList<IReadOnlyList<string>> rowsToAppend = skipHeaders
            ? rows
            : rows.Skip(1).ToArray();

        rowsToAppend = rowsToAppend
            .Where(row => row.Any(cell => !string.IsNullOrWhiteSpace(cell)))
            .ToArray();

        if (rowsToAppend.Count == 0)
        {
            _logger.LogInformation("Skipping spreadsheet append; no non-empty rows available.");
            return;
        }

        var appendUrl =
            $"{GoogleApiEndpoints.SheetsSpreadsheets}/{Uri.EscapeDataString(spreadsheetId)}/values/A1:append" +
            "?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";

        var appendPayload = JsonSerializer.Serialize(new { values = rowsToAppend });
        using var appendRequest = await CreateAuthorizedJsonRequestAsync(HttpMethod.Post, appendUrl, appendPayload, cancellationToken).ConfigureAwait(false);
        using var appendResponse = await _httpClient.SendAsync(appendRequest, cancellationToken).ConfigureAwait(false);
        var appendBody = await appendResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        EnsureSuccess(appendResponse.StatusCode, appendBody);
    }

    private async Task<HttpRequestMessage> CreateAuthorizedRequestAsync(HttpMethod method, string url, CancellationToken cancellationToken)
    {
        var accessToken = await _tokenProvider.GetAccessTokenAsync(cancellationToken).ConfigureAwait(false);
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return request;
    }

    private async Task<HttpRequestMessage> CreateAuthorizedJsonRequestAsync(
        HttpMethod method,
        string url,
        string json,
        CancellationToken cancellationToken)
    {
        var request = await CreateAuthorizedRequestAsync(method, url, cancellationToken).ConfigureAwait(false);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
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
}
