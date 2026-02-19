use anyhow::Context;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;

use super::errors::CoreError;

const SHEETS_ENDPOINT: &str = "https://sheets.googleapis.com/v4/spreadsheets";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSpreadsheetResponse {
    spreadsheet_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ValuesCheckResponse {
    values: Option<Vec<Vec<String>>>,
}

pub struct GoogleSheetsClient {
    client: Client,
}

impl GoogleSheetsClient {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn create_spreadsheet(
        &self,
        access_token: &str,
        title: &str,
    ) -> anyhow::Result<String> {
        let payload = json!({
            "properties": { "title": title },
            "sheets": [
                { "properties": { "title": "Resume Data" } }
            ]
        });

        let response = self
            .client
            .post(SHEETS_ENDPOINT)
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(CoreError::GoogleApi {
                status: status.as_u16(),
                body,
            }
            .into());
        }

        let created = serde_json::from_str::<CreateSpreadsheetResponse>(&body)
            .context("failed to parse create spreadsheet response")?;

        created
            .spreadsheet_id
            .ok_or_else(|| anyhow::anyhow!("Google response missing spreadsheetId"))
    }

    pub async fn append_rows(
        &self,
        access_token: &str,
        spreadsheet_id: &str,
        rows: &[Vec<String>],
        skip_headers: bool,
    ) -> anyhow::Result<()> {
        if rows.is_empty() {
            return Ok(());
        }

        let check_url = format!("{SHEETS_ENDPOINT}/{spreadsheet_id}/values/A1:Z1");
        let check_response = self
            .client
            .get(&check_url)
            .bearer_auth(access_token)
            .send()
            .await?;

        let has_data = if check_response.status().is_success() {
            let body = check_response.text().await.unwrap_or_default();
            let payload = serde_json::from_str::<ValuesCheckResponse>(&body)
                .unwrap_or(ValuesCheckResponse { values: None });
            payload
                .values
                .map(|v| !v.is_empty() && !v[0].is_empty())
                .unwrap_or(false)
        } else {
            false
        };

        if !has_data {
            let put_url = format!(
                "{SHEETS_ENDPOINT}/{spreadsheet_id}/values/A1?valueInputOption=USER_ENTERED"
            );
            let payload = json!({ "values": rows });
            let put_response = self
                .client
                .put(&put_url)
                .bearer_auth(access_token)
                .json(&payload)
                .send()
                .await?;

            let status = put_response.status();
            let body = put_response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(CoreError::GoogleApi {
                    status: status.as_u16(),
                    body,
                }
                .into());
            }

            return Ok(());
        }

        let rows_to_append: Vec<Vec<String>> = if skip_headers {
            rows.to_vec()
        } else {
            rows.iter().skip(1).cloned().collect()
        }
        .into_iter()
        .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
        .collect();

        if rows_to_append.is_empty() {
            return Ok(());
        }

        let append_url = format!(
            "{SHEETS_ENDPOINT}/{spreadsheet_id}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS"
        );

        let payload = json!({ "values": rows_to_append });
        let append_response = self
            .client
            .post(&append_url)
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await?;

        let status = append_response.status();
        let body = append_response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(CoreError::GoogleApi {
                status: status.as_u16(),
                body,
            }
            .into());
        }

        Ok(())
    }
}
