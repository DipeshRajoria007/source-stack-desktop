use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::Context;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Clone)]
pub struct TesseractCliOcrService {
    pub tesseract_executable_path: String,
    pub timeout: Duration,
}

impl TesseractCliOcrService {
    pub fn new(tesseract_executable_path: String, timeout: Duration) -> Self {
        Self {
            tesseract_executable_path,
            timeout,
        }
    }

    pub async fn extract_text(&self, pdf_bytes: &[u8]) -> anyhow::Result<String> {
        let temp_dir = tempfile::Builder::new()
            .prefix("sourcestack-ocr-")
            .tempdir()
            .context("failed to create OCR temp dir")?;

        let input_path: PathBuf = temp_dir.path().join("resume.pdf");
        tokio::fs::write(&input_path, pdf_bytes).await?;

        let mut command = Command::new(&self.tesseract_executable_path);
        command
            .arg(&input_path)
            .arg("stdout")
            .arg("-l")
            .arg("eng")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let output = match timeout(self.timeout, command.output()).await {
            Ok(result) => result?,
            Err(_) => return Ok(String::new()),
        };

        if !output.status.success() {
            return Ok(String::new());
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}
