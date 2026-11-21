using RolagemRpg;

public static class Program
{
    // Sem argumentos: abre o app, com a tela para hospedar ou entrar numa mesa.
    // Com --server: roda só o servidor, aberto na rede local, sem janela nem link da internet.
    [STAThread]
    public static void Main(string[] args)
    {
        var config = ServerConfig.Load();
        if (args.Contains("--server", StringComparer.OrdinalIgnoreCase))
        {
            var serverArgs = args.Where(argument => !argument.Equals("--server", StringComparison.OrdinalIgnoreCase)).ToArray();
            ServerBuilder.Create(serverArgs, $"http://0.0.0.0:{config.Port}", config, tunnel: null).Run();
            return;
        }

        // Uma cópia só do app: abrir de novo apenas traz a janela que já está aberta.
        using var singleInstance = new Mutex(true, @"Local\DadosDestino.App", out var isFirstInstance);
        if (!isFirstInstance)
        {
            BringExistingWindowToFront();
            return;
        }

        System.Windows.Forms.Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        System.Windows.Forms.Application.EnableVisualStyles();
        System.Windows.Forms.Application.SetCompatibleTextRenderingDefault(false);
        // --hospedar pula a tela inicial e já abre hospedando (bom para um atalho).
        var hostOnStart = args.Contains("--hospedar", StringComparer.OrdinalIgnoreCase);
        AppPaths.ReuseOldConnector();
        using var host = new HostSession(config);
        System.Windows.Forms.Application.Run(new MainWindow(host, Preferences.Load(), hostOnStart));
    }

    private static void BringExistingWindowToFront()
    {
        using var current = System.Diagnostics.Process.GetCurrentProcess();
        foreach (var other in System.Diagnostics.Process.GetProcessesByName(current.ProcessName))
        {
            using (other)
            {
                if (other.Id != current.Id && other.MainWindowHandle != IntPtr.Zero)
                {
                    ShowWindow(other.MainWindowHandle, 9); // SW_RESTORE
                    SetForegroundWindow(other.MainWindowHandle);
                }
            }
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
}
