using System.Text;
using System.Text.Json;
using Qomicex.Connector.Models;

namespace Qomicex.Connector.Protocols;

public interface IProtocol
{
    string ProtocolKey { get; }
    Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct);
}

public class PingProtocol : IProtocol
{
    public string ProtocolKey => "c:ping";

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct)
    {
        return Task.FromResult(new ProtocolResponse { Status = 0, Body = request.Body });
    }
}

public class ProtocolsProtocol : IProtocol
{
    private readonly IReadOnlyList<string> _supportedProtocols;

    public string ProtocolKey => "c:protocols";

    public ProtocolsProtocol(IReadOnlyList<string> supportedProtocols)
    {
        _supportedProtocols = supportedProtocols;
    }

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct)
    {
        var body = Encoding.UTF8.GetBytes(string.Join('\0', _supportedProtocols));
        return Task.FromResult(new ProtocolResponse { Status = 0, Body = body });
    }
}

public class ServerPortProtocol : IProtocol
{
    private readonly int _port;

    public string ProtocolKey => "c:server_port";

    public ServerPortProtocol(int port)
    {
        _port = port;
    }

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct)
    {
        var body = new byte[2];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt16BigEndian(body, (ushort)_port);
        return Task.FromResult(new ProtocolResponse { Status = 0, Body = body });
    }
}

public class PlayerPingProtocol : IProtocol
{
    private readonly Action<PlayerInfo> _onPlayerPing;

    public string ProtocolKey => "c:player_ping";

    public PlayerPingProtocol(Action<PlayerInfo> onPlayerPing)
    {
        _onPlayerPing = onPlayerPing;
    }

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct)
    {
        var json = Encoding.UTF8.GetString(request.Body);
        var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;

        var playerInfo = new PlayerInfo
        {
            Name = root.GetProperty("name").GetString() ?? "",
            MachineId = root.GetProperty("machine_id").GetString() ?? "",
            Vendor = root.GetProperty("vendor").GetString() ?? "",
            EasyTierId = root.TryGetProperty("easytier_id", out var eid) ? eid.GetString() : null
        };

        _onPlayerPing(playerInfo);
        return Task.FromResult(new ProtocolResponse { Status = 0, Body = [] });
    }
}

public class PlayerProfilesListProtocol : IProtocol
{
    private readonly Func<IReadOnlyList<PlayerInfo>> _getPlayers;

    public string ProtocolKey => "c:player_profiles_list";

    public PlayerProfilesListProtocol(Func<IReadOnlyList<PlayerInfo>> getPlayers)
    {
        _getPlayers = getPlayers;
    }

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct)
    {
        var players = _getPlayers();
        var entries = players.Select(p => new PlayerProfileEntry
        {
            Name = p.Name,
            MachineId = p.MachineId,
            EasyTierId = p.EasyTierId,
            Vendor = p.Vendor,
            Kind = p.Kind == PlayerKind.Host ? "HOST" : "GUEST"
        }).ToArray();
        var json = JsonSerializer.Serialize(entries, ConnectorJsonContext.Default.PlayerProfileEntryArray);
        var body = Encoding.UTF8.GetBytes(json);
        return Task.FromResult(new ProtocolResponse { Status = 0, Body = body });
    }
}

/// <summary>
/// 通用委托协议适配器，用于快速注册自定义扩展协议（如 qml:game_info）。
/// 提供原始字节、无入参类型化、带入参类型化三种形式；类型化形式默认使用 System.Text.Json。
/// </summary>
public sealed class DelegateProtocol : IProtocol
{
    private readonly Func<ProtocolRequest, CancellationToken, Task<ProtocolResponse>> _handler;

    public string ProtocolKey { get; }

    public DelegateProtocol(string protocolKey, Func<byte[], byte[]> handler)
    {
        ProtocolKey = protocolKey;
        _handler = (req, _) => Task.FromResult(new ProtocolResponse { Status = 0, Body = handler(req.Body) });
    }

    public DelegateProtocol(string protocolKey, Func<ProtocolRequest, CancellationToken, Task<ProtocolResponse>> handler)
    {
        ProtocolKey = protocolKey;
        _handler = handler;
    }

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct) => _handler(request, ct);
}

/// <summary>
/// 无入参、返回类型化数据的委托协议（响应体以 JSON 序列化）。
/// 泛型类型由调用方提供，AOT 下需确保类型已在调用方的 JsonSerializerContext 中注册。
/// </summary>
public sealed class DelegateProtocol<TResp> : IProtocol
{
    private readonly Func<TResp> _handler;
    private readonly JsonSerializerOptions? _options;

    public string ProtocolKey { get; }

    public DelegateProtocol(string protocolKey, Func<TResp> handler, JsonSerializerOptions? options = null)
    {
        ProtocolKey = protocolKey;
        _handler = handler;
        _options = options;
    }

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct)
    {
#pragma warning disable IL3050, IL2026
        var json = JsonSerializer.Serialize(_handler(), _options);
#pragma warning restore IL3050, IL2026
        return Task.FromResult(new ProtocolResponse { Status = 0, Body = Encoding.UTF8.GetBytes(json) });
    }
}

/// <summary>
/// 带入参、返回类型化数据的委托协议：请求体反序列化为 TReq，返回值序列化为响应体（JSON）。
/// 泛型类型由调用方提供，AOT 下需确保类型已在调用方的 JsonSerializerContext 中注册。
/// </summary>
public sealed class DelegateProtocol<TReq, TResp> : IProtocol
{
    private readonly Func<TReq, TResp> _handler;
    private readonly JsonSerializerOptions? _options;

    public string ProtocolKey { get; }

    public DelegateProtocol(string protocolKey, Func<TReq, TResp> handler, JsonSerializerOptions? options = null)
    {
        ProtocolKey = protocolKey;
        _handler = handler;
        _options = options;
    }

    public Task<ProtocolResponse> HandleAsync(ProtocolRequest request, CancellationToken ct)
    {
#pragma warning disable IL3050, IL2026
        var arg = request.Body.Length == 0
            ? default!
            : JsonSerializer.Deserialize<TReq>(Encoding.UTF8.GetString(request.Body), _options)!;
        var json = JsonSerializer.Serialize(_handler(arg), _options);
#pragma warning restore IL3050, IL2026
        return Task.FromResult(new ProtocolResponse { Status = 0, Body = Encoding.UTF8.GetBytes(json) });
    }
}
