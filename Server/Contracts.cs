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
public sealed record RoomPlayer(string Id, string Name, string CharacterName, bool IsMaster, bool IsOnline, string Color, SharedRoll? LastRoll);

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
    bool IsMaster,
    bool IsSpectator,
    IReadOnlyList<RoomPlayer> Players,
    IReadOnlyList<RoomSpectator> Spectators,
    IReadOnlyList<SharedRoll> Rolls,
    IReadOnlyList<ChatMessage> Chat);

// Mensagem do chat da sala. Color vazio = espectador. Fica guardada até a sala fechar.
public sealed record ChatMessage(string Id, string PlayerId, string Name, string Color, string Text, long Timestamp);

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

public sealed record SharedRoll(string Id, string PlayerId, string Player, string CharacterName, string TargetPlayerId, string Notation, double Total, string Output, long Timestamp, bool IsPrivate, IReadOnlyList<RollDie> Dice, int ExtraDice, string DiceColor, string DiceStyle);

// DiceColor: a cor dos dados de quem rolou ("classic" = uma cor por tipo de dado).
// DiceStyle: o modelo dos dados (formato e símbolos), um da lista em TableHub.DiceStyles.
public sealed record RollPayload(string Id, string Notation, double Total, string Output, string TargetPlayerId, bool IsPrivate, IReadOnlyList<RollDie>? Dice, int ExtraDice, string? DiceColor, string? DiceStyle);
