using SourceStack.Core.Parsing;

namespace SourceStack.Core.Tests;

public sealed class ResumeFieldExtractorTests
{
    [Fact]
    public void ExtractEmail_FindsStandardAddresses()
    {
        Assert.Equal("john.doe@example.com", ResumeFieldExtractor.ExtractEmail("Contact me at john.doe@example.com"));
        Assert.Equal("jane.smith@company.co.uk", ResumeFieldExtractor.ExtractEmail("Email: jane.smith@company.co.uk"));
        Assert.Null(ResumeFieldExtractor.ExtractEmail("No email here"));
    }

    [Fact]
    public void NormalizePhone_HandlesIndianDefaultsAndFormattedNumbers()
    {
        Assert.Equal("+919876543210", ResumeFieldExtractor.NormalizePhone("9876543210"));
        Assert.Equal("+919876543210", ResumeFieldExtractor.NormalizePhone("98765 43210"));
        Assert.Equal("+919876543210", ResumeFieldExtractor.NormalizePhone("(987) 654-3210"));
        Assert.Equal("+919876543210", ResumeFieldExtractor.NormalizePhone("+919876543210"));

        var usResult = ResumeFieldExtractor.NormalizePhone("+1-555-123-4567");
        Assert.True(usResult is null || usResult.StartsWith("+1", StringComparison.Ordinal));

        Assert.Null(ResumeFieldExtractor.NormalizePhone("12345"));
        Assert.Null(ResumeFieldExtractor.NormalizePhone("not a phone"));
    }

    [Fact]
    public void ExtractLinkedIn_ExtractsSupportedFormats()
    {
        Assert.Equal("https://www.linkedin.com/in/johndoe", ResumeFieldExtractor.ExtractLinkedIn("Visit linkedin.com/in/johndoe"));
        Assert.Equal("https://www.linkedin.com/in/jane-smith", ResumeFieldExtractor.ExtractLinkedIn("LinkedIn: https://www.linkedin.com/in/jane-smith"));
        Assert.Null(ResumeFieldExtractor.ExtractLinkedIn("No LinkedIn here"));
    }

    [Fact]
    public void ExtractGitHub_ExtractsSupportedFormats()
    {
        Assert.Equal("https://github.com/johndoe", ResumeFieldExtractor.ExtractGitHub("Check github.com/johndoe"));
        Assert.Equal("https://github.com/jane-smith", ResumeFieldExtractor.ExtractGitHub("GitHub: https://github.com/jane-smith"));
        Assert.Null(ResumeFieldExtractor.ExtractGitHub("No GitHub here"));
    }

    [Fact]
    public void ExtractFields_ReturnsAllExpectedFields()
    {
        var text = """
                   John Doe
                   Email: john.doe@example.com
                   Phone: 9876543210
                   LinkedIn: linkedin.com/in/johndoe
                   GitHub: github.com/johndoe
                   """;

        var (email, phone, linkedIn, gitHub) = ResumeFieldExtractor.ExtractFields(text);

        Assert.Equal("john.doe@example.com", email);
        Assert.Equal("+919876543210", phone);
        Assert.Equal("https://www.linkedin.com/in/johndoe", linkedIn);
        Assert.Equal("https://github.com/johndoe", gitHub);
    }

    [Fact]
    public void GuessName_UsesEarlyLinesAndContactContext()
    {
        var text = """
                   John Michael Doe
                   Email: john@example.com
                   Phone: 1234567890
                   """;

        Assert.Equal("John Michael Doe", ResumeFieldExtractor.GuessName(text));
    }

    [Fact]
    public void ScoreConfidence_MatchesExistingWeights()
    {
        Assert.Equal(
            1d,
            ResumeFieldExtractor.ScoreConfidence(
                "John Doe",
                "john@example.com",
                "+919876543210",
                "https://linkedin.com/in/johndoe",
                "https://github.com/johndoe",
                ocrUsed: false));

        var emailPhoneOnly = ResumeFieldExtractor.ScoreConfidence(null, "john@example.com", "+919876543210", null, null, false);
        Assert.True(Math.Abs(emailPhoneOnly - 0.7) < 0.01);

        Assert.Equal(0.45, ResumeFieldExtractor.ScoreConfidence(null, "john@example.com", null, null, null, false));
        Assert.Equal(0.9, ResumeFieldExtractor.ScoreConfidence("John Doe", "john@example.com", "+919876543210", "https://linkedin.com/in/johndoe", null, true));
        Assert.Equal(0.05, ResumeFieldExtractor.ScoreConfidence(null, null, null, null, null, false));
    }
}
