using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using Microsoft.AspNetCore.SignalR;
using RolagemRpg;

public static class Program
{
    private const int DefaultPort = 8766;

    // Sem argumentos, abre a janela do app e liga o servidor da mesa por dentro.
    // Com --server, roda só o servidor (útil para hospedar sem janela).
    [STAThread]
    public static void Main(string[] args)
    {
        var serverOnly = args.Contains("--server", StringComparer.OrdinalIgnoreCase);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args.Where(argument => !argument.Equals("--server", StringComparison.OrdinalIgnoreCase)).ToArray(),
            ContentRootPath = AppContext.BaseDirectory,
        });
        if (string.IsNullOrWhiteSpace(builder.Configuration["urls"]))
        {
            builder.WebHost.UseUrls($"http://0.0.0.0:{DefaultPort}");
        }
        builder.Services.AddSignalR();

        var app = builder.Build();
        string? inviteBaseUrl = null;
        app.Lifetime.ApplicationStarted.Register(() =>
        {
            var lanAddress = FindLanAddress();
            inviteBaseUrl = lanAddress is null ? null : $"http://{lanAddress}:{GetListeningPort(app)}";
        });

        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.MapGet("/api/info", () => Results.Json(new { inviteBaseUrl }));
        app.MapHub<TableHub>("/tableHub");

        if (serverOnly)
        {
            app.Run();
            return;
        }

        try
        {
            app.StartAsync().GetAwaiter().GetResult();
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                $"Não foi possível iniciar a mesa.\n\n{exception.Message}\n\nVerifique se o Dados & Destino já não está aberto.",
                "Dados & Destino",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        System.Windows.Forms.Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        System.Windows.Forms.Application.EnableVisualStyles();
        System.Windows.Forms.Application.SetCompatibleTextRenderingDefault(false);
        System.Windows.Forms.Application.Run(new MainWindow(new Uri($"http://localhost:{GetListeningPort(app)}/"), inviteBaseUrl));
        app.StopAsync().GetAwaiter().GetResult();
    }

    private static int GetListeningPort(WebApplication app)
    {
        foreach (var address in app.Urls)
        {
            var normalized = address.Replace("://+", "://localhost").Replace("://*", "://localhost").Replace("://[::]", "://localhost");
            if (Uri.TryCreate(normalized, UriKind.Absolute, out var uri))
            {
                return uri.Port;
            }
        }
        return DefaultPort;
    }

    // Descobre o IP deste computador na rede local (nenhum pacote é enviado).
    private static string? FindLanAddress()
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            socket.Connect("8.8.8.8", 65530);
            var address = (socket.LocalEndPoint as IPEndPoint)?.Address;
            return address is null || IPAddress.IsLoopback(address) ? null : address.ToString();
        }
        catch (SocketException)
        {
            return null;
        }
    }
}

public sealed class TableHub : Hub
{
    private const int MaxRooms = 200;
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
                ? room.Players.Values.FirstOrDefault(candidate => candidate.ReconnectToken == reconnectToken)
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
                roster = CreateRoster(code, room);
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
        if (name.Length is < 2 or > 22 || name.Any(char.IsControl))
        {
            throw new HubException("Use um nome de 2 a 22 caracteres.");
        }
        return name;
    }

    private static string ValidateCharacterName(string characterName)
    {
        var name = (characterName ?? string.Empty).Trim();
        if (name.Length is < 2 or > 30 || name.Any(char.IsControl))
        {
            throw new HubException("Use um nome de personagem de 2 a 30 caracteres.");
        }
        return name;
    }

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