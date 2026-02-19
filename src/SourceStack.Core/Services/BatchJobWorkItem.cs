using SourceStack.Core.Models;

namespace SourceStack.Core.Services;

internal sealed record BatchJobWorkItem(string JobId, BatchParseRequest Request);
