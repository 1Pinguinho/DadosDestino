using System.Text.Json;
using System.Text.RegularExpressions;
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

// config/preferencias.json: as escolhas de quem usa o app (idioma, tema, cores,
// zoom, som, atalhos). Quem joga pelo navegador guarda as suas no próprio navegador.
// Tudo que chega da página é conferido aqui antes de ser salvo.
public sealed class Preferences
{
    public static readonly string[] Languages = { "pt-BR", "en" };
    public static readonly string[] Themes =
        { "purple", "red", "green", "blue", "teal", "gold", "pink", "white", "gray", "black", "custom" };
    public static readonly string[] Colors =
        { "violet", "rose", "amber", "sky", "emerald", "crimson", "teal", "gold", "blue", "slate" };
    private static readonly string[] ShortcutKeys = { "roller.perception", "roller.advantage", "roller.disadvantage" };
    private static readonly Regex HexColor = new("^#[0-9a-fA-F]{6}$");
    private static readonly Regex NotationText = new(@"^[0-9a-zA-Z%!<>=+\-*/(). ]{1,60}$");

    public string Language { get; set; } = "pt-BR";
    public string Theme { get; set; } = "purple";
    public CustomColors Custom { get; set; } = new();
    public double Zoom { get; set; } = 1;
    public bool Animations { get; set; } = true;
    // Tela cheia sem bordas (F11 também liga e desliga).
    public bool Fullscreen { get; set; }
    public bool Sound { get; set; } = true;
    // Volume baixo por padrão, para não assustar quem usa equalizador ou volume alto.
    public int Volume { get; set; } = 20;
    // Trilha ambiente (escolhida pelo mestre): liga/desliga e volume próprios de cada pessoa.
    public bool Ambient { get; set; } = true;
    public int AmbientVolume { get; set; } = 30;
    public string? SeatColor { get; set; }
    public string DiceColor { get; set; } = "classic";
    public string DiceStyle { get; set; } = "classic";
    public DiceColors DiceCustom { get; set; } = new();
    public List<Shortcut>? Shortcuts { get; set; }

    public static Preferences Load()
    {
        var preferences = AppConfigFile.Read<Preferences>("preferencias.json") ?? new Preferences();
        preferences.Normalize();
        return preferences;
    }

    public void Save() => AppConfigFile.Write("preferencias.json", this);

    // Copia o que veio da página, já conferido. Retorna true se algo mudou.
    public bool Apply(Preferences incoming)
    {
        incoming.Normalize();
        var before = JsonSerializer.Serialize(this);
        Language = incoming.Language;
        Theme = incoming.Theme;
        Custom = incoming.Custom;
        Zoom = incoming.Zoom;
        Animations = incoming.Animations;
        Fullscreen = incoming.Fullscreen;
        Sound = incoming.Sound;
        Volume = incoming.Volume;
        Ambient = incoming.Ambient;
        AmbientVolume = incoming.AmbientVolume;
        SeatColor = incoming.SeatColor;
        DiceColor = incoming.DiceColor;
        DiceStyle = incoming.DiceStyle;
        DiceCustom = incoming.DiceCustom;
        Shortcuts = incoming.Shortcuts;
        return before != JsonSerializer.Serialize(this);
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
        Custom ??= new CustomColors();
        Custom.Bg = HexColor.IsMatch(Custom.Bg ?? string.Empty) ? Custom.Bg!.ToLowerInvariant() : CustomColors.DefaultBg;
        Custom.Accent = HexColor.IsMatch(Custom.Accent ?? string.Empty) ? Custom.Accent!.ToLowerInvariant() : CustomColors.DefaultAccent;
        Custom.Glow = HexColor.IsMatch(Custom.Glow ?? string.Empty) ? Custom.Glow!.ToLowerInvariant() : CustomColors.DefaultGlow;
        Zoom = double.IsFinite(Zoom) ? Math.Round(Math.Clamp(Zoom, 0.7, 1.5), 2) : 1;
        Volume = Math.Clamp(Volume, 0, 100);
        AmbientVolume = Math.Clamp(AmbientVolume, 0, 100);
        SeatColor = SeatColor is not null && Colors.Contains(SeatColor) ? SeatColor : null;
        DiceColor = DiceColor is "classic" or "custom" || Colors.Contains(DiceColor) ? DiceColor : "classic";
        DiceStyle = TableHub.DiceStyles.Contains(DiceStyle) ? DiceStyle : "classic";
        DiceCustom ??= new DiceColors();
        DiceCustom.Edge = HexColor.IsMatch(DiceCustom.Edge ?? string.Empty) ? DiceCustom.Edge!.ToLowerInvariant() : DiceColors.DefaultEdge;
        DiceCustom.From = HexColor.IsMatch(DiceCustom.From ?? string.Empty) ? DiceCustom.From!.ToLowerInvariant() : DiceColors.DefaultFrom;
        DiceCustom.To = HexColor.IsMatch(DiceCustom.To ?? string.Empty) ? DiceCustom.To!.ToLowerInvariant() : DiceColors.DefaultTo;
        Shortcuts = Shortcuts?
            .Where(shortcut => shortcut is not null && NotationText.IsMatch(shortcut.Notation ?? string.Empty)
                && (shortcut.Key is null || ShortcutKeys.Contains(shortcut.Key))
                && (shortcut.Name is null || (shortcut.Name.Length <= 24 && !shortcut.Name.Any(char.IsControl))))
            .Take(12)
            .Select(shortcut => new Shortcut { Name = shortcut.Name?.Trim(), Key = shortcut.Key, Notation = shortcut.Notation!.Trim() })
            .ToList();
    }
}

public sealed class CustomColors
{
    public const string DefaultBg = "#101820";
    public const string DefaultAccent = "#6fc3df";
    public const string DefaultGlow = "#c86fdf";

    public string? Bg { get; set; } = DefaultBg;
    public string? Accent { get; set; } = DefaultAccent;
    public string? Glow { get; set; } = DefaultGlow;
}

// Atalho de rolagem: Key é um dos atalhos padrão (traduzido); Name é o nome dado pelo jogador.
public sealed class Shortcut
{
    public string? Name { get; set; }
    public string? Key { get; set; }
    public string? Notation { get; set; }
}

internal static class AppConfigFile
{
    public static readonly JsonSerializerOptions Options = new()
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

// Dados personalizados: cor da borda e degradê de dentro (do início ao fim).
public sealed class DiceColors
{
    public const string DefaultEdge = "#ffd86a";
    public const string DefaultFrom = "#8e5bd6";
    public const string DefaultTo = "#2b1d45";

    public string? Edge { get; set; } = DefaultEdge;
    public string? From { get; set; } = DefaultFrom;
    public string? To { get; set; } = DefaultTo;
}
