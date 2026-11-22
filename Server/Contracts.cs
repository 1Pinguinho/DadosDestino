namespace RolagemRpg;

// Mensagens trocadas entre o site e o hub (/tableHub). Erros vão como códigos
// (ex.: ROOM_FULL) e o site mostra o texto no idioma escolhido.

public sealed record CreateRoomRequest(
    string PlayerName,
    string CharacterName,
    string RoomName,
    int MaxPlayers,
    bool IsPublic,
    bool AllowSpectators,
    string? ReconnectToken,
    string? Color);

public sealed record JoinRoomRequest(
    string Code,
    string PlayerName,
    string? CharacterName,
    bool AsSpectator,
    string? ReconnectToken,
    string? Color);

public sealed record RoomSettingsRequest(string RoomName, int MaxPlayers, bool IsPublic, bool AllowSpectators);

// O mestre remove alguém; com Ban, quem foi removido não volta para esta sala.
public sealed record KickRequest(string PlayerId, bool Ban);

public sealed record JoinResponse(RoomSnapshot Room, string ReconnectToken, string PlayerId);

// Color: a cor da mesa do jogador (uma das cores da lista em TableHub.PlayerColors).
// AccountId/AvatarVersion: quem entrou com conta (foto em /api/avatars/{AccountId}).
// Status: HP e EA da ficha ativa, para as barrinhas da mesa.
public sealed record RoomPlayer(string Id, string Name, string CharacterName, bool IsMaster, bool IsOnline, string Color, SharedRoll? LastRoll,
    string? AccountId, int AvatarVersion, SheetStatus? Status, SeatLook? Look = null);

// Visual da mesa do jogador: superfície, moldura, brasão, efeito e cores (opcionais).
// Os nomes válidos ficam em SeatLook.Surfaces etc.; as cores são "#rrggbb" ou null (cor da mesa).
public sealed record SeatLook(string Surface, string Frame, string Crest, string Weather, string? Bg, string? Accent)
{
    public static readonly string[] Surfaces = { "plain", "felt", "wood", "stone", "leather", "marble", "parchment", "starry", "metal" };
    public static readonly string[] Frames = { "simple", "double", "carved", "runic", "gold", "thorns" };
    public static readonly string[] Crests = { "none", "swords", "skull", "moon", "crown", "star", "sun", "anchor", "leaf", "cross", "fleur", "knight", "yinyang" };
    public static readonly string[] Weathers = { "none", "embers", "mist", "snow", "sparks", "petals" };
    private static readonly System.Text.RegularExpressions.Regex Hex = new("^#[0-9a-fA-F]{6}$");

    public static SeatLook Default => new("plain", "simple", "none", "none", null, null);

    public SeatLook Clean() => new(
        Surfaces.Contains(Surface) ? Surface : "plain",
        Frames.Contains(Frame) ? Frame : "simple",
        Crests.Contains(Crest) ? Crest : "none",
        Weathers.Contains(Weather) ? Weather : "none",
        Bg is not null && Hex.IsMatch(Bg) ? Bg.ToLowerInvariant() : null,
        Accent is not null && Hex.IsMatch(Accent) ? Accent.ToLowerInvariant() : null);
}

public sealed record ReopenRoomRequest(string Code, string PlayerName, string CharacterName, string? Color);

// Uma mesa salva do mestre, para "Minhas mesas".
public sealed record MyRoom(string Code, string Name, bool IsOpen, int Players, int Notes);

public sealed record NoteRequest(string? Id, string Title, string Text);

public sealed record RoomSpectator(string Id, string Name, bool IsOnline);

public sealed record RoomRoster(
    string Code,
    string Name,
    int MaxPlayers,
    bool IsPublic,
    bool AllowSpectators,
    int MaxSpectators,
    IReadOnlyList<RoomPlayer> Players,
    IReadOnlyList<RoomSpectator> Spectators);

public sealed record RoomSnapshot(
    string Code,
    string Name,
    int MaxPlayers,
    bool IsPublic,
    bool AllowSpectators,
    int MaxSpectators,
    string MyPlayerId,
    string? MyAccountId,
    bool IsMaster,
    bool IsSpectator,
    IReadOnlyList<RoomPlayer> Players,
    IReadOnlyList<RoomSpectator> Spectators,
    IReadOnlyList<SharedRoll> Rolls,
    IReadOnlyList<ChatMessage> Chat,
    IReadOnlyList<RoomNote> Notes,
    bool IsSaved,
    CombatView? Combat,
    IReadOnlyList<BlindRequestView> BlindRequests,
    string Ambient);

// Mensagem do chat da sala. Color vazio = espectador. Fica guardada até a sala fechar.
// Summary: o resumo do combate (mensagem automática ao encerrar).
public sealed record ChatMessage(string Id, string PlayerId, string Name, string Color, string Text, long Timestamp, CombatSummary? Summary = null);

// Reação rápida (um emoji da lista em TableHub.Reactions) na mesa de um jogador; não é guardada.
public sealed record TableReaction(string TargetPlayerId, string Emoji, string From);

public sealed record PublicRoom(
    string Code,
    string Name,
    string MasterName,
    int Players,
    int MaxPlayers,
    int Spectators,
    bool AllowSpectators);

public sealed record ServerLimits(int MaxPlayersPerRoom, int MaxSpectatorsPerRoom);

// Um dado da rolagem, para os outros verem a mesma animação (lados -1 = dado Fate).
public sealed record RollDie(int Sides, double Value, double Natural, bool Used);

// Kind: "normal", "recovery" (poção), "damage", "attack", "reflex", "initiative", "medicine".
// EffectTargetId: em quem a rolagem age (poção em outro jogador, ataque, socorro).
// Applied: quanto foi aplicado de verdade na ficha (ex.: cura limitada pela vida máxima).
public sealed record SharedRoll(string Id, string PlayerId, string Player, string CharacterName, string TargetPlayerId, string Notation, double Total, string Output, long Timestamp, bool IsPrivate, IReadOnlyList<RollDie> Dice, int ExtraDice, string DiceColor, string DiceStyle,
    string Kind, string? EffectTargetId, string? RecoverStat, string? DamageType, int ManaCost, int? Applied,
    string? Label = null, bool BlindSees = false, bool Hidden = false);

// Teste às cegas pedido pelo mestre (Label: o nome do teste, ex.: "Percepção").
// SkillId: perícia da ficha do jogador; Notation: rolagem livre quando não é perícia.
// PlayerSees: se o próprio jogador vê o resultado (os outros nunca veem).
public sealed record BlindRollRequest(string PlayerId, string Label, string? SkillId, string? Notation, bool PlayerSees);

public sealed record BlindRequestView(string Id, string Label, string? SkillId, string? Notation, bool PlayerSees);

// DiceColor: a cor dos dados de quem rolou ("classic" = uma cor por tipo de dado).
// DiceStyle: o modelo dos dados (formato e símbolos), um da lista em TableHub.DiceStyles.
// RecoverStat: "hp" ou "ea". DamageType: "physical", "magic" ou "pierce". ManaCost: EA gasta na magia.
public sealed record RollPayload(string Id, string Notation, double Total, string Output, string TargetPlayerId, bool IsPrivate, IReadOnlyList<RollDie>? Dice, int ExtraDice, string? DiceColor, string? DiceStyle,
    string? Kind = null, string? EffectTargetId = null, string? RecoverStat = null, string? DamageType = null, int ManaCost = 0,
    string? StatusId = null, string? AbilityId = null);
