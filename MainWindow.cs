using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RolagemRpg;

// Janela do app. Começa na tela inicial (hospedar ou entrar numa mesa) e depois
// mostra a mesa: a deste computador, ou a de um amigo pelo link que ele mandou.
public sealed class MainWindow : Form
{
    private const string AppTitle = "Dados & Destino";
    private const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly HostSession host;
    private readonly string launcherHtml = LoadLauncher();
    private readonly WebView2 webView = new()
    {
        Dock = DockStyle.Fill,
        DefaultBackgroundColor = Color.FromArgb(16, 14, 20),
    };
    private readonly bool hostOnStart;
    private bool showingLauncher;

    public MainWindow(HostSession host, bool hostOnStart = false)
    {
        this.host = host;
        this.hostOnStart = hostOnStart;
        Text = AppTitle;
        BackColor = Color.FromArgb(16, 14, 20);
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

    private async Task InitializeWebViewAsync()
    {
        try
        {
            // Guarda os dados do navegador (histórico, nome do jogador) em AppData.
            var dataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DadosDestino",
                "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
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
            ShowLauncher(null);
            if (hostOnStart)
            {
                await StartHostingAsync();
            }
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var install = MessageBox.Show(
                "Este app precisa do Microsoft Edge WebView2 Runtime, que não foi encontrado.\n\nAbrir a página de download agora?",
                AppTitle,
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (install == DialogResult.Yes)
            {
                OpenInDefaultBrowser(WebView2DownloadUrl);
            }
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

    private void ShowLauncher(string? message)
    {
        showingLauncher = true;
        Text = AppTitle;
        webView.CoreWebView2.NavigateToString(launcherHtml.Replace("{{MESSAGE}}", WebUtility.HtmlEncode(message ?? string.Empty)));
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        LauncherMessage? message;
        try
        {
            message = JsonSerializer.Deserialize<LauncherMessage>(args.WebMessageAsJson, JsonOptions);
        }
        catch (JsonException)
        {
            return;
        }

        // O botão "Início" da mesa volta para a tela inicial.
        if (message?.Action == "home")
        {
            ShowLauncher(host.IsHosting ? "Sua mesa continua no ar enquanto o app estiver aberto." : null);
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
                SendLauncherError("Por segurança, o app só abre links de mesa (terminados em trycloudflare.com). Confira o link que o anfitrião mandou.");
            }
            else if (link is not null)
            {
                showingLauncher = false;
                Text = $"{AppTitle}  ·  Mesa de um amigo";
                webView.CoreWebView2.Navigate(link.ToString());
            }
            else
            {
                SendLauncherError("Esse link não parece certo. Cole o link inteiro que o anfitrião mandou.");
            }
        }
    }

    private async Task StartHostingAsync()
    {
        try
        {
            var address = await host.StartAsync();
            showingLauncher = false;
            Text = $"{AppTitle}  ·  Hospedando a mesa (deixe o app aberto)";
            webView.CoreWebView2.Navigate(address.ToString());
        }
        catch (Exception exception)
        {
            SendLauncherError($"Não foi possível hospedar a mesa: {exception.Message}");
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (showingLauncher || args.IsSuccess || args.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled)
        {
            return;
        }
        ShowLauncher("Não foi possível abrir a mesa. Confira o link e se o anfitrião está com o app aberto.");
    }

    private void SendLauncherError(string error) =>
        webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { error }));

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

    private static string LoadLauncher()
    {
        using var stream = typeof(MainWindow).Assembly.GetManifestResourceStream("launcher.html")
            ?? throw new InvalidOperationException("Tela inicial não encontrada no app.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static void OpenInDefaultBrowser(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        }
    }

    private sealed record LauncherMessage(string? Action, string? Link);
}
