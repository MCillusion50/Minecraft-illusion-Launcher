using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Qomicex.Connector.Models;

namespace Qomicex.Connector;

public class EasyTierManager : IDisposable
{
    private readonly ILogger<EasyTierManager> _logger;
    private Process? _process;
    private TaskCompletionSource _startupTcs = new();
    private readonly List<string> _outputLines = [];
    private readonly object _lock = new();
    private string? _easyTierDir;

    public bool IsRunning => _process?.HasExited == false;
    public string? VirtualIp { get; private set; }
    public string? NodeId { get; private set; }
    public string? InstanceId { get; private set; }

    /// <summary>找不到 easytier-cli.exe —— 没有它就无法枚举对端主机名，加房必然失败。</summary>
    public bool CliMissing => FindCli() is null;

    public EasyTierManager(ILogger<EasyTierManager> logger)
    {
        _logger = logger;
    }

    public Task StartAsync(NetworkConfig config, CancellationToken ct = default)
    {
        if (IsRunning)
            throw new EasyTierStartException("EasyTier 已在运行中");

        _startupTcs = new TaskCompletionSource();
        lock (_lock) _outputLines.Clear();
        VirtualIp = null;
        NodeId = null;

        var easyTierPath = config.EasyTierPath ?? FindEasyTier();
        _easyTierDir = Path.GetDirectoryName(easyTierPath);

        // 动态获取中继节点后再启动
        return StartWithNodesAsync(easyTierPath, config, ct);
    }

    private async Task StartWithNodesAsync(string easyTierPath, NetworkConfig config, CancellationToken ct)
    {
        // 动态解析中继节点（RelayNodes.Default 里是 HTTP URL，必须换成 tcp://ip:port 才能给 -p 用）
        var relayNodes = config.RelayNodes;
        if (relayNodes == null || relayNodes.Length == 0)
        {
            try
            {
                var provider = new RelayNodeProvider(logger: Microsoft.Extensions.Logging.Abstractions.NullLogger<RelayNodeProvider>.Instance);
                relayNodes = await provider.FetchAsync(ct);
                _logger.LogInformation("动态中继节点: {Count} 个", relayNodes == null ? 0 : relayNodes.Length);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "获取动态中继节点失败，回退默认列表");
            }
        }
        if (relayNodes == null || relayNodes.Length == 0)
            relayNodes = RelayNodes.Default.ToArray();
        var args = BuildArgs(config, relayNodes);

        _logger.LogInformation("启动 EasyTier: {Path} {Args}", easyTierPath, args);

