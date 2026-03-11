use anyhow::Context;
use reqwest::Client;
use serde::Deserialize;

use super::errors::CoreError;
use super::models::{DriveBrowserFile, DriveFileRef, DriveFolderEntry, DrivePathEntry};

const DRIVE_FILES_ENDPOINT: &str = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const PDF_MIME: &str = "application/pdf";
const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFilesResponse {
    files: Option<Vec<DriveFileItem>>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFileItem {
    id: Option<String>,
    name: Option<String>,
    mime_type: Option<String>,
    parents: Option<Vec<String>>,
    size: Option<String>,
    modified_time: Option<String>,
}

pub struct GoogleDriveClient {
    client: Client,
}

impl GoogleDriveClient {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn list_folders(
        &self,
        access_token: &str,
        parent_folder_id: Option<&str>,
    ) -> anyhow::Result<Vec<DriveFolderEntry>> {
        let query = if let Some(parent_id) = parent_folder_id {
            format!("'{parent_id}' in parents and mimeType='{FOLDER_MIME}' and trashed=false")
        } else {
            format!("mimeType='{FOLDER_MIME}' and trashed=false and 'root' in parents")
        };

        let items = self.query_files(access_token, &query).await?;
        Ok(items
            .into_iter()
            .filter_map(|item| {
                let (Some(id), Some(name), Some(mime_type)) = (item.id, item.name, item.mime_type)
                else {
                    return None;
                };

                Some(DriveFolderEntry {
                    id,
                    name,
                    mime_type,
                })
            })
            .collect())
    }

    pub async fn list_resume_files(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> anyhow::Result<Vec<DriveFileRef>> {
        let query = format!(
            "'{folder_id}' in parents and trashed=false and (mimeType='{PDF_MIME}' or mimeType='{DOCX_MIME}')"
        );

        let items = self.query_files(access_token, &query).await?;
        Ok(items
            .into_iter()
            .filter_map(|item| {
                let (Some(id), Some(name), Some(mime_type)) = (item.id, item.name, item.mime_type)
                else {
                    return None;
                };

                Some(DriveFileRef {
                    id,
                    name,
                    mime_type,
                })
            })
            .collect())
    }

    pub async fn list_files(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> anyhow::Result<Vec<DriveBrowserFile>> {
        let query =
            format!("'{folder_id}' in parents and trashed=false and mimeType!='{FOLDER_MIME}'");
        let items = self.query_files(access_token, &query).await?;

        Ok(items
            .into_iter()
            .filter_map(|item| {
                let (Some(id), Some(name), Some(mime_type)) = (item.id, item.name, item.mime_type)
                else {
                    return None;
                };

                Some(DriveBrowserFile {
                    id,
                    name,
                    mime_type,
                    size: item.size,
                    modified_time: item.modified_time,
                })
            })
            .collect())
    }

    pub async fn get_folder_path(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> anyhow::Result<Vec<DrivePathEntry>> {
        let mut path = Vec::new();
        let mut current_id = Some(folder_id.to_string());

        while let Some(id) = current_id {
            let folder = self.get_folder(access_token, &id).await?;
            let Some(folder) = folder else {
                break;
            };
            let (Some(folder_id), Some(folder_name)) = (folder.id.clone(), folder.name.clone())
            else {
                break;
            };

            path.push(DrivePathEntry {
                id: folder_id,
                name: folder_name,
            });
            current_id = folder
                .parents
                .and_then(|parents| parents.into_iter().next());
        }

        path.reverse();
        Ok(path)
    }

    pub async fn download_file(
        &self,
        access_token: &str,
        file_id: &str,
    ) -> anyhow::Result<Vec<u8>> {
        let url = format!("{DRIVE_FILES_ENDPOINT}/{file_id}?alt=media");
        let response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await?;
        let status = response.status();

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(CoreError::GoogleApi {
                status: status.as_u16(),
                body,
            }
            .into());
        }

        let bytes = response.bytes().await?;
        Ok(bytes.to_vec())
    }

    async fn get_folder(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> anyhow::Result<Option<DriveFileItem>> {
        let url = format!("{DRIVE_FILES_ENDPOINT}/{folder_id}?fields=id,name,mimeType,parents");
        let response = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await?;
        let status = response.status();

        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(CoreError::GoogleApi {
                status: status.as_u16(),
                body,
            }
            .into());
        }

        let item = serde_json::from_str::<DriveFileItem>(&body)
            .context("failed to parse Google Drive folder response")?;

        if item.mime_type.as_deref() != Some(FOLDER_MIME) {
            return Ok(None);
        }

        Ok(Some(item))
    }

    async fn query_files(
        &self,
        access_token: &str,
        query: &str,
    ) -> anyhow::Result<Vec<DriveFileItem>> {
        let mut items = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut request = self
                .client
                .get(DRIVE_FILES_ENDPOINT)
                .bearer_auth(access_token)
                .query(&[
                    (
                        "fields",
                        "files(id,name,mimeType,parents,size,modifiedTime),nextPageToken",
                    ),
                    ("orderBy", "name"),
                    ("pageSize", "1000"),
                    ("q", query),
                ]);

            if let Some(token) = page_token.as_deref() {
                request = request.query(&[("pageToken", token)]);
            }

            let response = request.send().await?;
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(CoreError::GoogleApi {
                    status: status.as_u16(),
                    body,
                }
                .into());
            }

            let payload = serde_json::from_str::<DriveFilesResponse>(&body)
                .context("failed to parse Google Drive list response")?;

            if let Some(batch) = payload.files {
                items.extend(batch);
            }

            page_token = payload.next_page_token;
            if page_token.is_none() {
                break;
            }
        }

        Ok(items)
    }
}
