using System.Net;
using System.Security.Cryptography;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.FileProviders;
using RolagemRpg;

public static class Program
{
    public const int DefaultPort = 8766;

    // Sem argumentos: abre o app, com a tela para hospedar ou entrar numa mesa.
    // Com --server: roda só o servidor, aberto na rede local, sem janela nem link da internet.
    [STAThread]
    public static void Main(string[] args)
    {
        if (args.Contains("--server", StringComparer.OrdinalIgnoreCase))
        {
            var serverArgs = args.Where(argument => !argument.Equals("--server", StringComparison.OrdinalIgnoreCase)).ToArray();
            CreateServer(serverArgs, $"http://0.0.0.0:{DefaultPort}", tunnel: null).Run();
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
        using var host = new HostSession();
        System.Windows.Forms.Application.Run(new MainWindow(host, hostOnStart));
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

    public static WebApplication CreateServer(string[] args, string defaultUrl, TunnelManager? tunnel)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = AppContext.BaseDirectory,
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
        var siteFiles = new ManifestEmbeddedFileProvider(typeof(Program).Assembly, "wwwroot");
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = siteFiles });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = siteFiles });
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

public sealed class TableHub : Hub
{
    private const int MaxRooms = 50;
    private const int MaxPlayers = 8;
    private const int MaxRollHistory = 20;
    private const string CodeCharacters = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static readonly TimeSpan EmptyRoomLifetime = TimeSpan.FromMinutes(30);
    private static readonly object RoomsLock = new();
    private static readonly Dictionary<string, RoomState> Rooms = new(StringComparer.Ordinal);

    public async Task<JoinResponse> CreateRoom(string playerName, string characterName, string? reconnectToken = null)
    {
        playerName = ValidatePlayerName(playerName);
        characterName = ValidateCharacterName(characterName);
        await LeaveCurrentRoom();

        string code;
        lock (RoomsLock)
        {
            RemoveExpiredRooms();
            if (Rooms.Count >= MaxRooms)
            {
                throw new HubException("O servidor está cheio de salas. Tente novamente mais tarde.");
            }

            do
            {
                code = GenerateRoomCode();
            }
            while (Rooms.ContainsKey(code));

            Rooms.Add(code, new RoomState());
        }

        return await JoinRoomCore(code, playerName, characterName, reconnectToken);
    }

    public async Task<JoinResponse> JoinRoom(string roomCode, string playerName, string characterName, string? reconnectToken = null)
    {
        var code = ValidateRoomCode(roomCode);
        playerName = ValidatePlayerName(playerName);
        characterName = ValidateCharacterName(characterName);
        await LeaveCurrentRoom(false);
        return await JoinRoomCore(code, playerName, characterName, reconnectToken);
    }

    public Task LeaveRoom() => LeaveCurrentRoom();

