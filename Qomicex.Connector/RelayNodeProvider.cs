using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Qomicex.Connector;

public class RelayNodeProvider
{
    public const string Endpoint = "https://nodes.qomicex.top/api/nodes";
    public const string DefaultUserAgent = "Qomicex.Connector/1.0";

    private static readonly HttpClient SharedClient = new() { Timeout = TimeSpan.FromSeconds(10) };

    private readonly HttpClient _http;
    private readonly string _userAgent;
    private readonly string? _preferredRegion;
    private readonly ILogger<RelayNodeProvider>? _logger;

    public RelayNodeProvider(
        string? userAgent = null,
        string? preferredRegion = null,
        ILogger<RelayNodeProvider>? logger = null,
        HttpMessageHandler? handler = null)
    {
        _userAgent = string.IsNullOrWhiteSpace(userAgent) ? DefaultUserAgent : userAgent;
        _preferredRegion = preferredRegion ?? DetectSystemRegion();
        _logger = logger;
        _http = handler is null ? SharedClient : new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
    }

    private static string DetectSystemRegion()
    {
        try
        {
            return RegionInfo.CurrentRegion.TwoLetterISORegionName;
        }
        catch
        {
            return "CN";
        }
    }

    public async Task<string[]> FetchAsync(CancellationToken ct = default)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, Endpoint);
            request.Headers.TryAddWithoutValidation("User-Agent", _userAgent);

            using var response = await _http.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync(ct);
            var nodes = ParseNodes(json, _preferredRegion);
            nodes = await ResolveHttpNodesAsync(nodes, ct);
            if (nodes.Length > 0)
            {
                _logger?.LogInformation("已从节点服务获取 {Count} 个中继节点", nodes.Length);
                return nodes;
            }

            _logger?.LogWarning("节点服务返回空列表，回退到内置默认节点");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex, "获取中继节点失败，回退到内置默认节点");
        }

        return RelayNodes.Default.ToArray();
    }

    private async Task<string[]> ResolveHttpNodesAsync(string[] nodes, CancellationToken ct)
    {
        var resolved = new List<string>();
        foreach (var node in nodes)
        {
            if (node.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                || node.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                var actual = await ResolveSingleNodeAsync(node, ct);
                if (actual is not null)
                    resolved.Add(actual);
            }
            else
            {
                resolved.Add(node);
            }
        }
        return resolved.ToArray();
    }

    private async Task<string?> ResolveSingleNodeAsync(string nodeUrl, CancellationToken ct)
    {
        try
        {
            var result = await _http.GetStringAsync(nodeUrl, ct);
            if (!string.IsNullOrWhiteSpace(result))
                return result.Trim();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex, "解析节点 {Url} 失败，已跳过", nodeUrl);
        }

        return null;
    }

    public static string[] ParseNodes(string json, string? preferredRegion = null)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return [];

            var preferred = new List<string>();
            var rest = new List<string>();
            foreach (var element in doc.RootElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.Object
                    || !element.TryGetProperty("url", out var url)
                    || url.ValueKind != JsonValueKind.String
                    || string.IsNullOrWhiteSpace(url.GetString()))
                {
                    continue;
                }

                var region = element.TryGetProperty("region", out var r) && r.ValueKind == JsonValueKind.String
                    ? r.GetString()
                    : null;

                var isPreferred = preferredRegion is not null
                    && string.Equals(region, preferredRegion, StringComparison.OrdinalIgnoreCase);
                (isPreferred ? preferred : rest).Add(url.GetString()!);
            }

            preferred.AddRange(rest);
            return preferred.ToArray();
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
