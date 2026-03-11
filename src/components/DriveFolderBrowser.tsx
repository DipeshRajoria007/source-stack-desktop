import { useEffect, useMemo, useState } from "react";

import {
  getDriveFolderPath,
  listDriveFiles,
  listDriveFolders,
} from "../lib/api";
import type {
  DriveBrowserFile,
  DriveFolderEntry,
  DrivePathEntry,
} from "../lib/types";

interface DriveFolderBrowserProps {
  authSignedIn: boolean;
  disabled?: boolean;
  selectedFolderId?: string;
  onFolderSelect: (folderId: string, folderName: string) => void;
}

export function DriveFolderBrowser({
  authSignedIn,
  disabled = false,
  selectedFolderId,
  onFolderSelect,
}: DriveFolderBrowserProps) {
  const [folders, setFolders] = useState<DriveFolderEntry[]>([]);
  const [files, setFiles] = useState<DriveBrowserFile[]>([]);
  const [path, setPath] = useState<DrivePathEntry[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentFolderName = path[path.length - 1]?.name ?? "";
  const supportedResumeCount = useMemo(
    () => files.filter((file) => isSupportedResume(file.mimeType)).length,
    [files],
  );

  useEffect(() => {
    if (!authSignedIn) {
      setFolders([]);
      setFiles([]);
      setPath([]);
      setCurrentFolderId(null);
      setLoading(false);
      setError(null);
      return;
    }

    void loadFolder(currentFolderId ?? undefined);
  }, [authSignedIn, currentFolderId]);

  async function loadFolder(folderId?: string) {
    setLoading(true);
    setError(null);

    try {
      const [nextFolders, nextFiles] = await Promise.all([
        listDriveFolders(folderId),
        folderId ? listDriveFiles(folderId) : Promise.resolve([]),
      ]);

      setFolders(nextFolders);
      setFiles(nextFiles);

      if (folderId) {
        const nextPath = await getDriveFolderPath(folderId);
        setPath(nextPath);
      } else {
        setPath([]);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load Drive folders.",
      );
      setFolders([]);
      setFiles([]);
      if (!folderId) {
        setPath([]);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleOpenFolder(folder: DriveFolderEntry) {
    if (disabled) {
      return;
    }

    setCurrentFolderId(folder.id);
  }

  function handleGoBack() {
    if (disabled) {
      return;
    }

    if (path.length <= 1) {
      setCurrentFolderId(null);
      return;
    }

    setCurrentFolderId(path[path.length - 2].id);
  }

  function handleGoToRoot() {
    if (disabled) {
      return;
    }

    setCurrentFolderId(null);
  }

  function handleNavigateToPath(folderId: string | null) {
    if (disabled) {
      return;
    }

    setCurrentFolderId(folderId);
  }

  const items = [
    ...folders.map((folder) => ({ kind: "folder" as const, folder })),
    ...files.map((file) => ({ kind: "file" as const, file })),
  ];

  return (
    <section className={`drive-browser ${disabled ? "locked" : ""}`}>
      {disabled && (
        <div className="drive-browser-overlay">
          <div className="drive-browser-overlay-card">
            <strong>Batch Job Running</strong>
            <span>Drive browsing is paused until the current processing step completes.</span>
          </div>
        </div>
      )}

      <div className="drive-browser-topbar">
        <div>
          <p className="drive-browser-kicker">Drive Vault</p>
          <h3>Choose a folder from your Drive</h3>
        </div>
        <div className="drive-browser-stats">
          <span>{folders.length} folders</span>
          <span>{files.length} files</span>
          <span>{supportedResumeCount} resumes</span>
        </div>
      </div>

      {!authSignedIn ? (
        <div className="drive-browser-empty">
          <strong>Google sign-in required</strong>
          <span>Use the profile menu in the header, then this Drive browser will load your folders.</span>
        </div>
      ) : (
        <>
          <div className="drive-browser-breadcrumbs">
            <button
              className="drive-breadcrumb drive-breadcrumb-root"
              disabled={disabled}
              onClick={() => handleNavigateToPath(null)}
              type="button"
            >
              Drive
            </button>
            {path.map((entry, index) => {
              const isLast = index === path.length - 1;

              return (
                <button
                  key={entry.id}
                  className={`drive-breadcrumb ${isLast ? "active" : ""}`}
                  disabled={disabled || isLast}
                  onClick={() => handleNavigateToPath(entry.id)}
                  type="button"
                >
                  {entry.name}
                </button>
              );
            })}
            {currentFolderId && (
              <button
                className="drive-breadcrumb drive-breadcrumb-back"
                disabled={disabled}
                onClick={handleGoBack}
                type="button"
              >
                Back
              </button>
            )}
            {currentFolderId && (
              <button
                className="drive-breadcrumb drive-breadcrumb-root ghost"
                disabled={disabled}
                onClick={handleGoToRoot}
                type="button"
              >
                Root
              </button>
            )}
          </div>

          <div className="drive-browser-current">
            <span className="drive-browser-current-label">Current folder</span>
            <strong>{currentFolderName || "Drive Root"}</strong>
          </div>

          <div className="drive-browser-stage">
            {loading ? (
              <div className="drive-browser-empty">
                <strong>Loading Drive contents</strong>
                <span>Fetching folders and files from Google Drive.</span>
              </div>
            ) : error ? (
              <div className="drive-browser-empty error">
                <strong>Could not load this folder</strong>
                <span>{error}</span>
              </div>
            ) : items.length === 0 ? (
              <div className="drive-browser-empty">
                <strong>This folder is empty</strong>
                <span>Try navigating deeper or select another folder from the breadcrumb trail.</span>
              </div>
            ) : (
              <div className="drive-browser-list">
                {items.map((item) => {
                  if (item.kind === "folder") {
                    const isSelected = selectedFolderId === item.folder.id;

                    return (
                      <article
                        key={item.folder.id}
                        className={`drive-browser-row folder ${isSelected ? "selected" : ""}`}
                      >
                        <button
                          className="drive-browser-row-main"
                          disabled={disabled}
                          onClick={() => onFolderSelect(item.folder.id, item.folder.name)}
                          type="button"
                        >
                          <span className="drive-browser-badge folder">Folder</span>
                          <span className="drive-browser-row-copy">
                            <strong>{item.folder.name}</strong>
                            <span>{isSelected ? "Selected for batch parsing" : "Click to choose this folder"}</span>
                          </span>
                        </button>
                        <button
                          className="drive-browser-open"
                          disabled={disabled}
                          onClick={() => handleOpenFolder(item.folder)}
                          type="button"
                        >
                          Open
                        </button>
                      </article>
                    );
                  }

                  return (
                    <article key={item.file.id} className="drive-browser-row file">
                      <div className="drive-browser-row-main passive">
                        <span className={`drive-browser-badge ${fileBadgeClass(item.file.mimeType)}`}>
                          {fileBadgeLabel(item.file.mimeType)}
                        </span>
                        <span className="drive-browser-row-copy">
                          <strong>{item.file.name}</strong>
                          <span>{buildFileMeta(item.file)}</span>
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function isSupportedResume(mimeType: string) {
  return (
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function fileBadgeLabel(mimeType: string) {
  if (mimeType === "application/pdf") {
    return "PDF";
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "DOCX";
  }

  if (mimeType.includes("spreadsheet")) {
    return "Sheet";
  }

  if (mimeType.includes("image")) {
    return "Image";
  }

  return "File";
}

function fileBadgeClass(mimeType: string) {
  if (isSupportedResume(mimeType)) {
    return "resume";
  }

  if (mimeType.includes("spreadsheet")) {
    return "sheet";
  }

  return "file";
}

function buildFileMeta(file: DriveBrowserFile) {
  const parts: string[] = [];

  if (isSupportedResume(file.mimeType)) {
    parts.push("Eligible for parsing");
  } else {
    parts.push("Preview only");
  }

  if (file.size) {
    const bytes = Number(file.size);
    if (Number.isFinite(bytes)) {
      if (bytes < 1024) {
        parts.push(`${bytes} B`);
      } else if (bytes < 1024 * 1024) {
        parts.push(`${(bytes / 1024).toFixed(1)} KB`);
      } else {
        parts.push(`${(bytes / (1024 * 1024)).toFixed(1)} MB`);
      }
    }
  }

  if (file.modifiedTime) {
    const date = new Date(file.modifiedTime);
    if (!Number.isNaN(date.getTime())) {
      parts.push(`Modified ${date.toLocaleDateString()}`);
    }
  }

  return parts.join(" • ");
}
