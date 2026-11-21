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

    // Garante o conector sem baixar 55 MB quando ele já existe em algum lugar:
    // 1) o que vem junto no pacote (dados\conector ao lado do .exe), se o app estiver
    //    guardando os dados em outra pasta; 2) o da versão 1.1, em %LOCALAPPDATA%\DadosDestino.
    // A assinatura da Cloudflare é conferida antes de cada uso, então copiar é seguro.
    public static void ReuseOldConnector()
    {
        try
        {
            var target = Path.Combine(ConnectorFolder, "cloudflared.exe");
            if (File.Exists(target))
            {
                return;
            }
            var candidates = new[]
            {
                Path.Combine(AppFolder, "dados", "conector", "cloudflared.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DadosDestino", "cloudflared.exe"),
            };
            var source = candidates.FirstOrDefault(candidate =>
                File.Exists(candidate) && !string.Equals(Path.GetFullPath(candidate), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase));
            if (source is not null)
            {
                File.Copy(source, target);
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
