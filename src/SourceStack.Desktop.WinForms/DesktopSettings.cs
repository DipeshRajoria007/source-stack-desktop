namespace SourceStack.Desktop.WinForms;

internal sealed class DesktopSettings
{
    public string GoogleClientId { get; set; } = string.Empty;
    public string GoogleClientSecret { get; set; } = string.Empty;
    public string TesseractPath { get; set; } = "tesseract";
    public int MaxConcurrentRequests { get; set; } = 10;
    public int SpreadsheetBatchSize { get; set; } = 100;
    public int MaxRetries { get; set; } = 3;
    public double RetryDelaySeconds { get; set; } = 1.0;

    public static string GetSettingsPath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SourceStack",
            "desktop-settings.json");
    }
}
