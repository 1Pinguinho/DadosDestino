using System.Security.Cryptography;
using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// Status de dano (tabela do livro, p. 76). O dano acontece no fim do turno de quem
// está afetado: o primeiro stack usa o dano-base e cada stack a mais soma o acréscimo.
// Aplicar de novo soma 1 stack (até o máximo) e renova a duração. Uma ação aplica no
// máximo 1 stack. O servidor rola esses dados sozinho.
public sealed partial class TableHub
{
    // Resist: "magic" desconta a resistência mágica; "half-magic" só metade dela;
    // "none" ignora resistências (internos e espacial ignoram a armadura).
    private sealed record StatusRule(string Id, int BaseCount, int BaseSides, int IncCount, int IncSides, int Max, int Duration, string Resist);

    private static readonly StatusRule[] StatusRules =
    {
        new("queimando", 1, 6, 1, 4, 5, 3, "magic"),
        new("chamaInfernal", 1, 10, 1, 6, 4, 3, "magic"),
        new("sangrando", 1, 4, 1, 4, 6, 3, "none"),
        new("hemorragia", 1, 8, 1, 6, 3, 3, "none"),
        new("envenenado", 1, 6, 1, 4, 4, 4, "none"),
        new("corroido", 1, 8, 1, 4, 5, 3, "magic"),
        new("eletrocutado", 1, 8, 1, 4, 4, 2, "magic"),
        new("congelamento", 1, 6, 1, 4, 5, 3, "magic"),
        new("necrose", 1, 8, 1, 6, 4, 3, "magic"),
        new("sobrecarga", 1, 6, 1, 6, 5, 2, "half-magic"),
        new("deterioracao", 1, 10, 1, 4, 4, 3, "magic"),
        new("ruptura", 1, 8, 1, 6, 3, 2, "none"),
    };

    private static int Roll(int count, int sides)
    {
        var total = 0;
        for (var index = 0; index < count; index++)
        {
            total += RandomNumberGenerator.GetInt32(1, sides + 1);
        }
        return total;
    }

    // O mestre aplica a qualquer momento; quem acertou o ataque aplica 1 stack no alvo
    // durante o passo do dano (uma vez por ação).
    public Task ApplyStatus(string fighterId, string statusId) => CombatAction((room, combat, actor) =>
    {
        var rule = StatusRules.FirstOrDefault(candidate => candidate.Id == statusId) ?? throw new HubException("INVALID_REQUEST");
        var target = FindFighter(combat, fighterId);
        var current = combat.Current;
        var byAttacker = combat.Phase == "turns" && combat.Step == "damage" && current is not null && Controls(actor, current)
            && combat.TargetId == target.Id;
        if (!actor.IsMaster && !byAttacker)
        {
            throw new HubException("NOT_YOUR_TURN");
        }
        if (byAttacker && !actor.IsMaster)
        {
            if (combat.StatusApplied)
            {
                throw new HubException("STATUS_USED");
            }
            combat.StatusApplied = true;
        }
        if (target.Dead)
        {
            throw new HubException("TARGET_UNAVAILABLE");
        }
        var source = byAttacker ? current!.Id : null;
        combat.LastTicks.Clear();
        var effect = target.Statuses.FirstOrDefault(candidate => candidate.Id == rule.Id);
        if (effect is null)
        {
            target.Statuses.Add(new StatusEffect { Id = rule.Id, Stacks = 1, TurnsLeft = rule.Duration, SourceId = source });
        }
        else
        {
            effect.Stacks = Math.Min(rule.Max, effect.Stacks + 1);
            effect.TurnsLeft = rule.Duration;
            effect.SourceId = source ?? effect.SourceId;
            // Eletrocutado: ao chegar a 4 stacks, causa +2d8 na hora e volta a 1.
            if (rule.Id == "eletrocutado" && effect.Stacks >= 4)
            {
                var burst = Math.Max(0, Roll(2, 8) - StatusResistance(room, target, rule));
                DamageFighter(room, combat, target, burst, combat.Fighters.FirstOrDefault(fighter => fighter.Id == effect.SourceId));
                effect.Stacks = 1;
                combat.LastTicks.Add(new StatusTick(target.Id, rule.Id, burst, true));
            }
        }
        combat.LastEvent = new CombatEvent("statusApplied", source, target.Id, null) { StatusId = rule.Id };
    });

    public Task RemoveStatus(string fighterId, string statusId) => CombatAction((_, combat, actor) =>
    {
        if (!actor.IsMaster)
        {
            throw new HubException("MASTER_ONLY");
        }
        var target = FindFighter(combat, fighterId);
        target.Statuses.RemoveAll(effect => effect.Id == statusId);
        combat.LastEvent = new CombatEvent("statusRemoved", null, target.Id, null) { StatusId = statusId };
    });

    // Fim do turno de quem está afetado: rola o dano de cada status e conta a duração.
    private static void TickStatuses(RoomState room, CombatState combat, Fighter fighter)
    {
        foreach (var effect in fighter.Statuses.ToArray())
        {
            var rule = StatusRules.First(candidate => candidate.Id == effect.Id);
            var damage = Roll(rule.BaseCount, rule.BaseSides);
            for (var stack = 1; stack < effect.Stacks; stack++)
            {
                damage += Roll(rule.IncCount, rule.IncSides);
            }
            damage = Math.Max(0, damage - StatusResistance(room, fighter, rule));
            DamageFighter(room, combat, fighter, damage, combat.Fighters.FirstOrDefault(candidate => candidate.Id == effect.SourceId));
            combat.LastTicks.Add(new StatusTick(fighter.Id, rule.Id, damage, false));
            effect.TurnsLeft--;
            if (effect.TurnsLeft <= 0)
            {
                fighter.Statuses.Remove(effect);
            }
        }
    }

