namespace RolagemRpg;

// Fichas do sistema da mesa. Ficam na conta de cada jogador, no computador de quem
// hospeda (dados/contas/<id>/fichas.json). Tudo o que chega do site passa por
// Normalize(): textos cortados, números dentro dos limites, listas com tamanho máximo.
public sealed class SheetDocument
{
    public const int MaxSheets = 20;

    public int Version { get; set; }
    public string? ActiveId { get; set; }
    public List<Sheet> Sheets { get; set; } = new();

    public void Normalize()
    {
        Sheets = (Sheets ?? new()).Where(sheet => sheet is not null).Take(MaxSheets).ToList();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var sheet in Sheets)
        {
            sheet.Normalize();
            if (!seen.Add(sheet.Id))
            {
                sheet.Id = Guid.NewGuid().ToString("N");
                seen.Add(sheet.Id);
            }
        }
        if (ActiveId is null || !seen.Contains(ActiveId))
        {
            ActiveId = Sheets.FirstOrDefault()?.Id;
        }
    }

    public Sheet? Active => Sheets.FirstOrDefault(sheet => sheet.Id == ActiveId);
}

public sealed class Sheet
{
    // Perícia → atributo (igual à ficha do grupo). A ordem é a da ficha.
    public static readonly (string Id, string Attribute)[] SkillList =
    {
        ("acrobacia", "agl"), ("crime", "agl"), ("furtividade", "agl"), ("pilotagem", "agl"),
        ("pontaria", "agl"), ("reflexos", "agl"), ("luta", "agl"),
        ("atletismo", "for"),
        ("atualidades", "int"), ("magia", "int"), ("artes", "int"), ("enganacao", "int"),
        ("ciencias", "int"), ("investigacao", "int"), ("medicina", "int"), ("sobrevivencia", "int"),
        ("ferraria", "int"), ("tecnologia", "int"), ("armeiro", "int"),
        ("arcano", "pre"), ("intimidacao", "pre"), ("religiao", "pre"), ("vontade", "pre"),
        ("intuicao", "pre"), ("percepcao", "pre"), ("diplomacia", "pre"),
        ("fortitude", "con"),
    };
    public static readonly string[] AttributeIds = { "agl", "for", "int", "pre", "con" };
    public static readonly string[] QuickRollKinds = { "test", "attack", "physical", "magic", "pierce", "recovery" };
    public const int MaxStatus = 9999;
    public const int MinHp = -999;

    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Age { get; set; } = string.Empty;
    public int Level { get; set; }
    public string Race { get; set; } = string.Empty;
    public StatBlock Hp { get; set; } = new();
    public StatBlock Ea { get; set; } = new();
    public StatBlock San { get; set; } = new();
    public StatBlock Vig { get; set; } = new();
    // Outros sistemas: classe/origem e defesa (CA, Defesa).
    public string Class { get; set; } = string.Empty;
    public int Defense { get; set; }
    // Sistema personalizado: o modelo vai junto na ficha.
    public CustomSystem? Template { get; set; }
    public Dictionary<string, AttributeValue> Attributes { get; set; } = new();
    public Dictionary<string, SkillValue> Skills { get; set; } = new();
    public Resistances Resist { get; set; } = new();
    public string Elements { get; set; } = string.Empty;
    public string ExtraElements { get; set; } = string.Empty;
    public int AbilityPoints { get; set; }
    public string Initiative { get; set; } = string.Empty;
    // Sistema da ficha e nomes trocados pelo jogador (ex.: "stat.ea" → "Mana").
    // Sem entrada = nome padrão.
    public string System { get; set; } = "abismo";
    public Dictionary<string, string> Labels { get; set; } = new();
    public List<string> Effects { get; set; } = new();
    public List<string> Abilities { get; set; } = new();
    public List<string> Inventory { get; set; } = new();
    public List<QuickRoll> QuickRolls { get; set; } = new();
    // Habilidades prontas (ataques, magias e curas). O servidor confere EA, usos e recarga.
    public List<Power> Powers { get; set; } = new();

    public int AttributeValue(string id) => Attributes.TryGetValue(id, out var value) ? value.Value : 0;

    public SystemDef Def() => System == "custom" ? (Template?.ToDef() ?? new SystemDef("custom", Array.Empty<string>(), Array.Empty<(string, string)>(), new[] { "hp" }, "", "", 0))
        : SheetSystems.Find(System) ?? SheetSystems.Abismo;

