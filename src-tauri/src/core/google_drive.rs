use anyhow::Context;
use reqwest::Client;
use serde::Deserialize;

use super::errors::CoreError;
use super::models::DriveFileRef;

const DRIVE_FILES_ENDPOINT: &str = "https://www.googleapis.com/drive/v3/files";
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
}

pub struct GoogleDriveClient {
    client: Client,
}

impl GoogleDriveClient {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn list_resume_files(
        &self,
        access_token: &str,
        folder_id: &str,
    ) -> anyhow::Result<Vec<DriveFileRef>> {
        let query = format!(
            "'{folder_id}' in parents and trashed=false and (mimeType='{PDF_MIME}' or mimeType='{DOCX_MIME}')"
        );

        let mut files: Vec<DriveFileRef> = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut request = self
                .client
                .get(DRIVE_FILES_ENDPOINT)
                .bearer_auth(access_token)
                .query(&[
                    ("q", query.as_str()),
                    ("fields", "files(id,name,mimeType),nextPageToken"),
                    ("pageSize", "1000"),
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
                for item in batch {
                    let (Some(id), Some(name), Some(mime_type)) =
                        (item.id, item.name, item.mime_type)
                    else {
                        continue;
                    };

                    files.push(DriveFileRef {
                        id,
                        name,
                        mime_type,
                    });
                }
            }

            page_token = payload.next_page_token;
            if page_token.as_deref().is_none() {
                break;
            }
        }

        Ok(files)
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
}
