using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Qomicex.Connector.Models;

namespace Qomicex.Connector.Core;

public record CenterDiscoveryResult(string VirtualIp, int Port);

public class CenterDiscoveryService
{
    private readonly ILogger<CenterDiscoveryService> _logger;
    private static readonly Regex HostnamePattern = new(@"^scaffolding-mc-server-(\d+)$");

    public CenterDiscoveryService(ILogger<CenterDiscoveryService> logger)
    {
        _logger = logger;
    }

    public async Task<CenterDiscoveryResult> DiscoverAsync(EasyTierManager easyTier, CancellationToken ct = default)
    {
        for (int i = 0; i < 60; i++)
        {
            var nodes = await easyTier.GetNodesAsync(ct);
            _logger.LogDebug("第 {Attempt} 次扫描, 发现 {Count} 个节点: {Nodes}",
                i + 1, nodes.Count,
                string.Join(", ", nodes.Select(n => $"{n.VirtualIp}/{n.Hostname}")));
            var result = TryParseCenter(nodes);
            if (result is not null)
            {
                _logger.LogInformation("发现联机中心: {Ip}:{Port}", result.VirtualIp, result.Port);
                return result;
            }
            await Task.Delay(500, ct);
        }

        throw new CenterNotFoundException("未在 EasyTier 网络中发现联机中心（超时 30s）");
    }

    public static CenterDiscoveryResult? TryParseCenter(IReadOnlyList<EasyTierNode> nodes)
    {
        foreach (var node in nodes)
        {
            var match = HostnamePattern.Match(node.Hostname);
            if (!match.Success) continue;

            if (int.TryParse(match.Groups[1].Value, out var port) && port > 1024 && port <= 65535)
            {
                return new CenterDiscoveryResult(node.VirtualIp, port);
            }
        }
        return null;
    }
}
