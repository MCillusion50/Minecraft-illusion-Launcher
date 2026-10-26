using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Qomicex.Connector.Core;
using Qomicex.Connector.Models;

namespace Qomicex.Connector.Guest;

public class ScaffoldingGuest : IDisposable
{
    private readonly ILogger<ScaffoldingGuest> _logger;
    private readonly EasyTierManager _easyTier;
    private readonly string? _easyTierPath;
    private readonly CenterDiscoveryService _discovery;
    private readonly TcpClient _tcpClient;
    private readonly IReadOnlyList<string> _customProtocolKeys;
    private readonly string[]? _relayNodes;
    private HeartbeatService? _heartbeatService;
    private IReadOnlyList<string> _negotiatedProtocols = [];
    private NetworkConfig? _config;
    private CenterDiscoveryResult? _center;
    private bool _usePortForward;
    private bool _connectionLostFired;

    public string PlayerName { get; }
    public string MachineId { get; }
    public string Vendor { get; }
    public bool IsConnected => _tcpClient.IsConnected;

    public event Action? ConnectionLost;

    /// <summary>
    /// 本次联机协商出的可用协议列表（含标准协议与双端都支持的自定义协议）。
    /// </summary>
    public IReadOnlyList<string> NegotiatedProtocols => _negotiatedProtocols;

    /// <summary>
    /// MC 服务器可连接地址。调用 <see cref="MapMinecraftPortAsync"/> 后可用。
    /// 直连模式为虚拟 IP，端口转发模式为 127.0.0.1。
    /// </summary>
    public string? MinecraftHost { get; private set; }

    /// <summary>
    /// MC 服务器可连接端口。调用 <see cref="MapMinecraftPortAsync"/> 后可用。
    /// </summary>
    public int? MinecraftPort { get; private set; }

    internal ScaffoldingGuest(
        string playerName,
        string machineId,
        string vendor,
        EasyTierManager easyTier,
        string? easyTierPath,
        CenterDiscoveryService discovery,
        TcpClient tcpClient,
        ILogger<ScaffoldingGuest> logger,
        IReadOnlyList<string>? customProtocolKeys = null,
        string[]? relayNodes = null)
    {
        PlayerName = playerName;
        MachineId = machineId;
        Vendor = vendor;
        _easyTier = easyTier;
        _easyTierPath = easyTierPath;
        _discovery = discovery;
        _tcpClient = tcpClient;
        _logger = logger;
        _customProtocolKeys = customProtocolKeys ?? [];
        _relayNodes = relayNodes;
    }

    internal async Task ConnectAsync(RoomCode roomCode, CancellationToken ct = default)
    {
        var config = new NetworkConfig
        {
            NetworkName = roomCode.EasyTierNetworkName,
            NetworkSecret = roomCode.EasyTierNetworkSecret,
            Hostname = $"scaffolding-mc-guest-{MachineId[..Math.Min(8, MachineId.Length)]}",
            EasyTierPath = _easyTierPath,
            NoTun = true,
            UseSmoltcp = true,
            Dhcp = true,
            RelayNodes = _relayNodes
        };

        await _easyTier.StartAsync(config, ct);
        _logger.LogInformation("已加入 EasyTier 网络");

        var center = await _discovery.DiscoverAsync(_easyTier, ct);
        _center = center;
        _config = config;

        // 先尝试直连虚拟 IP（有 TUN 权限时成功，无需重启）
        if (await TryConnectOnceAsync(center.VirtualIp, center.Port, TimeSpan.FromSeconds(3), ct))
        {
            _logger.LogInformation("虚拟 IP 直连成功，无需端口转发");
            _usePortForward = false;
        }
        else
        {
            // 失败则重启 EasyTier 加入 Center port-forward
            var localPort = FindFreeLocalPort();
            _logger.LogInformation("虚拟 IP 不可达，重启 EasyTier 建立端口转发 127.0.0.1:{Local} -> {VIp}:{VPort}",
                localPort, center.VirtualIp, center.Port);

            await _easyTier.StopAsync(ct);
            config.PortForwards = [$"tcp://127.0.0.1:{localPort}/{center.VirtualIp}:{center.Port}"];
            await _easyTier.StartAsync(config, ct);

            if (!await TryConnectWithRetryAsync("127.0.0.1", localPort, retries: 10, ct))
                throw new CenterConnectionException("无法连接到联机中心（端口转发建立失败）");

            _usePortForward = true;
        }

        _logger.LogInformation("已连接联机中心，启动心跳");

        _heartbeatService = new HeartbeatService(_logger, _ => SendPlayerPing(CancellationToken.None), () => ConnectionLost?.Invoke());
        _ = _heartbeatService.StartAsync(ct);
    }

