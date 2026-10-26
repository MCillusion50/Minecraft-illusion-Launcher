using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using Qomicex.Connector.Core;
using Qomicex.Connector.Models;

namespace Qomicex.Connector.Guest;

public class TcpClient : IDisposable
{
    private readonly ILogger<TcpClient> _logger;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private System.Net.Sockets.TcpClient? _client;
    private NetworkStream? _stream;

    public bool IsConnected => _client?.Connected == true;

    public TcpClient(ILogger<TcpClient> logger)
    {
        _logger = logger;
    }

    public async Task ConnectAsync(string host, int port, CancellationToken ct = default)
    {
        _client = new System.Net.Sockets.TcpClient();
        await _client.ConnectAsync(host, port, ct);
        _stream = _client.GetStream();
        _stream.ReadTimeout = 15000;
        _logger.LogInformation("已连接到中心: {Host}:{Port}", host, port);
    }

    public async Task<ProtocolResponse> SendAsync(ProtocolRequest request, CancellationToken ct = default)
    {
        if (_stream is null)
            throw new CenterConnectionException("未连接到联机中心");

        _logger.LogInformation("发送: {Key}, {N} 字节", $"{request.Namespace}:{request.RequestType}", request.Body.Length);

        await _sendLock.WaitAsync(ct);
        try
        {
            var requestBytes = ProtocolSerializer.SerializeRequest(request);
            _logger.LogDebug("发送原始数据: {Len} 字节", requestBytes.Length);
            await _stream.WriteAsync(requestBytes, ct);
            await _stream.FlushAsync(ct);

            var response = ProtocolSerializer.DeserializeResponse(_stream);
            if (!response.IsSuccess)
            {
                _logger.LogWarning("请求 {Key} 返回错误状态: {Status}",
                    $"{request.Namespace}:{request.RequestType}", response.Status);
            }
            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "TCP 发送/接收失败: {Key}", $"{request.Namespace}:{request.RequestType}");
            throw;
        }
        finally
        {
            _sendLock.Release();
        }
    }

    public void Disconnect()
    {
        _stream?.Dispose();
        _client?.Dispose();
        _logger.LogInformation("已断开连接");
    }

    public void Dispose()
    {
        Disconnect();
        _sendLock.Dispose();
        GC.SuppressFinalize(this);
    }
}
