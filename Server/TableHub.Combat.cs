using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// Combate com turnos. O mestre liga o combate, cadastra os chefes (que ele controla)
// e todos rolam iniciativa. Na sua vez, o jogador escolhe um alvo e rola o ataque; o
// alvo rola Reflexos (empate é da defesa). Se acertou, o atacante rola o dano, que
// perde a resistência do mesmo tipo do alvo e sai direto da vida. Quem cai (vida 0 ou
// menos) só volta com um teste de Medicina de outro jogador (DT 18 + 1 a cada 5 de vida
// negativa), com 3 chances. Tempos: 30 s para o alvo reagir e 1 min para quem está na vez.
public sealed partial class TableHub
{
    private static readonly TimeSpan ReactionTime = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan TurnTime = TimeSpan.FromMinutes(1);
    private const int MaxFighters = 30;
    private static IHubContext<TableHub>? sharedHub;
    private static System.Threading.Timer? combatClock;

    private static readonly string[] DamageTypes = { "physical", "magic", "pierce" };

    private static void EnsureCombatClock(IHubContext<TableHub> hub)
    {
        sharedHub = hub;
        combatClock ??= new System.Threading.Timer(_ => _ = CombatTick(), null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
    }

    // ---------- comandos do mestre ----------

    public Task StartCombat() => MasterCombat((room, _) =>
    {
        if (room.Combat is not null)
        {
            throw new HubException("COMBAT_ACTIVE");
        }
        var combat = new CombatState();
        foreach (var player in room.Players.Values.Where(player => !player.IsSpectator && !player.IsMaster).OrderBy(player => player.JoinedAtUtc))
        {
            if (player.AccountId is not null && AccountStore.Instance.Status(player.AccountId) is not null)
            {
                combat.Fighters.Add(new Fighter { Id = Guid.NewGuid().ToString("N")[..12], PlayerId = player.Id });
            }
        }
        room.Combat = combat;
        combat.LastEvent = new CombatEvent("start", null, null, null);
    });

    public Task AddBoss(BossRequest request) => MasterCombat((room, combat) =>
    {
        if (request is null || combat is null)
        {
            throw new HubException("INVALID_REQUEST");
        }
        if (combat.Fighters.Count >= MaxFighters)
        {
            throw new HubException("TOO_MANY_FIGHTERS");
        }
        var name = ValidateText(request.Name, 1, 30, "INVALID_NAME");
        var boss = new Fighter
        {
            Id = Guid.NewGuid().ToString("N")[..12],
            Name = name,
            IsBoss = true,
            HpMax = Math.Clamp(request.Hp, 1, Sheet.MaxStatus),
            Hp = Math.Clamp(request.Hp, 1, Sheet.MaxStatus),
            ReflexBonus = Math.Clamp(request.ReflexBonus, -99, 99),
            Resist = new Resistances
            {
                Physical = Math.Clamp(request.ResistPhysical, 0, 999),
                Magic = Math.Clamp(request.ResistMagic, 0, 999),
                Pierce = Math.Clamp(request.ResistPierce, 0, 999),
            },
        };
        combat.Fighters.Add(boss);
        if (combat.Phase == "turns")
        {
            boss.Initiative = 0;
        }
    });

    public Task RemoveFighter(string fighterId) => MasterCombat((_, combat) =>
    {
        var fighter = FindFighter(combat, fighterId);
        var current = combat!.Phase == "turns" ? combat.Current : null;
        combat.Fighters.Remove(fighter);
        if (current == fighter)
        {
            combat.TurnIndex--;
            Advance(combat, null);
        }
        else if (current is not null)
        {
            combat.TurnIndex = combat.Fighters.IndexOf(current);
        }
    });

    // Monta a ordem pela iniciativa (maior primeiro) e começa a primeira rodada.
    public Task BeginTurns() => MasterCombat((room, combat) =>
    {
        if (combat is null || combat.Phase != "initiative" || combat.Fighters.Count == 0)
        {
            throw new HubException("INVALID_REQUEST");
        }
        combat.Fighters = combat.Fighters
            .OrderByDescending(fighter => fighter.Initiative ?? int.MinValue)
            .ThenBy(fighter => fighter.IsBoss)
            .ToList();
        combat.Phase = "turns";
        combat.Round = 1;
        combat.TurnIndex = -1;
        Advance(combat, room);
    });

    // O mestre muda a ordem (a vez continua com quem estava).
    public Task ReorderCombat(string[] fighterIds) => MasterCombat((_, combat) =>
    {
        if (combat is null || fighterIds is null || fighterIds.Length != combat.Fighters.Count
            || fighterIds.Distinct().Count() != fighterIds.Length)
        {
            throw new HubException("INVALID_REQUEST");
        }
        var current = combat.Phase == "turns" ? combat.Current : null;
        combat.Fighters = fighterIds.Select(id => FindFighter(combat, id)).ToList();
        if (current is not null)
        {
            combat.TurnIndex = combat.Fighters.IndexOf(current);
        }
    });

    public Task PauseCombat() => MasterCombat((_, combat) =>
    {
        if (combat is null || combat.Phase != "turns" || combat.Paused)
        {
            throw new HubException("INVALID_REQUEST");
        }
        combat.Paused = true;
        combat.PausedRemaining = combat.StepEndsUtc - DateTime.UtcNow;
        combat.LastEvent = new CombatEvent("paused", null, null, null);
    });

    // Volta exatamente de onde parou (mesma pessoa, mesmo passo, tempo restante).
    public Task ResumeCombat() => MasterCombat((_, combat) =>
    {
        if (combat is null || !combat.Paused)
        {
            throw new HubException("INVALID_REQUEST");
        }
        combat.Paused = false;
        combat.StepEndsUtc = DateTime.UtcNow + (combat.PausedRemaining is { } left && left > TimeSpan.FromSeconds(5) ? left : TimeSpan.FromSeconds(15));
        combat.LastEvent = new CombatEvent("resumed", null, null, null);
    });

    public Task EndCombat() => MasterCombat((room, _) => room.Combat = null);

    // Piedade: uma chance a mais para quem está caído.
    public Task Mercy(string fighterId) => MasterCombat((room, combat) =>
    {
        var fighter = FindFighter(combat, fighterId);
        if (fighter.Dead || !IsDown(room, fighter))
        {
            throw new HubException("INVALID_REQUEST");
        }
        if (fighter.LastChance)
        {
            fighter.LastChance = false;
            fighter.Chances = 1;
        }
        else
        {
            fighter.Chances = Math.Min(9, fighter.Chances + 1);
        }
        combat!.LastEvent = new CombatEvent("mercy", null, fighter.Id, fighter.Chances);
    });

    // O mestre traz alguém de volta (vida 1 e 3 chances).
    public Task Revive(string fighterId) => MasterCombat((room, combat) =>
    {
        var fighter = FindFighter(combat, fighterId);
        fighter.Dead = false;
        fighter.LastChance = false;
        fighter.Chances = 3;
        fighter.PenaltyArmed = false;
        SetHp(room, fighter, (_, _) => 1);
        combat!.LastEvent = new CombatEvent("revived", null, fighter.Id, null);
    });

    // ---------- ações de quem está na vez ----------

    // Escolhe o alvo: inimigo (ataque) ou aliado caído (socorro com Medicina).
    public Task ChooseTarget(string fighterId) => TurnAction((room, combat, current, actor) =>
    {
        if (combat.Step != "act")
        {
            throw new HubException("WRONG_STEP");
        }
        var target = FindFighter(combat, fighterId);
        if (target == current || target.Dead || (target.IsBoss && target.Hp <= 0))
        {
            throw new HubException("TARGET_UNAVAILABLE");
        }
        combat.TargetId = target.Id;
        combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
    });

    public Task PassTurn() => TurnAction((room, combat, current, actor) =>
    {
        combat.LastEvent = new CombatEvent("passed", current.Id, null, null);
        Advance(combat, room);
    }, allowMaster: true);

    // ---------- rolagens do combate (chamado dentro do ShareRoll, com a sala travada) ----------

    private bool ApplyCombatRoll(RoomState room, PlayerState actor, RollPayload roll, string kind, List<string> changedAccounts)
    {
        var combat = room.Combat;
        if (kind is "attack" or "reflex" or "medicine" or "initiative")
        {
            if (combat is null || combat.Paused)
            {
                throw new HubException("NO_COMBAT");
            }
        }
        else if (combat is null || combat.Paused || combat.Phase != "turns")
        {
            return false;
        }

        var total = (int)Math.Floor(roll.Total);
        switch (kind)
        {
            case "initiative":
            {
                if (combat!.Phase != "initiative")
                {
                    throw new HubException("WRONG_STEP");
                }
                var fighter = roll.EffectTargetId is not null && actor.IsMaster
                    ? FindFighter(combat, roll.EffectTargetId)
                    : combat.Fighters.FirstOrDefault(candidate => candidate.PlayerId == actor.Id) ?? throw new HubException("NOT_IN_COMBAT");
                if (!Controls(actor, fighter))
                {
                    throw new HubException("NOT_YOUR_TURN");
                }
                fighter.Initiative = total;
                combat.LastEvent = new CombatEvent("initiative", fighter.Id, null, total);
                return true;
            }
            case "attack":
            {
                var current = RequireTurn(combat!, actor, "act");
                var target = combat!.TargetId is null ? throw new HubException("CHOOSE_TARGET") : FindFighter(combat, combat.TargetId);
                if (IsDown(room, target))
                {
                    throw new HubException("TARGET_UNAVAILABLE");
                }
                combat.AttackTotal = total;
                combat.Step = "reflex";
                combat.StepEndsUtc = DateTime.UtcNow + ReactionTime;
                combat.LastEvent = new CombatEvent("attack", current.Id, target.Id, total);
                return true;
            }
            case "reflex":
            {
                if (combat!.Phase != "turns" || combat.Step != "reflex" || combat.TargetId is null)
                {
                    throw new HubException("WRONG_STEP");
                }
                var target = FindFighter(combat, combat.TargetId);
                if (!Controls(actor, target))
                {
                    throw new HubException("NOT_YOUR_TURN");
                }
                var current = combat.Current!;
                if (combat.AttackTotal > total)
                {
                    combat.Step = "damage";
                    combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
                    combat.LastEvent = new CombatEvent("hit", current.Id, target.Id, total);
                }
                else
                {
                    combat.LastEvent = new CombatEvent("miss", current.Id, target.Id, total);
                    Advance(combat, room);
                }
                return true;
            }
            case "damage":
            {
                var current = combat!.Current;
                if (combat.Step != "damage" || current is null || !Controls(actor, current) || combat.TargetId is null)
                {
                    // Dano fora do passo certo: só uma rolagem, sem efeito.
                    return false;
                }
                var target = FindFighter(combat, combat.TargetId);
                var type = DamageTypes.Contains(roll.DamageType) ? roll.DamageType! : "physical";
                var resistance = ResistanceOf(room, target, type);
                var damage = Math.Max(0, total - resistance);
                SetHp(room, target, (hp, _) => hp - damage);
                if (TryAccount(room, target) is { } accountId)
                {
                    changedAccounts.Add(accountId);
                }
                combat.LastEvent = new CombatEvent("damage", current.Id, target.Id, damage);
                if (IsDown(room, target))
                {
                    target.PenaltyArmed = false;
                    target.Helped = false;
                }
                Advance(combat, room);
                return true;
            }
            case "medicine":
            {
                var current = RequireTurn(combat!, actor, "act");
                var target = combat!.TargetId is null ? throw new HubException("CHOOSE_TARGET") : FindFighter(combat, combat.TargetId);
                if (target.IsBoss || target.Dead || !IsDown(room, target))
                {
                    throw new HubException("TARGET_UNAVAILABLE");
                }
                var hp = HpOf(room, target);
                var dt = RescueDt(hp);
                var natural = roll.Dice?.FirstOrDefault(die => die.Sides == 20 && die.Used)?.Natural;
                target.Helped = true;
                if (total >= dt || natural == 20)
                {
                    var critical = natural == 20;
                    SetHp(room, target, (_, max) => critical ? Math.Max(1, (int)Math.Ceiling(max / 2.0)) : 1);
                    target.Chances = 3;
                    target.LastChance = false;
                    combat.LastEvent = new CombatEvent(critical ? "rescuedCritical" : "rescued", current.Id, target.Id, total);
                }
                else
                {
                    LoseChances(target, natural == 1 ? 2 : 1);
                    combat.LastEvent = new CombatEvent(target.Dead ? "died" : natural == 1 ? "rescueFumble" : "rescueFailed", current.Id, target.Id, total);
                }
                if (TryAccount(room, target) is { } accountId)
                {
                    changedAccounts.Add(accountId);
                }
                Advance(combat, room);
                return true;
            }
            case "recovery":
            {
                // Poção em combate: só na sua vez, uma por turno, sem gastar a vez.
                var current = combat!.Current;
                if (current is null || !Controls(actor, current))
                {
                    throw new HubException("NOT_YOUR_TURN");
                }
                if (current.PotionUsed)
                {
                    throw new HubException("POTION_USED");
                }
                current.PotionUsed = true;
                combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
                return true;
            }
        }
        return false;
    }

    // Dano de mana e poção em combate passam por aqui antes de mexer na ficha.
    private static void CheckCombatPotion(RoomState room, PlayerState actor)
    {
        var combat = room.Combat;
        if (combat is { Phase: "turns", Paused: false })
        {
            var current = combat.Current;
            if (current is null || !Controls(actor, current))
            {
                throw new HubException("NOT_YOUR_TURN");
            }
            if (current.PotionUsed)
            {
                throw new HubException("POTION_USED");
            }
        }
    }

    // ---------- regras ----------

    public static int RescueDt(int hp) => 18 + Math.Abs(Math.Min(0, hp)) / 5;

    private static void LoseChances(Fighter fighter, int amount)
    {
        if (fighter.LastChance)
        {
            fighter.Dead = true;
            return;
        }
        fighter.Chances -= amount;
        if (fighter.Chances <= 0)
        {
            fighter.Chances = 0;
            fighter.LastChance = true;
        }
    }

    // Passa a vez: pula mortos, chefes derrotados e caídos (que perdem uma chance se
    // ninguém tentou salvá-los desde a vez anterior deles).
    private static void Advance(CombatState combat, RoomState? room)
    {
        if (room is not null)
        {
            combat.Fighters.RemoveAll(fighter => fighter.PlayerId is not null && !room.Players.ContainsKey(fighter.PlayerId));
        }
        combat.Step = "act";
        combat.TargetId = null;
        combat.AttackTotal = 0;
        if (combat.Fighters.Count == 0)
        {
            combat.TurnIndex = 0;
            return;
        }
        for (var steps = 0; steps < combat.Fighters.Count * 2; steps++)
        {
            combat.TurnIndex++;
            if (combat.TurnIndex >= combat.Fighters.Count)
            {
                combat.TurnIndex = 0;
                combat.Round++;
            }
            var fighter = combat.Fighters[combat.TurnIndex];
            if (fighter.Dead || (fighter.IsBoss && fighter.Hp <= 0))
            {
                continue;
            }
            if (room is not null && IsDown(room, fighter))
            {
                if (fighter.PenaltyArmed && !fighter.Helped)
                {
                    LoseChances(fighter, 1);
                    combat.LastEvent = new CombatEvent(fighter.Dead ? "died" : "bleeding", null, fighter.Id, null);
                }
                fighter.PenaltyArmed = true;
                fighter.Helped = false;
                continue;
            }
            fighter.PotionUsed = false;
            combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
            return;
        }
        combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
    }

    private static async Task CombatTick()
    {
        var updates = new List<(string Code, CombatView? View)>();
        var changed = new List<string>();
        lock (RoomsLock)
        {
            var now = DateTime.UtcNow;
            foreach (var (code, room) in Rooms)
            {
                var combat = room.Combat;
                if (combat is null || combat.Paused || combat.Phase != "turns" || now < combat.StepEndsUtc)
                {
                    continue;
                }
                var current = combat.Current;
                if (combat.Step == "reflex" && current is not null && combat.TargetId is not null)
                {
                    // O alvo não reagiu a tempo: o ataque entra.
                    combat.Step = "damage";
                    combat.StepEndsUtc = now + TurnTime;
                    combat.LastEvent = new CombatEvent("hitTimeout", current.Id, combat.TargetId, null);
                }
                else
                {
                    combat.LastEvent = new CombatEvent("timeout", current?.Id, null, null);
                    Advance(combat, room);
                }
                updates.Add((code, ViewOf(room)));
            }
        }
        if (sharedHub is null)
        {
            return;
        }
        foreach (var (code, view) in updates)
        {
            await sharedHub.Clients.Group(code).SendAsync("CombatUpdated", view);
        }
    }

    private static bool Controls(PlayerState actor, Fighter fighter) =>
        fighter.IsBoss ? actor.IsMaster : fighter.PlayerId == actor.Id;

    private static Fighter RequireTurn(CombatState combat, PlayerState actor, string step)
    {
        if (combat.Phase != "turns")
        {
            throw new HubException("WRONG_STEP");
        }
        var current = combat.Current ?? throw new HubException("NOT_YOUR_TURN");
        if (!Controls(actor, current))
        {
            throw new HubException("NOT_YOUR_TURN");
        }
        if (combat.Step != step)
        {
            throw new HubException("WRONG_STEP");
        }
        return current;
    }

    private static Fighter FindFighter(CombatState? combat, string? fighterId) =>
        combat?.Fighters.FirstOrDefault(fighter => fighter.Id == fighterId) ?? throw new HubException("TARGET_UNAVAILABLE");

    private static string? TryAccount(RoomState room, Fighter fighter) =>
        fighter.PlayerId is not null && room.Players.TryGetValue(fighter.PlayerId, out var player) ? player.AccountId : null;

    private static int HpOf(RoomState room, Fighter fighter) =>
        fighter.IsBoss ? fighter.Hp : TryAccount(room, fighter) is { } accountId ? AccountStore.Instance.Status(accountId)?.Hp ?? 0 : 0;

    private static bool IsDown(RoomState room, Fighter fighter) =>
        !fighter.IsBoss && TryAccount(room, fighter) is { } accountId
        && AccountStore.Instance.Status(accountId) is { HpMax: > 0 } status && status.Hp <= 0;

    private static void SetHp(RoomState room, Fighter fighter, Func<int, int, int> change)
    {
        if (fighter.IsBoss)
        {
            fighter.Hp = Math.Clamp(change(fighter.Hp, fighter.HpMax), Sheet.MinHp, fighter.HpMax);
        }
        else if (TryAccount(room, fighter) is { } accountId)
        {
            AccountStore.Instance.ChangeStatus(accountId, null, "hp", change);
        }
    }

    private static int ResistanceOf(RoomState room, Fighter fighter, string type)
    {
        var resist = fighter.IsBoss ? fighter.Resist
            : TryAccount(room, fighter) is { } accountId ? AccountStore.Instance.ReadActive(accountId, sheet => sheet.Resist) : null;
        return type switch
        {
            "magic" => resist?.Magic ?? 0,
            "pierce" => resist?.Pierce ?? 0,
            _ => resist?.Physical ?? 0,
        };
    }

    // ---------- envio ----------

    private static CombatView? ViewOf(RoomState room)
    {
        var combat = room.Combat;
        if (combat is null)
        {
            return null;
        }
        var fighters = combat.Fighters.Select(fighter =>
        {
            PlayerState? player = null;
            if (fighter.PlayerId is not null)
            {
                room.Players.TryGetValue(fighter.PlayerId, out player);
            }
            var status = player?.AccountId is { } accountId ? AccountStore.Instance.Status(accountId) : null;
            var hp = fighter.IsBoss ? fighter.Hp : status?.Hp ?? 0;
            var down = IsDown(room, fighter);
            var reflex = fighter.IsBoss ? fighter.ReflexBonus
                : player?.AccountId is { } id ? AccountStore.Instance.ReadActive(id, sheet => sheet.SkillTest("reflexos")) : 0;
            var medicine = !fighter.IsBoss && player?.AccountId is { } medicId ? AccountStore.Instance.ReadActive(medicId, sheet => sheet.SkillTest("medicina")) : 0;
            return new FighterView(
                fighter.Id,
                fighter.PlayerId,
                fighter.IsBoss ? fighter.Name : player is null ? "?" : string.IsNullOrEmpty(player.CharacterName) ? player.Name : player.CharacterName,
                fighter.IsBoss,
                fighter.Initiative,
                hp,
                fighter.IsBoss ? fighter.HpMax : status?.HpMax ?? 0,
                down,
                fighter.IsBoss && fighter.Hp <= 0,
                fighter.Chances,
                fighter.LastChance,
                fighter.Dead,
                down ? RescueDt(hp) : null,
                fighter.PotionUsed,
                reflex,
                medicine);
        }).ToArray();
        return new CombatView(
            combat.Phase,
            combat.Paused,
            combat.Round,
            combat.Phase == "turns" ? combat.Current?.Id : null,
            combat.Step,
            combat.TargetId,
            combat.AttackTotal,
            combat.Phase == "turns"
                ? new DateTimeOffset(combat.Paused ? DateTime.UtcNow + (combat.PausedRemaining ?? TimeSpan.Zero) : combat.StepEndsUtc).ToUnixTimeMilliseconds()
                : 0,
            fighters,
            combat.LastEvent);
    }

    private async Task MasterCombat(Action<RoomState, CombatState?> change)
    {
        var (code, playerId) = CurrentSeat();
        CombatView? view;
        lock (RoomsLock)
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
            change(room, room.Combat);
            room.LastActivityUtc = DateTime.UtcNow;
            view = ViewOf(room);
        }
        await Clients.Group(code).SendAsync("CombatUpdated", view);
    }

