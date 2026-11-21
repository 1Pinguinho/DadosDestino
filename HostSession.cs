namespace RolagemRpg;

// Liga o servidor da mesa neste computador quando o jogador escolhe "Hospedar".
// O servidor só aceita conexões do próprio computador; os amigos chegam pelo
// link da internet (túnel da Cloudflare), então não é preciso liberar o firewall.
public sealed class HostSession : IDisposable
{
    private WebApplication? server;
    private TunnelManager? tunnel;
    private Uri? localUri;

    public bool IsHosting => server is not null;

    public async Task<Uri> StartAsync()
    {
        if (server is not null && localUri is not null)
        {
            return localUri;
        }

        // Tenta a porta de sempre (mantém o histórico salvo); se estiver ocupada, usa outra livre.
        foreach (var address in new[] { $"http://localhost:{Program.DefaultPort}", "http://127.0.0.1:0" })
        {
            var candidateTunnel = new TunnelManager();
            var candidate = Program.CreateServer(Array.Empty<string>(), address, candidateTunnel);
            try
            {
                await candidate.StartAsync();
            }
            catch (IOException) when (address.EndsWith($":{Program.DefaultPort}", StringComparison.Ordinal))
            {
                candidateTunnel.Dispose();
                await candidate.DisposeAsync();
                continue;
            }

            var bound = new Uri(candidate.Urls.First());
            server = candidate;
            tunnel = candidateTunnel;
            localUri = new Uri($"http://{bound.Host}:{bound.Port}/");
            tunnel.Start(bound.Port);
            return localUri;
        }
        throw new InvalidOperationException("Nenhuma porta disponível neste computador.");
    }

    public void Dispose()
    {
        tunnel?.Dispose();
        if (server is not null)
        {
            server.StopAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult();
            server.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }
}
