using System.Diagnostics;
using System.Text.RegularExpressions;

namespace RolagemRpg;

public sealed record TunnelSnapshot(string Status, int Percent, string? Url, string? Error);

// Gera um link público (https://....trycloudflare.com) que leva até o servidor
// deste computador, usando o "quick tunnel" gratuito da Cloudflare: sem conta e
// sem abrir portas no roteador. O conector (cloudflared) é baixado do GitHub
// oficial da Cloudflare na primeira vez e fica guardado em dados/conector.
public sealed partial class TunnelManager : IDisposable
{
    private const string DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    private const string CloudflareSigner = "Cloudflare, Inc.";
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(45);
    private static bool leftoversCleaned;

    private readonly object gate = new();
    private readonly string toolPath = Path.Combine(AppPaths.ConnectorFolder, "cloudflared.exe");
    private Process? process;
    private int port;
    private int generation;
    private bool disposed;
    private string status = "off";
    private int percent;
    private string? url;
    private string? error;

    [GeneratedRegex(@"https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com", RegexOptions.IgnoreCase)]
    private static partial Regex PublicUrlPattern();

    public TunnelSnapshot Snapshot()
    {
        lock (gate)
        {
            return new TunnelSnapshot(status, percent, status == "ready" ? url : null, error);
        }
    }

    public void Start(int localPort)
    {
        lock (gate)
        {
            port = localPort;
        }
        Start();
    }

    public void Start()
    {
        int myGeneration;
        lock (gate)
        {
            if (disposed || port == 0 || status is "downloading" or "starting")
            {
                return;
            }
            StopProcess();
            generation++;
            myGeneration = generation;
            status = "starting";
            percent = 0;
            url = null;
            error = null;
        }
        _ = Task.Run(() => RunAsync(myGeneration));
    }

    public void Dispose()
    {
        lock (gate)
        {
            disposed = true;
            generation++;
            StopProcess();
        }
    }

    private async Task RunAsync(int myGeneration)
    {
        try
        {
            await EnsureToolAsync(myGeneration);
            CleanLeftovers();

            var info = new ProcessStartInfo(toolPath)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            info.ArgumentList.Add("tunnel");
            info.ArgumentList.Add("--no-autoupdate");
            info.ArgumentList.Add("--url");
            info.ArgumentList.Add($"http://127.0.0.1:{port}");

            var started = Process.Start(info) ?? throw new InvalidOperationException("CONNECTOR_START_FAILED");
            string? foundUrl = null;
            void OnLine(string? line)
            {
                if (line is null)
                {
                    return;
                }
                var match = PublicUrlPattern().Match(line);
                lock (gate)
                {
                    if (generation != myGeneration)
                    {
                        return;
                    }
                    if (match.Success)
                    {
                        foundUrl ??= match.Value;
                    }
                    // O link só funciona depois que o túnel registra a conexão.
                    if (foundUrl is not null && line.Contains("Registered tunnel connection", StringComparison.OrdinalIgnoreCase))
                    {
                        url = foundUrl;
                        status = "ready";
                    }
                }
            }

            started.OutputDataReceived += (_, args) => OnLine(args.Data);
            started.ErrorDataReceived += (_, args) => OnLine(args.Data);
            started.EnableRaisingEvents = true;
            started.Exited += (_, _) =>
            {
                lock (gate)
                {
                    if (generation == myGeneration && process == started && !disposed)
                    {
                        process = null;
                        status = "error";
                        url = null;
                        error = "TUNNEL_DROPPED";
                    }
                }
            };

            lock (gate)
            {
                if (generation != myGeneration || disposed)
                {
                    Kill(started);
                    return;
                }
                process = started;
            }
            started.BeginOutputReadLine();
            started.BeginErrorReadLine();

            await Task.Delay(StartTimeout);
            lock (gate)
            {
                if (generation == myGeneration && status == "starting")
                {
                    StopProcess();
                    status = "error";
                    error = "TUNNEL_TIMEOUT";
                }
            }
        }
        catch (Exception exception)
        {
            lock (gate)
            {
                if (generation == myGeneration)
                {
                    StopProcess();
                    status = "error";
                    error = exception is HttpRequestException or TaskCanceledException
                        ? "CONNECTOR_DOWNLOAD_FAILED"
                        : exception.Message;
                }
            }
        }
    }

    private async Task EnsureToolAsync(int myGeneration)
    {
        if (File.Exists(toolPath))
        {
            // Confere de novo a cada uso: se o arquivo foi trocado ou corrompido, baixa outro.
            if (Authenticode.IsSignedBy(toolPath, CloudflareSigner))
            {
                return;
            }
            File.Delete(toolPath);
        }
        lock (gate)
        {
            if (generation == myGeneration)
            {
                status = "downloading";
            }
        }

        Directory.CreateDirectory(Path.GetDirectoryName(toolPath)!);
        var partialPath = toolPath + ".download";
        using (var client = new HttpClient { Timeout = TimeSpan.FromMinutes(10) })
        {
            client.DefaultRequestHeaders.UserAgent.ParseAdd("DadosDestino/1.1");
            using var response = await client.GetAsync(DownloadUrl, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            var total = response.Content.Headers.ContentLength ?? 0;
            await using var source = await response.Content.ReadAsStreamAsync();
            await using var target = File.Create(partialPath);
            var buffer = new byte[81920];
            long received = 0;
            int count;
            while ((count = await source.ReadAsync(buffer)) > 0)
            {
                await target.WriteAsync(buffer.AsMemory(0, count));
                received += count;
                if (total > 0)
                {
                    lock (gate)
                    {
                        if (generation == myGeneration)
                        {
                            percent = (int)(received * 100 / total);
                        }
                    }
                }
            }
        }
        if (!Authenticode.IsSignedBy(partialPath, CloudflareSigner))
        {
            File.Delete(partialPath);
            throw new InvalidOperationException("CONNECTOR_UNSIGNED");
        }
        File.Move(partialPath, toolPath, overwrite: true);

        lock (gate)
        {
            if (generation == myGeneration)
            {
                status = "starting";
            }
        }
    }

    // Se o app fechou de forma inesperada da última vez, o conector pode ter ficado aberto.
    private void CleanLeftovers()
    {
        if (leftoversCleaned)
        {
            return;
        }
        leftoversCleaned = true;
        foreach (var candidate in Process.GetProcessesByName("cloudflared"))
        {
            try
            {
                if (string.Equals(candidate.MainModule?.FileName, toolPath, StringComparison.OrdinalIgnoreCase))
                {
                    candidate.Kill(entireProcessTree: true);
                }
            }
            catch (Exception)
            {
                // Sem permissão para ver ou fechar esse processo: não é nosso.
            }
            finally
            {
                candidate.Dispose();
            }
        }
    }

    private void StopProcess()
    {
        var current = process;
        process = null;
        if (current is not null)
        {
            Kill(current);
        }
    }

    private static void Kill(Process target)
    {
        try
        {
            if (!target.HasExited)
            {
                target.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
            // Já tinha fechado.
        }
    }
}