    private async Task TurnAction(Action<RoomState, CombatState, Fighter, PlayerState> change, bool allowMaster = false)
    {
        var (code, playerId) = CurrentSeat();
        CombatView? view;
        lock (RoomsLock)
        {
            if (!Rooms.TryGetValue(code, out var room) || !room.Players.TryGetValue(playerId, out var actor)
                || actor.ConnectionId != Context.ConnectionId)
            {
                throw new HubException("NOT_IN_ROOM");
            }
            var combat = room.Combat;
            if (combat is null || combat.Phase != "turns" || combat.Paused)
            {
                throw new HubException("NO_COMBAT");
            }
            var current = combat.Current ?? throw new HubException("NOT_YOUR_TURN");
            if (!Controls(actor, current) && !(allowMaster && actor.IsMaster))
            {
                throw new HubException("NOT_YOUR_TURN");
            }
            change(room, combat, current, actor);
            view = ViewOf(room);
        }
        await Clients.Group(code).SendAsync("CombatUpdated", view);
    }

    private sealed class CombatState
    {
        public string Phase { get; set; } = "initiative";
        public bool Paused { get; set; }
        public TimeSpan? PausedRemaining { get; set; }
        public int Round { get; set; }
        public int TurnIndex { get; set; }
        public List<Fighter> Fighters { get; set; } = new();
        public string Step { get; set; } = "act";
        public string? TargetId { get; set; }
        public int AttackTotal { get; set; }
        public DateTime StepEndsUtc { get; set; }
        public CombatEvent? LastEvent { get; set; }
        public Fighter? Current => TurnIndex >= 0 && TurnIndex < Fighters.Count ? Fighters[TurnIndex] : null;
    }

