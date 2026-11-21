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
    string? ReconnectToken);

public sealed record JoinRoomRequest(
    string Code,
    string PlayerName,
    string? CharacterName,
    bool AsSpectator,
    string? ReconnectToken);

public sealed record RoomSettingsRequest(string RoomName, int MaxPlayers, bool IsPublic, bool AllowSpectators);

public sealed record JoinResponse(RoomSnapshot Room, string ReconnectToken, string PlayerId);

public sealed record RoomPlayer(string Id, string Name, string CharacterName, bool IsMaster, bool IsOnline, SharedRoll? LastRoll);

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
    IReadOnlyList<SharedRoll> Rolls);

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

public sealed record SharedRoll(string Id, string PlayerId, string Player, string CharacterName, string TargetPlayerId, string Notation, double Total, string Output, long Timestamp, bool IsPrivate, IReadOnlyList<RollDie> Dice, int ExtraDice);

public sealed record RollPayload(string Id, string Notation, double Total, string Output, string TargetPlayerId, bool IsPrivate, IReadOnlyList<RollDie>? Dice, int ExtraDice);
