using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RolagemRpg;

// Contas dos jogadores, guardadas no computador de quem hospeda (dados/contas/).
//
//   contas.json        usuários (senha só como hash PBKDF2) e sessões (só o hash do token)
//   <id>/fichas.json   as fichas da conta
//   <id>/avatar        a foto do perfil (webp, png ou jpeg, até 200 KB)
//
// A senha nunca é guardada nem registrada. O token de sessão é aleatório (256 bits);
// quem tem o arquivo contas.json não consegue usar os tokens, só os hashes.
public sealed class AccountStore
{
    public const int MinPassword = 8;
    public const int MaxPassword = 128;
    public const int MaxAvatarBytes = 200 * 1024;
    private const int Iterations = 210_000;
    private const int MaxLoginFailures = 10;
    private static readonly TimeSpan LoginWindow = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RememberLifetime = TimeSpan.FromDays(90);
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(12);
    private static readonly Regex UsernamePattern = new(@"^[\p{L}\p{N}._ -]{3,24}$");
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private static readonly Lazy<AccountStore> Shared = new(() => new AccountStore(Path.Combine(AppPaths.DataFolder, "contas")));
    public static AccountStore Instance => Shared.Value;

    private readonly string folder;
    private readonly object gate = new();
    private readonly Dictionary<string, (int Count, DateTime Start)> failures = new(StringComparer.Ordinal);
    private StoreFile data;

    public AccountStore(string folder)
    {
        this.folder = folder;
        Directory.CreateDirectory(folder);
        data = ReadJson<StoreFile>(IndexPath) ?? new StoreFile();
    }

    private string IndexPath => Path.Combine(folder, "contas.json");

    private string AccountFolder(string id) => Directory.CreateDirectory(Path.Combine(folder, id)).FullName;

    // ---------- entrar, criar conta e sair ----------

    public SessionResult Register(string? username, string? password, bool remember, string clientKey)
    {
        var name = (username ?? string.Empty).Trim();
        if (!UsernamePattern.IsMatch(name))
        {
            throw new AccountException("INVALID_USERNAME");
        }
        CheckPassword(password);
        CheckThrottle("ip:" + clientKey);
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Hash(password!, salt);
        lock (gate)
        {
            if (data.Accounts.Any(account => account.Key == Key(name)))
            {
                RecordFailure("ip:" + clientKey);
                throw new AccountException("USERNAME_TAKEN");
            }
            var account = new AccountRecord
            {
                Id = Guid.NewGuid().ToString("N"),
                Username = name,
                Key = Key(name),
                Salt = Convert.ToBase64String(salt),
                Hash = Convert.ToBase64String(hash),
                Iterations = Iterations,
                CreatedUtc = DateTime.UtcNow,
            };
            data.Accounts.Add(account);
            var result = NewSession(account, remember);
            SaveIndex();
            return result;
        }
    }

    public SessionResult Login(string? username, string? password, bool remember, string clientKey)
    {
        var name = (username ?? string.Empty).Trim();
        var userKey = "user:" + Key(name);
        CheckThrottle("ip:" + clientKey);
        CheckThrottle(userKey);
        AccountRecord? account;
        lock (gate)
        {
            account = data.Accounts.FirstOrDefault(candidate => candidate.Key == Key(name));
        }
        // Sem a conta, calcula um hash mesmo assim: o tempo de resposta não revela quem existe.
        var salt = account is null ? new byte[16] : Convert.FromBase64String(account.Salt);
        var expected = account is null ? new byte[32] : Convert.FromBase64String(account.Hash);
        var actual = Hash(password ?? string.Empty, salt, account?.Iterations ?? Iterations);
        if (account is null || password is null || password.Length > MaxPassword
            || !CryptographicOperations.FixedTimeEquals(expected, actual))
        {
            RecordFailure("ip:" + clientKey);
            RecordFailure(userKey);
            throw new AccountException("WRONG_LOGIN");
        }
        lock (gate)
        {
            failures.Remove(userKey);
            var result = NewSession(account, remember);
            SaveIndex();
            return result;
        }
    }

    public void Logout(string? token)
    {
        if (string.IsNullOrEmpty(token))
        {
            return;
        }
        var tokenHash = TokenHash(token);
        lock (gate)
        {
            if (data.Sessions.RemoveAll(session => session.Hash == tokenHash) > 0)
            {
                SaveIndex();
            }
        }
    }