    private sealed class Fighter
    {
        public string Id { get; init; } = string.Empty;
        public string? PlayerId { get; init; }
        public string Name { get; init; } = string.Empty;
        public bool IsBoss { get; init; }
        public int? Initiative { get; set; }
        public int Hp { get; set; }
        public int HpMax { get; init; }
        public int ReflexBonus { get; init; }
        public Resistances Resist { get; init; } = new();
        public bool PotionUsed { get; set; }
        public int Chances { get; set; } = 3;
        public bool LastChance { get; set; }
        public bool Dead { get; set; }
        // Caído: perde uma chance na vez dele se ninguém tentou salvar desde a vez anterior.
        public bool Helped { get; set; }
        public bool PenaltyArmed { get; set; }
    }
}

public sealed record BossRequest(string Name, int Hp, int ReflexBonus, int ResistPhysical, int ResistMagic, int ResistPierce);

// O que aconteceu por último (para o site mostrar uma frase curta).
// Type: start, initiative, attack, hit, hitTimeout, miss, damage, passed, timeout,
// rescued, rescuedCritical, rescueFailed, rescueFumble, bleeding, died, mercy, revived, paused, resumed.
public sealed record CombatEvent(string Type, string? ActorId, string? TargetId, int? Value);

public sealed record FighterView(string Id, string? PlayerId, string Name, bool IsBoss, int? Initiative, int Hp, int HpMax,
    bool Down, bool Defeated, int Chances, bool LastChance, bool Dead, int? Dt, bool PotionUsed, int Reflex, int Medicine);

// Deadline: quando acaba o tempo do passo atual (ms desde 1970).
public sealed record CombatView(string Phase, bool Paused, int Round, string? CurrentId, string Step, string? TargetId, int AttackTotal,
    long Deadline, IReadOnlyList<FighterView> Fighters, CombatEvent? LastEvent);
