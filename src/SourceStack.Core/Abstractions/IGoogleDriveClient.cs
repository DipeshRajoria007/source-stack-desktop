using SourceStack.Core.Models;

namespace SourceStack.Core.Abstractions;

public interface IGoogleDriveClient
{
    Task<IReadOnlyList<DriveFileRef>> ListResumeFilesAsync(string folderId, CancellationToken cancellationToken = default);
    Task<byte[]> DownloadFileAsync(string fileId, CancellationToken cancellationToken = default);
}
