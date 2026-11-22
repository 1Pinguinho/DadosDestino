using Microsoft.AspNetCore.SignalR;
using System.Net;
using Microsoft.Extensions.FileProviders;

namespace RolagemRpg;

// Monta o servidor da mesa: arquivos do site (pasta site/), a API do link da
// internet e o hub em tempo real (/tableHub).
public static class ServerBuilder
{
    public static WebApplication Create(string[] args, string defaultUrl, ServerConfig config, TunnelManager? tunnel)
    {
        if (!File.Exists(Path.Combine(AppPaths.SiteFolder, "index.html")))
        {
            throw new InvalidOperationException($"A pasta do site não foi encontrada em \"{AppPaths.SiteFolder}\". Reinstale o app.");
        }

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = AppPaths.AppFolder,
            WebRootPath = AppPaths.SiteFolder,
        });
        if (string.IsNullOrWhiteSpace(builder.Configuration["urls"]))
        {
            builder.WebHost.UseUrls(defaultUrl);
        }
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false;
            options.Limits.MaxConcurrentConnections = 100;
            options.Limits.MaxConcurrentUpgradedConnections = 100;
            options.Limits.MaxRequestBodySize = 64 * 1024;
            options.Limits.MaxRequestHeadersTotalSize = 16 * 1024;
        });
        builder.Services.AddSingleton(config);
        builder.Services.AddSingleton<HubRateLimitFilter>();
        builder.Services.AddSignalR(options =>
        {
            options.EnableDetailedErrors = false;
            options.MaximumReceiveMessageSize = 8 * 1024;
            options.AddFilter<HubRateLimitFilter>();
        });

        var app = builder.Build();
        app.UseRequestFilter(tunnel);
        app.UseSecurityHeaders();
        // Só a pasta site/ é servida; arquivos ocultos ou de sistema ficam de fora.
        var siteFiles = new PhysicalFileProvider(AppPaths.SiteFolder);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = siteFiles });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = siteFiles,
            // Sempre confere se o arquivo mudou (resposta 304 quando não mudou):
            // quem edita a pasta site/ vê a mudança sem limpar o cache.
            OnPrepareResponse = context => context.Context.Response.Headers.CacheControl = "no-cache",
        });
        app.MapGet("/api/info", (HttpContext context) => Results.Json(
            tunnel is not null && IsHostRequest(context)
                ? tunnel.Snapshot()
                : new TunnelSnapshot("off", 0, null, null)));
        app.MapPost("/api/tunnel/retry", (HttpContext context) =>
        {
            if (tunnel is null || !IsHostRequest(context))
            {
                return Results.NotFound();
            }
            tunnel.Start();
            return Results.Ok();
        });
        app.MapAccountEndpoints();
        app.MapHub<TableHub>("/tableHub");
        return app;
    }

    // Pedido feito no próprio computador do host, e não por um amigo vindo pelo
    // link da internet (a Cloudflare sempre acrescenta o cabeçalho Cf-Connecting-Ip).
    private static bool IsHostRequest(HttpContext context) =>
        context.Connection.RemoteIpAddress is { } address
        && IPAddress.IsLoopback(address)
        && !context.Request.Headers.ContainsKey("Cf-Connecting-Ip");
}
