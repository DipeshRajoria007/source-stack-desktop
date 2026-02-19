using System.Text.RegularExpressions;
using PhoneNumbers;

namespace SourceStack.Core.Parsing;

public static class ResumeFieldExtractor
{
    private static readonly PhoneNumberUtil PhoneUtil = PhoneNumberUtil.GetInstance();

    public static string? ExtractEmail(string text)
    {
        var mailtoPatterns = new[]
        {
            @"mailto:\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})",
            @"href=[""']mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})[""']",
        };

        foreach (var pattern in mailtoPatterns)
        {
            var matches = Regex.Matches(text, pattern, RegexOptions.IgnoreCase);
            if (matches.Count > 0)
            {
                return matches[0].Groups[1].Value.ToLowerInvariant();
            }
        }

        var keywordContext = Regex.Match(
            text,
            @"(?:email|e-mail|mail)[\s:]*.*?(?:href=[""'])?(?:mailto:)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})",
            RegexOptions.IgnoreCase);

        if (keywordContext.Success)
        {
            return keywordContext.Groups[1].Value.ToLowerInvariant();
        }

        var emailMatch = Regex.Match(text, @"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b");
        return emailMatch.Success ? emailMatch.Value.ToLowerInvariant() : null;
    }

    public static string? NormalizePhone(string text)
    {
        try
        {
            var parsed = PhoneUtil.Parse(text, null);
            if (PhoneUtil.IsValidNumber(parsed))
            {
                return PhoneUtil.Format(parsed, PhoneNumberFormat.E164);
            }
        }
        catch (NumberParseException)
        {
        }

        var cleaned = Regex.Replace(text, @"[\s\-\(\)\.]", string.Empty);
        var matches = Regex.Matches(cleaned, @"\d{7,15}");

        foreach (Match match in matches)
        {
            if (!match.Success)
            {
                continue;
            }

            var candidate = match.Value.Length switch
            {
                10 => $"+91{match.Value}",
                >= 10 => $"+{match.Value}",
                _ => match.Value,
            };

            try
            {
                var parsed = PhoneUtil.Parse(candidate, null);
                if (PhoneUtil.IsValidNumber(parsed))
                {
                    return PhoneUtil.Format(parsed, PhoneNumberFormat.E164);
                }
            }
            catch (NumberParseException)
            {
            }
        }

        return null;
    }

    public static string? ExtractLinkedIn(string text)
    {
        var hrefPatterns = new[]
        {
            @"href=[""'](https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-]+)[""']",
            @"href=[""'](linkedin\.com/in/[a-zA-Z0-9\-]+)[""']",
        };

        foreach (var pattern in hrefPatterns)
        {
            var matches = Regex.Matches(text, pattern, RegexOptions.IgnoreCase);
            if (matches.Count > 0)
            {
                var url = matches[0].Groups[1].Value;
                if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                {
                    url = $"https://www.{url}";
                }

                return url;
            }
        }

        var keywordContext = Regex.Match(
            text,
            @"(?:linkedin|linked\s*in)[\s:]*.*?(?:href=[""'])?(https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-]+)",
            RegexOptions.IgnoreCase);
        if (keywordContext.Success)
        {
            return keywordContext.Groups[1].Value;
        }

        var patterns = new[]
        {
            @"https?://(?:www\.)?linkedin\.com/in/([a-zA-Z0-9\-]+)",
            @"linkedin\.com/in/([a-zA-Z0-9\-]+)",
            @"www\.linkedin\.com/in/([a-zA-Z0-9\-]+)",
            @"linkedin\.com/profile/view\?id=([a-zA-Z0-9\-]+)",
        };

        foreach (var pattern in patterns)
        {
            var matches = Regex.Matches(text, pattern, RegexOptions.IgnoreCase);
            if (matches.Count > 0)
            {
                return $"https://www.linkedin.com/in/{matches[0].Groups[1].Value}";
            }
        }

        var fallback = Regex.Match(
            text,
            @"https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9\-]+",
            RegexOptions.IgnoreCase);
        return fallback.Success ? fallback.Value : null;
    }

