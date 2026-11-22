using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// Escudo do mestre: notas secretas (só o mestre recebe) e testes às cegas.
public sealed partial class TableHub
{
    private const int MaxMasterNotes = 6000;
    private const int MaxBlindRequests = 20;

    public string GetMasterNotes()
    {
        var (code, playerId) = CurrentSeat();
        lock (RoomsLock)
        {
            var (room, _) = RequireMaster(code, playerId);
            return room.MasterNotes;
        }
    }

    public void SaveMasterNotes(string text)
    {
        var notes = (text ?? string.Empty).Length > MaxMasterNotes ? throw new HubException("INVALID_NOTE") : text ?? string.Empty;
        var (code, playerId) = CurrentSeat();
        lock (RoomsLock)
        {
            var (room, _) = RequireMaster(code, playerId);
            room.MasterNotes = notes;
            Persist(code, room);
        }
    }

    // O mestre pede um teste a um jogador. O jogador recebe o pedido com um botão;
    // o resultado vai inteiro só para o mestre (e para o jogador, se o mestre deixar).
    public async Task RequestBlindRoll(BlindRollRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.PlayerId) || request.PlayerId.Length > 64)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var label = ValidateText(request.Label, 1, 40, "INVALID_REQUEST");
        var skillId = request.SkillId is null ? null
            : Sheet.SkillList.Any(skill => skill.Id == request.SkillId) ? request.SkillId : throw new HubException("INVALID_REQUEST");
        var notation = request.Notation is null ? null : ValidateText(request.Notation, 2, 60, "INVALID_REQUEST");
        if (skillId is null && notation is null)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var (code, playerId) = CurrentSeat();
        string? connection;
        string id;
        BlindRequestState state;
        lock (RoomsLock)
        {
            var (room, _) = RequireMaster(code, playerId);
            if (!room.Players.TryGetValue(request.PlayerId, out var target) || target.IsSpectator)
            {
                throw new HubException("TARGET_UNAVAILABLE");
            }
            if (room.BlindRequests.Count >= MaxBlindRequests)
            {
                room.BlindRequests.Remove(room.BlindRequests.Keys.First());
            }
            id = Guid.NewGuid().ToString("N")[..12];
            state = new BlindRequestState(target.Id, label, skillId, notation, request.PlayerSees);
            room.BlindRequests[id] = state;
            connection = target.ConnectionId;
        }
        if (connection is not null)
        {
            await Clients.Client(connection).SendAsync("BlindRequest", state.View(id));
        }
    }

    // Visual da mesa do jogador (superfície, moldura, brasão, efeito e cores). Todos veem.
    public async Task SetSeatLook(SeatLook look)
    {
        var clean = (look ?? SeatLook.Default).Clean();
        var (code, playerId) = CurrentSeat();
        RoomRoster roster;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(playerId, out var player)
                || player.ConnectionId != Context.ConnectionId)
            {
                throw new HubException("NOT_IN_ROOM");
            }
            if (player.Look == clean)
            {
                return;
            }
            player.Look = clean;
            roster = CreateRoster(code, room);
        }
        await Clients.Group(code).SendAsync("RoomUpdated", roster);
    }

    // Trilha ambiente da mesa ("" = silêncio). Cada pessoa controla o próprio volume.
    private static readonly string[] AmbientScenes = { "", "rain", "storm", "wind", "fire" };

    public async Task SetAmbient(string scene)
    {
        var value = scene ?? string.Empty;
        if (!AmbientScenes.Contains(value))
        {
            throw new HubException("INVALID_REQUEST");
        }
        var (code, playerId) = CurrentSeat();
        lock (RoomsLock)
        {
            var (room, _) = RequireMaster(code, playerId);
            room.Ambient = value;
        }
        await Clients.Group(code).SendAsync("AmbientChanged", value);
    }

    private (RoomState Room, PlayerState Master) RequireMaster(string code, string playerId)
    {
        if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(playerId, out var actor)
            || actor.ConnectionId != Context.ConnectionId)
        {
            throw new HubException("NOT_IN_ROOM");
        }
        if (!actor.IsMaster)
        {
            throw new HubException("MASTER_ONLY");
        }
        return (room, actor);
    }

    // Quem recebe a rolagem às cegas inteira: o mestre e, se ele deixou, quem rolou.
    private static (string[] Full, bool PlayerSees) BlindRecipients(RoomState room, PlayerState actor, SharedRoll roll)
    {
        var full = room.Players.Values
            .Where(player => player.IsMaster || (roll.BlindSees && player.Id == actor.Id))
            .Select(player => player.ConnectionId)
            .OfType<string>()
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        return (full, roll.BlindSees);
    }

    // Versão "?" da rolagem às cegas: sem total, sem dados, sem detalhes.
    private static SharedRoll Masked(SharedRoll roll) => roll with
    {
        Notation = roll.Label ?? "?",
        Total = 0,
        Output = string.Empty,
        Dice = Array.Empty<RollDie>(),
        ExtraDice = 0,
        Hidden = true,
    };

    private static SharedRoll BlindFor(SharedRoll roll, PlayerState viewer) =>
        roll.Kind != "blind" || viewer.IsMaster || (roll.BlindSees && roll.PlayerId == viewer.Id) ? roll : Masked(roll);

    private sealed record BlindRequestState(string PlayerId, string Label, string? SkillId, string? Notation, bool PlayerSees)
    {
        public BlindRequestView View(string id) => new(id, Label, SkillId, Notation, PlayerSees);
    }
}
