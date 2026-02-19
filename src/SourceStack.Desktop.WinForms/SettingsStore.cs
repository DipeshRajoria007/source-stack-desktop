using System.Text.Json;

namespace SourceStack.Desktop.WinForms;

internal static class SettingsStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static DesktopSettings Load()
    {
        var path = DesktopSettings.GetSettingsPath();
        if (!File.Exists(path))
        {
            return new DesktopSettings();
        }

        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<DesktopSettings>(json, SerializerOptions) ?? new DesktopSettings();
        }
        catch
        {
            return new DesktopSettings();
        }
    }

    public static void Save(DesktopSettings settings)
    {
        var path = DesktopSettings.GetSettingsPath();
        var directory = Path.GetDirectoryName(path);

        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var json = JsonSerializer.Serialize(settings, SerializerOptions);
        File.WriteAllText(path, json);
    }
}
