using System.Security.Cryptography;
using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// Hub em tempo real das salas. Cada sala tem jogadores (cada um com sua mesa),
// espectadores (só assistem) e o mestre (quem criou; pode rolar em qualquer mesa).
// Tudo fica em memória e some quando o anfitrião fecha o app.
public sealed partial class TableHub : Hub
{
    private const int MaxRollHistory = 20;
    private const int MaxRollDice = 10;
    private const int MaxChatLength = 500;
    private const int MaxChatHistory = 200;
    private const int MaxNotes = 100;
    private const int MaxNoteTitle = 60;
    private const int MaxNoteText = 2000;
    private static readonly TimeSpan ReactionCooldown = TimeSpan.FromSeconds(1);

    // Reações que dá para mandar na mesa de outro jogador (o site tem a mesma lista).
    public static readonly string[] Reactions = { "😂", "😮", "🔥", "💀", "👏", "❤️", "😱", "🎲" };

    // Cores que um jogador pode dar à própria mesa e aos dados (o site tem os mesmos nomes).
    public static readonly string[] PlayerColors =
        { "violet", "rose", "amber", "sky", "emerald", "crimson", "teal", "gold", "blue", "slate" };
    private static readonly HashSet<string> DiceColors = new(PlayerColors.Append("classic"), StringComparer.Ordinal);
    // Modelos de dados (o site tem os mesmos nomes).
    public static readonly string[] DiceStyles =
        { "classic", "crystal", "metal", "neon", "rune", "galaxy", "lava", "ice", "wood", "pixel", "dragon", "bone" };

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

    private static int maxSpectatorsSetting;
    private readonly IHubContext<TableHub> hubContext;

    // Tipos de rolagem que o site pode mandar (ver SharedRoll.Kind).
    private static readonly string[] RollKinds = { "normal", "recovery", "damage", "attack", "reflex", "initiative", "medicine", "blind" };