    private static int StatusResistance(RoomState room, Fighter fighter, StatusRule rule) => rule.Resist switch
    {
        "magic" => ResistanceOf(room, fighter, "magic"),
        "half-magic" => ResistanceOf(room, fighter, "magic") / 2,
        _ => 0,
    };

    // Tira vida e anota no resumo (dano causado, recebido e quedas).
    private static void DamageFighter(RoomState room, CombatState combat, Fighter target, int damage, Fighter? source)
    {
        var before = HpOf(room, target);
        SetHp(room, target, (hp, _) => hp - damage);
        var after = HpOf(room, target);
        var dealt = Math.Max(0, before - after);
        target.Stats.Taken += dealt;
        if (source is not null)
        {
            source.Stats.Dealt += dealt;
        }
        if (before > 0 && after <= 0)
        {
            target.Stats.Downs++;
            target.PenaltyArmed = false;
            target.Helped = false;
        }
        if (TryAccount(room, target) is { } accountId)
        {
            combat.ChangedAccounts.Add(accountId);
        }
    }

    private static void CountNatural(Fighter? fighter, RollPayload roll)
    {
        var natural = roll.Dice?.FirstOrDefault(die => die.Sides == 20 && die.Used)?.Natural;
        if (fighter is null || natural is null)
        {
            return;
        }
        if (natural == 20)
        {
            fighter.Stats.Crits++;
        }
        else if (natural == 1)
        {
            fighter.Stats.Fumbles++;
        }
    }

    // Encerrar: monta o resumo, manda para todos e deixa no chat.
    public async Task EndCombat()
    {
        var (code, playerId) = CurrentSeat();
        ChatMessage? message = null;
        lock (RoomsLock)
        {
            var (room, master) = RequireMaster(code, playerId);
            var combat = room.Combat;
            if (combat is not null && combat.Fighters.Count > 0 && combat.Round > 0)
            {
                var summary = new CombatSummary(combat.Round, combat.Fighters.Select(fighter => new FighterSummary(
                    NameOf(room, fighter), fighter.IsBoss, fighter.Stats.Dealt, fighter.Stats.Taken, fighter.Stats.Hits, fighter.Stats.Misses,
                    fighter.Stats.Crits, fighter.Stats.Fumbles, fighter.Stats.Downs, fighter.Stats.Rescues, fighter.Dead)).ToArray());
                message = new ChatMessage(Guid.NewGuid().ToString("N"), master.Id, master.Name, master.Color, string.Empty,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), summary);
                room.Chat.Add(message);
                if (room.Chat.Count > MaxChatHistory)
                {
                    room.Chat.RemoveAt(0);
                }
            }
            room.Combat = null;
            room.LastActivityUtc = DateTime.UtcNow;
        }
        await Clients.Group(code).SendAsync("CombatUpdated", (CombatView?)null);
        if (message is not null)
        {
            await Clients.Group(code).SendAsync("ChatMessage", message);
        }
    }

    private static string NameOf(RoomState room, Fighter fighter) =>
        fighter.IsBoss ? fighter.Name
        : fighter.PlayerId is not null && room.Players.TryGetValue(fighter.PlayerId, out var player)
            ? (string.IsNullOrEmpty(player.CharacterName) ? player.Name : player.CharacterName)
            : "?";

    // Ação no combate que qualquer um na sala pode tentar (as regras decidem).
    private async Task CombatAction(Action<RoomState, CombatState, PlayerState> change)
    {
        var (code, playerId) = CurrentSeat();
        CombatView? view;
        string[] changed;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(playerId, out var actor)
                || actor.ConnectionId != Context.ConnectionId)
            {
                throw new HubException("NOT_IN_ROOM");
            }
            var combat = room.Combat ?? throw new HubException("NO_COMBAT");
            change(room, combat, actor);
            view = ViewOf(room);
            changed = combat.ChangedAccounts.ToArray();
            combat.ChangedAccounts.Clear();
        }
        await Clients.Group(code).SendAsync("CombatUpdated", view);
        foreach (var accountId in changed)
        {
            await NotifyAccountChanged(hubContext, accountId);
        }
    }

    private sealed class StatusEffect
    {
        public string Id { get; init; } = string.Empty;
        public int Stacks { get; set; }
        public int TurnsLeft { get; set; }
        public string? SourceId { get; set; }
    }

    private sealed class FighterStats
    {
        public int Dealt { get; set; }
        public int Taken { get; set; }
        public int Hits { get; set; }
        public int Misses { get; set; }
        public int Crits { get; set; }
        public int Fumbles { get; set; }
        public int Downs { get; set; }
        public int Rescues { get; set; }
    }
}

public sealed record StatusView(string Id, int Stacks, int TurnsLeft);

// Dano de status no fim de um turno (Burst: o +2d8 do Eletrocutado).
public sealed record StatusTick(string FighterId, string StatusId, int Damage, bool Burst);

public sealed record FighterSummary(string Name, bool IsBoss, int Dealt, int Taken, int Hits, int Misses, int Crits, int Fumbles, int Downs, int Rescues, bool Died);

public sealed record CombatSummary(int Rounds, IReadOnlyList<FighterSummary> Fighters);
