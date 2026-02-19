use std::path::PathBuf;

use anyhow::Context;

use super::models::RuntimeSettings;

pub struct SettingsStore {
    file_path: PathBuf,
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

    pub async fn load(&self) -> anyhow::Result<RuntimeSettings> {
        if !tokio::fs::try_exists(&self.file_path)
            .await
            .unwrap_or(false)
        {
            return Ok(RuntimeSettings::default());
        }

        let content = tokio::fs::read_to_string(&self.file_path)
            .await
            .with_context(|| {
                format!("failed to read settings file {}", self.file_path.display())
            })?;

        let parsed = serde_json::from_str::<RuntimeSettings>(&content).with_context(|| {
            format!("invalid JSON in settings file {}", self.file_path.display())
        })?;

        Ok(parsed)
    }

    pub async fn save(&self, settings: &RuntimeSettings) -> anyhow::Result<()> {
        if let Some(parent) = self.file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let json = serde_json::to_string_pretty(settings)?;
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