    private static int FindFreeLocalPort()
    {
        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    // 多次重试连接：给 EasyTier P2P 打洞留时间（两端 PortRestricted NAT 打洞需要多轮探测）
    private async Task<bool> TryConnectWithRetryAsync(string host, int port, int retries, CancellationToken ct)
    {
        for (int i = 1; i <= retries; i++)
        {
            if (ct.IsCancellationRequested) return false;

            _logger.LogInformation("尝试连接中心 {Host}:{Port} (第 {N}/{Total} 次)", host, port, i, retries);
            if (await TryConnectOnceAsync(host, port, TimeSpan.FromSeconds(3), ct))
                return true;

            if (i < retries)
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }
        return false;
    }

    private async Task<bool> TryConnectOnceAsync(string host, int port, TimeSpan timeout, CancellationToken ct)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);
        try
        {
            await _tcpClient.ConnectAsync(host, port, timeoutCts.Token);
            await SendPlayerPing(timeoutCts.Token);
            await NegotiateProtocols(timeoutCts.Token);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "连接 {Host}:{Port} 失败", host, port);
            _tcpClient.Disconnect();
            return false;
        }
    }

    private async Task NegotiateProtocols(CancellationToken ct)
    {
        var myProtocols = new List<string>
        {
            "c:ping", "c:protocols", "c:server_port", "c:player_ping",
            "c:player_profiles_list", "c:player_easytier_id"
        };
        myProtocols.AddRange(_customProtocolKeys);

        var request = new ProtocolRequest
        {
            Namespace = "c",
            RequestType = "protocols",
            Body = Encoding.UTF8.GetBytes(string.Join('\0', myProtocols))
        };

        var response = await _tcpClient.SendAsync(request, ct);
        if (response.IsSuccess)
        {
            var centerProtocols = Encoding.UTF8.GetString(response.Body).Split('\0');
            _negotiatedProtocols = ProtocolNegotiator.Negotiate(myProtocols, centerProtocols);
            _logger.LogInformation("协议协商完成: {Protocols}", string.Join(", ", _negotiatedProtocols));
        }
    }

    private async Task SendPlayerPing(CancellationToken ct)
    {
        if (!_tcpClient.IsConnected)
        {
            if (!_connectionLostFired)
            {
                _connectionLostFired = true;
                ConnectionLost?.Invoke();
            }
            return;
        }

        string json;
        if (_negotiatedProtocols.Contains("c:player_easytier_id"))
        {
            json = JsonSerializer.Serialize(new PlayerProfileEntry
            {
                Name = PlayerName,
                MachineId = MachineId,
                EasyTierId = _easyTier.NodeId ?? "",
                Vendor = Vendor
            }, ConnectorJsonContext.Default.PlayerProfileEntry);
        }
        else
        {
            json = JsonSerializer.Serialize(new PlayerProfileEntry
            {
                Name = PlayerName,
                MachineId = MachineId,
                Vendor = Vendor
            }, ConnectorJsonContext.Default.PlayerProfileEntry);
        }

        await _tcpClient.SendAsync(new ProtocolRequest
        {
            Namespace = "c",
            RequestType = "player_ping",
            Body = Encoding.UTF8.GetBytes(json)
        }, ct);
    }

    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        var testData = new byte[] { 0x42 };
        var response = await _tcpClient.SendAsync(new ProtocolRequest
        {
            Namespace = "c",
            RequestType = "ping",
            Body = testData
        }, ct);
        return response.IsSuccess;
    }

    public async Task<int> GetServerPortAsync(CancellationToken ct = default)
    {
        var response = await _tcpClient.SendAsync(new ProtocolRequest
        {
            Namespace = "c",
            RequestType = "server_port",
            Body = []
        }, ct);

        if (response.Status >= 32 && response.Status < 64)
            throw new ProtocolException($"MC 服务器未启动 (状态码: {response.Status})");

        if (!response.IsSuccess)
            throw new ProtocolException($"获取服务器端口失败 (状态码: {response.Status})");

        return BinaryPrimitives.ReadUInt16BigEndian(response.Body);
    }

    /// <summary>
    /// 建立 MC 端口可连接地址，返回 (host, port)。
    /// 直连模式：无需重启，直接返回虚拟 IP + MC 端口。
    /// 端口转发模式：重启 EasyTier 加入 MC 转发规则，返回 127.0.0.1 + 本地端口。
    /// </summary>
    public async Task<(string Host, int Port)> MapMinecraftPortAsync(CancellationToken ct = default)
    {
        if (_config is null || _center is null)
            throw new InvalidOperationException("尚未加入房间");

        if (MinecraftHost is not null && MinecraftPort is not null)
            return (MinecraftHost, MinecraftPort.Value);

        var mcPort = await GetServerPortAsync(ct);

        if (!_usePortForward)
        {
            // 直连模式：虚拟 IP 可路由，MC 端口也可直连，无需重启
            _logger.LogInformation("直连模式，MC 地址: {VIp}:{Port}", _center.VirtualIp, mcPort);
            MinecraftHost = _center.VirtualIp;
            MinecraftPort = mcPort;
            return (MinecraftHost, mcPort);
        }

        // 端口转发模式：重启 EasyTier，把 Center + MC 两条转发一起加进去
        var localMcPort = FindFreeLocalPort();
        var centerForward = _config.PortForwards[0]; // Center 转发已存在

        _logger.LogInformation("重启 EasyTier，MC 端口转发 127.0.0.1:{Local} -> {VIp}:{VPort}",
            localMcPort, _center.VirtualIp, mcPort);

        _heartbeatService?.Dispose();
        _tcpClient.Disconnect();
        await _easyTier.StopAsync(ct);

        _config.PortForwards =
        [
            centerForward,
            $"tcp://127.0.0.1:{localMcPort}/{_center.VirtualIp}:{mcPort}"
        ];
        await _easyTier.StartAsync(_config, ct);

        var centerLocalPort = ParseLocalPortFromForward(centerForward);
        if (!await TryConnectWithRetryAsync("127.0.0.1", centerLocalPort, retries: 10, ct))
            throw new CenterConnectionException("MC 转发建立后重连 Center 失败");

        _heartbeatService = new HeartbeatService(_logger, _ => SendPlayerPing(CancellationToken.None), () => ConnectionLost?.Invoke());
        _ = _heartbeatService.StartAsync(ct);

        MinecraftHost = "127.0.0.1";
        MinecraftPort = localMcPort;
        return ("127.0.0.1", localMcPort);
    }

    private static int ParseLocalPortFromForward(string forward)
    {
        // tcp://127.0.0.1:LOCAL/REMOTE:PORT
        var slash = forward.IndexOf('/', "tcp://".Length);
        var head = forward[..slash];
        var colon = head.LastIndexOf(':');
        return int.Parse(head[(colon + 1)..]);
    }

    public async Task<IReadOnlyList<PlayerInfo>> GetPlayerListAsync(CancellationToken ct = default)
    {
        var response = await _tcpClient.SendAsync(new ProtocolRequest
        {
            Namespace = "c",
            RequestType = "player_profiles_list",
            Body = []
        }, ct);

        var json = Encoding.UTF8.GetString(response.Body);
#pragma warning disable IL3050, IL2026
        var elements = JsonSerializer.Deserialize<JsonElement[]>(json);
#pragma warning restore IL3050, IL2026
        if (elements is null) return [];

        return elements.Select(e => new PlayerInfo
        {
            Name = e.GetProperty("name").GetString() ?? "",
            MachineId = e.GetProperty("machine_id").GetString() ?? "",
            EasyTierId = e.TryGetProperty("easytier_id", out var eid) ? eid.GetString() : null,
            Vendor = e.GetProperty("vendor").GetString() ?? "",
            Kind = e.GetProperty("kind").GetString() == "HOST" ? PlayerKind.Host : PlayerKind.Guest
        }).ToList();
    }

    public async Task StartHeartbeatAsync(CancellationToken ct = default)
    {
        _heartbeatService ??= new HeartbeatService(_logger, (cct) => SendPlayerPing(cct));
        await _heartbeatService.StartAsync(ct);
    }

    /// <summary>
    /// 向联机中心发送任意（含自定义扩展）协议请求，返回原始响应。
    /// </summary>
    public Task<ProtocolResponse> SendAsync(ProtocolRequest request, CancellationToken ct = default)
        => _tcpClient.SendAsync(request, ct);

    /// <summary>
    /// 调用无入参的自定义协议，响应体按 JSON 反序列化为 <typeparamref name="TResp"/>。
    /// protocolKey 形如 "qml:game_version"。AOT 下需确保 TResp 已在调用方的 JsonSerializerContext 中注册。
    /// </summary>
    public async Task<TResp?> SendAsync<TResp>(string protocolKey, CancellationToken ct = default)
    {
        var (ns, type) = SplitKey(protocolKey);
        var response = await _tcpClient.SendAsync(new ProtocolRequest { Namespace = ns, RequestType = type, Body = [] }, ct);
        if (!response.IsSuccess)
            throw new ProtocolException($"协议 {protocolKey} 返回错误状态: {response.Status}");
#pragma warning disable IL3050, IL2026
        return JsonSerializer.Deserialize<TResp>(Encoding.UTF8.GetString(response.Body));
#pragma warning restore IL3050, IL2026
    }

    /// <summary>
    /// 调用带入参的自定义协议：payload 以 JSON 编码为请求体，响应体按 JSON 反序列化为 <typeparamref name="TResp"/>。
    /// AOT 下需确保 TReq/TResp 已在调用方的 JsonSerializerContext 中注册。
    /// </summary>
    public async Task<TResp?> SendAsync<TReq, TResp>(string protocolKey, TReq payload, CancellationToken ct = default)
    {
        var (ns, type) = SplitKey(protocolKey);
#pragma warning disable IL3050, IL2026
        var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        var response = await _tcpClient.SendAsync(new ProtocolRequest { Namespace = ns, RequestType = type, Body = body }, ct);
        if (!response.IsSuccess)
            throw new ProtocolException($"协议 {protocolKey} 返回错误状态: {response.Status}");
        return JsonSerializer.Deserialize<TResp>(Encoding.UTF8.GetString(response.Body));
#pragma warning restore IL3050, IL2026
    }

    private static (string Namespace, string RequestType) SplitKey(string protocolKey)
    {
        var colon = protocolKey.IndexOf(':');
        if (colon < 0)
            throw new ProtocolException($"无效的协议键格式: {protocolKey}");
        return (protocolKey[..colon], protocolKey[(colon + 1)..]);
    }

    /// <summary>
    /// 退出房间：停止心跳、断开连接并清理本实例启动的 EasyTier 进程树。
    /// </summary>
    public async Task LeaveAsync(CancellationToken ct = default)
    {
        _heartbeatService?.Dispose();
        _tcpClient.Disconnect();
        await _easyTier.StopAsync(ct);
        _logger.LogInformation("已退出房间");
    }

    public void Dispose()
    {
        _heartbeatService?.Dispose();
        _tcpClient.Disconnect();
        _easyTier.Dispose();
        GC.SuppressFinalize(this);
    }
}
