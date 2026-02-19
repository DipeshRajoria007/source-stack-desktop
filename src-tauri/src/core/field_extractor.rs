use once_cell::sync::Lazy;
use regex::Regex;

static MAILTO_REGEXES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"mailto:\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})").unwrap(),
        Regex::new(r#"href=["']mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})["']"#)
            .unwrap(),
    ]
});

static KEYWORD_EMAIL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?:email|e-mail|mail)[\s:]*.*?(?:href=["'])?(?:mailto:)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"#)
        .unwrap()
});

static EMAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b").unwrap());
static PHONE_CLEAN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\s\-\(\)\.]").unwrap());
static DIGIT_SEQ_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\d{7,15}").unwrap());
static NAME_STARTS_WITH_PHONE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\+?\d").unwrap());

static LINKEDIN_HREF_RES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r#"href=["'](https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-]+)["']"#).unwrap(),
        Regex::new(r#"href=["'](linkedin\.com/in/[a-zA-Z0-9\-]+)["']"#).unwrap(),
    ]
});

static LINKEDIN_KEYWORD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?:linkedin|linked\s*in)[\s:]*.*?(?:href=["'])?(https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-]+)"#)
        .unwrap()
});

static LINKEDIN_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"https?://(?:www\.)?linkedin\.com/in/([a-zA-Z0-9\-]+)").unwrap(),
        Regex::new(r"linkedin\.com/in/([a-zA-Z0-9\-]+)").unwrap(),
        Regex::new(r"www\.linkedin\.com/in/([a-zA-Z0-9\-]+)").unwrap(),
        Regex::new(r"linkedin\.com/profile/view\?id=([a-zA-Z0-9\-]+)").unwrap(),
    ]
});

static LINKEDIN_FALLBACK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-]+").unwrap());

static GITHUB_HREF_RES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r#"href=["'](https?://(?:www\.)?github\.com/[A-Za-z0-9-]{1,39})["']"#).unwrap(),
        Regex::new(r#"href=["'](github\.com/[A-Za-z0-9-]{1,39})["']"#).unwrap(),
    ]
});

static GITHUB_KEYWORD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?:github|git\s*hub)[\s:]*.*?(?:href=["'])?(https?://(?:www\.)?github\.com/[A-Za-z0-9-]{1,39})"#)
        .unwrap()
});

static GITHUB_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"https?://(?:www\.)?github\.com/([A-Za-z0-9-]{1,39})").unwrap(),
        Regex::new(r"github\.com/([A-Za-z0-9-]{1,39})").unwrap(),
        Regex::new(r"www\.github\.com/([A-Za-z0-9-]{1,39})").unwrap(),
    ]
});

static GITHUB_FALLBACK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"https?://(?:www\.)?github\.com/[A-Za-z0-9-]{1,39}").unwrap());

pub fn extract_email(text: &str) -> Option<String> {
    for regex in &*MAILTO_REGEXES {
        if let Some(captures) = regex.captures(text) {
            if let Some(email) = captures.get(1) {
                return Some(email.as_str().to_lowercase());
            }
        }
    }

    if let Some(captures) = KEYWORD_EMAIL_RE.captures(text) {
        if let Some(email) = captures.get(1) {
            return Some(email.as_str().to_lowercase());
        }
    }

    EMAIL_RE.find(text).map(|m| m.as_str().to_lowercase())
}

pub fn normalize_phone(text: &str) -> Option<String> {
    if let Some(normalized) = format_if_valid_phone(text) {
        return Some(normalized);
    }

    let cleaned = PHONE_CLEAN_RE.replace_all(text, "");
    for m in DIGIT_SEQ_RE.find_iter(&cleaned) {
        let digits = m.as_str();
        let candidate = if digits.len() == 10 {
            format!("+91{digits}")
        } else if digits.len() >= 10 {
            format!("+{digits}")
        } else {
            digits.to_string()
        };

        if let Some(normalized) = format_if_valid_phone(&candidate) {
            return Some(normalized);
        }
    }

    None
}

pub fn extract_linkedin(text: &str) -> Option<String> {
    for regex in &*LINKEDIN_HREF_RES {
        if let Some(captures) = regex.captures(text) {
            let mut url = captures.get(1)?.as_str().to_string();
            if !url.to_ascii_lowercase().starts_with("http") {
                url = format!("https://www.{url}");
            }
            return Some(url);
        }
    }

    if let Some(captures) = LINKEDIN_KEYWORD_RE.captures(text) {
        return captures.get(1).map(|m| m.as_str().to_string());
    }

    for regex in &*LINKEDIN_PATTERNS {
        if let Some(captures) = regex.captures(text) {
            if let Some(username) = captures.get(1) {
                return Some(format!("https://www.linkedin.com/in/{}", username.as_str()));
            }
        }
    }

    LINKEDIN_FALLBACK_RE
        .find(text)
        .map(|m| m.as_str().to_string())
}

pub fn extract_github(text: &str) -> Option<String> {
    for regex in &*GITHUB_HREF_RES {
        if let Some(captures) = regex.captures(text) {
            let mut url = captures.get(1)?.as_str().to_string();
            if !url.to_ascii_lowercase().starts_with("http") {
                url = format!("https://{url}");
            }
            return Some(url);
        }
    }

    if let Some(captures) = GITHUB_KEYWORD_RE.captures(text) {
        return captures.get(1).map(|m| m.as_str().to_string());
    }

    for regex in &*GITHUB_PATTERNS {
        if let Some(captures) = regex.captures(text) {
            if let Some(username) = captures.get(1) {
                return Some(format!("https://github.com/{}", username.as_str()));
            }
        }
    }

    GITHUB_FALLBACK_RE
        .find(text)
        .map(|m| m.as_str().to_string())
}

