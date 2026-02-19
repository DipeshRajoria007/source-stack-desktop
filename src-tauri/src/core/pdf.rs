use once_cell::sync::Lazy;
use regex::Regex;

use super::ocr::TesseractCliOcrService;

static URL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"https?://[^\s<>'"\)]+"#).unwrap());

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

        let extraction = self.extract_pdf_text(data);
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

    fn extract_pdf_text(&self, data: &[u8]) -> anyhow::Result<String> {
        let text = pdf_extract::extract_text_from_mem(data)?;
        Ok(text)
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
