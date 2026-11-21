using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RolagemRpg;

// Janela do app. Começa na tela inicial (hospedar ou entrar numa mesa) e depois
// mostra a mesa: a deste computador, ou a de um amigo pelo link que ele mandou.
// Idioma e tema escolhidos em qualquer tela ficam salvos em config/preferencias.json.
public sealed class MainWindow : Form
{
    private const string AppTitle = "Dados & Destino";
    private const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    // Cor de fundo da janela enquanto a página carrega, por tema.
    private static readonly Dictionary<string, Color> ThemeBackgrounds = new()
    {
        ["purple"] = Color.FromArgb(16, 14, 20),
        ["red"] = Color.FromArgb(20, 12, 13),
        ["green"] = Color.FromArgb(11, 17, 14),
        ["blue"] = Color.FromArgb(10, 14, 24),
        ["teal"] = Color.FromArgb(9, 18, 19),
        ["gold"] = Color.FromArgb(19, 16, 10),
        ["pink"] = Color.FromArgb(20, 12, 18),
        ["white"] = Color.FromArgb(245, 242, 238),
        ["gray"] = Color.FromArgb(18, 19, 21),
        ["black"] = Color.FromArgb(5, 5, 5),
    };

    private readonly HostSession host;
    private readonly Preferences preferences;
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly bool hostOnStart;
    private bool showingLauncher;
    private string titleState = "launcher";

