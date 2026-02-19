use std::path::{Path, PathBuf};

use anyhow::Context;
use chrono::{Duration, Utc};
use tokio::sync::Mutex;

use super::models::{JobStatus, ParsedCandidate};
use super::settings_store::app_data_root;

pub struct JsonJobStore {
    jobs_root: PathBuf,
    retention_hours: i64,
    mutex: Mutex<()>,
}

impl JsonJobStore {
    pub fn new(retention_hours: i64) -> Self {
        let jobs_root = app_data_root().join("jobs");
        Self::new_with_root(jobs_root, retention_hours)
    }

    pub fn new_with_root(jobs_root: PathBuf, retention_hours: i64) -> Self {
        Self {
            jobs_root,
            retention_hours: retention_hours.max(1),
            mutex: Mutex::new(()),
        }
    }

    pub fn jobs_root(&self) -> &Path {
        &self.jobs_root
    }

    pub async fn save_status(&self, status: &JobStatus) -> anyhow::Result<()> {
        let _lock = self.mutex.lock().await;
        let path = self.status_path(&status.job_id);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let json = serde_json::to_string_pretty(status)?;
        tokio::fs::write(path, json).await?;
        Ok(())
    }

    pub async fn load_status(&self, job_id: &str) -> anyhow::Result<Option<JobStatus>> {
        let _lock = self.mutex.lock().await;
        let path = self.status_path(job_id);
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return Ok(None);
        }

        let json = tokio::fs::read_to_string(path).await?;
        let status = serde_json::from_str::<JobStatus>(&json)?;
        Ok(Some(status))
    }

    pub async fn save_results(
        &self,
        job_id: &str,
        results: &[ParsedCandidate],
    ) -> anyhow::Result<()> {
        let _lock = self.mutex.lock().await;
        let path = self.results_path(job_id);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let json = serde_json::to_string_pretty(results)?;
        tokio::fs::write(path, json).await?;
        Ok(())
    }

    pub async fn load_results(&self, job_id: &str) -> anyhow::Result<Option<Vec<ParsedCandidate>>> {
        let _lock = self.mutex.lock().await;
        let path = self.results_path(job_id);
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return Ok(None);
        }

        let json = tokio::fs::read_to_string(path).await?;
        let results = serde_json::from_str::<Vec<ParsedCandidate>>(&json)?;
        Ok(Some(results))
    }

    pub async fn list_jobs(&self) -> anyhow::Result<Vec<String>> {
        self.cleanup_expired_jobs().await?;

        if !tokio::fs::try_exists(&self.jobs_root)
            .await
            .unwrap_or(false)
        {
            return Ok(Vec::new());
        }

        let mut dir = tokio::fs::read_dir(&self.jobs_root).await?;
        let mut ids = Vec::new();
        while let Some(entry) = dir.next_entry().await? {
            let metadata = entry.metadata().await?;
            if !metadata.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if !name.trim().is_empty() {
                ids.push(name);
            }
        }

        ids.sort_by(|a, b| b.cmp(a));
        Ok(ids)
    }

    pub async fn cleanup_expired_jobs(&self) -> anyhow::Result<()> {
        if !tokio::fs::try_exists(&self.jobs_root)
            .await
            .unwrap_or(false)
        {
            return Ok(());
        }

        let _lock = self.mutex.lock().await;
        let now = Utc::now();
        let mut dir = tokio::fs::read_dir(&self.jobs_root).await?;

        while let Some(entry) = dir.next_entry().await? {
            let metadata = entry.metadata().await?;
            if !metadata.is_dir() {
                continue;
            }

            let job_id = entry.file_name().to_string_lossy().to_string();
            if job_id.trim().is_empty() {
                continue;
            }

            let status_path = self.status_path(&job_id);
            let reference_time = if tokio::fs::try_exists(&status_path).await.unwrap_or(false) {
                let json = tokio::fs::read_to_string(&status_path)
                    .await
                    .with_context(|| format!("failed reading {}", status_path.display()))?;
                if let Ok(status) = serde_json::from_str::<JobStatus>(&json) {
                    status.completed_at.or(status.created_at).unwrap_or(now)
                } else {
                    now
                }
            } else {
                now
            };

            if now.signed_duration_since(reference_time) > Duration::hours(self.retention_hours) {
                tokio::fs::remove_dir_all(entry.path()).await?;
            }
        }

        Ok(())
    }

    fn status_path(&self, job_id: &str) -> PathBuf {
        self.jobs_root.join(job_id).join("status.json")
    }

    fn results_path(&self, job_id: &str) -> PathBuf {
        self.jobs_root.join(job_id).join("results.json")
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::core::models::{JobProcessingState, ParsedCandidate};

    #[tokio::test]
    async fn save_and_load_status_and_results_round_trip() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("jobs");
        let store = JsonJobStore::new_with_root(root, 24);

        let status = JobStatus {
            job_id: "job-123".to_string(),
            status: JobProcessingState::Processing,
            progress: 55,
            total_files: 200,
            processed_files: 110,
            spreadsheet_id: Some("sheet-1".to_string()),
            results_count: None,
            error: None,
            created_at: Some(Utc::now()),
            started_at: Some(Utc::now()),
            completed_at: None,
            duration_seconds: None,
        };

        let results = vec![ParsedCandidate {
            drive_file_id: None,
            source_file: Some("resume.pdf".to_string()),
            name: Some("John Doe".to_string()),
            email: Some("john@example.com".to_string()),
            phone: None,
            linked_in: None,
            git_hub: None,
            confidence: 0.95,
            errors: Vec::new(),
        }];

        store.save_status(&status).await.unwrap();
        store.save_results("job-123", &results).await.unwrap();

        let loaded_status = store.load_status("job-123").await.unwrap();
        let loaded_results = store.load_results("job-123").await.unwrap();

        assert!(loaded_status.is_some());
        assert_eq!(loaded_status.unwrap().progress, 55);

        assert!(loaded_results.is_some());
        assert_eq!(loaded_results.unwrap()[0].name.as_deref(), Some("John Doe"));
    }
}
