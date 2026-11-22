using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// Chefes completos e o combate automático.
// O chefe pronto (biblioteca do mestre) tem EA, ações por turno, uma arma principal (o
// ataque básico, com dano fixo), perícias com bônus e habilidades com máximo de usos.
// No modo automático o servidor joga por ele, respeitando a vez: escolhe um alvo de pé
// (aleatório ou evitando quem tem menos vida), não usa habilidade sem EA nem em recarga,
// não repete habilidade à toa e, se tirar 20 na defesa, contra-ataca com a arma.
// O mestre liga e desliga o automático e troca o jeito de escolher alvos a qualquer hora.
public sealed partial class TableHub
{
    private static readonly TimeSpan AutoDelay = TimeSpan.FromMilliseconds(1500);
    private static readonly string[] TargetModes = { "random", "avoidWeak" };
    private static readonly Regex DiceTerm = new(@"([+-]?)\s*(?:(\d*)d(\d+)|(\d+))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    // Chance de o chefe usar uma habilidade de ataque em vez da arma (para não repetir sempre).
    private const int AbilityChancePercent = 35;

    // ---------- ataque, defesa e dano (jogadores e chefes) ----------

    private static void StartAttack(RoomState room, CombatState combat, Fighter current, Fighter target, string type, string? statusId,
        Power? power, bool weapon, int total, int? natural)
    {
        combat.AbilityName = null;
        combat.AbilityNotation = null;
        combat.FixedDamage = null;
        if (power is not null)
        {
            type = power.Kind;
            statusId = power.StatusId;
            combat.AbilityName = power.Name;
            combat.AbilityNotation = power.Notation;
        }
        else if (weapon)
        {
            type = current.WeaponType;
            combat.AbilityName = current.WeaponName.Length > 0 ? current.WeaponName : null;
            combat.FixedDamage = current.WeaponDamage;
        }
        combat.TargetId = target.Id;
        combat.AttackType = type;
        combat.PendingStatusId = statusId;
        combat.Critical = natural == 20;
        combat.AttackTotal = total;
        combat.AutoNextUtc = DateTime.UtcNow + AutoDelay;
        if (type == "magic")
        {
            // Magia: o alvo não rola contra. Vai direto para o dano.
            current.Stats.Hits++;
            combat.LastEvent = new CombatEvent("magicHit", current.Id, target.Id, total) { Critical = combat.Critical, AbilityName = combat.AbilityName };
            if (combat.FixedDamage is { } fixedDamage)
            {
                ApplyAttackDamage(room, combat, target, fixedDamage);
                return;
            }
            combat.Step = "damage";
            combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
            return;
        }
        combat.Step = "reflex";
        combat.StepEndsUtc = DateTime.UtcNow + ReactionTime;
        combat.LastEvent = new CombatEvent("attack", current.Id, target.Id, total) { Critical = combat.Critical, AbilityName = combat.AbilityName };
    }

    // Reflexos do alvo: 20 natural = contra-ataque; 20 no ataque ou total maior = acerto
    // (empate é da defesa).
    private static void ResolveDefense(RoomState room, CombatState combat, Fighter target, int total, int? natural)
    {
        var current = combat.Current!;
        combat.AutoNextUtc = DateTime.UtcNow + AutoDelay;
        if (natural == 20)
        {
            current.Stats.Misses++;
            combat.Critical = false;
            combat.PendingStatusId = null;
            combat.FixedDamage = null;
            combat.Step = "counter";
            combat.CounterId = target.Id;
            combat.StepEndsUtc = DateTime.UtcNow + ReactionTime;
            combat.LastEvent = new CombatEvent("counter", target.Id, current.Id, total);
            return;
        }
        if (combat.Critical || combat.AttackTotal > total)
        {
            current.Stats.Hits++;
            combat.LastEvent = new CombatEvent("hit", current.Id, target.Id, total);
            if (combat.FixedDamage is { } fixedDamage)
            {
                ApplyAttackDamage(room, combat, target, fixedDamage);
                return;
            }
            combat.Step = "damage";
            combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
            return;
        }
        current.Stats.Misses++;
        combat.LastEvent = new CombatEvent("miss", current.Id, target.Id, total);
        EndAction(combat, room);
    }

    // Dano do ataque: crítico (mágico ×1,3, físico e perfuração ×1,8) antes da
    // resistência do mesmo tipo; o status escolhido entra junto.
    private static void ApplyAttackDamage(RoomState room, CombatState combat, Fighter target, int raw)
    {
        var current = combat.Current!;
        var type = combat.AttackType;
        var dealt = combat.Critical ? (int)Math.Floor(raw * (type == "magic" ? 1.3 : 1.8)) : raw;
        var damage = Math.Max(0, dealt - ResistanceOf(room, target, type));
        DamageFighter(room, combat, target, damage, current);
        combat.LastEvent = new CombatEvent("damage", current.Id, target.Id, damage) { Critical = combat.Critical, AbilityName = combat.AbilityName };
        if (combat.PendingStatusId is { } pending && !target.Dead)
        {
            AddStatusStack(room, combat, target, pending, current.Id);
            combat.LastEvent = combat.LastEvent with { StatusId = pending };
        }
        EndAction(combat, room);
    }

    // Contra-ataque garantido (crítico na defesa): sem defesa do atacante.
    private static void ApplyCounter(RoomState room, CombatState combat, Fighter counter, string type, int raw)
    {
        var current = combat.Current!;
        var damage = Math.Max(0, raw - ResistanceOf(room, current, type));
        DamageFighter(room, combat, current, damage, counter);
        combat.LastEvent = new CombatEvent("counterDamage", counter.Id, current.Id, damage);
        EndAction(combat, room);
    }

    // Fim de uma ação: se quem está na vez ainda tem ações (chefes com mais de uma),
    // continua com ele; senão passa a vez.
    private static void EndAction(CombatState combat, RoomState room)
    {
        var current = combat.Current;
        if (combat.Phase == "turns" && current is not null && current.ActionsLeft > 1 && !current.Dead && HpOf(room, current) > 0)
        {
            current.ActionsLeft--;
            combat.Step = "act";
            combat.TargetId = null;
            combat.AttackTotal = 0;
            combat.AttackType = "physical";
            combat.Critical = false;
            combat.PendingStatusId = null;
            combat.AbilityName = null;
            combat.AbilityNotation = null;
            combat.CounterId = null;
            combat.FixedDamage = null;
            combat.StatusApplied = false;
            combat.StepEndsUtc = DateTime.UtcNow + TurnTime;
            combat.AutoNextUtc = DateTime.UtcNow + AutoDelay;
            return;
        }
        Advance(combat, room);
    }

    // ---------- chefe a partir do modelo ----------

    private static Fighter FighterFromTemplate(BossTemplate template)
    {
        var fighter = new Fighter
        {
            Id = Guid.NewGuid().ToString("N")[..12],
            IsBoss = true,
            TemplateId = template.Id,
            Hp = template.Hp,
            Ea = template.Ea,
        };
        ApplyTemplate(fighter, template);
        fighter.ActionsLeft = fighter.Actions;
        return fighter;
    }

    // Edição ao vivo: troca tudo menos a vida e a EA atuais (e o que já foi usado).
    private static void ApplyTemplate(Fighter fighter, BossTemplate template)
    {
        fighter.Name = template.Name;
        fighter.HpMax = template.Hp;
        fighter.EaMax = template.Ea;
        fighter.ReflexBonus = template.ReflexBonus;
        fighter.Resist = new Resistances { Physical = template.ResistPhysical, Magic = template.ResistMagic, Pierce = template.ResistPierce };
        fighter.Actions = Math.Max(1, template.Actions);
        fighter.ActionsLeft = Math.Min(fighter.ActionsLeft, fighter.Actions);
        fighter.WeaponName = template.WeaponName;
        fighter.WeaponDamage = template.WeaponDamage;
        fighter.WeaponType = template.WeaponType;
        fighter.Skills = new Dictionary<string, int>(template.Skills, StringComparer.Ordinal);
        fighter.Powers = template.Powers.Select(power => power.Normalized()).ToList();
    }

    private static BossTemplate? MasterTemplate(RoomState room, string templateId) =>
        room.Players.Values.FirstOrDefault(player => player.IsMaster)?.AccountId is { } accountId
            ? AccountStore.Instance.Bosses(accountId).FirstOrDefault(boss => boss.Id == templateId)
            : null;

    // ---------- comandos do mestre ----------

    // O mestre salvou o chefe no Escudo: os chefes desse modelo na mesa mudam na hora.
    public Task RefreshBoss(string templateId) => MasterCombat((room, combat) =>
    {
        if (combat is null || string.IsNullOrEmpty(templateId))
        {
            return;
        }
        var template = MasterTemplate(room, templateId) ?? throw new HubException("INVALID_REQUEST");
        foreach (var fighter in combat.Fighters.Where(fighter => fighter.TemplateId == templateId))
        {
            ApplyTemplate(fighter, template);
        }
    });

    public Task SetBossAuto(string fighterId, bool auto) => MasterCombat((_, combat) =>
    {
        var fighter = FindFighter(combat, fighterId);
        if (!fighter.IsBoss)
        {
            throw new HubException("INVALID_REQUEST");
        }
        fighter.Auto = auto;
        combat!.AutoNextUtc = DateTime.UtcNow + AutoDelay;
    });

    public Task SetBossTargeting(string fighterId, string mode) => MasterCombat((_, combat) =>
    {
        var fighter = FindFighter(combat, fighterId);
        if (!fighter.IsBoss || !TargetModes.Contains(mode))
        {
            throw new HubException("INVALID_REQUEST");
        }
        fighter.Targeting = mode;
    });

    // Cura do chefe controlado pelo mestre (o servidor rola).
    public Task BossRecover(string powerId) => TurnAction((room, combat, current, actor) =>
    {
        if (!current.IsBoss || combat.Step != "act")
        {
            throw new HubException("WRONG_STEP");
        }
        var power = current.Powers.FirstOrDefault(candidate => candidate.Id == powerId) ?? throw new HubException("NO_ABILITY");
        if (power.IsAttack)
        {
            throw new HubException("INVALID_REQUEST");
        }
        BossHeal(room, combat, current, power);
    });

    private static void BossHeal(RoomState room, CombatState combat, Fighter boss, Power power)
    {
        UsePower(room, combat, boss, null, power.Id, new List<string>());
        var amount = RollNotation(power.Notation);
        int before;
        if (power.RecoverStat == "ea")
        {
            before = boss.Ea;
            boss.Ea = Math.Min(boss.EaMax, boss.Ea + amount);
            amount = boss.Ea - before;
        }
        else
        {
            before = boss.Hp;
            boss.Hp = Math.Min(boss.HpMax, boss.Hp + amount);
            amount = boss.Hp - before;
        }
        combat.LastEvent = new CombatEvent("power", boss.Id, null, amount) { AbilityName = power.Name };
        EndAction(combat, room);
    }

    // ---------- combate automático ----------

    private static bool CanUse(Fighter boss, Power power) =>
        power.EaCost <= boss.Ea
        && !(boss.PowerCooldowns.TryGetValue(power.Id, out var left) && left > 0)
        && !(power.UsesPerTurn > 0 && boss.PowerUses.GetValueOrDefault(power.Id) >= power.UsesPerTurn)
        && !(power.MaxUses > 0 && boss.PowerTotalUses.GetValueOrDefault(power.Id) >= power.MaxUses);

    // Um passo do automático (chamado pelo relógio do combate). true = algo mudou.
    private static bool AutoStep(RoomState room, CombatState combat, DateTime now)
    {
        if (combat.Paused)
        {
            return false;
        }
        if (combat.Phase == "initiative")
        {
            var rolled = false;
            foreach (var boss in combat.Fighters.Where(fighter => fighter.IsBoss && fighter.Auto && fighter.Initiative is null))
            {
                boss.Initiative = Roll(1, 20);
                combat.LastEvent = new CombatEvent("initiative", boss.Id, null, boss.Initiative);
                rolled = true;
            }
            return rolled;
        }
        if (combat.Phase != "turns" || now < combat.AutoNextUtc || combat.Current is not { } current)
        {
            return false;
        }
        // Defesa de um chefe automático.
        if (combat.Step == "reflex" && combat.TargetId is not null && FindFighter(combat, combat.TargetId) is { IsBoss: true, Auto: true } defender)
        {
            var natural = Roll(1, 20);
            CountBossNatural(defender, natural);
            ResolveDefense(room, combat, defender, natural + defender.ReflexBonus, natural);
            return true;
        }
        // 20 na defesa do chefe automático: contra-ataca quem atacou, com a arma.
        if (combat.Step == "counter" && combat.CounterId is not null && FindFighter(combat, combat.CounterId) is { IsBoss: true, Auto: true } counter)
        {
            ApplyCounter(room, combat, counter, counter.WeaponType, counter.WeaponDamage);
            return true;
        }
        if (!current.IsBoss || !current.Auto)
        {
            return false;
        }
        if (combat.Step == "act")
        {
            BossAct(room, combat, current);
            return true;
        }
        if (combat.Step == "damage" && combat.TargetId is not null)
        {
            ApplyAttackDamage(room, combat, FindFighter(combat, combat.TargetId), combat.FixedDamage ?? RollNotation(combat.AbilityNotation));
            return true;
        }
        return false;
    }

    private static void BossAct(RoomState room, CombatState combat, Fighter boss)
    {
        // Só jogadores de pé: nunca ataca quem está caído ou morto.
        var targets = combat.Fighters.Where(fighter => !fighter.IsBoss && !fighter.Dead && !IsDown(room, fighter) && HpOf(room, fighter) > 0).ToList();
        if (targets.Count == 0)
        {
            combat.LastEvent = new CombatEvent("passed", boss.Id, null, null);
            Advance(combat, room);
            return;
        }
        var usable = boss.Powers.Where(power => CanUse(boss, power)).ToList();
        // Machucado: se tem cura disponível, se cura antes de atacar.
        var heal = usable.FirstOrDefault(power => !power.IsAttack
            && (power.RecoverStat == "ea" ? boss.Ea * 2 < boss.EaMax : boss.Hp * 2 < boss.HpMax));
        if (heal is not null)
        {
            BossHeal(room, combat, boss, heal);
            return;
        }
        var attacks = usable.Where(power => power.IsAttack).ToList();
        var useAbility = attacks.Count > 0 && (boss.WeaponDamage <= 0 || RandomNumberGenerator.GetInt32(100) < AbilityChancePercent);
        var power = useAbility ? attacks[RandomNumberGenerator.GetInt32(attacks.Count)] : null;
        var target = PickTarget(room, boss, targets);
        combat.TargetId = target.Id;
        if (power is not null)
        {
            UsePower(room, combat, boss, null, power.Id, new List<string>());
        }
        var type = power?.Kind ?? boss.WeaponType;
        var skill = power?.Skill ?? (type switch { "magic" => "magia", "pierce" => "pontaria", _ => "luta" });
        var natural = Roll(1, 20);
        CountBossNatural(boss, natural);
        StartAttack(room, combat, boss, target, type, power?.StatusId, power, power is null, natural + boss.Skills.GetValueOrDefault(skill), natural);
    }

    // Aleatório, ou "evitar quem tem menos vida": sorteio com peso pela vida atual.
    private static Fighter PickTarget(RoomState room, Fighter boss, List<Fighter> targets)
    {
        if (boss.Targeting != "avoidWeak" || targets.Count == 1)
        {
            return targets[RandomNumberGenerator.GetInt32(targets.Count)];
        }
        var weights = targets.Select(target => Math.Max(1, HpOf(room, target))).ToArray();
        var pick = RandomNumberGenerator.GetInt32(weights.Sum());
        for (var index = 0; index < targets.Count; index++)
        {
            pick -= weights[index];
            if (pick < 0)
            {
                return targets[index];
            }
        }
        return targets[^1];
    }

    private static void CountBossNatural(Fighter fighter, int natural)
    {
        if (natural == 20)
        {
            fighter.Stats.Crits++;
        }
        else if (natural == 1)
        {
            fighter.Stats.Fumbles++;
        }
    }

    private static BossView BossDetails(Fighter boss) => new(
        boss.Ea, boss.EaMax, boss.Actions, boss.ActionsLeft, boss.WeaponName, boss.WeaponDamage, boss.WeaponType,
        new Dictionary<string, int>(boss.Skills),
        boss.Powers.Select(power => new BossPowerView(power.Id, power.Name, power.Kind, power.Notation, power.Skill, power.EaCost, power.UsesPerTurn,
            power.Cooldown, power.MaxUses, power.StatusId, power.RecoverStat, boss.PowerTotalUses.GetValueOrDefault(power.Id),
            boss.PowerUses.GetValueOrDefault(power.Id), boss.PowerCooldowns.GetValueOrDefault(power.Id))).ToArray(),
        boss.Auto, boss.Targeting, boss.TemplateId);

    // Rolagem simples do lado do servidor (ex.: "2d6+3", "1d8-1+2"). Inválida = 0.
    public static int RollNotation(string? notation)
    {
        var text = (notation ?? string.Empty).Replace(" ", string.Empty);
        if (text.Length == 0 || text.Length > 60)
        {
            return 0;
        }
        var total = 0;
        var position = 0;
        foreach (Match match in DiceTerm.Matches(text))
        {
            if (match.Index != position)
            {
                return 0;
            }
            position = match.Index + match.Length;
            var sign = match.Groups[1].Value == "-" ? -1 : 1;
            if (match.Groups[3].Success)
            {
                var count = match.Groups[2].Value.Length == 0 ? 1 : int.Parse(match.Groups[2].Value);
                var sides = int.Parse(match.Groups[3].Value);
                if (count is < 1 or > 100 || sides is < 1 or > 1000)
                {
                    return 0;
                }
                total += sign * Roll(count, sides);
            }
            else if (int.TryParse(match.Groups[4].Value, out var constant) && constant <= 10000)
            {
                total += sign * constant;
            }
        }
        return position == text.Length ? Math.Max(0, total) : 0;
    }
}

public sealed record BossPowerView(string Id, string Name, string Kind, string Notation, string Skill, int EaCost, int UsesPerTurn,
    int Cooldown, int MaxUses, string? StatusId, string RecoverStat, int UsedTotal, int UsedThisTurn, int CooldownLeft);

// Só o mestre recebe: detalhes do chefe (arma, perícias, habilidades, EA, automático).
public sealed record BossView(int Ea, int EaMax, int Actions, int ActionsLeft, string WeaponName, int WeaponDamage, string WeaponType,
    IReadOnlyDictionary<string, int> Skills, IReadOnlyList<BossPowerView> Powers, bool Auto, string Targeting, string? TemplateId);
