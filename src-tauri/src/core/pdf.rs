use std::ffi::OsString;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::Context;
use once_cell::sync::Lazy;
use regex::Regex;
use tokio::process::Command;
use tokio::time::timeout;

use super::ocr::TesseractCliOcrService;

static URL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"https?://[^\s<>'"\)]+"#).unwrap());
const PDF_EXTRACT_HELPER_FLAG: &str = "--source-stack-pdf-extract-helper";
const PDF_EXTRACT_TIMEOUT: Duration = Duration::from_secs(30);

pub struct PdfTextExtractor {
    ocr_service: TesseractCliOcrService,
}

impl PdfTextExtractor {
    pub fn new(ocr_service: TesseractCliOcrService) -> Self {
        Self { ocr_service }
    }

    pub async fn extract_text_with_ocr_fallback(
        &self,
        data: &[u8],
    ) -> anyhow::Result<(String, bool)> {
        let mut ocr_used = false;

        let extraction = self.extract_pdf_text(data).await;
        let text = match extraction {
            Ok(mut text) => {
                let links = extract_hyperlinks(data);
                if !links.is_empty() {
                    text.push('\n');
                    text.push_str(&links.join("\n"));
                }

                if text.trim().len() < 50 {
                    ocr_used = true;
                    self.ocr_service.extract_text(data).await?
                } else {
                    text
                }
            }
            Err(_) => {
                ocr_used = true;
                self.ocr_service.extract_text(data).await?
            }
        };

        Ok((text, ocr_used))
    }

    async fn extract_pdf_text(&self, data: &[u8]) -> anyhow::Result<String> {
        let temp_dir = tempfile::Builder::new()
            .prefix("sourcestack-pdf-")
            .tempdir()
            .context("failed to create PDF extraction temp dir")?;
        let input_path = temp_dir.path().join("resume.pdf");
        tokio::fs::write(&input_path, data).await?;

        let current_exe =
            std::env::current_exe().context("failed to resolve current executable")?;
        let mut command = Command::new(current_exe);
        // Run PDF extraction out-of-process so a bad PDF cannot pin the Tokio worker indefinitely.
        command
            .arg(PDF_EXTRACT_HELPER_FLAG)
            .arg(&input_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let output = match timeout(PDF_EXTRACT_TIMEOUT, command.output()).await {
            Ok(result) => result.context("failed to run PDF extraction helper")?,
            Err(_) => anyhow::bail!(
                "PDF text extraction timed out after {} seconds",
                PDF_EXTRACT_TIMEOUT.as_secs()
            ),
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                anyhow::bail!("PDF extraction helper exited with status {}", output.status);
            }

            anyhow::bail!("{stderr}");
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

fn extract_hyperlinks(data: &[u8]) -> Vec<String> {
    let raw = String::from_utf8_lossy(data);
    let mut links: Vec<String> = Vec::new();
    for m in URL_RE.find_iter(&raw) {
        let value = m.as_str().to_string();
        if !links
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&value))
        {
            links.push(value);
        }
    }

    links
}

pub fn maybe_run_pdf_extract_helper_from_args() -> anyhow::Result<bool> {
    let mut args = std::env::args_os();
    let _binary = args.next();
    let Some(flag) = args.next() else {
        return Ok(false);
    };

    if flag != OsString::from(PDF_EXTRACT_HELPER_FLAG) {
        return Ok(false);
    }

    let Some(input_path) = args.next() else {
        anyhow::bail!("missing input path for PDF extraction helper");
    };

    if args.next().is_some() {
        anyhow::bail!("unexpected extra arguments for PDF extraction helper");
    }

    let input_path = PathBuf::from(input_path);
    let bytes = std::fs::read(&input_path)
        .with_context(|| format!("failed to read PDF helper input {}", input_path.display()))?;
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .with_context(|| format!("failed to extract PDF text from {}", input_path.display()))?;

    std::io::stdout()
        .write_all(text.as_bytes())
        .context("failed to write PDF helper output")?;
    std::io::stdout()
        .flush()
        .context("failed to flush PDF helper output")?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::PDF_EXTRACT_HELPER_FLAG;

    #[test]
    fn helper_flag_is_stable() {
        assert_eq!(PDF_EXTRACT_HELPER_FLAG, "--source-stack-pdf-extract-helper");
    }
}
