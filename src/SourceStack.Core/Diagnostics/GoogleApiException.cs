using System.Net;

namespace SourceStack.Core.Diagnostics;

public sealed class GoogleApiException : Exception
{
    public GoogleApiException(HttpStatusCode statusCode, string responseBody)
        : base($"Google API error: {(int)statusCode} {statusCode}")
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }

    public HttpStatusCode StatusCode { get; }
    public string ResponseBody { get; }
}