    // Teste da perícia, pela conta de cada sistema:
    // Abismo: treinado + outros + metade do atributo (para baixo).
    // Ordem Paranormal: grau de treino (0/5/10/15) + outros (os dados são o atributo em d20).
    // D&D 5e: modificador do atributo + proficiência (×0, ×1 ou ×2) + outros.
    // Tormenta20: metade do nível + atributo + treino (+2/+4/+6) + outros.
    // Personalizado: treinado + outros + atributo.
    public int SkillTest(string skillId)
    {
        var def = Def();
        var attribute = def.Skills.FirstOrDefault(skill => skill.Id == skillId).Attribute;
        if (attribute is null)
        {
            return 0;
        }
        var skill = Skills.TryGetValue(skillId, out var value) ? value : new SkillValue();
        var score = AttributeValue(attribute);
        return def.Id switch
        {
            "ordem" => skill.Trained + skill.Other,
            "dnd" => (int)Math.Floor((score - 10) / 2.0) + skill.Trained * (2 + Math.Max(0, Level - 1) / 4) + skill.Other,
            "tormenta" => Level / 2 + score + (skill.Trained > 0 ? (Level >= 15 ? 6 : Level >= 7 ? 4 : 2) : 0) + skill.Other,
            "custom" => skill.Trained + skill.Other + score,
            _ => skill.Trained + skill.Other + (int)Math.Floor(score / 2.0),
        };
    }

    // Defesa no combate (Reflexos) e socorro (Medicina), conforme o sistema.
    public int ReflexTest() => Def() is { Id: "dnd" } ? (int)Math.Floor((AttributeValue("dex") - 10) / 2.0) : SkillTest(Def().ReflexSkill);

    public int MedicineTest() => SkillTest(Def().MedicineSkill);

    private (int Min, int Max) TrainedRange() => Def().Id switch
    {
        "ordem" => (0, 15),
        "dnd" => (0, 2),
        "tormenta" => (0, 1),
        _ => (-99, 99),
    };

    public void Normalize()
    {
        Id = Clean(Id, 40);
        if (Id.Length == 0 || Id.Any(character => !char.IsLetterOrDigit(character) && character != '-'))
        {
            Id = Guid.NewGuid().ToString("N");
        }
        Name = Clean(Name, 40);
        Age = Clean(Age, 20);
        Level = Clamp(Level, 0, 999);
        Race = Clean(Race, 40);
        Hp = (Hp ?? new()).Normalized(MinHp);
        Ea = (Ea ?? new()).Normalized(0);
        San = (San ?? new()).Normalized(0);
        Vig = (Vig ?? new()).Normalized(0);
        // Sistema: um dos prontos ou "custom" (com o modelo junto). Atributos e perícias
        // seguem a lista do sistema.
        System = System == "custom" && Template is not null ? "custom" : SheetSystems.Find(System)?.Id ?? "abismo";
        Template = System == "custom" ? Template!.Normalized() : null;
        var def = Def();
        var (trainedMin, trainedMax) = TrainedRange();
        Attributes = def.Attributes.ToDictionary(id => id, id =>
        {
            var value = Attributes?.GetValueOrDefault(id) ?? new AttributeValue { Value = def.AttributeDefault };
            return new AttributeValue { Value = Clamp(value.Value, -99, 99), Bonus = Clamp(value.Bonus, -99, 99) };
        });
        Skills = def.Skills.ToDictionary(skill => skill.Id, skill =>
        {
            var value = Skills?.GetValueOrDefault(skill.Id) ?? new SkillValue();
            return new SkillValue { Trained = Clamp(value.Trained, trainedMin, trainedMax), Other = Clamp(value.Other, -99, 99) };
        });
        Class = Clean(Class, 40);
        Defense = Clamp(Defense, -99, 999);
        Resist = new Resistances
        {
            Physical = Clamp(Resist?.Physical ?? 0, 0, 999),
            Magic = Clamp(Resist?.Magic ?? 0, 0, 999),
            Pierce = Clamp(Resist?.Pierce ?? 0, 0, 999),
        };
        Elements = Clean(Elements, 80);
        ExtraElements = Clean(ExtraElements, 80);
        AbilityPoints = Clamp(AbilityPoints, -999, 999);
        Initiative = Clean(Initiative, 30);
        Labels = (Labels ?? new())
            .Where(pair => pair.Key is { Length: > 0 and <= 40 } && pair.Key.All(character => char.IsAsciiLetterOrDigit(character) || character == '.'))
            .Select(pair => (pair.Key, Value: Clean(pair.Value, 30)))
            .Where(pair => pair.Value.Length > 0)
            .Take(80)
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        Effects = CleanList(Effects);
        Abilities = CleanList(Abilities);
        Inventory = CleanList(Inventory);
        QuickRolls = (QuickRolls ?? new()).Where(roll => roll is not null).Take(24).Select(roll => new QuickRoll
        {
            Name = Clean(roll.Name, 30),
            Notation = Clean(roll.Notation, 60),
            Kind = QuickRollKinds.Contains(roll.Kind) ? roll.Kind : "test",
        }).Where(roll => roll.Name.Length > 0 && roll.Notation.Length > 0).ToList();
        var powerIds = new HashSet<string>(StringComparer.Ordinal);
        Powers = (Powers ?? new()).Where(power => power is not null).Take(Power.MaxPowers)
            .Select(power => power.Normalized())
            .Where(power => power.Name.Length > 0 && power.Notation.Length > 0 && powerIds.Add(power.Id))
            .ToList();
    }

