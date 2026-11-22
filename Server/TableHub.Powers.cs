using Microsoft.AspNetCore.SignalR;

namespace RolagemRpg;

// Habilidades da ficha (ataques, magias e curas). O servidor confere tudo: a habilidade
// tem que estar na ficha ativa de quem usa, ter EA suficiente e, em combate, estar
// dentro dos usos por turno e fora da recarga. A EA sai na hora de usar.
public sealed partial class TableHub
{
    private static int? NaturalD20(RollPayload roll) =>
        roll.Dice?.FirstOrDefault(die => die.Sides == 20 && die.Used) is { } die ? (int)die.Natural : null;

    private static Power FindPower(PlayerState actor, string powerId) =>
        actor.AccountId is { } accountId
            ? AccountStore.Instance.ReadActive(accountId, sheet => sheet.Powers.FirstOrDefault(power => power.Id == powerId))
              ?? throw new HubException("NO_ABILITY")
            : throw new HubException("NO_SHEET");

    // Começo do turno de alguém: zera os usos e conta um turno de recarga.
    private static void StartPowerTurn(Fighter fighter)
    {
        fighter.PowerUses.Clear();
        foreach (var id in fighter.PowerCooldowns.Keys.ToArray())
        {
            if (--fighter.PowerCooldowns[id] <= 0)
            {
                fighter.PowerCooldowns.Remove(id);
            }
        }
    }

    // Confere e gasta: EA, usos neste turno e recarga. Devolve a habilidade.
    private static Power UsePower(RoomState room, CombatState? combat, Fighter? fighter, PlayerState actor, string powerId, List<string> changedAccounts)
    {
        var power = FindPower(actor, powerId);
        if (fighter is not null)
        {
            if (fighter.PowerCooldowns.TryGetValue(power.Id, out var left) && left > 0)
            {
                throw new HubException("ABILITY_COOLDOWN");
            }
            if (power.UsesPerTurn > 0 && fighter.PowerUses.GetValueOrDefault(power.Id) >= power.UsesPerTurn)
            {
                throw new HubException("ABILITY_USED");
            }
        }
        if (power.EaCost > 0)
        {
            var status = AccountStore.Instance.Status(actor.AccountId!) ?? throw new HubException("NO_SHEET");
            if (power.EaCost > status.Ea)
            {
                throw new HubException("NOT_ENOUGH_MANA");
            }
            AccountStore.Instance.ChangeStatus(actor.AccountId!, null, "ea", (current, _) => current - power.EaCost);
            changedAccounts.Add(actor.AccountId!);
        }
        if (fighter is not null)
        {
            fighter.PowerUses[power.Id] = fighter.PowerUses.GetValueOrDefault(power.Id) + 1;
            if (power.Cooldown > 0)
            {
                // +1 porque o próximo começo de turno já desconta um.
                fighter.PowerCooldowns[power.Id] = power.Cooldown + 1;
            }
        }
        return power;
    }

    // Rolagem de habilidade fora do ataque: curas (em combate, gastam a vez) e qualquer
    // habilidade fora de combate (só gasta a EA). Devolve quanto curou (ou null).
    private static (int? Applied, string? EffectTargetId, string Label, string? RecoverStat) ApplyPowerRoll(
        RoomState room, PlayerState actor, RollPayload roll, List<string> changedAccounts)
    {
        if (roll.AbilityId is null)
        {
            throw new HubException("INVALID_ROLL");
        }
        var combat = room.Combat;
        var inTurns = combat is { Phase: "turns", Paused: false } && combat.Fighters.Any(candidate => candidate.PlayerId == actor.Id);
        Fighter? fighter = null;
        var preview = FindPower(actor, roll.AbilityId);
        if (inTurns)
        {
            if (preview.IsAttack)
            {
                // Ataques em combate passam pelo teste contra o alvo (rolagem de ataque).
                throw new HubException("ABILITY_NEEDS_TARGET");
            }
            fighter = RequireTurn(combat!, actor, "act");
        }
        var power = UsePower(room, combat, fighter, actor, roll.AbilityId, changedAccounts);
        if (power.IsAttack)
        {
            return (null, null, power.Name, null);
        }

        // Cura: você, um aliado ou todos os jogadores (área). Nunca um chefe.
        var amount = (int)Math.Max(0, Math.Min(Sheet.MaxStatus, Math.Floor(roll.Total)));
        var targets = power.Area == "area"
            ? room.Players.Values.Where(player => !player.IsSpectator && !player.IsMaster && player.AccountId is not null && AccountStore.Instance.Status(player.AccountId) is not null).ToList()
            : new List<PlayerState>
            {
                roll.EffectTargetId is null ? actor
                    : room.Players.TryGetValue(roll.EffectTargetId, out var found) && !found.IsSpectator ? found
                    : throw new HubException("TARGET_UNAVAILABLE"),
            };
        var total = 0;
        foreach (var player in targets)
        {
            if (player.AccountId is null || AccountStore.Instance.Status(player.AccountId) is null)
            {
                if (power.Area == "area")
                {
                    continue;
                }
                throw new HubException("NO_SHEET");
            }
            int before = 0, after = 0;
            AccountStore.Instance.ChangeStatus(player.AccountId, null, power.RecoverStat, (current, max) =>
            {
                before = current;
                // Caído: a cura sobe a vida só até 0 (diminui a DT, mas não levanta).
                var ceiling = power.RecoverStat == "hp" && current <= 0 ? 0 : max;
                after = Math.Max(current, Math.Min(ceiling, current + amount));
                return after;
            });
            total += after - before;
            changedAccounts.Add(player.AccountId);
        }
        if (fighter is not null)
        {
            combat!.LastEvent = new CombatEvent("power", fighter.Id, null, total) { AbilityName = power.Name };
            Advance(combat, room);
        }
        return (total, power.Area == "area" ? null : targets[0].Id, power.Name, power.RecoverStat);
    }
}
