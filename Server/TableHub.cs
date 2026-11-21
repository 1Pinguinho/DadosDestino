using System.Security.Cryptography;
using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// Hub em tempo real das salas. Cada sala tem jogadores (cada um com sua mesa),
// espectadores (só assistem) e o mestre (quem criou; pode rolar em qualquer mesa).
// Tudo fica em memória e some quando o anfitrião fecha o app.
public sealed class TableHub : Hub
{
    private const int MaxRollHistory = 20;
    private const int MaxRollDice = 10;

    // Cores que um jogador pode dar à própria mesa e aos dados (o site tem os mesmos nomes).
    public static readonly string[] PlayerColors =
        { "violet", "rose", "amber", "sky", "emerald", "crimson", "teal", "gold", "blue", "slate" };
    private static readonly HashSet<string> DiceColors = new(PlayerColors.Append("classic"), StringComparer.Ordinal);

    // Dados personalizados: "custom:#borda:#inicio:#fim" (cores em hexadecimal).
    private static readonly System.Text.RegularExpressions.Regex CustomDice =
        new("^custom:#[0-9a-fA-F]{6}:#[0-9a-fA-F]{6}:#[0-9a-fA-F]{6}$");

    private static string? ValidColor(string? color) =>
        color is not null && PlayerColors.Contains(color) ? color : null;

    private static string ValidDiceColor(string? color) =>
        color is not null && (DiceColors.Contains(color) || CustomDice.IsMatch(color)) ? color : "classic";
    private const string CodeCharacters = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static readonly TimeSpan DisconnectedLifetime = TimeSpan.FromMinutes(30);
    private static readonly object RoomsLock = new();
    private static readonly Dictionary<string, RoomState> Rooms = new(StringComparer.Ordinal);

    private readonly ServerConfig config;

    public TableHub(ServerConfig config)
    {
        this.config = config;
    }

    public ServerLimits GetLimits() => new(config.MaxPlayersPerRoom, config.MaxSpectatorsPerRoom);

    public async Task<JoinResponse> CreateRoom(CreateRoomRequest request)
    {
        if (request is null)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var playerName = ValidatePlayerName(request.PlayerName);
        var characterName = ValidateCharacterName(request.CharacterName);
        var roomName = ValidateRoomName(request.RoomName);
        var maxPlayers = ValidateMaxPlayers(request.MaxPlayers, 1);
        await LeaveCurrentRoom();

        string code;
        lock (RoomsLock)
        {
            RemoveExpiredRooms();
            if (Rooms.Count >= config.MaxRooms)
            {
                throw new HubException("SERVER_FULL");
            }

            do
            {
                code = GenerateRoomCode();
            }
            while (Rooms.ContainsKey(code));

            Rooms.Add(code, new RoomState
            {
                Name = roomName,
                MaxPlayers = maxPlayers,
                IsPublic = request.IsPublic,
                AllowSpectators = request.AllowSpectators && config.MaxSpectatorsPerRoom > 0,
            });
        }

        return await JoinRoomCore(code, playerName, characterName, asSpectator: false, request.ReconnectToken, request.Color);
    }

    public async Task<JoinResponse> JoinRoom(JoinRoomRequest request)
    {
        if (request is null)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var code = ValidateRoomCode(request.Code);
        var playerName = ValidatePlayerName(request.PlayerName);
        // Espectador não precisa de personagem.
        var characterName = request.AsSpectator ? string.Empty : ValidateCharacterName(request.CharacterName);
        await LeaveCurrentRoom(false);
        return await JoinRoomCore(code, playerName, characterName, request.AsSpectator, request.ReconnectToken, request.Color);
    }

    // Salas públicas deste servidor, para a busca. Salas privadas só entram pelo código.
    public IReadOnlyList<PublicRoom> ListRooms()
    {
        lock (RoomsLock)
        {
            RemoveExpiredRooms();
            return Rooms.Where(pair => pair.Value.IsPublic && pair.Value.Players.Values.Any(player => player.ConnectionId is not null))
                .Select(pair =>
                {
                    var room = pair.Value;
                    var master = room.MasterPlayerId is not null && room.Players.TryGetValue(room.MasterPlayerId, out var found) ? found.Name : string.Empty;
                    return new PublicRoom(
                        pair.Key,
                        room.Name,
                        master,
                        room.Players.Values.Count(player => !player.IsSpectator),
                        room.MaxPlayers,
                        room.Players.Values.Count(player => player.IsSpectator),
                        room.AllowSpectators);
                })
                .OrderByDescending(room => room.Players)
                .ThenBy(room => room.Name, StringComparer.CurrentCultureIgnoreCase)
                .Take(100)
                .ToArray();
        }
    }

