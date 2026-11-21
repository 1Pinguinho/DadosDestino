namespace RolagemRpg;

// Onde o app guarda cada coisa. Tudo fica ao lado do DadosDestino.exe:
//
//   site/      a mesa (HTML, CSS e JavaScript) que o servidor entrega
//   launcher/  a tela inicial do app (hospedar ou entrar)
//   config/    config.json (servidor) e preferencias.json (idioma e tema)
//   dados/     dados do navegador do app e o conector da Cloudflare
//   docs/      como o app funciona
//
// Se a pasta do app não aceitar escrita (por exemplo, dentro de "Arquivos de
// Programas"), as pastas config/ e dados/ vão para %LOCALAPPDATA%\DadosDestino.
public static class AppPaths
{
    public static string AppFolder { get; } = AppContext.BaseDirectory;
    public static string SiteFolder { get; } = Path.Combine(AppFolder, "site");
    public static string LauncherFile { get; } = Path.Combine(AppFolder, "launcher", "launcher.html");

    private static readonly Lazy<string> WritableRoot = new(FindWritableRoot);

    public static string ConfigFolder => Ensure(Path.Combine(WritableRoot.Value, "config"));
    public static string DataFolder => Ensure(Path.Combine(WritableRoot.Value, "dados"));
    public static string ConnectorFolder => Ensure(Path.Combine(DataFolder, "conector"));
    public static string BrowserFolder => Ensure(Path.Combine(DataFolder, "navegador"));

    // A versão 1.1 guardava o conector em %LOCALAPPDATA%\DadosDestino. Reaproveita
    // ele para não baixar 55 MB de novo (a assinatura é conferida antes de usar).
    public static void ReuseOldConnector()
    {
        try
        {
            var oldConnector = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DadosDestino", "cloudflared.exe");
            var newConnector = Path.Combine(ConnectorFolder, "cloudflared.exe");
            if (File.Exists(oldConnector) && !File.Exists(newConnector))
            {
                File.Copy(oldConnector, newConnector);
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Sem cópia: o conector é baixado na primeira vez que hospedar.
        }
    }

    private static string FindWritableRoot()
    {
        if (CanWrite(AppFolder))
        {
            return AppFolder;
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DadosDestino");
    }

    private static bool CanWrite(string folder)
    {
        try
        {
            var probe = Path.Combine(folder, $".teste-escrita-{Environment.ProcessId}");
            File.WriteAllText(probe, string.Empty);
            File.Delete(probe);
            return true;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static string Ensure(string folder)
    {
        Directory.CreateDirectory(folder);
        return folder;
    }
}
