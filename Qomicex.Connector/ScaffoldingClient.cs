using Microsoft.Extensions.Logging;
using Qomicex.Connector.Center;
using Qomicex.Connector.Core;
using Qomicex.Connector.Guest;
using Qomicex.Connector.Models;
using Qomicex.Connector.Protocols;

namespace Qomicex.Connector;

public class ScaffoldingClient : IDisposable
{
    private readonly string? _easyTierPath;
    private readonly ILoggerFactory _loggerFactory;
    private readonly string[]? _overrideRelayNodes;
    private readonly string[]? _additionalRelayNodes;
    private readonly string? _userAgent;
    private readonly string? _preferredRegion;
    private string[]? _cachedRelayNodes;
    private readonly List<IDisposable> _managedResources = [];

    public ScaffoldingClient(
        string? easyTierPath = null,
        ILoggerFactory? loggerFactory = null,
        IEnumerable<string>? relayNodes = null,
        IEnumerable<string>? additionalRelayNodes = null,
        string? userAgent = null,
        string? preferredRegion = null)
    {
        _easyTierPath = easyTierPath;
        _loggerFactory = loggerFactory ?? Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance;
        _overrideRelayNodes = relayNodes?.ToArray();
        _additionalRelayNodes = additionalRelayNodes?.ToArray();
        _userAgent = userAgent;
        _preferredRegion = preferredRegion;
    }

    private async Task<string[]> ResolveRelayNodesAsync(CancellationToken ct)
    {
        if (_cachedRelayNodes is not null)
            return _cachedRelayNodes;

        if (_overrideRelayNodes is not null)
        {
            _cachedRelayNodes = RelayNodes.Resolve(_overrideRelayNodes, _additionalRelayNodes);
            return _cachedRelayNodes;
        }

        var provider = new RelayNodeProvider(_userAgent, _preferredRegion, _loggerFactory.CreateLogger<RelayNodeProvider>());
        var fetched = await provider.FetchAsync(ct);
        _cachedRelayNodes = RelayNodes.Resolve(fetched, _additionalRelayNodes);
        return _cachedRelayNodes;
    }

    public async Task<ScaffoldingCenter> CreateRoomAsync(
        string playerName,
        string machineId,
        string vendor,
        int minecraftPort,
        IEnumerable<IProtocol>? customProtocols = null,
        CancellationToken ct = default)
    {
        var logger = _loggerFactory.CreateLogger<ScaffoldingCenter>();
        var easyTierLogger = _loggerFactory.CreateLogger<EasyTierManager>();
        var roomCode = RoomCode.Generate();

        logger.LogInformation("创建房间: 端口 {Port}", minecraftPort);

        var easyTier = new EasyTierManager(easyTierLogger);
        _managedResources.Add(easyTier);

        var relayNodes = await ResolveRelayNodesAsync(ct);

        var center = new ScaffoldingCenter(
            roomCode, playerName, machineId, vendor, minecraftPort, easyTier, _easyTierPath, logger,
            customProtocols?.ToList(), relayNodes);

        _managedResources.Add(center);
        await center.StartAsync(ct);

        logger.LogInformation("房间创建成功，房间码: {Code}", roomCode.Raw);
        return center;
    }

    public async Task<ScaffoldingGuest> JoinRoomAsync(
        string roomCode,
        string playerName,
        string machineId,
        string vendor,
        IEnumerable<string>? customProtocolKeys = null,
        CancellationToken ct = default)
    {
        var logger = _loggerFactory.CreateLogger<ScaffoldingGuest>();
        var easyTierLogger = _loggerFactory.CreateLogger<EasyTierManager>();
        var discoveryLogger = _loggerFactory.CreateLogger<CenterDiscoveryService>();
        var tcpLogger = _loggerFactory.CreateLogger<Guest.TcpClient>();

        var code = RoomCode.Parse(roomCode);
        logger.LogInformation("加入房间: {Code}", code.Raw);

        var easyTier = new EasyTierManager(easyTierLogger);
        _managedResources.Add(easyTier);

        var discovery = new CenterDiscoveryService(discoveryLogger);
        var tcpClient = new Guest.TcpClient(tcpLogger);

        var relayNodes = await ResolveRelayNodesAsync(ct);

        var guest = new ScaffoldingGuest(
            playerName, machineId, vendor, easyTier, _easyTierPath, discovery, tcpClient, logger,
            customProtocolKeys?.ToList(), relayNodes);

        _managedResources.Add(guest);
        _managedResources.Add(tcpClient);

        await guest.ConnectAsync(code, ct);
        logger.LogInformation("成功加入房间");
        return guest;
    }

    /// <summary>
    /// 优雅关闭本客户端创建的全部房间/连接：Host 关闭房间、Guest 退出房间，
    /// 并清理各自启动的 EasyTier 进程树（不影响其它进程）。
    /// </summary>
    public async Task CloseAsync(CancellationToken ct = default)
    {
        foreach (var resource in _managedResources)
        {
            switch (resource)
            {
                case ScaffoldingCenter center:
                    await center.CloseAsync(ct);
                    break;
                case ScaffoldingGuest guest:
                    await guest.LeaveAsync(ct);
                    break;
                default:
                    resource.Dispose();
                    break;
            }
        }
        _managedResources.Clear();
    }

    public void Dispose()
    {
        foreach (var resource in _managedResources)
            resource.Dispose();
        _managedResources.Clear();
        GC.SuppressFinalize(this);
    }
}