    public static string? ExtractGitHub(string text)
    {
        var hrefPatterns = new[]
        {
            @"href=[""'](https?://(?:www\.)?github\.com/[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})[""']",
            @"href=[""'](github\.com/[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})[""']",
        };

        foreach (var pattern in hrefPatterns)
        {
            var matches = Regex.Matches(text, pattern, RegexOptions.IgnoreCase);
            if (matches.Count > 0)
            {
                var url = matches[0].Groups[1].Value;
                if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                {
                    url = $"https://{url}";
                }

                return url;
            }
        }

        var keywordContext = Regex.Match(
            text,
            @"(?:github|git\s*hub)[\s:]*.*?(?:href=[""'])?(https?://(?:www\.)?github\.com/[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})",
            RegexOptions.IgnoreCase);
        if (keywordContext.Success)
        {
            return keywordContext.Groups[1].Value;
        }

        var patterns = new[]
        {
            @"https?://(?:www\.)?github\.com/([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})",
            @"github\.com/([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})",
            @"www\.github\.com/([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})",
        };

        foreach (var pattern in patterns)
        {
            var matches = Regex.Matches(text, pattern, RegexOptions.IgnoreCase);
            if (matches.Count > 0)
            {
                return $"https://github.com/{matches[0].Groups[1].Value}";
            }
        }

        var fallback = Regex.Match(
            text,
            @"https?://(?:www\.)?github\.com/[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}",
            RegexOptions.IgnoreCase);

        return fallback.Success ? fallback.Value : null;
    }

    public static (string? Email, string? Phone, string? LinkedIn, string? GitHub) ExtractFields(string text)
    {
        var email = ExtractEmail(text);
        var phone = NormalizePhone(text);
        var linkedIn = ExtractLinkedIn(text);
        var gitHub = ExtractGitHub(text);
        return (email, phone, linkedIn, gitHub);
    }

    public static string? GuessName(string text)
    {
        var lines = text.Split('\n', StringSplitOptions.None);
        var candidateLines = lines.Take(30).ToList();

        var keywords = new[] { "email", "phone", "contact", "mobile", "tel" };
        for (var i = 0; i < Math.Min(50, lines.Length); i++)
        {
            var lower = lines[i].ToLowerInvariant();
            if (keywords.Any(keyword => lower.Contains(keyword, StringComparison.Ordinal)) && i > 0)
            {
                candidateLines.Add(lines[i - 1]);
            }
        }

        foreach (var rawLine in candidateLines)
        {
            var line = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (line.Contains('@') || Regex.IsMatch(line, @"^\+?\d") || line.Length > 50)
            {
                continue;
            }

            var words = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (words.Length < 2 || words.Length > 4)
            {
                continue;
            }

            if (words.All(word => word.Length > 0 && char.IsUpper(word[0])))
            {
                return line;
            }
        }

        return null;
    }

    public static double ScoreConfidence(
        string? name,
        string? email,
        string? phone,
        string? linkedIn,
        string? gitHub,
        bool ocrUsed)
    {
        var score = 0d;

        if (!string.IsNullOrWhiteSpace(email))
        {
            score += 0.4;
        }

        if (!string.IsNullOrWhiteSpace(phone))
        {
            score += 0.25;
        }

        if (!string.IsNullOrWhiteSpace(name))
        {
            score += 0.15;
        }

        if (!string.IsNullOrWhiteSpace(linkedIn))
        {
            score += 0.1;
        }

        if (!string.IsNullOrWhiteSpace(gitHub))
        {
            score += 0.05;
        }

        if (!ocrUsed)
        {
            score += 0.05;
        }

        return Math.Min(score, 1d);
    }
}
