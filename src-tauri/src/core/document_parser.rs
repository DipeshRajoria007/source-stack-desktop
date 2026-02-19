use std::io::{Cursor, Read};

use quick_xml::events::Event;
use quick_xml::Reader;

use super::field_extractor;
use super::models::ResumeExtractionResult;
use super::pdf::PdfTextExtractor;

pub struct ResumeDocumentParser {
    pdf_text_extractor: PdfTextExtractor,
}

impl ResumeDocumentParser {
    pub fn new(pdf_text_extractor: PdfTextExtractor) -> Self {
        Self { pdf_text_extractor }
    }

    pub async fn parse_resume_bytes(&self, file_name: &str, data: &[u8]) -> ResumeExtractionResult {
        let mut errors = Vec::new();
        let mut ocr_used = false;

        let extension = std::path::Path::new(file_name)
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| v.to_ascii_lowercase())
            .unwrap_or_default();

        let text = match extension.as_str() {
            "pdf" => match self
                .pdf_text_extractor
                .extract_text_with_ocr_fallback(data)
                .await
            {
                Ok((text, used_ocr)) => {
                    ocr_used = used_ocr;
                    text
                }
                Err(err) => {
                    errors.push(format!("Parse error: {err}"));
                    String::new()
                }
            },
            "docx" => match extract_docx_text(data) {
                Ok(text) => text,
                Err(err) => {
                    errors.push(format!("Parse error: {err}"));
                    String::new()
                }
            },
            _ => {
                errors.push(format!("Unsupported file type: {file_name}"));
                String::new()
            }
        };

        if text.is_empty() && !errors.is_empty() {
            return ResumeExtractionResult {
                name: None,
                email: None,
                phone: None,
                linked_in: None,
                git_hub: None,
                confidence: 0.0,
                ocr_used,
                errors,
            };
        }

        let (email, phone, linked_in, git_hub) = field_extractor::extract_fields(&text);
        let name = field_extractor::guess_name(&text);
        let confidence = field_extractor::score_confidence(
            name.as_deref(),
            email.as_deref(),
            phone.as_deref(),
            linked_in.as_deref(),
            git_hub.as_deref(),
            ocr_used,
        );

        ResumeExtractionResult {
            name,
            email,
            phone,
            linked_in,
            git_hub,
            confidence,
            ocr_used,
            errors,
        }
    }
}

fn extract_docx_text(data: &[u8]) -> anyhow::Result<String> {
    let cursor = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)?;

    let mut document_file = archive.by_name("word/document.xml")?;
    let mut xml = String::new();
    document_file.read_to_string(&mut xml)?;

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut current = String::new();
    let mut lines = Vec::new();
    let mut in_paragraph = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if e.name().as_ref() == b"w:p" {
                    in_paragraph = true;
                    current.clear();
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"w:p" {
                    if !current.trim().is_empty() {
                        lines.push(current.trim().to_string());
                    }
                    current.clear();
                    in_paragraph = false;
                }
            }
            Ok(Event::Text(e)) => {
                if in_paragraph {
                    let value = e.xml_content()?.into_owned();
                    current.push_str(&value);
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(err.into()),
            _ => {}
        }

        buf.clear();
    }

    Ok(lines.join("\n"))
}
