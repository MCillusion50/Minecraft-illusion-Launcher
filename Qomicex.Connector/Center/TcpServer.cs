using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using Qomicex.Connector.Core;
using Qomicex.Connector.Models;
using Qomicex.Connector.Protocols;

namespace Qomicex.Connector.Center;

public class TcpServer : IDisposable
{
    private int _port;
    private readonly ILogger _logger;
    private readonly Dictionary<string, IProtocol> _protocols;
    private readonly ConcurrentDictionary<string, DateTime> _lastHeartbeat = new();
    private readonly ConcurrentDictionary<string, TcpClient> _activeClients = new();
    private readonly ConcurrentDictionary<string, string> _clientIdToMachineId = new();
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;

    public bool IsRunning => _listener is not null;
    public int Port => _listener?.LocalEndpoint is IPEndPoint ep ? ep.Port : _port;

    public event Action<string?>? ClientDisconnected;

    public TcpServer(int port, ILogger logger, IReadOnlyList<IProtocol> protocols)
    {
        _port = port;
        _logger = logger;
        _protocols = protocols.ToDictionary(p => p.ProtocolKey);
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _listener = new TcpListener(IPAddress.Any, _port);
        _listener.Start();
        _logger.LogInformation("TCP 服务已启动，端口: {Port}", _port);

        _ = Task.Run(() => HeartbeatTimeoutLoop(_cts.Token), _cts.Token);

        try
        {
            while (!_cts.IsCancellationRequested)
            {
                var client = await _listener.AcceptTcpClientAsync(_cts.Token);
                _logger.LogInformation("新客户端连接: {Remote}", client.Client.RemoteEndPoint);
                _ = Task.Run(() => HandleClientAsync(client, _cts.Token), _cts.Token);
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task HandleClientAsync(System.Net.Sockets.TcpClient client, CancellationToken ct)
    {
        var stream = client.GetStream();
        var clientId = client.Client.RemoteEndPoint?.ToString() ?? "unknown";
        _activeClients[clientId] = client;

        try
        {
            while (!ct.IsCancellationRequested && client.Connected)
            {
                var request = ProtocolSerializer.DeserializeRequest(stream);
                var key = $"{request.Namespace}:{request.RequestType}";

                _logger.LogDebug("收到请求: {Key} 来自 {Client}", key, clientId);

                ProtocolResponse response;

                if (_protocols.TryGetValue(key, out var handler))
                {
                    response = await handler.HandleAsync(request, ct);
                    _logger.LogInformation("处理请求: {Key} -> 状态 {Status}", key, response.Status);
                }
                else
                {
                    var errorBody = System.Text.Encoding.UTF8.GetBytes($"未知协议: {key}");
                    response = new ProtocolResponse { Status = 255, Body = errorBody };
                }

                var responseBytes = ProtocolSerializer.SerializeResponse(response);
                await stream.WriteAsync(responseBytes, ct);

                if (key == "c:player_ping" && response.IsSuccess)
                {
                    _lastHeartbeat[clientId] = DateTime.UtcNow;
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(request.Body);
                        if (doc.RootElement.TryGetProperty("machine_id", out var mid))
                            _clientIdToMachineId[clientId] = mid.GetString() ?? "";
                    }
                    catch { }
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning("客户端 {Client} 处理异常: {Message}", clientId, ex.Message);
        }
        finally
        {
            _activeClients.TryRemove(clientId, out _);
            _lastHeartbeat.TryRemove(clientId, out _);
            _clientIdToMachineId.TryRemove(clientId, out var machineId);
            ClientDisconnected?.Invoke(machineId);
            client.Dispose();
        }
    }

    private async Task HeartbeatTimeoutLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
            var now = DateTime.UtcNow;
            var timedOut = _lastHeartbeat
                .Where(kvp => (now - kvp.Value).TotalSeconds > 15)
                .Select(kvp => kvp.Key)
                .ToList();

            foreach (var id in timedOut)
            {
                _logger.LogWarning("客户端 {Client} 心跳超时，断开连接", id);
                _lastHeartbeat.TryRemove(id, out _);
                if (_activeClients.TryRemove(id, out var timedOutClient))
                {
                    try { timedOutClient.Close(); } catch { }
                    timedOutClient.Dispose();
                }
                _clientIdToMachineId.TryRemove(id, out var machineId);
                ClientDisconnected?.Invoke(machineId);
            }
        }
    }

    public void Stop()
    {
        try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
        _listener?.Stop();
        foreach (var kvp in _activeClients)
        {
            try { kvp.Value.Close(); } catch { }
        }
        _activeClients.Clear();
        _logger.LogInformation("TCP 服务已停止");
    }

    public void Dispose()
    {
        Stop();
        try { _cts?.Dispose(); } catch (ObjectDisposedException) { }
        GC.SuppressFinalize(this);
    }
}
