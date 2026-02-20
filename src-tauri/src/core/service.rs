use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use chrono::Utc;
use futures::stream::{self, StreamExt};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::auth::GoogleAuthService;
use super::document_parser::ResumeDocumentParser;
use super::errors::{AuthErrorCode, CoreError};
use super::google_drive::GoogleDriveClient;
use super::google_sheets::GoogleSheetsClient;
use super::job_store::JsonJobStore;
use super::models::{
    AuthStatus, BatchParseRequest, DriveFileRef, GoogleSignInResult, JobProcessingState, JobStatus,
    ManualAuthChallenge, ManualAuthCompleteRequest, ParsedCandidate, RuntimeSettings,
    RuntimeSettingsUpdate, RuntimeSettingsView,
};
use super::ocr::TesseractCliOcrService;
use super::pdf::PdfTextExtractor;
use super::secret_store::GoogleClientSecretStore;
use super::settings_store::SettingsStore;

const HEADER_COLUMNS: [&str; 6] = [
    "Name",
    "Resume Link",
    "Phone Number",
    "Email ID",
    "LinkedIn",
    "GitHub",
];

struct BatchJobWorkItem {
    job_id: String,
    request: BatchParseRequest,
}

pub struct CoreService {
    settings_store: SettingsStore,
    client_secret_store: GoogleClientSecretStore,
    settings: RwLock<RuntimeSettings>,
    legacy_secret_scrubbed: RwLock<bool>,
    auth: GoogleAuthService,
    drive: GoogleDriveClient,
    sheets: GoogleSheetsClient,
    job_store: Arc<JsonJobStore>,
    queue_tx: mpsc::UnboundedSender<BatchJobWorkItem>,
    cancellation_tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl CoreService {
    pub async fn new() -> anyhow::Result<Arc<Self>> {
        let settings_store = SettingsStore::new();
        let loaded = settings_store.load().await.unwrap_or_else(|_| {
            super::settings_store::LoadSettingsResult {
                persisted: super::models::PersistedSettings::default(),
                legacy_secret_scrubbed: false,
            }
        });
        let client_secret_store = GoogleClientSecretStore::new();
        let secret_from_keychain = client_secret_store.load().unwrap_or(None);
        let secret = if let Some(secret) = secret_from_keychain {
            Some(secret)
        } else {
            let embedded = super::models::default_google_client_secret();
            if let Some(ref value) = embedded {
                let _ = client_secret_store.save(value);
            }
            embedded
        };
        let settings = RuntimeSettings::from_parts(loaded.persisted.sanitized(), secret);

        let client = reqwest::Client::builder()
            .user_agent("SourceStackDesktop/1.0")
            .build()
            .context("failed to build HTTP client")?;

        let auth = GoogleAuthService::new(client.clone());
        let drive = GoogleDriveClient::new(client.clone());
        let sheets = GoogleSheetsClient::new(client);
        let job_store = Arc::new(JsonJobStore::new(settings.job_retention_hours));

        let (queue_tx, queue_rx) = mpsc::unbounded_channel();

        let service = Arc::new(Self {
            settings_store,
            client_secret_store,
            settings: RwLock::new(settings),
            legacy_secret_scrubbed: RwLock::new(loaded.legacy_secret_scrubbed),
            auth,
            drive,
            sheets,
            job_store,
            queue_tx,
            cancellation_tokens: Mutex::new(HashMap::new()),
        });

        let worker_service = Arc::clone(&service);
        tokio::spawn(async move {
            worker_service.process_queue(queue_rx).await;
        });

        Ok(service)
    }

    pub async fn get_settings(&self) -> RuntimeSettingsView {
        let settings = self.settings.read().await.clone();
        let legacy_secret_scrubbed = *self.legacy_secret_scrubbed.read().await;
        settings.to_view(legacy_secret_scrubbed)
    }

    pub async fn save_settings(
        &self,
        new_settings: RuntimeSettingsUpdate,
    ) -> anyhow::Result<RuntimeSettingsView> {
        let previous = self.settings.read().await.clone();
        let mut runtime = RuntimeSettings {
            google_client_id: new_settings
                .google_client_id
                .unwrap_or(previous.google_client_id.clone()),
            google_client_secret: previous.google_client_secret.clone(),
            tesseract_path: new_settings.tesseract_path,
            max_concurrent_requests: new_settings.max_concurrent_requests.max(1),
            spreadsheet_batch_size: new_settings.spreadsheet_batch_size.max(1),
            max_retries: new_settings.max_retries.max(1),
            retry_delay_seconds: new_settings.retry_delay_seconds.max(0.1),
            job_retention_hours: new_settings.job_retention_hours.max(1),
        };

        if let Some(secret_update) = new_settings.google_client_secret {
            let trimmed = secret_update.trim();
            if !trimmed.is_empty() {
                self.client_secret_store.save(trimmed)?;
                runtime.google_client_secret = Some(trimmed.to_string());
                let mut scrubbed = self.legacy_secret_scrubbed.write().await;
                *scrubbed = false;
            }
        }

        self.settings_store.save(&runtime.to_persisted()).await?;
        let mut settings = self.settings.write().await;
        *settings = runtime.clone();

        let legacy_secret_scrubbed = *self.legacy_secret_scrubbed.read().await;
        Ok(runtime.to_view(legacy_secret_scrubbed))
    }

    pub async fn parse_single(
        &self,
        file_name: String,
        file_bytes: Vec<u8>,
    ) -> anyhow::Result<ParsedCandidate> {
        let settings = self.settings.read().await.clone();
        let parser = self.build_parser(&settings);
        let parsed = parser.parse_resume_bytes(&file_name, &file_bytes).await;

        Ok(ParsedCandidate {
            drive_file_id: None,
            source_file: Some(file_name),
            name: parsed.name,
            email: parsed.email,
            phone: parsed.phone,
            linked_in: parsed.linked_in,
            git_hub: parsed.git_hub,
            confidence: parsed.confidence,
            errors: parsed.errors,
        })
    }

    pub async fn start_batch_job(&self, request: BatchParseRequest) -> anyhow::Result<String> {
        if request.folder_id.trim().is_empty() {
            return Err(CoreError::InvalidRequest("FolderId is required".to_string()).into());
        }

        let settings = self.settings.read().await.clone();
        self.auth
            .get_access_token_non_interactive(&settings)
            .await
            .map(|_| ())
            .map_err(|err| {
                if let Some(CoreError::Auth { code, .. }) = err.downcast_ref::<CoreError>() {
                    if matches!(
                        code,
                        AuthErrorCode::SignInRequired | AuthErrorCode::ReauthRequired
                    ) {
                        return CoreError::auth(
                            *code,
                            "Google authentication required before starting a batch job.",
                        )
                        .into();
                    }
                }
                err
            })?;

        self.job_store.cleanup_expired_jobs().await?;

        let job_id = Uuid::new_v4().to_string();
        let pending = JobStatus {
            job_id: job_id.clone(),
            status: JobProcessingState::Pending,
            progress: 0,
            total_files: 0,
            processed_files: 0,
            spreadsheet_id: request.spreadsheet_id.clone(),
            results_count: None,
            error: None,
            created_at: Some(Utc::now()),
            started_at: None,
            completed_at: None,
            duration_seconds: None,
        };

        self.job_store.save_status(&pending).await?;
        self.queue_tx
            .send(BatchJobWorkItem {
                job_id: job_id.clone(),
                request,
            })
            .map_err(|_| anyhow::anyhow!("failed to queue batch job"))?;

        Ok(job_id)
    }

    pub async fn get_job_status(&self, job_id: &str) -> anyhow::Result<JobStatus> {
        self.job_store
            .load_status(job_id)
            .await?
            .ok_or_else(|| CoreError::JobNotFound(job_id.to_string()).into())
    }

    pub async fn get_job_results(&self, job_id: &str) -> anyhow::Result<Vec<ParsedCandidate>> {
        if let Some(results) = self.job_store.load_results(job_id).await? {
            return Ok(results);
        }

        let status = self
            .job_store
            .load_status(job_id)
            .await?
            .ok_or_else(|| CoreError::JobNotFound(job_id.to_string()))?;

        if status.status != JobProcessingState::Completed {
            return Err(CoreError::JobNotCompleted(job_id.to_string()).into());
        }

        Ok(Vec::new())
    }

    pub async fn list_jobs(&self) -> anyhow::Result<Vec<String>> {
        self.job_store.list_jobs().await
    }

    pub async fn cancel_job(&self, job_id: &str) -> anyhow::Result<bool> {
        let token = {
            let map = self.cancellation_tokens.lock().await;
            map.get(job_id).cloned()
        };

        if let Some(cancel_token) = token {
            cancel_token.cancel();
            return Ok(true);
        }

        Ok(false)
    }

    pub async fn google_auth_sign_in(&self) -> anyhow::Result<GoogleSignInResult> {
        let settings = self.settings.read().await.clone();
        self.auth.sign_in(&settings).await
    }

    pub async fn google_auth_begin_manual(&self) -> anyhow::Result<ManualAuthChallenge> {
        let settings = self.settings.read().await.clone();
        self.auth.begin_manual_sign_in(&settings).await
    }

    pub async fn google_auth_complete_manual(
        &self,
        request: ManualAuthCompleteRequest,
    ) -> anyhow::Result<AuthStatus> {
        let settings = self.settings.read().await.clone();
        self.auth.complete_manual_sign_in(&settings, request).await
    }

    pub fn google_auth_sign_out(&self) -> anyhow::Result<()> {
        self.auth.sign_out()
    }

    pub fn google_auth_status(&self) -> anyhow::Result<AuthStatus> {
        self.auth.status()
    }

    async fn process_queue(
        self: Arc<Self>,
        mut queue_rx: mpsc::UnboundedReceiver<BatchJobWorkItem>,
    ) {
        while let Some(work_item) = queue_rx.recv().await {
            if let Err(err) = self.process_batch_job(work_item).await {
                eprintln!("batch worker error: {err}");
            }
        }
    }

    async fn process_batch_job(
        self: &Arc<Self>,
        work_item: BatchJobWorkItem,
    ) -> anyhow::Result<()> {
        let settings = self.settings.read().await.clone();
        let parser = self.build_parser(&settings);

        let started_at = Utc::now();
        let start_ts = Utc::now();

        let created_at = self
            .job_store
            .load_status(&work_item.job_id)
            .await?
            .and_then(|s| s.created_at)
            .or(Some(Utc::now()));

        let cancellation_token = CancellationToken::new();
        {
            let mut map = self.cancellation_tokens.lock().await;
            map.insert(work_item.job_id.clone(), cancellation_token.clone());
        }

        let mut spreadsheet_id = work_item.request.spreadsheet_id.clone();
        let mut results: Vec<ParsedCandidate> = Vec::new();
        let mut processed_count = 0_i32;
        let mut total_files = 0_i32;

        let status_result = self
            .run_batch_pipeline(
                &work_item,
                &settings,
                &parser,
                &cancellation_token,
                &mut spreadsheet_id,
                &mut results,
                &mut processed_count,
                &mut total_files,
                created_at,
                started_at,
            )
            .await;

        {
            let mut map = self.cancellation_tokens.lock().await;
            map.remove(&work_item.job_id);
        }

        match status_result {
            Ok(()) => {
                let completed_at = Utc::now();
                self.job_store
                    .save_results(&work_item.job_id, &results)
                    .await?;

                self.job_store
                    .save_status(&JobStatus {
                        job_id: work_item.job_id,
                        status: JobProcessingState::Completed,
                        progress: 100,
                        total_files,
                        processed_files: processed_count,
                        spreadsheet_id,
                        results_count: Some(results.len() as i32),
                        error: None,
                        created_at,
                        started_at: Some(started_at),
                        completed_at: Some(completed_at),
                        duration_seconds: Some(
                            (completed_at - start_ts).num_milliseconds() as f64 / 1000.0,
                        ),
                    })
                    .await?;
            }
            Err(err) => {
                let completed_at = Utc::now();
                let was_cancelled = cancellation_token.is_cancelled();
                let status = if was_cancelled {
                    JobProcessingState::Revoked
                } else {
                    JobProcessingState::Failed
                };

                self.job_store
                    .save_status(&JobStatus {
                        job_id: work_item.job_id,
                        status,
                        progress: if total_files == 0 {
                            0
                        } else {
                            (((processed_count as f64) * 100.0 / total_files as f64).floor() as i32)
                                .min(99)
                        },
                        total_files,
                        processed_files: processed_count,
                        spreadsheet_id,
                        results_count: Some(results.len() as i32),
                        error: Some(err.to_string()),
                        created_at,
                        started_at: Some(started_at),
                        completed_at: Some(completed_at),
                        duration_seconds: Some(
                            (completed_at - start_ts).num_milliseconds() as f64 / 1000.0,
                        ),
                    })
                    .await?;
            }
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_batch_pipeline(
        &self,
        work_item: &BatchJobWorkItem,
        settings: &RuntimeSettings,
        parser: &ResumeDocumentParser,
        cancellation_token: &CancellationToken,
        spreadsheet_id: &mut Option<String>,
        results: &mut Vec<ParsedCandidate>,
        processed_count: &mut i32,
        total_files: &mut i32,
        created_at: Option<chrono::DateTime<Utc>>,
        started_at: chrono::DateTime<Utc>,
    ) -> anyhow::Result<()> {
        self.job_store
            .save_status(&JobStatus {
                job_id: work_item.job_id.clone(),
                status: JobProcessingState::Processing,
                progress: 0,
                total_files: 0,
                processed_files: 0,
                spreadsheet_id: spreadsheet_id.clone(),
                results_count: None,
                error: None,
                created_at,
                started_at: Some(started_at),
                completed_at: None,
                duration_seconds: None,
            })
            .await?;

        let access_token = self.auth.get_access_token_non_interactive(settings).await?;
        let drive_files = self
            .drive
            .list_resume_files(&access_token, &work_item.request.folder_id)
            .await?;

        if drive_files.is_empty() {
            self.job_store.save_results(&work_item.job_id, &[]).await?;
            *total_files = 0;
            *processed_count = 0;
            return Ok(());
        }

        *total_files = drive_files.len() as i32;

        if spreadsheet_id.as_deref().unwrap_or_default().is_empty() {
            let created_sheet = self
                .sheets
                .create_spreadsheet(
                    &access_token,
                    &format!(
                        "Resume Parse Results - {}",
                        Utc::now().format("%Y-%m-%d %H:%M:%S")
                    ),
                )
                .await?;

            self.sheets
                .append_rows(
                    &access_token,
                    &created_sheet,
                    &[HEADER_COLUMNS
                        .iter()
                        .map(|v| v.to_string())
                        .collect::<Vec<String>>()],
                    false,
                )
                .await?;

            *spreadsheet_id = Some(created_sheet);
        }

        self.job_store
            .save_status(&JobStatus {
                job_id: work_item.job_id.clone(),
                status: JobProcessingState::Processing,
                progress: 0,
                total_files: *total_files,
                processed_files: 0,
                spreadsheet_id: spreadsheet_id.clone(),
                results_count: None,
                error: None,
                created_at,
                started_at: Some(started_at),
                completed_at: None,
                duration_seconds: None,
            })
            .await?;

        let chunk_size = settings.spreadsheet_batch_size.max(1);
        for batch in drive_files.chunks(chunk_size) {
            if cancellation_token.is_cancelled() {
                return Err(anyhow::anyhow!("job canceled"));
            }

            let max_concurrency = settings.max_concurrent_requests.max(1);
            let batch_results: Vec<ParsedCandidate> = stream::iter(batch.iter().cloned())
                .map(|file| {
                    let access_token = access_token.clone();
                    let settings = settings.clone();
                    async move {
                        self.process_single_file_with_retry(file, parser, &access_token, &settings)
                            .await
                    }
                })
                .buffer_unordered(max_concurrency)
                .collect()
                .await;

            let rows: Vec<Vec<String>> = batch_results
                .iter()
                .map(|candidate| {
                    vec![
                        candidate.name.clone().unwrap_or_default(),
                        candidate
                            .drive_file_id
                            .as_ref()
                            .map(|v| format!("https://drive.google.com/file/d/{v}/view"))
                            .unwrap_or_default(),
                        candidate.phone.clone().unwrap_or_default(),
                        candidate.email.clone().unwrap_or_default(),
                        candidate.linked_in.clone().unwrap_or_default(),
                        candidate.git_hub.clone().unwrap_or_default(),
                    ]
                })
                .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
                .collect();

            if !rows.is_empty() {
                if let Some(sheet_id) = spreadsheet_id.as_deref() {
                    self.sheets
                        .append_rows(&access_token, sheet_id, &rows, true)
                        .await?;
                }

                *processed_count += rows.len() as i32;
            }

            results.extend(batch_results);

            let progress = if *total_files == 0 {
                0
            } else {
                (((*processed_count as f64) * 100.0 / *total_files as f64).floor() as i32).min(99)
            };

            self.job_store
                .save_status(&JobStatus {
                    job_id: work_item.job_id.clone(),
                    status: JobProcessingState::Processing,
                    progress,
                    total_files: *total_files,
                    processed_files: *processed_count,
                    spreadsheet_id: spreadsheet_id.clone(),
                    results_count: Some(results.len() as i32),
                    error: None,
                    created_at,
                    started_at: Some(started_at),
                    completed_at: None,
                    duration_seconds: None,
                })
                .await?;
        }

        Ok(())
    }

    async fn process_single_file_with_retry(
        &self,
        file: DriveFileRef,
        parser: &ResumeDocumentParser,
        access_token: &str,
        settings: &RuntimeSettings,
    ) -> ParsedCandidate {
        if file.id.trim().is_empty() {
            return ParsedCandidate::empty(
                Some(file.name),
                None,
                vec!["Missing file ID".to_string()],
            );
        }

        let mut errors = Vec::new();

        for attempt in 0..settings.max_retries {
            let processed = self
                .process_single_file_once(&file, parser, access_token)
                .await;

            match processed {
                Ok(candidate) => return candidate,
                Err(err) => {
                    let retryable = is_retryable_error(&err);
                    let is_last_attempt = attempt + 1 >= settings.max_retries;
                    if retryable && !is_last_attempt {
                        let backoff_seconds =
                            settings.retry_delay_seconds * 2_f64.powf(attempt as f64);
                        tokio::time::sleep(Duration::from_secs_f64(backoff_seconds.max(0.1))).await;
                        continue;
                    }

                    errors.push(format!("Error processing file: {err}"));
                    break;
                }
            }
        }

        ParsedCandidate {
            drive_file_id: Some(file.id),
            source_file: Some(file.name),
            name: None,
            email: None,
            phone: None,
            linked_in: None,
            git_hub: None,
            confidence: 0.0,
            errors,
        }
    }

    async fn process_single_file_once(
        &self,
        file: &DriveFileRef,
        parser: &ResumeDocumentParser,
        access_token: &str,
    ) -> anyhow::Result<ParsedCandidate> {
        let bytes = self.drive.download_file(access_token, &file.id).await?;
        let normalized_file_name = ensure_filename_extension(&file.name, &file.mime_type);
        let parsed = parser
            .parse_resume_bytes(&normalized_file_name, &bytes)
            .await;

        Ok(ParsedCandidate {
            drive_file_id: Some(file.id.clone()),
            source_file: Some(file.name.clone()),
            name: parsed.name,
            email: parsed.email,
            phone: parsed.phone,
            linked_in: parsed.linked_in,
            git_hub: parsed.git_hub,
            confidence: parsed.confidence,
            errors: parsed.errors,
        })
    }

    fn build_parser(&self, settings: &RuntimeSettings) -> ResumeDocumentParser {
        let ocr = TesseractCliOcrService::new(
            if settings.tesseract_path.trim().is_empty() {
                "tesseract".to_string()
            } else {
                settings.tesseract_path.clone()
            },
            Duration::from_secs(120),
        );

        let pdf = PdfTextExtractor::new(ocr);
        ResumeDocumentParser::new(pdf)
    }
}

fn ensure_filename_extension(file_name: &str, mime_type: &str) -> String {
    match mime_type {
        "application/pdf" if !file_name.to_ascii_lowercase().ends_with(".pdf") => {
            format!("{file_name}.pdf")
        }
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            if !file_name.to_ascii_lowercase().ends_with(".docx") =>
        {
            format!("{file_name}.docx")
        }
        _ => file_name.to_string(),
    }
}

fn is_retryable_error(error: &anyhow::Error) -> bool {
    if let Some(core_error) = error.downcast_ref::<CoreError>() {
        return core_error.is_retryable();
    }

    if let Some(reqwest_error) = error.downcast_ref::<reqwest::Error>() {
        if reqwest_error.is_timeout() || reqwest_error.is_connect() {
            return true;
        }

        if let Some(status) = reqwest_error.status() {
            let code = status.as_u16();
            return code == 429 || code >= 500;
        }
    }

    false
}