    public async Task ShareRoll(RollPayload roll)
    {
        if (roll is null || !Guid.TryParse(roll.Id, out _)
            || string.IsNullOrWhiteSpace(roll.Notation) || roll.Notation.Length > 120
            || string.IsNullOrWhiteSpace(roll.Output) || roll.Output.Length > 1800
            || !double.IsFinite(roll.Total)
            || string.IsNullOrWhiteSpace(roll.TargetPlayerId) || roll.TargetPlayerId.Length > 64)
        {
            throw new HubException("Resultado de rolagem inválido.");
        }

        if (!Context.Items.TryGetValue("roomCode", out var roomValue) || roomValue is not string code
            || !Context.Items.TryGetValue("playerId", out var playerValue) || playerValue is not string playerId)
        {
            throw new HubException("Entre em uma sala antes de compartilhar uma rolagem.");
        }

        SharedRoll sharedRoll;
        string[] privateRecipients = Array.Empty<string>();
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room)
                || !room.Players.TryGetValue(playerId, out var actor)
                || actor.ConnectionId != Context.ConnectionId
                || !room.Players.TryGetValue(roll.TargetPlayerId, out var target))
            {
                throw new HubException("Sua mesa ou o alvo escolhido não está mais disponível.");
            }

            if (!actor.IsMaster && target.Id != actor.Id)
            {
                throw new HubException("Você só pode rolar na sua própria mesa.");
            }
            if (roll.IsPrivate && (!actor.IsMaster || target.Id != actor.Id))
            {
                throw new HubException("Rolagens privadas estão disponíveis apenas na mesa do mestre.");
            }

            sharedRoll = new SharedRoll(
                roll.Id,
                actor.Id,
                actor.Name,
                actor.CharacterName,
                target.Id,
                roll.Notation,
                roll.Total,
                roll.Output,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                roll.IsPrivate);

            room.Rolls.Add(sharedRoll);
            if (room.Rolls.Count > MaxRollHistory)
            {
                room.Rolls.RemoveAt(0);
            }
            room.LastActivityUtc = DateTime.UtcNow;
            if (roll.IsPrivate)
            {
                privateRecipients = new[] { actor.ConnectionId, target.ConnectionId }
                    .OfType<string>()
                    .Distinct(StringComparer.Ordinal)
                    .ToArray();
            }
        }

        if (roll.IsPrivate)
        {
            await Clients.Clients(privateRecipients).SendAsync("ReceiveRoll", sharedRoll);
        }
        else
        {
            await Clients.Group(code).SendAsync("ReceiveRoll", sharedRoll);
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await LeaveCurrentRoom(false);
        await base.OnDisconnectedAsync(exception);
    }

    private async Task<JoinResponse> JoinRoomCore(string code, string playerName, string characterName, string? reconnectToken)
    {
        RoomSnapshot snapshot;
        string playerId;
        string issuedToken;
        string? replacedConnectionId = null;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room))
            {
                throw new HubException("Sala não encontrada. Confira o código e tente novamente.");
            }

            PruneDisconnectedPlayers(room);
            var player = !string.IsNullOrWhiteSpace(reconnectToken)
                ? room.Players.Values.FirstOrDefault(candidate => TokensMatch(candidate.ReconnectToken, reconnectToken))
                : null;
            if (player is null && room.Players.Count >= MaxPlayers)
            {
                throw new HubException("Esta sala já atingiu o limite de 8 pessoas.");
            }

            if (player is null)
            {
                player = new PlayerState
                {
                    Id = Guid.NewGuid().ToString("N"),
                    ReconnectToken = GenerateReconnectToken(),
                    Name = playerName,
                    CharacterName = characterName,
                    IsMaster = room.MasterPlayerId is null,
                    JoinedAtUtc = DateTime.UtcNow,
                };
                room.Players.Add(player.Id, player);
                if (player.IsMaster)
                {
                    room.MasterPlayerId = player.Id;
                }
            }
            else
            {
                replacedConnectionId = player.ConnectionId;
                player.Name = playerName;
                player.CharacterName = characterName;
            }

            if (!string.IsNullOrEmpty(replacedConnectionId))
            {
                room.ConnectionPlayers.Remove(replacedConnectionId);
            }
            player.ConnectionId = Context.ConnectionId;
            player.LastSeenUtc = DateTime.UtcNow;
            room.ConnectionPlayers[Context.ConnectionId] = player.Id;
            room.LastActivityUtc = DateTime.UtcNow;
            Context.Items["roomCode"] = code;
            Context.Items["playerId"] = player.Id;
            playerId = player.Id;
            issuedToken = player.ReconnectToken;
            snapshot = CreateSnapshot(code, room, player);
        }

        if (!string.IsNullOrEmpty(replacedConnectionId) && replacedConnectionId != Context.ConnectionId)
        {
            await Groups.RemoveFromGroupAsync(replacedConnectionId, code);
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        await Clients.Group(code).SendAsync("RoomUpdated", CreateRoster(code));
        return new JoinResponse(snapshot, issuedToken, playerId);
    }

    private async Task LeaveCurrentRoom(bool removePlayer = true)
    {
        if (!Context.Items.TryGetValue("roomCode", out var roomValue) || roomValue is not string code
            || !Context.Items.TryGetValue("playerId", out var playerValue) || playerValue is not string playerId)
        {
            return;
        }

        RoomRoster? roster = null;
        lock (RoomsLock)
        {
            if (Rooms.TryGetValue(code, out var room))
            {
                room.ConnectionPlayers.Remove(Context.ConnectionId);
                if (room.Players.TryGetValue(playerId, out var player) && player.ConnectionId == Context.ConnectionId)
                {
                    player.ConnectionId = null;
                    player.LastSeenUtc = DateTime.UtcNow;
                    if (removePlayer)
                    {
                        room.Players.Remove(playerId);
                        if (room.MasterPlayerId == playerId)
                        {
                            var nextMaster = room.Players.Values.Where(candidate => candidate.ConnectionId is not null)
                                .OrderBy(candidate => candidate.JoinedAtUtc).FirstOrDefault();
                            room.MasterPlayerId = nextMaster?.Id;
                            if (nextMaster is not null)
                            {
                                nextMaster.IsMaster = true;
                            }
                        }
                    }
                }
                room.LastActivityUtc = DateTime.UtcNow;
                if (room.Players.Count == 0)
                {
                    // Sala vazia sai na hora: ninguém consegue lotar o servidor criando e saindo de salas.
                    Rooms.Remove(code);
                }
                else
                {
                    roster = CreateRoster(code, room);
                }
            }
            Context.Items.Remove("roomCode");
            Context.Items.Remove("playerId");
        }

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, code);
        if (roster is not null)
        {
            await Clients.Group(code).SendAsync("RoomUpdated", roster);
        }
    }

    private static string ValidateRoomCode(string roomCode)
    {
        var code = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length != 6 || code.Any(character => !CodeCharacters.Contains(character)))
        {
            throw new HubException("O código da sala deve ter 6 caracteres.");
        }
        return code;
    }

    private static string ValidatePlayerName(string playerName)
    {
        var name = (playerName ?? string.Empty).Trim();
        if (name.Length is < 2 or > 22 || name.Any(IsHiddenCharacter))
        {
            throw new HubException("Use um nome de 2 a 22 caracteres.");
        }
        return name;
    }

    private static string ValidateCharacterName(string characterName)
    {
        var name = (characterName ?? string.Empty).Trim();
        if (name.Length is < 2 or > 30 || name.Any(IsHiddenCharacter))
        {
            throw new HubException("Use um nome de personagem de 2 a 30 caracteres.");
        }
        return name;
    }

    // Caracteres de controle e invisíveis (como o que inverte a direção do texto)
    // servem para disfarçar nomes e imitar outro jogador.
    private static bool IsHiddenCharacter(char character) =>
        char.IsControl(character) || char.GetUnicodeCategory(character) == System.Globalization.UnicodeCategory.Format;

    // Comparação em tempo constante: o tempo de resposta não revela pedaços do token.
    private static bool TokensMatch(string expected, string? provided) =>
        provided is not null && provided.Length <= 64
        && CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(expected),
            System.Text.Encoding.UTF8.GetBytes(provided));

    private static string GenerateRoomCode() => string.Concat(
        Enumerable.Range(0, 6).Select(_ => CodeCharacters[RandomNumberGenerator.GetInt32(CodeCharacters.Length)]));

    private RoomSnapshot CreateSnapshot(string code, RoomState room, PlayerState viewer)
    {
        var visibleRolls = room.Rolls.Where(roll => !roll.IsPrivate
            || viewer.IsMaster || roll.TargetPlayerId == viewer.Id).ToArray();
        var players = room.Players.Values.OrderBy(player => player.JoinedAtUtc).Select(player =>
            new RoomPlayer(
                player.Id,
                player.Name,
                player.CharacterName,
                player.IsMaster,
                player.ConnectionId is not null,
                visibleRolls.LastOrDefault(roll => roll.TargetPlayerId == player.Id))).ToArray();
        return new RoomSnapshot(code, viewer.Id, viewer.IsMaster, players, visibleRolls);
    }

    private static RoomRoster CreateRoster(string code)
    {
        lock (RoomsLock)
        {
            return Rooms.TryGetValue(code, out var room)
                ? CreateRoster(code, room)
                : new RoomRoster(code, Array.Empty<RoomPlayer>());
        }
    }

    private static RoomRoster CreateRoster(string code, RoomState room) => new(
        code,
        room.Players.Values.OrderBy(player => player.JoinedAtUtc).Select(player =>
            new RoomPlayer(player.Id, player.Name, player.CharacterName, player.IsMaster, player.ConnectionId is not null, null)).ToArray());

    private static string GenerateReconnectToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static void PruneDisconnectedPlayers(RoomState room)
    {
        var expiredBefore = DateTime.UtcNow - EmptyRoomLifetime;
        var expired = room.Players.Values.Where(player => player.ConnectionId is null
            && player.LastSeenUtc < expiredBefore).Select(player => player.Id).ToArray();
        foreach (var playerId in expired)
        {
            room.Players.Remove(playerId);
            if (room.MasterPlayerId == playerId)
            {
                room.MasterPlayerId = null;
            }
        }
        if (room.MasterPlayerId is null)
        {
            var nextMaster = room.Players.Values.OrderBy(player => player.JoinedAtUtc).FirstOrDefault();
            if (nextMaster is not null)
            {
                nextMaster.IsMaster = true;
                room.MasterPlayerId = nextMaster.Id;
            }
        }
    }

    private static void RemoveExpiredRooms()
    {
        foreach (var room in Rooms.Values)
        {
            PruneDisconnectedPlayers(room);
        }
        var expiredBefore = DateTime.UtcNow - EmptyRoomLifetime;
        var expired = Rooms.Where(pair => pair.Value.Players.Count == 0
            && pair.Value.LastActivityUtc < expiredBefore).Select(pair => pair.Key).ToArray();
        foreach (var code in expired)
        {
            Rooms.Remove(code);
        }
    }

    private sealed class RoomState
    {
        public Dictionary<string, PlayerState> Players { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, string> ConnectionPlayers { get; } = new(StringComparer.Ordinal);
        public List<SharedRoll> Rolls { get; } = new();
        public string? MasterPlayerId { get; set; }
        public DateTime LastActivityUtc { get; set; } = DateTime.UtcNow;
    }

    private sealed class PlayerState
    {
        public string Id { get; init; } = string.Empty;
        public string ReconnectToken { get; init; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string CharacterName { get; set; } = string.Empty;
        public bool IsMaster { get; set; }
        public string? ConnectionId { get; set; }
        public DateTime JoinedAtUtc { get; init; }
        public DateTime LastSeenUtc { get; set; } = DateTime.UtcNow;
    }
}

public sealed record JoinResponse(RoomSnapshot Room, string ReconnectToken, string PlayerId);
public sealed record RoomPlayer(string Id, string Name, string CharacterName, bool IsMaster, bool IsOnline, SharedRoll? LastRoll);
public sealed record RoomRoster(string Code, IReadOnlyList<RoomPlayer> Players);
public sealed record SharedRoll(string Id, string PlayerId, string Player, string CharacterName, string TargetPlayerId, string Notation, double Total, string Output, long Timestamp, bool IsPrivate);
public sealed record RoomSnapshot(string Code, string MyPlayerId, bool IsMaster, IReadOnlyList<RoomPlayer> Players, IReadOnlyList<SharedRoll> Rolls);
public sealed record RollPayload(string Id, string Notation, double Total, string Output, string TargetPlayerId, bool IsPrivate);
