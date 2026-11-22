using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RolagemRpg;

// Janela do app. Liga a mesa deste computador e abre direto na tela inicial dela
// (Jogar, Fichas, Personalização, Configurações). Também abre a mesa de um amigo pelo link.
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
    private bool showingLauncher;
    private string titleState = "launcher";

    public MainWindow(HostSession host, Preferences preferences)
    {
        this.host = host;
        this.preferences = preferences;
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
        FormBorderStyle = FormBorderStyle.None;
        Padding = new Padding(ResizeGrip);
        Resize += (_, _) => UpdateChrome();
        // Abre em tela cheia se foi assim que a pessoa deixou.
        Shown += (_, _) => ApplyFullscreen();
        Load += async (_, _) => await InitializeWebViewAsync();
    }

    private bool English => preferences.Language == "en";

    // ---------- janela sem a moldura do Windows ----------
    // A barra de título (arrastar, minimizar, maximizar, fechar) é desenhada pela
    // página, na cor do tema. A janela só cuida das bordas para redimensionar,
    // de maximizar sem cobrir a barra de tarefas e da tela cheia.
    private const int ResizeGrip = 5;
    private bool isFullscreen;
    private FormWindowState stateBeforeFullscreen = FormWindowState.Normal;

    // Tela cheia sem bordas: ocupa o monitor inteiro, por cima da barra de tarefas.
    // Desligar volta ao tamanho de antes.
    private void ApplyFullscreen()
    {
        if (preferences.Fullscreen == isFullscreen)
        {
            return;
        }
        isFullscreen = preferences.Fullscreen;
        if (isFullscreen)
        {
            stateBeforeFullscreen = WindowState;
            WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            WindowState = FormWindowState.Normal;
            if (stateBeforeFullscreen == FormWindowState.Maximized)
            {
                WindowState = FormWindowState.Maximized;
            }
        }
        UpdateChrome();
    }

    private void UpdateChrome()
    {
        // Borda fina na cor do tema só com a janela solta (é por ela que se redimensiona).
        Padding = WindowState == FormWindowState.Normal && !isFullscreen ? new Padding(ResizeGrip) : Padding.Empty;
        SendWindowState();
    }

    private void SendWindowState() =>
        webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            window = new { maximized = WindowState == FormWindowState.Maximized, fullscreen = isFullscreen },
        }));

    private void WindowCommand(string? command)
    {
        switch (command)
        {
            case "minimize":
                WindowState = FormWindowState.Minimized;
                break;
            case "maximize":
                if (isFullscreen)
                {
                    preferences.Fullscreen = false;
                    preferences.Save();
                    ApplyFullscreen();
                    SendSettings();
                }
                else
                {
                    WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                }
                break;
            case "close":
                Close();
                break;
        }
    }

    private const int WmNcHitTest = 0x0084;
    private const int WmGetMinMaxInfo = 0x0024;

    protected override void WndProc(ref Message message)
    {
        // Bordas e cantos da janela solta: redimensionar com o mouse.
        if (message.Msg == WmNcHitTest && WindowState == FormWindowState.Normal && !isFullscreen)
        {
            base.WndProc(ref message);
            var lParam = message.LParam.ToInt64();
            var point = PointToClient(new Point((short)(lParam & 0xFFFF), (short)((lParam >> 16) & 0xFFFF)));
            var left = point.X <= ResizeGrip;
            var right = point.X >= ClientSize.Width - ResizeGrip;
            var top = point.Y <= ResizeGrip;
            var bottom = point.Y >= ClientSize.Height - ResizeGrip;
            var hit = (top, bottom, left, right) switch
            {
                (true, _, true, _) => 13,  // canto superior esquerdo
                (true, _, _, true) => 14,  // canto superior direito
                (_, true, true, _) => 16,  // canto inferior esquerdo
                (_, true, _, true) => 17,  // canto inferior direito
                (true, _, _, _) => 12,
                (_, true, _, _) => 15,
                (_, _, true, _) => 10,
                (_, _, _, true) => 11,
                _ => 0,
            };
            if (hit != 0)
            {
                message.Result = hit;
            }
            return;
        }

        base.WndProc(ref message);

        // Maximizar ocupa só a área livre (sem cobrir a barra de tarefas), a não ser na tela cheia.
        if (message.Msg == WmGetMinMaxInfo && !isFullscreen)
        {
            var screen = Screen.FromHandle(Handle);
            var info = System.Runtime.InteropServices.Marshal.PtrToStructure<MinMaxInfo>(message.LParam);
            info.MaxPosition = new NativePoint(screen.WorkingArea.Left - screen.Bounds.Left, screen.WorkingArea.Top - screen.Bounds.Top);
            info.MaxSize = new NativePoint(screen.WorkingArea.Width, screen.WorkingArea.Height);
            System.Runtime.InteropServices.Marshal.StructureToPtr(info, message.LParam, false);
        }
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;

        public NativePoint(int x, int y)
        {
            X = x;
            Y = y;
        }
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }

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
            // A barra de título da página pode arrastar a janela (CSS app-region: drag).
            settings.IsNonClientRegionSupportEnabled = true;
            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                OpenInDefaultBrowser(args.Uri);
            };
            core.NavigationStarting += OnNavigationStarting;
            core.FrameNavigationStarting += OnNavigationStarting;
            // Nenhuma mesa precisa usar câmera, microfone ou localização. Downloads também
            // ficam bloqueados, menos o "Exportar fichas": um .json criado pela própria
            // página (blob:) e salvo sempre pela janela de salvar do Windows.
            core.DownloadStarting += (_, args) =>
            {
                var pageOrigin = Uri.TryCreate(core.Source, UriKind.Absolute, out var page) ? page.GetLeftPart(UriPartial.Authority) : null;
                if (pageOrigin is null
                    || !args.DownloadOperation.Uri.StartsWith("blob:" + pageOrigin + "/", StringComparison.OrdinalIgnoreCase)
                    || !args.ResultFilePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                    return;
                }
                var deferral = args.GetDeferral();
                BeginInvoke(() =>
                {
                    using (deferral)
                    {
                        using var dialog = new SaveFileDialog
                        {
                            FileName = Path.GetFileName(args.ResultFilePath),
                            Filter = "JSON (*.json)|*.json",
                            DefaultExt = "json",
                            AddExtension = true,
                            OverwritePrompt = true,
                        };
                        if (dialog.ShowDialog(this) == DialogResult.OK)
                        {
                            args.ResultFilePath = dialog.FileName;
                            args.Handled = true;
                        }
                        else
                        {
                            args.Cancel = true;
                        }
                    }
                });
            };
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
            // O app abre direto na tela inicial da mesa deste computador (Jogar, Fichas,
            // Personalização, Configurações). A tela antiga só aparece se algo falhar.
            await StartHostingAsync();
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
                        ApplyFullscreen();
                    }
                }
                return;
            // F11 em qualquer tela liga ou desliga a tela cheia.
            case "toggleFullscreen":
                preferences.Fullscreen = !preferences.Fullscreen;
                preferences.Save();
                ApplyFullscreen();
                SendSettings();
                SendWindowState();
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
            // Botões da barra de título desenhada pela página.
            case "getWindow":
                SendWindowState();
                return;
            case "window":
                WindowCommand(message.Command);
                return;
            case "getSettings":
                SendSettings();
                SendWindowState();
                return;
            // O botão "Início" volta para a tela inicial da mesa deste computador.
            case "home":
                if (host.LocalUri is { } local)
                {
                    showingLauncher = false;
                    titleState = "hosting";
                    UpdateTitle();
                    webView.CoreWebView2.Navigate(local.ToString());
                }
                else
                {
                    ShowLauncher(null);
                }
                return;
        }

        // Hospedar, entrar e mexer nas contas só valem quando pedidos pela tela de
        // reserva ou pela mesa deste computador, nunca por uma página de fora.
        var fromLauncher = showingLauncher && args.Source == "about:blank";
        var fromLocalTable = !showingLauncher && host.LocalUri is { } localUri
            && Uri.TryCreate(args.Source, UriKind.Absolute, out var source)
            && source.GetLeftPart(UriPartial.Authority).Equals(localUri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);
        if (!fromLauncher && !fromLocalTable)
        {
            return;
        }

        if (message?.Action == "accounts")
        {
            SendAccounts();
        }
        else if (message?.Action == "deleteAccount")
        {
            if (message.Id is { Length: > 0 and <= 40 } id)
            {
                AccountStore.Instance.Delete(id);
            }
            SendAccounts();
        }
        else if (message?.Action == "host")
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

    private sealed record BridgeMessage(string? Action, string? Link, string? Language, JsonElement? Settings, string? Command, string? Id);

    // Lista de contas para a tela inicial (só id e nome; nada de senha).
    private void SendAccounts()
    {
        var accounts = AccountStore.Instance.List().Select(account => new { account.Id, account.Username }).ToArray();
        webView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { accounts }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
}