pub fn extract_fields(
    text: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    (
        extract_email(text),
        normalize_phone(text),
        extract_linkedin(text),
        extract_github(text),
    )
}

pub fn guess_name(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut candidate_lines: Vec<&str> = lines.iter().take(30).copied().collect();

    let keywords = ["email", "phone", "contact", "mobile", "tel"];
    for i in 0..lines.len().min(50) {
        let lower = lines[i].to_lowercase();
        if keywords.iter().any(|k| lower.contains(k)) && i > 0 {
            candidate_lines.push(lines[i - 1]);
        }
    }

    for raw in candidate_lines {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }

        if line.contains('@') || line.len() > 50 || NAME_STARTS_WITH_PHONE_RE.is_match(line) {
            continue;
        }

        let words: Vec<&str> = line.split_whitespace().collect();
        if words.len() < 2 || words.len() > 4 {
            continue;
        }

        if words
            .iter()
            .all(|w| w.chars().next().map(|c| c.is_uppercase()).unwrap_or(false))
        {
            return Some(line.to_string());
        }
    }

    None
}

pub fn score_confidence(
    name: Option<&str>,
    email: Option<&str>,
    phone: Option<&str>,
    linked_in: Option<&str>,
    git_hub: Option<&str>,
    ocr_used: bool,
) -> f64 {
    let mut score: f64 = 0.0;

    if email.is_some_and(|v| !v.trim().is_empty()) {
        score += 0.4;
    }
    if phone.is_some_and(|v| !v.trim().is_empty()) {
        score += 0.25;
    }
    if name.is_some_and(|v| !v.trim().is_empty()) {
        score += 0.15;
    }
    if linked_in.is_some_and(|v| !v.trim().is_empty()) {
        score += 0.1;
    }
    if git_hub.is_some_and(|v| !v.trim().is_empty()) {
        score += 0.05;
    }
    if !ocr_used {
        score += 0.05;
    }

    score.min(1.0)
}

fn format_if_valid_phone(input: &str) -> Option<String> {
    let parsed = phonenumber::parse(None, input).ok()?;
    if !phonenumber::is_valid(&parsed) {
        return None;
    }

    Some(parsed.format().mode(phonenumber::Mode::E164).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_email_finds_standard_addresses() {
        assert_eq!(
            extract_email("Contact me at john.doe@example.com"),
            Some("john.doe@example.com".to_string())
        );
        assert_eq!(
            extract_email("Email: jane.smith@company.co.uk"),
            Some("jane.smith@company.co.uk".to_string())
        );
        assert_eq!(extract_email("No email here"), None);
    }

    #[test]
    fn normalize_phone_handles_indian_defaults_and_formatted_numbers() {
        assert_eq!(
            normalize_phone("9876543210"),
            Some("+919876543210".to_string())
        );
        assert_eq!(
            normalize_phone("98765 43210"),
            Some("+919876543210".to_string())
        );
        assert_eq!(
            normalize_phone("(987) 654-3210"),
            Some("+919876543210".to_string())
        );
        assert_eq!(
            normalize_phone("+919876543210"),
            Some("+919876543210".to_string())
        );

        let us = normalize_phone("+1-555-123-4567");
        assert!(us.is_none() || us.unwrap_or_default().starts_with("+1"));

        assert_eq!(normalize_phone("12345"), None);
        assert_eq!(normalize_phone("not a phone"), None);
    }

    #[test]
    fn extract_linkedin_formats_supported_values() {
        assert_eq!(
            extract_linkedin("Visit linkedin.com/in/johndoe"),
            Some("https://www.linkedin.com/in/johndoe".to_string())
        );
        assert_eq!(
            extract_linkedin("LinkedIn: https://www.linkedin.com/in/jane-smith"),
            Some("https://www.linkedin.com/in/jane-smith".to_string())
        );
        assert_eq!(extract_linkedin("No LinkedIn here"), None);
    }

    #[test]
    fn extract_github_formats_supported_values() {
        assert_eq!(
            extract_github("Check github.com/johndoe"),
            Some("https://github.com/johndoe".to_string())
        );
        assert_eq!(
            extract_github("GitHub: https://github.com/jane-smith"),
            Some("https://github.com/jane-smith".to_string())
        );
        assert_eq!(extract_github("No GitHub here"), None);
    }

    #[test]
    fn score_confidence_matches_weights() {
        let max = score_confidence(
            Some("John Doe"),
            Some("john@example.com"),
            Some("+919876543210"),
            Some("https://linkedin.com/in/johndoe"),
            Some("https://github.com/johndoe"),
            false,
        );
        assert!((max - 1.0).abs() < 0.001);

        let email_phone = score_confidence(
            None,
            Some("john@example.com"),
            Some("+919876543210"),
            None,
            None,
            false,
        );
        assert!((email_phone - 0.7).abs() < 0.01);

        let email_only = score_confidence(None, Some("john@example.com"), None, None, None, false);
        assert!((email_only - 0.45).abs() < 0.01);
    }
}