    public TableHub(ServerConfig config, IHubContext<TableHub> hubContext)
    {
        this.config = config;
        this.hubContext = hubContext;
        maxSpectatorsSetting = config.MaxSpectatorsPerRoom;
        EnsureCombatClock(hubContext);
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
            while (Rooms.ContainsKey(code) || RoomStore.Exists(code));

            var room = new RoomState
            {
                Name = roomName,
                MaxPlayers = maxPlayers,
                IsPublic = request.IsPublic,
                AllowSpectators = request.AllowSpectators && config.MaxSpectatorsPerRoom > 0,
                OwnerAccountId = CurrentAccountId(),
            };
            Rooms.Add(code, room);
            Persist(code, room);
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
            Persist(code, room);
        }
        await Clients.Group(code).SendAsync("RoomUpdated", roster);
    }

    // ---------- contas ----------

    // O site manda o token da sessão logo ao conectar (e ao entrar ou sair da conta).
    // Se já estiver numa sala, a vaga passa a ser dessa conta (foto e ficha na mesa).
    public async Task<AccountInfo?> Authenticate(string? token)
    {
        var account = AccountStore.Instance.Resolve(token);
        if (account is null)
        {
            Context.Items.Remove("accountId");
        }
        else
        {
            Context.Items["accountId"] = account.Id;
        }

        if (Context.Items.TryGetValue("roomCode", out var roomValue) && roomValue is string code
            && Context.Items.TryGetValue("playerId", out var playerValue) && playerValue is string playerId)
        {
            RoomRoster? roster = null;
            lock (RoomsLock)
            {
                if (Rooms.TryGetValue(code, out var room) && room.Players.TryGetValue(playerId, out var player)
                    && player.AccountId != account?.Id
                    && (account is null || !room.Players.Values.Any(other => other.AccountId == account.Id)))
                {
                    player.AccountId = account?.Id;
                    roster = CreateRoster(code, room);
                }
            }
            if (roster is not null)
            {
                await Clients.Group(code).SendAsync("RoomUpdated", roster);
            }
        }
        return account;
    }

    // Mesas salvas do mestre logado.
    public IReadOnlyList<MyRoom> ListMyRooms()
    {
        var accountId = CurrentAccountId() ?? throw new HubException("NOT_LOGGED_IN");
        var saved = RoomStore.ByOwner(accountId);
        lock (RoomsLock)
        {
            return saved.Select(room => Rooms.TryGetValue(room.Code, out var open)
                    ? new MyRoom(room.Code, open.Name, true, open.Players.Values.Count(player => !player.IsSpectator && player.ConnectionId is not null), open.Notes.Count)
                    : new MyRoom(room.Code, room.Name, false, 0, room.Notes.Count))
                .ToArray();
        }
    }

    // O dono reabre a mesa salva com o mesmo código (e volta como mestre).
    public async Task<JoinResponse> ReopenRoom(ReopenRoomRequest request)
    {
        if (request is null)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var accountId = CurrentAccountId() ?? throw new HubException("NOT_LOGGED_IN");
        var code = ValidateRoomCode(request.Code);
        var playerName = ValidatePlayerName(request.PlayerName);
        var characterName = ValidateCharacterName(request.CharacterName);
        var saved = RoomStore.Load(code);
        if (saved is null || saved.OwnerAccountId != accountId)
        {
            throw new HubException("ROOM_NOT_FOUND");
        }
        await LeaveCurrentRoom();
        lock (RoomsLock)
        {
            if (!Rooms.ContainsKey(code))
            {
                RemoveExpiredRooms();
                if (Rooms.Count >= config.MaxRooms)
                {
                    throw new HubException("SERVER_FULL");
                }
                Rooms.Add(code, new RoomState
                {
                    Name = saved.Name,
                    MaxPlayers = Math.Clamp(saved.MaxPlayers, 2, config.MaxPlayersPerRoom),
                    IsPublic = saved.IsPublic,
                    AllowSpectators = saved.AllowSpectators && config.MaxSpectatorsPerRoom > 0,
                    OwnerAccountId = accountId,
                    Notes = saved.Notes ?? new(),
                    MasterNotes = saved.MasterNotes ?? string.Empty,
                });
            }
        }
        return await JoinRoomCore(code, playerName, characterName, asSpectator: false, reconnectToken: null, request.Color);
    }

    // O dono apaga a mesa salva de vez (notas incluídas). Se estiver aberta, continua
    // até todos saírem, mas não é mais salva.
    public void DeleteMyRoom(string code)
    {
        var accountId = CurrentAccountId() ?? throw new HubException("NOT_LOGGED_IN");
        code = ValidateRoomCode(code);
        var saved = RoomStore.Load(code);
        if (saved is null || saved.OwnerAccountId != accountId)
        {
            throw new HubException("ROOM_NOT_FOUND");
        }
        lock (RoomsLock)
        {
            if (Rooms.TryGetValue(code, out var room))
            {
                room.OwnerAccountId = null;
            }
            RoomStore.Delete(code);
        }
    }

    // ---------- notas da mesa ----------

    public Task AddNote(NoteRequest request) => ChangeNotes(request, (room, actor, accountId, title, text) =>
    {
        if (room.Notes.Count >= MaxNotes)
        {
            throw new HubException("TOO_MANY_NOTES");
        }
        room.Notes.Add(new RoomNote
        {
            Id = Guid.NewGuid().ToString("N"),
            AuthorAccountId = accountId,
            AuthorName = actor.Name,
            Title = title,
            Text = text,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });
    });

    public Task EditNote(NoteRequest request) => ChangeNotes(request, (room, actor, accountId, title, text) =>
    {
        var note = room.Notes.FirstOrDefault(candidate => candidate.Id == request.Id) ?? throw new HubException("NOTE_NOT_FOUND");
        if (note.AuthorAccountId != accountId)
        {
            throw new HubException("NOT_YOUR_NOTE");
        }
        note.Title = title;
        note.Text = text;
        note.AuthorName = actor.Name;
        note.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    });

    public Task DeleteNote(string noteId) => ChangeNotes(new NoteRequest(noteId, "-", "-"), (room, actor, accountId, _, _) =>
    {
        var note = room.Notes.FirstOrDefault(candidate => candidate.Id == noteId) ?? throw new HubException("NOTE_NOT_FOUND");
        if (note.AuthorAccountId != accountId && !actor.IsMaster)
        {
            throw new HubException("NOT_YOUR_NOTE");
        }
        room.Notes.Remove(note);
    });

    private async Task ChangeNotes(NoteRequest request, Action<RoomState, PlayerState, string, string, string> change)
    {
        if (request is null)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var title = Sheet.Clean(request.Title, MaxNoteTitle);
        var text = (request.Text ?? string.Empty).Trim();
        if (title.Length == 0 || text.Length == 0 || text.Length > MaxNoteText)
        {
            throw new HubException("INVALID_NOTE");
        }
        var accountId = CurrentAccountId() ?? throw new HubException("NOT_LOGGED_IN");
        var (code, playerId) = CurrentSeat();
        RoomNote[] notes;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(playerId, out var actor)
                || actor.ConnectionId != Context.ConnectionId)
            {
                throw new HubException("NOT_IN_ROOM");
            }
            change(room, actor, accountId, title, text);
            room.LastActivityUtc = DateTime.UtcNow;
            Persist(code, room);
            notes = room.Notes.ToArray();
        }
        await Clients.Group(code).SendAsync("NotesUpdated", notes);
    }

    // Grava a sala em disco quando ela tem dono (mestre com conta).
    private static void Persist(string code, RoomState room)
    {
        if (room.OwnerAccountId is null)
        {
            return;
        }
        RoomStore.Save(new SavedRoom
        {
            Code = code,
            Name = room.Name,
            MaxPlayers = room.MaxPlayers,
            IsPublic = room.IsPublic,
            AllowSpectators = room.AllowSpectators,
            OwnerAccountId = room.OwnerAccountId,
            Notes = room.Notes.ToList(),
            MasterNotes = room.MasterNotes,
        });
    }

    private string? CurrentAccountId() =>
        Context.Items.TryGetValue("accountId", out var value) && value is string accountId
        && AccountStore.Instance.Find(accountId) is not null
            ? accountId
            : null;

    // A ficha de uma conta mudou (pelo site ou por uma rolagem): as mesas onde ela
    // está recebem as barrinhas novas.
    public static async Task NotifyAccountChanged(IHubContext<TableHub> hub, string accountId)
    {
        var updates = new List<(string Code, RoomRoster Roster)>();
        lock (RoomsLock)
        {
            foreach (var (code, room) in Rooms)
            {
                if (room.Players.Values.Any(player => player.AccountId == accountId))
                {
                    updates.Add((code, CreateRosterFor(code, room)));
                }
            }
        }
        foreach (var (code, roster) in updates)
        {
            await hub.Clients.Group(code).SendAsync("RoomUpdated", roster);
        }
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

        var kind = roll.Kind ?? "normal";
        if (!RollKinds.Contains(kind) || roll.ManaCost is < 0 or > Sheet.MaxStatus
            || (roll.EffectTargetId is not null && roll.EffectTargetId.Length > 64))
        {
            throw new HubException("INVALID_ROLL");
        }
        var (code, playerId) = CurrentSeat();
        SharedRoll sharedRoll;
        string[] privateRecipients = Array.Empty<string>();
        var changedAccounts = new List<string>();
        string? effectTargetId = null;
        string? recoverStat = null;
        string? damageType = null;
        var manaCost = 0;
        int? applied = null;
        var combatChanged = false;
        (string[] Full, bool PlayerSees)? blindRecipients = null;
        CombatView? combatView = null;
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

            if (kind == "recovery")
            {
                // Poção: soma na vida ou na mana atual de quem bebe (você ou outro jogador),
                // sem passar do máximo. Caído (vida 0 ou menos) não passa de 0.
                recoverStat = roll.RecoverStat is "hp" or "ea" ? roll.RecoverStat : throw new HubException("INVALID_ROLL");
                CheckCombatPotion(room, actor);
                var drinker = roll.EffectTargetId is null ? actor
                    : room.Players.TryGetValue(roll.EffectTargetId, out var found) && !found.IsSpectator ? found
                    : throw new HubException("TARGET_UNAVAILABLE");
                if (drinker.AccountId is null || AccountStore.Instance.Status(drinker.AccountId) is null)
                {
                    throw new HubException("NO_SHEET");
                }
                var amount = (int)Math.Max(0, Math.Min(Sheet.MaxStatus, Math.Floor(roll.Total)));
                int before = 0, after = 0;
                AccountStore.Instance.ChangeStatus(drinker.AccountId, null, recoverStat, (current, max) =>
                {
                    before = current;
                    var ceiling = recoverStat == "hp" && current <= 0 ? 0 : max;
                    after = Math.Max(current, Math.Min(ceiling, current + amount));
                    return after;
                });
                applied = after - before;
                effectTargetId = drinker.Id;
                changedAccounts.Add(drinker.AccountId);
            }
            else if (kind == "damage")
            {
                damageType = roll.DamageType is "physical" or "magic" or "pierce" ? roll.DamageType : throw new HubException("INVALID_ROLL");
                if (damageType == "magic" && roll.ManaCost > 0)
                {
                    // Magia: a EA escolhida sai da ficha de quem conjura.
                    var status = actor.AccountId is null ? null : AccountStore.Instance.Status(actor.AccountId);
                    if (status is null)
                    {
                        throw new HubException("NO_SHEET");
                    }
                    if (roll.ManaCost > status.Ea)
                    {
                        throw new HubException("NOT_ENOUGH_MANA");
                    }
                    AccountStore.Instance.ChangeStatus(actor.AccountId!, null, "ea", (current, _) => current - roll.ManaCost);
                    manaCost = roll.ManaCost;
                    changedAccounts.Add(actor.AccountId!);
                }
            }

            string? blindLabel = null;
            var blindSees = false;
            if (kind == "blind")
            {
                // Teste às cegas: só vale o pedido que o mestre fez para esta pessoa.
                if (roll.IsPrivate || roll.EffectTargetId is null
                    || !room.BlindRequests.TryGetValue(roll.EffectTargetId, out var request) || request.PlayerId != actor.Id)
                {
                    throw new HubException("NO_BLIND_REQUEST");
                }
                room.BlindRequests.Remove(roll.EffectTargetId);
                blindLabel = request.Label;
                blindSees = request.PlayerSees;
            }

            if (ApplyCombatRoll(room, actor, roll, kind, changedAccounts))
            {
                combatView = ViewOf(room);
                combatChanged = true;
            }
            if (room.Combat is { } activeCombat)
            {
                changedAccounts.AddRange(activeCombat.ChangedAccounts);
                activeCombat.ChangedAccounts.Clear();
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
                ValidDiceColor(roll.DiceColor),
                roll.DiceStyle is not null && DiceStyles.Contains(roll.DiceStyle) ? roll.DiceStyle : "classic",
                kind,
                effectTargetId,
                recoverStat,
                damageType,
                manaCost,
                applied,
                blindLabel,
                blindSees);

            room.Rolls.Add(sharedRoll);
            if (room.Rolls.Count > MaxRollHistory)
            {
                room.Rolls.RemoveAt(0);
            }
            room.LastActivityUtc = DateTime.UtcNow;
            if (kind == "blind")
            {
                blindRecipients = BlindRecipients(room, actor, sharedRoll);
            }
            if (roll.IsPrivate)
            {
                privateRecipients = new[] { actor.ConnectionId, target.ConnectionId }
                    .OfType<string>()
                    .Distinct(StringComparer.Ordinal)
                    .ToArray();
            }
        }

        if (blindRecipients is { } blind)
        {
            // Às cegas: o mestre (e o jogador, se o mestre deixou) veem tudo; os outros, só "?".
            await Clients.Clients(blind.Full).SendAsync("ReceiveRoll", sharedRoll);
            await Clients.GroupExcept(code, blind.Full).SendAsync("ReceiveRoll", Masked(sharedRoll));
        }
        else if (roll.IsPrivate)
        {
            await Clients.Clients(privateRecipients).SendAsync("ReceiveRoll", sharedRoll);
        }
        else
        {
            await Clients.Group(code).SendAsync("ReceiveRoll", sharedRoll);
        }
        foreach (var accountId in changedAccounts.Distinct())
        {
            await NotifyAccountChanged(hubContext, accountId);
        }
        if (combatChanged)
        {
            await Clients.Group(code).SendAsync("CombatUpdated", combatView);
        }
    }

    // Chat da sala: jogadores e espectadores. Fica guardado (as últimas MaxChatHistory)
    // enquanto a sala existir, para quem sai e volta continuar vendo a conversa.
    public async Task SendChat(string text)
    {
        var message = (text ?? string.Empty).Trim();
        if (message.Length == 0 || message.Length > MaxChatLength)
        {
            throw new HubException("INVALID_MESSAGE");
        }
        var (code, playerId) = CurrentSeat();
        ChatMessage chat;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room)
                || !room.Players.TryGetValue(playerId, out var actor)
                || actor.ConnectionId != Context.ConnectionId)
            {
                throw new HubException("NOT_IN_ROOM");
            }
            chat = new ChatMessage(
                Guid.NewGuid().ToString("N"),
                actor.Id,
                actor.Name,
                actor.IsSpectator ? string.Empty : actor.Color,
                message,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            room.Chat.Add(chat);
            if (room.Chat.Count > MaxChatHistory)
            {
                room.Chat.RemoveAt(0);
            }
            room.LastActivityUtc = DateTime.UtcNow;
        }
        await Clients.Group(code).SendAsync("ChatMessage", chat);
    }

    // Reação rápida na mesa de um jogador: aparece, flutua e some para todos.
    // Uma por segundo por pessoa; reações a mais são ignoradas sem erro.
    public async Task SendReaction(string targetPlayerId, string emoji)
    {
        if (string.IsNullOrWhiteSpace(targetPlayerId) || targetPlayerId.Length > 64
            || emoji is null || !Reactions.Contains(emoji))
        {
            throw new HubException("INVALID_REQUEST");
        }
        var (code, playerId) = CurrentSeat();
        TableReaction reaction;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room)
                || !room.Players.TryGetValue(playerId, out var actor)
                || actor.ConnectionId != Context.ConnectionId)
            {
                throw new HubException("NOT_IN_ROOM");
            }
            if (!room.Players.TryGetValue(targetPlayerId, out var target) || target.IsSpectator)
            {
                throw new HubException("TARGET_UNAVAILABLE");
            }
            var now = DateTime.UtcNow;
            if (now - actor.LastReactionUtc < ReactionCooldown)
            {
                return;
            }
            actor.LastReactionUtc = now;
            reaction = new TableReaction(target.Id, emoji, actor.Name);
        }
        await Clients.Group(code).SendAsync("Reaction", reaction);
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
                // Mesa salva que o mestre ainda não reabriu.
                throw new HubException(RoomStore.Exists(code) ? "ROOM_CLOSED" : "ROOM_NOT_FOUND");
            }

            PruneDisconnectedPlayers(room);
            var accountId = CurrentAccountId();
            var player = !string.IsNullOrWhiteSpace(reconnectToken)
                ? room.Players.Values.FirstOrDefault(candidate => TokensMatch(candidate.ReconnectToken, reconnectToken))
                : null;
            // Com conta, volta para a própria vaga mesmo de outro navegador.
            player ??= accountId is null ? null : room.Players.Values.FirstOrDefault(candidate => candidate.AccountId == accountId);
            if (player is not null && player.AccountId is not null && accountId is not null && player.AccountId != accountId)
            {
                player = null;
            }
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
            if (accountId is not null)
            {
                player.AccountId = accountId;
            }
            // O dono da mesa salva sempre volta como mestre.
            if (!player.IsSpectator && room.OwnerAccountId is not null && player.AccountId == room.OwnerAccountId && !player.IsMaster)
            {
                foreach (var other in room.Players.Values)
                {
                    other.IsMaster = false;
                }
                player.IsMaster = true;
                room.MasterPlayerId = player.Id;
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
            || viewer.IsMaster || roll.TargetPlayerId == viewer.Id)
            .Select(roll => BlindFor(roll, viewer)).ToArray();
        var players = room.Players.Values.Where(player => !player.IsSpectator).OrderBy(player => player.JoinedAtUtc)
            .Select(player => ToRoomPlayer(player, visibleRolls.LastOrDefault(roll => roll.TargetPlayerId == player.Id))).ToArray();
        return new RoomSnapshot(
            code,
            room.Name,
            room.MaxPlayers,
            room.IsPublic,
            room.AllowSpectators,
            config.MaxSpectatorsPerRoom,
            viewer.Id,
            viewer.AccountId,
            viewer.IsMaster,
            viewer.IsSpectator,
            players,
            Spectators(room),
            visibleRolls,
            room.Chat.ToArray(),
            room.Notes.ToArray(),
            room.OwnerAccountId is not null,
            ViewOf(room),
            room.BlindRequests.Where(pair => pair.Value.PlayerId == viewer.Id).Select(pair => pair.Value.View(pair.Key)).ToArray(),
            room.Ambient);
    }

    private static RoomPlayer ToRoomPlayer(PlayerState player, SharedRoll? lastRoll)
    {
        var account = player.AccountId is null ? null : AccountStore.Instance.Find(player.AccountId);
        return new RoomPlayer(
            player.Id,
            player.Name,
            player.CharacterName,
            player.IsMaster,
            player.ConnectionId is not null,
            player.Color,
            lastRoll,
            account?.Id,
            account?.AvatarVersion ?? 0,
            account is null ? null : AccountStore.Instance.Status(account.Id),
            player.Look);
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

    private RoomRoster CreateRoster(string code, RoomState room) => CreateRosterFor(code, room);

    private static RoomRoster CreateRosterFor(string code, RoomState room) => new(
        code,
        room.Name,
        room.MaxPlayers,
        room.IsPublic,
        room.AllowSpectators,
        maxSpectatorsSetting,
        room.Players.Values.Where(player => !player.IsSpectator).OrderBy(player => player.JoinedAtUtc)
            .Select(player => ToRoomPlayer(player, null)).ToArray(),
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
        public List<ChatMessage> Chat { get; } = new();
        public List<RoomNote> Notes { get; set; } = new();
        public CombatState? Combat { get; set; }
        public string MasterNotes { get; set; } = string.Empty;
        public string Ambient { get; set; } = string.Empty;
        // Testes às cegas pedidos pelo mestre e ainda não rolados (id → pedido).
        public Dictionary<string, BlindRequestState> BlindRequests { get; } = new(StringComparer.Ordinal);
        // Conta do mestre que criou a sala: com ela, a sala fica salva em disco.
        public string? OwnerAccountId { get; set; }
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
        public DateTime LastReactionUtc { get; set; } = DateTime.MinValue;
        public string? AccountId { get; set; }
        public SeatLook? Look { get; set; }
    }
}