        _process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = easyTierPath,
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            },
            EnableRaisingEvents = true
        };

        _process.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            lock (_lock) _outputLines.Add(e.Data);
            _logger.LogDebug("ET: {Message}", e.Data);
            TryParseOutputLine(e.Data);
        };

        _process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            lock (_lock) _outputLines.Add(e.Data);
            _logger.LogDebug("ET: {Message}", e.Data);
            TryParseOutputLine(e.Data);
        };

        _process.Exited += (_, _) =>
        {
            _logger.LogWarning("EasyTier 进程已退出，代码: {ExitCode}", _process.ExitCode);
            if (!_startupTcs.Task.IsCompleted)
            {
                _startupTcs.TrySetException(
                    new EasyTierStartException($"EasyTier 异常退出，代码: {_process.ExitCode}"));
            }
        };

        _process.Start();
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();

        await WaitForStartupAsync(ct);
    }

    private async Task WaitForStartupAsync(CancellationToken ct)
    {
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        try
        {
            await _startupTcs.Task.WaitAsync(linkedCts.Token);
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            throw new EasyTierTimeoutException("EasyTier 启动超时 (30s)");
        }

        await Task.Delay(2000, ct);
    }

    private void TryParseOutputLine(string line)
    {
        var ipMatch = Regex.Match(line, @"virtual_ip[""\s:=]+(\d+\.\d+\.\d+\.\d+)", RegexOptions.IgnoreCase);
        if (ipMatch.Success && VirtualIp is null)
        {
            VirtualIp = ipMatch.Groups[1].Value;
            _logger.LogDebug("解析到虚拟 IP: {Ip}", VirtualIp);
        }

        var idMatch = Regex.Match(line, @"node_id[""\s:=]+(\d+)", RegexOptions.IgnoreCase);
        if (idMatch.Success && NodeId is null)
        {
            NodeId = idMatch.Groups[1].Value;
        }

        var instanceMatch = Regex.Match(line, @"instance_id[""\s:=]+([a-f0-9-]+)", RegexOptions.IgnoreCase);
        if (instanceMatch.Success && InstanceId is null)
        {
            InstanceId = instanceMatch.Groups[1].Value;
        }

        if (line.Contains("listener added", StringComparison.OrdinalIgnoreCase)
            || line.Contains("Starting easytier", StringComparison.OrdinalIgnoreCase))
        {
            _startupTcs.TrySetResult();
        }
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        if (_process is null) return;

        try
        {
            if (!_process.HasExited)
            {
                _logger.LogInformation("停止 EasyTier...");
                _process.Kill(true);
                await _process.WaitForExitAsync(ct);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "停止 EasyTier 时异常");
            try { if (!_process.HasExited) _process.Kill(); } catch { }
        }
        finally
        {
            VirtualIp = null;
            NodeId = null;
        }
    }

    public Task<IReadOnlyList<EasyTierNode>> GetNodesAsync(CancellationToken ct = default)
    {
        var cliNodes = TryGetNodesViaCli();
        if (cliNodes is { Count: > 0 }) return Task.FromResult<IReadOnlyList<EasyTierNode>>(cliNodes);

        var nodes = new List<EasyTierNode>();
        lock (_lock)
        {
            foreach (var line in _outputLines)
            {
                var match = Regex.Match(line, @"ip[=:]\s*([\d.]+)\b.*?(?:hostname|host)[=:]\s*(\S+)", RegexOptions.IgnoreCase);
                if (match.Success)
                {
                    var nodeIdMatch = Regex.Match(line, @"(?:id|node_id)[=:]\s*(\d+)", RegexOptions.IgnoreCase);
                    nodes.Add(new EasyTierNode
                    {
                        VirtualIp = match.Groups[1].Value,
                        Hostname = match.Groups[2].Value,
                        NodeId = nodeIdMatch.Success ? nodeIdMatch.Groups[1].Value : ""
                    });
                }
            }
        }
        return Task.FromResult<IReadOnlyList<EasyTierNode>>(nodes);
    }

    private bool _cliMissingLogged;

    private IReadOnlyList<EasyTierNode>? TryGetNodesViaCli()
    {
        try
        {
            var cliPath = FindCli();
            if (cliPath is null)
            {
                if (!_cliMissingLogged)
                {
                    _cliMissingLogged = true;
                    _logger.LogWarning("未找到 easytier-cli.exe，无法枚举对端节点（加房会一直发现不了联机中心）");
                }
                return null;
            }

            // 用 -o json peer：表格输出靠列位置 + 竖线切分，EasyTier 升级改了列顺序就废；
            // JSON 里直接有 ipv4 / hostname 字段，稳得多。
            var proc = Process.Start(new ProcessStartInfo
            {
                FileName = cliPath,
                Arguments = "-o json peer",
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });

            if (proc is null) return null;
            using (proc)
            {
                var readTask = proc.StandardOutput.ReadToEndAsync();
                if (!proc.WaitForExit(5000))
                {
                    try { proc.Kill(true); } catch { }
                    return null;
                }
                if (proc.ExitCode != 0) return null;

                var json = readTask.GetAwaiter().GetResult();
                if (string.IsNullOrWhiteSpace(json)) return null;

                var nodes = new List<EasyTierNode>();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;

                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    if (el.ValueKind != JsonValueKind.Object) continue;

                    var ip = el.TryGetProperty("ipv4", out var ipEl) ? ipEl.GetString() : null;
                    if (string.IsNullOrWhiteSpace(ip) && el.TryGetProperty("cidr", out var cidrEl))
                        ip = cidrEl.GetString()?.Split('/')[0];
                    if (string.IsNullOrWhiteSpace(ip) || !System.Net.IPAddress.TryParse(ip, out _))
                        continue;

                    var hostname = el.TryGetProperty("hostname", out var hEl) ? hEl.GetString() : null;
                    if (string.IsNullOrWhiteSpace(hostname)) continue;

                    var nodeId = "";
                    if (el.TryGetProperty("id", out var idEl))
                        nodeId = idEl.ValueKind == JsonValueKind.Number ? idEl.GetRawText() : (idEl.GetString() ?? "");

                    nodes.Add(new EasyTierNode { VirtualIp = ip!, Hostname = hostname!, NodeId = nodeId });
                }

                return nodes;
            }
        }
        catch
        {
            return null;
        }
    }
    private string? FindCli()
    {
        var cliName = OperatingSystem.IsWindows() ? "easytier-cli.exe" : "easytier-cli";

        if (_easyTierDir is not null)
        {
            var path = Path.Combine(_easyTierDir, cliName);
            if (File.Exists(path)) return path;
        }

        return FindExecutable(cliName);
    }

    private static string BuildArgs(NetworkConfig config, string[] relayNodes)
    {
        var args = $"--network-name \"{config.NetworkName}\" --network-secret \"{config.NetworkSecret}\" --hostname \"{config.Hostname}\"";
        if (config.NoTun) args += " --no-tun";
        if (config.UseSmoltcp) args += " --use-smoltcp";
        if (config.Ipv4 is not null)
            args += $" --ipv4 {config.Ipv4}";
        else if (config.Dhcp)
            args += " --dhcp";
        if (config.ListenRandomPorts)
            args += " -l tcp://0.0.0.0:0 -l udp://0.0.0.0:0";
        args += " --compression=zstd --multi-thread --latency-first --enable-kcp-proxy --tcp-whitelist=0 --udp-whitelist=0";
        foreach (var node in relayNodes)
            args += $" -p {node}";
        foreach (var port in config.TcpWhitelist)
            args += $" --tcp-whitelist={port}";
        foreach (var pf in config.PortForwards)
            args += $" --port-forward {pf}";
        return args;
    }

    private static string FindEasyTier()
    {
        var name = OperatingSystem.IsWindows() ? "easytier-core.exe" : "easytier-core";
        return FindExecutable(name) ?? throw new EasyTierStartException(
            "未找到 easyTier-core 可执行文件。");
    }

    private static string? FindExecutable(string name)
    {
        // 1. 程序所在目录
        var appDir = AppContext.BaseDirectory;
        if (appDir is not null)
        {
            var appPath = Path.Combine(appDir, name);
            if (File.Exists(appPath)) return appPath;
        }

        // 2. 当前工作目录
        var local = Path.GetFullPath(name);
        if (File.Exists(local)) return local;

        // 3. PATH 环境变量
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (pathEnv is not null)
        {
            foreach (var dir in pathEnv.Split(Path.PathSeparator))
            {
                var full = Path.Combine(dir, name);
                if (File.Exists(full)) return full;
            }
        }

        return null;
    }

    public void Dispose()
    {
        try
        {
            if (_process is { HasExited: false })
            {
                try { _process.Kill(); } catch { }
            }
        }
        catch { }
        _process?.Dispose();
        GC.SuppressFinalize(this);
    }
}
