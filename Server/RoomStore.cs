using System.Text.Json;

namespace RolagemRpg;

// Salas salvas: as criadas por um mestre com conta ficam em dados/salas/<código>.json
// (nome, configurações, dono e notas). Fechar o app tira a sala do ar, mas o mestre
// reabre com o mesmo código em "Minhas mesas". O chat e as rolagens não são salvos.
public static class RoomStore
{
    private static readonly object Gate = new();
    private static string Folder => Directory.CreateDirectory(Path.Combine(AppPaths.DataFolder, "salas")).FullName;

    private static string PathFor(string code) => Path.Combine(Folder, code + ".json");

    private static bool ValidCode(string code) => code.Length == 6 && code.All(char.IsLetterOrDigit);

    public static bool Exists(string code)
    {
        lock (Gate)
        {
            return ValidCode(code) && File.Exists(PathFor(code));
        }
    }

    public static SavedRoom? Load(string code)
    {
        lock (Gate)
        {
            return ValidCode(code) ? AccountStore.ReadJson<SavedRoom>(PathFor(code)) : null;
        }
    }

    public static void Save(SavedRoom room)
    {
        if (!ValidCode(room.Code))
        {
            return;
        }
        lock (Gate)
        {
            room.UpdatedUtc = DateTime.UtcNow;
            AccountStore.WriteAtomic(PathFor(room.Code), JsonSerializer.SerializeToUtf8Bytes(room, AccountStore.Json));
        }
    }

    public static void Delete(string code)
    {
        lock (Gate)
        {
            if (ValidCode(code) && File.Exists(PathFor(code)))
            {
                File.Delete(PathFor(code));
            }
        }
    }

    public static IReadOnlyList<SavedRoom> ByOwner(string accountId)
    {
        lock (Gate)
        {
            return Directory.EnumerateFiles(Folder, "*.json")
                .Select(path => AccountStore.ReadJson<SavedRoom>(path))
                .OfType<SavedRoom>()
                .Where(room => room.OwnerAccountId == accountId)
                .OrderByDescending(room => room.UpdatedUtc)
                .Take(50)
                .ToArray();
        }
    }
}

public sealed class SavedRoom
{
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int MaxPlayers { get; set; } = 6;
    public bool IsPublic { get; set; }
    public bool AllowSpectators { get; set; } = true;
    public string OwnerAccountId { get; set; } = string.Empty;
    public List<RoomNote> Notes { get; set; } = new();
    // Notas secretas do mestre (aba Escudo): nunca vão para os jogadores.
    public string MasterNotes { get; set; } = string.Empty;
    public DateTime UpdatedUtc { get; set; }
}

// Chefe pronto da biblioteca do mestre (fica na conta dele: dados/contas/<id>/chefes.json).
public sealed class BossTemplate
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Hp { get; set; } = 100;
    public int ReflexBonus { get; set; }
    public int ResistPhysical { get; set; }
    public int ResistMagic { get; set; }
    public int ResistPierce { get; set; }
    public string Note { get; set; } = string.Empty;

    public static List<BossTemplate> Normalize(List<BossTemplate>? bosses) =>
        (bosses ?? new()).Where(boss => boss is not null).Take(60).Select(boss => new BossTemplate
        {
            Id = boss.Id is { Length: > 0 and <= 40 } id && id.All(char.IsLetterOrDigit) ? id : Guid.NewGuid().ToString("N"),
            Name = Sheet.Clean(boss.Name, 30),
            Hp = Math.Clamp(boss.Hp, 1, Sheet.MaxStatus),
            ReflexBonus = Math.Clamp(boss.ReflexBonus, -99, 99),
            ResistPhysical = Math.Clamp(boss.ResistPhysical, 0, 999),
            ResistMagic = Math.Clamp(boss.ResistMagic, 0, 999),
            ResistPierce = Math.Clamp(boss.ResistPierce, 0, 999),
            Note = Sheet.Clean(boss.Note, 300),
        }).Where(boss => boss.Name.Length > 0).ToList();
}

// Nota da mesa: cartão com título e texto. Quem escreveu edita e apaga; o mestre apaga qualquer uma.
public sealed class RoomNote
{
    public string Id { get; set; } = string.Empty;
    public string AuthorAccountId { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public long UpdatedAt { get; set; }
    // Fixada pelo mestre: fica no topo, na ordem em que foi fixada (0 = não fixada).
    public long PinnedAt { get; set; }
}
