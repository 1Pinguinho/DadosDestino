using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// API das contas (/api/account/...). A sessão vai no cabeçalho
// "Authorization: Bearer <token>": sem cookies, então outro site não consegue agir
// em nome de ninguém. Erros voltam como { "error": "CODIGO" }.
public static class AccountEndpoints
{
    private const long MaxSheetsBytes = 512 * 1024;

    public sealed record LoginRequest(string? Username, string? Password, bool Remember);
    public sealed record StatusRequest(string? SheetId, string? Stat, int Value);

    public static void MapAccountEndpoints(this WebApplication app)
    {
        var store = AccountStore.Instance;

        app.MapPost("/api/account/register", (LoginRequest request, HttpContext context) =>
            Run(() => Results.Json(store.Register(request.Username, request.Password, request.Remember, Security.ClientKey(context)))));

        app.MapPost("/api/account/login", (LoginRequest request, HttpContext context) =>
            Run(() => Results.Json(store.Login(request.Username, request.Password, request.Remember, Security.ClientKey(context)))));

        app.MapPost("/api/account/logout", (HttpContext context) =>
        {
            store.Logout(Token(context));
            return Results.Ok();
        });

        app.MapGet("/api/account/me", (HttpContext context) =>
            store.Resolve(Token(context)) is { } account ? Results.Json(account) : Unauthorized());

        // Foto do perfil: o site já manda reduzida (128 px). Tipo conferido pelos bytes.
        app.MapPost("/api/account/avatar", async (HttpContext context) =>
        {
            if (store.Resolve(Token(context)) is not { } account)
            {
                return Unauthorized();
            }
            var image = await ReadBody(context, AccountStore.MaxAvatarBytes);
            if (image is null)
            {
                return Error("IMAGE_TOO_BIG");
            }
            var hub = context.RequestServices.GetRequiredService<IHubContext<TableHub>>();
            var result = Run(() => Results.Json(store.SetAvatar(account.Id, image)));
            await TableHub.NotifyAccountChanged(hub, account.Id);
            return result;
        });

        app.MapGet("/api/avatars/{accountId}", (string accountId) =>
            store.Avatar(accountId) is { } avatar ? Results.Bytes(avatar.Bytes, avatar.Type) : Results.NotFound());

        app.MapGet("/api/account/sheets", (HttpContext context) =>
            store.Resolve(Token(context)) is { } account ? Results.Json(store.Sheets(account.Id), AccountStore.Json) : Unauthorized());

        app.MapPut("/api/account/sheets", async (HttpContext context) =>
        {
            if (store.Resolve(Token(context)) is not { } account)
            {
                return Unauthorized();
            }
            var body = await ReadBody(context, MaxSheetsBytes);
            SheetDocument? document;
            try
            {
                document = body is null ? null : System.Text.Json.JsonSerializer.Deserialize<SheetDocument>(body, AccountStore.Json);
            }
            catch (System.Text.Json.JsonException)
            {
                document = null;
            }
            if (document is null)
            {
                return Error("INVALID_SHEET");
            }
            var saved = store.SaveSheets(account.Id, document);
            await TableHub.NotifyAccountChanged(context.RequestServices.GetRequiredService<IHubContext<TableHub>>(), account.Id);
            return Results.Json(saved, AccountStore.Json);
        });

        // Chefes prontos do mestre (aba Escudo).
        app.MapGet("/api/account/bosses", (HttpContext context) =>
            store.Resolve(Token(context)) is { } account ? Results.Json(store.Bosses(account.Id), AccountStore.Json) : Unauthorized());

        app.MapPut("/api/account/bosses", async (HttpContext context) =>
        {
            if (store.Resolve(Token(context)) is not { } account)
            {
                return Unauthorized();
            }
            var body = await ReadBody(context, 128 * 1024);
            List<BossTemplate>? bosses;
            try
            {
                bosses = body is null ? null : System.Text.Json.JsonSerializer.Deserialize<List<BossTemplate>>(body, AccountStore.Json);
            }
            catch (System.Text.Json.JsonException)
            {
                bosses = null;
            }
            return bosses is null ? Error("INVALID_REQUEST") : Results.Json(store.SaveBosses(account.Id, bosses), AccountStore.Json);
        });

        // Muda HP, EA ou San atual na mão (ex.: "Recuperei 10 de HP" ou corrigir um valor).
        app.MapPost("/api/account/status", async (StatusRequest request, HttpContext context) =>
        {
            if (store.Resolve(Token(context)) is not { } account)
            {
                return Unauthorized();
            }
            if (request.Stat is not ("hp" or "ea" or "san") || request.SheetId is null)
            {
                return Error("INVALID_REQUEST");
            }
            var saved = store.ChangeStatus(account.Id, request.SheetId, request.Stat, (_, _) => request.Value);
            if (saved is null)
            {
                return Error("NO_SHEET");
            }
            await TableHub.NotifyAccountChanged(context.RequestServices.GetRequiredService<IHubContext<TableHub>>(), account.Id);
            return Results.Json(saved, AccountStore.Json);
        });
    }

    private static string? Token(HttpContext context)
    {
        var header = context.Request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer ", StringComparison.Ordinal) ? header["Bearer ".Length..].Trim() : null;
    }

    private static async Task<byte[]?> ReadBody(HttpContext context, long limit)
    {
        if (context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } feature)
        {
            feature.MaxRequestBodySize = limit + 1;
        }
        if (context.Request.ContentLength > limit)
        {
            return null;
        }
        using var buffer = new MemoryStream();
        try
        {
            await context.Request.Body.CopyToAsync(buffer);
        }
        catch (BadHttpRequestException)
        {
            return null;
        }
        return buffer.Length > limit ? null : buffer.ToArray();
    }

    private static IResult Run(Func<IResult> action)
    {
        try
        {
            return action();
        }
        catch (AccountException exception)
        {
            return exception.Code == "TOO_MANY_LOGINS"
                ? Results.Json(new { error = exception.Code }, statusCode: StatusCodes.Status429TooManyRequests)
                : Error(exception.Code);
        }
    }

    private static IResult Error(string code) => Results.Json(new { error = code }, statusCode: StatusCodes.Status400BadRequest);

    private static IResult Unauthorized() => Results.Json(new { error = "NOT_LOGGED_IN" }, statusCode: StatusCodes.Status401Unauthorized);
}