    // Só o mestre muda o nome, o limite, a visibilidade e os espectadores da sala.
    public async Task UpdateRoomSettings(RoomSettingsRequest request)
    {
        if (request is null)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var (code, playerId) = CurrentSeat();
        var roomName = ValidateRoomName(request.RoomName);
        RoomRoster roster;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(playerId, out var actor))
            {
                throw new HubException("NOT_IN_ROOM");
            }
            if (!actor.IsMaster)
            {
                throw new HubException("MASTER_ONLY");
            }
            var maxPlayers = ValidateMaxPlayers(request.MaxPlayers, room.Players.Values.Count(player => !player.IsSpectator));
            room.Name = roomName;
            room.MaxPlayers = maxPlayers;
            room.IsPublic = request.IsPublic;
            room.AllowSpectators = request.AllowSpectators && config.MaxSpectatorsPerRoom > 0;
            room.LastActivityUtc = DateTime.UtcNow;
            roster = CreateRoster(code, room);
        }
        await Clients.Group(code).SendAsync("RoomUpdated", roster);
    }

    public Task LeaveRoom() => LeaveCurrentRoom();

    // Cada jogador escolhe a cor da própria mesa; todos veem.
    public async Task SetPlayerColor(string color)
    {
        var valid = ValidColor(color) ?? throw new HubException("INVALID_REQUEST");
        var (code, playerId) = CurrentSeat();
        RoomRoster roster;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(playerId, out var player))
            {
                throw new HubException("NOT_IN_ROOM");
            }
            player.Color = valid;
            roster = CreateRoster(code, room);
        }
        await Clients.Group(code).SendAsync("RoomUpdated", roster);
    }

    // O mestre tira alguém da sala (jogador ou espectador). Com Ban, essa pessoa
    // (pelo IP) não consegue voltar para esta sala.
    public async Task KickPlayer(KickRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.PlayerId) || request.PlayerId.Length > 64)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var (code, masterId) = CurrentSeat();
        string? kickedConnection;
        RoomRoster roster;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(masterId, out var master))
            {
                throw new HubException("NOT_IN_ROOM");
            }
            if (!master.IsMaster)
            {
                throw new HubException("MASTER_ONLY");
            }
            if (request.PlayerId == masterId || !room.Players.TryGetValue(request.PlayerId, out var target))
            {
                throw new HubException("TARGET_UNAVAILABLE");
            }
            room.Players.Remove(target.Id);
            kickedConnection = target.ConnectionId;
            if (kickedConnection is not null)
            {
                room.ConnectionPlayers.Remove(kickedConnection);
            }
            // Nunca bloqueia o próprio computador do mestre (mesmo IP).
            if (request.Ban && target.ClientKey.Length > 0 && target.ClientKey != master.ClientKey)
            {
                room.BannedClients.Add(target.ClientKey);
            }
            room.LastActivityUtc = DateTime.UtcNow;
            roster = CreateRoster(code, room);
        }

        if (kickedConnection is not null)
        {
            await Groups.RemoveFromGroupAsync(kickedConnection, code);
            await Clients.Client(kickedConnection).SendAsync("Kicked", new { code, banned = request.Ban });
        }
        await Clients.Group(code).SendAsync("RoomUpdated", roster);
    }

    public async Task ShareRoll(RollPayload roll)
    {
        if (roll is null || !Guid.TryParse(roll.Id, out _)
            || string.IsNullOrWhiteSpace(roll.Notation) || roll.Notation.Length > 120
            || string.IsNullOrWhiteSpace(roll.Output) || roll.Output.Length > 1800
            || !double.IsFinite(roll.Total)
            || string.IsNullOrWhiteSpace(roll.TargetPlayerId) || roll.TargetPlayerId.Length > 64
            || roll.ExtraDice is < 0 or > 10000
            || (roll.Dice is not null && (roll.Dice.Count > MaxRollDice || roll.Dice.Any(die => die is null
                || die.Sides is < -1 or > 10000 || !double.IsFinite(die.Value) || !double.IsFinite(die.Natural)
                || Math.Abs(die.Value) > 1_000_000 || Math.Abs(die.Natural) > 1_000_000))))
        {
            throw new HubException("INVALID_ROLL");
        }

        var (code, playerId) = CurrentSeat();
        SharedRoll sharedRoll;
        string[] privateRecipients = Array.Empty<string>();
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room)
                || !room.Players.TryGetValue(playerId, out var actor)
                || actor.ConnectionId != Context.ConnectionId)
            {
                throw new HubException("NOT_IN_ROOM");
            }
            if (actor.IsSpectator)
            {
                throw new HubException("SPECTATOR_CANNOT_ROLL");
            }
            if (!room.Players.TryGetValue(roll.TargetPlayerId, out var target) || target.IsSpectator)
            {
                throw new HubException("TARGET_UNAVAILABLE");
            }
            if (!actor.IsMaster && target.Id != actor.Id)
            {
                throw new HubException("OWN_TABLE_ONLY");
            }
            if (roll.IsPrivate && (!actor.IsMaster || target.Id != actor.Id))
            {
                throw new HubException("PRIVATE_MASTER_ONLY");
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
                roll.IsPrivate,
                roll.Dice?.ToArray() ?? Array.Empty<RollDie>(),
                roll.ExtraDice,
                ValidDiceColor(roll.DiceColor));

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

    private (string Code, string PlayerId) CurrentSeat()
    {
        if (!Context.Items.TryGetValue("roomCode", out var roomValue) || roomValue is not string code
            || !Context.Items.TryGetValue("playerId", out var playerValue) || playerValue is not string playerId)
        {
            throw new HubException("NOT_IN_ROOM");
        }
        return (code, playerId);
    }

    private async Task<JoinResponse> JoinRoomCore(string code, string playerName, string characterName, bool asSpectator, string? reconnectToken, string? color)
    {
        RoomSnapshot snapshot;
        string playerId;
        string issuedToken;
        string? replacedConnectionId = null;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room))
            {
                throw new HubException("ROOM_NOT_FOUND");
            }

            PruneDisconnectedPlayers(room);
            var player = !string.IsNullOrWhiteSpace(reconnectToken)
                ? room.Players.Values.FirstOrDefault(candidate => TokensMatch(candidate.ReconnectToken, reconnectToken))
                : null;
            // Quem volta com o token mantém o papel; mudar de papel exige sair e entrar de novo.
            if (player is not null && player.IsSpectator != asSpectator)
            {
                room.Players.Remove(player.Id);
                if (player.ConnectionId is not null)
                {
                    room.ConnectionPlayers.Remove(player.ConnectionId);
                }
                if (room.MasterPlayerId == player.Id)
                {
                    room.MasterPlayerId = null;
                    PromoteNextMaster(room);
                }
                player = null;
            }

            var clientKey = Security.ClientKey(Context.GetHttpContext());
            if (player is null)
            {
                if (room.BannedClients.Contains(clientKey))
                {
                    throw new HubException("BANNED");
                }
                if (asSpectator)
                {
                    if (!room.AllowSpectators)
                    {
                        throw new HubException("SPECTATORS_DISABLED");
                    }
                    if (room.Players.Values.Count(candidate => candidate.IsSpectator) >= config.MaxSpectatorsPerRoom)
                    {
                        throw new HubException("SPECTATORS_FULL");
                    }
                }
                else if (room.Players.Values.Count(candidate => !candidate.IsSpectator) >= room.MaxPlayers)
                {
                    throw new HubException("ROOM_FULL");
                }

                player = new PlayerState
                {
                    Id = Guid.NewGuid().ToString("N"),
                    ReconnectToken = GenerateReconnectToken(),
                    Name = playerName,
                    CharacterName = characterName,
                    IsSpectator = asSpectator,
                    IsMaster = !asSpectator && room.MasterPlayerId is null,
                    JoinedAtUtc = DateTime.UtcNow,
                    ClientKey = clientKey,
                    // Sem escolha, cada jogador novo recebe a próxima cor da lista.
                    Color = ValidColor(color) ?? PlayerColors[room.Players.Values.Count(candidate => !candidate.IsSpectator) % PlayerColors.Length],
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
                player.Color = ValidColor(color) ?? player.Color;
                if (!player.IsSpectator)
                {
                    player.CharacterName = characterName;
                }
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
                            room.MasterPlayerId = null;
                            PromoteNextMaster(room, onlineOnly: true);
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

    // O mestre seguinte é o jogador (nunca espectador) que está há mais tempo na sala.
    private static void PromoteNextMaster(RoomState room, bool onlineOnly = false)
    {
        var nextMaster = room.Players.Values
            .Where(candidate => !candidate.IsSpectator && (!onlineOnly || candidate.ConnectionId is not null))
            .OrderBy(candidate => candidate.JoinedAtUtc)
            .FirstOrDefault();
        room.MasterPlayerId = nextMaster?.Id;
        if (nextMaster is not null)
        {
            nextMaster.IsMaster = true;
        }
    }

    private static string ValidateRoomCode(string? roomCode)
    {
        var code = (roomCode ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length != 6 || code.Any(character => !CodeCharacters.Contains(character)))
        {
            throw new HubException("INVALID_CODE");
        }
        return code;
    }

    private static string ValidatePlayerName(string? playerName) => ValidateText(playerName, 2, 22, "INVALID_NAME");

    private static string ValidateCharacterName(string? characterName) => ValidateText(characterName, 2, 30, "INVALID_CHARACTER");

    private static string ValidateRoomName(string? roomName) => ValidateText(roomName, 2, 40, "INVALID_ROOM_NAME");

    private static string ValidateText(string? value, int min, int max, string errorCode)
    {
        var text = (value ?? string.Empty).Trim();
        if (text.Length < min || text.Length > max || text.Any(IsHiddenCharacter))
        {
            throw new HubException(errorCode);
        }
        return text;
    }

    private int ValidateMaxPlayers(int maxPlayers, int currentPlayers)
    {
        if (maxPlayers < 2 || maxPlayers > config.MaxPlayersPerRoom)
        {
            throw new HubException("INVALID_MAX_PLAYERS");
        }
        if (maxPlayers < currentPlayers)
        {
            throw new HubException("MAX_BELOW_PLAYERS");
        }
        return maxPlayers;
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
        var players = room.Players.Values.Where(player => !player.IsSpectator).OrderBy(player => player.JoinedAtUtc).Select(player =>
            new RoomPlayer(
                player.Id,
                player.Name,
                player.CharacterName,
                player.IsMaster,
                player.ConnectionId is not null,
                player.Color,
                visibleRolls.LastOrDefault(roll => roll.TargetPlayerId == player.Id))).ToArray();
        return new RoomSnapshot(
            code,
            room.Name,
            room.MaxPlayers,
            room.IsPublic,
            room.AllowSpectators,
            config.MaxSpectatorsPerRoom,
            viewer.Id,
            viewer.IsMaster,
            viewer.IsSpectator,
            players,
            Spectators(room),
            visibleRolls);
    }

    private RoomRoster CreateRoster(string code)
    {
        lock (RoomsLock)
        {
            return Rooms.TryGetValue(code, out var room)
                ? CreateRoster(code, room)
                : new RoomRoster(code, string.Empty, 0, false, false, 0, Array.Empty<RoomPlayer>(), Array.Empty<RoomSpectator>());
        }
    }

    private RoomRoster CreateRoster(string code, RoomState room) => new(
        code,
        room.Name,
        room.MaxPlayers,
        room.IsPublic,
        room.AllowSpectators,
        config.MaxSpectatorsPerRoom,
        room.Players.Values.Where(player => !player.IsSpectator).OrderBy(player => player.JoinedAtUtc).Select(player =>
            new RoomPlayer(player.Id, player.Name, player.CharacterName, player.IsMaster, player.ConnectionId is not null, player.Color, null)).ToArray(),
        Spectators(room));

    private static RoomSpectator[] Spectators(RoomState room) => room.Players.Values
        .Where(player => player.IsSpectator)
        .OrderBy(player => player.JoinedAtUtc)
        .Select(player => new RoomSpectator(player.Id, player.Name, player.ConnectionId is not null))
        .ToArray();

    private static string GenerateReconnectToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static void PruneDisconnectedPlayers(RoomState room)
    {
        var expiredBefore = DateTime.UtcNow - DisconnectedLifetime;
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
            PromoteNextMaster(room);
        }
    }

    private static void RemoveExpiredRooms()
    {
        foreach (var room in Rooms.Values)
        {
            PruneDisconnectedPlayers(room);
        }
        var expiredBefore = DateTime.UtcNow - DisconnectedLifetime;
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
        public string Name { get; set; } = string.Empty;
        public int MaxPlayers { get; set; } = 8;
        public bool IsPublic { get; set; }
        public bool AllowSpectators { get; set; } = true;
        // Quem o mestre removeu e bloqueou (por IP), só para esta sala.
        public HashSet<string> BannedClients { get; } = new(StringComparer.Ordinal);
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
        public bool IsSpectator { get; init; }
        public string Color { get; set; } = PlayerColors[0];
        public string ClientKey { get; init; } = string.Empty;
        public string? ConnectionId { get; set; }
        public DateTime JoinedAtUtc { get; init; }
        public DateTime LastSeenUtc { get; set; } = DateTime.UtcNow;
    }
}
