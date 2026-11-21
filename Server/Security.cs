using System.Collections.Concurrent;
using System.Net;
using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

public static class Security
{
    // O site só carrega arquivos do próprio app: nada de scripts, fontes ou
    // imagens de outros sites, e ninguém consegue embutir a mesa em outra página.
    private const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

    public static void UseSecurityHeaders(this WebApplication app) => app.Use(async (context, next) =>
    {
        var headers = context.Response.Headers;
        headers.ContentSecurityPolicy = ContentSecurityPolicy;
        headers.XContentTypeOptions = "nosniff";
        headers.XFrameOptions = "DENY";
        headers["Referrer-Policy"] = "no-referrer";
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()";
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        headers["Cross-Origin-Resource-Policy"] = "same-origin";
        if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/tableHub"))
        {
            headers.CacheControl = "no-store";
        }
        await next();
    });

    // Bloqueia pedidos que não vêm da própria mesa:
    // - Origin de outro site: impede que uma página qualquer aberta no navegador
    //   do anfitrião se conecte à mesa ou mexa no link (CSRF / WebSocket hijacking).
    // - Host desconhecido (só no modo anfitrião): impede "DNS rebinding", em que um
    //   site malicioso finge ser o localhost para conversar com o servidor.
    public static void UseRequestFilter(this WebApplication app, TunnelManager? tunnel) => app.Use(async (context, next) =>
    {
        var request = context.Request;
        var tunnelHost = tunnel?.Snapshot().Url is { } publicUrl ? new Uri(publicUrl).Authority : null;

        if (tunnel is not null && !IsAllowedHost(request.Host.Host, tunnelHost))
        {
            context.Response.StatusCode = StatusCodes.Status421MisdirectedRequest;
            return;
        }

        var origin = request.Headers.Origin.ToString();
        if (origin.Length > 0)
        {
            var sameOrigin = Uri.TryCreate(origin, UriKind.Absolute, out var originUri)
                && (string.Equals(originUri.Authority, request.Host.Value, StringComparison.OrdinalIgnoreCase)
                    || (tunnelHost is not null && string.Equals(originUri.Authority, tunnelHost, StringComparison.OrdinalIgnoreCase)));
            if (!sameOrigin)
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
        }

        await next();
    });

    private static bool IsAllowedHost(string host, string? tunnelHost) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address))
        || (tunnelHost is not null && host.Equals(tunnelHost, StringComparison.OrdinalIgnoreCase));

    // Identifica quem fez o pedido. Pelo link da internet, todo mundo chega pelo
    // conector local, então o IP real vem no cabeçalho da Cloudflare (que só é
    // aceito quando o pedido veio de dentro do próprio computador).
    public static string ClientKey(HttpContext? context)
    {
        if (context?.Connection.RemoteIpAddress is not { } remote)
        {
            return "desconhecido";
        }
        if (IPAddress.IsLoopback(remote)
            && context.Request.Headers.TryGetValue("Cf-Connecting-Ip", out var forwarded)
            && IPAddress.TryParse(forwarded.ToString(), out var real))
        {
            return real.ToString();
        }
        return remote.ToString();
    }
}

// Limites por pessoa (IP), contra spam e contra quem tenta adivinhar códigos de sala.
public sealed class HubRateLimitFilter : IHubFilter
{
    private const int MaxConnectionsPerClient = 12;
    private const int MaxCallsPerWindow = 40;
    private static readonly TimeSpan CallWindow = TimeSpan.FromSeconds(10);
    private const int MaxFailedJoins = 10;
    private static readonly TimeSpan FailedJoinWindow = TimeSpan.FromMinutes(10);

    private readonly ConcurrentDictionary<string, ClientState> clients = new(StringComparer.Ordinal);

    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        var state = GetState(invocationContext.Context.GetHttpContext());
        var isJoin = invocationContext.HubMethodName == nameof(TableHub.JoinRoom);
        lock (state)
        {
            var now = DateTime.UtcNow;
            if (now - state.CallWindowStart > CallWindow)
            {
                state.CallWindowStart = now;
                state.Calls = 0;
            }
            if (++state.Calls > MaxCallsPerWindow)
            {
                throw new HubException("TOO_MANY_ACTIONS");
            }
            if (now - state.FailedJoinWindowStart > FailedJoinWindow)
            {
                state.FailedJoinWindowStart = now;
                state.FailedJoins = 0;
            }
            if (isJoin && state.FailedJoins >= MaxFailedJoins)
            {
                throw new HubException("TOO_MANY_WRONG_CODES");
            }
        }

        try
        {
            return await next(invocationContext);
        }
        catch (HubException) when (isJoin)
        {
            lock (state)
            {
                state.FailedJoins++;
            }
            throw;
        }
    }

    public async Task OnConnectedAsync(HubLifetimeContext context, Func<HubLifetimeContext, Task> next)
    {
        var state = GetState(context.Context.GetHttpContext());
        lock (state)
        {
            if (state.Connections >= MaxConnectionsPerClient)
            {
                throw new HubException("TOO_MANY_CONNECTIONS");
            }
            state.Connections++;
        }
        context.Context.Items["rate-state"] = state;
        await next(context);
    }

    public async Task OnDisconnectedAsync(HubLifetimeContext context, Exception? exception, Func<HubLifetimeContext, Exception?, Task> next)
    {
        if (context.Context.Items.TryGetValue("rate-state", out var value) && value is ClientState state)
        {
            lock (state)
            {
                state.Connections = Math.Max(0, state.Connections - 1);
                state.LastSeenUtc = DateTime.UtcNow;
            }
        }
        await next(context, exception);
    }

    private ClientState GetState(HttpContext? httpContext)
    {
        if (clients.Count > 2000)
        {
            var staleBefore = DateTime.UtcNow - FailedJoinWindow;
            foreach (var pair in clients)
            {
                if (pair.Value.Connections == 0 && pair.Value.LastSeenUtc < staleBefore)
                {
                    clients.TryRemove(pair.Key, out _);
                }
            }
        }
        var state = clients.GetOrAdd(Security.ClientKey(httpContext), _ => new ClientState());
        state.LastSeenUtc = DateTime.UtcNow;
        return state;
    }

    private sealed class ClientState
    {
        public int Connections;
        public int Calls;
        public DateTime CallWindowStart = DateTime.UtcNow;
        public int FailedJoins;
        public DateTime FailedJoinWindowStart = DateTime.UtcNow;
        public DateTime LastSeenUtc = DateTime.UtcNow;
    }
}
