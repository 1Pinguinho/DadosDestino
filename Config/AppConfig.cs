using System.Text.Json;
using System.Text.Json.Serialization;

namespace RolagemRpg;

// config/config.json: ajustes do servidor da mesa. Pode ser editado com o Bloco de
// Notas com o app fechado; valores fora do limite são corrigidos ao abrir.
public sealed class ServerConfig
{
    public int Port { get; set; } = 8766;
    public int MaxRooms { get; set; } = 50;
    public int MaxPlayersPerRoom { get; set; } = 12;
    public int MaxSpectatorsPerRoom { get; set; } = 10;

    public static ServerConfig Load()
    {
        var config = AppConfigFile.Read<ServerConfig>("config.json") ?? new ServerConfig();
        config.Port = config.Port is >= 1024 and <= 65535 ? config.Port : 8766;
        config.MaxRooms = Math.Clamp(config.MaxRooms, 1, 200);
        config.MaxPlayersPerRoom = Math.Clamp(config.MaxPlayersPerRoom, 2, 16);
        config.MaxSpectatorsPerRoom = Math.Clamp(config.MaxSpectatorsPerRoom, 0, 30);
        AppConfigFile.Write("config.json", config);
        return config;
    }
}

// config/preferencias.json: idioma e tema escolhidos no app.
public sealed class Preferences
{
    public static readonly string[] Languages = { "pt-BR", "en" };
    public static readonly string[] Themes = { "purple", "red", "green", "white", "gray", "black" };

    public string Language { get; set; } = "pt-BR";
    public string Theme { get; set; } = "purple";

    public static Preferences Load()
    {
        var preferences = AppConfigFile.Read<Preferences>("preferencias.json") ?? new Preferences();
        preferences.Normalize();
        return preferences;
    }

    public void Save() => AppConfigFile.Write("preferencias.json", this);

    public bool Apply(string? language, string? theme)
    {
        var changed = false;
        if (language is not null && Languages.Contains(language) && language != Language)
        {
            Language = language;
            changed = true;
        }
        if (theme is not null && Themes.Contains(theme) && theme != Theme)
        {
            Theme = theme;
            changed = true;
        }
        return changed;
    }

    private void Normalize()
    {
        if (!Languages.Contains(Language))
        {
            Language = System.Globalization.CultureInfo.CurrentUICulture.Name.StartsWith("pt", StringComparison.OrdinalIgnoreCase) ? "pt-BR" : "en";
        }
        if (!Themes.Contains(Theme))
        {
            Theme = "purple";
        }
    }
}

internal static class AppConfigFile
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static T? Read<T>(string fileName) where T : class
    {
        try
        {
            var path = Path.Combine(AppPaths.ConfigFolder, fileName);
            return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options) : null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            // Arquivo ilegível ou editado com erro: usa os valores padrão.
            return null;
        }
    }

    public static void Write<T>(string fileName, T value)
    {
        try
        {
            File.WriteAllText(Path.Combine(AppPaths.ConfigFolder, fileName), JsonSerializer.Serialize(value, Options));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Sem permissão de escrita: a configuração vale só até fechar.
        }
    }
}
