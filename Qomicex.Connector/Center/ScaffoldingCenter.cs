using Microsoft.Extensions.Logging;
using Qomicex.Connector.Models;
using Qomicex.Connector.Protocols;

namespace Qomicex.Connector.Center;

public class ScaffoldingCenter : IDisposable
{
    private readonly ILogger<ScaffoldingCenter> _logger;
    private readonly EasyTierManager _easyTier;
    private readonly string? _easyTierPath;
    private readonly IReadOnlyList<IProtocol> _customProtocols;
    private readonly string[]? _relayNodes;
    private readonly List<PlayerInfo> _players = [];
    private readonly object _playersLock = new();
    private TcpServer? _tcpServer;

    public RoomCode RoomCode { get; }
    public int MinecraftPort { get; }
    public string PlayerName { get; }
    public string MachineId { get; }
    public string Vendor { get; }
    public bool IsRunning => _easyTier.IsRunning;

    public event Action<IReadOnlyList<PlayerInfo>>? PlayersChanged;

    internal ScaffoldingCenter(
        RoomCode roomCode,
        string playerName,
        string machineId,
        string vendor,
        int minecraftPort,
        EasyTierManager easyTier,
        string? easyTierPath,
        ILogger<ScaffoldingCenter> logger,
        IReadOnlyList<IProtocol>? customProtocols = null,
        string[]? relayNodes = null)
    {
        RoomCode = roomCode;
        PlayerName = playerName;
        MachineId = machineId;
        Vendor = vendor;
        MinecraftPort = minecraftPort;
        _easyTier = easyTier;
        _easyTierPath = easyTierPath;
        _logger = logger;
        _customProtocols = customProtocols ?? [];
        _relayNodes = relayNodes;
    }

    internal async Task StartAsync(CancellationToken ct = default)
    {
        var advertisedKeys = new List<string>
        {
            "c:ping", "c:protocols", "c:server_port", "c:player_ping",
            "c:player_profiles_list", "c:player_easytier_id"
        };
        advertisedKeys.AddRange(_customProtocols.Select(p => p.ProtocolKey));

        var protocols = new List<IProtocol>
        {
            new PingProtocol(),
            new ProtocolsProtocol(advertisedKeys),
            new ServerPortProtocol(MinecraftPort),
            new PlayerPingProtocol(OnPlayerPing),
            new PlayerProfilesListProtocol(GetPlayers)
        };
        protocols.AddRange(_customProtocols);

        // 在 25000-26000 范围扫描可用端口
        var tcpPort = 0;
        for (int p = 1025; p < 65535; p++)
        {
            try
            {
                var test = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Any, p);
                test.Start(); test.Stop();
                tcpPort = p;
                break;
            }
            catch { }
        }
        if (tcpPort == 0) tcpPort = 25000;

        _tcpServer = new TcpServer(tcpPort, _logger, protocols);
        _tcpServer.ClientDisconnected += OnClientDisconnected;
        _ = Task.Run(async () =>
        {
            try { await _tcpServer.StartAsync(ct); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { _logger.LogError(ex, "TcpServer 异常退出"); }
        }, ct);
        await Task.Delay(200, ct);
        _logger.LogInformation("Scaffolding TCP 端口: {Port}", tcpPort);

        // 用实际端口启动 EasyTier
        var config = new NetworkConfig
        {
            NetworkName = RoomCode.EasyTierNetworkName,
            NetworkSecret = RoomCode.EasyTierNetworkSecret,
            Hostname = $"scaffolding-mc-server-{tcpPort}",
            EasyTierPath = _easyTierPath,
            Ipv4 = "10.144.144.1",
            Dhcp = false,
            TcpWhitelist = [$"{tcpPort}", $"{MinecraftPort}"],
            RelayNodes = _relayNodes
        };

        await _easyTier.StartAsync(config, ct);

        lock (_playersLock)
        {
            _players.Add(new PlayerInfo
            {
                Name = PlayerName,
                MachineId = MachineId,
                EasyTierId = _easyTier.NodeId,
                Vendor = Vendor,
                Kind = PlayerKind.Host
            });
        }

        _logger.LogInformation("联机中心启动完成，房间码: {Code}", RoomCode.Raw);
    }

    private void OnPlayerPing(PlayerInfo info)
    {
        lock (_playersLock)
        {
            var existing = _players.FirstOrDefault(p => p.MachineId == info.MachineId);
            if (existing is not null)
            {
                existing.Name = info.Name;
                existing.EasyTierId = info.EasyTierId;
                existing.Vendor = info.Vendor;
            }
            else
            {
                info.Kind = PlayerKind.Guest;
                _players.Add(info);
                _logger.LogInformation("新玩家加入: {Name} ({MachineId})", info.Name, info.MachineId);
            }
        }
        NotifyPlayersChanged();
    }

    private void OnClientDisconnected(string? machineId)
    {
        if (!string.IsNullOrEmpty(machineId))
        {
            lock (_playersLock)
            {
                var player = _players.FirstOrDefault(p => p.MachineId == machineId);
                if (player is not null && player.Kind != PlayerKind.Host)
                {
                    _players.Remove(player);
                    _logger.LogInformation("玩家已离开: {Name} ({MachineId})", player.Name, player.MachineId);
                }
            }
        }
        NotifyPlayersChanged();
    }

    public IReadOnlyList<PlayerInfo> GetPlayers()
    {
        lock (_playersLock) return _players.ToList();
    }

    /// <summary>
    /// 主动移除指定玩家（用于房客优雅退出时的即时通知，无需等待连接断开或心跳超时）。
    /// </summary>
    public void RemovePlayer(string machineId) => OnClientDisconnected(machineId);

    private void NotifyPlayersChanged()
    {
        PlayersChanged?.Invoke(GetPlayers());
    }

    /// <summary>
    /// 关闭房间：停止 TCP 服务器并清理本实例启动的 EasyTier 进程树。
    /// </summary>
    public async Task CloseAsync(CancellationToken ct = default)
    {
        _tcpServer?.Stop();
        await _easyTier.StopAsync(ct);
        _logger.LogInformation("联机中心已关闭，房间码: {Code}", RoomCode.Raw);
    }

    public void Dispose()
    {
        _tcpServer?.Dispose();
        _easyTier.Dispose();
    }
}