    // Quem é o dono do token (ou null se não vale mais).
    public AccountInfo? Resolve(string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 100)
        {
            return null;
        }
        var tokenHash = TokenHash(token);
        lock (gate)
        {
            var now = DateTime.UtcNow;
            var session = data.Sessions.FirstOrDefault(candidate => candidate.Hash == tokenHash);
            if (session is null || session.ExpiresUtc < now)
            {
                return null;
            }
            var account = data.Accounts.FirstOrDefault(candidate => candidate.Id == session.AccountId);
            return account is null ? null : Info(account);
        }
    }

    public AccountInfo? Find(string accountId)
    {
        lock (gate)
        {
            var account = data.Accounts.FirstOrDefault(candidate => candidate.Id == accountId);
            return account is null ? null : Info(account);
        }
    }

    // ---------- para o app (tela inicial): listar e apagar contas ----------

    public IReadOnlyList<AccountInfo> List()
    {
        lock (gate)
        {
            return data.Accounts.OrderBy(account => account.Username, StringComparer.CurrentCultureIgnoreCase).Select(Info).ToArray();
        }
    }

    public bool Delete(string accountId)
    {
        lock (gate)
        {
            if (data.Accounts.RemoveAll(account => account.Id == accountId) == 0)
            {
                return false;
            }
            data.Sessions.RemoveAll(session => session.AccountId == accountId);
            SaveIndex();
            sheetCache.Remove(accountId);
        }
        try
        {
            var accountFolder = Path.Combine(folder, accountId);
            if (Directory.Exists(accountFolder) && accountId.All(char.IsLetterOrDigit))
            {
                Directory.Delete(accountFolder, recursive: true);
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // A conta já saiu do índice; a pasta pode ser apagada depois.
        }
        return true;
    }

    // ---------- foto do perfil ----------

    public AccountInfo SetAvatar(string accountId, byte[] image)
    {
        var type = ImageType(image) ?? throw new AccountException("INVALID_IMAGE");
        if (image.Length > MaxAvatarBytes)
        {
            throw new AccountException("IMAGE_TOO_BIG");
        }
        lock (gate)
        {
            var account = data.Accounts.FirstOrDefault(candidate => candidate.Id == accountId)
                ?? throw new AccountException("NOT_LOGGED_IN");
            WriteAtomic(Path.Combine(AccountFolder(accountId), "avatar"), image);
            account.AvatarType = type;
            account.AvatarVersion++;
            SaveIndex();
            return Info(account);
        }
    }

    public (byte[] Bytes, string Type)? Avatar(string accountId)
    {
        if (accountId.Length > 40 || !accountId.All(char.IsLetterOrDigit))
        {
            return null;
        }
        string? type;
        lock (gate)
        {
            type = data.Accounts.FirstOrDefault(candidate => candidate.Id == accountId)?.AvatarType;
        }
        var path = Path.Combine(folder, accountId, "avatar");
        return type is not null && File.Exists(path) ? (File.ReadAllBytes(path), type) : null;
    }

    // Confere o tipo pelos primeiros bytes do arquivo (não pela extensão).
    private static string? ImageType(byte[] bytes)
    {
        if (bytes.Length > 12 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47)
        {
            return "image/png";
        }
        if (bytes.Length > 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
        {
            return "image/jpeg";
        }
        if (bytes.Length > 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP")
        {
            return "image/webp";
        }
        return null;
    }

    // ---------- fichas ----------

    private readonly Dictionary<string, SheetDocument> sheetCache = new(StringComparer.Ordinal);

    public SheetDocument Sheets(string accountId)
    {
        lock (gate)
        {
            return Clone(LoadSheets(accountId));
        }
    }

    // O site manda o documento inteiro. Os valores atuais de HP, EA e San das fichas que
    // já existem ficam com o servidor (mudam por rolagens e pelo botão de recuperar),
    // para uma aba aberta há tempo não desfazer o que aconteceu na mesa.
    public SheetDocument SaveSheets(string accountId, SheetDocument incoming)
    {
        incoming.Normalize();
        lock (gate)
        {
            var current = LoadSheets(accountId);
            foreach (var sheet in incoming.Sheets)
            {
                var existing = current.Sheets.FirstOrDefault(candidate => candidate.Id == sheet.Id);
                if (existing is not null)
                {
                    sheet.Hp.Current = Sheet.Clamp(existing.Hp.Current, Sheet.MinHp, sheet.Hp.Max);
                    sheet.Ea.Current = Sheet.Clamp(existing.Ea.Current, 0, sheet.Ea.Max);
                    sheet.San.Current = Sheet.Clamp(existing.San.Current, 0, sheet.San.Max);
                }
            }
            incoming.Version = current.Version + 1;
            StoreSheets(accountId, incoming);
            return Clone(incoming);
        }
    }

    // Muda HP, EA ou San atual da ficha ativa (ou de uma ficha escolhida), sempre
    // dentro dos limites. change recebe o valor atual e o máximo e devolve o novo.
    public SheetDocument? ChangeStatus(string accountId, string? sheetId, string stat, Func<int, int, int> change)
    {
        lock (gate)
        {
            var document = LoadSheets(accountId);
            var sheet = sheetId is null ? document.Active : document.Sheets.FirstOrDefault(candidate => candidate.Id == sheetId);
            if (sheet is null)
            {
                return null;
            }
            var block = stat switch { "hp" => sheet.Hp, "ea" => sheet.Ea, "san" => sheet.San, "vig" => sheet.Vig, _ => null };
            if (block is null)
            {
                return null;
            }
            var minimum = stat == "hp" ? Sheet.MinHp : 0;
            block.Current = Sheet.Clamp(change(block.Current, block.Max), minimum, block.Max);
            document.Version++;
            StoreSheets(accountId, document);
            return Clone(document);
        }
    }

    // Biblioteca de chefes do mestre.
    public List<BossTemplate> Bosses(string accountId)
    {
        lock (gate)
        {
            return BossTemplate.Normalize(ReadJson<List<BossTemplate>>(Path.Combine(folder, accountId, "chefes.json")));
        }
    }

    public List<BossTemplate> SaveBosses(string accountId, List<BossTemplate>? bosses)
    {
        var clean = BossTemplate.Normalize(bosses);
        lock (gate)
        {
            WriteAtomic(Path.Combine(AccountFolder(accountId), "chefes.json"), JsonSerializer.SerializeToUtf8Bytes(clean, Json));
        }
        return clean;
    }

    // Sistemas personalizados do mestre.
    public List<CustomSystem> Systems(string accountId)
    {
        lock (gate)
        {
            return CustomSystem.NormalizeList(ReadJson<List<CustomSystem>>(Path.Combine(folder, accountId, "sistemas.json")));
        }
    }

    public List<CustomSystem> SaveSystems(string accountId, List<CustomSystem>? systems)
    {
        var clean = CustomSystem.NormalizeList(systems);
        lock (gate)
        {
            WriteAtomic(Path.Combine(AccountFolder(accountId), "sistemas.json"), JsonSerializer.SerializeToUtf8Bytes(clean, Json));
        }
        return clean;
    }

    // Resumo da ficha ativa para a mesa (barras de HP e EA), sem copiar o documento todo.
    public SheetStatus? Status(string accountId)
    {
        lock (gate)
        {
            var sheet = LoadSheets(accountId).Active;
            return sheet is null ? null : new SheetStatus(sheet.Id, sheet.Name, sheet.Hp.Current, sheet.Hp.Max, sheet.Ea.Current, sheet.Ea.Max);
        }
    }

    // Lê algo da ficha ativa (sem copiar), para regras da mesa (ex.: Reflexos, resistências).
    public T? ReadActive<T>(string accountId, Func<Sheet, T> read)
    {
        lock (gate)
        {
            var sheet = LoadSheets(accountId).Active;
            return sheet is null ? default : read(sheet);
        }
    }

    private SheetDocument LoadSheets(string accountId)
    {
        if (!sheetCache.TryGetValue(accountId, out var document))
        {
            document = ReadJson<SheetDocument>(Path.Combine(folder, accountId, "fichas.json")) ?? new SheetDocument();
            document.Normalize();
            sheetCache[accountId] = document;
        }
        return document;
    }

    private void StoreSheets(string accountId, SheetDocument document)
    {
        sheetCache[accountId] = document;
        WriteAtomic(Path.Combine(AccountFolder(accountId), "fichas.json"), JsonSerializer.SerializeToUtf8Bytes(document, Json));
    }

    private static SheetDocument Clone(SheetDocument document) =>
        JsonSerializer.Deserialize<SheetDocument>(JsonSerializer.SerializeToUtf8Bytes(document, Json), Json)!;

    // ---------- detalhes ----------

    private SessionResult NewSession(AccountRecord account, bool remember)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expires = DateTime.UtcNow + (remember ? RememberLifetime : SessionLifetime);
        data.Sessions.RemoveAll(session => session.ExpiresUtc < DateTime.UtcNow);
        // No máximo 20 sessões por conta (as mais antigas saem).
        var mine = data.Sessions.Where(session => session.AccountId == account.Id).OrderBy(session => session.ExpiresUtc).ToList();
        foreach (var old in mine.Take(Math.Max(0, mine.Count - 19)))
        {
            data.Sessions.Remove(old);
        }
        data.Sessions.Add(new SessionRecord { Hash = TokenHash(token), AccountId = account.Id, ExpiresUtc = expires });
        return new SessionResult(token, expires, remember, Info(account));
    }

    private static AccountInfo Info(AccountRecord account) =>
        new(account.Id, account.Username, account.AvatarType is null ? 0 : account.AvatarVersion);

    private static void CheckPassword(string? password)
    {
        if (password is null || password.Length < MinPassword || password.Length > MaxPassword)
        {
            throw new AccountException("INVALID_PASSWORD");
        }
    }

    private void CheckThrottle(string key)
    {
        lock (gate)
        {
            if (failures.TryGetValue(key, out var entry) && DateTime.UtcNow - entry.Start < LoginWindow && entry.Count >= MaxLoginFailures)
            {
                throw new AccountException("TOO_MANY_LOGINS");
            }
        }
    }

    private void RecordFailure(string key)
    {
        lock (gate)
        {
            if (failures.Count > 5000)
            {
                failures.Clear();
            }
            var now = DateTime.UtcNow;
            failures[key] = failures.TryGetValue(key, out var entry) && now - entry.Start < LoginWindow
                ? (entry.Count + 1, entry.Start)
                : (1, now);
        }
    }

    private static string Key(string username) => username.Trim().Normalize(NormalizationForm.FormKC).ToLowerInvariant();

    private static byte[] Hash(string password, byte[] salt, int iterations = Iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, 32);

    private static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private void SaveIndex() => WriteAtomic(IndexPath, JsonSerializer.SerializeToUtf8Bytes(data, Json));

    internal static T? ReadJson<T>(string path) where T : class
    {
        try
        {
            return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllBytes(path), Json) : null;
        }
        catch (JsonException)
        {
            // Arquivo estragado: guarda uma cópia e começa do zero, sem derrubar a mesa.
            try
            {
                File.Copy(path, path + ".estragado", overwrite: true);
            }
            catch (IOException)
            {
            }
            return null;
        }
    }

    // Grava num arquivo temporário e troca de uma vez: queda de energia não deixa arquivo pela metade.
    internal static void WriteAtomic(string path, byte[] bytes)
    {
        var temporary = path + ".tmp";
        File.WriteAllBytes(temporary, bytes);
        File.Move(temporary, path, overwrite: true);
    }

    private sealed class StoreFile
    {
        public List<AccountRecord> Accounts { get; set; } = new();
        public List<SessionRecord> Sessions { get; set; } = new();
    }

    private sealed class AccountRecord
    {
        public string Id { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public string Key { get; set; } = string.Empty;
        public string Salt { get; set; } = string.Empty;
        public string Hash { get; set; } = string.Empty;
        public int Iterations { get; set; } = AccountStore.Iterations;
        public DateTime CreatedUtc { get; set; }
        public string? AvatarType { get; set; }
        public int AvatarVersion { get; set; }
    }

    private sealed class SessionRecord
    {
        public string Hash { get; set; } = string.Empty;
        public string AccountId { get; set; } = string.Empty;
        public DateTime ExpiresUtc { get; set; }
    }
}

public sealed record AccountInfo(string Id, string Username, int AvatarVersion);

// O que a mesa mostra da ficha ativa de cada jogador.
public sealed record SheetStatus(string SheetId, string Name, int Hp, int HpMax, int Ea, int EaMax);

public sealed record SessionResult(string Token, DateTime ExpiresUtc, bool Remember, AccountInfo Account);

public sealed class AccountException(string code) : Exception(code)
{
    public string Code { get; } = code;
}
