namespace RolagemRpg;

// Sistemas de ficha. Abismo é o sistema do grupo; Ordem Paranormal, D&D 5e e Tormenta20
// são modelos com os atributos, perícias e recursos de cada um; "Personalizado" é um modelo
// montado pelo mestre (atributos, perícias e barras escolhidos por ele). A ficha guarda só
// os números; nomes e textos ficam no site. Cada sistema tem a própria conta do teste.
public sealed record SystemDef(string Id, string[] Attributes, (string Id, string Attribute)[] Skills, string[] Stats,
    string ReflexSkill, string MedicineSkill, int AttributeDefault);

public static class SheetSystems
{
    public static readonly string[] StatIds = { "hp", "ea", "san", "vig" };

    public static readonly SystemDef Abismo = new("abismo",
        new[] { "agl", "for", "int", "pre", "con" },
        Sheet.SkillList,
        new[] { "hp", "ea", "san" }, "reflexos", "medicina", 0);

    public static readonly SystemDef Ordem = new("ordem",
        new[] { "agi", "for", "int", "pre", "vig" },
        new[]
        {
            ("acrobacia", "agi"), ("adestramento", "pre"), ("artes", "pre"), ("atletismo", "for"), ("atualidades", "int"),
            ("ciencias", "int"), ("crime", "agi"), ("diplomacia", "pre"), ("enganacao", "pre"), ("fortitude", "vig"),
            ("furtividade", "agi"), ("iniciativa", "agi"), ("intimidacao", "pre"), ("intuicao", "pre"), ("investigacao", "int"),
            ("luta", "for"), ("medicina", "int"), ("ocultismo", "int"), ("percepcao", "pre"), ("pilotagem", "agi"),
            ("pontaria", "agi"), ("profissao", "int"), ("reflexos", "agi"), ("religiao", "pre"), ("sobrevivencia", "int"),
            ("tatica", "int"), ("tecnologia", "int"), ("vontade", "pre"),
        },
        new[] { "hp", "ea", "san" }, "reflexos", "medicina", 1);

    public static readonly SystemDef Dnd = new("dnd",
        new[] { "str", "dex", "con", "int", "wis", "cha" },
        new[]
        {
            ("acrobatics", "dex"), ("animalHandling", "wis"), ("arcana", "int"), ("athletics", "str"), ("deception", "cha"),
            ("history", "int"), ("insight", "wis"), ("intimidation", "cha"), ("investigation", "int"), ("medicine", "wis"),
            ("nature", "int"), ("perception", "wis"), ("performance", "cha"), ("persuasion", "cha"), ("religion", "int"),
            ("sleightOfHand", "dex"), ("stealth", "dex"), ("survival", "wis"),
        },
        new[] { "hp" }, "", "medicine", 10);

    public static readonly SystemDef Tormenta = new("tormenta",
        new[] { "for", "des", "con", "int", "sab", "car" },
        new[]
        {
            ("acrobacia", "des"), ("adestramento", "car"), ("atletismo", "for"), ("atuacao", "car"), ("cavalgar", "des"),
            ("conhecimento", "int"), ("cura", "sab"), ("diplomacia", "car"), ("enganacao", "car"), ("fortitude", "con"),
            ("furtividade", "des"), ("guerra", "int"), ("iniciativa", "des"), ("intimidacao", "car"), ("intuicao", "sab"),
            ("investigacao", "int"), ("jogatina", "car"), ("ladinagem", "des"), ("luta", "for"), ("misticismo", "int"),
            ("nobreza", "int"), ("oficio", "int"), ("percepcao", "sab"), ("pilotagem", "des"), ("pontaria", "des"),
            ("reflexos", "des"), ("religiao", "sab"), ("sobrevivencia", "sab"), ("vontade", "sab"),
        },
        new[] { "hp", "ea" }, "reflexos", "cura", 0);

    public static readonly string[] BuiltIn = { "abismo", "ordem", "dnd", "tormenta" };

    public static SystemDef? Find(string? id) => id switch
    {
        "abismo" => Abismo,
        "ordem" => Ordem,
        "dnd" => Dnd,
        "tormenta" => Tormenta,
        _ => null,
    };
}

// Sistema personalizado montado pelo mestre (fica na conta dele e vai junto na ficha).
public sealed class CustomSystem
{
    public const int MaxSystems = 20;

    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public List<NamedItem> Attributes { get; set; } = new();
    public List<CustomSkill> Skills { get; set; } = new();
    // Barras usadas (vida, mana, sanidade, vigor) e o nome de cada uma.
    public List<string> Stats { get; set; } = new() { "hp", "ea", "san", "vig" };
    public Dictionary<string, string> StatNames { get; set; } = new();

    public CustomSystem Normalized()
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var attributes = (Attributes ?? new()).Where(item => item is not null).Take(12)
            .Select(item => new NamedItem { Id = CleanId(item.Id), Name = Sheet.Clean(item.Name, 20) })
            .Where(item => item.Name.Length > 0 && item.Id.Length > 0 && ids.Add(item.Id)).ToList();
        var skillIds = new HashSet<string>(StringComparer.Ordinal);
        var skills = (Skills ?? new()).Where(skill => skill is not null).Take(60)
            .Select(skill => new CustomSkill
            {
                Id = CleanId(skill.Id),
                Name = Sheet.Clean(skill.Name, 30),
                Attribute = attributes.Any(attribute => attribute.Id == skill.Attribute) ? skill.Attribute : attributes.FirstOrDefault()?.Id ?? string.Empty,
            })
            .Where(skill => skill.Name.Length > 0 && skill.Id.Length > 0 && skillIds.Add(skill.Id)).ToList();
        var stats = (Stats ?? new()).Where(stat => SheetSystems.StatIds.Contains(stat)).Distinct().ToList();
        return new CustomSystem
        {
            Id = CleanId(Id) is { Length: > 0 } id ? id : Guid.NewGuid().ToString("N"),
            Name = Sheet.Clean(Name, 30) is { Length: > 0 } name ? name : "Personalizado",
            Attributes = attributes,
            Skills = skills,
            Stats = stats.Count > 0 ? stats : new List<string> { "hp" },
            StatNames = (StatNames ?? new()).Where(pair => SheetSystems.StatIds.Contains(pair.Key))
                .ToDictionary(pair => pair.Key, pair => Sheet.Clean(pair.Value, 20)),
        };
    }

    public SystemDef ToDef() => new("custom",
        Attributes.Select(attribute => attribute.Id).ToArray(),
        Skills.Select(skill => (skill.Id, skill.Attribute)).ToArray(),
        Stats.ToArray(),
        Skills.FirstOrDefault(skill => skill.Id == "reflexos")?.Id ?? string.Empty,
        Skills.FirstOrDefault(skill => skill.Id == "medicina")?.Id ?? string.Empty,
        0);

    public static List<CustomSystem> NormalizeList(List<CustomSystem>? systems) =>
        (systems ?? new()).Where(system => system is not null).Take(MaxSystems).Select(system => system.Normalized())
            .GroupBy(system => system.Id).Select(group => group.First()).ToList();

    public static string CleanId(string? text)
    {
        var id = new string((text ?? string.Empty).Where(character => char.IsAsciiLetterOrDigit(character)).ToArray());
        return id.Length > 40 ? id[..40] : id;
    }
}

public sealed class NamedItem
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

public sealed class CustomSkill
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Attribute { get; set; } = string.Empty;
}