    public MainWindow(HostSession host, Preferences preferences, bool hostOnStart = false)
    {
        this.host = host;
        this.preferences = preferences;
        this.hostOnStart = hostOnStart;
        Text = AppTitle;
        ApplyBackground();
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1280, 880);
        MinimumSize = new Size(420, 600);
        try
        {
            Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath);
        }
        catch (ArgumentException)
        {
            // Sem ícone próprio: usa o padrão do Windows.
        }
        Controls.Add(webView);
        Load += async (_, _) => await InitializeWebViewAsync();
    }

    private bool English => preferences.Language == "en";

    private async Task InitializeWebViewAsync()
    {
        try
        {
            // Dados do navegador do app (nome do jogador, histórico) ficam em dados/navegador.
            var environment = await CoreWebView2Environment.CreateAsync(null, AppPaths.BrowserFolder);
            await webView.EnsureCoreWebView2Async(environment);
            var core = webView.CoreWebView2;
            var settings = core.Settings;
            settings.IsStatusBarEnabled = false;
            // Segurança: a página da mesa não acessa nada do Windows, não guarda
            // senhas nem dados de formulário, e as ferramentas de desenvolvedor ficam fechadas.
            settings.AreHostObjectsAllowed = false;
            settings.IsPasswordAutosaveEnabled = false;
            settings.IsGeneralAutofillEnabled = false;
            settings.AreDevToolsEnabled = false;
            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                OpenInDefaultBrowser(args.Uri);
            };
            core.NavigationStarting += OnNavigationStarting;
            core.FrameNavigationStarting += OnNavigationStarting;
            // Nenhuma mesa precisa baixar arquivos nem usar câmera, microfone ou localização.
            core.DownloadStarting += (_, args) => args.Cancel = true;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationCompleted += OnNavigationCompleted;
            // Assim que a mesa carrega, recebe o idioma e o tema salvos no app.
            core.DOMContentLoaded += (_, _) =>
            {
                if (!showingLauncher)
                {
                    SendSettings();
                }
            };
            ShowLauncher(null);
            if (hostOnStart)
            {
                await StartHostingAsync();
            }
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var install = MessageBox.Show(
                English
                    ? "This app needs the Microsoft Edge WebView2 Runtime, which was not found.\n\nOpen the download page now?"
                    : "Este app precisa do Microsoft Edge WebView2 Runtime, que não foi encontrado.\n\nAbrir a página de download agora?",
                AppTitle,
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (install == DialogResult.Yes)
            {
                OpenInDefaultBrowser(WebView2DownloadUrl);
            }
            Close();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            MessageBox.Show(exception.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    // Dentro do app só abrem a tela inicial e endereços de mesa. Qualquer outro
    // site vai para o navegador padrão, longe dos dados guardados no app.
    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (args.Uri.StartsWith("data:text/html", StringComparison.Ordinal) && showingLauncher)
        {
            return;
        }
        if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) && IsTableAddress(target))
        {
            return;
        }
        args.Cancel = true;
        OpenInDefaultBrowser(args.Uri);
    }

    // Endereços de mesa: este computador, links da Cloudflare (*.trycloudflare.com)
    // e IPs de rede local ou VPN (modo --server).
    private static bool IsTableAddress(Uri address)
    {
        if (address.Scheme != Uri.UriSchemeHttp && address.Scheme != Uri.UriSchemeHttps)
        {
            return false;
        }
        var host = address.IdnHost;
        return host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || IPAddress.TryParse(host.Trim('[', ']'), out _)
            || (address.Scheme == Uri.UriSchemeHttps && host.EndsWith(".trycloudflare.com", StringComparison.OrdinalIgnoreCase));
    }

    // A tela inicial é lida de launcher/launcher.html a cada vez, já com o idioma,
    // o tema e as cores dos temas (de site/src/themes.css).
    private void ShowLauncher(string? messageCode, string? detail = null)
    {
        showingLauncher = true;
        titleState = "launcher";
        UpdateTitle();
        string html;
        try
        {
            var themes = File.Exists(ThemesFile) ? File.ReadAllText(ThemesFile) : string.Empty;
            var palette = File.Exists(PaletteFile) ? File.ReadAllText(PaletteFile) : string.Empty;
            var look = JsonSerializer.Serialize(new { theme = preferences.Theme, custom = preferences.Custom, zoom = preferences.Zoom }, AppConfigFile.Options);
            html = File.ReadAllText(AppPaths.LauncherFile)
                .Replace("/*{{THEMES}}*/", themes.Replace("</", "<\\/"), StringComparison.Ordinal)
                .Replace("/*{{PALETTE}}*/", palette.Replace("</", "<\\/"), StringComparison.Ordinal)
                .Replace("{{LOOK}}", WebUtility.HtmlEncode(look), StringComparison.Ordinal)
                .Replace("{{LANG}}", preferences.Language, StringComparison.Ordinal)
                .Replace("{{THEME}}", preferences.Theme, StringComparison.Ordinal)
                .Replace("{{MESSAGE}}", WebUtility.HtmlEncode(messageCode ?? string.Empty), StringComparison.Ordinal)
                .Replace("{{DETAIL}}", WebUtility.HtmlEncode(detail ?? string.Empty), StringComparison.Ordinal);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException(English
                ? $"The start screen was not found at \"{AppPaths.LauncherFile}\". Reinstall the app."
                : $"A tela inicial não foi encontrada em \"{AppPaths.LauncherFile}\". Reinstale o app.", exception);
        }
        webView.CoreWebView2.NavigateToString(html);
    }

    private static string ThemesFile => Path.Combine(AppPaths.SiteFolder, "src", "themes.css");
    private static string PaletteFile => Path.Combine(AppPaths.SiteFolder, "src", "palette.js");

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        BridgeMessage? message;
        try
        {
            message = JsonSerializer.Deserialize<BridgeMessage>(args.WebMessageAsJson, JsonOptions);
        }
        catch (JsonException)
        {
            return;
        }

        switch (message?.Action)
        {
            // Configurações vindas da mesa: tudo é conferido antes de salvar.
            case "settings":
                if (message.Settings is { ValueKind: JsonValueKind.Object } settings)
                {
                    Preferences? incoming;
                    try
                    {
                        incoming = settings.Deserialize<Preferences>(AppConfigFile.Options);
                    }
                    catch (JsonException)
                    {
                        return;
                    }
                    if (incoming is not null && preferences.Apply(incoming))
                    {
                        preferences.Save();
                        ApplyBackground();
                        UpdateTitle();
                    }
                }
                return;
            // A tela inicial só troca o idioma.
            case "language":
                if (message.Language is { } language && Preferences.Languages.Contains(language) && language != preferences.Language)
                {
                    preferences.Language = language;
                    preferences.Save();
                    UpdateTitle();
                }
                return;
            case "getSettings":
                SendSettings();
                return;
            // O botão "Início" da mesa volta para a tela inicial.
            case "home":
                ShowLauncher(host.IsHosting ? "HOSTING_STILL_ON" : null);
                return;
        }

        // Hospedar e entrar só valem quando pedidos pela própria tela inicial,
        // nunca por uma página de fora.
        if (!showingLauncher || args.Source != "about:blank")
        {
            return;
        }

        if (message?.Action == "host")
        {
            await StartHostingAsync();
        }
        else if (message?.Action == "join")
        {
            if (TryNormalizeLink(message.Link, out var link) && !IsTableAddress(link))
            {
                SendLauncherError("NOT_TABLE_LINK");
            }
            else if (link is not null)
            {
                showingLauncher = false;
                titleState = "friend";
                UpdateTitle();
                webView.CoreWebView2.Navigate(link.ToString());
            }
            else
            {
                SendLauncherError("BAD_LINK");
            }
        }
    }

    private async Task StartHostingAsync()
    {
        try
        {
            var address = await host.StartAsync();
            showingLauncher = false;
            titleState = "hosting";
            UpdateTitle();
            webView.CoreWebView2.Navigate(address.ToString());
        }
        catch (Exception exception)
        {
            SendLauncherError("HOST_FAILED", exception.Message);
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (showingLauncher || args.IsSuccess || args.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled)
        {
            return;
        }
        ShowLauncher("OPEN_FAILED");
    }

    private void SendSettings() =>
        webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { settings = preferences }, AppConfigFile.Options));

    private void SendLauncherError(string error, string? detail = null) =>
        webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { error, detail }));

    private void UpdateTitle()
    {
        Text = titleState switch
        {
            "hosting" => $"{AppTitle}  ·  {(English ? "Hosting the table (keep the app open)" : "Hospedando a mesa (deixe o app aberto)")}",
            "friend" => $"{AppTitle}  ·  {(English ? "A friend's table" : "Mesa de um amigo")}",
            _ => AppTitle,
        };
    }

    private void ApplyBackground()
    {
        var color = preferences.Theme == "custom"
            ? ColorTranslator.FromHtml(preferences.Custom.Bg ?? CustomColors.DefaultBg)
            : ThemeBackgrounds.TryGetValue(preferences.Theme, out var found) ? found : ThemeBackgrounds["purple"];
        BackColor = color;
        webView.DefaultBackgroundColor = color;
    }

    private static bool TryNormalizeLink(string? text, out Uri link)
    {
        link = null!;
        var value = (text ?? string.Empty).Trim();
        if (value.Length == 0)
        {
            return false;
        }
        if (!value.Contains("://", StringComparison.Ordinal))
        {
            value = "https://" + value;
        }
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed)
            || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrEmpty(parsed.Host))
        {
            return false;
        }
        link = parsed;
        return true;
    }

    private static void OpenInDefaultBrowser(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        }
    }

    private sealed record BridgeMessage(string? Action, string? Link, string? Language, JsonElement? Settings);
}
