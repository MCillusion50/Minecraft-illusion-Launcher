using Microsoft.Extensions.Logging;

namespace Qomicex.Connector.Core;

public class HeartbeatService : IDisposable
{
    private readonly ILogger _logger;
    private readonly Func<CancellationToken, Task> _callback;
    private readonly Action? _onFailed;
    private PeriodicTimer? _timer;
    private CancellationTokenSource? _cts;

    public HeartbeatService(ILogger logger, Func<CancellationToken, Task> callback, Action? onFailed = null)
    {
        _logger = logger;
        _callback = callback;
        _onFailed = onFailed;
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        _timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _logger.LogInformation("心跳服务已启动，间隔 5 秒");

        while (await _timer.WaitForNextTickAsync(_cts.Token))
        {
            try
            {
                await _callback(_cts.Token);
                _logger.LogDebug("心跳发送成功");
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "心跳发送异常，连接可能已断开");
                _onFailed?.Invoke();
                break;
            }
        }
    }

    public void Stop()
    {
        try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
        _timer?.Dispose();
        _logger.LogInformation("心跳服务已停止");
    }

    public void Dispose()
    {
        Stop();
        try { _cts?.Dispose(); } catch (ObjectDisposedException) { }
        GC.SuppressFinalize(this);
    }
}
