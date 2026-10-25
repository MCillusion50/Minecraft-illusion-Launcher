using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Qomicex.Connector;
using Qomicex.Connector.Center;
using Qomicex.Connector.Guest;
using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    public sealed partial class MainWindow
    {
        private ScaffoldingClient? _scaffoldingClient;
        private ScaffoldingCenter? _currentCenter;
        private ScaffoldingGuest? _currentGuest;

        // 简易 ILogger：把库日志转发到 Debug 输出
        private class DebugLoggerProvider : ILoggerProvider
        {
            public ILogger CreateLogger(string categoryName) => new DebugLogger(categoryName);
            public void Dispose() { }

            private class DebugLogger : ILogger
            {
                private readonly string _category;
                public DebugLogger(string category) { _category = category; }
                public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
                public bool IsEnabled(LogLevel logLevel) => true;
                public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
                    Exception? exception, Func<TState, Exception?, string> formatter)
                {
                    var msg = formatter(state, exception);
                    Debug.WriteLine($"[{_category}] {logLevel}: {msg}");
                    if (exception != null) Debug.WriteLine($"[{_category}] 异常：{exception}");
                }
            }
        }

        private static string GetMachineIdPath()
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                ".illusionlauncher");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "machine-id.txt");
        }

        private string GetOrCreateMachineId()
        {
            var path = GetMachineIdPath();
            try
            {
                if (File.Exists(path))
                {
                    var existing = File.ReadAllText(path).Trim();
                    if (existing.Length == 32) return existing;
                }
            }
            catch { }

            var id = Guid.NewGuid().ToString("N"); // 32 位 hex，无横线
            try { File.WriteAllText(path, id); } catch { }
            return id;
        }

        private ScaffoldingClient GetOrCreateScaffoldingClient()
        {
            if (_scaffoldingClient != null) return _scaffoldingClient;

            var loggerFactory = LoggerFactory.Create(b =>
            {
                b.SetMinimumLevel(LogLevel.Debug);
                b.AddProvider(new DebugLoggerProvider());
            });

            // EasyTier 路径：csproj 会把 EasyTier\ 拷到输出目录，直接拿 BaseDirectory
            string easyTierPath = Path.Combine(AppContext.BaseDirectory, "EasyTier", "easytier-core.exe");
            Debug.WriteLine($"[Online] EasyTier 路径 = {easyTierPath}，存在={File.Exists(easyTierPath)}");

            _scaffoldingClient = new ScaffoldingClient(
                easyTierPath: easyTierPath,
                loggerFactory: loggerFactory,
                userAgent: "Minecraft-illusion-Launcher/1.0.0");

            return _scaffoldingClient;
        }

        // ============ 建房 ============
        private async Task CreateRoomAsync(CoreWebView2 sender, string playerName, int minecraftPort)
        {
            try
            {
                if (_currentCenter != null)
                {
                    await SendCreateRoomResult(sender, false, null, "已有房间在运行");
                    return;
                }
                if (_currentGuest != null)
                {
                    await SendCreateRoomResult(sender, false, null, "正在加入别人的房间，请先断开");
                    return;
                }

                Debug.WriteLine($"[Online] 建房：player={playerName}, port={minecraftPort}");

                var client = GetOrCreateScaffoldingClient();
                var machineId = GetOrCreateMachineId();

                var center = await client.CreateRoomAsync(
                    playerName: playerName,
                    machineId: machineId,
                    vendor: "illusionLauncher",
                    minecraftPort: minecraftPort);

                _currentCenter = center;
                var roomCode = center.RoomCode.Raw;
                Debug.WriteLine($"[Online]  建房成功：{roomCode}");
                await SendCreateRoomResult(sender, true, roomCode, null);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Online]  建房失败：{ex}");
                await SendCreateRoomResult(sender, false, null, ex.Message);
            }
        }

        // ============ 关房 ============
        private async Task CloseRoomAsync(CoreWebView2 sender)
        {
            try
            {
                var center = _currentCenter;
                _currentCenter = null;

                if (center != null)
                {
                    // ⭐ 后台线程关，UI 立刻回 idle
                    _ = Task.Run(async () =>
                    {
                        try { await center.CloseAsync(); }
                        catch (Exception ex) { Debug.WriteLine($"[Online] 关房后台异常：{ex.Message}"); }
                    });
                }

                // ⭐ UI 立刻响应，不等 EasyTier 完全关闭
                await SendCloseRoomResult(sender);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Online] 关房失败：{ex}");
                await SendCloseRoomResult(sender);
            }
        }

        // ============ 加房 ============
        private async Task JoinRoomAsync(CoreWebView2 sender, string playerName, string roomCode)
        {
            try
            {
                if (_currentCenter != null)
                {
                    await SendJoinRoomResult(sender, false, null, "你是房主，请先关闭房间");
                    return;
                }
                if (_currentGuest != null)
                {
                    await SendJoinRoomResult(sender, false, null, "已在房间中");
                    return;
                }

                Debug.WriteLine($"[Online] 加房：player={playerName}, code={roomCode}");

                var client = GetOrCreateScaffoldingClient();
                var machineId = GetOrCreateMachineId();

                var guest = await client.JoinRoomAsync(
                    roomCode: roomCode,
                    playerName: playerName,
                    machineId: machineId,
                    vendor: "illusionLauncher");

                _currentGuest = guest;

                var (host, port) = await guest.MapMinecraftPortAsync();
                var address = $"{host}:{port}";
                Debug.WriteLine($"[Online]  加房成功：{address}");
                await SendJoinRoomResult(sender, true, address, null);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Online]  加房失败：{ex}");
                _currentGuest = null;
                await SendJoinRoomResult(sender, false, null, ex.Message);
            }
        }

        // ============ 断开 ============
        private async Task LeaveRoomAsync(CoreWebView2 sender)
        {
            try
            {
                var guest = _currentGuest;
                _currentGuest = null;

                if (guest != null)
                {
                    _ = Task.Run(async () =>
                    {
                        try { await guest.LeaveAsync(); }
                        catch (Exception ex) { Debug.WriteLine($"[Online] 断开后台异常：{ex.Message}"); }
                    });
                }

                await SendLeaveRoomResult(sender);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Online] 断开失败：{ex}");
                await SendLeaveRoomResult(sender);
            }
        }

        // ============ 回调前端 ============
        private async Task SendCreateRoomResult(CoreWebView2 sender, bool ok, string roomCode, string error)
        {
            var json = JsonSerializer.Serialize(new { ok, roomCode, error });
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onCreateRoomResult({json})"); });
        }

        private async Task SendCloseRoomResult(CoreWebView2 sender)
        {
            var json = JsonSerializer.Serialize(new { ok = true });
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onCloseRoomResult({json})"); });
        }

        private async Task SendJoinRoomResult(CoreWebView2 sender, bool ok, string address, string error)
        {
            var json = JsonSerializer.Serialize(new { ok, address, error });
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onJoinRoomResult({json})"); });
        }

        private async Task SendLeaveRoomResult(CoreWebView2 sender)
        {
            var json = JsonSerializer.Serialize(new { ok = true });
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onLeaveRoomResult({json})"); });
        }
    }
}