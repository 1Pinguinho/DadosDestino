using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RolagemRpg;

// Janela do app: mostra o site da mesa usando o WebView2 (motor do Edge).
public sealed class MainWindow : Form
{
    private const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    private readonly WebView2 webView = new()
    {
        Dock = DockStyle.Fill,
        DefaultBackgroundColor = Color.FromArgb(16, 14, 20),
    };
    private readonly Uri startUrl;

    public MainWindow(Uri startUrl, string? inviteBaseUrl)
    {
        this.startUrl = startUrl;
        Text = inviteBaseUrl is null
            ? "Dados & Destino"
            : $"Dados & Destino  ·  Amigos na mesma rede: {inviteBaseUrl}";
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
            // Guarda os dados do navegador (histórico, nome do jogador) em AppData,
            // e não ao lado do .exe, que pode estar numa pasta sem permissão de escrita.
            var dataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DadosDestino",
                "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await webView.EnsureCoreWebView2Async(environment);
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                OpenInDefaultBrowser(args.Uri);
            };
            webView.Source = startUrl;
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var install = MessageBox.Show(
                "Este app precisa do Microsoft Edge WebView2 Runtime, que não foi encontrado.\n\nAbrir a página de download agora?",
                "Dados & Destino",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (install == DialogResult.Yes)
            {
                OpenInDefaultBrowser(WebView2DownloadUrl);
            }
            Close();
        }
    }

    private static void OpenInDefaultBrowser(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        }
    }
}
