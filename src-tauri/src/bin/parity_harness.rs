use std::path::Path;
use std::time::Duration;

use source_stack_desktop_tauri_lib::core::document_parser::ResumeDocumentParser;
use source_stack_desktop_tauri_lib::core::models::ParsedCandidate;
use source_stack_desktop_tauri_lib::core::ocr::TesseractCliOcrService;
use source_stack_desktop_tauri_lib::core::pdf::PdfTextExtractor;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: parity_harness <path-to-resume.pdf|docx>");
        std::process::exit(1);
    }

    let path = &args[1];
    if !Path::new(path).exists() {
        eprintln!("File not found: {path}");
        std::process::exit(2);
    }

    let file_name = Path::new(path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("resume.pdf")
        .to_string();

    let bytes = tokio::fs::read(path).await?;

    let tesseract_path =
        std::env::var("SOURCESTACK_TESSERACT_PATH").unwrap_or_else(|_| "tesseract".to_string());
    let ocr = TesseractCliOcrService::new(tesseract_path, Duration::from_secs(120));
    let pdf = PdfTextExtractor::new(ocr);
    let parser = ResumeDocumentParser::new(pdf);

    let parsed = parser.parse_resume_bytes(&file_name, &bytes).await;
    let candidate = ParsedCandidate {
        drive_file_id: None,
        source_file: Some(file_name),
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone,
        linked_in: parsed.linked_in,
        git_hub: parsed.git_hub,
        confidence: parsed.confidence,
        errors: parsed.errors,
    };

    println!("{}", serde_json::to_string_pretty(&candidate)?);
    Ok(())
}