    private static List<string> CleanList(List<string>? items) =>
        (items ?? new()).Select(item => Clean(item, 120)).Where(item => item.Length > 0).Take(60).ToList();

    public static string Clean(string? text, int max)
    {
        var cleaned = new string((text ?? string.Empty).Where(character => !char.IsControl(character)).ToArray()).Trim();
        return cleaned.Length > max ? cleaned[..max] : cleaned;
    }

    public static int Clamp(int value, int min, int max) => Math.Min(max, Math.Max(min, value));
}

public sealed class StatBlock
{
    public int Max { get; set; }
    public int Current { get; set; }
    public int Other { get; set; }

    public StatBlock Normalized(int minCurrent)
    {
        var max = Sheet.Clamp(Max, 0, Sheet.MaxStatus);
        return new StatBlock
        {
            Max = max,
            Current = Sheet.Clamp(Current, minCurrent, max),
            Other = Sheet.Clamp(Other, -Sheet.MaxStatus, Sheet.MaxStatus),
        };
    }
}

public sealed class AttributeValue
{
    public int Value { get; set; }
    public int Bonus { get; set; }
}

public sealed class SkillValue
{
    public int Trained { get; set; }
    public int Other { get; set; }
}

public sealed class Resistances
{
    public int Physical { get; set; }
    public int Magic { get; set; }
    public int Pierce { get; set; }
}

public sealed class QuickRoll
{
    public string Name { get; set; } = string.Empty;
    public string Notation { get; set; } = string.Empty;
    public string Kind { get; set; } = "test";
}

// Habilidade criada pelo jogador. Ataques (físico, mágico ou perfuração) rolam o teste
// da perícia escolhida contra o alvo e depois o dano; magia não deixa o alvo se defender.
// Recuperação cura você, um aliado ou todos os jogadores (área), nunca um chefe.
public sealed class Power
{
    public const int MaxPowers = 30;
    public static readonly string[] Kinds = { "physical", "magic", "pierce", "recovery" };
    public static readonly string[] StatusIds =
    {
        "queimando", "chamaInfernal", "sangrando", "hemorragia", "envenenado", "corroido",
        "eletrocutado", "congelamento", "necrose", "sobrecarga", "deterioracao", "ruptura",
    };

    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Kind { get; set; } = "physical";
    // Rolagem do dano (ou da cura), ex.: "2d8+3".
    public string Notation { get; set; } = string.Empty;
    // Perícia do teste de ataque (só ataques).
    public string Skill { get; set; } = "luta";
    public int EaCost { get; set; }
    // 0 = sem limite.
    public int UsesPerTurn { get; set; }
    // Turnos seus de espera depois de usar (0 = sem recarga).
    public int Cooldown { get; set; }
    public string? StatusId { get; set; }
    // Só recuperação: "hp" ou "ea", e "single" (você ou um aliado) ou "area" (todos os jogadores).
    public string RecoverStat { get; set; } = "hp";
    public string Area { get; set; } = "single";
    // Só chefes: quantas vezes no combate inteiro (0 = sem limite).
    public int MaxUses { get; set; }

    public bool IsAttack => Kind != "recovery";

    public Power Normalized()
    {
        var id = Sheet.Clean(Id, 40);
        if (id.Length == 0 || id.Any(character => !char.IsAsciiLetterOrDigit(character)))
        {
            id = Guid.NewGuid().ToString("N");
        }
        var kind = Kinds.Contains(Kind) ? Kind : "physical";
        return new Power
        {
            Id = id,
            Name = Sheet.Clean(Name, 30),
            Kind = kind,
            Notation = Sheet.Clean(Notation, 60),
            Skill = CustomSystem.CleanId(Skill) is { Length: > 0 } skill ? skill : kind switch { "magic" => "magia", "pierce" => "pontaria", _ => "luta" },
            EaCost = Sheet.Clamp(EaCost, 0, Sheet.MaxStatus),
            UsesPerTurn = Sheet.Clamp(UsesPerTurn, 0, 10),
            Cooldown = Sheet.Clamp(Cooldown, 0, 20),
            StatusId = kind != "recovery" && StatusId is not null && StatusIds.Contains(StatusId) ? StatusId : null,
            RecoverStat = RecoverStat == "ea" ? "ea" : "hp",
            Area = Area == "area" ? "area" : "single",
            MaxUses = Sheet.Clamp(MaxUses, 0, 99),
        };
    }
}
