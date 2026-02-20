use std::path::PathBuf;

use anyhow::Context;
use serde::Deserialize;

use super::models::PersistedSettings;

pub struct SettingsStore {
    file_path: PathBuf,
}

pub struct LoadSettingsResult {
    pub persisted: PersistedSettings,
    pub legacy_secret_scrubbed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettingsRaw {
    #[serde(default)]
    google_client_id: String,
    #[serde(default)]
    google_client_secret: Option<String>,
    #[serde(default)]
    tesseract_path: Option<String>,
    #[serde(default)]
    max_concurrent_requests: Option<usize>,
    #[serde(default)]
    spreadsheet_batch_size: Option<usize>,
    #[serde(default)]
    max_retries: Option<usize>,
    #[serde(default)]
    retry_delay_seconds: Option<f64>,
    #[serde(default)]
    job_retention_hours: Option<i64>,
}

impl SettingsStore {
    pub fn new() -> Self {
        Self {
            file_path: settings_path(),
        }
    }

    pub fn path(&self) -> &PathBuf {
        &self.file_path
    }

    pub async fn load(&self) -> anyhow::Result<LoadSettingsResult> {
        if !tokio::fs::try_exists(&self.file_path)
            .await
            .unwrap_or(false)
        {
            return Ok(LoadSettingsResult {
                persisted: PersistedSettings::default(),
                legacy_secret_scrubbed: false,
            });
        }

        let content = tokio::fs::read_to_string(&self.file_path)
            .await
            .with_context(|| {
                format!("failed to read settings file {}", self.file_path.display())
            })?;

        let raw = serde_json::from_str::<PersistedSettingsRaw>(&content).with_context(|| {
            format!("invalid JSON in settings file {}", self.file_path.display())
        })?;

        let defaults = PersistedSettings::default();
        let persisted = PersistedSettings {
            google_client_id: raw.google_client_id,
            tesseract_path: raw.tesseract_path.unwrap_or(defaults.tesseract_path),
            max_concurrent_requests: raw
                .max_concurrent_requests
                .unwrap_or(defaults.max_concurrent_requests),
            spreadsheet_batch_size: raw
                .spreadsheet_batch_size
                .unwrap_or(defaults.spreadsheet_batch_size),
            max_retries: raw.max_retries.unwrap_or(defaults.max_retries),
            retry_delay_seconds: raw
                .retry_delay_seconds
                .unwrap_or(defaults.retry_delay_seconds),
            job_retention_hours: raw
                .job_retention_hours
                .unwrap_or(defaults.job_retention_hours),
        }
        .sanitized();

        let had_legacy_secret = raw
            .google_client_secret
            .as_deref()
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);

        if had_legacy_secret {
            self.save(&persisted).await?;
        }

        Ok(LoadSettingsResult {
            persisted,
            legacy_secret_scrubbed: had_legacy_secret,
        })
    }

    pub async fn save(&self, settings: &PersistedSettings) -> anyhow::Result<()> {
        if let Some(parent) = self.file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let json = serde_json::to_string_pretty(&settings.clone().sanitized())?;
        tokio::fs::write(&self.file_path, json).await?;
        Ok(())
    }
}

fn settings_path() -> PathBuf {
    app_data_root().join("desktop-settings.json")
}

pub fn app_data_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data).join("SourceStack");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return home
                .join("Library")
                .join("Application Support")
                .join("SourceStack");
        }
    }

    if let Some(path) = dirs::data_local_dir() {
        return path.join("SourceStack");
    }

    PathBuf::from(".").join("SourceStack")
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn load_scrubs_legacy_plaintext_secret() {
        let temp_dir = tempdir().unwrap();
        let file_path = temp_dir.path().join("desktop-settings.json");
        tokio::fs::write(
            &file_path,
            r#"{
              "googleClientId":"abc",
              "googleClientSecret":"plaintext-secret",
              "maxConcurrentRequests":5
            }"#,
        )
        .await
        .unwrap();

        let store = SettingsStore { file_path };
        let loaded = store.load().await.unwrap();

        assert!(loaded.legacy_secret_scrubbed);
        let written = tokio::fs::read_to_string(store.path()).await.unwrap();
        assert!(!written.contains("googleClientSecret"));
    }
}
