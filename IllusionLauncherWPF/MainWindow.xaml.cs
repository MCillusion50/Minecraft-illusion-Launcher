using IllusionLauncherWPF;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using ProjBobcat;
using ProjBobcat.Class.Model;
using ProjBobcat.Class.Model.Downloading;
using ProjBobcat.DefaultComponent;
using ProjBobcat.DefaultComponent.ResourceInfoResolver;
using ProjBobcat.Interface;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using DragEventArgs = System.Windows.DragEventArgs;
using File = System.IO.File;
using FileInfo = System.IO.FileInfo;

namespace IllusionLauncherWPF
{
    public class VersionConfig
    {
        [JsonPropertyName("maxMemoryMB")] public int? MaxMemoryMB { get; set; } = null;
        [JsonPropertyName("minMemoryMB")] public int? MinMemoryMB { get; set; } = null;
        [JsonPropertyName("jvmArgs")] public string JvmArgs { get; set; } = "";
        [JsonPropertyName("gameArgs")] public string GameArgs { get; set; } = "";
        [JsonPropertyName("preLaunchCommand")] public string PreLaunchCommand { get; set; } = "";
        [JsonPropertyName("javaPath")] public string JavaPath { get; set; } = "";
        [JsonPropertyName("memoryPreset")] public string MemoryPreset { get; set; } = "";
        [JsonPropertyName("disableVulkan")] public bool? DisableVulkan { get; set; } = null;
        [JsonPropertyName("useHighPerformanceGpu")] public bool? UseHighPerformanceGpu { get; set; } = null;
    }

    public class GlobalConfig
    {
        [JsonPropertyName("maxMemoryMB")] public int MaxMemoryMB { get; set; } = 4096;
        [JsonPropertyName("minMemoryMB")] public int MinMemoryMB { get; set; } = 512;
        /// <summary>自动配置内存（对标 PCL）：true 时由前端按物理内存自动计算 MaxMemoryMB</summary>
        [JsonPropertyName("autoMemory")] public bool AutoMemory { get; set; } = true;
        [JsonPropertyName("gameArgs")] public string GameArgs { get; set; } = "";
        [JsonPropertyName("jvmArgs")] public string JvmArgs { get; set; } = "-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+ParallelRefProcEnabled -XX:+DisableExplicitGC -XX:+AlwaysPreTouch";
        [JsonPropertyName("memoryPreset")] public string MemoryPreset { get; set; } = "g1gc";
        [JsonPropertyName("disableVulkan")] public bool DisableVulkan { get; set; } = false;
        [JsonPropertyName("useHighPerformanceGpu")] public bool UseHighPerformanceGpu { get; set; } = true;
        [JsonPropertyName("javaPath")] public string JavaPath { get; set; } = "";
        [JsonPropertyName("gamePath")] public string GamePath { get; set; } = "";
        public string JavaDir { get; set; } = "";
        [JsonPropertyName("backgroundPath")] public string BackgroundPath { get; set; } = "";
        [JsonPropertyName("curseForgeApiKey")] public string CurseForgeApiKey { get; set; } = "";
    }



    public sealed partial class MainWindow : System.Windows.Window
    {
      
        private IntPtr _hwnd;

        private string _currentLaunchPlayerName = "Player";

        private string _currentLaunchVersionId = "";

        private CapsuleWindow _currentCapsule = null; // 记录当前的灵动岛窗口

        private SubclassProc _webViewSubclassProc;
        private IntPtr _webViewChromeHwnd = IntPtr.Zero;
        private HttpClient _http;
        private GlobalConfig _global = new GlobalConfig();

       

     

        

        [DllImport("comctl32.dll", SetLastError = true)]
        private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass, IntPtr dwRefData);

        [DllImport("comctl32.dll")]
        private static extern IntPtr DefSubclassProc(IntPtr hWnd, int uMsg, IntPtr wParam, IntPtr lParam);

        private delegate IntPtr SubclassProc(IntPtr hWnd, int uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, IntPtr dwRefData);


        [DllImport("user32.dll")]


        private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
        private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);


        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        [DllImport("user32.dll")] private static extern int SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr GetSystemMenu(IntPtr hWnd, bool bRevert);
        [DllImport("user32.dll")]
        private static extern bool DeleteMenu(IntPtr hMenu, uint uPosition, uint uFlags);

        private const uint SC_CLOSE = 0xF060;
        private const uint SC_MINIMIZE = 0xF020;
        private const uint SC_MAXIMIZE = 0xF030;
        private const uint SC_RESTORE = 0xF120;

        private DateTime _lastDownloadReportTime = DateTime.MinValue;
        private const int GWL_STYLE = -16;
        private const int GWL_EXSTYLE = -20;
        private const int WS_SYSMENU = 0x00080000;
        private const int WS_CAPTION = 0x00C00000;
        private const int WS_BORDER = 0x00800000;
        private const int WS_MINIMIZEBOX = 0x00020000;
        private const int WS_MAXIMIZEBOX = 0x00010000;
        private const int WS_EX_LAYERED = 0x00080000;
        private const int SWP_FRAMECHANGED = 0x0020;
        private const int SWP_NOMOVE = 0x0002;
        private const int SWP_NOSIZE = 0x0001;
        private const int SWP_NOZORDER = 0x0004;
        private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        private const int DWMWCP_ROUND = 2;
        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 0x2;
        private const int LWA_ALPHA = 0x2;

        private int _scanVersion = 0;

        // 补全网速统计
        private static long _totalBytesDownloaded = 0;
        private static int _http11LogCount = 0; // ⭐ 只打印前 3 次协议协商结果，避免刷屏
        private static DateTime _speedWindowStart = DateTime.Now;
        private static long _speedWindowBytes = 0;
        private VersionConfig? _currentVersionCfg = null;
        private string _currentAccessToken = "null";

        private string _currentLaunchingUsername = "";
        private string _currentLaunchingVersion = "";
        private Process? _lastProcess = null;
        private volatile bool _shouldMinimize = false;

        private volatile bool _isCancelled = false;

        // ⭐ 终极优雅锁：支持异步等待，绝不死锁
        private volatile int _downloadLock = 0;
        private CancellationTokenSource? _launchCts = null;
        private bool _animating = false;
      
        private bool _animIn = false;
        private static int _renderCount = 0;
        private bool _closing = false;
        private bool _maximizing = false;
        private double _animT = 0;
        private DateTime _animStartTime;
        private const int AnimDurationMs = 1;
        private bool _webViewReady = false;

        private CancellationTokenSource? _bgRepairCts = null;

        private DateTime _lastAssetReport = DateTime.MinValue;
        private DateTime _lastLibReport = DateTime.MinValue;

        private const bool DOWNLOAD_ASSETS = true;
        private const int ASSET_CONCURRENCY = 16;
        private const int LIB_CONCURRENCY = 16;
        private const int PARALLEL_THRESHOLD = 5 * 1024 * 1024;
        private const int PARALLEL_SEGMENTS = 16;

        private static readonly SemaphoreSlim _httpGate = new SemaphoreSlim(160, 160);
        private static readonly SemaphoreSlim _modpackInstallLock = new SemaphoreSlim(1, 1);

        private static readonly string[] MC_MIRRORS = new[]
 {
    // — BMCLAPI 官方节点 —
    "bmclapi2.bangbang93.com",
    "openbmclapi.bangbang93.com",

    // — 高校镜像（校园网联合镜像站，Maven/Assets 专用）—
    "mirrors.qlu.edu.cn/bmclapi",
    "mirror.sjtu.edu.cn/bmclapi",
    "mirror.nyist.edu.cn/bmclapi",
    "mirrors.ustc.edu.cn/bmclapi",
    "mirror.nju.edu.cn/bmclapi",
    "mirror.lzu.edu.cn/bmclapi",
    "mirrors.zju.edu.cn/bmclapi",
};


        private const int WM_NCHITTEST = 0x0084;
        private const int HTTRANSPARENT = -1;

        private IntPtr WebViewSubclassProc(IntPtr hWnd, int uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, IntPtr dwRefData)
        {
            if (uMsg == WM_NCHITTEST)
            {
                int x = lParam.ToInt32() & 0xFFFF;
                int y = (lParam.ToInt32() >> 16) & 0xFFFF;
                if (x > 32767) x -= 65536;
                if (y > 32767) y -= 65536;

                var clientPoint = this.PointFromScreen(new System.Windows.Point(x, y));
                Debug.WriteLine($"[NCHITTEST] screen=({x},{y}) client=({clientPoint.X:F0},{clientPoint.Y:F0}) w={this.ActualWidth} h={this.ActualHeight}");

                double w = this.ActualWidth;
                double h = this.ActualHeight;
                const int BW = 8;

                bool left = clientPoint.X <= BW;
                bool right = clientPoint.X >= w - BW;
                bool top = clientPoint.Y <= BW;
                bool bottom = clientPoint.Y >= h - BW;

                if (left || right || top || bottom)
                {
                    Debug.WriteLine($"[NCHITTEST] → HTTRANSPARENT (L={left} R={right} T={top} B={bottom})");
                    return (IntPtr)HTTRANSPARENT;
                }
            }
            return DefSubclassProc(hWnd, uMsg, wParam, lParam);
        }


        private static bool _isOptimizing = false; // 防连点锁

        private async Task RequestAdminOptimizeAsync()
        {
            if (_isOptimizing) return;
            _isOptimizing = true;

            try
            {
                long beforeMem = NativeMemory.GetAvailableMemory();

                // 直接调用底层清理，因为 App 启动时已经处理了 UAC
                await Task.Run(() => NativeMemory.RunOptimize());

                await Task.Delay(500);
                long afterMem = NativeMemory.GetAvailableMemory();
                long freedMB = Math.Max(0, (afterMem - beforeMem) / 1024 / 1024);

                await RunOnUI(() => {
                    var json = JsonSerializer.Serialize(new { ok = true, freedMB = freedMB, nowMB = afterMem / 1024 / 1024 });
                    if (WebView?.CoreWebView2 != null)
                        _ = WebView.CoreWebView2.ExecuteScriptAsync($"window.onMemoryOptimized && window.onMemoryOptimized({json})");
                });
            }
            finally
            {
                _isOptimizing = false; // 解锁
            }
        }

        /// <summary>
        /// 后台全局补全：扫描所有版本，汇总 libraries，静默补缺失。
        /// 游戏启动 5 秒后开始，游戏退出时取消。
        /// </summary>
        private async Task BackgroundGlobalRepairAsync(CancellationToken ct)
        {
            try
            {
                await Task.Delay(5000, ct);   // 等游戏先起来
                if (ct.IsCancellationRequested) return;

                var mcDir = GetMcDir();
                var versionsDir = Path.Combine(mcDir, "versions");
                if (!Directory.Exists(versionsDir)) return;

                // ⭐ 1. 扫所有版本 JSON，汇总所需 libraries
                //    key = savePath, value = url
                var allLibs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                var libsDir = Path.Combine(mcDir, "libraries");

                foreach (var dir in Directory.GetDirectories(versionsDir))
                {
                    if (ct.IsCancellationRequested) return;
                    var name = Path.GetFileName(dir);
                    var jsonPath = Path.Combine(dir, name + ".json");
                    if (!File.Exists(jsonPath)) continue;

                    try
                    {
                        var root = JsonDocument.Parse(await File.ReadAllTextAsync(jsonPath, ct)).RootElement;

                        // 当前层 + 继承链各层的 libraries
                        var chain = new List<JsonElement> { root };
                        var current = root;
                        for (int depth = 0; depth < 5; depth++)
                        {
                            if (!current.TryGetProperty("inheritsFrom", out var inh)) break;
                            var parentId = inh.GetString();
                            if (string.IsNullOrEmpty(parentId)) break;
                            var parentJson = Path.Combine(versionsDir, parentId, parentId + ".json");
                            if (!File.Exists(parentJson)) break;
                            current = JsonDocument.Parse(await File.ReadAllTextAsync(parentJson, ct)).RootElement;
                            chain.Add(current);
                        }

                        foreach (var layer in chain)
                        {
                            if (!layer.TryGetProperty("libraries", out var libs)) continue;
                            foreach (var lib in libs.EnumerateArray())
                            {
                                if (lib.TryGetProperty("rules", out var rules))
                                    if (!IsAllowedOnWindows(rules)) continue;

                                if (!lib.TryGetProperty("downloads", out var dl)) continue;
                                if (!dl.TryGetProperty("artifact", out var artifact)) continue;

                                var url = artifact.TryGetProperty("url", out var u) ? u.GetString() : null;
                                var path = artifact.TryGetProperty("path", out var p) ? p.GetString() : null;
                                if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(path)) continue;

                                var savePath = Path.Combine(libsDir, path.Replace('/', Path.DirectorySeparatorChar));
                                if (!allLibs.ContainsKey(savePath))
                                    allLibs[savePath] = url;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"[BgRepair] 解析 {name} 失败：{ex.Message}");
                    }
                }

                // ⭐ 2. 过滤出缺失的
                var missing = allLibs.Where(kv => !File.Exists(kv.Key)).ToList();
                if (missing.Count == 0)
                {
                    Debug.WriteLine("[BgRepair] 无需补全");
                    return;
                }

                Debug.WriteLine($"[BgRepair] 后台补全 {missing.Count} 个库");
                int done = 0;
                int ok = 0, fail = 0;
                var sem = new SemaphoreSlim(2);   // ⭐ 极低并发

                var tasks = new List<Task>();
                foreach (var kv in missing)
                {
                    if (ct.IsCancellationRequested) break;
                    var savePath = kv.Key;
                    var url = kv.Value;

                    await sem.WaitAsync(ct);
                    tasks.Add(Task.Run(async () =>
                    {
                        try
                        {
                            if (ct.IsCancellationRequested) return;

                            // ⭐ 官方源优先，失败再走镜像；每个源各重试 3 次
                            bool _done = false;
                            for (int _a = 0; _a < 3 && !_done; _a++)
                            {
                                try { await DownloadFileAsync(url, savePath, null, null); _done = true; }
                                catch (OperationCanceledException) { throw; }
                                catch { }
                            }
                            if (!_done)
                            {
                                string mirrorUrl = url;
                                if (url.Contains("libraries.minecraft.net")) mirrorUrl = url.Replace("libraries.minecraft.net", "bmclapi2.bangbang93.com/maven");
                                else if (url.Contains("maven.minecraftforge.net")) mirrorUrl = url.Replace("maven.minecraftforge.net", "bmclapi2.bangbang93.com/maven");
                                else if (url.Contains("maven.neoforged.net/releases/")) mirrorUrl = url.Replace("maven.neoforged.net/releases/", "bmclapi2.bangbang93.com/maven/");
                                if (mirrorUrl != url)
                                {
                                    for (int _a = 0; _a < 3 && !_done; _a++)
                                    {
                                        try { await DownloadFileAsync(mirrorUrl, savePath, null, null); _done = true; }
                                        catch (OperationCanceledException) { throw; }
                                        catch { }
                                    }
                                }
                            }
                            if (!_done) throw new Exception("官方源与镜像均下载失败");
                            Interlocked.Increment(ref ok);
                        }
                        catch (OperationCanceledException) { }
                        catch (Exception ex)
                        {
                            Interlocked.Increment(ref fail);
                            Debug.WriteLine($"[BgRepair] 补下失败 {Path.GetFileName(savePath)}: {ex.Message}");
                        }
                        finally
                        {
                            sem.Release();
                            int d = Interlocked.Increment(ref done);
                            if (d % 20 == 0 || d == missing.Count)
                                Debug.WriteLine($"[BgRepair] 进度 {d}/{missing.Count} (ok={ok} fail={fail})");
                        }
                    }, ct));
                }

                try { await Task.WhenAll(tasks); }
                catch (OperationCanceledException) { }

                Debug.WriteLine($"[BgRepair] 完成 ok={ok} fail={fail}");
            }
            catch (OperationCanceledException)
            {
                Debug.WriteLine("[BgRepair] 已取消");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[BgRepair] 异常：{ex.Message}");
            }
        }

        private void WebView_DragOver(object sender, System.Windows.DragEventArgs e)
        {
            System.Diagnostics.Debug.WriteLine("[DragOver] 进来了");
            if (e.Data.GetDataPresent(System.Windows.DataFormats.FileDrop))
            {
                e.Effects = System.Windows.DragDropEffects.Copy;
                e.Handled = true;
            }
            else
            {
                e.Effects = System.Windows.DragDropEffects.None;
                e.Handled = true;
            }
        }

        private async Task<bool> TryEnterDownloadLock(CoreWebView2 sender)
        {
            if (Interlocked.CompareExchange(ref _downloadLock, 1, 0) != 0)
            {
                await ReportProgress(sender, 0, " 已有下载任务在进行，请等待完成");
                return false;
            }
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onDownloadBusyStart()"); });
            return true;
        }

        private async Task ExitDownloadLock(CoreWebView2 sender)
        {
            Interlocked.Exchange(ref _downloadLock, 0);
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onDownloadBusyEnd()"); });
        }

        private async void WebView_Drop(object sender, System.Windows.DragEventArgs e)
        {
            if (!e.Data.GetDataPresent(System.Windows.DataFormats.FileDrop)) return;

            var files = (string[])e.Data.GetData(System.Windows.DataFormats.FileDrop);
            if (files == null || files.Length == 0) return;

            var paths = files.Where(f => !string.IsNullOrEmpty(f)).ToList();
            if (paths.Count == 0) return;

            Debug.WriteLine($"[Drop] paths: {string.Join(", ", paths)}");

            var json = JsonSerializer.Serialize(new { action = "host_drop", paths }, JsonOpts());
            await WebView.CoreWebView2.ExecuteScriptAsync($"window.onHostDrop && window.onHostDrop({json})");
            await WebView.CoreWebView2.ExecuteScriptAsync($"window.onModpackDrop && window.onModpackDrop({json})");
        }



        public MainWindow()
        {
            this.InitializeComponent();

            // ⭐ 统一诊断日志：写到 logs\launcher_diagnose.log，并分发到 VS / UI
            try { DiagnosticLogger.Instance.Init(GetMcDir()); } catch { }

            // ===== 临时调试：窗口级拖放监听 =====
            this.AllowDrop = true;
            this.DragOver += (s, e) =>
                System.Diagnostics.Debug.WriteLine("[WindowDragOver] 进来");
            this.Drop += (s, e) =>
                System.Diagnostics.Debug.WriteLine("[WindowDrop] 进来");
            // ===== 临时调试结束 =====

            // ⭐ WPF：拿到句柄后才好做圆角/去边框
            this.SourceInitialized += (s, e) =>
            {
                _hwnd = new WindowInteropHelper(this).Handle;

                var source = (System.Windows.Interop.HwndSource)System.Windows.Interop.HwndSource.FromHwnd(_hwnd);
                source?.AddHook((IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) =>
                {
                    const int WM_NCHITTEST = 0x0084;

                    if (msg == WM_NCHITTEST)
                    {
                        const int HTLEFT = 10;
                        const int HTRIGHT = 11;
                        const int HTTOP = 12;
                        const int HTTOPLEFT = 13;
                        const int HTTOPRIGHT = 14;
                        const int HTBOTTOM = 15;
                        const int HTBOTTOMLEFT = 16;
                        const int HTBOTTOMRIGHT = 17;
                        const int BORDER_WIDTH = 8;

                        int x = lParam.ToInt32() & 0xFFFF;
                        int y = (lParam.ToInt32() >> 16) & 0xFFFF;
                        if (x > 32767) x -= 65536;
                        if (y > 32767) y -= 65536;

                        var screenPoint = new System.Windows.Point(x, y);
                        var clientPoint = this.PointFromScreen(screenPoint);

                        double w = this.ActualWidth;
                        double h = this.ActualHeight;

                        bool left = clientPoint.X <= BORDER_WIDTH;
                        bool right = clientPoint.X >= w - BORDER_WIDTH;
                        bool top = clientPoint.Y <= BORDER_WIDTH;
                        bool bottom = clientPoint.Y >= h - BORDER_WIDTH;

                        if (left && top) { handled = true; return new IntPtr(HTTOPLEFT); }
                        if (right && top) { handled = true; return new IntPtr(HTTOPRIGHT); }
                        if (left && bottom) { handled = true; return new IntPtr(HTBOTTOMLEFT); }
                        if (right && bottom) { handled = true; return new IntPtr(HTBOTTOMRIGHT); }
                        if (left) { handled = true; return new IntPtr(HTLEFT); }
                        if (right) { handled = true; return new IntPtr(HTRIGHT); }
                        if (top) { handled = true; return new IntPtr(HTTOP); }
                        if (bottom) { handled = true; return new IntPtr(HTBOTTOM); }
                    }

                    return IntPtr.Zero;
                });


                // 圆角
                int cornerPref = DWMWCP_ROUND;
                DwmSetWindowAttribute(_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref cornerPref, sizeof(int));

                // 去掉系统菜单
                IntPtr hMenu = GetSystemMenu(_hwnd, false);
                if (hMenu != IntPtr.Zero)
                {
                    DeleteMenu(hMenu, SC_CLOSE, 0);
                    DeleteMenu(hMenu, SC_MINIMIZE, 0);
                    DeleteMenu(hMenu, SC_MAXIMIZE, 0);
                    DeleteMenu(hMenu, SC_RESTORE, 0);
                }

                // 禁用系统菜单/最小化/最大化按钮
                int style = (int)GetWindowLongPtr(_hwnd, GWL_STYLE).ToInt64();
                style &= ~WS_SYSMENU;
                style &= ~WS_MINIMIZEBOX;
                style &= ~WS_MAXIMIZEBOX;

                SetWindowLongPtr(_hwnd, GWL_STYLE, (IntPtr)style);


            };

            // 分层窗口（必须在 Loaded 里设）
         //   this.ContentRendered += (s, e) =>
      //      {
         //       var hwnd = new WindowInteropHelper(this).Handle;
         //       Debug.WriteLine($"[WS-CR] hwnd=0x{hwnd:X}");
        //        if (hwnd == IntPtr.Zero) return;

       //         int exStyle = (int)GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
      //          Debug.WriteLine($"[WS-CR] 前 exStyle=0x{exStyle:X}");

         //       exStyle |= WS_EX_LAYERED;
        //        SetWindowLongPtr(hwnd, GWL_EXSTYLE, (IntPtr)exStyle);
        //        SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
        //            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
//
       //         int check = (int)GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
        //        Debug.WriteLine($"[WS-CR] 后 exStyle=0x{check:X} layered={(check & WS_EX_LAYERED) != 0}");
      //      };

            // 窗口加载完成后初始化 WebView2
            this.Loaded += async (s, e) => await OnWindowLoadedAsync();
            // ⭐ 核心：只要窗口一关，直接强制杀掉整个程序
            this.Closed += (s, e) => {
                // 子进程 easytier-core 不会随主进程退出，必须显式清理，否则会留在后台占资源
                KillEasyTierBackend();
                Environment.Exit(0);
            };
            // 渲染事件（淡入淡出用）
            System.Windows.Media.CompositionTarget.Rendering += OnRendering;

            // HTTP 客户端
            var handler = new SocketsHttpHandler
            {
                MaxConnectionsPerServer = 128,
                PooledConnectionLifetime = TimeSpan.FromMinutes(2),
                PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
                ConnectTimeout = TimeSpan.FromSeconds(10),
                AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate,
                AllowAutoRedirect = true,
                MaxAutomaticRedirections = 5,
            };
            _http = new HttpClient(handler);
            _http.DefaultRequestHeaders.Add("User-Agent", "Minecraft-illusion-Launcher/1.0.0");
            _http.DefaultRequestHeaders.Add("Accept-Encoding", "gzip, deflate");
            _http.DefaultRequestHeaders.ConnectionClose = false;
            _http.Timeout = TimeSpan.FromMinutes(10);

            LoadGlobalConfig();

            // ⭐ Key 不再硬编码：只从 global.json 读取，存盘时自动 DPAPI 加密
            //    首次使用：打开 %APPDATA%\.illusionlauncher\global.json，
            //    把明文 Key 填进 "curseForgeApiKey"，启动一次即自动加密
            _global.CurseForgeApiKey = new string((_global.CurseForgeApiKey ?? "").Where(c => c >= 32 && c <= 126).ToArray()).Trim();
            if (string.IsNullOrWhiteSpace(_global.CurseForgeApiKey))
                Debug.WriteLine("[Config] ⚠️ 未配置 CurseForge Key，CF 下载功能不可用");
            SaveGlobalConfig();

            Debug.WriteLine($"[Config] 配置目录 = {GetConfigDir()}");
            Debug.WriteLine($"[Config] 全局 Java = {_global.JavaPath}");
            Debug.WriteLine($"[Config] 游戏目录 = {_global.GamePath}");
            if (string.IsNullOrEmpty(_global.GamePath))
            {
                _global.GamePath = SelectBestDrive();
                SaveGlobalConfig();
            }
            try { Directory.CreateDirectory(_global.GamePath); } catch { }

            try { Directory.CreateDirectory(_global.GamePath); } catch { }

        
        }

        



        // =========================================================
        // ⭐ 新增：CurseForge 搜索与下载 API
        // =========================================================

        private async Task SearchCfModsAsync(string query, string gameVersion, string loaderType, string projectType, CoreWebView2 sender)
        {
            try
            {
                // ⭐ CF 分类 ID：6=Mod 12=资源包 6552=光影 4471=整合包
                int classId = projectType switch
                {
                    "resourcepack" => 12,
                    "shader" => 6552,
                    "modpack" => 4471,
                    _ => 6
                };

                // ⭐ 实例名 → 真正的 MC 版本
                gameVersion = ResolveMcVersion(gameVersion);

                string BuildUrl(string ver)
                {
                    var u = $"https://api.curseforge.com/v1/mods/search?gameId=432&classId={classId}&searchFilter={Uri.EscapeDataString(query)}&sortOrder=desc&sortField=2&pageSize=20";
                    if (!string.IsNullOrEmpty(ver)) u += $"&gameVersion={ver}";
                    if (loaderType == "forge") u += "&modLoaderType=1";
                    else if (loaderType == "fabric") u += "&modLoaderType=4";
                    return u;
                }

                // ⭐ 不再硬编码备用 Key：没配置就直接报错，引导用户自己填
                var cleanKey = new string((_global.CurseForgeApiKey ?? "").Where(c => c >= 32 && c <= 126).ToArray()).Trim();
                if (string.IsNullOrEmpty(cleanKey))
                    throw new Exception("未配置 CurseForge API Key：打开 %APPDATA%\\.illusionlauncher\\global.json，把 Key 填进 curseForgeApiKey 后重启");

                async Task<string> Fetch(string u)
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, u);
                    req.Headers.Add("x-api-key", cleanKey);
                    req.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                    req.Headers.Add("Accept", "application/json");
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(25));
                    var resp = await _http.SendAsync(req, cts.Token);
                    if (!resp.IsSuccessStatusCode) throw new Exception($"CF API 返回 {(int)resp.StatusCode}");
                    return await resp.Content.ReadAsStringAsync();
                }

                var json = await Fetch(BuildUrl(gameVersion));
                bool relaxed = false;
                int count = 0;
                try
                {
                    using var d = JsonDocument.Parse(json);
                    if (d.RootElement.TryGetProperty("data", out var arr) && arr.ValueKind == JsonValueKind.Array)
                        count = arr.GetArrayLength();
                }
                catch { }

                // ⭐ 这个 MC 版本在 CF 上没有资源 → 自动放宽为不限版本，界面至少能看到东西
                if (count == 0 && !string.IsNullOrEmpty(gameVersion))
                {
                    json = await Fetch(BuildUrl(""));
                    relaxed = true;
                    Debug.WriteLine($"[CF] 版本 {gameVersion} 无结果，已放宽为全部版本");
                }

                // 把原始 JSON 传给前端
                var payload = JsonSerializer.Serialize(new { ok = true, projectType, relaxed, raw = json });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onCurseForgeResult({payload})"); });
            }
            catch (Exception ex)
            {
                var payload = JsonSerializer.Serialize(new { ok = false, projectType, error = ex.Message });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onCurseForgeResult({payload})"); });
            }
        }

        private async Task InstallCfModAsync(int modId, int fileId, string versionId, string projectType, CoreWebView2 sender)
        {
            try
            {
                // ⭐ 整合包不走这里，走专用安装流程
                if (projectType == "modpack")
                {
                    await InstallCfModpackAsync(modId, fileId, sender);
                    return;
                }

                await ReportProgress(sender, 10, "获取 CF 下载直链...");
                var url = await GetCfDownloadUrlAsync(modId, fileId);

                await ReportProgress(sender, 30, "开始下载...");
                // 获取文件名 (从 URL 截取，或者回退到文件名)
                var fileName = Path.GetFileName(new Uri(url).LocalPath);
                if (string.IsNullOrEmpty(fileName) || !fileName.Contains('.'))
                    fileName = $"{modId}-{fileId}" + (projectType == "mod" ? ".jar" : ".zip");

                // ⭐ 按资源类型分目录：mods / resourcepacks / shaderpacks
                string subFolder = projectType switch
                {
                    "resourcepack" => "resourcepacks",
                    "shader" => "shaderpacks",
                    _ => "mods"
                };

                string targetDir;
                if (!string.IsNullOrEmpty(versionId))
                    targetDir = Path.Combine(GetMcDir(), "versions", versionId, subFolder);
                else
                    targetDir = Path.Combine(GetMcDir(), subFolder);

                Directory.CreateDirectory(targetDir);
                var savePath = Path.Combine(targetDir, fileName);

                // 借用你现有的 DownloadFileAsync 直接下
                await DownloadFileAsync(url, savePath, (d, t) =>
                {
                    if (t > 0)
                    {
                        double pct = 30 + (d / (double)t * 60);
                        // 限制防抖
                        if ((DateTime.Now - _lastAssetReport).TotalMilliseconds >= 100)
                        {
                            _lastAssetReport = DateTime.Now;
                            _ = ReportProgress(sender, pct, $"下载中... {d / 1024 / 1024}MB / {t / 1024 / 1024}MB");
                        }
                    }
                });

                await ReportProgress(sender, 100, $"安装成功: {fileName}", done: true);
            }
            catch (Exception ex)
            {
                await ReportProgress(sender, 0, $"CF 安装失败: {ex.Message}", done: true);
            }
        }

        // ⭐ 新增：拉 CF 项目详情 + 文件列表（供下载弹窗使用）
        private async Task GetCfFilesAsync(int modId, CoreWebView2 sender)
        {
            try
            {
                var cleanKey = new string((_global.CurseForgeApiKey ?? "").Where(c => c >= 32 && c <= 126).ToArray()).Trim();
                if (string.IsNullOrEmpty(cleanKey))
                    throw new Exception("未配置 CurseForge API Key：打开 %APPDATA%\\.illusionlauncher\\global.json，把 Key 填进 curseForgeApiKey 后重启");

                async Task<string> GetJson(string u)
                {
                    var rq = new HttpRequestMessage(HttpMethod.Get, u);
                    rq.Headers.Add("x-api-key", cleanKey);
                    rq.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                    rq.Headers.Add("Accept", "application/json");
                    var rs = await _http.SendAsync(rq);
                    if (!rs.IsSuccessStatusCode) throw new Exception($"CF API 返回 {(int)rs.StatusCode}");
                    return await rs.Content.ReadAsStringAsync();
                }

                var detailJson = await GetJson($"https://api.curseforge.com/v1/mods/{modId}");
                var filesJson = await GetJson($"https://api.curseforge.com/v1/mods/{modId}/files?pageSize=50");

                string name = "", logo = "", summary = "";
                try
                {
                    using var dd = JsonDocument.Parse(detailJson);
                    var d = dd.RootElement.GetProperty("data");
                    if (d.TryGetProperty("name", out var nm)) name = nm.GetString() ?? "";
                    if (d.TryGetProperty("summary", out var sm)) summary = sm.GetString() ?? "";
                    if (d.TryGetProperty("logo", out var lg) && lg.ValueKind == JsonValueKind.Object && lg.TryGetProperty("thumbnailUrl", out var th))
                        logo = th.GetString() ?? "";
                }
                catch { }

                var payload = JsonSerializer.Serialize(new { ok = true, name, logo, summary, raw = filesJson });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onCfFilesInfo({payload})"); });
            }
            catch (Exception ex)
            {
                var payload = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onCfFilesInfo({payload})"); });
            }
        }

        // ⭐ 整合包下载完成后：通知前端 + 自动打开文件夹
        private async Task NotifyModpackDownloaded(CoreWebView2 sender, string fileName, string savePath, string folder)
        {
            var json = JsonSerializer.Serialize(new { ok = true, fileName, path = savePath, folder });
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModpackDownloaded({json})"); });
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = $"\"{folder}\"",
                    UseShellExecute = true,
                });
            }
            catch (Exception ex) { DiagnosticLogger.Instance.Info($"[Modpack] 打开文件夹失败: {ex.Message}"); }
        }

        // ⭐ 新增：CurseForge 整合包下载 → 交给现有 mrpack/zip 安装流程
        private async Task InstallCfModpackAsync(int modId, int fileId, CoreWebView2 sender)
        {
            try
            {
                await ReportProgress(sender, 5, "获取 CF 整合包直链...");
                var url = await GetCfDownloadUrlAsync(modId, fileId);

                var fileName = Path.GetFileName(new Uri(url).LocalPath);
                if (string.IsNullOrEmpty(fileName) || !fileName.Contains('.'))
                    fileName = $"cfpack-{modId}-{fileId}.zip";

                var packDir = Path.Combine(GetConfigDir(), "modpacks");
                Directory.CreateDirectory(packDir);
                var savePath = Path.Combine(packDir, fileName);

                await ReportProgress(sender, 10, $"下载整合包 {fileName}...");
                await DownloadFileAsync(url, savePath, (d, t) =>
                {
                    if (t > 0)
                    {
                        double pct = 10 + (d / (double)t * 80);
                        if ((DateTime.Now - _lastAssetReport).TotalMilliseconds >= 150)
                        {
                            _lastAssetReport = DateTime.Now;
                            _ = ReportProgress(sender, pct, $"{fileName} {d / 1024 / 1024}MB / {t / 1024 / 1024}MB");
                        }
                    }
                });

                // ⭐ 不再自动安装：只把包下到固定文件夹，由用户自己拖入安装
                await ReportProgress(sender, 100, $"整合包已下载：{fileName}", done: true);
                await NotifyModpackDownloaded(sender, fileName, savePath, packDir);
            }
            catch (Exception ex)
            {
                await ReportProgress(sender, 0, $"CF 整合包安装失败: {ex.Message}", done: true);
            }
        }

        // ⭐ 新增：Modrinth 整合包下载 → 交给现有 mrpack 安装流程
        private async Task InstallModrinthModpackAsync(string projectId, string gameVersion, CoreWebView2 sender)
        {
            try
            {
                await ReportProgress(sender, 3, "正在匹配整合包版本...");

                var req = new HttpRequestMessage(HttpMethod.Get, $"{MODRINTH}/project/{projectId}/version");
                req.Headers.Add("User-Agent", MODRINTH_UA);
                var resp = await _http.SendAsync(req);
                var text = await resp.Content.ReadAsStringAsync();
                var arr = JsonDocument.Parse(text).RootElement;
                if (arr.GetArrayLength() == 0)
                    throw new Exception("该项目没有任何发布版本");

                JsonElement? chosen = null;
                foreach (var v in arr.EnumerateArray())
                {
                    if (!string.IsNullOrEmpty(gameVersion) && v.TryGetProperty("game_versions", out var gvs))
                    {
                        bool match = false;
                        foreach (var g in gvs.EnumerateArray())
                            if (g.GetString() == gameVersion) { match = true; break; }
                        if (!match) continue;
                    }
                    chosen = v;
                    break;
                }
                if (chosen == null) chosen = arr[0];

                JsonElement primary = default;
                bool found = false;
                foreach (var f in chosen.Value.GetProperty("files").EnumerateArray())
                {
                    var n = f.TryGetProperty("filename", out var fn) ? fn.GetString() : "";
                    if (!string.IsNullOrEmpty(n) && n.EndsWith(".mrpack"))
                    {
                        primary = f; found = true; break;
                    }
                }
                if (!found)
                {
                    foreach (var f in chosen.Value.GetProperty("files").EnumerateArray())
                    {
                        if (f.TryGetProperty("primary", out var p) && p.GetBoolean()) { primary = f; found = true; break; }
                    }
                }
                if (!found) primary = chosen.Value.GetProperty("files").EnumerateArray().First();

                var fileUrl = primary.GetProperty("url").GetString();
                var fileName = primary.GetProperty("filename").GetString();
                string sha1 = null;
                if (primary.TryGetProperty("hashes", out var hashes) && hashes.TryGetProperty("sha1", out var s1))
                    sha1 = s1.GetString();

                var packDir = Path.Combine(GetConfigDir(), "modpacks");
                Directory.CreateDirectory(packDir);
                var savePath = Path.Combine(packDir, fileName);

                await ReportProgress(sender, 8, $"下载整合包 {fileName}...");
                await DownloadParallelAsync(fileUrl, savePath, (d, t, speed) =>
                {
                    if (t > 0)
                    {
                        double pct = 8 + (d / (double)t * 82);
                        string sp = speed > 0 ? $" · {FormatSpeed(speed)}" : "";
                        _ = ReportProgress(sender, pct, $"{fileName} {d / 1024 / 1024}MB / {t / 1024 / 1024}MB{sp}");
                    }
                }, sha1);

                // ⭐ 不再自动安装：只把包下到固定文件夹，由用户自己拖入安装
                await ReportProgress(sender, 100, $"整合包已下载：{fileName}", done: true);
                await NotifyModpackDownloaded(sender, fileName, savePath, packDir);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[InstallModrinthModpack] {ex}");
                await ReportProgress(sender, 0, $"整合包安装失败: {ex.Message}", done: true);
            }
        }

        private void OnWebMessageWithFiles(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (args.AdditionalObjects == null || args.AdditionalObjects.Count == 0) return;
            var paths = new List<string>();
            foreach (var obj in args.AdditionalObjects)
            {
                if (obj is CoreWebView2File file && !string.IsNullOrEmpty(file.Path))
                    paths.Add(file.Path);
            }
            if (paths.Count == 0) return;

            Debug.WriteLine($"[FileDrop] 收到 {paths.Count} 个文件: {string.Join(", ", paths)}");

            var core = (CoreWebView2)sender;
            string msg = args.TryGetWebMessageAsString() ?? "";

            if (msg == "file_drop_mods")
            {
                var json = JsonSerializer.Serialize(new { paths });
                _ = RunOnUI(() => { _ = core.ExecuteScriptAsync($"window.onHostDrop && window.onHostDrop({json})"); });
            }
            else if (msg == "file_drop_modpack")
            {
                var json = JsonSerializer.Serialize(new { paths });
                _ = RunOnUI(() => { _ = core.ExecuteScriptAsync($"window.onModpackDrop && window.onModpackDrop({json})"); });
            }
        }

        private bool IsNeoForgeSupported(string versionId)
        {
            try
            {
                // 提取 MC 版本号，如 "1.20.1"、"26.2"
                var m = Regex.Match(versionId, @"(1\.\d+(?:\.\d+)?|26\.\d+(?:\.\d+)?)");
                if (!m.Success) return false;
                var mcVer = m.Groups[1].Value;

                // ⭐ 26.1 的 NeoForge：官方 installer patch 校验失败 + BMCLAPI metadata 滞后
                // 禁用入口，引导用户改用 26.1.1
                if (mcVer == "26.1") return false;

                // 26.x 支持
                if (mcVer.StartsWith("26.")) return true;


                // 1.20.2+ 支持，1.20.1 勉强支持，1.20 以下不支持
                var parts = mcVer.Split('.');
                if (parts.Length < 2) return false;
                int minor = int.Parse(parts[1]);
                int patch = parts.Length >= 3 ? int.Parse(parts[2]) : 0;

                if (minor < 20) return false;          // 1.19 及以下
                if (minor == 20 && patch < 1) return false;  // 1.20（无 patch）不行，1.20.1 起可以
                return true;
            }
            catch
            {
                return false;
            }
        }

   

        // ⭐ WPF：WebView2 初始化（替代原来的 OnActivated）
        private async Task OnWindowLoadedAsync()
        {
            if (_webViewReady) return;
            _webViewReady = true;

            try
            {
                await WebView.EnsureCoreWebView2Async();
               
                WebView.AllowExternalDrop = true;
                WebView.CoreWebView2.Settings.IsWebMessageEnabled = true;
                WebView.CoreWebView2.Settings.IsZoomControlEnabled = false;
                WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                WebView.CoreWebView2.WebMessageReceived += OnWebMessage;
                WebView.CoreWebView2.WebMessageReceived += OnWebMessageWithFiles;
                WebView.CoreWebView2.NewWindowRequested += (s, e) =>
                {
                    e.Handled = true;
                    try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
                };

                string wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
                WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local", wwwroot, CoreWebView2HostResourceAccessKind.Allow);

                string skinsDir = Path.Combine(GetConfigDir(), "skins");
                Directory.CreateDirectory(skinsDir);
                WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "skins.local", skinsDir, CoreWebView2HostResourceAccessKind.Allow);

                string bgDir = Path.Combine(GetConfigDir(), "bg");
                Directory.CreateDirectory(bgDir);
                WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "bg.local", bgDir, CoreWebView2HostResourceAccessKind.Allow);


                // ⭐ URL 带时间戳：彻底绕开 WebView2 对 index.html 的缓存。
                //    之前只给 style.css 加了 ?v=，HTML 本身仍被缓存，导致内联样式/新结构看不到。
                WebView.CoreWebView2.Navigate("https://app.local/index.html?t=" + DateTime.Now.Ticks);

                await Task.Delay(800);
                _webViewSubclassProc = WebViewSubclassProc;   // ⭐ 存字段防 GC

                EnumChildWindows(_hwnd, (h, l) =>
                {
                    var sb = new StringBuilder(256);
                    GetClassName(h, sb, 256);
                    if (sb.ToString() == "Chrome_RenderWidgetHostHWND")
                    {
                        _webViewChromeHwnd = h;
                        SetWindowSubclass(h, _webViewSubclassProc, (UIntPtr)1, IntPtr.Zero);
            // 壁纸子窗口挂钩调试信息，默认静默（排查壁纸问题时再打开）
            // Debug.WriteLine($"[Subclass] 已挂到 Chrome_WidgetWin_0 = 0x{h:X}");
                        return false;
                    }
                    return true;
                }, IntPtr.Zero);



            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[WebView] 初始化失败：{ex}");
                System.Windows.MessageBox.Show($"WebView2 初始化失败：\n\n{ex.Message}", "错误",
     System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
            }
        }

        private string GetConfigDir() => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            ".illusionlauncher");

        private string GetGlobalConfigPath() => Path.Combine(GetConfigDir(), "global.json");
        // 临时调试：打印配置目录

        private string GetVersionConfigPath(string versionId)
        {
            var dir = Path.Combine(GetConfigDir(), "versions");
            Directory.CreateDirectory(dir);
            var invalid = Path.GetInvalidFileNameChars();
            var safe = new string(versionId.Where(c => !invalid.Contains(c)).ToArray());
            return Path.Combine(dir, safe + ".json");
        }

        private void LoadGlobalConfig()
        {
            try
            {
                var path = GetGlobalConfigPath();
                if (File.Exists(path))
                {
                    _global = JsonSerializer.Deserialize<GlobalConfig>(File.ReadAllText(path)) ?? new GlobalConfig();
                    // ⭐ 敏感字段解密（旧明文会自动原样通过，下次保存时变成密文）
                    _global.CurseForgeApiKey = SecretProtector.Unprotect(_global.CurseForgeApiKey);
                }
            }
            catch { _global = new GlobalConfig(); }
        }

        private readonly object _globalCfgLock = new object();

        private void SaveGlobalConfig()
        {
            try
            {
                Directory.CreateDirectory(GetConfigDir());
                lock (_globalCfgLock)
                {
                    // ⭐ 落盘前把敏感字段加密，内存里始终保持明文（程序自己能用）
                    var plainKey = _global.CurseForgeApiKey;
                    _global.CurseForgeApiKey = SecretProtector.Protect(plainKey);
                    try
                    {
                        File.WriteAllText(GetGlobalConfigPath(),
                            JsonSerializer.Serialize(_global, new JsonSerializerOptions { WriteIndented = true }));
                    }
                    finally { _global.CurseForgeApiKey = plainKey; }
                }
            }
            catch { }
        }

        private VersionConfig LoadVersionConfig(string versionId)
        {
            try
            {
                var path = GetVersionConfigPath(versionId);
                if (File.Exists(path))
                    return JsonSerializer.Deserialize<VersionConfig>(File.ReadAllText(path)) ?? new VersionConfig();
            }
            catch { }
            return new VersionConfig();
        }

        private void SaveVersionConfig(string versionId, VersionConfig cfg)
        {
            try
            {
                var path = GetVersionConfigPath(versionId);
                File.WriteAllText(path, JsonSerializer.Serialize(cfg,
                    new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { }
        }

        private GlobalConfig GetEffectiveConfig(string versionId)
        {
            var vc = LoadVersionConfig(versionId);
            var eff = new GlobalConfig
            {
                MaxMemoryMB = _global.MaxMemoryMB,
                MinMemoryMB = _global.MinMemoryMB,
                JvmArgs = _global.JvmArgs,
                GameArgs = _global.GameArgs,
                MemoryPreset = _global.MemoryPreset,
                DisableVulkan = _global.DisableVulkan,
                UseHighPerformanceGpu = _global.UseHighPerformanceGpu,
                JavaPath = _global.JavaPath,
                GamePath = _global.GamePath,
            };
            // 自动内存模式：每次都按当前系统内存重新算，彻底避免「设置里改了但进游戏没变」
            if (_global.AutoMemory)
                eff.MaxMemoryMB = CalcAutoMemoryMB();
            else if (vc.MaxMemoryMB.HasValue)
                eff.MaxMemoryMB = vc.MaxMemoryMB.Value;
            if (vc.MinMemoryMB.HasValue) eff.MinMemoryMB = vc.MinMemoryMB.Value;
            if (!string.IsNullOrEmpty(vc.JvmArgs)) eff.JvmArgs = vc.JvmArgs;
            if (!string.IsNullOrEmpty(vc.GameArgs)) eff.GameArgs = vc.GameArgs;
            if (!string.IsNullOrEmpty(vc.JavaPath)) eff.JavaPath = vc.JavaPath;
            if (!string.IsNullOrEmpty(vc.MemoryPreset)) eff.MemoryPreset = vc.MemoryPreset;
            if (vc.DisableVulkan.HasValue) eff.DisableVulkan = vc.DisableVulkan.Value;
            if (vc.UseHighPerformanceGpu.HasValue) eff.UseHighPerformanceGpu = vc.UseHighPerformanceGpu.Value;
            return eff;
        }

        private string SelectBestDrive()
        {
            const long MIN_FREE = 20L * 1024 * 1024 * 1024;
            try
            {
                var dDrive = new DriveInfo("D");
                if (dDrive.IsReady && dDrive.AvailableFreeSpace > MIN_FREE)
                    return @"D:\illusion_Version";
            }
            catch { }
            string bestDrive = null;
            long maxFree = MIN_FREE;
            foreach (var drive in DriveInfo.GetDrives())
            {
                try
                {
                    if (!drive.IsReady) continue;
                    if (drive.DriveType != DriveType.Fixed) continue;
                    if (drive.AvailableFreeSpace > maxFree)
                    {
                        maxFree = drive.AvailableFreeSpace;
                        bestDrive = drive.Name;
                    }
                }
                catch { }
            }
            if (bestDrive != null) return Path.Combine(bestDrive, "illusion_Version");
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "illusion_Version");
        }

        private string GetMcDir()
        {
            if (string.IsNullOrEmpty(_global.GamePath)) _global.GamePath = SelectBestDrive();
            return _global.GamePath;
        }

        private string GetJavaDir()
        {
            // 换游戏目录后仍延用老的 Java 目录（不跟着搬）
            try
            {
                if (!string.IsNullOrEmpty(_global?.JavaDir) && Directory.Exists(_global.JavaDir))
                    return _global.JavaDir;
            }
            catch { }
            return Path.Combine(GetMcDir(), "java");
        }



        private Task RunOnUI(Action action)
        {
            var tcs = new TaskCompletionSource();
            this.Dispatcher.Invoke(() =>
            {
                try { action(); tcs.SetResult(); }
                catch (Exception ex) { tcs.SetException(ex); }
            });
            return tcs.Task;
        }

        private async void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            var core = (CoreWebView2)sender;
            var msg = args.TryGetWebMessageAsString();
            if (msg == null) return;
            // 只记录非高频消息：get_* / ping 这类界面刷新就发一次，全打会把输出刷满
            if (!msg.Contains("get_") && !msg.Contains("ping"))
                Debug.WriteLine($"[WebMsg] 收到: {msg}");
            if (msg.StartsWith("{"))
            {
                try
                {
                    var doc = JsonDocument.Parse(msg);
                    var root = doc.RootElement;
                    if (!root.TryGetProperty("action", out var actionEl)) return;
                   
                    var action = actionEl.GetString();
            // 同样只记录非高频 action
            if (!action.StartsWith("get_") && action != "ping")
                Debug.WriteLine($"[WebMsg] 解析到 action = {action}");

                    if (await HandleFeatureMessage(action, root, core)) return;

                    if (action == "check_loader_support")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var neoforgeOk = IsNeoForgeSupported(versionId);
                        var json = JsonSerializer.Serialize(new
                        {
                            versionId = versionId,
                            neoforge = neoforgeOk
                        });
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onLoaderSupport({json})"); });
                    }

                    else if (action == "export_mrpack")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                string savePath = null;
                                await RunOnUI(() =>
                                {
                                    var sfd = new Microsoft.Win32.SaveFileDialog
                                    {
                                        Title = "保存整合包",
                                        Filter = "Modrinth 整合包 (*.mrpack)|*.mrpack",
                                        FileName = $"{versionId}_{DateTime.Now:yyyyMMdd}.mrpack"
                                    };
                                    if (sfd.ShowDialog() == true) savePath = sfd.FileName;
                                });

                                if (string.IsNullOrEmpty(savePath))
                                {
                                    await RunOnUI(() => { _ = core.ExecuteScriptAsync("hideSideToast()"); });
                                    return;
                                }

                                // ⭐ 1. 告诉前端准备开始
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync("showSideToast('正在导出', '正在计算并打包...', 0)"); });

                                // ⭐ 2. 强制转到 UI 线程发包，确保前端一定收到
                                var prog = new Progress<int>(pct =>
                                {
                                    RunOnUI(() => {
                                        _ = core.ExecuteScriptAsync($"updateSideToast('正在匹配模组与打包...', {pct})");
                                    });
                                });

                                // ⭐ 3. 传入进度接收器
                                await ModpackExporter.ExportAsync(versionId, savePath, GetMcDir(), _http, prog);

                                var safePath = savePath.Replace("\\", "/");
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"showSideToast('导出成功', '已保存至 {safePath}', 100)"); });
                            }
                            catch (Exception ex)
                            {
                                var safeMsg = ex.Message.Replace("'", "\\'");
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"showSideToast('导出失败', '{safeMsg}', 0)"); });
                            }
                        });
                    }

                    else if (action == "get_version_real_info")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var targetLoader = root.TryGetProperty("targetLoader", out var tl) ? tl.GetString() : "none";

                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var mcDir = GetMcDir();
                                var versionDir = Path.Combine(mcDir, "versions", versionId);
                                var jsonPath = Path.Combine(versionDir, versionId + ".json");

                                if (!File.Exists(jsonPath))
                                {
                                    await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionRealInfo({{ok:false, error:'找不到版本 JSON 文件'}})"); });
                                    return;
                                }

                                var resolved = SmartVersionResolver.ResolveRaw(mcDir, versionId);

                                // ===== 优先直接读版本 JSON 里的真实版本字段 =====
                                // 整合包 / 自定义命名的版本（如 Zombie_Invade_100_Days）
                                // 靠文件夹名永远猜不准，只能读 json。
                                string jsonMcVer = null;
                                try
                                {
                                    using var vdoc = JsonDocument.Parse(File.ReadAllText(jsonPath));
                                    var vr = vdoc.RootElement;

                                    // 1) clientVersion：HMCL / 部分整合包会写
                                    if (vr.TryGetProperty("clientVersion", out var cvEl) && cvEl.ValueKind == JsonValueKind.String)
                                    {
                                        var cv = cvEl.GetString();
                                        if (IsMcVersionLike(cv)) jsonMcVer = cv;
                                    }

                                    // 2) jar：Mojang 官方 json 和 Forge 合并版本通常带 "jar": "1.12.2"
                                    if (jsonMcVer == null && vr.TryGetProperty("jar", out var jarEl) && jarEl.ValueKind == JsonValueKind.String)
                                    {
                                        var jar = jarEl.GetString();
                                        if (jar != versionId && IsMcVersionLike(jar)) jsonMcVer = jar;
                                    }

                                    // 3) id 本身就是标准 MC 版本号（原版版本）
                                    if (jsonMcVer == null && vr.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String)
                                    {
                                        var idv = idEl.GetString();
                                        if (IsMcVersionLike(idv)) jsonMcVer = idv;
                                    }
                                }
                                catch { /* json 读不了就走下面的兜底 */ }

                                string mcVer = jsonMcVer;
                                if (string.IsNullOrWhiteSpace(mcVer)) mcVer = resolved.Id;

                                // ⭐ 如果版本名是 fabric-loader 开头的，去继承链里找
                                if (mcVer.Contains("fabric-loader"))
                                {
                                    mcVer = resolved.InheritsFrom ?? "";
                                }

                                // ⭐ 核心兜底：如果通过 JSON 还是没找到，直接对文件夹名字用正则暴力提取！
                                if (string.IsNullOrEmpty(mcVer) || mcVer == "未知")
                                {
                                    // 把下划线换成点，方便正则处理
                                    var normalizedName = versionId.Replace('_', '.');
                                    // 匹配 1.20.1 或者 26.2 这种格式
                                    var match = System.Text.RegularExpressions.Regex.Match(normalizedName, @"(1\.\d+(?:\.\d+)?|26\.\d+(?:\.\d+)?)");
                                    if (match.Success)
                                    {
                                        mcVer = match.Groups[1].Value;
                                    }
                                    else
                                    {
                                        mcVer = "未知";
                                    }
                                }

                                string realLoader = "vanilla";
                                if (resolved.MainClass != null)
                                {
                                    if (resolved.MainClass.Contains("fabric")) realLoader = "fabric";
                                    else if (resolved.MainClass.Contains("forge") || resolved.MainClass.Contains("launchwrapper")) realLoader = "forge";
                                    else if (resolved.MainClass.Contains("neoforge")) realLoader = "neoforge";
                                }

                                if (targetLoader != "none" && targetLoader != "vanilla")
                                    realLoader = targetLoader;

                                var payload = JsonSerializer.Serialize(new { ok = true, mcVersion = mcVer, loaderType = realLoader });
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionRealInfo({payload})"); });
                            }
                            catch (Exception ex)
                            {
                                var safeMsg = ex.Message.Replace("'", "\\'");
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionRealInfo({{ok:false, error:'{safeMsg}'}})"); });
                            }
                        });
                    }

                    if (action == "get_loader_versions")
                    {
                        var loader = root.GetProperty("loader").GetString();

                        // 优先用前端解析出的「真实 MC 版本」。
                        // versionId 可能是实例 id（如 "1.12.2-forge-14.23.5.2864"），
                        // 直接拿它去过滤加载器版本会永远匹配不到。
                        string baseVer = null;
                        if (root.TryGetProperty("mcVersion", out var mcv) && mcv.ValueKind == JsonValueKind.String)
                            baseVer = mcv.GetString();
                        if (string.IsNullOrWhiteSpace(baseVer))
                            baseVer = root.GetProperty("versionId").GetString();

                        _ = Task.Run(() => FetchLoaderVersionsAsync(loader, baseVer, core));
                    }

                    if (action == "download_mc")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var versionUrl = root.GetProperty("versionUrl").GetString();
                        string loader = "none";
                        if (root.TryGetProperty("loader", out var lp)) loader = lp.GetString();

                        // ⭐ 新增：接收前端选中的版本号
                        string loaderVersion = null;
                        if (root.TryGetProperty("loaderVersion", out var lv)) loaderVersion = lv.GetString();

                        _ = Task.Run(async () =>
                        {
                            BeginDownloadSession();
                            try { await DownloadAndInstallAsync(versionId, versionUrl, loader, loaderVersion, core); }
                            catch (OperationCanceledException) { await ReportProgress(core, 0, "已取消下载", done: true); }
                            finally { EndDownloadSession(); }
                        });
                    }
                    else if (action == "launch_mc")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        string username = "Player";
                        if (root.TryGetProperty("username", out var up)) username = up.GetString();
                        string skinId = "";
                        if (root.TryGetProperty("skinId", out var sp)) skinId = sp.GetString() ?? "";
                        _ = Task.Run(() => LaunchMinecraftAsync(versionId, username, skinId, core));
                    }

                    else if (action == "clean_garbage")
                    {
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var mcDir = GetMcDir();
                                long freedBytes = 0;

                                // 1. 清理日志和崩溃报告
                                var dirsToClean = new[] { "logs", "crash-reports" };
                                foreach (var d in dirsToClean)
                                {
                                    var dir = Path.Combine(mcDir, d);
                                    if (Directory.Exists(dir))
                                    {
                                        foreach (var file in Directory.GetFiles(dir))
                                        {
                                            freedBytes += new FileInfo(file).Length;
                                            File.Delete(file);
                                        }
                                    }
                                }

                                // 2. 清理下载残留（.part 和 .aria2）
                                foreach (var file in Directory.GetFiles(mcDir, "*.part", SearchOption.AllDirectories))
                                {
                                    freedBytes += new FileInfo(file).Length;
                                    File.Delete(file);
                                }
                                foreach (var file in Directory.GetFiles(mcDir, "*.aria2", SearchOption.AllDirectories))
                                {
                                    freedBytes += new FileInfo(file).Length;
                                    File.Delete(file);
                                }

                                // 3. 清理完成，汇报结果
                                double freedMB = Math.Round(freedBytes / 1024.0 / 1024.0, 2);
                                var json = JsonSerializer.Serialize(new { ok = true, freedMB = freedMB }, JsonOpts());
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"window.onCleanResult({json})"); });
                            }
                            catch (Exception ex)
                            {
                                var json = JsonSerializer.Serialize(new { ok = false, error = ex.Message }, JsonOpts());
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"window.onCleanResult({json})"); });
                            }
                        });
                    }

                    else if (action == "check_mod_conflicts")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var mcDir = GetMcDir();
                        var modsDir = Path.Combine(mcDir, "versions", versionId, "mods");

                        _ = Task.Run(async () =>
                        {
                            // ⭐ 核心修复：加上 async 关键字
                            var progress = new Progress<string>(async msg =>
                            {
                                // 给前端发进度：让圆环显示文字，百分比停在 15% 左右避免乱跳
                                await ReportLaunchProgress(core, 15, msg);
                            });

                            // ⭐ 2. 把接收器传进扫描器
                            var results = await ModConflictScanner.CheckConflictsAsync(modsDir, versionId, progress);

                            var json = JsonSerializer.Serialize(new { ok = true, conflicts = results });
                            await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onModConflictsChecked({json})"); });
                        });
                    }



                    else if (action == "pick_version_icon")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var dialog = new Microsoft.Win32.OpenFileDialog
                        {
                            Title = "选择版本图标",
                            Filter = "图片文件|*.png;*.jpg;*.jpeg"
                        };

                        if (dialog.ShowDialog() == true)
                        {
                            string sourcePath = dialog.FileName;
                            var mcDir = GetMcDir();
                            string versionDir = Path.Combine(mcDir, "versions", versionId);

                            if (Directory.Exists(versionDir))
                            {
                                string destPath = Path.Combine(versionDir, "icon.png");
                                File.Copy(sourcePath, destPath, true);

                                byte[] imageArray = File.ReadAllBytes(destPath);
                                string base64Str = Convert.ToBase64String(imageArray);
                                string jsCall = $"window.onVersionIconPicked({{ url: 'data:image/png;base64,{base64Str}' }})";
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync(jsCall); });
                            }
                        }
                    }



                    else if (action == "get_version_icons")
                    {
                        var iconsDict = new Dictionary<string, string>();
                        var mcDir = GetMcDir();
                        string versionsDir = Path.Combine(mcDir, "versions");

                        if (Directory.Exists(versionsDir))
                        {
                            foreach (var dir in Directory.GetDirectories(versionsDir))
                            {
                                string iconPath = Path.Combine(dir, "icon.png");
                                if (File.Exists(iconPath))
                                {
                                    byte[] imgBytes = File.ReadAllBytes(iconPath);
                                    string base64 = Convert.ToBase64String(imgBytes);
                                    string versionName = new DirectoryInfo(dir).Name;
                                    iconsDict[versionName] = $"data:image/png;base64,{base64}";
                                }
                            }
                        }
                        var jsonResp = JsonSerializer.Serialize(new { icons = iconsDict }, JsonOpts());
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"window.onVersionIconsLoaded({jsonResp})"); });
                    }

                    else if (action == "get_about_info")
                    {
                        var mcDir = GetMcDir();
                        var json = JsonSerializer.Serialize(new
                        {
                            javaPath = string.IsNullOrEmpty(_global.JavaPath) ? "未指定（自动适配）" : _global.JavaPath,
                            gamePath = mcDir,
                            logPath = Path.Combine(mcDir, "logs"),
                        }, JsonOpts());
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onAboutInfo({json})"); });
                    }

                    else if (action == "cancel_launch")
                    {
                        _isCancelled = true; // ⭐ 标记为已取消
                        try { _launchCts?.Cancel(); }
                        catch (Exception ex) { Debug.WriteLine($"[CancelLaunch] {ex}"); }

                        try
                        {
                            if (_lastProcess != null && !_lastProcess.HasExited)
                            {
                                _lastProcess.Kill(entireProcessTree: true);
                                Debug.WriteLine("[CancelLaunch] 强杀 Java 进程");
                            }
                        }
                        catch { }

                        var json = JsonSerializer.Serialize(new
                        {
                            percent = 0,
                            message = "已取消启动",
                            done = true,
                            cancelled = true
                        });
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onLaunchProgress({json})"); });
                    }
                    else if (action == "export_diag")
                    {
                        // ⭐ 一键导出诊断包（日志 + 环境信息，敏感内容已脱敏）
                        _ = ExportDiagnosticsAsync(core);
                    }
                    else if (action == "td_pick_save")
                    {
                        // ⭐ 线程下载：选择保存位置
                        string picked = "";
                        await RunOnUI(() =>
                        {
                            var dlg = new Microsoft.Win32.SaveFileDialog
                            {
                                Title = "保存到",
                                Filter = "所有文件 (*.*)|*.*",
                                FileName = "download.bin",
                                OverwritePrompt = true,
                            };
                            if (dlg.ShowDialog() == true) picked = dlg.FileName;
                        });
                        await RunOnUI(() => { try { _ = core.ExecuteScriptAsync("onTdSavePicked(" + JsStr(picked) + ")"); } catch { } });
                    }
                    else if (action == "td_start")
                    {
                        // ⭐ 线程下载：多线程分片下载任意直链
                        var tdUrl = root.TryGetProperty("url", out var u1) ? (u1.GetString() ?? "") : "";
                        var tdSave = root.TryGetProperty("savePath", out var sp1) ? (sp1.GetString() ?? "") : "";
                        int tdConns = root.TryGetProperty("conns", out var c1) ? c1.GetInt32() : 96;
                        int tdChunkMb = root.TryGetProperty("chunkMb", out var k1) ? k1.GetInt32() : 1;
                        if (tdChunkMb < 1) tdChunkMb = 1;

                        BeginDownloadSession();
                        _ = Task.Run(async () =>
                        {
                            bool ok = false;
                            string err = null;
                            try
                            {
                                var r = await ThreadDownloadAsync(tdUrl, tdSave, tdConns, (long)tdChunkMb * 1024 * 1024,
                                    (downloaded, total, speed) =>
                                    {
                                        double pct = total > 0 ? downloaded * 100.0 / total : 0;
                                        var pctTxt = pct.ToString("F1", System.Globalization.CultureInfo.InvariantCulture);
                                        _ = RunOnUI(() => { try { _ = core.ExecuteScriptAsync($"onTdProgress({pctTxt},{downloaded},{total},{Math.Round(speed)})"); } catch { } });
                                    });
                                ok = r.ok;
                                err = r.error;
                            }
                            catch (Exception ex) { err = ex.Message; }
                            finally { EndDownloadSession(); }
                            await RunOnUI(() => { try { _ = core.ExecuteScriptAsync($"onTdFinished({(ok ? "true" : "false")},{JsStr(err ?? "")})"); } catch { } });
                        });
                    }
                    else if (action == "save_global_config")
                    {
                        var cfgJson = root.GetProperty("config").GetRawText();
                        var newCfg = JsonSerializer.Deserialize<GlobalConfig>(cfgJson);
                        newCfg.JavaPath = _global.JavaPath;
                        newCfg.GamePath = _global.GamePath;
                        newCfg.BackgroundPath = _global.BackgroundPath;
                        newCfg.CurseForgeApiKey = _global.CurseForgeApiKey; // ⭐ 加上这行，保住你的 Key 不被清空
                        _global = newCfg;
                        SaveGlobalConfig();

                        // ... 下面原来的代码不变

                        var json = JsonSerializer.Serialize(_global, new JsonSerializerOptions
                        {
                            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                        });
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onGlobalConfigLoaded({json})"); });
                    }
                    else if (action == "get_system_memory")
                    {
                        int totalMB = NativeMemory.GetTotalPhysicalMemoryMB();
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onSystemMemory({{totalMemoryMB:{totalMB}}})"); });
                    }
                    else if (action == "load_global_config")
                    {
                        var json = JsonSerializer.Serialize(_global, new JsonSerializerOptions
                        {
                            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                        });
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onGlobalConfigLoaded({json})"); });
                    }
                    else if (action == "save_java")
                    {
                        var path = root.GetProperty("path").GetString();
                        _global.JavaPath = path;
                        SaveGlobalConfig();
                    }
                    else if (action == "set_game_path")
                    {
                        var path = root.GetProperty("path").GetString();
                        if (!string.IsNullOrEmpty(path))
                        {
                            // 换目录前先记住当前 Java 根目录，之后继续延用它
                            _global.GamePath = path;
                            if (string.IsNullOrEmpty(_global.JavaDir))
                            SaveGlobalConfig();
                            {
                            try { Directory.CreateDirectory(_global.GamePath); } catch { }
                                try { _global.JavaDir = Path.Combine(GetMcDir(), "java"); } catch { }
                            await RunOnUI(() => { _ = core.ExecuteScriptAsync("scanInstalledToHome()"); });
                            }
                        }
                    }
                    else if (action == "install_loader")
                    {
                        var loader = root.GetProperty("loader").GetString();
                        var versionId = root.GetProperty("versionId").GetString();
                        _ = Task.Run(async () =>
                        {
                            await InstallLoaderAsync(loader, versionId, core);
                            await RunOnUI(() => { _ = core.ExecuteScriptAsync("scanInstalledToHome()"); });
                        });
                    }
                    else if (action == "save_version_config")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var cfgJson = root.GetProperty("config").GetRawText();
                        var cfg = JsonSerializer.Deserialize<VersionConfig>(cfgJson);
                        SaveVersionConfig(versionId, cfg);
                    }
                    else if (action == "load_version_config")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var cfg = LoadVersionConfig(versionId);
                        var json = JsonSerializer.Serialize(new { versionId = versionId, config = cfg });
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionConfigLoaded({json})"); });
                    }
                    else if (action == "list_files")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var folderType = root.GetProperty("folderType").GetString();
                        _ = Task.Run(() => ListFilesAsync(versionId, folderType, core));
                    }
                    else if (action == "toggle_file")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var folderType = root.GetProperty("folderType").GetString();
                        var fileName = root.GetProperty("fileName").GetString();
                        _ = Task.Run(() => ToggleFileAsync(versionId, folderType, fileName, core));
                    }
                    else if (action == "delete_file")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var folderType = root.GetProperty("folderType").GetString();
                        var fileName = root.GetProperty("fileName").GetString();
                        _ = Task.Run(() => DeleteFileAsync(versionId, folderType, fileName, core));
                    }
                    else if (action == "import_files")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var folderType = root.GetProperty("folderType").GetString();
                        var paths = root.GetProperty("paths").EnumerateArray()
                            .Select(p => p.GetString())
                            .Where(p => !string.IsNullOrEmpty(p))
                            .ToList();
                        _ = Task.Run(() => ImportFilesAsync(versionId, folderType, paths, core));
                    }

                    else if (action == "search_curseforge")
                    {
                        var query = root.GetProperty("query").GetString();
                        var gameVersion = root.TryGetProperty("gameVersion", out var gvCf) ? gvCf.GetString() : "";
                        var loader = root.TryGetProperty("loader", out var ldCf) ? ldCf.GetString() : "";
                        var cfType = root.TryGetProperty("projectType", out var ptCf) ? ptCf.GetString() : "mod";
                        if (string.IsNullOrEmpty(cfType)) cfType = "mod";
                        _ = Task.Run(() => SearchCfModsAsync(query, gameVersion, loader, cfType, core));
                    }
                    else if (action == "install_curseforge_mod")
                    {
                        var modId = root.GetProperty("modId").GetInt32();
                        var fileId = root.GetProperty("fileId").GetInt32();
                        var versionId = root.TryGetProperty("versionId", out var vid) ? vid.GetString() : "";
                        var cfType = root.TryGetProperty("projectType", out var ptCf2) ? ptCf2.GetString() : "mod";
                        if (string.IsNullOrEmpty(cfType)) cfType = "mod";
                        _ = Task.Run(async () =>
                        {
                            BeginDownloadSession();
                            try { await InstallCfModAsync(modId, fileId, versionId, cfType, core); }
                            catch (OperationCanceledException) { await ReportProgress(core, 0, "已取消下载", done: true); }
                            finally { EndDownloadSession(); }
                        });
                    }
                    else if (action == "get_cf_files")
                    {
                        var modId = root.GetProperty("modId").GetInt32();
                        _ = Task.Run(() => GetCfFilesAsync(modId, core));
                    }
                    else if (action == "scan_versions")
                    {
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var _mcDir = GetMcDir();
                                var _reports = VersionDoctor.Scan(_mcDir, Path.Combine(_mcDir, "assets"));
                                var _json = JsonSerializer.Serialize(new { ok = true, reports = _reports }, new JsonSerializerOptions { IncludeFields = true });
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionScan({_json})"); });
                            }
                            catch (Exception ex)
                            {
                                var _err = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionScan({_err})"); });
                            }
                        });
                    }
                    else if (action == "repair_version")
                    {
                        var _verName = root.GetProperty("name").GetString();
                        _ = Task.Run(async () =>
                        {
                            var _mcDir = GetMcDir();
                            var _msgs = new List<string>();
                            try
                            {
                                var _rep = VersionDoctor.Scan(_mcDir, Path.Combine(_mcDir, "assets")).FirstOrDefault(x => x.Name == _verName);
                                // 1) 破损 json / 扁平化失败 → 回滚备份
                                if (_rep != null && (_rep.FlattenBroken || _rep.JsonState == "invalid") && _rep.HasBackup)
                                {
                                    if (VersionDoctor.RestoreBackup(_mcDir, _verName, out var _m)) _msgs.Add(_m);
                                }
                                // 2) 缺库 / 缺 assets → 复用现有补全器（只补库与资源，不动 json）
                                await ProjBobcatRepairAsync(_verName, core, 0, 100, false);
                                _msgs.Add("库与资源已校验补全");
                                var _after = VersionDoctor.Scan(_mcDir, Path.Combine(_mcDir, "assets")).FirstOrDefault(x => x.Name == _verName);
                                var _json = JsonSerializer.Serialize(new { ok = true, name = _verName, messages = _msgs, report = _after }, new JsonSerializerOptions { IncludeFields = true });
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionRepaired({_json})"); });
                            }
                            catch (Exception ex)
                            {
                                var _err = JsonSerializer.Serialize(new { ok = false, name = _verName, error = ex.Message });
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionRepaired({_err})"); });
                            }
                        });
                    }

                    else if (action == "install_curseforge_modpack")
                    {
                        var modId = root.GetProperty("modId").GetInt32();
                        var fileId = root.GetProperty("fileId").GetInt32();
                        _ = Task.Run(async () =>
                        {
                            BeginDownloadSession();
                            try { await InstallCfModpackAsync(modId, fileId, core); }
                            catch (OperationCanceledException) { await ReportProgress(core, 0, "已取消下载", done: true); }
                            finally { EndDownloadSession(); }
                        });
                    }
                    else if (action == "install_modrinth_modpack")
                    {
                        var projectId = root.GetProperty("projectId").GetString();
                        var gameVersion = root.TryGetProperty("gameVersion", out var gvMp) ? gvMp.GetString() : "";
                        _ = Task.Run(async () =>
                        {
                            BeginDownloadSession();
                            try { await InstallModrinthModpackAsync(projectId, gameVersion, core); }
                            catch (OperationCanceledException) { await ReportProgress(core, 0, "已取消下载", done: true); }
                            finally { EndDownloadSession(); }
                        });
                    }


                    else if (action == "cancel_download")
                    {
                        var cancelled = CancelDownloadSession();
                        var obj = new
                        {
                            type = cancelled ? "取消中" : "无可取消任务",
                            percent = 0,
                            message = cancelled ? "正在取消下载…" : "当前没有进行中的下载",
                            done = !cancelled
                        };
                        var cancelJson = JsonSerializer.Serialize(obj);
                        _ = RunOnUI(() => { _ = core.ExecuteScriptAsync($"onDownloadProgress({cancelJson})"); });
                    }
                    else if (action == "drop_modpack")
                    {
                        var path = root.GetProperty("path").GetString();
                        _ = Task.Run(() => ParseModpackAsync(path, core));
                    }
                    else if (action == "install_modpack")
                    {
                        var path = root.GetProperty("path").GetString();
                        _ = Task.Run(async () =>
                        {
                            BeginDownloadSession();
                            try { await InstallModpackAsync(path, core); }
                            catch (OperationCanceledException) { await ReportProgress(core, 0, "已取消下载", done: true); }
                            finally { EndDownloadSession(); }
                        });
                    }
                    else if (action == "open_folder")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var folderType = root.GetProperty("folderType").GetString();
                        var mcDir = GetMcDir();

                        string targetDir;
                        if (folderType == "mods")
                            targetDir = Path.Combine(mcDir, "versions", versionId, "mods");
                        else if (folderType == "resourcepacks")
                            targetDir = Path.Combine(mcDir, "versions", versionId, "resourcepacks");
                        else if (folderType == "shaderpacks")
                            targetDir = Path.Combine(mcDir, "versions", versionId, "shaderpacks");
                        else if (folderType == "logs")
                            targetDir = Path.Combine(mcDir, "logs");
                        else
                            return;

                        try
                        {
                            Directory.CreateDirectory(targetDir);
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = "explorer.exe",
                                Arguments = targetDir,
                                UseShellExecute = true,
                            });
                        }
                        catch (Exception ex) { Debug.WriteLine($"[OpenFolder] {ex.Message}"); }
                    }
                    else if (action == "delete_version")
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var mcDir = GetMcDir();
                        var targetDir = Path.Combine(mcDir, "versions", versionId);

                        Debug.WriteLine($"[DeleteVersion] 尝试删除：{targetDir}");

                        try
                        {
                            if (Directory.Exists(targetDir))
                            {
                                Directory.Delete(targetDir, true);
                                Debug.WriteLine($"[DeleteVersion]  已删除 {versionId}");
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onVersionDeleted('{versionId}')"); });
                            }
                            else
                            {
                                Debug.WriteLine($"[DeleteVersion] 目录不存在：{targetDir}");
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onDeleteFailed('{versionId}', '目录不存在')"); });
                            }
                        }
                        catch (Exception ex)
                        {
                            Debug.WriteLine($"[DeleteVersion]  失败：{ex.Message}");
                            var safeMsg = ex.Message.Replace("\\", "\\\\").Replace("'", "\\'");
                            await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onDeleteFailed('{versionId}', '{safeMsg}')"); });
                        }
                    }
                }
                catch { }
                return;
            }

            switch (msg)
            {
                case "minimize":
                    Debug.WriteLine($"[CASE] minimize 进来 anim={_animating}");

                    // ⭐ 如果游戏没开，直接老老实实最小化到任务栏
                    if (_lastProcess == null || _lastProcess.HasExited)
                    {
                        // 先把透明度恢复，防止被之前的动画搞成透明
                        SetLayeredWindowAttributes(_hwnd, 0, 255, LWA_ALPHA);
                        this.WindowState = System.Windows.WindowState.Minimized;
                        this.ShowInTaskbar = true;
                        break; // 直接结束，不走后面的隐藏逻辑
                    }

                    // 如果游戏开着，走隐藏并弹岛的流程
                    this.ShowInTaskbar = false;
                    this.Visibility = System.Windows.Visibility.Hidden;

                    if (_currentCapsule != null)
                    {
                        try { _currentCapsule.Close(); } catch { }
                    }

                    _currentCapsule = new CapsuleWindow(_currentLaunchPlayerName, "运行中", "");

                    _currentCapsule.Show();

                    break;





                case "optimize_memory":
                    _ = Task.Run(() => RequestAdminOptimizeAsync()); 
                    break;
                case "close":
                    if (!_animating)
                    {
                        _animating = true;
                        _closing = true;
                        _maximizing = false;
                        _animIn = false;
                        _animT = 0;
                        _animStartTime = DateTime.Now;
                    }
                    break;
                case "drag":
                    ReleaseCapture();
                    PostMessage(_hwnd, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                    break;
                case "scan_versions":
                    _ = Task.Run(() => ScanInstalledVersionsAsync(core));
                    break;
                case "detect_java":
                    _ = Task.Run(() => DetectJavaAsync(core));
                    break;

                case "pick_java":
                    _ = Dispatcher.InvokeAsync(() => PickJavaFileAsync(core));
                    break;
                case "pick_java_folder":
                    _ = Dispatcher.InvokeAsync(() => PickJavaFolderAsync(core));
                    break;
                case "pick_game_path":
                    _ = Dispatcher.InvokeAsync(() => PickGamePathAsync(core));
                    break;

                    _ = Task.Run(() => PickGamePathAsync(core));
                    break;
                case "pick_background":
                    _ = Task.Run(() => PickBackgroundAsync(core));
                    break;
                case "get_background":
                    {
                        // get_background 每次界面刷新都会调用，不再打日志
                        // Debug.WriteLine($"[BG] 收到 get_background 请求 #{DateTime.Now:HH:mm:ss.fff}");
                        var bgFileName = _global.BackgroundPath;
                        if (!string.IsNullOrEmpty(bgFileName))
                        {
                            var bgFilePath = Path.Combine(GetConfigDir(), "bg", bgFileName);
                            if (File.Exists(bgFilePath))
                            {
                                var url = $"https://bg.local/{bgFileName}";
                                var json = JsonSerializer.Serialize(new { url = url, path = bgFilePath });
                                await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onBackgroundLoaded({json})"); });
                            }
                        }
                    }
                    break;
                case "get_game_path":
                    {
                        var json = JsonSerializer.Serialize(new { path = GetMcDir() });
                        await RunOnUI(() => { _ = core.ExecuteScriptAsync($"onGamePathPicked({json})"); });
                    }
                    break;
            }
        }


      




        private void OnRendering(object sender, object e)
        {
            if (!_animating) return;

            var elapsed = (DateTime.Now - _animStartTime).TotalMilliseconds;
            _animT = Math.Min(elapsed / AnimDurationMs, 1.0);
            double eased = 1 - (1 - _animT) * (1 - _animT);

            byte alpha = _animIn
                ? (byte)(255 * eased)
                : (byte)(255 * (1.0 - eased));
            SetLayeredWindowAttributes(_hwnd, 0, alpha, LWA_ALPHA);

            if (_animT < 1.0) return;

            // t 到 1.0，处理
            if (_animIn)
            {
                // 淡入完成，收尾
                _animIn = false;
                _animating = false;
                SetLayeredWindowAttributes(_hwnd, 0, 255, LWA_ALPHA);
                return;
            }

            if (_closing)
            {
                _animating = false;
                this.Close();       // 正常关窗口
                Environment.Exit(0); // ⭐ 强行绝杀所有后台进程
                return;
            }

            if (_maximizing)
            {
                _maximizing = false;

                if (this.WindowState == System.Windows.WindowState.Maximized)
                    this.WindowState = System.Windows.WindowState.Normal;
                else
                    this.WindowState = System.Windows.WindowState.Maximized;

                // 立刻开始淡入
                _animating = true;             // ⭐ 显式设 true，防意外
                _animIn = true;
                _animT = 0;
                _animStartTime = DateTime.Now;
                SetLayeredWindowAttributes(_hwnd, 0, 0, LWA_ALPHA);
                return;
            }

            // 最小化
            _animating = false;
            this.WindowState = System.Windows.WindowState.Minimized;
            SetLayeredWindowAttributes(_hwnd, 0, 255, LWA_ALPHA);
        }

        private async Task<(long size, bool supportsRange)> ProbeAsync(string url, int timeoutMs = 5000)
        {
            try
            {
                using var cts = new CancellationTokenSource(timeoutMs);
                var req = new HttpRequestMessage(HttpMethod.Head, url);
                using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                if (!resp.IsSuccessStatusCode) return (-1, false);
                long size = resp.Content.Headers.ContentLength ?? -1;
                bool range = resp.Headers.AcceptRanges.Contains("bytes");
                return (size, range);
            }
            catch { return (-1, false); }
        }


        private async Task<string> PickFastestSourceAsync(List<string> candidates)
        {
            var tasks = candidates.Select(async url =>
            {
                var sw = Stopwatch.StartNew();
                var (size, range) = await ProbeAsync(url);
                sw.Stop();
                return new { url, size, range, ms = sw.ElapsedMilliseconds };
            }).ToList();
            var results = await Task.WhenAll(tasks);
            var valid = results.Where(r => r.size > 0).OrderBy(r => r.ms).ToList();
            if (valid.Count == 0) return null;
            return valid[0].url;
        }

        private async Task<string> GetStringWithFallbackAsync(string[] urls, int timeoutMs = 15000)
        {
            Exception lastEx = null;
            foreach (var url in urls)
            {
                try
                {
                    using var cts = new CancellationTokenSource(timeoutMs);
                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseContentRead, cts.Token);
                    if (resp.IsSuccessStatusCode)
                    {
                        Debug.WriteLine($"[HTTP]  {url}");
                        return await resp.Content.ReadAsStringAsync();
                    }
                    Debug.WriteLine($"[HTTP] {url} → {(int)resp.StatusCode}");
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[HTTP]  {url} → {ex.Message}");
                    lastEx = ex;
                }
            }
            throw lastEx ?? new Exception("所有 URL 都无法访问");
        }

        private async Task DownloadWithAria2Async(string url, string savePath, string expectedSha1, CoreWebView2 sender, double startPct, double endPct, string label, bool forLaunch = false)
        {
            // ⭐ 统一上报：启动流程走 onLaunchProgress，下载流程走 onDownloadProgress
            async Task Report(double pct, string msg, bool done = false)
            {
                if (sender == null) return;
                if (forLaunch)
                    await ReportLaunchProgress(sender, pct, msg, done);
                else
                    await ReportProgress(sender, pct, msg, done);
            }

            var aria2 = Path.Combine(AppContext.BaseDirectory, "aria2c.exe");
            if (!File.Exists(aria2))
            {
                Debug.WriteLine("[aria2c] 未找到 aria2c.exe，回退内置引擎");
                await DownloadParallelAsync(url, savePath, (d, t, speed) =>
                {
                    if (t > 0)
                    {
                        double pct = startPct + (double)d / t * (endPct - startPct);
                        string speedText = speed > 0 ? $" · {FormatSpeed(speed)}" : "";
                        _ = Report(pct, $"{label} · {d / 1024 / 1024}MB / {t / 1024 / 1024}MB{speedText}");
                    }
                }, expectedSha1, useMultiMirror: false);

                _ = Report(endPct, $" {label} 完成");
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(savePath));

            bool isBmclapi = url.Contains("bmclapi") || url.Contains("bangbang93");
            int x = isBmclapi ? 12 : 16;
            int s = isBmclapi ? 12 : 16;

            var urlList = new List<string> { url };
            if (isBmclapi)
            {
                bool isObjectFile = url.Contains("/v1/objects/");
                bool isMavenOrAsset = url.Contains("/maven/") || url.Contains("/assets/");

                if (isObjectFile)
                {
                    var mojangUrl = url
                        .Replace("bmclapi2.bangbang93.com", "piston-data.mojang.com")
                        .Replace("openbmclapi.bangbang93.com", "piston-data.mojang.com");
                    if (!urlList.Contains(mojangUrl)) urlList.Add(mojangUrl);

                    var bmclapiMain = url.Replace("openbmclapi.bangbang93.com", "bmclapi2.bangbang93.com");
                    if (!urlList.Contains(bmclapiMain)) urlList.Add(bmclapiMain);
                }
                else if (isMavenOrAsset)
                {
                    foreach (var m in MC_MIRRORS)
                    {
                        var cand = url.Replace("bmclapi2.bangbang93.com", m);
                        if (!urlList.Contains(cand)) urlList.Add(cand);
                    }
                }
                else
                {
                    foreach (var m in MC_MIRRORS)
                    {
                        var cand = url.Replace("bmclapi2.bangbang93.com", m);
                        if (!urlList.Contains(cand)) urlList.Add(cand);
                    }
                }
            }
            string urlArgs = string.Join(" ", urlList.Select(u => $"\"{u}\""));

            var args = $"-x{x} -s{s} -c -k1M " +
              $"-j{(isBmclapi ? 6 : 26)} --min-split-size=1M " +
              $"--no-conf " +
              $"--uri-selector=adaptive " +
               $"--http-accept-gzip=false --file-allocation=none " +
               $"--summary-interval=1 --console-log-level=warn " +
               $"--auto-file-renaming=false --allow-overwrite=true --check-integrity=false " +
               $"--max-tries=10 --retry-wait=2 --connect-timeout=10 --timeout=120 " +
               $"--lowest-speed-limit=10K " +
               $"--dir=\"{Path.GetDirectoryName(savePath)}\" " +
             $"--out=\"{Path.GetFileName(savePath)}\" " +
        urlArgs;

            var psi = new ProcessStartInfo
            {
                FileName = aria2,
                Arguments = args,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8,
            };

            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var progressRegex = new Regex(@"\((\d+)%\).*?DL:([\d.]+[KMG]?i?B)", RegexOptions.Compiled);

            proc.OutputDataReceived += (s2, e) =>
            {
                if (string.IsNullOrEmpty(e.Data)) return;
                Debug.WriteLine($"[aria2c-raw] {e.Data}");

                if (e.Data.Contains("|OK  |") || e.Data.Contains("(100%)"))
                {
                    _ = Report(endPct, $"{label} · 100%");
                    return;
                }

                var m = progressRegex.Match(e.Data);
                if (m.Success)
                {
                    double pct = double.Parse(m.Groups[1].Value);
                    string speed = m.Groups[2].Value + "/s";
                    double mapped = startPct + pct / 100.0 * (endPct - startPct);
                    _ = Report(mapped, $"{label} · {pct:F0}% · {speed}");
                }
            };
            proc.ErrorDataReceived += (s2, e) => { if (!string.IsNullOrEmpty(e.Data)) Debug.WriteLine($"[aria2c] {e.Data}"); };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            long expectedSize = -1;
            try
            {
                var fi = new FileInfo(savePath);
                if (fi.Exists) expectedSize = fi.Length;
            }
            catch { }
            int timeoutSec = 300;
            if (expectedSize > 0)
                timeoutSec = (int)Math.Min(1800, Math.Max(300, expectedSize / (30 * 1024)));

            var exitTask = proc.WaitForExitAsync();
            var timeoutTask = Task.Delay(TimeSpan.FromSeconds(timeoutSec));
            // ⭐ 同时监视取消令牌：用户点叉叉就掐掉 aria2 进程
            var cancelTask = Task.Delay(Timeout.Infinite, _dlSessionToken);
            var completed = await Task.WhenAny(exitTask, timeoutTask, cancelTask);
            if (completed == cancelTask)
            {
                try { proc.Kill(true); } catch { }
                throw new OperationCanceledException();
            }
            if (completed == timeoutTask && !proc.HasExited)
            {
                try { proc.Kill(true); } catch { }
                throw new Exception($"{label} 下载超时（{timeoutSec / 60} 分钟）");
            }



            await Task.Delay(150);

         

            // ⭐ 检查 aria2 退出码，非 0 视为失败
            if (proc.ExitCode != 0)
                throw new Exception($"{label} aria2 退出码 {proc.ExitCode}");

         

            if (!File.Exists(savePath))
                throw new Exception($"{label} 下载后文件不存在");

            if (!string.IsNullOrEmpty(expectedSha1))
            {
                _ = Report(Math.Max(startPct, endPct - 1), $"{label} · 校验中...");
                if (!VerifySha1(savePath, expectedSha1))
                {
                    try { File.Delete(savePath); } catch { }
                    throw new Exception($"{label} SHA1 校验失败");
                }
            }

            _ = Report(endPct, $" {label} 完成");
        }

        private async Task DownloadParallelAsync(string url, string savePath,
            Action<long, long, double> progress, string expectedSha1 = null, bool useMultiMirror = false)
        {
            var ct = _dlSessionToken;
            Directory.CreateDirectory(Path.GetDirectoryName(savePath));
            if (File.Exists(savePath))
            {
                if (string.IsNullOrEmpty(expectedSha1) || VerifySha1(savePath, expectedSha1)) return;
                try { File.Delete(savePath); } catch { }
            }

            var mirrorUrls = new List<string>();
            if (useMultiMirror)
            {
                foreach (var m in MC_MIRRORS)
                {
                    var cand = url
                        .Replace("piston-meta.mojang.com", m)
                        .Replace("launcher.mojang.com", m)
                        .Replace("piston-data.mojang.com", m)
                        .Replace("libraries.minecraft.net", m)
                        .Replace("resources.download.minecraft.net", m);
                    if (!mirrorUrls.Contains(cand)) mirrorUrls.Add(cand);
                }
                if (!mirrorUrls.Contains(url)) mirrorUrls.Add(url);
            }
            else
            {
                mirrorUrls.Add(url);
            }

            var (size, supportsRange) = await ProbeAsync(mirrorUrls[0]);
            if (size < PARALLEL_THRESHOLD || !supportsRange)
            {
                await DownloadFileAsync(url, url, savePath, (d, t) => { progress?.Invoke(d, t, 0); }, expectedSha1);
                return;
            }

            string tempDir = savePath + ".parts";
            Directory.CreateDirectory(tempDir);
            long segSize = size / PARALLEL_SEGMENTS;
            var segTasks = new List<Task>();
            var segProgress = new long[PARALLEL_SEGMENTS];
            long totalDownloaded = 0;
            var lastReport = DateTime.Now;
            long lastBytes = 0;
            var progressLock = new object();

            for (int i = 0; i < PARALLEL_SEGMENTS; i++)
            {
                int segIndex = i;
                long start = i * segSize;
                long end = (i == PARALLEL_SEGMENTS - 1) ? size - 1 : (start + segSize - 1);
                string segPath = Path.Combine(tempDir, $"seg_{segIndex}.part");
                string segUrl = mirrorUrls[segIndex % mirrorUrls.Count];

                segTasks.Add(Task.Run(async () =>
                {
                    long expectedSegSize = end - start + 1;
                    if (File.Exists(segPath) && new FileInfo(segPath).Length == expectedSegSize)
                    {
                        segProgress[segIndex] = expectedSegSize;
                        Interlocked.Add(ref totalDownloaded, expectedSegSize);
                        return;
                    }
                    for (int retry = 0; retry < 3; retry++)
                    {
                        try
                        {
                            long already = File.Exists(segPath) ? new FileInfo(segPath).Length : 0;
                            long reqStart = start + already;
                            if (reqStart > end) reqStart = end;
                            var req = new HttpRequestMessage(HttpMethod.Get, segUrl);
                            req.Headers.Range = new RangeHeaderValue(reqStart, end);
                            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                            if (resp.StatusCode != System.Net.HttpStatusCode.PartialContent &&
                                resp.StatusCode != System.Net.HttpStatusCode.OK)
                                resp.EnsureSuccessStatusCode();
                            using var stream = await resp.Content.ReadAsStreamAsync();
                            using var fs = new FileStream(segPath, already > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write);
                            var buffer = new byte[131072];
                            int read;
                            long localDone = already;
                            while ((read = await stream.ReadAsync(buffer, 0, buffer.Length, ct)) > 0)
                            {
                                await fs.WriteAsync(buffer, 0, read, ct);
                                localDone += read;
                                segProgress[segIndex] = localDone;
                                Interlocked.Add(ref totalDownloaded, read);
                              
                                lock (progressLock)
                                {
                                    var now = DateTime.Now;
                                    if ((now - lastReport).TotalMilliseconds >= 300)
                                    {
                                        double secs = (now - lastReport).TotalSeconds;
                                        double speed = (totalDownloaded - lastBytes) / secs;
                                        progress?.Invoke(totalDownloaded, size, speed);
                                        lastReport = now;
                                        lastBytes = totalDownloaded;
                                    }
                                }
                            }
                            return;
                        }
                        catch
                        {
                            if (mirrorUrls.Count > 1)
                            {
                                segUrl = mirrorUrls[(segIndex + retry + 1) % mirrorUrls.Count];
                            }
                            await Task.Delay(300);
                        }
                    }
                    throw new Exception($"分片 {segIndex} 下载失败");
                }));
            }

            try { await Task.WhenAll(segTasks); }
            catch { try { Directory.Delete(tempDir, true); } catch { } throw; }

            // ⭐ 用户点了取消：删掉分段临时文件和半成品，别再合并
            if (ct.IsCancellationRequested)
            {
                try { if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true); } catch { }
                try { if (File.Exists(savePath)) File.Delete(savePath); } catch { }
                ct.ThrowIfCancellationRequested();
            }

            progress?.Invoke(size, size, 0);

            using (var output = new FileStream(savePath, FileMode.Create, FileAccess.Write))
            {
                for (int i = 0; i < PARALLEL_SEGMENTS; i++)
                {
                    string segPath = Path.Combine(tempDir, $"seg_{i}.part");
                    using var segFs = File.OpenRead(segPath);
                    await segFs.CopyToAsync(output);
                }
            }
            try { Directory.Delete(tempDir, true); } catch { }

            if (!string.IsNullOrEmpty(expectedSha1) && !VerifySha1(savePath, expectedSha1))
            {
                try { File.Delete(savePath); } catch { }
                throw new Exception("SHA1 校验失败");
            }
        }

        // ⭐ 核心下载器：支持多源回退（先测官方，不行换镜像）
        // ⭐ 1. 兼容旧写法的过渡方法（只需传 4 个参数，自动双源，就是为了消掉你的红线）
        private async Task DownloadFileAsync(string url, string savePath, Action<long, long> progress, string expectedSha1 = null)
        {
            var ct = _dlSessionToken;
            await DownloadFileAsync(url, url, savePath, progress, expectedSha1);
        }

        // ⭐ 2. 核心下载器：支持多源回退（5 个参数）
        private async Task DownloadFileAsync(string primaryUrl, string fallbackUrl, string savePath, Action<long, long> progress, string expectedSha1 = null, bool forceHttp11 = false)
        {
            var ct = _dlSessionToken;
            Directory.CreateDirectory(Path.GetDirectoryName(savePath));
            if (File.Exists(savePath))
            {
                if (string.IsNullOrEmpty(expectedSha1) || VerifySha1(savePath, expectedSha1)) return;
                try { File.Delete(savePath); } catch { }
            }

            string partPath = savePath + ".part";
            long existingSize = File.Exists(partPath) ? new FileInfo(partPath).Length : 0;

            await _httpGate.WaitAsync(ct);
            try
            {
                var urls = new List<string> { primaryUrl };
                if (!string.IsNullOrEmpty(fallbackUrl) && primaryUrl != fallbackUrl) urls.Add(fallbackUrl);

                for (int i = 0; i < urls.Count; i++)
                {
                    string currentUrl = urls[i];
                    for (int retry = 0; retry < 2; retry++)
                    {
                        try
                        {
                            var req = new HttpRequestMessage(HttpMethod.Get, currentUrl);
                            if (existingSize > 0) req.Headers.Range = new RangeHeaderValue(existingSize, null);

                            // ⭐ 强制 HTTP/1.1：让每个请求独占一条 TCP 连接，不被 HTTP/2 多路复用挤成一根管子
                            if (forceHttp11)
                            {
                                req.Version = System.Net.HttpVersion.Version11;
                                req.VersionPolicy = HttpVersionPolicy.RequestVersionExact;
                            }

                            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

                            if (forceHttp11 && Interlocked.Increment(ref _http11LogCount) <= 3)
                                Debug.WriteLine($"[DL] 协议={resp.Version} · 单文件={(resp.Content.Headers.ContentLength ?? -1) / 1024} KB · {Path.GetFileName(savePath)}");

                            if (resp.StatusCode == System.Net.HttpStatusCode.RequestedRangeNotSatisfiable)
                            {
                                try { File.Delete(partPath); } catch { }
                                existingSize = 0;
                                await Task.Delay(300);
                                continue;
                            }

                            if (!resp.IsSuccessStatusCode && resp.StatusCode != System.Net.HttpStatusCode.PartialContent)
                                resp.EnsureSuccessStatusCode();

                            bool append = resp.StatusCode == System.Net.HttpStatusCode.PartialContent;
                            if (!append) existingSize = 0;
                            long totalBytes = (resp.Content.Headers.ContentLength ?? -1) + (append ? existingSize : 0);
                            long downloaded = existingSize;

                            using (var stream = await resp.Content.ReadAsStreamAsync())
                            using (var file = new FileStream(partPath, append ? FileMode.Append : FileMode.Create, FileAccess.Write))
                            {
                                var buffer = new byte[131072];
                                int read;
                                var localLastReport = DateTime.MinValue;
                                while ((read = await stream.ReadAsync(buffer, 0, buffer.Length, ct)) > 0)
                                {
                                    await file.WriteAsync(buffer, 0, read, ct);
                                    downloaded += read;
                                    Interlocked.Add(ref _totalBytesDownloaded, read);

                                    if ((DateTime.Now - localLastReport).TotalMilliseconds >= 100)
                                    {
                                        localLastReport = DateTime.Now;
                                        progress?.Invoke(downloaded, totalBytes);
                                    }
                                }
                            }

                            if (File.Exists(savePath)) File.Delete(savePath);
                            File.Move(partPath, savePath);

                            if (!string.IsNullOrEmpty(expectedSha1) && !VerifySha1(savePath, expectedSha1))
                                throw new Exception("SHA1 校验失败");

                            return;
                        }
                        catch (OperationCanceledException)
                        {
                            try { if (File.Exists(savePath)) File.Delete(savePath); if (File.Exists(savePath + ".part")) File.Delete(savePath + ".part"); } catch { }
                            throw;
                        }
                        catch (Exception ex)
                        {
                            var _why = ex.Message.IndexOf("404", StringComparison.Ordinal) >= 0 ? "该源没有此文件(404)"
                                : (ex is TaskCanceledException || ex.Message.IndexOf("timeout", StringComparison.OrdinalIgnoreCase) >= 0) ? "超时"
                                : "校验或传输失败";
                            Debug.WriteLine($"[DL] 源 {i + 1} 失败: {Path.GetFileName(savePath)} — {_why}");
                            existingSize = File.Exists(partPath) ? new FileInfo(partPath).Length : 0;
                            await Task.Delay(500);
                        }
                    }
                }
                try { File.AppendAllText(Path.Combine(GetMcDir(), "failed.txt"), primaryUrl + Environment.NewLine); } catch { }
            }
            finally
            {
                _httpGate.Release();
            }
        }

        private bool VerifySha1(string path, string expectedSha1)
        {
            try
            {
                using var sha1 = SHA1.Create();
                using var fs = File.OpenRead(path);
                var hash = sha1.ComputeHash(fs);
                var actual = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
                return actual == expectedSha1.ToLowerInvariant();
            }
            catch { return false; }
        }

        private string FormatSpeed(double bytesPerSec)
        {
            if (bytesPerSec < 1024) return $"{bytesPerSec:F0} B/s";
            if (bytesPerSec < 1024 * 1024) return $"{bytesPerSec / 1024:F1} KB/s";
            return $"{bytesPerSec / 1024 / 1024:F2} MB/s";
        }

        // =========================================================
        // 下载 MC + 加载器
        // =========================================================

        private async Task DownloadAndInstallAsync(string versionId, string versionUrl, string loader, string loaderVersion, CoreWebView2 sender)
        {
            if (!await TryEnterDownloadLock(sender)) return;
            try
            {
                bool hasLoader = !string.IsNullOrEmpty(loader) && loader != "none";
                double vanillaEnd = hasLoader ? 70.0 : 100.0;

                await DownloadMinecraftVersionAsync(versionId, versionUrl, sender, vanillaEnd);

                if (hasLoader)
                {
                    await ReportProgress(sender, vanillaEnd, $"开始安装 {loader}...");
                    await Task.Delay(500);
                    try
                    {
                        await InstallLoaderAsync(loader, versionId, sender,
                          reportDone: false,
                          startPct: vanillaEnd, endPct: 100.0,
                          acquireLock: false,
                          specificVersion: loaderVersion);
                    }
                    catch (Exception ex)
                    {
                        DiagnosticLogger.Instance.Info($"[Loader] {ex}");
                        await ReportProgress(sender, vanillaEnd, $"⚠️ 加载器安装失败：{ex.Message}");
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync("scanInstalledToHome()"); });
                        return;
                    }
                }

                await ReportProgress(sender, 100, " 全部完成", done: true);
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("scanInstalledToHome()"); });
            }
            finally
            {
                await ExitDownloadLock(sender);
            }
        }

        /// <summary>
        /// NeoForge 版本号规则：MC 1.20.4 -> "20.4.xxx"；1.21.1 -> "21.1.xxx"。
        /// 返回 null 表示该 MC 版本没有 NeoForge（例如 1.20.1）。
        /// </summary>
        /// <summary>
        /// 自动内存分配（与前端 calcAutoMemoryMB 完全一致）：
        /// ≤8G 取 30%，≤16G 取 40%，≤32G 取 50%，更大取 55%；
        /// 按 256MB 对齐，限制在 1024–8192MB。
        /// </summary>
        private static int CalcAutoMemoryMB()
        {
            int total = NativeMemory.GetTotalPhysicalMemoryMB();
            if (total <= 0) return 4096;

            double ratio = total <= 8192 ? 0.30
                         : total <= 16384 ? 0.40
                         : total <= 32768 ? 0.50
                         : 0.55;

            int mb = (int)(Math.Floor(total * ratio / 256.0) * 256);
            if (mb < 1024) mb = 1024;
            if (mb > 8192) mb = 8192;
            return mb;
        }

        /// <summary>是否是标准 MC 版本号，如 1.12.2 / 1.20.1 / 26.2。</summary>
        private static bool IsMcVersionLike(string v)
        {
            if (string.IsNullOrWhiteSpace(v)) return false;
            return System.Text.RegularExpressions.Regex.IsMatch(v, @"^\d+\.\d+(\.\d+)?$");
        }

        private static string NeoPrefixFor(string mcVersion)
        {
            if (string.IsNullOrWhiteSpace(mcVersion)) return null;
            var parts = mcVersion.Split('.');
            if (parts.Length >= 3 && parts[0] == "1") return parts[1] + "." + parts[2] + ".";
            if (parts.Length == 2) return parts[0] + "." + parts[1] + ".";   // 新版本号体系，如 26.2
            return null;
        }

        private async Task FetchLoaderVersionsAsync(string loader, string baseVersion, CoreWebView2 sender)
        {
            Debug.WriteLine($"[LoaderVersions] ⭐ 开始获取 {loader} 的版本列表...");
            try
            {
                var versions = new List<string>();

                if (loader == "fabric")
                {
                    var url = $"https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/{baseVersion}";
                    Debug.WriteLine($"[LoaderVersions] ⭐ 正在请求网络...");

                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    var respTask = _http.SendAsync(req);

                    // ⭐ 核心强杀：如果 3 秒没响应，直接抛弃
                    if (await Task.WhenAny(respTask, Task.Delay(3000)) != respTask)
                        throw new TimeoutException("请求超时，可能被网络拦截");

                    var resp = await respTask;
                    if (resp.IsSuccessStatusCode)
                    {
                        var json = await resp.Content.ReadAsStringAsync();
                        var arr = JsonDocument.Parse(json).RootElement;
                        foreach (var item in arr.EnumerateArray())
                        {
                            var v = item.GetProperty("loader").GetProperty("version").GetString();
                            if (!string.IsNullOrEmpty(v)) versions.Add(v);
                        }
                    }
                }
                else if (loader == "forge")
                {
                    var url = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
                    Debug.WriteLine($"[LoaderVersions] ⭐ 正在请求网络...");

                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    var respTask = _http.SendAsync(req);

                    if (await Task.WhenAny(respTask, Task.Delay(3000)) != respTask)
                        throw new TimeoutException("请求超时，可能被网络拦截");

                    var resp = await respTask;
                    if (resp.IsSuccessStatusCode)
                    {
                        var text = await resp.Content.ReadAsStringAsync();
                        var json = JsonDocument.Parse(text).RootElement;
                        if (json.TryGetProperty(baseVersion, out var versArr))
                        {
                            var tempList = new List<string>();
                            foreach (var v in versArr.EnumerateArray())
                            {
                                var verStr = v.GetString();
                                if (!string.IsNullOrEmpty(verStr))
                                {
                                    if (verStr.StartsWith(baseVersion + "-"))
                                        tempList.Add(verStr.Substring(baseVersion.Length + 1));
                                    else if (!verStr.Contains("-"))
                                        tempList.Add(verStr); // 只有纯 loader 版本号才采用，别的 MC 版本一律丢弃
                                }
                            }
                            tempList.Reverse();
                            versions.AddRange(tempList);
                        }
                    }
                }
                else if (loader == "neoforge")
                {
                    var url = $"https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/maven-metadata.xml";
                    Debug.WriteLine($"[LoaderVersions] ⭐ 正在请求网络...");

                    var req = new HttpRequestMessage(HttpMethod.Get, url);
                    var respTask = _http.SendAsync(req);

                    if (await Task.WhenAny(respTask, Task.Delay(3000)) != respTask)
                        throw new TimeoutException("请求超时，可能被网络拦截");

                    var resp = await respTask;
                    if (resp.IsSuccessStatusCode)
                    {
                        var xml = await resp.Content.ReadAsStringAsync();
                        var matches = Regex.Matches(xml, @"<version>([^<]+)</version>");
                        var tempList = new List<string>();
                        foreach (Match m in matches)
                        {
                            var v = m.Groups[1].Value;
                            if (NeoPrefixFor(baseVersion) is string neoPrefix && v.StartsWith(neoPrefix, StringComparison.Ordinal))
                                tempList.Add(v);
                        }
                        tempList.Reverse();
                        versions.AddRange(tempList);
                    }
                }

                Debug.WriteLine($"[LoaderVersions] ⭐ {loader} 成功获取 {versions.Count} 个版本");
                var jsonResp = JsonSerializer.Serialize(new { ok = true, versions = versions }, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onLoaderVersions({jsonResp})"); });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[LoaderVersions] ❌ 获取失败: {ex.Message}");
                var jsonResp = JsonSerializer.Serialize(new { ok = false, error = ex.Message }, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onLoaderVersions({jsonResp})"); });
            }
        }

        private async Task InstallLoaderAsync(string loader, string baseVersion, CoreWebView2 sender,
                      bool reportDone = true,
                      double startPct = 0, double endPct = 100,
                      bool acquireLock = true,
                      string specificVersion = null) 
        {
            if (acquireLock && !await TryEnterDownloadLock(sender)) return;
            try
            {
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    try
                    {
                        switch (loader)
                        {
                            case "fabric": await InstallFabricAsync(baseVersion, sender, startPct, endPct, specificVersion); break;
                            case "forge": await InstallForgeAsync(baseVersion, sender, startPct, endPct, specificVersion); break;
                            case "neoforge": await InstallNeoForgeAsync(baseVersion, sender, startPct, endPct, specificVersion); break;
                            default: await ReportProgress(sender, startPct, $"⚠️ 未知加载器：{loader}"); break;
                        }
                        break;  // 成功，跳出重试循环
                    }
                    catch (Exception ex)
                    {
                        if (attempt == 0)
                        {
                            DiagnosticLogger.Instance.Info($"[Loader] {loader} 第 1 次失败，2 秒后重试：{ex.Message}");
                            await ReportProgress(sender, startPct, "第 1 次失败，正在重试...");
                            await RunOnUI(() => {
                                _ = sender.ExecuteScriptAsync("showSideToast('加载器重试', '第 1 次失败，正在重试...', 0)");
                            });
                            await Task.Delay(2000);
                        }
                        else
                        {
                            throw;
                        }
                    }
                }

                if (reportDone)
                    await ReportProgress(sender, 100, " 加载器安装完成", done: true);
            }
            finally
            {
                if (acquireLock) await ExitDownloadLock(sender);
            }
        }

        private async Task<string> GetFabricApiVersionAsync(string mcVersion)
        {
            try
            {
                var url = $"https://api.modrinth.com/v2/project/fabric-api/version?game_versions=[%22{mcVersion}%22]&loaders=[%22fabric%22]";
                var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("User-Agent", "illusionLauncher/1.0.0 (contact@example.com)");

                var resp = await _http.SendAsync(req);
                if (!resp.IsSuccessStatusCode)
                {
                    Debug.WriteLine($"[FabricAPI] 查询 HTTP 失败：{resp.StatusCode}");
                    return null;
                }

                var text = await resp.Content.ReadAsStringAsync();
                var arr = JsonDocument.Parse(text).RootElement;
                if (arr.GetArrayLength() == 0)
                {
                    Debug.WriteLine($"[FabricAPI] 没有找到 {mcVersion} 的 Fabric API");
                    return null;
                }

                var first = arr.EnumerateArray().First();
                var versionNumber = first.GetProperty("version_number").GetString();
                Debug.WriteLine($"[FabricAPI] 找到版本：{versionNumber}");
                return versionNumber;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[FabricAPI] 查询失败：{ex.Message}");
                return null;
            }
        }

        private async Task InstallFabricAsync(string baseVersion, CoreWebView2 sender, double startPct = 0, double endPct = 100, string specificVersion = null)
        {
            double S(double p) => startPct + (endPct - startPct) * p / 100.0;
            var mcDir = GetMcDir();
            await ReportProgress(sender, S(0), "获取 Fabric Loader 版本...");

            var loaderListJson = await _http.GetStringAsync($"https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/{baseVersion}");
            var loaderArr = JsonDocument.Parse(loaderListJson).RootElement;
            if (loaderArr.GetArrayLength() == 0)
                throw new Exception($"Fabric 不支持 {baseVersion}");
            string loaderVer;
            if (!string.IsNullOrEmpty(specificVersion))
            {
                loaderVer = specificVersion;
            }
            else
            {
                loaderVer = loaderArr[0].GetProperty("loader").GetProperty("version").GetString();
            }

            await ReportProgress(sender, S(10), $"获取 Fabric {loaderVer} profile...");
            var profileUrl = $"https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/{baseVersion}/{loaderVer}/profile/json";
            var profileJson = await _http.GetStringAsync(profileUrl);

            var fabricVersionId = $"fabric-loader-{loaderVer}-{baseVersion}";
            var versionDir = Path.Combine(mcDir, "versions", fabricVersionId);
            Directory.CreateDirectory(versionDir);
            var profilePath = Path.Combine(versionDir, fabricVersionId + ".json");
            await File.WriteAllTextAsync(profilePath, profileJson);

            var root = JsonDocument.Parse(profileJson).RootElement;
            if (root.TryGetProperty("libraries", out var libs))
            {
                int total = libs.GetArrayLength();
                int done = 0;
                var sem = new SemaphoreSlim(LIB_CONCURRENCY);
                var tasks = new List<Task>();

                foreach (var lib in libs.EnumerateArray())
                {
                    var libLocal = lib;
                    await sem.WaitAsync();
                    tasks.Add(Task.Run(async () =>
                    {
                        try
                        {
                            var name = libLocal.GetProperty("name").GetString();
                            var parts = name.Split(':');
                            if (parts.Length < 3) return;
                            var group = parts[0].Replace('.', '/');
                            var artifact = parts[1];
                            var version = parts[2];
                            var jarName = $"{artifact}-{version}.jar";
                            var libPath = $"{group}/{artifact}/{version}/{jarName}";
                            var savePath = Path.Combine(mcDir, "libraries", libPath);
                            var url = $"https://bmclapi2.bangbang93.com/maven/{libPath}";

                            try
                            {
                                // ⭐ 这一段是核心，带时间防抖和带小数点的平滑进度
                                await DownloadFileAsync(url, savePath, (downloaded, fileTotal) =>
                                {
                                    if (fileTotal > 0)
                                    {
                                        double currentFilePct = (double)downloaded / fileTotal;
                                        double overallPct = S(10) + (((double)done + currentFilePct) / total) * (S(60) - S(10));

                                        // 限制每 100 毫秒刷新一次，防止卡死
                                        if ((DateTime.Now - _lastLibReport).TotalMilliseconds >= 100)
                                        {
                                            _lastLibReport = DateTime.Now;
                                            _ = ReportProgress(sender, overallPct, $"Fabric 依赖库 {overallPct:F1}%");
                                        }
                                    }
                                });
                            }
                            catch { Debug.WriteLine($"[Fabric Lib] 失败：{url}"); }
                        }
                        catch { }
                        finally
                        {
                            sem.Release();
                            int d = Interlocked.Increment(ref done);

                            // 保底：当一个文件下完，更新一次进度
                            if (d == total)
                                _ = ReportProgress(sender, S(60), "Fabric 依赖库 100.0%");
                            else
                            {
                                double pct = S(10) + (double)d / total * (S(60) - S(10));
                                _ = ReportProgress(sender, pct, $"Fabric 依赖库 {pct:F1}%");
                            }
                        }
                    }));
                }
                await Task.WhenAll(tasks);
            }

            try
            {
                var parentJar = Path.Combine(mcDir, "versions", baseVersion, baseVersion + ".jar");
                var fabricJar = Path.Combine(versionDir, fabricVersionId + ".jar");
                if (File.Exists(parentJar))
                {
                    File.Copy(parentJar, fabricJar, true);
                    Debug.WriteLine($"[Fabric] 复制原版 jar → {fabricJar}");
                }

                var parentNatives = Path.Combine(mcDir, "versions", baseVersion, "natives");
                var fabricNatives = Path.Combine(versionDir, "natives");
                if (Directory.Exists(parentNatives))
                {
                    CopyDirectory(parentNatives, fabricNatives);
                    Debug.WriteLine($"[Fabric] 复制 natives → {fabricNatives}");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Fabric] 扁平化复制失败：{ex.Message}");
            }

            try
            {
                var apiVersion = await GetFabricApiVersionAsync(baseVersion);
                if (!string.IsNullOrEmpty(apiVersion))
                {
                    await ReportProgress(sender, S(70), $"下载 Fabric API {apiVersion}...");

                    var apiUrl = $"https://api.modrinth.com/v2/project/fabric-api/version/{apiVersion}";
                    var req = new HttpRequestMessage(HttpMethod.Get, apiUrl);
                    req.Headers.Add("User-Agent", "illusionLauncher/1.0.0 (contact@example.com)");
                    var resp = await _http.SendAsync(req);
                    var text = await resp.Content.ReadAsStringAsync();
                    var json = JsonDocument.Parse(text).RootElement;

                    var files = json.GetProperty("files");
                    JsonElement primary = default;
                    bool found = false;
                    foreach (var f in files.EnumerateArray())
                    {
                        if (f.TryGetProperty("primary", out var p) && p.GetBoolean())
                        {
                            primary = f;
                            found = true;
                            break;
                        }
                    }
                    if (!found) primary = files.EnumerateArray().First();

                    var downloadUrl = primary.GetProperty("url").GetString();
                    var fileName = primary.GetProperty("filename").GetString();

                    var modsDir = Path.Combine(versionDir, "mods");
                    Directory.CreateDirectory(modsDir);
                    var savePath = Path.Combine(modsDir, fileName);

                    Debug.WriteLine($"[FabricAPI] 下载：{downloadUrl}");
                    await DownloadWithAria2Async(downloadUrl, savePath, null, sender, S(70), S(99), $"Fabric API {apiVersion}");
                    Debug.WriteLine($"[FabricAPI]  已下载 {fileName} → {modsDir}");
                }
                else
                {
                    Debug.WriteLine($"[FabricAPI] ⚠️ 未找到 {baseVersion} 对应的 Fabric API，跳过");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[FabricAPI]  下载失败：{ex.Message}");
            }

            await ReportProgress(sender, S(100), $" Fabric {loaderVer} 安装完成", done: false);
        }

        private void CopyDirectory(string sourceDir, string destDir)
        {
            Directory.CreateDirectory(destDir);
            foreach (var file in Directory.GetFiles(sourceDir))
            {
                var dest = Path.Combine(destDir, Path.GetFileName(file));
                File.Copy(file, dest, true);
            }
            foreach (var dir in Directory.GetDirectories(sourceDir))
            {
                var dest = Path.Combine(destDir, Path.GetFileName(dir));
                CopyDirectory(dir, dest);
            }
        }

        private bool IsForgeLegacy(string baseVersion)
        {
            // ⭐ 只对 1.12.2 及以下老版本判定为 legacy；其余（26.x 等）一律走 modern
            if (!baseVersion.StartsWith("1.")) return false;

            // 1.12.2 及以下走老格式 installer
            var parts = baseVersion.Split('.');
            if (parts.Length < 2) return false;
            if (!int.TryParse(parts[1], out int minor)) return false;
            if (minor > 12) return false;
            if (minor < 12) return true;   // 1.7 ~ 1.11

            // 1.12.x
            int patch = parts.Length >= 3 && int.TryParse(parts[2], out int p) ? p : 0;
            return patch <= 2;
        }


        private async Task InstallForgeLegacyAsync(string installerPath, string versionId, string mcDir, CoreWebView2 sender, double startPct, double endPct)
        {
            double S(double p) => startPct + (endPct - startPct) * p / 100.0;
            await ReportProgress(sender, S(1), $"解析老版 Forge installer...");

            var tempDir = Path.Combine(Path.GetTempPath(), "forge_legacy_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);
            try
            {
                // 1. 解压 installer
                using (var zip = ZipFile.OpenRead(installerPath))
                {
                    foreach (var entry in zip.Entries)
                    {
                        var destPath = Path.Combine(tempDir, entry.FullName);
                        if (string.IsNullOrEmpty(entry.Name))
                            Directory.CreateDirectory(destPath);
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                            entry.ExtractToFile(destPath, true);
                        }
                    }
                }
                Debug.WriteLine($"[ForgeLegacy]  解压完成");

                // 2. 读 install_profile.json
                var profilePath = Path.Combine(tempDir, "install_profile.json");
                if (!File.Exists(profilePath))
                    throw new Exception("install_profile.json 不存在");
                var profile = JsonDocument.Parse(await File.ReadAllTextAsync(profilePath)).RootElement;

                await ReportProgress(sender, S(5), "复制 Forge 核心...");

                // 3. 判断 1.7.10 还是 1.12.2 格式
                string installFilePath = null;
                string versionJsonText = null;

                if (profile.TryGetProperty("install", out var install))
                {
                    // 1.7.10 格式：install.filePath + versionInfo
                    installFilePath = install.TryGetProperty("filePath", out var fp) ? fp.GetString() : null;
                    if (profile.TryGetProperty("versionInfo", out var vi))
                        versionJsonText = vi.GetRawText();
                }
                else
                {
                    // 1.12.2 格式：profile.json + version.json
                    var vjPath = Path.Combine(tempDir, "version.json");
                    if (File.Exists(vjPath)) versionJsonText = await File.ReadAllTextAsync(vjPath);
                }

                if (string.IsNullOrEmpty(versionJsonText))
                    throw new Exception("installer 里找不到版本 JSON");

                // 4. 从 installer 里解压 forge universal jar 到 libraries

                // installer 根目录下就是 maven 布局（org/ com/ net/ argo/ joptsimple/ ...）
                var libsRoot = Path.Combine(mcDir, "libraries");
                var mavenDirs = new[] { "org", "com", "net", "argo", "joptsimple", "java3d", "io", "it", "tv", "lzma", "oshi-project" };
                foreach (var d in mavenDirs)
                {
                    var src = Path.Combine(tempDir, d);
                    if (Directory.Exists(src))
                    {
                        CopyDirectory(src, Path.Combine(libsRoot, d));
                    }
                }
                // 另外 maven/ 目录如果有也复制
                // installer 根目录下就是 maven 布局
               
                foreach (var d in new[] { "org", "com", "net", "argo", "joptsimple", "java3d", "io", "it", "tv", "lzma", "oshi-project" })
                {
                    var src = Path.Combine(tempDir, d);
                    if (Directory.Exists(src))
                        CopyDirectory(src, Path.Combine(libsRoot, d));
                }
                Debug.WriteLine($"[ForgeLegacy]  复制内嵌 maven");

                JsonElement viDebug = default;
                bool hasViDebug = profile.TryGetProperty("versionInfo", out viDebug);
                Debug.WriteLine($"[ForgeLegacy] profile 类型={profile.ValueKind}, 有 versionInfo={hasViDebug}");
                if (hasViDebug && viDebug.ValueKind != JsonValueKind.Undefined)
                {
                    JsonElement libDebug = default;
                    bool hasLibDebug = viDebug.TryGetProperty("libraries", out libDebug);
                    int count = hasLibDebug && libDebug.ValueKind == JsonValueKind.Array ? libDebug.GetArrayLength() : -1;
                    Debug.WriteLine($"[ForgeLegacy] versionInfo 有 libraries={hasLibDebug}, 数量={count}");
                }


                // ⭐ 下载 libraries（带 url 的从 maven 下）
                if (profile.TryGetProperty("versionInfo", out var viRoot) &&
                    viRoot.TryGetProperty("libraries", out var libsArr))
                {
                    int total = libsArr.GetArrayLength();
                    int done = 0;
                    var libTasks = new List<Task>();

                    foreach (var lib in libsArr.EnumerateArray())
                    {
                        var libLocal = lib;
                        libTasks.Add(Task.Run(async () =>
                        {
                            try
                            {
                                var libName = libLocal.TryGetProperty("name", out var n) ? n.GetString() : null;
                                if (string.IsNullOrEmpty(libName)) return;

                                var parts = libName.Split(':');
                                if (parts.Length < 3) return;
                                var group = parts[0].Replace('.', '/');
                                var artifact = parts[1];
                                var ver = parts[2];

                                var jarName = $"{artifact}-{ver}.jar";
                                var libPath = Path.Combine(mcDir, "libraries", group, artifact, ver, jarName);
                                if (File.Exists(libPath)) return;

                                var mavenUrl = libLocal.TryGetProperty("url", out var u) ? u.GetString() : null;
                                if (string.IsNullOrEmpty(mavenUrl))
                                    mavenUrl = "https://maven.minecraftforge.net/";

                                var url = mavenUrl.TrimEnd('/') + "/" + $"{group}/{artifact}/{ver}/{jarName}";
                                var bmclUrl = url.Replace("maven.minecraftforge.net", "bmclapi2.bangbang93.com/maven")
                                                 .Replace("libraries.minecraft.net", "bmclapi2.bangbang93.com/maven");

                                await DownloadFileAsync(bmclUrl, libPath, (downloaded, fileTotal) =>
                                {
                                    if (fileTotal > 0 && (DateTime.Now - _lastLibReport).TotalMilliseconds >= 100)
                                    {
                                        _lastLibReport = DateTime.Now;
                                        // ⭐ 平滑映射算法
                                        double currentFilePct = (double)downloaded / fileTotal;
                                        double overallPct = S(10) + (((double)done + currentFilePct) / total) * (S(60) - S(10));
                                        _ = ReportProgress(sender, overallPct, $"Forge 依赖库 {overallPct:F1}%");
                                    }
                                });
                            }
                            catch (Exception ex)
                            {
                                Debug.WriteLine($"[ForgeLegacy] ⚠️ 库下载失败: {ex.Message}");
                            }
                            finally
                            {
                                int d = Interlocked.Increment(ref done);
                                double pct = S(10) + (double)d / total * (S(60) - S(10));
                                if (d == total) _ = ReportProgress(sender, S(60), "Forge 依赖库 100.0%");
                                else _ = ReportProgress(sender, pct, $"Forge 依赖库 {pct:F1}%");
                            }
                        }));
                    }
                    await Task.WhenAll(libTasks);
                }

                //    版本号从 versionId 提取：{mc}-forge-{forgeVer}
                var forgeVer = versionId.Substring(versionId.IndexOf("-forge-") + 7);
                var libDir = Path.Combine(mcDir, "libraries", "net", "minecraftforge", "forge", forgeVer);
                Directory.CreateDirectory(libDir);

                // 找 installer 里的 universal jar（可能在根目录或 maven/ 下）
                string universalSrc = null;
                if (!string.IsNullOrEmpty(installFilePath))
                {
                    universalSrc = Path.Combine(tempDir, installFilePath.Replace('/', Path.DirectorySeparatorChar));
                }
                if (universalSrc == null || !File.Exists(universalSrc))
                {
                    // 兜底：找 installer 里所有 forge-*.jar
                    var found = Directory.GetFiles(tempDir, "forge-*.jar", SearchOption.AllDirectories)
                        .FirstOrDefault(f => !f.EndsWith("-installer.jar", StringComparison.OrdinalIgnoreCase));
                    if (found != null) universalSrc = found;
                }
                if (universalSrc == null || !File.Exists(universalSrc))
                    throw new Exception("installer 里找不到 forge universal jar");

                var universalDst = Path.Combine(libDir, $"forge-{forgeVer}.jar");
                File.Copy(universalSrc, universalDst, true);
                Debug.WriteLine($"[ForgeLegacy]  universal jar → {universalDst}");

                // 5. 写版本 JSON 到 versions/<versionId>/
                await ReportProgress(sender, S(80), "写入版本文件...");
                var versionDir = Path.Combine(mcDir, "versions", versionId);
                Directory.CreateDirectory(versionDir);

                // ⭐ 改 id 为文件夹名（老 JSON 里的 id 可能不一样）
                try
                {
                    var doc = JsonDocument.Parse(versionJsonText);
                    var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(versionJsonText);
                    if (dict != null)
                    {
                        dict["id"] = JsonSerializer.SerializeToElement(versionId);
                        versionJsonText = JsonSerializer.Serialize(dict, new JsonSerializerOptions { WriteIndented = true });
                    }
                }
                catch { }

                var finalJsonPath = Path.Combine(versionDir, versionId + ".json");
                await File.WriteAllTextAsync(finalJsonPath, versionJsonText);
                Debug.WriteLine($"[ForgeLegacy]  版本 JSON → {finalJsonPath}");

                await ReportProgress(sender, S(100), $" {versionId} 安装完成");
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }
        }

        private async Task InstallForgeAsync(string baseVersion, CoreWebView2 sender, double startPct = 0, double endPct = 100, string specificVersion = null)
        {
            double S(double p) => startPct + (endPct - startPct) * p / 100.0;
            var mcDir = GetMcDir();
            await ReportProgress(sender, S(0), "查询 Forge 版本（国内可能较慢）...");

            var mavenUrls = new[]
 {
            "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
            "https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/maven-metadata.xml",
        };
            string xml;
            try
            {
                xml = await GetStringWithFallbackAsync(mavenUrls, 20000);
            }
            catch (Exception ex)
            {
                throw new Exception($"无法连接 Forge 版本服务器：{ex.Message}");
            }

            var candidates = new List<string>();
            var prefix = baseVersion + "-";

            var trimmed = xml.TrimStart();
            if (trimmed.StartsWith("{"))
            {
                // 官方 JSON：{"1.12.2": ["14.23.5.2860", ...], ...}
                try
                {
                    var json = JsonDocument.Parse(xml).RootElement;
                    if (json.TryGetProperty(baseVersion, out var versArr))
                    {
                        foreach (var v in versArr.EnumerateArray())
                        {
                            var verStr = v.GetString();
                            if (string.IsNullOrEmpty(verStr)) continue;

                            // ⭐ 值里可能已带 "MC版本-" 前缀，避免重复
                            if (verStr.StartsWith(baseVersion + "-", StringComparison.OrdinalIgnoreCase))
                                candidates.Add(verStr);
                            else
                                candidates.Add($"{baseVersion}-{verStr}");
                        }
                    }
                    Debug.WriteLine($"[Forge] JSON 解析：{baseVersion} 共 {candidates.Count} 个版本");
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Forge] JSON 解析失败：{ex.Message}，回退 XML");
                    var matches2 = Regex.Matches(xml, @"<version>([^<]+)</version>");
                    foreach (Match m in matches2)
                    {
                        var v = m.Groups[1].Value;
                        if (v.StartsWith(prefix)) candidates.Add(v);
                    }
                }
            }
            else
            {
                // BMCLAPI XML 回退
                var matches = Regex.Matches(xml, @"<version>([^<]+)</version>");
                foreach (Match m in matches)
                {
                    var v = m.Groups[1].Value;
                    if (v.StartsWith(prefix)) candidates.Add(v);
                }
            }
            if (candidates.Count == 0)
                throw new Exception($"Forge 没有匹配 {baseVersion} 的版本（1.12.2 及以下老版本暂不支持）");

            candidates.Sort((a, b) =>
            {
                var pa = ParseForgeVersion(a);
                var pb = ParseForgeVersion(b);
                for (int i = 0; i < Math.Min(pa.Length, pb.Length); i++)
                    if (pa[i] != pb[i]) return pb[i].CompareTo(pa[i]);
                return pb.Length.CompareTo(pa.Length);
            });
            string forgeFullVersion;
            if (!string.IsNullOrEmpty(specificVersion))
            {
                // 如果前端传了指定版本（比如 "47.2.0"），拼上前面的 MC 版本（"1.20.1-47.2.0"），去列表里找
                var target = $"{baseVersion}-{specificVersion}";
                forgeFullVersion = candidates.FirstOrDefault(c => c == target || c == specificVersion) ?? candidates[0];
            }
            else
            {
                forgeFullVersion = candidates[0];
            }

            await ReportProgress(sender, S(10), $"下载 Forge {forgeFullVersion} installer...");

            var installerUrls = new[]
            {
        $"https://maven.minecraftforge.net/net/minecraftforge/forge/{forgeFullVersion}/forge-{forgeFullVersion}-installer.jar",
        $"https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/{forgeFullVersion}/forge-{forgeFullVersion}-installer.jar",
    };
            var installerPath = Path.Combine(mcDir, $"forge-{forgeFullVersion}-installer.jar");

            bool installerOk = false;
            Exception lastInstallerEx = null;
            foreach (var url in installerUrls)
            {
                try
                {
                    await DownloadWithAria2Async(url, installerPath, null, sender, S(10), S(40), $"Forge {forgeFullVersion} installer");
                    if (File.Exists(installerPath) && new FileInfo(installerPath).Length > 1024 * 100)
                    {
                        installerOk = true;
                        break;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Forge] installer 源 {url} 失败：{ex.Message}");
                    lastInstallerEx = ex;
                    try { File.Delete(installerPath); } catch { }
                }
            }
            if (!installerOk)
                throw new Exception($"Forge installer 下载失败：{lastInstallerEx?.Message ?? "所有源不可用"}");

            var profilePath = Path.Combine(mcDir, "launcher_profiles.json");
            if (!File.Exists(profilePath))
            {
                var minimalProfile = @"{
  ""profiles"": {},
  ""selectedProfile"": """",
  ""clientToken"": ""illusion-launcher"",
  ""authenticationDatabase"": {},
  ""launcherVersion"": {
    ""name"": ""1.0.0"",
    ""format"": 21
  }
}";
                try
                {
                    File.WriteAllText(profilePath, minimalProfile);
                    Debug.WriteLine($"[Forge]  已创建 launcher_profiles.json：{profilePath}");
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Forge] ⚠️ 创建 launcher_profiles.json 失败：{ex.Message}");
                }
            }
            else
            {
                Debug.WriteLine($"[Forge] launcher_profiles.json 已存在：{profilePath}");
            }

            await ReportProgress(sender, S(45), $"运行 Forge 安装器 {forgeFullVersion}...");


            var forgeVersionId = $"{baseVersion}-forge-{ParseForgeVersionShort(forgeFullVersion)}";
            DiagnosticLogger.Instance.Info($"[InstallForge] 准备调用，versionId={forgeVersionId}");
            try
            {
                if (IsForgeLegacy(baseVersion))
                    await InstallForgeLegacyAsync(installerPath, forgeVersionId, mcDir, sender, S(45), S(100));
                else
                    await InstallForgeModernAsync(installerPath, forgeVersionId, mcDir, sender, S(45), S(100));
                try { File.Delete(installerPath); } catch { }
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Info($"[InstallForge] 自研安装失败：{ex}");
                await ReportProgress(sender, S(45), $" Forge 安装失败：{ex.Message}");
                throw;   // 不再吞掉，让上层拿到真实原因
                throw;
            }
        }

        private int[] ParseForgeVersion(string full)
        {
            var idx = full.IndexOf('-');
            if (idx < 0) return new[] { 0, 0, 0 };
            var ver = full.Substring(idx + 1);
            var parts = ver.Split('.');
            var result = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                int n = 0;
                int.TryParse(parts[i], out n);
                result[i] = n;
            }
            return result;
        }

        // ⭐ 专门给 NeoForge 版本号用：解 "1.20.1-47.1.106" → [47,1,106]
        private int[] ParseNeoForgeVersion(string name)
        {
            if (string.IsNullOrEmpty(name)) return new[] { 0, 0, 0 };

            var dash = name.IndexOf('-');
            if (dash < 0) return ParseVersion(name);

            var tail = name.Substring(dash + 1);
            var parts = tail.Split('.');
            var result = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                var numPart = new string(parts[i].TakeWhile(char.IsDigit).ToArray());
                int.TryParse(numPart, out result[i]);
            }
            return result;
        }

        private async Task InstallNeoForgeAsync(string baseVersion, CoreWebView2 sender, double startPct = 0, double endPct = 100, string specificVersion = null)
        {
            double S(double p) => startPct + (endPct - startPct) * p / 100.0;
            var mcDir = GetMcDir();
            if (baseVersion == "26.1")
            {
                throw new Exception("26.1 的 NeoForge 因 installer patch 校验失败暂不可用，请改用 26.1.1");
            }
            await ReportProgress(sender, S(0), "查询 NeoForge 版本（国内可能较慢）...");

            // 1.20.1 的 NeoForge 版本信息在 net.neoforged:forge，不在 neoforge
            string metadataArtifact = baseVersion == "1.20.1" ? "forge" : "neoforge";
            var mavenUrls = new[]
            {
    $"https://bmclapi2.bangbang93.com/maven/net/neoforged/{metadataArtifact}/maven-metadata.xml",
    $"https://maven.neoforged.net/releases/net/neoforged/{metadataArtifact}/maven-metadata.xml",
};
            string xml;
            try
            {
                xml = await GetStringWithFallbackAsync(mavenUrls, 15000);
            }
            catch (Exception ex)
            {
                throw new Exception($"无法连接 NeoForge 版本服务器：{ex.Message}");
            }

            var mcParts = baseVersion.Split('.');
            if (mcParts.Length < 2) throw new Exception($"NeoForge 不支持 {baseVersion}");

            string versionPrefix;
            if (baseVersion == "1.20.1")
            {
                versionPrefix = "1.20.1-47.";
            }
            else if (baseVersion.StartsWith("26."))
            {
                // 26.x 规则：NeoForge 版本号 = {MC前两段}.{MC第三段}.{build}
                // MC 26.1  → NeoForge 26.1.0.x（第三段缺省补 0）
                // MC 26.1.1 → NeoForge 26.1.1.x
                // MC 26.1.2 → NeoForge 26.1.2.x
                if (mcParts.Length >= 3)
                    versionPrefix = $"{mcParts[0]}.{mcParts[1]}.{mcParts[2]}.";
                else
                    versionPrefix = $"{mcParts[0]}.{mcParts[1]}.0.";
            }
            else if (mcParts.Length >= 3)
            {
                versionPrefix = $"{mcParts[1]}.{mcParts[2]}.";
            }
            else
            {
                versionPrefix = $"{mcParts[1]}.";
            }

            var matches = Regex.Matches(xml, @"<version>([^<]+)</version>");
            var candidates = new List<string>();
            foreach (Match m in matches)
            {
                var v = m.Groups[1].Value;
                if (v.StartsWith(versionPrefix)) candidates.Add(v);
            }
            if (candidates.Count == 0)
            {
                if (baseVersion.StartsWith("26."))
                {
                    throw new Exception($"NeoForge 没有匹配 {baseVersion} 的版本");
                }

                int mcMinor = 0, mcPatch = 0;
                if (mcParts.Length >= 2) int.TryParse(mcParts[1], out mcMinor);
                if (mcParts.Length >= 3) int.TryParse(mcParts[2], out mcPatch);

                bool tooOld = (mcMinor < 20) || (mcMinor == 20 && mcPatch < 1);
                if (tooOld)
                    throw new Exception($"NeoForge 不支持 {baseVersion}（最低 1.20.1，低版本请用 Forge 或 Fabric）");
                throw new Exception($"NeoForge 没有匹配 {baseVersion} 的版本");
            }

            candidates.Sort((a, b) =>
            {
                var pa = ParseNeoForgeVersion(a);
                var pb = ParseNeoForgeVersion(b);
                for (int i = 0; i < Math.Min(pa.Length, pb.Length); i++)
                    if (pa[i] != pb[i]) return pb[i].CompareTo(pa[i]);
                return pb.Length.CompareTo(pa.Length);
            });

            // ⭐ 优先选稳定版（不含 -），但 1.20.1 的版本号自带 -，跳过这步
            if (baseVersion != "1.20.1")
            {
                var stable = candidates.Where(c => !c.Contains("-")).ToList();
                if (stable.Count > 0) candidates = stable;
            }
            string nfVersion;
            if (!string.IsNullOrEmpty(specificVersion))
            {
                nfVersion = candidates.FirstOrDefault(c => c == specificVersion) ?? candidates[0];
            }
            else
            {
                nfVersion = candidates[0];
            }
            await ReportProgress(sender, S(10), $"下载 NeoForge {nfVersion} installer...");

            string artifactName = baseVersion == "1.20.1" ? "forge" : "neoforge";
            var installerUrls = new[]
            {
    $"https://bmclapi2.bangbang93.com/maven/net/neoforged/{artifactName}/{nfVersion}/{artifactName}-{nfVersion}-installer.jar",
    $"https://maven.neoforged.net/releases/net/neoforged/{artifactName}/{nfVersion}/{artifactName}-{nfVersion}-installer.jar",
};

            var installerPath = Path.Combine(mcDir, $"neoforge-{nfVersion}-installer.jar");

            bool installerOk = false;
            Exception lastInstallerEx = null;
            foreach (var url in installerUrls)
            {
                try
                {
                    await DownloadWithAria2Async(url, installerPath, null, sender, S(10), S(40), $"NeoForge {nfVersion} installer");
                    if (File.Exists(installerPath) && new FileInfo(installerPath).Length > 1024 * 100)
                    {
                        installerOk = true;
                        break;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[NeoForge] installer 源 {url} 失败：{ex.Message}");
                    lastInstallerEx = ex;
                    try { File.Delete(installerPath); } catch { }
                }
            }
            if (!installerOk)
                throw new Exception($"NeoForge installer 下载失败：{lastInstallerEx?.Message ?? "所有源不可用"}");

            var profilePath = Path.Combine(mcDir, "launcher_profiles.json");
            if (!File.Exists(profilePath))
            {
                var minimalProfile = @"{
  ""profiles"": {},
  ""selectedProfile"": """",
  ""clientToken"": ""illusion-launcher"",
  ""authenticationDatabase"": {},
  ""launcherVersion"": {
    ""name"": ""1.0.0"",
    ""format"": 21
  }
}";
                try
                {
                    File.WriteAllText(profilePath, minimalProfile);
                    Debug.WriteLine($"[NeoForge]  已创建 launcher_profiles.json：{profilePath}");
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[NeoForge] ⚠️ 创建 launcher_profiles.json 失败：{ex.Message}");
                }
            }

            // 走自研 Forge 安装器（BMCLAPI 依赖 + 本地 processor，不跑官方 installer 的联网下载）
            var nfVersionId = $"{baseVersion}-neoforge-{nfVersion}";
            await InstallForgeModernAsync(installerPath, nfVersionId, mcDir, sender, S(45), S(100));
            try { File.Delete(installerPath); } catch { }
            await ReportProgress(sender, S(100), $" NeoForge {nfVersion} 安装完成", done: false);
        }

        private async Task DownloadMinecraftVersionAsync(string versionId, string versionJsonUrl, CoreWebView2 sender, double maxPct = 100.0)
        {
            try
            {
                var mcDir = GetMcDir();
                var versionDir = Path.Combine(mcDir, "versions", versionId);
                Directory.CreateDirectory(versionDir);

                await ReportProgress(sender, 0, $"获取 {versionId} 版本信息");
                var jsonPath = Path.Combine(versionDir, versionId + ".json");

                // 官方源和 BMCLAPI 镜像
                var officialUrl = versionJsonUrl;
                var bmclUrl = versionJsonUrl.Replace("piston-meta.mojang.com", "bmclapi2.bangbang93.com");

                try
                {
                    // 1. 优先打官方源（最稳）
                    await ReportProgress(sender, 2, $"官方源获取 {versionId} 信息");
                    await DownloadFileAsync(officialUrl, jsonPath, null);
                }
                catch
                {
                    try
                    {
                        // 2. 官方挂了，切国内镜像
                        await ReportProgress(sender, 3, $"官方超时，切换国内镜像");
                        await DownloadFileAsync(bmclUrl, jsonPath, null);
                    }
                    catch
                    {
                        // 3. 全都挂了，抛出明错
                        throw new Exception($"无法获取 {versionId} 请检查网络");
                    }
                }

                // ⭐ 终极防护：只要文件没下下来，坚决不往下走
                if (!File.Exists(jsonPath))
                {
                    throw new Exception($"{versionId} 版本文件下载失败！");
                }

                var root = JsonDocument.Parse(await File.ReadAllTextAsync(jsonPath)).RootElement;

                var clientInfo = root.GetProperty("downloads").GetProperty("client");
                var clientUrl = clientInfo.GetProperty("url").GetString()
                    .Replace("piston-meta.mojang.com", "bmclapi2.bangbang93.com")
                    .Replace("launcher.mojang.com", "bmclapi2.bangbang93.com")
                    .Replace("piston-data.mojang.com", "bmclapi2.bangbang93.com");
                var clientSha1 = clientInfo.TryGetProperty("sha1", out var sha1El) ? sha1El.GetString() : null;
                var clientPath = Path.Combine(versionDir, versionId + ".jar");
                await DownloadWithAria2Async(clientUrl, clientPath, clientSha1, sender, maxPct * 0.03, maxPct * 0.45, Path.GetFileName(clientPath));

                // 1. 只死等必须的依赖库（保证能进游戏）
                await ProjBobcatRepairAsync(versionId, sender, maxPct * 0.45, maxPct * 0.85, onlyLibraries: true);

                // 2. 把剩余的资源和额外文件甩给后台慢慢下
                var bgCt = new CancellationTokenSource().Token;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        Debug.WriteLine($"[BG-Repair] 开始后台补全 {versionId} 的资源文件...");
                        await ProjBobcatRepairAsync(versionId, sender, 85, 100, isBackground: true);
                        Debug.WriteLine($"[BG-Repair] {versionId} 资源文件全量补齐完成");
                    }
                    catch (OperationCanceledException)
                    {
                        // ⭐ 取消：把这次新建的版本目录整个删掉，不留半成品
                        try
                        {
                            var _vd = Path.Combine(mcDir, "versions", versionId);
                            if (Directory.Exists(_vd)) Directory.Delete(_vd, true);
                        }
                        catch { }
                        await ReportProgress(sender, 0, "已取消版本下载", done: true);
                        throw;
                    }
                    catch (Exception ex) { Debug.WriteLine($"[BG-Repair] 失败: {ex.Message}"); }
                });
                await ReportProgress(sender, maxPct, $" {versionId} 原版下载完成", done: false);
            }
            catch (Exception ex)
            {
                await ReportProgress(sender, 0, $" 下载失败：{ex.Message}");
                throw;
            }
        }

        private async Task ProjBobcatRepairAsync(string versionId, CoreWebView2 sender, double startPct, double endPct, bool onlyLibraries = false, bool isBackground = false)
        {
            try
            {
                var mcDir = GetMcDir();
                var clientToken = Guid.NewGuid();
                var versionLocator = new ProjBobcat.DefaultComponent.Launch.DefaultVersionLocator(mcDir, clientToken);
                var versionInfo = versionLocator.GetGame(versionId);
                if (versionInfo == null) return;

                var resolvedGame = versionLocator.ResolveGame(versionInfo, ProjBobcat.Class.Model.NativeReplacementPolicy.Disabled, null);
                if (resolvedGame == null) return;

                var httpFactory = App.ServiceProvider.GetRequiredService<IHttpClientFactory>();

                var resolvers = new List<IResourceInfoResolver>
        {
            new LibraryInfoResolver
            {
                               LibraryUriRoots = new List<ProjBobcat.Class.Model.Downloading.DownloadUriInfo>
                {
                    new("https://libraries.minecraft.net/", 1),
                    new("https://bmclapi2.bangbang93.com/maven/", 2)
                },
                ForgeMavenUriRoots = new List<ProjBobcat.Class.Model.Downloading.DownloadUriInfo>
                {
                    new("https://maven.minecraftforge.net/", 1),
                    new("https://bmclapi2.bangbang93.com/maven/", 2)
                },
                ForgeMavenOldUriRoots = new List<ProjBobcat.Class.Model.Downloading.DownloadUriInfo>
                {
                    new("https://maven.minecraftforge.net/", 1),
                    new("https://bmclapi2.bangbang93.com/maven/", 2)
                },
                FabricMavenUriRoots = new List<ProjBobcat.Class.Model.Downloading.DownloadUriInfo>
                {
                    new("https://maven.fabricmc.net/", 1),
                    new("https://bmclapi2.bangbang93.com/maven/", 2)
                },
            }
        };

                // ⭐ 只有非“仅库模式”时，才加入资源（Assets）解析器
                if (!onlyLibraries)
                {
                    resolvers.Add(new AssetInfoResolver
                    {
                        HttpClientFactory = httpFactory,
                        AssetIndexUriRoots = new List<ProjBobcat.Class.Model.Downloading.DownloadUriInfo>
                    {
                        new("https://piston-meta.mojang.com/", 1),
                        new("https://bmclapi2.bangbang93.com/", 2)
                    },
                        AssetUriRoots = new List<ProjBobcat.Class.Model.Downloading.DownloadUriInfo>
                    {
                        new("https://resources.download.minecraft.net/", 1),
                        new("https://bmclapi2.bangbang93.com/assets/", 2)
                    },
                    });
                }

                var completer = new ProjBobcat.DefaultComponent.DefaultResourceCompleter
                {
                    HttpClientFactory = httpFactory,
                    ResourceInfoResolvers = resolvers,
                    DownloadThread = isBackground ? 16 : 64, // 后台下慢点，别抢游戏网速
                    DownloadParts = isBackground ? 4 : 8,
                    MaxDegreeOfParallelism = isBackground ? 4 : 8,
                    TotalRetry = 2,
                    CheckFile = true,
                };

                completer.DownloadFileChangedEvent += (s, args) =>
                {
                    if (isBackground) return; // 后台静默不更新 UI 进度条
                    if (sender != null) // ⭐ 加上这行保护，防止传 null 崩溃
                        {
                        double pct = startPct + args.ProgressPercentage / 100.0 * (endPct - startPct);
                        _ = ReportProgress(sender, pct, $"[ProjBobcat] {args.ProgressPercentage:F1}% · {args.Speed:F0} B/s");
                    }
                };

                Debug.WriteLine($"[ProjBobcat] 开始补全 {versionId} (onlyLibraries={onlyLibraries})");
                var result = await completer.CheckAndDownloadTaskAsync(mcDir, true, resolvedGame);

                if (!isBackground && sender != null) // ⭐ 这里也要加上保护
                    await ReportProgress(sender, endPct, onlyLibraries ? $"{versionId} 依赖库就绪" : $"{versionId} 资源补全完成");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ProjBobcat] 异常: {ex}");
            }
        }



        private async Task EnsureCustomSkinLoaderAsync(string versionId, CoreWebView2 sender, double startPct, double endPct)
        {
            try
            {
                var mcDir = GetMcDir();
                if (versionId.Contains("-forge-") && versionId.Contains("1.20.2-"))
                {
                    Debug.WriteLine($"[CSL] {versionId}：1.20.2 Forge 跳过 CSL");
                    return;
                }
                var versionDir = Path.Combine(mcDir, "versions", versionId);
                var modsDir = Path.Combine(versionDir, "mods");
                Directory.CreateDirectory(modsDir);

                // ⭐ 1. 已装就跳过
                var existing = Directory.GetFiles(modsDir, "*CustomSkinLoader*.jar");
                bool needForgeV2 = versionId.Contains("-forge-") && (
      versionId.Contains("1.17.") ||
      versionId.Contains("1.18.") ||
      versionId.Contains("1.19.") || versionId.Contains("1.19-forge") ||
      versionId.Contains("1.20.1-") ||
      versionId.Contains("1.20.2-") ||
      versionId.Contains("1.20.3-") ||
      versionId.Contains("1.20.4-"));
                bool hasCorrect = existing.Any(f =>
                    (needForgeV2 && f.Contains("ForgeV2")) ||
                    (!needForgeV2 && f.Contains("Universal")));

                if (hasCorrect)
                {
                    Debug.WriteLine($"[CSL] {versionId} 已有正确的 CSL，跳过");
                    return;
                }
                else if (existing.Length > 0)
                {
                    foreach (var f in existing)
                    {
                        try { File.Delete(f); Debug.WriteLine($"[CSL] 删旧版本 {Path.GetFileName(f)}"); } catch { }
                    }
                }

                await ReportProgress(sender, startPct, "安装皮肤补丁...");

                // ⭐ 2. 解析真正的 MC 版本号（支持整合包）
                var mcVer = ResolveMcVersion(versionId);
                if (string.IsNullOrEmpty(mcVer))
                {
                    Debug.WriteLine($"[CSL] 无法解析 {versionId} 的 MC 版本，跳过");
                    return;
                }

                Debug.WriteLine($"[CSL] {versionId} → MC {mcVer}");

                // ⭐ 3. 查 Modrinth
                var apiUrl = $"https://api.modrinth.com/v2/project/customskinloader/version?game_versions=[\"{mcVer}\"]";
                var req = new HttpRequestMessage(HttpMethod.Get, apiUrl);
                req.Headers.Add("User-Agent", "illusionLauncher/1.0.0 (contact@example.com)");

                var resp = await _http.SendAsync(req);
                if (!resp.IsSuccessStatusCode)
                {
                    Debug.WriteLine($"[CSL] Modrinth API 返回 {(int)resp.StatusCode}，跳过");
                    return;
                }

                var text = await resp.Content.ReadAsStringAsync();
                var arr = JsonDocument.Parse(text).RootElement;

                string downloadUrl = null;
                string fileName = null;
                foreach (var v in arr.EnumerateArray())
                {
                    var files = v.GetProperty("files");
                    foreach (var f in files.EnumerateArray())
                    {
                        var fn = f.GetProperty("filename").GetString();
                        string preferKeyword = needForgeV2 ? "ForgeV2" : "Universal";
                        if (fn != null && fn.Contains(preferKeyword))
                        {
                            downloadUrl = f.GetProperty("url").GetString();
                            fileName = fn;
                            break;
                        }
                    }
                    if (downloadUrl != null) break;
                }

                if (downloadUrl == null)
                {
                    Debug.WriteLine($"[CSL] 没找到 Universal 版（MC {mcVer}），跳过");
                    return;
                }

                var savePath = Path.Combine(modsDir, fileName);
                await DownloadFileAsync(downloadUrl, savePath, null);
                Debug.WriteLine($"[CSL]  已下载 {fileName} → {modsDir}");

                await ReportProgress(sender, endPct, "皮肤补丁已就绪");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[CSL]  {ex.Message}");
            }
        }

        // ⭐ 从版本 id 或 inheritsFrom 链解析 MC 版本号
        private string ResolveMcVersion(string versionId)
        {
            // 直接从版本 id 提取（fabric-loader-xxx-1.21.11 → 1.21.11）
            var m = Regex.Match(versionId, @"(1\.\d+(?:\.\d+)?|26\.\d+(?:\.\d+)?)");
            if (m.Success) return m.Groups[1].Value;

            // 版本 id 里没有（整合包名）→ 读 inheritsFrom 链
            try
            {
                var mcDir = GetMcDir();
                var current = versionId;
                for (int depth = 0; depth < 5; depth++)
                {
                    if (string.IsNullOrEmpty(current)) break;
                    var jsonPath = Path.Combine(mcDir, "versions", current, current + ".json");
                    if (!File.Exists(jsonPath)) break;

                    var root = JsonDocument.Parse(File.ReadAllText(jsonPath)).RootElement;

                    // 从当前层 id 提取
                    if (root.TryGetProperty("id", out var idEl))
                    {
                        var id = idEl.GetString();
                        if (!string.IsNullOrEmpty(id))
                        {
                            var mm = Regex.Match(id, @"(1\.\d+(?:\.\d+)?|26\.\d+(?:\.\d+)?)");
                            if (mm.Success) return mm.Groups[1].Value;
                        }
                    }

                    // 追上一层
                    if (root.TryGetProperty("inheritsFrom", out var inh))
                        current = inh.GetString();
                    else
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[CSL] ResolveMcVersion 失败：{ex.Message}");
            }

            return null;
        }

        private async Task DownloadAssetsAsync(JsonElement root, string mcDir, CoreWebView2 sender, double startPct = 70, double endPct = 100)
        {
            var assetIndex = root.GetProperty("assetIndex");
            var assetIndexUrl = assetIndex.GetProperty("url").GetString().Replace("piston-meta.mojang.com", "bmclapi2.bangbang93.com");
            var assetIndexId = assetIndex.GetProperty("id").GetString();
            var assetIndexDir = Path.Combine(mcDir, "assets", "indexes");
            Directory.CreateDirectory(assetIndexDir);
            var assetIndexPath = Path.Combine(assetIndexDir, assetIndexId + ".json");
            await DownloadFileAsync(assetIndexUrl, assetIndexPath, null);
            var assetJson = JsonDocument.Parse(await File.ReadAllTextAsync(assetIndexPath));
            var objects = assetJson.RootElement.GetProperty("objects");
            var pending = new List<(string url, string savePath, string fileName, string sha1)>();
            foreach (var obj in objects.EnumerateObject())
            {
                var hash = obj.Value.GetProperty("hash").GetString();
                var prefix = hash.Substring(0, 2);
                var savePath = Path.Combine(mcDir, "assets", "objects", prefix, hash);
                if (File.Exists(savePath))
                {
                    if (VerifySha1(savePath, hash)) continue;
                    try { File.Delete(savePath); } catch { }
                }
                var assetUrl = $"https://bmclapi2.bangbang93.com/assets/{prefix}/{hash}";
                pending.Add((assetUrl, savePath, hash.Substring(0, 8), hash));
            }
            int assetTotal = pending.Count;
            if (assetTotal == 0) return;
            int assetDone = 0;
            var assetSem = new SemaphoreSlim(ASSET_CONCURRENCY);
            var assetTasks = new List<Task>();
            foreach (var (assetUrl, savePath, fileName, sha1) in pending)
            {
                await assetSem.WaitAsync();
                assetTasks.Add(Task.Run(async () =>
                {
                    try { await DownloadFileAsync(assetUrl, savePath, null, sha1); }
                    catch
                    {
                        try
                        {
                            var officialUrl = assetUrl.Replace("bmclapi2.bangbang93.com", "resources.download.minecraft.net");
                            await DownloadFileAsync(officialUrl, savePath, null, sha1);
                        }
                        catch { }
                    }
                    finally
                    {
                        assetSem.Release();
                        int done = Interlocked.Increment(ref assetDone);
                        var _now = DateTime.Now;
                        if ((_now - _lastAssetReport).TotalMilliseconds >= 300 || done == assetTotal)
                        {
                            _lastAssetReport = _now;
                            double pct = startPct + (double)done / assetTotal * (endPct - startPct);
                            _ = ReportProgress(sender, pct, $"资源 {done}/{assetTotal}");
                        }
                    }
                }));
            }
            await Task.WhenAll(assetTasks);
            if (sender != null)
                _ = ReportProgress(sender, endPct, " 资源下载完成");
        }

        // =========================================================
        // 启动前完整性检查 + 自动补全
        // =========================================================

        private async Task<bool> CheckAndRepairAsync(
    string versionId,
    JsonElement effectiveRoot,
    JsonElement root,
    string mcDir,
    CoreWebView2 sender)
        {
            int retryCount = 0;
            const int maxRetries = 3;

            while (retryCount < maxRetries)
            {
                retryCount++;
                try
                {
                    var missing = new List<(string type, string url, string savePath, string sha1, string name)>();

                    await ReportLaunchProgress(sender, 10, $"检查客户端 jar... (第 {retryCount} 次)");

                    // 1. 检查原版 client.jar
                    string clientVersionId = versionId;
                    if (effectiveRoot.TryGetProperty("id", out var bottomIdEl))
                    {
                        var bottomId = bottomIdEl.GetString();
                        if (!string.IsNullOrEmpty(bottomId)) clientVersionId = bottomId;
                    }
                    string clientJarPath = Path.Combine(mcDir, "versions", clientVersionId, clientVersionId + ".jar");
                    if (!File.Exists(clientJarPath) && effectiveRoot.TryGetProperty("downloads", out var dl) && dl.TryGetProperty("client", out var clientEl))
                    {
                        var url = clientEl.GetProperty("url").GetString();
                        var sha1 = clientEl.TryGetProperty("sha1", out var s) ? s.GetString() : null;
                        missing.Add(("client", url, clientJarPath, sha1, $"{clientVersionId}.jar"));
                    }

                    await ReportLaunchProgress(sender, 48, "正在检测核心依赖库...");

                    // ⭐ 调用咱们刚刚写好的独立检查器
                    int repaired = await JarIntegrityChecker.CheckAndRepairAsync(mcDir, versionId, async (url, path) =>
                    {
                        // 把你原本的 DownloadFileAsync 传进去作为下载工具
                        await DownloadFileAsync(url, path, null);
                    });

                    if (repaired > 0)
                    {
                        Debug.WriteLine($"[JarCheck] 自动修复了 {repaired} 个缺失依赖！");
                    }

                    await ReportLaunchProgress(sender, 20, "检查依赖库与 Natives...");

                    // 2. 检查依赖库
                    var libsDir = Path.Combine(mcDir, "libraries");
                    var allLibs = new List<JsonElement>();
                    if (effectiveRoot.TryGetProperty("libraries", out var effLibs)) allLibs.AddRange(effLibs.EnumerateArray());
                    if (root.TryGetProperty("libraries", out var rootLibs)) allLibs.AddRange(rootLibs.EnumerateArray());

                    foreach (var lib in allLibs)
                    {
                        if (lib.TryGetProperty("rules", out var rules) && !IsAllowedOnWindows(rules)) continue;

                        if (lib.TryGetProperty("downloads", out var downloads) && downloads.TryGetProperty("artifact", out var artifact))
                        {
                            var url = artifact.GetProperty("url").GetString();
                            if (string.IsNullOrEmpty(url)) continue;
                            var path = artifact.GetProperty("path").GetString();
                            var sha1 = artifact.TryGetProperty("sha1", out var s) ? s.GetString() : null;
                            var savePath = Path.Combine(libsDir, path.Replace('/', Path.DirectorySeparatorChar));

                            if (!File.Exists(savePath) || (sha1 != null && !VerifySha1(savePath, sha1)))
                                missing.Add(("library", url, savePath, sha1, path));
                        }
                        if (lib.TryGetProperty("downloads", out var dl2))
                        {
                            if (dl2.TryGetProperty("classifiers", out var classifiers) && classifiers.TryGetProperty("natives-windows", out var winNative))
                            {
                                var url = winNative.GetProperty("url").GetString();
                                if (!string.IsNullOrEmpty(url))
                                {
                                    var path = winNative.GetProperty("path").GetString();
                                    var sha1 = winNative.TryGetProperty("sha1", out var s2) ? s2.GetString() : null;
                                    var savePath = Path.Combine(libsDir, path.Replace('/', Path.DirectorySeparatorChar));
                                    if (!File.Exists(savePath) || (sha1 != null && !VerifySha1(savePath, sha1)))
                                        missing.Add(("native", url, savePath, sha1, Path.GetFileName(path)));
                                }
                            }
                            if (dl2.TryGetProperty("artifact", out var artifactN))
                            {
                                var pN = artifactN.GetProperty("path").GetString();
                                if (!string.IsNullOrEmpty(pN) && pN.Contains("natives-windows"))
                                {
                                    var url = artifactN.GetProperty("url").GetString();
                                    if (!string.IsNullOrEmpty(url))
                                    {
                                        var sha1 = artifactN.TryGetProperty("sha1", out var s3) ? s3.GetString() : null;
                                        var savePath = Path.Combine(libsDir, pN.Replace('/', Path.DirectorySeparatorChar));
                                        if (!File.Exists(savePath) || (sha1 != null && !VerifySha1(savePath, sha1)))
                                            missing.Add(("native", url, savePath, sha1, Path.GetFileName(pN)));
                                    }
                                }
                            }
                        }
                    }

                    await ReportLaunchProgress(sender, 35, "检查资源索引...");

                    // 3. 检查资源索引
                    string assetIndexId = "legacy";
                    if (effectiveRoot.TryGetProperty("assetIndex", out var ai) && ai.TryGetProperty("id", out var aiId))
                        assetIndexId = aiId.GetString();
                    var assetIndexDir = Path.Combine(mcDir, "assets", "indexes");
                    var assetIndexPath = Path.Combine(assetIndexDir, assetIndexId + ".json");

                    if (!File.Exists(assetIndexPath) && effectiveRoot.TryGetProperty("assetIndex", out var ai2) && ai2.TryGetProperty("url", out var aiUrl))
                    {
                        var url = aiUrl.GetString();
                        var sha1 = ai2.TryGetProperty("sha1", out var s) ? s.GetString() : null;
                        missing.Add(("assetIndex", url, assetIndexPath, sha1, assetIndexId + ".json"));
                    }

                    // 4. 检查 Assets 资源
                    if (File.Exists(assetIndexPath))
                    {
                        await ReportLaunchProgress(sender, 45, "检查资源文件...");
                        try
                        {
                            var assetJson = JsonDocument.Parse(await File.ReadAllTextAsync(assetIndexPath));
                            var objects = assetJson.RootElement.GetProperty("objects");
                            var assetObjectsDir = Path.Combine(mcDir, "assets", "objects");
                            foreach (var obj in objects.EnumerateObject())
                            {
                                // ⭐ 严格定义“背景音效”，其余全部算关键音效！
                                bool isBackgroundSound =
                                    obj.Name.Contains("/music/") || obj.Name.Contains("/sounds/ambient/") ||
                                    obj.Name.Contains("/sounds/weather/") || obj.Name.Contains("/sounds/mob/") ||
                                    obj.Name.Contains("/sounds/step/") || obj.Name.Contains("/sounds/dig/") || obj.Name.Contains("/sounds/records/");

                                var hash = obj.Value.GetProperty("hash").GetString();
                                var prefix = hash.Substring(0, 2);
                                var savePath = Path.Combine(assetObjectsDir, prefix, hash);

                                if (!File.Exists(savePath) || !VerifySha1(savePath, hash))
                                {
                                    if (isBackgroundSound) continue; // 踢去后台
                                    missing.Add(("asset", $"https://resources.download.minecraft.net/{prefix}/{hash}", savePath, hash, obj.Name));
                                }
                            }
                        }
                        catch (Exception ex) { Debug.WriteLine($"[CheckRepair] assetIndex 解析失败：{ex.Message}"); }
                    }

                    missing = missing.GroupBy(m => m.savePath, StringComparer.OrdinalIgnoreCase).Select(g => g.First()).ToList();

                    if (missing.Count == 0)
                    {
                        await ReportLaunchProgress(sender, 60, " 关键文件完整性检查通过");
                        return true; // ⭐ 真的全齐了，退出循环放行！
                    }

                    await ReportLaunchProgress(sender, 55, $"发现 {missing.Count} 个缺失文件，正在极速补全 (第 {retryCount} 次)...");
                    int done = 0;
                    int total = missing.Count;
                    var tasks = new List<Task>();

                    // ⭐ 强制分离：核心文件下完后，把缺失的“非背景音效”（如按钮声、受伤声）也一起下完！
                    // ⭐ 用于记录下载速度的变量
                    long lastBytesForSpeed = Interlocked.Read(ref _totalBytesDownloaded);
                    var lastSpeedTime = DateTime.Now;
                    double currentSpeed = 0;

                    foreach (var (mType, mUrl, mPath, mSha1, mName) in missing)
                    {
                        tasks.Add(Task.Run(async () =>
                        {
                            try
                            {
                                string bmclUrl = mUrl.Replace("libraries.minecraft.net", "bmclapi2.bangbang93.com/maven")
                                                     .Replace("resources.download.minecraft.net", "bmclapi2.bangbang93.com/assets")
                                                     .Replace("piston-meta.mojang.com", "bmclapi2.bangbang93.com")
                                                     .Replace("launcher.mojang.com", "bmclapi2.bangbang93.com")
                                                     .Replace("piston-data.mojang.com", "bmclapi2.bangbang93.com");

                                if (File.Exists(mPath)) try { File.Delete(mPath); } catch { }

                                // ⭐ 局部变量，专门记录当前这个文件的下载状态
                                long fileDownloaded = 0;
                                var fileStartTime = DateTime.Now;

                                var downloadTask = DownloadFileAsync(mUrl, bmclUrl, mPath, (downloaded, total) =>
                                {
                                    fileDownloaded = downloaded;
                                }, mSha1);

                                // ⭐ 核心强杀循环：每秒检查一次
                                while (!downloadTask.IsCompleted)
                                {
                                    var completed = await Task.WhenAny(downloadTask, Task.Delay(1000));
                                    if (completed == downloadTask) break; // 下完了，跳出

                                    var elapsed = (DateTime.Now - fileStartTime).TotalSeconds;
                                    double speed = elapsed > 0 ? fileDownloaded / elapsed : 0;
                                    string speedStr = speed > 1024 * 1024
                                        ? $"{speed / 1024 / 1024:F1} MB/s"
                                        : $"{speed / 1024:F0} KB/s";

                                    // 每秒刷新一次 UI，你能清楚看到它在卡 0 KB/s
                                    _ = ReportLaunchProgress(sender, 55 + (double)done / total * 40,
                                        $"[{speedStr}] 正在下载: {mName}");

                                    // 卡了超过 10 秒，直接踢掉！
                                    if (elapsed > 10)
                                    {
                                        Debug.WriteLine($"[CheckRepair] ⭐ 超时强制跳过 (卡了10秒): {mName}");
                                        break;
                                    }
                                }
                            }
                            finally
                            {
                                int d = Interlocked.Increment(ref done);

                                // ⭐ 计算网速和显示进度
                                if (d % 2 == 0 || d == total)
                                {
                                    var now = DateTime.Now;
                                    var elapsed = (now - lastSpeedTime).TotalSeconds;
                                    if (elapsed >= 0.5)
                                    {
                                        long currentBytes = Interlocked.Read(ref _totalBytesDownloaded);
                                        long deltaBytes = currentBytes - lastBytesForSpeed;
                                        currentSpeed = deltaBytes / elapsed;
                                        lastBytesForSpeed = currentBytes;
                                        lastSpeedTime = now;
                                    }

                                    string speedStr = currentSpeed > 1024 * 1024
                                        ? $"{currentSpeed / 1024 / 1024:F1} MB/s"
                                        : $"{currentSpeed / 1024:F0} KB/s";

                                    string displayName = mName;
                                    if (displayName.Length > 30)
                                        displayName = displayName.Substring(0, 27) + "...";

                                    double currentPct = 55 + (double)d / total * 40;
                                    _ = ReportLaunchProgress(sender, currentPct, $"[{speedStr}] 正在下载: {displayName}");
                                }
                            }
                        }));
                    }

                    await Task.WhenAll(tasks);

                    // ⭐ 顺理成章的：把 Natives 解压做到最完美
                    var nativesRoot = Path.Combine(mcDir, "versions", versionId, "natives");
                    if (Directory.Exists(nativesRoot))
                    {
                        foreach (var dll in Directory.GetFiles(nativesRoot, "*.dll")) try { File.Delete(dll); } catch { }
                    }

                    // 本轮下载结束，进入下一轮循环复查！如果 retryCount 达到 3，则强制跳出。
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[CheckRepair] 异常：{ex}");
                }
            }

            // ⭐ 无论成功还是重试到了极限，都扔给后台补全声音
            _ = Task.Run(() => ProjBobcatRepairAsync(versionId, null, 0, 100, onlyLibraries: false, isBackground: true));

            return true; // 放行
        }


        // ⭐ 读 PNG 指定像素的 alpha 值
        private int GetPixelAlpha(string pngPath, int x, int y)
        {
            try
            {
                using var fs = File.OpenRead(pngPath);
                using var bmp = System.Drawing.Image.FromStream(fs) as System.Drawing.Bitmap;
                if (bmp == null) return 255;

                // 坐标可能超范围
                if (x >= bmp.Width || y >= bmp.Height) return 255;

                var pixel = bmp.GetPixel(x, y);
                return pixel.A;
            }
            catch
            {
                return 255;   // 出错就默认粗胳膊
            }
        }


        // ⭐ 把用户选用的皮肤同步到 CustomSkinLoader
        private async Task SyncSkinToCSLAsync(string versionId, string username, string skinId, CoreWebView2 sender)
        {
            try
            {
                if (string.IsNullOrEmpty(skinId))
                {
                    Debug.WriteLine($"[CSL-Sync] 没有 skinId，跳过");
                    return;
                }

                var mcDir = GetMcDir();
                var cslDir = Path.Combine(mcDir, "versions", versionId, "CustomSkinLoader");
                var jsonPath = Path.Combine(cslDir, "CustomSkinLoader.json");

                // ⭐ 1. 配置文件不存在 → 启动器自己写一份默认配置
                if (!File.Exists(jsonPath))
                {
                    Directory.CreateDirectory(cslDir);
                    var defaultJson = GetDefaultCSLConfig();
                    await File.WriteAllTextAsync(jsonPath, defaultJson);
                    Debug.WriteLine($"[CSL-Sync]  已生成默认 CSL 配置");
                }

                // ⭐ 2. 改 json：LocalSkin 提到第一位
                // ⭐ 2. 改 json：LocalSkin 提到第一位 + 写正确的 model
                try
                {
                    var jsonText = await File.ReadAllTextAsync(jsonPath);
                    var doc = JsonDocument.Parse(jsonText);
                    var rootEl = doc.RootElement;

                    // ⭐ 判断皮肤是细胳膊还是粗胳膊
                    var sourceSkinForModel = Path.Combine(GetConfigDir(), "skins", skinId + ".png");
                    string modelValue = "default";   // 默认粗
                    if (File.Exists(sourceSkinForModel))
                    {
                        try
                        {
                            var alpha = GetPixelAlpha(sourceSkinForModel, 54, 20);
                            modelValue = alpha == 0 ? "slim" : "default";
                            Debug.WriteLine($"[CSL-Sync] 皮肤 model 判断 = {modelValue} (alpha={alpha})");
                        }
                        catch (Exception ex)
                        {
                            Debug.WriteLine($"[CSL-Sync] 判断 model 失败：{ex.Message}");
                        }
                    }

                    if (rootEl.TryGetProperty("loadlist", out var loadlist) && loadlist.ValueKind == JsonValueKind.Array)
                    {
                        var newList = new List<Dictionary<string, object>>();
                        foreach (var item in loadlist.EnumerateArray())
                        {
                            var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(item.GetRawText());
                            if (dict != null && dict.TryGetValue("name", out var nameObj) &&
                                nameObj?.ToString() == "LocalSkin")
                            {
                                dict["model"] = modelValue;   // ⭐ 写入判断结果
                            }
                            if (dict != null) newList.Add(dict);
                        }

                        // LocalSkin 提到首位
                        var localSkinItem = newList.FirstOrDefault(d =>
                            d.TryGetValue("name", out var n) && n?.ToString() == "LocalSkin");
                        if (localSkinItem != null)
                        {
                            newList.Remove(localSkinItem);
                            newList.Insert(0, localSkinItem);
                        }

                        var rebuilt = new Dictionary<string, object>();
                        foreach (var prop in rootEl.EnumerateObject())
                        {
                            if (prop.Name == "loadlist") continue;
                            rebuilt[prop.Name] = JsonSerializer.Deserialize<object>(prop.Value.GetRawText());
                        }
                        rebuilt["loadlist"] = newList;

                        var newJson = JsonSerializer.Serialize(rebuilt, new JsonSerializerOptions { WriteIndented = true });
                        await File.WriteAllTextAsync(jsonPath, newJson);
                        Debug.WriteLine($"[CSL-Sync]  已更新配置 (model={modelValue})");
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[CSL-Sync] 改配置失败：{ex.Message}");
                }

                // ⭐ 3. 复制皮肤文件到 LocalSkin/skins/<用户名>.png
                try
                {
                    var sourceSkin = Path.Combine(GetConfigDir(), "skins", skinId + ".png");
                    if (!File.Exists(sourceSkin))
                    {
                        Debug.WriteLine($"[CSL-Sync] 源皮肤不存在：{sourceSkin}");
                        return;
                    }

                    var targetDir = Path.Combine(cslDir, "LocalSkin", "skins");
                    Directory.CreateDirectory(targetDir);
                    var targetSkin = Path.Combine(targetDir, username + ".png");

                    var bytes = await File.ReadAllBytesAsync(sourceSkin);
                    await File.WriteAllBytesAsync(targetSkin, bytes);
                    Debug.WriteLine($"[CSL-Sync]  皮肤已同步：{targetSkin}");
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[CSL-Sync] 复制皮肤失败：{ex.Message}");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[CSL-Sync]  {ex.Message}");
            }
        }



        // ⭐ CSL 默认配置模板（LocalSkin 已置顶）
        private string GetDefaultCSLConfig()
        {
            return @"{
  ""version"": ""15.1"",
  ""buildNumber"": 41,
  ""loadlist"": [
    {
      ""name"": ""LocalSkin"",
      ""type"": ""Legacy"",
      ""checkPNG"": false,
      ""skin"": ""LocalSkin/skins/{USERNAME}.png"",
      ""model"": ""auto"",
      ""cape"": ""LocalSkin/capes/{USERNAME}.png"",
      ""elytra"": ""LocalSkin/elytras/{USERNAME}.png""
    },
    {
      ""name"": ""Mojang"",
      ""type"": ""MojangAPI"",
      ""apiRoot"": ""https://api.mojang.com/"",
      ""sessionRoot"": ""https://sessionserver.mojang.com/""
    },
    {
      ""name"": ""LittleSkin"",
      ""type"": ""CustomSkinAPI"",
      ""root"": ""https://littleskin.cn/csl/""
    },
    {
      ""name"": ""BlessingSkin"",
      ""type"": ""CustomSkinAPI"",
      ""root"": ""https://skin.prinzeugen.net/""
    },
    {
      ""name"": ""ElyBy"",
      ""type"": ""ElyByAPI"",
      ""root"": ""http://skinsystem.ely.by/textures/""
    }
  ],
  ""enableTransparentSkin"": true,
  ""forceLoadAllTextures"": true,
  ""enableCape"": true,
  ""threadPoolSize"": 8,
  ""enableLogStdOut"": false,
  ""cacheExpiry"": 30,
  ""forceUpdateSkull"": false,
  ""enableLocalProfileCache"": false,
  ""enableCacheAutoClean"": false,
  ""forceDisableCache"": false
}";
        }

     

        // =========================================================
        // 启动游戏
        // =========================================================

        /// <summary>
        /// 把参数列表压成一行摘要，避免把几千字符的 classpath 刷进诊断日志。
        /// 完整内容另写 logs\launcher_args.log。
        /// </summary>
        private static string SummarizeArgs(List<string> args)
        {
            if (args == null || args.Count == 0) return "(空)";
            var parts = new List<string>();

            int cpIdx = args.IndexOf("-cp");
            if (cpIdx < 0) cpIdx = args.IndexOf("-classpath");
            if (cpIdx >= 0 && cpIdx + 1 < args.Count)
                parts.Add($"-cp {args[cpIdx + 1].Split(';').Length} 项/{args[cpIdx + 1].Length} 字符");
            else parts.Add("-cp 无");

            int pIdx = args.IndexOf("-p");
            if (pIdx < 0) pIdx = args.IndexOf("--module-path");
            if (pIdx >= 0)
                parts.Add(pIdx + 1 < args.Count ? $"-p {args[pIdx + 1].Split(';').Length} 项" : "-p (缺值!)");
            else parts.Add("-p 无");

            int nExp = 0, nOpen = 0;
            string legacy = null;
            foreach (var a in args)
            {
                if (a.StartsWith("--add-exports")) nExp++;
                else if (a.StartsWith("--add-opens")) nOpen++;
                else if (a.StartsWith("-DlegacyClassPath=")) legacy = a;
            }
            parts.Add($"add-exports={nExp} add-opens={nOpen}");
            parts.Add(legacy == null ? "legacyCP 无" : $"legacyCP {legacy.Split(';').Length} 项");

            var xmx = args.Find(a => a.StartsWith("-Xmx"));
            if (xmx != null) parts.Add(xmx);
            return string.Join(" | ", parts);
        }

        /// <summary>完整启动参数写入 logs\launcher_args.log（每次启动覆盖，只保留最后一次）。</summary>
        private static void WriteFullArgsLog(string mcDir, string javaExe, List<string> jvmArgs, string mainClass, List<string> gameArgs)
        {
            try
            {
                var dir = Path.Combine(mcDir, "logs");
                Directory.CreateDirectory(dir);
                var sb = new System.Text.StringBuilder();
                sb.AppendLine("===== 完整启动参数（每次启动覆盖，排查时才看） =====");
                sb.AppendLine("java: " + javaExe);
                sb.AppendLine("mainClass: " + mainClass);
                sb.AppendLine();
                sb.AppendLine("--- JVM 参数 (" + jvmArgs.Count + ") ---");
                foreach (var a in jvmArgs) sb.AppendLine(a);
                sb.AppendLine();
                sb.AppendLine("--- 游戏参数 (" + gameArgs.Count + ") ---");
                foreach (var a in gameArgs) sb.AppendLine(a);
                File.WriteAllText(Path.Combine(dir, "launcher_args.log"), sb.ToString(), System.Text.Encoding.UTF8);
            }
            catch { }
        }

        private async Task LaunchMinecraftAsync(string versionId, string username, string skinId, CoreWebView2 sender)
        {
            _currentLaunchPlayerName = username;
            _currentLaunchingUsername = username;
            _currentLaunchingVersion = versionId;
            _currentLaunchVersionId = versionId;

            // ⭐ 只读检查，不抢锁：启动流程不持有下载锁，避免泄漏导致下次无法启动
            if (Volatile.Read(ref _downloadLock) != 0)
            {
                await ReportLaunchProgress(sender, 0, " 下载任务进行中，请等待完成");
                return;
            }
            _isCancelled = false;
            await RequestAdminOptimizeAsync();
            try
            {
                _launchCts?.Cancel();
                _launchCts?.Dispose();
                _launchCts = new CancellationTokenSource();
                var _ct = _launchCts.Token;
                if (_ct.IsCancellationRequested) { await ReportLaunchProgress(sender, 0, "已取消", done: true); return; }
                await ReportLaunchProgress(sender, 5, "正在读取版本信息...");
                var mcDir = GetMcDir();

                // ⭐ 核心修复：提前声明全局需要的变量
                var libsDir = Path.Combine(mcDir, "libraries");
                var allLibs = new List<JsonElement>();
                bool hasChild = false;

                var versionDir = Path.Combine(mcDir, "versions", versionId);

                // ⭐ 1. 暴力搜 JSON
                string jsonPath = Path.Combine(versionDir, versionId + ".json");
                if (!File.Exists(jsonPath) && Directory.Exists(versionDir))
                {
                    var possibleJsons = Directory.GetFiles(versionDir, "*.json");
                    jsonPath = possibleJsons.FirstOrDefault(f => Path.GetFileName(f).Equals(versionId + ".json", StringComparison.OrdinalIgnoreCase))
                               ?? possibleJsons.FirstOrDefault();
                }

                if (string.IsNullOrEmpty(jsonPath) || !File.Exists(jsonPath))
                {
                    await ReportLaunchProgress(sender, 0, $" 找不到版本 JSON 文件，请检查 {versionDir} 文件夹");
                    return;
                }

                // ⭐ 启动前全自动体检修复（库 / 资源 / 父版本 / json），缺什么补什么
                await EnsureVersionReadyAsync(versionId, sender, 3, 9);
                
                // ⭐ 2. 核弹级自愈：自动检测并下载缺失的父版本
                // ⭐ 2. 核弹级自愈：自动检测并下载缺失的父版本
                try
                {
                    var checkRootFix = JsonDocument.Parse(File.ReadAllText(jsonPath)).RootElement;
                    if (checkRootFix.TryGetProperty("inheritsFrom", out var inhFix))
                    {
                        string parentIdFix = inhFix.GetString();
                        if (!string.IsNullOrEmpty(parentIdFix))
                        {
                            var parentDirFix = Path.Combine(mcDir, "versions", parentIdFix);
                            var parentJsonFix = Path.Combine(parentDirFix, parentIdFix + ".json");

                            if (!File.Exists(parentJsonFix))
                            {
                                await ReportLaunchProgress(sender, 10, $"检测到缺失的基础版本 {parentIdFix}，正在全自动补全...");

                                if (parentIdFix.StartsWith("fabric-loader-"))
                                {
                                    var partsFix = parentIdFix.Split('-');
                                    if (partsFix.Length >= 4)
                                    {
                                        var fabricVerFix = partsFix[2];
                                        var mcVerFix = parentIdFix.Replace($"fabric-loader-{fabricVerFix}-", "");
                                        await InstallFabricAsync(mcVerFix, sender, 10, 30, fabricVerFix);
                                    }
                                }
                                else if (parentIdFix.Contains("-forge-"))
                                {
                                    var partsFix = parentIdFix.Split(new[] { "-forge-" }, StringSplitOptions.None);
                                    if (partsFix.Length >= 2) await InstallForgeAsync(partsFix[0], sender, 10, 30, partsFix[1]);
                                }
                                else if (parentIdFix.Contains("-neoforge-"))
                                {
                                    var partsFix = parentIdFix.Split(new[] { "-neoforge-" }, StringSplitOptions.None);
                                    if (partsFix.Length >= 2) await InstallNeoForgeAsync(partsFix[0], sender, 10, 30, partsFix[1]);
                                }
                                else
                                {
                                    var manifestJsonFix = await GetStringWithFallbackAsync(new[] {
                                    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
                                    "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json"
                                }, 30000);
                                    var manifestFix = JsonDocument.Parse(manifestJsonFix).RootElement;
                                    string versionUrlFix = null;
                                    foreach (var vFix in manifestFix.GetProperty("versions").EnumerateArray())
                                    {
                                        if (vFix.GetProperty("id").GetString() == parentIdFix)
                                        {
                                            versionUrlFix = vFix.GetProperty("url").GetString();
                                            break;
                                        }
                                    }
                                    if (versionUrlFix != null) await DownloadMinecraftVersionAsync(parentIdFix, versionUrlFix, sender, 30);
                                }
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[AutoFix] 补全父版本失败: {ex.Message}");
                }

                if (string.IsNullOrEmpty(jsonPath) || !File.Exists(jsonPath))
                {
                    await ReportLaunchProgress(sender, 0, $" 找不到版本 JSON 文件，请检查 {versionDir} 文件夹");
                    return;
                }

                var cfg = GetEffectiveConfig(versionId);
                _currentVersionCfg = LoadVersionConfig(versionId);
                // ⭐ 正版账户检测
                MsAccountData msAcc = null;
                try { msAcc = FindMsAccountByName(username); } catch { }
                if (msAcc != null)
                {
                    try
                    {
                        await ReportLaunchProgress(sender, 8, "正在刷新正版令牌...");
                        msAcc = await EnsureMsTokenValidAsync(msAcc);
                        DiagnosticLogger.Instance.Info($"[Launch] ⭐ 正版账户：{msAcc.Username} ({msAcc.Uuid})");
                    }
                    catch (Exception ex)
                    {
                        DiagnosticLogger.Instance.Info($"[Launch] ⭐ 正版 token 刷新失败：{ex.Message}");
                        msAcc = null;
                        await ReportLaunchProgress(sender, 0, $" 正版令牌失效，请重新登录：{ex.Message}");
                        return;
                    }
                }
                var root = JsonDocument.Parse(await File.ReadAllTextAsync(jsonPath)).RootElement;
                JsonElement effectiveRoot = root;
                string parentId = null;

                // ⭐ 递归读整条 inheritsFrom 链
                var inheritChain = new List<JsonElement> { root };
                if (root.TryGetProperty("inheritsFrom", out var inheritsFrom))
                {
                    parentId = inheritsFrom.GetString();
                    var currentParent = parentId;
                    for (int depth = 0; depth < 5; depth++)
                    {
                        if (string.IsNullOrEmpty(currentParent)) break;
                        var parentJsonPath = Path.Combine(mcDir, "versions", currentParent, currentParent + ".json");
                        if (!File.Exists(parentJsonPath)) break;
                        var pRoot = JsonDocument.Parse(await File.ReadAllTextAsync(parentJsonPath)).RootElement;
                        inheritChain.Add(pRoot);
                        if (pRoot.TryGetProperty("inheritsFrom", out var pInh))
                            currentParent = pInh.GetString();
                        else
                            break;
                    }
                    effectiveRoot = inheritChain[inheritChain.Count - 1];
                }

                if (_ct.IsCancellationRequested) { await ReportLaunchProgress(sender, 0, "已取消", done: true); return; }
                await ReportLaunchProgress(sender, 15, "正在检测 Java...");

                string javaExe = null;

                // ⭐ 核心：绝对优先级！只要版本里指定了，不管全局是啥，直接用！
                if (_currentVersionCfg != null && !string.IsNullOrEmpty(_currentVersionCfg.JavaPath)
                    && File.Exists(_currentVersionCfg.JavaPath)
                    && Path.GetFileName(_currentVersionCfg.JavaPath).Equals("java.exe", StringComparison.OrdinalIgnoreCase))
                {
                    javaExe = _currentVersionCfg.JavaPath;
                    DiagnosticLogger.Instance.Info($"[Launch] ⭐ 强制复用版本专属 Java：{javaExe}");
                }

                // ⭐ 1. 如果没指定 Java，先让启动器自动找一个
                if (javaExe == null)
                {
                // ⭐ 通用：按版本需求自动准备 Java（不再写死 1.20.1）
                int _needJavaVer = GetRequiredJavaVersion(effectiveRoot);
                var _javaRoot = GetJavaDir();
                var _localJre = Path.Combine(_javaRoot, $"jre-{_needJavaVer}", "bin", "java.exe");
                if (File.Exists(_localJre))
                {
                    javaExe = _localJre;
                    DiagnosticLogger.Instance.Info($"[Launch] ⭐ 使用本地 Java {_needJavaVer}：{javaExe}");
                }
                else
                {
                    try
                    {
                        if (Directory.Exists(_javaRoot))
                        {
                            foreach (var _d in Directory.GetDirectories(_javaRoot, "*" + _needJavaVer + "*"))
                            {
                                var _exe = Path.Combine(_d, "bin", "java.exe");
                                if (File.Exists(_exe)) { javaExe = _exe; break; }
                            }
                        }
                    }
                    catch { }
                    if (javaExe == null)
                    {
                        var _fakeJson = JsonDocument.Parse($"{{\"javaVersion\":{{\"majorVersion\":{_needJavaVer}}}}}").RootElement;
                        javaExe = await EnsureJavaAvailableAsync(_fakeJson, sender);
                    }
                }
                }

                // ⭐ 2. 拿到 Java 后，进行版本强校验（终极保险）
                if (javaExe != null)
                {
                    int currentJavaVer = GetJavaVersion(javaExe);
                    int requiredVer = GetRequiredJavaVersion(effectiveRoot);

                    // 如果当前 Java 版本低于要求，强行去本地找高版本
                    if (requiredVer > currentJavaVer)
                    {
                        DiagnosticLogger.Instance.Info($"[Launch] 当前 Java ({currentJavaVer}) 低于需求 ({requiredVer})，尝试强行寻找...");

                        string jPath = Path.Combine(GetJavaDir(), $"jre-{requiredVer}", "bin", "java.exe");

                        // 双保险：没找到 jre，就去试 jdk
                        if (!File.Exists(jPath))
                        {
                            var jdkDirs = Directory.GetDirectories(GetJavaDir(), $"*{requiredVer}*");
                            foreach (var dir in jdkDirs)
                            {
                                var possibleExe = Path.Combine(dir, "bin", "java.exe");
                                if (File.Exists(possibleExe))
                                {
                                    jPath = possibleExe;
                                    break;
                                }
                            }
                        }

                        if (File.Exists(jPath))
                        {
                            javaExe = jPath;
                            DiagnosticLogger.Instance.Info($"[Launch] 已强行切换到: {javaExe}");
                        }
                    }
                }

                if (_ct.IsCancellationRequested) { await ReportLaunchProgress(sender, 0, "已取消", done: true); return; }
                await ReportLaunchProgress(sender, 50, "Java 就绪，正在检查游戏文件完整性...");

                // ⭐ 最多 3 轮补全 + 复查
                bool ok = false;
                for (int round = 0; round < 3; round++)
                {
                    ok = await CheckAndRepairAsync(versionId, effectiveRoot, root, mcDir, sender);
                    if (ok) break;

                    if (round < 2)
                    {
                        Debug.WriteLine($"[CheckRepair] 第 {round + 1} 轮仍有缺失，重试...");
                        await ReportLaunchProgress(sender, 50, $"文件复查 {round + 1}/3，继续补全...");
                        await Task.Delay(1000);
                    }
                }

                if (!ok)
                {
                    await ReportLaunchProgress(sender, 0, " 文件补全失败，请检查网络后重试");
                    return;
                }




                // ⭐ 启动前确保皮肤补丁
                if (!(versionId.Contains("-forge-") && versionId.Contains("1.20.2-")))
                {
                    await ReportLaunchProgress(sender, 52, "正在同步皮肤补丁...");
                    // ⭐ 已按用户要求关闭：不再自动下载 CustomSkinLoader（会让整合包模块冲突，改由用户自行放入 mods）
                    // await EnsureCustomSkinLoaderAsync(versionId, sender, 52, 54);
                    await SyncSkinToCSLAsync(versionId, username, skinId, sender);
                }

                if (_ct.IsCancellationRequested) { await ReportLaunchProgress(sender, 0, "已取消", done: true); return; }

                await ReportLaunchProgress(sender, 60, "正在智能解析依赖库...");
                await Task.Delay(150);

                // ⭐ 新增：新旧解析器切换开关。设为 true 用新引擎，设为 false 用旧逻辑兜底。
                bool useSmartResolver = true;
                var classpath = new List<string>();


                if (useSmartResolver)
                {
                    // ⭐ 补回后面代码需要用到的通用变量
                    libsDir = Path.Combine(mcDir, "libraries");
                    allLibs = new List<JsonElement>();
                    foreach (var layer in inheritChain)
                    {
                        if (layer.TryGetProperty("libraries", out var layerLibs))
                            allLibs.AddRange(layerLibs.EnumerateArray());
                    }
                    hasChild = !string.IsNullOrEmpty(parentId);

                    Debug.WriteLine("[Launch] ⭐ 启用新版智能解析器拼装 Classpath...");
                    var resolvedVersion = SmartVersionResolver.ResolveRaw(mcDir, versionId);
                    classpath = SmartVersionResolver.ResolveClasspath(resolvedVersion, mcDir);

                    // 把自身版本的核心 jar（包括继承链里的原版 jar）追加进去
                    var ownJar = Path.Combine(versionDir, versionId + ".jar");
                    if (File.Exists(ownJar) && !classpath.Contains(ownJar))
                        classpath.Add(ownJar);

                    // 兼容继承链里父版本的 jar
                    for (int i = inheritChain.Count - 1; i >= 0; i--)
                    {
                        var layer = inheritChain[i];
                        if (!layer.TryGetProperty("id", out var idEl)) continue;
                        var layerId = idEl.GetString();
                        if (string.IsNullOrEmpty(layerId)) continue;
                        var layerJar = Path.Combine(mcDir, "versions", layerId, layerId + ".jar");
                        if (File.Exists(layerJar) && !classpath.Contains(layerJar))
                            classpath.Add(layerJar);
                    }
                    DiagnosticLogger.Instance.Info($"[Launch] ⭐ 新版智能解析完成，共 {classpath.Count} 个 jar");
                }
                else
                {
                    // ============================================================
                    // 🛑 下面是旧版逻辑，原封不动留作兜底（千万别删）
                    // ============================================================
                    Debug.WriteLine("[Launch] ⚠️ 使用旧版逻辑拼装 Classpath...");

                    // ⭐ 强制性暴力补全：针对 1.7.10 / 1.12.2 等老版 Forge 的专属修护
                    if (versionId.Contains("1.7.10") && versionId.Contains("-forge-"))
                    {
                        var parts = versionId.Split(new[] { "-forge-" }, StringSplitOptions.None);
                        if (parts.Length >= 2)
                        {
                            var fullVer = $"{parts[0]}-{parts[1]}";
                            var universalJar = Path.Combine(mcDir, "libraries", "net", "minecraftforge", "forge", fullVer, $"forge-{fullVer}-universal.jar");

                            if (File.Exists(universalJar))
                            {
                                if (!classpath.Contains(universalJar))
                                {
                                    classpath.Add(universalJar);
                                    var legacyLibs = new[]
                                    {
                                     "org/ow2/asm/asm-all/5.0.3/asm-all-5.0.3.jar",
                                     "org/ow2/asm/asm-debug-all/5.0.3/asm-debug-all-5.0.3.jar",
                                     "lzma/lzma/0.0.1/lzma-0.0.1.jar",
                                     "org/tukaani/xz/1.5/xz-1.5.jar"
                                 };
                                    foreach (var libPathStr in legacyLibs)
                                    {
                                        var libPath = Path.Combine(mcDir, "libraries", libPathStr.Replace('/', Path.DirectorySeparatorChar));
                                        if (File.Exists(libPath) && !classpath.Contains(libPath))
                                        {
                                            classpath.Add(libPath);
                                            Debug.WriteLine($"[Classpath] ⭐ 强行补入老版依赖: {libPathStr}");
                                        }
                                    }
                                    Debug.WriteLine($"[Classpath] ⭐ 强行补入老版 Forge 核心: {universalJar}");
                                }
                            }
                            else
                            {
                                Debug.WriteLine($"[Classpath] ⚠️ 致命警告：找不到核心文件 {universalJar}");
                            }
                        }
                    }

                    var ownJar = Path.Combine(versionDir, versionId + ".jar");
                    if (File.Exists(ownJar)) classpath.Add(ownJar);

                    for (int i = inheritChain.Count - 1; i >= 0; i--)
                    {
                        var layer = inheritChain[i];
                        if (!layer.TryGetProperty("id", out var idEl)) continue;
                        var layerId = idEl.GetString();
                        if (string.IsNullOrEmpty(layerId)) continue;
                        var layerJar = Path.Combine(mcDir, "versions", layerId, layerId + ".jar");
                        if (File.Exists(layerJar) && !classpath.Contains(layerJar))
                            classpath.Add(layerJar);
                    }

                    libsDir = Path.Combine(mcDir, "libraries");
                    allLibs = new List<JsonElement>();
                    foreach (var layer in inheritChain)
                    {
                        if (layer.TryGetProperty("libraries", out var layerLibs))
                            allLibs.AddRange(layerLibs.EnumerateArray());
                    }
                    hasChild = !string.IsNullOrEmpty(parentId);

                    foreach (var lib in allLibs)
                    {
                        if (lib.TryGetProperty("rules", out var rules))
                            if (!IsAllowedOnWindows(rules)) continue;

                        if (lib.TryGetProperty("downloads", out var downloads) &&
                            downloads.TryGetProperty("artifact", out var artifact))
                        {
                            var path = artifact.GetProperty("path").GetString();
                            if (path.Contains("-natives-"))
                                continue;
                            var fullPath = Path.Combine(libsDir, path.Replace('/', Path.DirectorySeparatorChar));
                            if (File.Exists(fullPath) && !classpath.Contains(fullPath))
                                classpath.Add(fullPath);
                            continue;
                        }

                        if (lib.TryGetProperty("name", out var nameEl))
                        {
                            var name = nameEl.GetString();
                            if (string.IsNullOrEmpty(name)) continue;
                            var parts = name.Split(':');
                            if (parts.Length < 3) continue;

                            var group = parts[0].Replace('.', '/');
                            var artifactName = parts[1];
                            var version = parts[2];
                            var jarName = $"{artifactName}-{version}.jar";
                            var libPath = $"{group}/{artifactName}/{version}/{jarName}";
                            var fullPath = Path.Combine(libsDir, libPath.Replace('/', Path.DirectorySeparatorChar));

                            if (File.Exists(fullPath) && !classpath.Contains(fullPath))
                            {
                                classpath.Add(fullPath);
                            }
                        }
                    }

                    {
                        var seen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var p in classpath)
                        {
                            try
                            {
                                var dir = Path.GetDirectoryName(p);
                                if (string.IsNullOrEmpty(dir)) { seen[p.ToLowerInvariant()] = p; continue; }
                                var ver = Path.GetFileName(dir);
                                var artifact = Path.GetFileName(Path.GetDirectoryName(dir));
                                if (string.IsNullOrEmpty(artifact)) { seen[p.ToLowerInvariant()] = p; continue; }
                                var groupLeaf = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(dir))) ?? "";
                                var fileName = Path.GetFileNameWithoutExtension(p);
                                var prefix = artifact + "-" + ver;
                                var classifier = fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                                    ? fileName.Substring(prefix.Length)
                                    : "";
                                var key = (groupLeaf + ":" + artifact + classifier).ToLowerInvariant();
                                if (!seen.ContainsKey(key)) { seen[key] = p; continue; }

                                var oldDir = Path.GetDirectoryName(seen[key]);
                                var oldVer = string.IsNullOrEmpty(oldDir) ? "" : Path.GetFileName(oldDir);
                                var pa = ver.Split('.');
                                var pb = oldVer.Split('.');
                                int cmp = 0;
                                for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
                                {
                                    int na = 0, nb = 0;
                                    if (i < pa.Length) int.TryParse(pa[i], out na);
                                    if (i < pb.Length) int.TryParse(pb[i], out nb);
                                    if (na != nb) { cmp = na.CompareTo(nb); break; }
                                }
                                if (cmp > 0)
                                {
                                    seen[key] = p;
                                }
                            }
                            catch { seen[p.ToLowerInvariant()] = p; }
                        }
                        classpath = seen.Values.ToList();
                    }

                    if (versionId.Contains("1.12.2") && versionId.Contains("-forge-"))
                    {
                        var parts = versionId.Split(new[] { "-forge-" }, StringSplitOptions.None);
                        if (parts.Length >= 2)
                        {
                            var fullVer = $"{parts[0]}-{parts[1]}";
                            var universalJar = Path.Combine(mcDir, "libraries", "net", "minecraftforge", "forge", fullVer, $"forge-{fullVer}-universal.jar");
                            if (File.Exists(universalJar))
                            {
                                classpath.Add(universalJar);
                            }
                        }
                    }
                }

                var classpathStr = string.Join(";", classpath);
                DiagnosticLogger.Instance.Info($"[Launch] classpath 包含 {classpath.Count} 个 jar");

                await ReportLaunchProgress(sender, 75, "正在解压 Native 库...");
                await Task.Delay(100);

                // ⭐ 从继承链最顶层（子版本）往下找，第一个非空的 mainClass
                string mainClass = null;
                for (int i = 0; i < inheritChain.Count; i++)
                {
                    var layer = inheritChain[i];
                    if (layer.TryGetProperty("mainClass", out var mcEl))
                    {
                        var mcStr = mcEl.GetString();
                        if (!string.IsNullOrEmpty(mcStr))
                        {
                            mainClass = mcStr;
                            DiagnosticLogger.Instance.Info($"[Launch] ⭐ mainClass 来自层 {i} = {mainClass}");
                            break;
                        }
                    }
                }
                if (string.IsNullOrEmpty(mainClass)) mainClass = "net.minecraft.client.main.Main";

                var assetsDir = Path.Combine(mcDir, "assets");
                string assetIndexId = "legacy";
                if (effectiveRoot.TryGetProperty("assetIndex", out var ai) &&
                    ai.TryGetProperty("id", out var aiId))
                    assetIndexId = aiId.GetString();

                string uuid = msAcc?.Uuid ?? OfflineUuid(username);
                _currentAccessToken = msAcc?.McAccessToken ?? "null";

                var nativesRoot = Path.Combine(versionDir, "natives");
                if (!Directory.Exists(nativesRoot) && parentId != null)
                {
                    var parentNatives = Path.Combine(mcDir, "versions", parentId, "natives");
                    if (Directory.Exists(parentNatives))
                        nativesRoot = parentNatives;
                }
                Directory.CreateDirectory(nativesRoot);

                // 25.x/26.x 起部分版本把 java.library.path 指向 ${natives_directory}/java，
                // 必须把 DLL 解到 JVM 真正会搜的目录，否则报 Failed to locate library: lwjgl.dll。
                // 做法：直接读 json 里 -Djava.library.path 的目标目录，而不是猜字符串。
                var nativesExtractRoot = nativesRoot;
                try
                {
                    var jvmArgsNode = effectiveRoot.GetProperty("arguments").GetProperty("jvm");
                    string libPathArg = null;
                    foreach (var node in jvmArgsNode.EnumerateArray())
                    {
                        if (node.ValueKind != JsonValueKind.String) continue;
                        var s = node.GetString();
                        if (s != null && s.StartsWith("-Djava.library.path=", StringComparison.Ordinal))
                        {
                            libPathArg = s;
                            break;
                        }
                    }
                    if (libPathArg != null)
                    {
                        var target = libPathArg.Substring("-Djava.library.path=".Length).Trim('"');
                        target = target.Replace("${natives_directory}", nativesRoot)
                                       .Replace('/', Path.DirectorySeparatorChar);
                        // 只有当目标目录是 natives 根目录的子目录时才改，否则保持原行为
                        if (target.Length > nativesRoot.Length &&
                            target.StartsWith(nativesRoot, StringComparison.OrdinalIgnoreCase))
                            nativesExtractRoot = target;
                    }
                }
                catch
                {
                    // arguments 不存在（1.7.10/1.12.2 老格式）时保持平铺解压
                    nativesExtractRoot = nativesRoot;
                }
                Directory.CreateDirectory(nativesExtractRoot);
                Debug.WriteLine($"[Natives] 解压目标 = {nativesExtractRoot}");

                foreach (var lib in allLibs)
                {
                    if (lib.TryGetProperty("rules", out var rules))
                        if (!IsAllowedOnWindows(rules)) continue;

                    if (!lib.TryGetProperty("downloads", out var dl)) continue;

                    var nativeJarPaths = new List<string>();

                    if (dl.TryGetProperty("classifiers", out var classifiers) &&
                        classifiers.TryGetProperty("natives-windows", out var winNative))
                    {
                        var p = winNative.GetProperty("path").GetString();
                        if (!string.IsNullOrEmpty(p)) nativeJarPaths.Add(p);
                    }

                    if (dl.TryGetProperty("artifact", out var artifact))
                    {
                        var p = artifact.GetProperty("path").GetString();
                        if (!string.IsNullOrEmpty(p) && p.Contains("natives-windows"))
                            nativeJarPaths.Add(p);
                    }

                    foreach (var nativePath in nativeJarPaths)
                    {
                        var jarPath = Path.Combine(libsDir, nativePath.Replace('/', Path.DirectorySeparatorChar));
                        if (!File.Exists(jarPath))
                        {
                            Debug.WriteLine($"[Natives] 缺文件：{jarPath}");
                            continue;
                        }
                        try
                        {
                            Directory.CreateDirectory(nativesRoot);
                            using var zip = ZipFile.OpenRead(jarPath);
                            int extracted = 0;
                            foreach (var entry in zip.Entries)
                            {
                                if (string.IsNullOrEmpty(entry.Name)) continue;
                                if (entry.Name.EndsWith(".dll") ||
                                    entry.Name.EndsWith(".so") ||
                                    entry.Name.EndsWith(".dylib") ||
                                    entry.Name.EndsWith(".jnilib"))
                                {
                                    var dest = Path.Combine(nativesExtractRoot, entry.Name);
                                    if (!File.Exists(dest))
                                    {
                                        entry.ExtractToFile(dest, true);
                                        extracted++;
                                    }
                                }
                            }
                            if (extracted > 0)
                                Debug.WriteLine($"[Natives] {Path.GetFileName(jarPath)} 解压 {extracted} 个到 {nativesExtractRoot}");
                        }
                        catch (Exception ex)
                        {
                            Debug.WriteLine($"[Natives] 解压失败 {jarPath}: {ex.Message}");
                        }
                    }
                }

                await ReportLaunchProgress(sender, 85, "正在拼装启动参数...");
                await Task.Delay(200);

                // ⭐ jvm 参数读父 + 子两个 JSON
                var jvmArgs = new List<string>();
                bool usedJsonArgs = false;
                var jvmSources = new List<JsonElement>();

                bool childHasJvm = false;
                JsonElement childArgRoot = default;
                JsonElement childJvm = default;
                hasChild = !string.IsNullOrEmpty(parentId);
                childArgRoot = default;
                childJvm = default;

                if (hasChild &&
                    root.TryGetProperty("arguments", out childArgRoot) &&
                    childArgRoot.TryGetProperty("jvm", out childJvm))
                {
                    jvmSources.Add(childJvm);
                    usedJsonArgs = true;
                    childHasJvm = true;
                }

                if (!childHasJvm &&
                    effectiveRoot.TryGetProperty("arguments", out var effArgRoot) &&
                    effArgRoot.TryGetProperty("jvm", out var effJvm))
                {
                    jvmSources.Add(effJvm);
                    usedJsonArgs = true;
                }

                foreach (var jvmJson in jvmSources)
                {
                    foreach (var a in jvmJson.EnumerateArray())
                    {
                        if (a.ValueKind == JsonValueKind.String)
                        {
                            jvmArgs.Add(SubstituteVars(a.GetString(), username, versionId, mcDir, assetsDir, classpathStr, versionDir, assetIndexId, uuid));
                        }
                        else if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty("rules", out var rules))
                        {
                            if (!IsAllowedOnWindows(rules)) continue;
                            if (a.TryGetProperty("value", out var val))
                            {
                                if (val.ValueKind == JsonValueKind.String)
                                {
                                    jvmArgs.Add(SubstituteVars(val.GetString(), username, versionId, mcDir, assetsDir, classpathStr, versionDir, assetIndexId, uuid));
                                }
                                else if (val.ValueKind == JsonValueKind.Array)
                                {
                                    foreach (var v in val.EnumerateArray())
                                    {
                                        jvmArgs.Add(SubstituteVars(v.GetString(), username, versionId, mcDir, assetsDir, classpathStr, versionDir, assetIndexId, uuid));
                                    }
                                }
                            }
                        }
                    }
                }

                jvmArgs.RemoveAll(x => x.Contains("UseCompactObjectHeaders"));

                // ⭐ 对齐 PCL：json 里的 natives 参数原样保留，只在缺失时补一条。
                //    过去删掉 json 的 -Djava.library.path 再自己加 4 条，
                //    导致 1.16.5 的 LWJGL 重复加载原生库 -> JNI.invokePP 段错误。
                if (!jvmArgs.Any(x => x.StartsWith("-Djava.library.path=")))
                {
                    jvmArgs.Add("-Djava.library.path=" + nativesRoot);
                    DiagnosticLogger.Instance.Info($"[Launch] json 未提供 -Djava.library.path，已补：{nativesRoot}");
                }

                jvmArgs.RemoveAll(x => x.StartsWith("-Xmx"));
                jvmArgs.RemoveAll(x => x.StartsWith("-Xms"));
                jvmArgs.Add($"-Xmx{cfg.MaxMemoryMB}M");
                jvmArgs.Add($"-Xms{cfg.MaxMemoryMB}M");
                if (versionId.Contains("26.") && !jvmArgs.Any(x => x.Contains("StackShadowPages")))
                {
                    jvmArgs.Add("-XX:StackShadowPages=32");
                    Debug.WriteLine("[Launch] ⭐ 已自动注入防闪退参数: -XX:StackShadowPages=32");
                }

                if (cfg.MemoryPreset == "g1gc")
                {
                    if (!jvmArgs.Any(x => x.Contains("UseG1GC")))
                        jvmArgs.Add("-XX:+UseG1GC");
                    if (!jvmArgs.Any(x => x.Contains("MaxGCPauseMillis")))
                        jvmArgs.Add("-XX:MaxGCPauseMillis=50");
                }
                else if (cfg.MemoryPreset == "zgc")
                {
                    if (!jvmArgs.Any(x => x.Contains("UseZGC")))
                        jvmArgs.Add("-XX:+UseZGC");
                }

                int javaVer = GetJavaVersion(javaExe);

                if (!string.IsNullOrEmpty(cfg.JvmArgs))
                {
                    var userJvmArgs = SplitArgs(cfg.JvmArgs);

                    bool needUnlock = userJvmArgs.Any(x =>
                        x.Contains("G1NewSizePercent") ||
                        x.Contains("G1ReservePercent") ||
                        x.Contains("G1HeapRegionSize") ||
                        x.Contains("G1MixedGCLiveThresholdPercent") ||
                        x.Contains("G1RSetUpdatingPauseTimePercent"));

                    if (needUnlock && javaVer >= 21)
                    {
                        if (!userJvmArgs.Any(x => x.Contains("UnlockExperimentalVMOptions")))
                            userJvmArgs.Insert(0, "-XX:+UnlockExperimentalVMOptions");
                    }

                    foreach (var a in userJvmArgs)
                    {
                        if (!jvmArgs.Contains(a))
                            jvmArgs.Add(a);
                    }
                }

                if (javaVer >= 21)
                {
                    jvmArgs.RemoveAll(x => x.Contains("UnlockExperimentalVMOptions"));

                    bool hasExperimental = jvmArgs.Any(x =>
                        x.Contains("G1NewSizePercent") ||
                        x.Contains("G1ReservePercent") ||
                        x.Contains("G1HeapRegionSize") ||
                        x.Contains("G1MixedGCLiveThresholdPercent") ||
                        x.Contains("G1RSetUpdatingPauseTimePercent"));

                    if (hasExperimental)
                    {
                        jvmArgs.Insert(0, "-XX:+UnlockExperimentalVMOptions");
                        Debug.WriteLine("[Launch] ⭐ UnlockExperimentalVMOptions 已插到最前");
                    }
                }

                if (javaVer >= 24)
                {
                    if (!jvmArgs.Any(x => x.Contains("--sun-misc-unsafe-memory-access")))
                        jvmArgs.Add("--sun-misc-unsafe-memory-access=allow");
                    if (!jvmArgs.Any(x => x.Contains("--enable-native-access")))
                        jvmArgs.Add("--enable-native-access=ALL-UNNAMED");
                }

                if (cfg.DisableVulkan)
                    jvmArgs.Add("-Dorg.lwjgl.vulkan.disable=true");

                // ⭐ Forge/NeoForge 必需的 jvm 参数（模块路径等）：从版本 json 提取并补进 jvmArgs
                try
                {
                    if (effectiveRoot.TryGetProperty("arguments", out var _argRoot) &&
                        _argRoot.TryGetProperty("jvm", out var _jvmArr) && _jvmArr.ValueKind == JsonValueKind.Array)
                    {
                        var _raw = _jvmArr.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                            .Select(x => x.GetString() ?? "").ToList();
                        string Fix(string s) => s
                            .Replace("${library_directory}", Path.Combine(mcDir, "libraries"))
                            .Replace("${version_name}", versionId)
                            .Replace("${classpath_separator}", ";")
                            .Replace("${game_directory}", Path.Combine(mcDir, "versions", versionId));
                
                        for (int _i = 0; _i < _raw.Count; _i++)
                        {
                            var _s = _raw[_i];
                            if (string.IsNullOrEmpty(_s)) continue;
                            var _r = Fix(_s);
                            bool _isSwitch = _r == "-p" || _r == "--module-path" || _r == "--add-modules";
                            bool _isDef = _r.StartsWith("-DlegacyClassPath") || _r.StartsWith("-DmergeModules")
                                       || _r.StartsWith("-DignoreList") || _r.StartsWith("-DlibraryDirectory");
                            if (!_isSwitch && !_isDef) continue;
                            if (_isSwitch)
                            {
                                var _next = (_i + 1 < _raw.Count) ? Fix(_raw[_i + 1]) : "";
                                jvmArgs.Add(_r);
                                if (_next.Length > 0) jvmArgs.Add(_next);
                                _i++;
                            }
                            else
                            {
                                jvmArgs.Add(_r);
                            }
                        }
                        DiagnosticLogger.Instance.Info($"[Launch] ⭐ 已合并 json jvm 参数，当前 {jvmArgs.Count} 项，含 -p = {jvmArgs.Contains("-p")}");
                    }
                }
                catch (Exception ex) { DiagnosticLogger.Instance.Info($"[Launch] 合并 json jvm 参数失败：{ex.Message}"); }

                if (useSmartResolver)
                {
                    bool isForgeOrNeo = versionId.IndexOf("forge", StringComparison.OrdinalIgnoreCase) >= 0
                                     || versionId.IndexOf("neoforge", StringComparison.OrdinalIgnoreCase) >= 0;
                    if (isForgeOrNeo)
                    {
                        string mcVer = versionId;
                        int fi = versionId.IndexOf("-forge-", StringComparison.OrdinalIgnoreCase);
                        int ni = versionId.IndexOf("-neoforge-", StringComparison.OrdinalIgnoreCase);
                        bool containsModulePath = jvmArgs.Contains("-p") || jvmArgs.Contains("--module-path");
                        if (!containsModulePath)
                        {
                            Debug.WriteLine("[Launch] 未检测到 -p，沿用 -cp 注入");
                            if (fi > 0) mcVer = versionId.Substring(0, fi);
                            else if (ni > 0) mcVer = versionId.Substring(0, ni);
                            string vanillaJar = Path.Combine(mcDir, "versions", mcVer, mcVer + ".jar");

                            var legacyCp = classpath.Where(j => !j.Equals(vanillaJar, StringComparison.OrdinalIgnoreCase)).ToList();
                            if (!jvmArgs.Any(x => x.StartsWith("-DlegacyClassPath=")))
                            {
                                jvmArgs.Insert(0, "-DlegacyClassPath=" + string.Join(";", legacyCp));
                                DiagnosticLogger.Instance.Info($"[Launch] 已注入 -DlegacyClassPath（{legacyCp.Count} 个 jar）");
                            }
                            bool hasCp0 = jvmArgs.Contains("-cp") || jvmArgs.Any(x => x.StartsWith("-cp="));
                            if (!hasCp0)
                            {
                                jvmArgs.Insert(0, "-cp");
                                jvmArgs.Insert(1, classpathStr);
                                DiagnosticLogger.Instance.Info($"[Launch] 已注入 -cp ({classpath.Count} 个 jar)");
                            }
                        }
                    }
                        else { Debug.WriteLine("[Launch] ⭐ 检测到 -p（来自 json 模块路径），跳过 -cp 注入"); }
                }
                else
                {
                    bool isForgeOrNeo = versionId.IndexOf("forge", StringComparison.OrdinalIgnoreCase) >= 0
                                     || versionId.IndexOf("neoforge", StringComparison.OrdinalIgnoreCase) >= 0;
                    if (isForgeOrNeo)
                    {
                        string mcVer = versionId;
                        int fi = versionId.IndexOf("-forge-", StringComparison.OrdinalIgnoreCase);
                        int ni = versionId.IndexOf("-neoforge-", StringComparison.OrdinalIgnoreCase);
                        if (fi > 0) mcVer = versionId.Substring(0, fi);
                        else if (ni > 0) mcVer = versionId.Substring(0, ni);
                        string vanillaJar = Path.Combine(mcDir, "versions", mcVer, mcVer + ".jar");

                        var legacyCp = classpath.Where(j => !j.Equals(vanillaJar, StringComparison.OrdinalIgnoreCase)).ToList();
                        // json 里已有就不重复注入
                        if (!jvmArgs.Any(x => x.StartsWith("-DlegacyClassPath=")))
                        {
                            jvmArgs.Insert(0, "-DlegacyClassPath=" + string.Join(";", legacyCp));
                            DiagnosticLogger.Instance.Info($"[Launch] 已注入 -DlegacyClassPath（{legacyCp.Count} 个 jar，排除原版 {vanillaJar}）");
                        }

                    bool hasModulePath = jvmArgs.Any(x => x == "-p" || x == "--module-path");
                    bool hasCp = jvmArgs.Contains("-cp") || jvmArgs.Contains("-classpath") || jvmArgs.Any(x => x.StartsWith("-cp="));
                    if (!hasModulePath && !hasCp)
                    {
                        jvmArgs.Insert(0, "-cp");
                        jvmArgs.Insert(1, classpathStr);
                        DiagnosticLogger.Instance.Info($"[Launch] 已注入 -cp ({classpath.Count} 个 jar)");
                    }
                    }
                    else
                    {
                        DiagnosticLogger.Instance.Info($"[Launch] ⭐ 检测到 -p，跳过 -cp 注入");
                    }
                }

            

                if (!jvmArgs.Contains(mainClass))
                    jvmArgs.Add(mainClass);

                // ⭐ game 参数读父 + 子两个 JSON
                var gameArgs = new List<string>();
                var gameSources = new List<JsonElement>();
                if (effectiveRoot.TryGetProperty("arguments", out var effGameRoot) &&
                    effGameRoot.TryGetProperty("game", out var effGame))
                {
                    gameSources.Add(effGame);
                }
                JsonElement childGameRoot = default;
                JsonElement childGame = default;

                if (hasChild &&
                    root.TryGetProperty("arguments", out childGameRoot) &&
                    childGameRoot.TryGetProperty("game", out childGame))
                {
                    gameSources.Add(childGame);
                }

                if (gameSources.Count > 0)
                {
                    foreach (var gameJson in gameSources)
                    {
                        foreach (var a in gameJson.EnumerateArray())
                        {
                            if (a.ValueKind == JsonValueKind.String)
                            {
                                var s = SubstituteVars(a.GetString(), username, versionId, mcDir, assetsDir, classpathStr, versionDir, assetIndexId, uuid);
                                if (!string.IsNullOrEmpty(s)) gameArgs.Add(s);
                            }
                            else if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty("rules", out var rules))
                            {
                                if (!IsAllowedOnWindows(rules)) continue;
                                if (a.TryGetProperty("value", out var val))
                                {
                                    if (val.ValueKind == JsonValueKind.String)
                                    {
                                        var s = SubstituteVars(val.GetString(), username, versionId, mcDir, assetsDir, classpathStr, versionDir, assetIndexId, uuid);
                                        if (!string.IsNullOrEmpty(s)) gameArgs.Add(s);
                                    }
                                    else if (val.ValueKind == JsonValueKind.Array)
                                    {
                                        foreach (var v in val.EnumerateArray())
                                        {
                                            var s = SubstituteVars(v.GetString(), username, versionId, mcDir, assetsDir, classpathStr, versionDir, assetIndexId, uuid);
                                            if (!string.IsNullOrEmpty(s)) gameArgs.Add(s);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    var cleaned = new List<string>();
            // ⭐ 强制兜底：Forge/NeoForge 的 game 参数（--launchTarget / --fml.*）必须传
            if (!gameArgs.Contains("--launchTarget"))
            {
                var _curG = versionId;
                for (int _dG = 0; _dG < 6 && !string.IsNullOrEmpty(_curG); _dG++)
                {
                    var _jpG = Path.Combine(mcDir, "versions", _curG, _curG + ".json");
                    if (!File.Exists(_jpG)) break;
                    try
                    {
                        using var _docG = JsonDocument.Parse(File.ReadAllText(_jpG));
                        if (_docG.RootElement.TryGetProperty("arguments", out var _aG) &&
                            _aG.TryGetProperty("game", out var _gG) && _gG.ValueKind == JsonValueKind.Array)
                        {
                            var _arrG = _gG.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                                          .Select(x => x.GetString() ?? "").ToList();
                            for (int _kG = 0; _kG < _arrG.Count; _kG++)
                            {
                                var _sG = _arrG[_kG];
                                if (_sG == "--launchTarget" || _sG.StartsWith("--fml."))
                                {
                                    if (!gameArgs.Contains(_sG)) gameArgs.Add(_sG);
                                    if (_kG + 1 < _arrG.Count && !gameArgs.Contains(_arrG[_kG + 1])) gameArgs.Add(_arrG[_kG + 1]);
                                    _kG++;
                                }
                            }
                        }
                        _curG = _docG.RootElement.TryGetProperty("inheritsFrom", out var _iG) ? (_iG.GetString() ?? "") : "";
                    }
                    catch { break; }
                }
                DiagnosticLogger.Instance.Info($"[Launch] ⭐ 兜底注入 Forge game 参数后共 {gameArgs.Count} 项");
            }
                    for (int i = 0; i < gameArgs.Count; i++)
                    {
                        if (gameArgs[i] == "--clientId" || gameArgs[i] == "--xuid") { i++; continue; }
                        cleaned.Add(gameArgs[i]);
                    }
                    gameArgs = cleaned;
                }

                else if (root.TryGetProperty("minecraftArguments", out var legacyArgs) &&
          !string.IsNullOrEmpty(legacyArgs.GetString()))
                {
                    Debug.WriteLine($"[LegacyArgs] {legacyArgs.GetString()}");
                    foreach (var a in SplitArgs(legacyArgs.GetString()))
                    {
                        var s = SubstituteVars(a, username, versionId, mcDir, assetsDir, classpathStr, versionDir, assetIndexId, uuid);
                        if (!string.IsNullOrEmpty(s)) gameArgs.Add(s);
                    }
                }
                else
                {
                    gameArgs.AddRange(new[]
                    {
                     "--username", username,
                     "--version", versionId,
                     "--gameDir", versionDir,
                     "--assetsDir", assetsDir,
                     "--assetIndex", assetIndexId,
                     "--uuid", uuid,
                     "--accessToken", "null",
                     "--userType", "legacy",
                     "--versionType", "release",
                 });
                }

                if (!string.IsNullOrEmpty(cfg.GameArgs))
                    foreach (var a in SplitArgs(cfg.GameArgs))
                        gameArgs.Add(a);

                if (cfg.UseHighPerformanceGpu)
                {
                    try { SetHighPerformanceGpu(javaExe); } catch { }
                }
                EnsureGlobalChineseOptions(versionId);
                try { Directory.CreateDirectory(Path.Combine(versionDir, "config")); } catch { }

                // ⭐ 最后的平滑缓冲
                await ReportLaunchProgress(sender, 92, "正在注入游戏环境...");
                await Task.Delay(200);
                await ReportLaunchProgress(sender, 98, "正在等待游戏窗口响应...");
                await Task.Delay(300);

                if (_ct.IsCancellationRequested)
                {
                    await ReportLaunchProgress(sender, 0, "已取消", done: true);
                    return;
                }


                Environment.SetEnvironmentVariable("JDK_JAVA_OPTIONS", "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED --add-opens=java.base/java.lang.reflect=ALL-UNNAMED --add-opens=java.base/java.util=ALL-UNNAMED --add-opens=java.base/java.nio=ALL-UNNAMED --add-opens=java.base/sun.nio.ch=ALL-UNNAMED --add-opens=java.base/java.lang=ALL-UNNAMED");

                // ⭐ 兜底：没有 Java 就别硬启，给用户明确提示
                if (string.IsNullOrWhiteSpace(javaExe))
                {
                    await ReportLaunchProgress(sender, 0, "未找到可用的 Java，请在设置里选择 Java 路径", done: true);
                    return;
                }

                // ⭐ 最终修正：Forge/NeoForge 需要 -p + --add-opens + -DlegacyClassPath，沿继承链全量取
                try
                {
                    // 原始 -cp 值（作为 legacyClassPath 的来源）
                    string _legacyCp = "";
                    int _cpIdx0 = jvmArgs.IndexOf("-cp");
                    if (_cpIdx0 >= 0 && _cpIdx0 + 1 < jvmArgs.Count) _legacyCp = jvmArgs[_cpIdx0 + 1];
                
                    List<string> _forgeJvm = null;
                    List<string> _forgeGame = null;
                    var _curId = versionId;
                    for (int _depth = 0; _depth < 6 && !string.IsNullOrEmpty(_curId); _depth++)
                    {
                        var _jp = Path.Combine(mcDir, "versions", _curId, _curId + ".json");
                        if (!File.Exists(_jp)) break;
                        using var _doc = JsonDocument.Parse(File.ReadAllText(_jp));
                        var _root2 = _doc.RootElement;
                
                        string Fix2(string s2) => s2
                            .Replace("${library_directory}", Path.Combine(mcDir, "libraries"))
                            .Replace("${classpath_separator}", ";")
                            .Replace("${version_name}", versionId)
                            .Replace("${game_directory}", Path.Combine(mcDir, "versions", versionId))
                            .Replace("${assets_root}", Path.Combine(mcDir, "assets"))
                            .Replace("${assets_index_name}", effectiveRoot.TryGetProperty("assetIndex", out var _ai) && _ai.TryGetProperty("id", out var _aiId) ? (_aiId.GetString() ?? "legacy") : "legacy")
                            .Replace("${classpath}", _legacyCp)
                            .Replace("${launcher_name}", "illusionLauncher")
                            .Replace("${launcher_version}", "1.0.0");
                
                        if (_root2.TryGetProperty("arguments", out var _ar2) &&
                            _ar2.TryGetProperty("jvm", out var _ja2) && _ja2.ValueKind == JsonValueKind.Array)
                        {
                            var _list = new List<string>();
                            foreach (var _e2 in _ja2.EnumerateArray())
                            {
                                if (_e2.ValueKind == JsonValueKind.String) _list.Add(_e2.GetString() ?? "");
                                else if (_e2.ValueKind == JsonValueKind.Object && _e2.TryGetProperty("value", out var _v2))
                                {
                                    if (_v2.ValueKind == JsonValueKind.Array)
                                        foreach (var _x2 in _v2.EnumerateArray()) if (_x2.ValueKind == JsonValueKind.String) _list.Add(_x2.GetString() ?? "");
                                    else if (_v2.ValueKind == JsonValueKind.String) _list.Add(_v2.GetString() ?? "");
                                }
                            }
                            // 只要含 -p 的版本，说明是 Forge/NeoForge 家族
                            if (_list.Any(x => x == "-p" || x == "--module-path"))
                            {
                                _forgeJvm = _list.Select(Fix2).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
                                // 同时取出 Forge 特有的游戏参数（--launchTarget / --fml.*）
                                if (_root2.TryGetProperty("arguments", out var _arG) && _arG.TryGetProperty("game", out var _jg) && _jg.ValueKind == JsonValueKind.Array)
                                {
                                    var _gl = new List<string>();
                                    foreach (var _ge in _jg.EnumerateArray())
                                    {
                                        if (_ge.ValueKind == JsonValueKind.String) _gl.Add(_ge.GetString() ?? "");
                                        else if (_ge.ValueKind == JsonValueKind.Object && _ge.TryGetProperty("value", out var _gv))
                                        {
                                            if (_gv.ValueKind == JsonValueKind.Array)
                                                foreach (var _gx in _gv.EnumerateArray()) if (_gx.ValueKind == JsonValueKind.String) _gl.Add(_gx.GetString() ?? "");
                                            else if (_gv.ValueKind == JsonValueKind.String) _gl.Add(_gv.GetString() ?? "");
                                        }
                                    }
                                    var _keep = new List<string>();
                                    for (int _gi = 0; _gi < _gl.Count; _gi++)
                                    {
                                        var _it = _gl[_gi];
                                        if (_it == "--launchTarget" || _it.StartsWith("--fml."))
                                        { _keep.Add(_it); if (_gi + 1 < _gl.Count) _keep.Add(_gl[++_gi]); }
                                    }
                                    if (_keep.Count > 0) _forgeGame = _keep.Select(Fix2).ToList();
                                }
                                break;
                            }
                        }
                
                        _curId = _root2.TryGetProperty("inheritsFrom", out var _inh2) ? (_inh2.GetString() ?? "") : "";
                    }
                
                    if (_forgeJvm != null && _forgeJvm.Count > 0)
                    {
                        // 移除旧的 -cp 与旧的 -p/--add-modules（避免重复）
                        int _ci = jvmArgs.IndexOf("-cp");
                        // ⭐ 先删值再删 -cp，避免位置错乱误删 -p
                        if (_ci >= 0)
                        {
                            if (_ci + 1 < jvmArgs.Count) jvmArgs.RemoveAt(_ci + 1);
                            jvmArgs.RemoveAt(_ci);
                        }
                        int _mcPos = jvmArgs.FindIndex(x => x == mainClass);
                        if (_mcPos < 0) _mcPos = jvmArgs.Count;
                
                        // 过滤掉与已有参数重复的项
                        var _toAdd = new List<string>();
                        for (int _k = 0; _k < _forgeJvm.Count; _k++)
                        {
                            var _it = _forgeJvm[_k];
                            if (_it == "-p" || _it == "--module-path" || _it == "--add-modules" || _it == "--add-opens")
                            { _toAdd.Add(_it); if (_k + 1 < _forgeJvm.Count) _toAdd.Add(_forgeJvm[++_k]); continue; }
                            if (jvmArgs.Any(x => x == _it)) continue;
                            _toAdd.Add(_it);
                        }
                        // ⭐ Forge 的 json 里没有 -DlegacyClassPath，必须启动器自己补（客户端 jar + 全部库）
                        if (!_toAdd.Any(x => x.StartsWith("-DlegacyClassPath")))
                        {
                            var _clientJar = Path.Combine(mcDir, "versions", effectiveRoot.TryGetProperty("id", out var _idEl) ? (_idEl.GetString() ?? versionId) : versionId);
                            var _allJars = new System.Text.StringBuilder();
                            if (!string.IsNullOrEmpty(_legacyCp)) _allJars.Append(_legacyCp);
                            // ⭐ NeoForge 需要从 legacyClassPath 里的客户端 jar 构建 minecraft 模块
                            // ⭐ 沿继承链找到真正带 jar 的 MC 版本（整合包名不是 MC 版本）
                            if (versionId.IndexOf("neoforge", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                            var _mcVerForLc = versionId;
                            var _probe = versionId;
                            for (int _pd = 0; _pd < 6 && !string.IsNullOrEmpty(_probe); _pd++)
                            {
                                var _pj = Path.Combine(mcDir, "versions", _probe, _probe + ".jar");
                                if (File.Exists(_pj)) { _mcVerForLc = _probe; break; }
                                var _pjson = Path.Combine(mcDir, "versions", _probe, _probe + ".json");
                                if (!File.Exists(_pjson)) break;
                                try
                                {
                                    using var _pdoc = JsonDocument.Parse(File.ReadAllText(_pjson));
                                    _probe = _pdoc.RootElement.TryGetProperty("inheritsFrom", out var _pinh) ? (_pinh.GetString() ?? "") : "";
                                }
                                catch { break; }
                            }
                            DiagnosticLogger.Instance.Info($"[Launch] legacyClassPath 用的 MC 版本 = {_mcVerForLc}");
                            var _clientJarForLc = Path.Combine(mcDir, "versions", _mcVerForLc, _mcVerForLc + ".jar");
                            if (File.Exists(_clientJarForLc) && !_allJars.ToString().Split(';').Any(x => string.Equals(x, _clientJarForLc, StringComparison.OrdinalIgnoreCase)))
                            {
                                var _lcTmp = _allJars.ToString();
                                _allJars.Clear();
                                _allJars.Append(_clientJarForLc);
                                if (!string.IsNullOrEmpty(_lcTmp)) { _allJars.Append(";"); _allJars.Append(_lcTmp); }
                                Debug.WriteLine("[Launch] ⭐ legacyClassPath 已加入客户端 jar: " + _clientJarForLc);
                            }
                            }
                            _toAdd.Add("-DlegacyClassPath=" + _allJars.ToString());
                            DiagnosticLogger.Instance.Info($"[Launch] ⭐ 已补 -DlegacyClassPath（{_legacyCp.Split(';').Length} 项）");
                        }
            // ⭐ 按 HMCL 做法重写 ignoreList：把"文件名子串"展开成精确的库路径
            //    BootstrapLauncher 的 ignoreList 是"路径包含子串就忽略"，用文件名会把客户端 jar 也误伤
            if (versionId.IndexOf("neoforge", StringComparison.OrdinalIgnoreCase) >= 0)
            {
            int _ignIdx2 = _toAdd.FindIndex(x => x.StartsWith("-DignoreList="));
            if (_ignIdx2 >= 0)
            {
                var _rawIgn = _toAdd[_ignIdx2].Substring("-DignoreList=".Length);
                var _subs = _rawIgn.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
                var _exactIgn = new List<string>();
                var _curI = versionId;
                for (int _di = 0; _di < 6 && !string.IsNullOrEmpty(_curI); _di++)
                {
                    var _jpI = Path.Combine(mcDir, "versions", _curI, _curI + ".json");
                    if (!File.Exists(_jpI)) break;
                    try
                    {
                        using var _docI = JsonDocument.Parse(File.ReadAllText(_jpI));
                        var _rootI = _docI.RootElement;
                        if (_rootI.TryGetProperty("libraries", out var _arrI) && _arrI.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var _libI in _arrI.EnumerateArray())
                            {
                                if (!_libI.TryGetProperty("downloads", out var _dlI) || !_dlI.TryGetProperty("artifact", out var _arI)) continue;
                                var _relI = _arI.TryGetProperty("path", out var _pI) ? _pI.GetString() : null;
                                if (string.IsNullOrEmpty(_relI)) continue;
                                var _fullI = Path.Combine(mcDir, "libraries", _relI.Replace('/', Path.DirectorySeparatorChar));
                                var _fnI = Path.GetFileName(_fullI);
                                if (_subs.Any(s => _fnI.IndexOf(s, StringComparison.OrdinalIgnoreCase) >= 0) && !_exactIgn.Contains(_fullI))
                                    _exactIgn.Add(_fullI);
                            }
                        }
                        _curI = _rootI.TryGetProperty("inheritsFrom", out var _inhI) ? (_inhI.GetString() ?? "") : "";
                    }
                    catch { break; }
                }
                if (_exactIgn.Count > 0)
                {
                    _toAdd[_ignIdx2] = "-DignoreList=" + string.Join(";", _exactIgn);
                    DiagnosticLogger.Instance.Info($"[Launch] ⭐ ignoreList 已重写为 {_exactIgn.Count} 个精确路径（客户端 jar 不再被误伤）");
                }
            }
            }
                        // ⭐ 兜底：BootstrapLauncher:141 必须有 -DlegacyClassPath（所有版本）
                        if (!_toAdd.Any(x => x.StartsWith("-DlegacyClassPath=")) && !string.IsNullOrEmpty(_legacyCp))
                        {
                            _toAdd.Add("-DlegacyClassPath=" + _legacyCp);
                            Debug.WriteLine("[Launch] ⭐ 兜底补 -DlegacyClassPath（" + _legacyCp.Split(';').Length + " 项）");
                        }
                        // ⭐ ignoreList 兜底：必须含真实客户端 jar 名，否则它会被当成模块（_1._20._1）
                        int _ignFb = _toAdd.FindIndex(x => x.StartsWith("-DignoreList="));
                        if (_ignFb >= 0)
                        {
                            var _mcVerFb = versionId;
                            var _probeFb = versionId;
                            for (int _df = 0; _df < 6 && !string.IsNullOrEmpty(_probeFb); _df++)
                            {
                                if (File.Exists(Path.Combine(mcDir, "versions", _probeFb, _probeFb + ".jar"))) { _mcVerFb = _probeFb; break; }
                                var _jf = Path.Combine(mcDir, "versions", _probeFb, _probeFb + ".json");
                                if (!File.Exists(_jf)) break;
                                try { using var _dF = JsonDocument.Parse(File.ReadAllText(_jf)); _probeFb = _dF.RootElement.TryGetProperty("inheritsFrom", out var _iF) ? (_iF.GetString() ?? "") : ""; }
                                catch { break; }
                            }
                            if (!_toAdd[_ignFb].Contains(_mcVerFb + ".jar"))
                            {
                                _toAdd[_ignFb] += "," + _mcVerFb + ".jar,client.jar";
                                Debug.WriteLine("[Launch] ⭐ ignoreList 已补 " + _mcVerFb + ".jar");
                            }
                        }
                        jvmArgs.InsertRange(_mcPos, _toAdd);
                        // ⭐ Forge 游戏参数（--launchTarget / --fml.*）
                        if (_forgeGame != null)
                            foreach (var _fg in _forgeGame) if (!gameArgs.Contains(_fg)) gameArgs.Add(_fg);
                        DiagnosticLogger.Instance.Info($"[Launch] ⭐ Forge 参数已合并：{_toAdd.Count} 项（含 -p / --add-opens / -DlegacyClassPath）");
                    }
                    else Debug.WriteLine("[Launch] 未在继承链中找到 Forge 模块参数，保持原样");
                }
                catch (Exception ex) { DiagnosticLogger.Instance.Info($"[Launch] 模块路径修正失败：{ex.Message}"); }


                var psi = new ProcessStartInfo
                {
                    FileName = javaExe,
                    WorkingDirectory = mcDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };

                // 纯净拼装：JSON 给什么就拼什么
                // ⭐ 加载器专属补丁（只对 ForgeBootstrap 等特定主类生效，不影响其他版本）
                // ⭐ 传入「实际要用哪个 Java 的版本号」：模块参数是否合法取决于 JVM 版本，不取决于加载器。
                //    取不到版本时返回 0，Apply 内部按历史行为处理（参数照留），不会改变已验证版本的表现。
                LoaderPatches.Apply(versionId, mainClass, jvmArgs, gameArgs, mcDir, GetJavaVersion(javaExe));

                // ⚠ 绝不做 JVM 参数去重：--add-opens / --add-exports 同名不同值必须原样保留。
                //   一旦按 key 去重会删掉模块开放声明，1.20.1 曾因此崩在 ExceptionInInitializerError。
                
                foreach (var a in jvmArgs) psi.ArgumentList.Add(a);
                if (!jvmArgs.Contains(mainClass)) psi.ArgumentList.Add(mainClass);
                foreach (var a in gameArgs) psi.ArgumentList.Add(a);

                DiagnosticLogger.Instance.Info($"[Launch] Java: {javaExe}");
                DiagnosticLogger.Instance.Info($"[Launch] 主类: {mainClass}");
                DiagnosticLogger.Instance.Info($"[Launch] JVM({jvmArgs.Count}): {SummarizeArgs(jvmArgs)}");
                DiagnosticLogger.Instance.Info($"[Launch] Game({gameArgs.Count}): {SummarizeArgs(gameArgs)}");
                WriteFullArgsLog(mcDir, javaExe, jvmArgs, mainClass, gameArgs);
                // ⭐ 清空本次启动的启动器日志（避免累积）
                try
                {
                    var logDir = Path.Combine(mcDir, "logs");
                    Directory.CreateDirectory(logDir);
                    var launcherLog = Path.Combine(logDir, $"launcher-{DateTime.Now:yyyyMMdd}.log");
                    if (File.Exists(launcherLog)) File.Delete(launcherLog);
                }
                catch { }
                var logQueue = new System.Collections.Concurrent.ConcurrentQueue<string>();
                var lastFlush = DateTime.Now;

                void FlushGameLogs()
                {
                    if (logQueue.IsEmpty) return;
                    var sb = new StringBuilder();
                    string line;
                    int count = 0;
                    while (count < 300 && logQueue.TryDequeue(out line))
                    {
                        sb.AppendLine(line);
                        count++;
                    }
                    if (sb.Length == 0) return;

                    var text = sb.ToString();
                    try
                    {
                        var logDir = Path.Combine(mcDir, "logs");
                        Directory.CreateDirectory(logDir);
                        File.AppendAllText(
                            Path.Combine(logDir, $"launcher-{DateTime.Now:yyyyMMdd}.log"),
                            text);
                    }
                    catch { }

                    if (sender != null)
                    {
                        var json = JsonSerializer.Serialize(new { type = "log", text });
                        _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onGameLog({json})"); });
                    }
                }

                Process proc;
                try
                {
                    proc = new Process { StartInfo = psi, EnableRaisingEvents = true };

                    proc.OutputDataReceived += (s, e) =>
                    {
                        if (e.Data == null) return;
                        Debug.WriteLine($"[MC-OUT] {e.Data}");
                        logQueue.Enqueue(e.Data);
                        var now = DateTime.Now;
                        if ((now - lastFlush).TotalMilliseconds >= 300 || logQueue.Count >= 100)
                        {
                            lastFlush = now;
                            FlushGameLogs();
                        }
                    };
                    proc.ErrorDataReceived += (s, e) =>
                    {
                        if (e.Data == null) return;
                        Debug.WriteLine($"[MC-ERR] {e.Data}");
                        logQueue.Enqueue("[ERR] " + e.Data);
                    };

                    var startTime = DateTime.Now;
                    var stats0 = LoadStats();
                    stats0.LaunchCount++;
                    stats0.LastLaunch = startTime.ToString("s");
                    if (!stats0.PerInstance.ContainsKey(versionId))
                        stats0.PerInstance[versionId] = new InstanceStats();
                    stats0.PerInstance[versionId].LaunchCount++;
                    SaveStats(stats0);

                    proc.Exited += async (s, e) =>
                    {
                        // 游戏退出时，干掉灵动岛
                        await Dispatcher.InvokeAsync(() =>
                        {
                            if (_currentCapsule != null)
                            {
                                try { _currentCapsule.Close(); } catch { }
                                _currentCapsule = null;
                            }
                        });
                        // ⭐ 新增：游戏退出时，自动关掉胶囊窗口
                        try
                        {
                            foreach (System.Windows.Window win in System.Windows.Application.Current.Windows)
                            {
                                if (win is CapsuleWindow)
                                {
                                    win.Close();
                                }
                            }
                        }
                        catch { }

                        // ⭐ 取消后台补全
                        try { _bgRepairCts?.Cancel(); } catch { }
                        _bgRepairCts?.Dispose();
                        _bgRepairCts = null;

                        try
                        {
                            Dispatcher.Invoke(() =>
                            {
                                try
                                {
                                    // ⭐ 1. 恢复任务栏图标
                                    this.ShowInTaskbar = true;
                                    // ⭐ 2. 让被隐藏的窗口重新显示
                                    this.Visibility = System.Windows.Visibility.Visible;
                                    // ⭐ 3. 如果是最小化状态，还原它
                                    if (this.WindowState == System.Windows.WindowState.Minimized)
                                        this.WindowState = System.Windows.WindowState.Normal;

                                    // ⭐ 4. 强行把启动器拉到最前面
                                    this.Activate();
                                    SetForegroundWindow(_hwnd);
                                }
                                catch { }
                            });

                            int exitCode = proc.ExitCode;
                            Debug.WriteLine($"[MC] 进程退出，ExitCode = {exitCode}");

                            FlushGameLogs();


                            var duration = (long)(DateTime.Now - startTime).TotalSeconds;
                            var st = LoadStats();
                            st.TotalPlayTimeSeconds += duration;
                            if (st.PerInstance.ContainsKey(versionId))
                                st.PerInstance[versionId].PlayTimeSeconds += duration;
                            SaveStats(st);
                            var statsJson = JsonSerializer.Serialize(st, JsonOpts());
                            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onStatsUpdated({statsJson})"); });

                            if (exitCode != 0)
                            {
                                // ⭐ 核心拦截：如果退出码是 -1，说明是被咱们强杀或者玩家自己点叉关的，不弹崩溃窗口
                                if (exitCode == -1)
                                {
                                    var killJson = JsonSerializer.Serialize(new { versionId = versionId });
                                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onGameForceKilled({killJson})"); });
                                }
                                else
                                {
                                    // 真正的崩溃，保留原来的弹窗逻辑
                                    await Task.Delay(800);   // 给游戏时间写完日志文件
                                    var crashLog = ReadLatestCrashLog(mcDir);
                                    var combined = new StringBuilder();
                                    combined.AppendLine("===== 崩溃信息 =====");
                                    combined.AppendLine($"版本：{versionId}");
                                    combined.AppendLine($"退出码：{exitCode}");
                                    combined.AppendLine();
                                    combined.AppendLine("===== 崩溃日志 =====");
                                    combined.AppendLine(crashLog ?? "(无详细信息，请查看设置页日志面板)");

                                    // ⭐ 中文诊断：把英文崩溃信息翻译成用户能看懂的提示
                                    string _diagSrc = combined.ToString();
                                    try
                                    {
                                        var _lp = Path.Combine(mcDir, "logs", "latest.log");
                                        if (File.Exists(_lp))
                                        {
                                            var _t = File.ReadAllText(_lp);
                                            _diagSrc += "\n" + (_t.Length > 30000 ? _t.Substring(_t.Length - 30000) : _t);
                                        }
                                    }
                                    catch { }
                                    var _diagTip = LoaderPatches.DiagnoseError(_diagSrc) ?? "";

                                    var crashJson = JsonSerializer.Serialize(new
                                    {
                                        versionId = versionId,
                                        exitCode = exitCode,
                                        log = combined.ToString(),
                                        diagTip = _diagTip
                                    });
                                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onGameCrashed({crashJson})"); });
                                }
                            }
                        }
                        catch { }
                    };
                    // ⭐ 启动前的最后一道防线：如果玩家点了取消，直接退出
                    if (_isCancelled)
                    {
                        await ReportLaunchProgress(sender, 0, "已取消", done: true);
                        return;
                    }

                    proc.Start();
                    proc.BeginOutputReadLine();
                    proc.BeginErrorReadLine();
                    await ReportLaunchProgress(sender, 98, "游戏初始化中...", done: false);
                    _shouldMinimize = true;
                    _lastProcess = proc;

                    McOptimizer.Boost(proc);   // ⭐ AboveNormal 优先级 + 关闭电源节流

                    // ⭐ 启动后台全局补全
                    _bgRepairCts?.Cancel();
                    _bgRepairCts?.Dispose();
                    _bgRepairCts = new CancellationTokenSource();
                    var bgCt = _bgRepairCts.Token;
                    _ = Task.Run(() => BackgroundGlobalRepairAsync(bgCt));

                    await ReportLaunchProgress(sender, 100, $" {versionId} 已启动 (PID {proc.Id})", done: true);

                    // ⭐ 启动器后台隐藏逻辑（精准检测游戏窗口）
                    _ = Task.Run(async () =>
                    {
                        // 最多等 60 秒（120次 * 500毫秒）
                        for (int i = 0; i < 120; i++)
                        {
                            await Task.Delay(500);
                            if (proc.HasExited) break; // 如果游戏崩了，就别管了

                            proc.Refresh(); // 刷新进程信息

                            // ⭐ 核心判定：窗口句柄不为 0 说明窗口创建了
                            // ⭐ 发现游戏窗口了，瞬间拉满 100%
                       
                            if (proc.MainWindowHandle != IntPtr.Zero)
                            {
                                await ReportLaunchProgress(sender, 100, "游戏已启动！", done: true);
                                // 为了防止“只弹了个黑屏窗口”，咱们再多等 3 秒，让 Minecraft 把画面画出来
                                await Task.Delay(3000);

                                if (!proc.HasExited)
                                {
                                    await Dispatcher.InvokeAsync(() =>
                                    {
                                        // 1. 隐藏主窗口
                                        this.ShowInTaskbar = false;
                                        this.Visibility = System.Windows.Visibility.Hidden;

                                        // 2. 如果已经有岛了，先干掉，防止重叠
                                        if (_currentCapsule != null)
                                        {
                                            try { _currentCapsule.Close(); } catch { }
                                        }

                                        // 3. 弹出全新灵动岛
                                        _currentCapsule = new CapsuleWindow(_currentLaunchPlayerName, versionId, "");
                                        _currentCapsule.Show();
                                    });
                                }
                                break; // 隐藏成功后，退出检测循环
                            }
                        }
                    });

                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Launch Process.Start Fail] {ex}");
                    var failJson = JsonSerializer.Serialize(new
                    {
                        versionId = versionId,
                        exitCode = -1,
                        log = $" 无法启动 Java 进程：\n\n{ex}"
                    });
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onGameCrashed({failJson})"); });
                    await ReportLaunchProgress(sender, 0, $" 启动失败：{ex.Message}");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Launch Fail] {ex}");
                await ReportLaunchProgress(sender, 0, $" 启动失败：{ex.Message}");
            }
        }

        public void ForceCloseGameFromCapsule()
        {
            try
            {
                if (_lastProcess != null && !_lastProcess.HasExited)
                {
                    // ⭐ 先记录 PID，防止 Kill 之后进程对象更新导致找不到
                    int pid = _lastProcess.Id;

                    // 1. 直接强杀 Java 主进程
                    _lastProcess.Kill();

                    // 2. 瞬间调用 Windows 底层命令，强制干掉可能残留的子进程（防止卡顿）
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "taskkill",
                        Arguments = $"/F /T /PID {pid}",
                        CreateNoWindow = true,
                        UseShellExecute = false
                    });

                    Debug.WriteLine($"[Capsule] ⭐ 已瞬间强杀游戏进程树 (PID: {pid})");
                }
            }
            catch { }
        }

        private void EnsureGlobalChineseOptions(string versionId)
        {
            try
            {
                var mcDir = GetMcDir();
                // ⭐ 核心修复：加入 maxFps:260（解除锁60帧） 和 enableVsync:false（关闭垂直同步）
                var content = "lang:zh_cn\nnarrator:0\nmaxFps:260\nenableVsync:false\n";

                // ⭐ 1. 全局目录：如果不存在，才写入默认配置
                var globalOptionsPath = Path.Combine(mcDir, "options.txt");
                if (!File.Exists(globalOptionsPath))
                {
                    File.WriteAllText(globalOptionsPath, content);
                    Debug.WriteLine($"[Options] 已创建全局默认配置（解锁帧率）: {globalOptionsPath}");
                }
                else
                {
                    // ⭐ 如果文件已存在，检查一下是不是被锁了 60 帧，如果是，强行改掉
                    var lines = File.ReadAllLines(globalOptionsPath).ToList();
                    bool changed = false;
                    for (int i = 0; i < lines.Count; i++)
                    {
                        if (lines[i].StartsWith("maxFps:"))
                        {
                            lines[i] = "maxFps:260";
                            changed = true;
                        }
                        if (lines[i].StartsWith("enableVsync:"))
                        {
                            lines[i] = "enableVsync:false";
                            changed = true;
                        }
                    }
                    if (changed) File.WriteAllLines(globalOptionsPath, lines);
                }

                // ⭐ 2. 版本目录
                var versionOptionsPath = Path.Combine(mcDir, "versions", versionId, "options.txt");
                if (!File.Exists(versionOptionsPath))
                {
                    File.WriteAllText(versionOptionsPath, content);
                    Debug.WriteLine($"[Options] 已创建版本默认配置（解锁帧率）: {versionOptionsPath}");
                }
                else
                {
                    // 同样检查版本目录
                    var lines = File.ReadAllLines(versionOptionsPath).ToList();
                    bool changed = false;
                    for (int i = 0; i < lines.Count; i++)
                    {
                        if (lines[i].StartsWith("maxFps:"))
                        {
                            lines[i] = "maxFps:260";
                            changed = true;
                        }
                        if (lines[i].StartsWith("enableVsync:"))
                        {
                            lines[i] = "enableVsync:false";
                            changed = true;
                        }
                    }
                    if (changed) File.WriteAllLines(versionOptionsPath, lines);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Options] 失败：{ex.Message}");
            }
        }

        // ⭐ 供灵动岛窗口调用，清理引用
        public void ClearCapsule()
        {
            _currentCapsule = null;
        }

        // ⭐ 供灵动岛调用：打开当前版本的截图目录
        public void OpenCurrentScreenshotsFolder()
        {
            try
            {
                var mcDir = GetMcDir();
                // 拼接当前版本的截图路径
                string screenshotDir = Path.Combine(mcDir, "versions", _currentLaunchVersionId, "screenshots");

                // 如果文件夹不存在（比如刚玩还没截过图），自动创建一下
                if (!Directory.Exists(screenshotDir))
                {
                    Directory.CreateDirectory(screenshotDir);
                }

                // 打开文件夹
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = screenshotDir,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[OpenScreenshots] 失败：{ex.Message}");
            }
        }

        private string SubstituteVars(string template, string username, string versionId,
            string mcDir, string assetsDir, string classpath, string versionDir,
            string assetIndexId, string uuid)
        {
            if (string.IsNullOrEmpty(template)) return template;
            return template
                .Replace("${auth_player_name}", username)
                .Replace("${user_properties}", "{}")
                .Replace("${version_name}", versionId)
                .Replace("${game_directory}", versionDir)
                .Replace("${assets_root}", assetsDir)
                .Replace("${assets_index_name}", assetIndexId)
                .Replace("${auth_uuid}", uuid)
                // ⭐ 正版令牌：以前这里写死 "null"，导致正版账户联机时被服务器当成未登录。
                //    现在用启动流程里已经取到的真实 token；离线/取不到时仍回落 "null"（离线服不受影响）。
                //    空串也当 null，避免 --accessToken 后面接空参数把 JVM 参数打乱。
                .Replace("${auth_access_token}", string.IsNullOrEmpty(_currentAccessToken) ? "null" : _currentAccessToken)
                .Replace("${auth_session}", "null")
                // ⭐ 正版（有真实令牌）→ msa（微软账户标准值）；离线/无令牌 → legacy。
                //    单机不看这个参数，只影响 Realms / 严格校验的服务器，改对更稳。
                .Replace("${user_type}", (string.IsNullOrEmpty(_currentAccessToken) || _currentAccessToken == "null") ? "legacy" : "msa")
                .Replace("${version_type}", "release")
                .Replace("${clientid}", "")
                .Replace("${auth_xuid}", "")
                .Replace("${launcher_name}", "illusionLauncher")
                .Replace("${launcher_version}", "1.0.0")
                .Replace("${classpath}", classpath)
                .Replace("${natives_directory}", Path.Combine(versionDir, "natives"))
                .Replace("${library_directory}", Path.Combine(mcDir, "libraries"))
                .Replace("${version_name}", versionId)
                .Replace("${classpath_separator}", ";")
                .Replace("${primary_jar}", Path.Combine(versionDir, versionId + ".jar"))
                .Replace("${resolution_width}", "854")
                .Replace("${resolution_height}", "480")
                .Replace("${quickPlayPath}", "")
                .Replace("${quickPlaySingleplayer}", "")
                .Replace("${quickPlayMultiplayer}", "")
                .Replace("${quickPlayRealms}", "");
        }

        private List<string> SplitArgs(string line)
        {
            var result = new List<string>();
            if (string.IsNullOrWhiteSpace(line)) return result;
            var current = new StringBuilder();
            bool inQuotes = false;
            foreach (char c in line)
            {
                if (c == '"') { inQuotes = !inQuotes; continue; }
                if (c == ' ' && !inQuotes)
                {
                    if (current.Length > 0) { result.Add(current.ToString()); current.Clear(); }
                    continue;
                }
                current.Append(c);
            }
            if (current.Length > 0) result.Add(current.ToString());
            return result;
        }

        private void SetHighPerformanceGpu(string exePath)
        {
            try
            {
                using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
                    @"Software\Microsoft\DirectX\UserGpuPreferences");
                key?.SetValue(exePath, "GpuPreference=2;");
            }
            catch { }
        }

        private string OfflineUuid(string name)
        {
            using var md5 = MD5.Create();
            var bytes = Encoding.UTF8.GetBytes("OfflinePlayer:" + name);
            var hash = md5.ComputeHash(bytes);
            hash[6] = (byte)((hash[6] & 0x0F) | 0x30);
            hash[8] = (byte)((hash[8] & 0x3F) | 0x80);
            return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        }

        // =========================================================
        // Java 检测 / 下载
        // =========================================================

        private async Task<string> EnsureJavaAvailableAsync(JsonElement root, CoreWebView2 sender)
        {
            int requiredJava = GetRequiredJavaVersion(root);
            Debug.WriteLine($"[Java] 版本需要 Java {requiredJava}");

            // ⭐ 只有全局指定了具体 Java 时，才优先用版本专属 Java
            //    全局"自动适配"时跳过，走自动选逻辑
            if (!string.IsNullOrEmpty(_global.JavaPath)
                && !string.IsNullOrEmpty(_currentVersionCfg?.JavaPath) &&
                File.Exists(_currentVersionCfg.JavaPath))
            {
                int v = GetJavaVersion(_currentVersionCfg.JavaPath);
                if (v > 0 && IsJavaCompatible(v, requiredJava))
                {
                    Debug.WriteLine($"[Java] 版本专属 Java：{_currentVersionCfg.JavaPath} (Java {v})");
                    await ReportLaunchProgress(sender, 15, $"使用版本专属 Java {v}");
                    return _currentVersionCfg.JavaPath;
                }
                else
                {
                    Debug.WriteLine($"[Java] 版本专属 Java 不兼容（当前 {v}，需 {requiredJava}），继续查找");
                }
            }

            string javaRoot = GetJavaDir();
            string expectedJavaDir = Path.Combine(javaRoot, $"jre-{requiredJava}");
            string expectedJavaExe = Path.Combine(expectedJavaDir, "bin", "java.exe");

            if (!File.Exists(expectedJavaExe) && Directory.Exists(expectedJavaDir))
            {
                var subDirs = Directory.GetDirectories(expectedJavaDir);
                foreach (var sub in subDirs)
                {
                    var candidate = Path.Combine(sub, "bin", "java.exe");
                    if (File.Exists(candidate)) { expectedJavaExe = candidate; break; }
                }
            }

            // ⭐ 核心大招：针对 1.20.1 的 Forge，直接强制下载微软版 Java 21.0.7
            // (注意：这里的 versionId 可能需要从上下文传进来，或者用全局变量)
            if (requiredJava == 21)
            {
                string msJavaDir = Path.Combine(GetJavaDir(), "jre-21.0.7");
                string msJavaExe = Path.Combine(msJavaDir, "bin", "java.exe");

                if (File.Exists(msJavaExe))
                {
                    Debug.WriteLine($"[Java] ⭐ 发现微软版 Java 21.0.7，直接复用：{msJavaExe}");
                    return msJavaExe;
                }

                Debug.WriteLine($"[Java] 正在下载微软版 Java 21.0.7...");
                string downloadUrl = "https://aka.ms/download-jdk/microsoft-jdk-21.0.7-windows-x64.zip";
                string zipPath = Path.Combine(GetJavaDir(), "ms-java-21.zip");

                try
                {
                    // 借用你现成的下载器
                    await DownloadFileAsync(downloadUrl, zipPath, null);

                    // 解压
                    if (Directory.Exists(msJavaDir)) Directory.Delete(msJavaDir, true);
                    Directory.CreateDirectory(msJavaDir);
                    System.IO.Compression.ZipFile.ExtractToDirectory(zipPath, msJavaDir);

                    // 微软的包解压出来通常带一层子文件夹，得找一下
                    var possibleExe = Directory.GetFiles(msJavaDir, "java.exe", SearchOption.AllDirectories).FirstOrDefault();
                    if (possibleExe != null)
                    {
                        // 把它挪到根目录的 bin 下，或者直接用这个路径
                        msJavaExe = possibleExe;
                        Debug.WriteLine($"[Java] ⭐ 微软版 Java 21.0.7 下载解压成功：{msJavaExe}");
                        return msJavaExe;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Java] ⚠️ 微软版下载失败，回退到普通下载：{ex.Message}");
                }
            }

            if (File.Exists(expectedJavaExe))
            {
                int realVer = GetJavaVersion(expectedJavaExe);
                if (IsJavaCompatible(realVer, requiredJava))
                {
                    Debug.WriteLine($"[Java] 本地已有：{expectedJavaExe} (Java {realVer})");
                    await ReportLaunchProgress(sender, 15, $"使用本地 Java {realVer}");
                    _global.JavaPath = expectedJavaExe;
                    SaveGlobalConfig();
                    return expectedJavaExe;
                }
            }

            if (!string.IsNullOrEmpty(_global.JavaPath) && File.Exists(_global.JavaPath)
                && Path.GetFileName(_global.JavaPath).Equals("java.exe", StringComparison.OrdinalIgnoreCase))
            {
                int ver = GetJavaVersion(_global.JavaPath);
                if (ver > 0 && IsJavaCompatible(ver, requiredJava))
                {
                    Debug.WriteLine($"[Java] 用户指定：{_global.JavaPath} (Java {ver})");
                    return _global.JavaPath;
                }
            }

            string existing = FindJavaForVersion(root);
            if (existing != null)
            {
                Debug.WriteLine($"[Java] 本地找到：{existing}");
                return existing;
            }

            await ReportLaunchProgress(sender, 20, $"未检测到 Java {requiredJava}，正在自动下载...");
            string downloadedPath = await DownloadAndExtractJavaAsync(requiredJava, sender);
            if (downloadedPath == null)
            {
                await ReportLaunchProgress(sender, 0, $" Java {requiredJava} 下载失败");
                return null;
            }
            int realVer2 = GetJavaVersion(downloadedPath);
            if (realVer2 <= 0)
            {
                await ReportLaunchProgress(sender, 0, $" 下载的 Java 无法运行");
                return null;
            }
            Debug.WriteLine($"[Java] 自动下载完成：{downloadedPath} (Java {realVer2})");
            _global.JavaPath = downloadedPath;
            SaveGlobalConfig();
            return downloadedPath;
        }

        private async Task<string> DownloadAndExtractJavaAsync(int majorVersion, CoreWebView2 sender)
        {
            string javaRoot = GetJavaDir();
            Directory.CreateDirectory(javaRoot);
            string javaDir = Path.Combine(javaRoot, $"jre-{majorVersion}");
            string javaExe = Path.Combine(javaDir, "bin", "java.exe");
            if (File.Exists(javaExe))
            {
                await ReportLaunchProgress(sender, 15, $"已存在 Java {majorVersion}");
                return javaExe;
            }

            try
            {
                var drive = new DriveInfo(Path.GetPathRoot(javaRoot));
                if (drive.AvailableFreeSpace < 500L * 1024 * 1024)
                {
                    await ReportLaunchProgress(sender, 0, $" 磁盘空间不足（需 500MB）");
                    return null;
                }
            }
            catch { }

            string zipPath = Path.Combine(javaRoot, $"jre-{majorVersion}.zip");

            string imageType = (majorVersion == 8) ? "jdk" : "jre";
            var candidates = new List<string>();

            // ⭐ 针对 Java 25 加入了 Injdk 和 清华源，下载速度秒杀官方
            if (majorVersion == 25)
            {
                // 方案 1：Injdk 镜像 (目前国内极速)
                candidates.Add("https://mirror.injdk.cn/adoptium/25/jdk/x64/windows/OpenJDK25U-jdk_x64_windows_hotspot_25.0.2_10.zip");
                candidates.Add("https://mirror.injdk.cn/adoptium/25/jdk/x64/windows/OpenJDK25U-jdk_x64_windows_hotspot_25.0.1_8.zip");

                // 方案 2：清华 TUNA 镜像 (极稳，但有时同步有延迟)
                candidates.Add("https://mirrors.tuna.tsinghua.edu.cn/Adoptium/25/jdk/x64/windows/OpenJDK25U-jdk_x64_windows_hotspot_25.0.2_10.zip");
                candidates.Add("https://mirrors.tuna.tsinghua.edu.cn/Adoptium/25/jdk/x64/windows/OpenJDK25U-jdk_x64_windows_hotspot_25.0.1_8.zip");
            }
            else if (majorVersion == 21)
                candidates.Add("https://mirrors.huaweicloud.com/openjdk/21.0.2/openjdk-21.0.2_windows-x64_bin.zip");
            else if (majorVersion == 17)
                candidates.Add("https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip");
            else if (majorVersion == 22)
                candidates.Add("https://mirrors.huaweicloud.com/openjdk/22.0.1/openjdk-22.0.1_windows-x64_bin.zip");
            else if (majorVersion == 23)
                candidates.Add("https://mirrors.huaweicloud.com/openjdk/23.0.1/openjdk-23.0.1_windows-x64_bin.zip");

            // 兜底：Adoptium
            candidates.Add($"https://api.adoptium.net/v3/binary/latest/{majorVersion}/ga/windows/x64/{imageType}/hotspot/normal/eclipse");
            if (imageType == "jre")
                candidates.Add($"https://api.adoptium.net/v3/binary/latest/{majorVersion}/ga/windows/x64/jdk/hotspot/normal/eclipse");

            await ReportLaunchProgress(sender, 12, $"正在探测 Java {majorVersion} 下载源...");
            string bestUrl = await PickFastestSourceAsync(candidates);
            if (bestUrl == null) bestUrl = candidates[0];

            bool downloadOk = false;
            try { File.Delete(zipPath); } catch { }
            try { File.Delete(zipPath + ".aria2"); } catch { }
            for (int attempt = 0; attempt < 3 && !downloadOk; attempt++)
            {
                try
                {
                    await ReportLaunchProgress(sender, 15 + attempt * 2, $"下载 Java {majorVersion}（第 {attempt + 1}/3 次）...");
                    await DownloadWithAria2Async(bestUrl, zipPath, null, sender, 15, 80, $"Java {majorVersion}", forLaunch: true);
                    if (File.Exists(zipPath) && new FileInfo(zipPath).Length > 1024 * 1024)
                        downloadOk = true;
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Java] 下载失败 attempt={attempt}: {ex.Message}");
                    await Task.Delay(1500);
                    var alt = candidates.FirstOrDefault(c => c != bestUrl);
                    if (alt != null) bestUrl = alt;
                }
            }
            if (!downloadOk)
            {
                await ReportLaunchProgress(sender, 0, $" Java {majorVersion} 下载失败");
                return null;
            }

            await ReportLaunchProgress(sender, 82, "正在解压 Java...");
            try
            {
                if (Directory.Exists(javaDir)) Directory.Delete(javaDir, true);
                Directory.CreateDirectory(javaDir);

                await Task.Run(() =>
                {
                    using var archive = ZipFile.OpenRead(zipPath);
                    int total = archive.Entries.Count;
                    int done = 0;
                    int lastReportedPct = 82;
                    foreach (var entry in archive.Entries)
                    {
                        var destPath = Path.Combine(javaDir, entry.FullName);
                        if (string.IsNullOrEmpty(entry.Name))
                            Directory.CreateDirectory(destPath);
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                            entry.ExtractToFile(destPath, true);
                        }
                        done++;
                        int pct = 82 + (int)((double)done / total * 16);
                        if (pct > lastReportedPct)
                        {
                            lastReportedPct = pct;
                            _ = ReportLaunchProgress(sender, pct, $"解压 Java {done}/{total}");
                        }
                    }
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Java] 解压失败：{ex}");
                await ReportLaunchProgress(sender, 0, $" Java 解压失败：{ex.Message}");
                return null;
            }

            try { File.Delete(zipPath); } catch { }

            string realJavaExe = Path.Combine(javaDir, "bin", "java.exe");
            if (!File.Exists(realJavaExe))
            {
                var subDirs = Directory.GetDirectories(javaDir);
                foreach (var sub in subDirs)
                {
                    var candidate = Path.Combine(sub, "bin", "java.exe");
                    if (File.Exists(candidate)) { realJavaExe = candidate; break; }
                }
            }
            if (!File.Exists(realJavaExe))
            {
                await ReportLaunchProgress(sender, 0, $" 解压后找不到 java.exe");
                return null;
            }

            await ReportLaunchProgress(sender, 99, "正在验证 Java...");
            int ver = GetJavaVersion(realJavaExe);
            if (ver <= 0)
            {
                await ReportLaunchProgress(sender, 0, $" 下载的 Java 无法运行");
                return null;
            }

            await ReportLaunchProgress(sender, 100, $" Java {ver} 就绪", done: false);
            Debug.WriteLine($"[Java] 安装完成：{realJavaExe} (Java {ver})");
            return realJavaExe;
        }



        private int GetRequiredJavaVersion(JsonElement root)
        {
            string versionId = null;
            if (root.TryGetProperty("id", out var idEl))
                versionId = idEl.GetString();

            // ⭐ 核心截胡：1.20.1 优先级最高，直接强行返回 21，无视后面 JSON 里写的 17
            if (!string.IsNullOrEmpty(versionId) && versionId.Contains("1.20.1"))
            {
                return 21;
            }

            // 1. 最高优先级：读 JSON 里明确写的 Java 版本
            if (root.TryGetProperty("javaVersion", out var jv) &&
                jv.TryGetProperty("majorVersion", out var major))
                return major.GetInt32();

            // ⭐ 2. 递归继承链：如果当前 JSON 里没写，去父版本里挖
            if (root.TryGetProperty("inheritsFrom", out var inhEl))
            {
                var parentId = inhEl.GetString();
                if (!string.IsNullOrEmpty(parentId))
                {
                    var parentDir = Path.Combine(GetMcDir(), "versions", parentId);
                    var parentJsonPath = Path.Combine(parentDir, parentId + ".json");

                    if (File.Exists(parentJsonPath))
                    {
                        try
                        {
                            var parentRoot = JsonDocument.Parse(File.ReadAllText(parentJsonPath)).RootElement;
                            return GetRequiredJavaVersion(parentRoot);
                        }
                        catch { }
                    }
                }
            }

            // ⭐ 3. 特征雷达（如果继承链里都没写，靠主类和版本名推断）
            // 判断主类
            string mainClass = null;
            if (root.TryGetProperty("mainClass", out var mcEl))
                mainClass = mcEl.GetString();

            if (!string.IsNullOrEmpty(mainClass))
            {
                // NeoForge 专属主类
                if (mainClass.Contains("bootstraplauncher")) return 21;
                // 老版 Forge (1.7.10 - 1.12.2)
                if (mainClass.Contains("launchwrapper") && versionId != null)
                {
                    if (versionId.Contains("1.12") || versionId.Contains("1.11") || versionId.Contains("1.10") || versionId.Contains("1.8") || versionId.Contains("1.7")) return 8;
                }
            }

            // 如果主类认不出来，靠版本名特征认
            if (!string.IsNullOrEmpty(versionId))
            {
                var lowerId = versionId.ToLowerInvariant();

                // 提取 MC 版本号
                var match = Regex.Match(lowerId, @"(1\.\d+(?:\.\d+)?|26\.\d+(?:\.\d+)?)");
                if (match.Success)
                {
                    var mcVer = match.Groups[1].Value;

                    // ⭐ 强制 1.20.1 绑死 Java 21，同时兼容 NeoForge 和 1.21+ 高版本
                    if (lowerId.Contains("neoforge") ||
                        mcVer.StartsWith("1.20.1") ||
                        mcVer.StartsWith("1.21") ||
                        mcVer.StartsWith("1.20.5") ||
                        mcVer.StartsWith("1.20.6") ||
                        mcVer.StartsWith("26."))
                    {
                        return 21;
                    }

                    // 1.18 ~ 1.20.4，无脑 Java 17
                    if (mcVer.StartsWith("1.18") || mcVer.StartsWith("1.19") || mcVer.StartsWith("1.20"))
                        return 17;

                    // 1.17 需要 Java 16
                    if (mcVer.StartsWith("1.17")) return 16;

                    // 1.12 及以下老古董，Java 8
                    return 8;
                }
            }

            // 4. 实在啥也认不出来，默认 Java 8 垫底
            return 8;
        }

        private int GetJavaVersion(string javaExe, out string versionStr)
        {
            versionStr = "未知";
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = javaExe,
                    Arguments = "-version",
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var proc = Process.Start(psi);
                var errTask = proc.StandardError.ReadToEndAsync();
                var outTask = proc.StandardOutput.ReadToEndAsync();
                proc.WaitForExit(5000);
                string err = errTask.Result + outTask.Result;
                var match = Regex.Match(err, "version \"([^\"]+)\"");
                if (match.Success)
                {
                    versionStr = match.Groups[1].Value;
                    var m2 = Regex.Match(versionStr, @"^(\d+)");
                    if (m2.Success)
                    {
                        int ver = int.Parse(m2.Groups[1].Value);
                        if (ver == 1)
                        {
                            var m3 = Regex.Match(versionStr, @"^1\.(\d+)");
                            if (m3.Success) ver = int.Parse(m3.Groups[1].Value);
                        }
                        return ver;
                    }
                }
            }
            catch { }
            return 0;
        }

        private int GetJavaVersion(string javaExe) => GetJavaVersion(javaExe, out _);

        private string FindJavaForVersion(JsonElement root)
        {
            int targetJava = GetRequiredJavaVersion(root);

            if (!string.IsNullOrEmpty(_global.JavaPath) && File.Exists(_global.JavaPath)
                && Path.GetFileName(_global.JavaPath).Equals("java.exe", StringComparison.OrdinalIgnoreCase))
            {
                int ver = GetJavaVersion(_global.JavaPath);
                if (ver > 0 && IsJavaCompatible(ver, targetJava))
                    return _global.JavaPath;
            }

            var candidates = new List<(string path, int ver)>();

            var autoJavaDir = GetJavaDir();
            if (Directory.Exists(autoJavaDir))
                CollectJavaCandidates(autoJavaDir, candidates, 4);

            var javaHome = Environment.GetEnvironmentVariable("JAVA_HOME");
            if (!string.IsNullOrEmpty(javaHome) && Directory.Exists(javaHome))
                CollectJavaCandidates(javaHome, candidates, 2);

            var searchPaths = new List<string>
            {
                @"C:\Program Files\Java",
                @"C:\Program Files (x86)\Java",
                @"C:\Program Files\Eclipse Adoptium",
                @"C:\Program Files\Microsoft\jdk",
                @"C:\Program Files\BellSoft",
                @"C:\Program Files\Zulu",
                @"C:\Program Files\Amazon Corretto",
                @"C:\Program Files\Semeru",
                @"C:\Program Files\RedHat",
                @"D:\Java",
                @"D:\Program Files\Java",
                @"D:\Program Files\Eclipse Adoptium",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "scoop", "apps"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".jdks"),
                @"C:\ProgramData\chocolatey\lib",
            };
            foreach (var basePath in searchPaths)
            {
                if (!Directory.Exists(basePath)) continue;
                CollectJavaCandidates(basePath, candidates, 4);
            }

            try
            {
                foreach (var hive in new[] { Microsoft.Win32.Registry.LocalMachine, Microsoft.Win32.Registry.CurrentUser })
                {
                    foreach (var subKey in new[]
                    {
                        @"SOFTWARE\JavaSoft\JDK",
                        @"SOFTWARE\JavaSoft\JRE",
                        @"SOFTWARE\JavaSoft\Java Development Kit",
                        @"SOFTWARE\JavaSoft\Java Runtime Environment",
                        @"SOFTWARE\Eclipse Adoptium\JDK",
                        @"SOFTWARE\Microsoft\JDK",
                    })
                    {
                        using var key = hive.OpenSubKey(subKey);
                        if (key == null) continue;
                        foreach (var verName in key.GetSubKeyNames())
                        {
                            using var verKey = key.OpenSubKey(verName);
                            var home = verKey?.GetValue("JavaHome") as string;
                            if (!string.IsNullOrEmpty(home) && Directory.Exists(home))
                            {
                                var j = Path.Combine(home, "bin", "java.exe");
                                if (File.Exists(j)) AddJavaCandidate(j, candidates);
                            }
                        }
                    }
                }
            }
            catch { }

            var distinct = candidates
                .GroupBy(c => c.path, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.First())
                .Where(c => c.ver > 0 && IsJavaCompatible(c.ver, targetJava))
                .OrderBy(c => Math.Abs(c.ver - targetJava))
                .ToList();

            if (distinct.Count > 0)
            {
                var best = distinct[0].path;
                _global.JavaPath = best;
                SaveGlobalConfig();
                Debug.WriteLine($"[Java] 选中 {best} (Java {distinct[0].ver})");
                return best;
            }

            Debug.WriteLine($"[Java] 未找到 Java {targetJava} 的可用版本");
            return null;
        }

        // 调试：每次判断都打日志
        private bool IsJavaCompatible(int ver, int target)
        {
            Debug.WriteLine($"[JavaCheck] ver={ver}, target={target}");
            if (target == 8) return ver == 8;

            if (target == 16) return ver == 16;   // 1.17

            if (target == 17) return ver == 17;   // 1.18 ~ 1.20.1：只准 Java 17

            if (target == 21) return ver >= 21 && ver <= 24;  // 1.20.5 ~ 1.21.x：21~24

            if (target == 25) return ver >= 25 && ver <= 27;  // 26.x

            return ver >= target;
        }

        private void CollectJavaCandidates(string basePath, List<(string path, int ver)> list, int depth)
        {
            if (depth < 0) return;
            try
            {
                var direct = Path.Combine(basePath, "bin", "java.exe");
                if (File.Exists(direct)) AddJavaCandidate(direct, list);

                foreach (var sub in Directory.GetDirectories(basePath))
                    CollectJavaCandidates(sub, list, depth - 1);
            }
            catch { }
        }

        private void AddJavaCandidate(string javaExe, List<(string path, int ver)> list)
        {
            if (list.Any(c => c.path.Equals(javaExe, StringComparison.OrdinalIgnoreCase))) return;
            int ver = GetJavaVersionFast(javaExe);
            if (ver > 0) list.Add((javaExe, ver));
        }

        private int GetJavaVersionFast(string javaExe)
        {
            try
            {
                var home = Path.GetDirectoryName(Path.GetDirectoryName(javaExe));
                if (home != null)
                {
                    var releaseFile = Path.Combine(home, "release");
                    if (File.Exists(releaseFile))
                    {
                        foreach (var line in File.ReadLines(releaseFile))
                        {
                            if (line.StartsWith("JAVA_VERSION="))
                            {
                                var v = line.Substring("JAVA_VERSION=".Length).Trim('"');
                                var m = Regex.Match(v, @"^(\d+)");
                                if (m.Success)
                                {
                                    int ver = int.Parse(m.Groups[1].Value);
                                    if (ver == 1)
                                    {
                                        var m2 = Regex.Match(v, @"^1\.(\d+)");
                                        if (m2.Success) ver = int.Parse(m2.Groups[1].Value);
                                    }
                                    return ver;
                                }
                            }
                        }
                    }
                }
            }
            catch { }
            return GetJavaVersion(javaExe);
        }

        // =========================================================
        // 其他辅助
        // =========================================================

        private Task PickBackgroundAsync(CoreWebView2 sender)
        {
            try
            {
                var dlg = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "选择背景图",
                    Filter = "图片|*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.gif|所有文件|*.*"
                };
                if (dlg.ShowDialog() != true)
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onBackgroundPicked(null)"); });
                    return Task.CompletedTask;
                }

                var bgDir = Path.Combine(GetConfigDir(), "bg");
                Directory.CreateDirectory(bgDir);
                var ext = Path.GetExtension(dlg.FileName).ToLowerInvariant();
                var destFileName = "custom_bg_" + DateTime.Now.Ticks + ext;
                var destPath = Path.Combine(bgDir, destFileName);

                foreach (var old in Directory.GetFiles(bgDir, "custom_bg*"))
                {
                    try { File.Delete(old); } catch { }
                }
                File.Copy(dlg.FileName, destPath, true);

                _global.BackgroundPath = destFileName;
                SaveGlobalConfig();

                var url = $"https://bg.local/{destFileName}";
                var json = JsonSerializer.Serialize(new { url = url, path = dlg.FileName });
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onBackgroundPicked({json})"); });
            }
            catch
            {
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onBackgroundPicked(null)"); });
            }
            return Task.CompletedTask;
        }

        private Task PickGamePathAsync(CoreWebView2 sender)
        {
            try
            {
                using var dlg = new System.Windows.Forms.FolderBrowserDialog
                {
                    Description = "选择游戏目录"
                };
                if (dlg.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onGamePathPicked(null)"); });
                    return Task.CompletedTask;
                }

                _global.GamePath = dlg.SelectedPath;
                SaveGlobalConfig();
                try { Directory.CreateDirectory(_global.GamePath); } catch { }
                var json = JsonSerializer.Serialize(new { path = dlg.SelectedPath });
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onGamePathPicked({json})"); });
            }
            catch
            {
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onGamePathPicked(null)"); });
            }
            return Task.CompletedTask;
        }

        private Task PickJavaFileAsync(CoreWebView2 sender)
        {
            try
            {
                var dlg = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "选择 java.exe",
                    Filter = "java.exe|java.exe|所有 exe|*.exe"
                };
                if (dlg.ShowDialog() != true)
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked(null)"); });
                    return Task.CompletedTask;
                }

                if (!Path.GetFileName(dlg.FileName).Equals("java.exe", StringComparison.OrdinalIgnoreCase))
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked(null)"); });
                    return Task.CompletedTask;
                }

                string versionStr = "未知";
                bool valid = false;
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = dlg.FileName,
                        Arguments = "-version",
                        RedirectStandardError = true,
                        RedirectStandardOutput = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    };
                    using var proc = Process.Start(psi);
                    var errTask = proc.StandardError.ReadToEndAsync();
                    var outTask = proc.StandardOutput.ReadToEndAsync();
                    proc.WaitForExit(5000);
                    var err = errTask.Result + outTask.Result;
                    var match = Regex.Match(err, "version \"([^\"]+)\"");
                    if (match.Success) { versionStr = match.Groups[1].Value; valid = true; }
                }
                catch { }

                if (!valid)
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked(null)"); });
                    return Task.CompletedTask;
                }

                _global.JavaPath = dlg.FileName;
                SaveGlobalConfig();
                var json = JsonSerializer.Serialize(new { path = dlg.FileName, version = versionStr, valid });
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onJavaPicked({json})"); });
            }
            catch
            {
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked(null)"); });
            }
            return Task.CompletedTask;
        }

        private Task PickJavaFolderAsync(CoreWebView2 sender)
        {
            try
            {
                using var dlg = new System.Windows.Forms.FolderBrowserDialog
                {
                    Description = "选择 Java 目录"
                };
                if (dlg.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked(null)"); });
                    return Task.CompletedTask;
                }

                string javaExe = Path.Combine(dlg.SelectedPath, "bin", "java.exe");
                if (!File.Exists(javaExe))
                {
                    javaExe = FindJavaExeInDir(dlg.SelectedPath, 3);
                }

                if (javaExe == null || !File.Exists(javaExe))
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked({error:'所选目录里找不到 bin/java.exe'})"); });
                    return Task.CompletedTask;
                }

                string versionStr = "未知";
                bool valid = false;
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = javaExe,
                        Arguments = "-version",
                        RedirectStandardError = true,
                        RedirectStandardOutput = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    };
                    using var proc = Process.Start(psi);
                    var errTask = proc.StandardError.ReadToEndAsync();
                    var outTask = proc.StandardOutput.ReadToEndAsync();
                    proc.WaitForExit(5000);
                    var err = errTask.Result + outTask.Result;
                    var match = Regex.Match(err, "version \"([^\"]+)\"");
                    if (match.Success) { versionStr = match.Groups[1].Value; valid = true; }
                }
                catch { }

                if (!valid)
                {
                    _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked({error:'java.exe 无法运行'})"); });
                    return Task.CompletedTask;
                }

                _global.JavaPath = javaExe;
                SaveGlobalConfig();
                var json = JsonSerializer.Serialize(new { path = javaExe, version = versionStr, valid });
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onJavaPicked({json})"); });
            }
            catch
            {
                _ = RunOnUI(() => { _ = sender.ExecuteScriptAsync("onJavaPicked(null)"); });
            }
            return Task.CompletedTask;
        }

        private string FindJavaExeInDir(string baseDir, int depth)
        {
            if (depth < 0) return null;
            try
            {
                var direct = Path.Combine(baseDir, "bin", "java.exe");
                if (File.Exists(direct)) return direct;

                foreach (var sub in Directory.GetDirectories(baseDir))
                {
                    var found = FindJavaExeInDir(sub, depth - 1);
                    if (found != null) return found;
                }
            }
            catch { }
            return null;
        }

        private async Task ScanInstalledVersionsAsync(CoreWebView2 sender)
        {
            int myVersion = Interlocked.Increment(ref _scanVersion);
            var versionsDir = Path.Combine(GetMcDir(), "versions");
            var all = new List<string>();
            var referencedBy = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (Directory.Exists(versionsDir))
            {
                // ⭐ 第一遍：收集所有 inheritsFrom 的值
                foreach (var dir in Directory.GetDirectories(versionsDir))
                {
                    var name = Path.GetFileName(dir);
                    var jsonPath = Path.Combine(dir, name + ".json");
                    if (!File.Exists(jsonPath)) continue;
                    try
                    {
                        var root = JsonDocument.Parse(File.ReadAllText(jsonPath)).RootElement;
                        if (root.TryGetProperty("inheritsFrom", out var inh))
                        {
                            var parent = inh.GetString();
                            if (!string.IsNullOrEmpty(parent)) referencedBy.Add(parent);
                        }
                    }
                    catch { }
                }
                if (Volatile.Read(ref _scanVersion) != myVersion) return;

                // ⭐ 第二遍：收集合法版本
                foreach (var dir in Directory.GetDirectories(versionsDir))
                {
                    var name = Path.GetFileName(dir);
                    var jsonPath = Path.Combine(dir, name + ".json");
                    if (!File.Exists(jsonPath)) continue;
                    try
                    {
                        var root = JsonDocument.Parse(File.ReadAllText(jsonPath)).RootElement;
                        bool valid = false;

                        bool hasOwnJar = File.Exists(Path.Combine(dir, name + ".jar"));
                        if (hasOwnJar)
                        {
                            valid = true;
                        }
                        else if (root.TryGetProperty("inheritsFrom", out var inheritsFrom))
                        {
                            var parent = inheritsFrom.GetString();
                            if (!string.IsNullOrEmpty(parent))
                            {
                                var parentJar = Path.Combine(versionsDir, parent, parent + ".jar");
                                valid = File.Exists(parentJar);
                            }
                        }

                        // ⭐ 核心修复：只要文件夹里有同名 JSON 文件，就认为是合法版本，不管名字叫啥
                        bool hasJson = File.Exists(Path.Combine(dir, name + ".json"));
                        bool looksValid = true;

                        if (valid || hasJson)
                        {
                            if (looksValid) all.Add(name);
                        }
                    }
                    catch { }
                }
            }
            if (Volatile.Read(ref _scanVersion) != myVersion) return;

            // ⭐ 终极放行：只要扫出来的，全部保留！
            var list = all;

            list.Sort((a, b) =>
            {
                var pa = ParseVersion(a);
                var pb = ParseVersion(b);
                for (int i = 0; i < Math.Min(pa.Length, pb.Length); i++)
                    if (pa[i] != pb[i]) return pb[i].CompareTo(pa[i]);
                return pb.Length.CompareTo(pa.Length);
            });
            if (Volatile.Read(ref _scanVersion) != myVersion) return;

            // ⭐ 读每个版本需要的 Java 版本
            var javaMap = new Dictionary<string, int>();
            foreach (var v in list)
            {
                try
                {
                    var vDir = Path.Combine(versionsDir, v);
                    var vJson = Path.Combine(vDir, v + ".json");
                    if (!File.Exists(vJson)) continue;

                    var vRoot = JsonDocument.Parse(File.ReadAllText(vJson)).RootElement;

                    // 1. 默认用自身 JSON 里的 Java 版本
                    int reqJava = GetRequiredJavaVersion(vRoot);

                    // 2. ⭐ 如果有 inheritsFrom，去读父版本的 Java 版本
                    if (vRoot.TryGetProperty("inheritsFrom", out var inh))
                    {
                        var parentId = inh.GetString();
                        if (!string.IsNullOrEmpty(parentId))
                        {
                            var parentJsonPath = Path.Combine(versionsDir, parentId, parentId + ".json");
                            if (File.Exists(parentJsonPath))
                            {
                                var pRoot = JsonDocument.Parse(File.ReadAllText(parentJsonPath)).RootElement;
                                reqJava = GetRequiredJavaVersion(pRoot);
                            }
                        }
                    }

                    javaMap[v] = reqJava;
                }
                catch { }
            }

            var loaderMap = new Dictionary<string, string>();
            foreach (var v in list)
            {
                try { loaderMap[v] = DetectLoaderKind(v, versionsDir, 0); }
                catch { loaderMap[v] = "vanilla"; }
            }

            var payload = new { versions = list, javaMap = javaMap, loaderMap = loaderMap };
            var json = JsonSerializer.Serialize(payload);
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onInstalledVersions({json})"); });
        }

        /// <summary>
        /// 读版本 json（含 inheritsFrom 继承链）判断加载器类型，用于前端版本分区。
        /// 返回：vanilla / forge / fabric / neoforge
        /// </summary>
        private string DetectLoaderKind(string versionId, string versionsDir, int depth)
        {
            if (depth > 6) return "vanilla";
            try
            {
                var vdir = Path.Combine(versionsDir, versionId);
                if (File.Exists(Path.Combine(vdir, "modrinth.index.json"))
                    || File.Exists(Path.Combine(vdir, "manifest.json"))
                    || File.Exists(Path.Combine(vdir, "instance.cfg"))
                    || File.Exists(Path.Combine(vdir, "illusion.modpack.json")))
                    return "modpack";

                var jp = Path.Combine(versionsDir, versionId, versionId + ".json");
                if (!File.Exists(jp)) return "vanilla";
                using var doc = JsonDocument.Parse(File.ReadAllText(jp));
                var root = doc.RootElement;
                string found = null;

                if (root.TryGetProperty("libraries", out var libs) && libs.ValueKind == JsonValueKind.Array)
                {
                    foreach (var l in libs.EnumerateArray())
                    {
                        if (!l.TryGetProperty("name", out var nEl)) continue;
                        var n = nEl.GetString() ?? "";
                        if (n.StartsWith("net.neoforged")) return "neoforge";
                        if (n.StartsWith("net.minecraftforge")) { if (found == null) found = "forge"; }
                        else if (n.StartsWith("net.fabricmc") || n.StartsWith("net.legacyfabric") || n.StartsWith("org.quiltmc"))
                        { if (found == null) found = "fabric"; }
                    }
                }

                if (found != null) return found;

                if (root.TryGetProperty("mainClass", out var mcEl))
                {
                    var mc = (mcEl.GetString() ?? "").ToLowerInvariant();
                    if (mc.Contains("neoforge")) return "neoforge";
                    if (mc.Contains("fabric") || mc.Contains("quilt") || mc.Contains("knot")) return "fabric";
                    if (mc.Contains("forge")) return "forge";
                }

                if (root.TryGetProperty("inheritsFrom", out var inhEl))
                {
                    var parent = inhEl.GetString();
                    if (!string.IsNullOrEmpty(parent)) return DetectLoaderKind(parent, versionsDir, depth + 1);
                }
            }
            catch { }
            return "vanilla";
        }

        private int[] ParseVersion(string name)
        {
            var m = Regex.Match(name, @"(\d+)\.(\d+)(?:\.(\d+))?");
            if (!m.Success) return new[] { 0, 0, 0 };
            int major = int.Parse(m.Groups[1].Value);
            int minor = int.Parse(m.Groups[2].Value);
            int patch = m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : 0;
            return new[] { major, minor, patch };
        }

        private async Task DetectJavaAsync(CoreWebView2 sender)
        {
            var result = new List<object>();
            _detectedJava.Clear();
            var searchPaths = new List<string>
            {
                @"C:\Program Files\Java", @"C:\Program Files (x86)\Java",
                @"C:\Program Files\Eclipse Adoptium", @"C:\Program Files\Microsoft\jdk",
                @"C:\Program Files\BellSoft", @"C:\Program Files\Zulu",
                @"C:\Program Files\Amazon Corretto",
                @"D:\Java", @"D:\Program Files\Java",
                GetJavaDir(),
            };
            var found = new HashSet<string>();
            foreach (var basePath in searchPaths)
            {
                if (!Directory.Exists(basePath)) continue;
                await ScanJavaDirAsync(basePath, result, found, 3);
            }
            var json = JsonSerializer.Serialize(result, JsonOpts());
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onJavaDetected({json})"); });
        }

        private async Task ScanJavaDirAsync(string basePath, List<object> result, HashSet<string> found, int depth)
        {
            if (depth < 0) return;
            var direct = Path.Combine(basePath, "bin", "java.exe");
            if (File.Exists(direct) && !found.Contains(direct))
            {
                found.Add(direct);
                string versionStr = "未知";
                int ver = GetJavaVersion(direct, out versionStr);
                var vendor = GetJavaVendor(direct);
                var info = new JavaInfo
                {
                    Version = versionStr,
                    MajorVersion = ver,
                    Vendor = vendor,
                    Path = direct,
                    Valid = ver > 0
                };
                _detectedJava.Add(info);
                result.Add(info);
            }
            IEnumerable<string> subs;
            try { subs = Directory.GetDirectories(basePath); }
            catch { return; }
            foreach (var sub in subs)
                await ScanJavaDirAsync(sub, result, found, depth - 1);
        }

        private bool IsAllowedOnWindows(JsonElement rules)
        {
            bool allowed = false;
            foreach (var rule in rules.EnumerateArray())
            {
                var action = rule.GetProperty("action").GetString();
                bool matches = true;
                if (rule.TryGetProperty("os", out var os))
                {
                    var osName = os.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (osName != null && osName != "windows") matches = false;
                    if (matches && os.TryGetProperty("arch", out var arch))
                    {
                        var archName = arch.GetString();
                        if (archName != null && archName != "x86_64" && archName != "x64")
                            matches = false;
                    }
                }
                if (matches && rule.TryGetProperty("features", out var features))
                {
                    foreach (var f in features.EnumerateObject())
                    {
                        if (f.Value.GetBoolean()) { matches = false; break; }
                    }
                }
                if (matches) allowed = (action == "allow");
            }
            return allowed;
        }

        // ⭐ 下载会话取消令牌（同一时刻只有一个下载任务）
        private static CancellationTokenSource _dlSessionCts;
        private static CancellationToken _dlSessionToken = CancellationToken.None;

        private static void BeginDownloadSession()
        {
            try { _dlSessionCts?.Dispose(); } catch { }
            _dlSessionCts = new CancellationTokenSource();
            _dlSessionToken = _dlSessionCts.Token;
        }

        private static void EndDownloadSession()
        {
            _dlSessionToken = CancellationToken.None;
            try { _dlSessionCts?.Dispose(); } catch { }
            _dlSessionCts = null;
        }

        private static bool CancelDownloadSession()
        {
            var cts = _dlSessionCts;
            if (cts == null) return false;

            // ⭐ 版本下载走外部 aria2c.exe，取消令牌管不到它，直接掐进程
            try
            {
                foreach (var ap in System.Diagnostics.Process.GetProcessesByName("aria2c"))
                {
                    try { ap.Kill(true); } catch { }
                }
            }
            catch { }

            return true;
        }

        private async Task ReportProgress(CoreWebView2 sender, double percent, string message, bool done = false)
        {
            var json = JsonSerializer.Serialize(new
            {
                type = "progress",
                percent = Math.Round(percent, 2),
                message,
                done
            });
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onDownloadProgress({json})"); });
        }

        // =========================================================
        // 文件管理（Mod / 材质 / 光影）
        // =========================================================

        private string GetFileFolderPath(string versionId, string folderType)
        {
            var mcDir = GetMcDir();
            var sub = folderType switch
            {
                "mods" => "mods",
                "resourcepacks" => "resourcepacks",
                "shaderpacks" => "shaderpacks",
                _ => "mods"
            };
            return Path.Combine(mcDir, "versions", versionId, sub);
        }

        private string[] GetAllowedExtensions(string folderType)
        {
            return folderType switch
            {
                "mods" => new[] { ".jar" },
                "resourcepacks" => new[] { ".zip" },
                "shaderpacks" => new[] { ".zip" },
                _ => new[] { ".jar" }
            };
        }

        private async Task ListFilesAsync(string versionId, string folderType, CoreWebView2 sender)
        {
            var result = new List<object>();
            try
            {
                var dir = GetFileFolderPath(versionId, folderType);
                var allowedExts = GetAllowedExtensions(folderType);

                if (Directory.Exists(dir))
                {
                    foreach (var file in Directory.GetFiles(dir))
                    {
                        var fileName = Path.GetFileName(file);
                        bool disabled = fileName.EndsWith(".disabled");
                        var baseName = disabled
                            ? fileName.Substring(0, fileName.Length - ".disabled".Length)
                            : fileName;
                        var extReal = Path.GetExtension(baseName).ToLowerInvariant();

                        if (!allowedExts.Contains(extReal))
                            continue;

                        var fi = new FileInfo(file);

                        // ⭐ 读 jar 里的图标（仅 mods）
                        string iconDataUri = null;
                        if (folderType == "mods" && extReal == ".jar")
                        {
                            iconDataUri = TryExtractModIcon(file);
                        }

                        result.Add(new
                        {
                            fileName = fileName,
                            displayName = baseName,
                            size = fi.Length,
                            disabled = disabled,
                            modified = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm"),
                            icon = iconDataUri
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ListFiles] {ex.Message}");
            }

            var json = JsonSerializer.Serialize(new
            {
                versionId = versionId,
                folderType = folderType,
                files = result
            }, JsonOpts());

            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onFileList({json})"); });
        }

        // ⭐ 从 jar 里抽 icon.png，转 data URI；失败返回 null
        private string TryExtractModIcon(string jarPath)
        {
            try
            {
                using var zip = ZipFile.OpenRead(jarPath);
                // 优先找 assets/<任意>/icon.png，其次任意 icon.png
                ZipArchiveEntry iconEntry = null;

                foreach (var e in zip.Entries)
                {
                    var name = e.FullName.Replace('\\', '/').ToLowerInvariant();
                    if (name.StartsWith("assets/") && name.EndsWith("/icon.png"))
                    {
                        iconEntry = e;
                        break;
                    }
                }
                if (iconEntry == null)
                {
                    foreach (var e in zip.Entries)
                    {
                        if (e.FullName.EndsWith("/icon.png", StringComparison.OrdinalIgnoreCase) ||
                            e.FullName.Equals("icon.png", StringComparison.OrdinalIgnoreCase))
                        {
                            iconEntry = e;
                            break;
                        }
                    }
                }
                if (iconEntry == null) return null;

                // 限制大小，避免超大图撑爆 data URI
                if (iconEntry.Length > 2 * 1024 * 1024) return null;

                using var stream = iconEntry.Open();
                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                var bytes = ms.ToArray();
                return "data:image/png;base64," + Convert.ToBase64String(bytes);
            }
            catch
            {
                return null;
            }
        }

        private async Task ToggleFileAsync(string versionId, string folderType, string fileName, CoreWebView2 sender)
        {
            try
            {
                var dir = GetFileFolderPath(versionId, folderType);
                var src = Path.Combine(dir, fileName);
                if (!File.Exists(src)) return;

                string dst;
                string action;
                if (fileName.EndsWith(".disabled"))
                {
                    dst = src.Substring(0, src.Length - ".disabled".Length);
                    action = "启用";
                }
                else
                {
                    dst = src + ".disabled";
                    action = "禁用";
                }

                File.Move(src, dst);
                Debug.WriteLine($"[ToggleFile] {action} {fileName}");

                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onFileChanged()"); });

                var json = JsonSerializer.Serialize(new
                {
                    title = action + "成功",
                    message = Path.GetFileName(dst)
                }, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onFileToast({json})"); });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ToggleFile] {ex.Message}");
            }
        }

        private async Task DeleteFileAsync(string versionId, string folderType, string fileName, CoreWebView2 sender)
        {
            try
            {
                var dir = GetFileFolderPath(versionId, folderType);
                var path = Path.Combine(dir, fileName);
                if (File.Exists(path))
                {
                    File.Delete(path);
                    Debug.WriteLine($"[DeleteFile] 已删除 {fileName}");
                }

                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onFileChanged()"); });

                var json = JsonSerializer.Serialize(new
                {
                    title = "已删除",
                    message = fileName
                }, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onFileToast({json})"); });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[DeleteFile] {ex.Message}");
            }
        }

        private async Task ImportFilesAsync(string versionId, string folderType, List<string> paths, CoreWebView2 sender)
        {
            try
            {
                var dir = GetFileFolderPath(versionId, folderType);
                Directory.CreateDirectory(dir);
                var allowedExts = GetAllowedExtensions(folderType);

                int ok = 0;
                int skip = 0;
                foreach (var src in paths)
                {
                    if (!File.Exists(src)) continue;

                    var ext = Path.GetExtension(src).ToLowerInvariant();
                    if (!allowedExts.Contains(ext)) { skip++; continue; }

                    var fileName = Path.GetFileName(src);
                    var dst = Path.Combine(dir, fileName);
                    File.Copy(src, dst, true);
                    ok++;
                }

                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onFileChanged()"); });

                string msg = skip > 0
                    ? $"已导入 {ok} 个，跳过 {skip} 个（类型不符）"
                    : $"已导入 {ok} 个文件";

                var json = JsonSerializer.Serialize(new
                {
                    title = "安装完成",
                    message = msg
                }, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onFileToast({json})"); });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ImportFiles] {ex.Message}");
            }
        }

        private class ModpackInfo
        {
            public string Name { get; set; }
            public string McVersion { get; set; }
            public string Loader { get; set; }
            public int ModCount { get; set; }
        }

        private async Task ParseModpackAsync(string path, CoreWebView2 sender)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                {
                    await SendModpackDetected(sender, new { ok = false, error = "文件不存在" });
                    return;
                }

                // ⭐ 把拖入的临时文件复制到固定位置
                var modpackDir = Path.Combine(GetConfigDir(), "modpacks");
                Directory.CreateDirectory(modpackDir);
                var originalFileName = Path.GetFileName(path);
                var stablePath = Path.Combine(modpackDir, originalFileName);
                // 如果重名，加时间戳
                if (File.Exists(stablePath))
                {
                    var nameNoExt = Path.GetFileNameWithoutExtension(originalFileName);
                    var ext = Path.GetExtension(originalFileName);
                    stablePath = Path.Combine(modpackDir, $"{nameNoExt}_{DateTime.Now.Ticks}{ext}");
                }
                try
                {
                    File.Copy(path, stablePath, true);
                    path = stablePath;   // 后面全用稳定副本
                    DiagnosticLogger.Instance.Info($"[Modpack] 已复制到稳定位置：{stablePath}");
                }
                catch (Exception ex)
                {
                    DiagnosticLogger.Instance.Info($"[Modpack] 复制失败，继续用原路径：{ex.Message}");
                }

                var lower = path.ToLowerInvariant();
                var fileName = Path.GetFileName(path);
                ModpackInfo info = null;

                if (lower.EndsWith(".mrpack"))
                {
                    info = await ParseMrpackAsync(path);
                }
                else if (lower.EndsWith(".zip"))
                {
                    info = await ParseCfZipAsync(path);
                    if (info == null)
                    {
                        await SendModpackDetected(sender, new { ok = false, error = "这个 .zip 不是 CurseForge 整合包（找不到 manifest.json）" });
                        return;
                    }
                }
                else
                {
                    await SendModpackDetected(sender, new { ok = false, error = "只支持 .mrpack 或 .zip" });
                    return;
                }

                await SendModpackDetected(sender, new
                {
                    ok = true,
                    fileName,
                    path,
                    name = info.Name,
                    mcVersion = info.McVersion,
                    loader = string.IsNullOrEmpty(info.Loader) ? "原版" : info.Loader,
                    modCount = info.ModCount
                });
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Info($"[Modpack] 解析失败：{ex}");
                await SendModpackDetected(sender, new { ok = false, error = ex.Message });
            }
        }

        private async Task<ModpackInfo> ParseMrpackAsync(string path)
        {
            return await Task.Run(() =>
            {
                using var zip = ZipFile.OpenRead(path);
                var entry = zip.GetEntry("modrinth.index.json");
                if (entry == null)
                    throw new Exception("不是有效的 .mrpack（找不到 modrinth.index.json）");

                using var sr = new StreamReader(entry.Open());
                var json = sr.ReadToEnd();
                var doc = JsonDocument.Parse(json).RootElement;

                var info = new ModpackInfo();
                if (doc.TryGetProperty("name", out var n)) info.Name = n.GetString();
                if (string.IsNullOrEmpty(info.Name))
                    info.Name = Path.GetFileNameWithoutExtension(path);

                if (doc.TryGetProperty("dependencies", out var deps))
                {
                    foreach (var p in deps.EnumerateObject())
                    {
                        var key = p.Name;
                        var val = p.Value.GetString();
                        if (key == "minecraft") info.McVersion = val;
                        else if (key == "fabric-loader") info.Loader = $"fabric {val}";
                        else if (key == "forge") info.Loader = $"forge {val}";
                        else if (key == "neoforge") info.Loader = $"neoforge {val}";
                        else if (key == "quilt-loader") info.Loader = $"quilt {val}";
                    }
                }

                if (doc.TryGetProperty("files", out var files))
                    info.ModCount = files.GetArrayLength();

                return info;
            });
        }

        private async Task<ModpackInfo> ParseCfZipAsync(string path)
        {
            return await Task.Run(() =>
            {
                using var zip = ZipFile.OpenRead(path);
                ZipArchiveEntry entry = zip.GetEntry("manifest.json");
                if (entry == null)
                {
                    var topDirs = zip.Entries
                        .Where(e => e.FullName.EndsWith("/manifest.json", StringComparison.OrdinalIgnoreCase))
                        .Where(e => e.FullName.Count(c => c == '/') == 1)
                        .ToList();
                    if (topDirs.Count > 0) entry = topDirs[0];
                }
                if (entry == null) return null;

                using var sr = new StreamReader(entry.Open());
                var json = sr.ReadToEnd();
                var doc = JsonDocument.Parse(json).RootElement;

                var info = new ModpackInfo();
                if (doc.TryGetProperty("name", out var n)) info.Name = n.GetString();
                if (string.IsNullOrEmpty(info.Name))
                    info.Name = Path.GetFileNameWithoutExtension(path);

                if (doc.TryGetProperty("minecraft", out var mc))
                {
                    if (mc.TryGetProperty("version", out var v)) info.McVersion = v.GetString();
                    if (mc.TryGetProperty("modLoaders", out var loaders) && loaders.GetArrayLength() > 0)
                    {
                        JsonElement primary = default;
                        bool found = false;
                        foreach (var l in loaders.EnumerateArray())
                        {
                            if (l.TryGetProperty("primary", out var p) && p.GetBoolean())
                            {
                                primary = l;
                                found = true;
                                break;
                            }
                        }
                        if (!found) primary = loaders.EnumerateArray().First();
                        if (primary.TryGetProperty("id", out var idEl))
                            info.Loader = idEl.GetString();
                    }
                }

                if (doc.TryGetProperty("files", out var files))
                    info.ModCount = files.GetArrayLength();

                return info;
            });
        }

        private async Task SendModpackDetected(CoreWebView2 sender, object payload)
        {
            var json = JsonSerializer.Serialize(payload, JsonOpts());
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModpackDetected({json})"); });
        }

        private class ModpackFile
        {
            public string Path { get; set; }
            public string Url { get; set; }
            public string Sha1 { get; set; }
            public long Size { get; set; }
        }

        // ⭐ 扁平化：把父版本（原版 / loader）的 json 合并进来，断掉 inheritsFrom
        //   之后启动不再依赖 versions/<父版本>，版本列表也就看不到父版本了（类似 PCL）
        private void FlattenVersionJson(string versionId)
        {
            try
            {
                var dir = Path.Combine(GetMcDir(), "versions", versionId);
                var p = Path.Combine(dir, versionId + ".json");
                if (!File.Exists(p)) return;
        
                var root = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(p))?.AsObject();
                if (root == null) return;
                var inherits = root["inheritsFrom"]?.ToString();
                if (string.IsNullOrEmpty(inherits)) return;   // 已经是扁平的
        
                // 沿继承链收集父版本（可能多层）
                var chain = new List<System.Text.Json.Nodes.JsonObject>();
                var cur = inherits;
                var guard = 0;
                while (!string.IsNullOrEmpty(cur) && guard++ < 10)
                {
                    var pp = Path.Combine(GetMcDir(), "versions", cur, cur + ".json");
                    if (!File.Exists(pp)) break;
                    var pj = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(pp))?.AsObject();
                    if (pj == null) break;
                    chain.Add(pj);
                    cur = pj["inheritsFrom"]?.ToString();
                }
                if (chain.Count == 0) return;
        
                // ---- libraries：子优先，按 groupId:artifactId 去重，父版本补进来 ----
                var libs = root["libraries"] as System.Text.Json.Nodes.JsonArray;
                if (libs == null) { libs = new System.Text.Json.Nodes.JsonArray(); root["libraries"] = libs; }
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var l in libs)
                {
                    var n = l?["name"]?.ToString();
                    if (!string.IsNullOrEmpty(n))
                    {
                        var parts = n.Split(':');
                        seen.Add(n);
                    }
                }
                foreach (var parent in chain)
                {
                    if (parent["libraries"] is not System.Text.Json.Nodes.JsonArray pl) continue;
                    foreach (var l in pl)
                    {
                        var n = l?["name"]?.ToString();
                        var key = n ?? "";
                        if (key.Length > 0)
                        {
                            var parts = key.Split(':');
                            key = parts.Length >= 2 ? parts[0] + ":" + parts[1] : key;
                            if (!seen.Add(key)) continue;
                        }
                        libs.Add(l?.DeepClone());
                    }
                }
        
                // ---- arguments：父在前、子在后 ----
                var args = root["arguments"] as System.Text.Json.Nodes.JsonObject;
                if (args == null && chain.Any(c => c["arguments"] != null))
                {
                    args = new System.Text.Json.Nodes.JsonObject();
                    args["game"] = new System.Text.Json.Nodes.JsonArray();
                    args["jvm"] = new System.Text.Json.Nodes.JsonArray();
                    root["arguments"] = args;
                }
                if (args != null)
                {
                    foreach (var kind in new[] { "game", "jvm" })
                    {
                        var mine = args[kind] as System.Text.Json.Nodes.JsonArray;
                        if (mine == null) { mine = new System.Text.Json.Nodes.JsonArray(); args[kind] = mine; }
                        var merged = new System.Text.Json.Nodes.JsonArray();
                        for (int ci = chain.Count - 1; ci >= 0; ci--)
                        {
                            if (chain[ci]["arguments"] is System.Text.Json.Nodes.JsonObject pa && pa[kind] is System.Text.Json.Nodes.JsonArray arr)
                                foreach (var a in arr) merged.Add(a?.DeepClone());
                        }
                        foreach (var a in mine.ToList()) merged.Add(a?.DeepClone());
                        args[kind] = merged;
                    }
                }
        
                // ---- 标量字段：子没有的从父继承 ----
                foreach (var key in new[] { "mainClass", "assets", "assetIndex", "javaVersion", "minecraftArguments", "type", "logging" })
                {
                    if (root[key] != null) continue;
                    for (int ci = 0; ci < chain.Count; ci++)
                    {
                        if (chain[ci][key] == null) continue;
                        root[key] = chain[ci][key]?.DeepClone();
                        break;
                    }
                }
        

                // ⭐ 安全校验：合并结果不对就放弃扁平化，保留 inheritsFrom（宁可继承，也不能缺库）
                var _maxParentLibs = 0;
                foreach (var _c in chain)
                {
                    if (_c["libraries"] is System.Text.Json.Nodes.JsonArray _cl && _cl.Count > _maxParentLibs) _maxParentLibs = _cl.Count;
                }
                if (libs.Count < _maxParentLibs)
                {
                    DiagnosticLogger.Instance.Info($"[Flatten] 合并结果异常（{libs.Count} < {_maxParentLibs}），放弃扁平化");
                    return;
                }
                var _libNames = new List<string>();
                foreach (var _l in libs) _libNames.Add(_l?["name"]?.ToString() ?? "");
                if (!_libNames.Any(n => n.Contains("minecraft:client")) || !_libNames.Any(n => n.Contains("lwjgl")))
                {
                    Debug.WriteLine("[Flatten] 缺少原版关键库（minecraft:client / lwjgl），放弃扁平化");
                    return;
                }

                root.Remove("inheritsFrom");
        
                // 备份原文件再写回
                try { File.Copy(p, p + ".bak", true); } catch { }
                File.WriteAllText(p, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
                DiagnosticLogger.Instance.Info($"[Flatten] 已扁平化 {versionId}（合并 {chain.Count} 层父版本）");
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Info($"[Flatten] 失败 {versionId}: {ex.Message}");
            }
        }

        /// <summary>
        /// ⭐ 启动前全自动体检修复：json 破损→回滚、父版本缺失→补装 loader、缺库/资源→补全。
        /// 用户无感，缺什么补什么。
        /// </summary>
        // ⭐ 启动前：扫描全链路 libraries，国内镜像优先补齐，补完再复查一轮
        private async Task EnsureLibrariesAsync(string versionId, CoreWebView2 sender, double startPct, double endPct)
        {
            try
            {
                var mcDir = GetMcDir();
                var libsDir = Path.Combine(mcDir, "libraries");
                string[] mirrors = {
                    "https://bmclapi2.bangbang93.com/maven",
                    "https://maven.aliyun.com/repository/public",
                    "https://repo.huaweicloud.com/repository/maven",
                    "https://mirrors.cloud.tencent.com/nexus/repository/maven-public",
                };

                for (int round = 0; round < 2; round++)
                {
                    var missing = new List<(string full, string rel, string url, string sha1)>();
                    var cur = versionId;
                    var seen = new HashSet<string>();
                    for (int d = 0; d < 6 && !string.IsNullOrEmpty(cur); d++)
                    {
                        var jp = Path.Combine(mcDir, "versions", cur, cur + ".json");
                        if (!File.Exists(jp)) break;
                        try
                        {
                            using var doc = JsonDocument.Parse(File.ReadAllText(jp));
                            var root = doc.RootElement;
                            if (root.TryGetProperty("libraries", out var arr) && arr.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var lib in arr.EnumerateArray())
                                {
                                    if (!lib.TryGetProperty("downloads", out var dl) || !dl.TryGetProperty("artifact", out var art)) continue;
                                    var rel = art.TryGetProperty("path", out var pEl) ? pEl.GetString() : null;
                                    if (string.IsNullOrEmpty(rel) || !seen.Add(rel)) continue;
                                    var full = Path.Combine(libsDir, rel.Replace('/', Path.DirectorySeparatorChar));
                                    var libSha1 = art.TryGetProperty("sha1", out var sEl) ? (sEl.GetString() ?? "") : "";
                                    if (LibraryLooksPresent(full, libSha1)) continue;
                                    var url = art.TryGetProperty("url", out var uEl) ? (uEl.GetString() ?? "") : "";
                                    missing.Add((full, rel, url, libSha1));
                                }
                            }
                            cur = root.TryGetProperty("inheritsFrom", out var inh) ? (inh.GetString() ?? "") : "";
                        }
                        catch { break; }
                    }

                    if (missing.Count == 0) return;

                    int ok = 0, fail = 0, i = 0;
                    foreach (var m in missing)
                    {
                        i++;
                        await ReportLaunchProgress(sender, startPct + (endPct - startPct) * i / missing.Count, $"补全运行库 {i}/{missing.Count}");
                        var dir = Path.GetDirectoryName(m.full);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

                        var cands = new List<string>();
                        foreach (var b in mirrors) cands.Add(b + "/" + m.rel);
                        if (!string.IsNullOrEmpty(m.url)) cands.Add(m.url);
                        cands.Add("https://maven.minecraftforge.net/" + m.rel);
                        cands.Add("https://maven.neoforged.net/releases/" + m.rel);
                        cands.Add("https://libraries.minecraft.net/" + m.rel);

                        bool done = false;
                        foreach (var u in cands)
                        {
                            try
                            {
                                await DownloadFileAsync(u, u, m.full, null, string.IsNullOrEmpty(m.sha1) ? null : m.sha1);
                                var fi = new FileInfo(m.full);
                                if (LibraryLooksPresent(m.full, m.sha1)) { done = true; break; }
                            }
                            catch (OperationCanceledException) { throw; }
                            catch { }
                            try { if (File.Exists(m.full)) File.Delete(m.full); } catch { }
                        }
                        if (done) ok++; else fail++;
                    }
                    DiagnosticLogger.Instance.Info($"[Doctor] 第 {round + 1} 轮：成功 {ok}，失败 {fail}");
                    await ReportLaunchProgress(sender, endPct, $"运行库 {round + 1}/2 轮：成功 {ok}，失败 {fail}");
                    if (fail == 0) return;
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { DiagnosticLogger.Instance.Info($"[Doctor] 库检查失败：{ex.Message}"); }
        }

        // ⭐ 判断库是否就位。Mojang 有些库是「空壳小文件」（lwjgl-platform-2.9.4-nightly 只有 22 字节空 PK 包），
        //    不能一律用「长度 > 200」判定，否则会误判缺失，导致启动前反复重下、进度卡死。
        //    规则：>200 字节视为已存在（保持原行为）；小文件改比对 json 里的 SHA1。
        private static bool LibraryLooksPresent(string path, string expectedSha1)
        {
            try
            {
                var fi = new FileInfo(path);
                if (!fi.Exists || fi.Length == 0) return false;
                if (fi.Length > 200) return true;
                if (string.IsNullOrEmpty(expectedSha1) || expectedSha1.Length != 40) return false;
                using var sha = SHA1.Create();
                using var fs = File.OpenRead(path);
                var actual = BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
                return actual == expectedSha1.ToLowerInvariant();
            }
            catch { return false; }
        }

        // ⭐ 启动前体检：库补齐（国内镜像优先）+ 资源补全
        private async Task EnsureVersionReadyAsync(string versionId, CoreWebView2 sender, double startPct, double endPct)
        {
            try
            {
                var span = endPct - startPct;

                // 1) 先补库（缺失的按国内镜像优先下载，补完复查）
                // ⭐ 版本完整性自愈（新）：多源 + size/sha1 校验，先跑一遍，缺什么补什么
                try
                {
                    var _rep = await RepairVersionAsync(versionId, GetMcDir(), m => DiagnosticLogger.Instance.Info(m));
                    if (_rep.Failed > 0)
                        DiagnosticLogger.Instance.Info($"[Repair] 仍有 {_rep.Failed} 个文件无法补齐，交由后续流程与诊断提示处理");
                }
                catch (Exception _ex)
                {
                    DiagnosticLogger.Instance.Info($"[Repair] 自愈流程异常，跳过：{_ex.Message}");
                }

                await EnsureLibrariesAsync(versionId, sender, startPct, startPct + span * 0.7);

                // 2) 再补资源（assets / natives）
                await ProjBobcatRepairAsync(versionId, sender, startPct + span * 0.7, endPct, false);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { DiagnosticLogger.Instance.Info($"[Doctor] 启动前体检失败：{ex.Message}"); }
        }

        private async Task InstallModpackAsync(string mrpackPath, CoreWebView2 sender)
        {
            // ⭐ 直接抢下载锁，防止死锁
            if (!await TryEnterDownloadLock(sender))
            {
                return;
            }

            try
            {
         
                if (string.IsNullOrEmpty(mrpackPath) || !File.Exists(mrpackPath))
                {
                    await ReportProgress(sender, 0, " 整合包文件不存在", done: true);
                    return;
                }

                var mcDir = GetMcDir();

                // ⭐ 先解析出 displayName，拿它当目录名
                string _displayName, _mcVersion, _loaderType, _loaderVer;
                List<ModpackFile> _fileList = new List<ModpackFile>();
                List<CfFile> _cfFileList = new List<CfFile>();
                bool isCfPack = mrpackPath.ToLowerInvariant().EndsWith(".zip");

                if (isCfPack)
                {
                    ParseCfZipFull(mrpackPath, out _displayName, out _mcVersion, out _loaderType, out _loaderVer, out _cfFileList);
                }
                else
                {
                    ParseMrpackFull(mrpackPath, out _displayName, out _mcVersion, out _loaderType, out _loaderVer, out _fileList);
                }
                var folderName = SanitizeName(_displayName);
                var versionDir = Path.Combine(mcDir, "versions", folderName);

                // 重名处理
                if (Directory.Exists(versionDir))
                {
                    int n = 2;
                    while (Directory.Exists(Path.Combine(mcDir, "versions", $"{folderName}_{n}"))) n++;
                    folderName = $"{folderName}_{n}";
                    versionDir = Path.Combine(mcDir, "versions", folderName);
                }

                await ReportProgress(sender, 0, $"准备安装整合包 {folderName}...");

                // 1. 用刚才解析好的（避免重复解析）
                string mcVersion = _mcVersion;
                string loaderType = _loaderType;
                string loaderVer = _loaderVer;
                string displayName = _displayName;
                List<ModpackFile> fileList = _fileList;

                if (string.IsNullOrEmpty(mcVersion))
                    throw new Exception("整合包没写 MC 版本，无法安装");

                DiagnosticLogger.Instance.Info($"[Modpack] 包名={displayName} MC={mcVersion} loader={loaderType} {loaderVer} files={fileList.Count}");

                // 2. 确保原版已装
                var vanillaDir = Path.Combine(mcDir, "versions", mcVersion);
                if (!File.Exists(Path.Combine(vanillaDir, mcVersion + ".jar")))
                {
                    await ReportProgress(sender, 2, $"下载原版 {mcVersion}...");
                    var manifestJson = await GetStringWithFallbackAsync(new[]
 {
                        "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json",
                        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
                    }, 30000);

                    var manifest = JsonDocument.Parse(manifestJson).RootElement;
                    string versionUrl = null;
                    foreach (var v in manifest.GetProperty("versions").EnumerateArray())
                    {
                        if (v.GetProperty("id").GetString() == mcVersion)
                        {
                            versionUrl = v.GetProperty("url").GetString();
                            break;
                        }
                    }
                    if (versionUrl == null) throw new Exception($"找不到 MC {mcVersion}");
                    await DownloadMinecraftVersionAsync(mcVersion, versionUrl, sender, 40);
                }
                else
                {
                    await ReportProgress(sender, 40, $"原版 {mcVersion} 已存在");
                }

                // 3. 确保加载器已装
                string loaderVersionId = null;
                if (!string.IsNullOrEmpty(loaderType) && loaderType != "vanilla")
                {
                    if (loaderType == "fabric")
                    {
                        loaderVersionId = $"fabric-loader-{loaderVer}-{mcVersion}";
                        var loaderDir = Path.Combine(mcDir, "versions", loaderVersionId);
                        bool needInstall = !File.Exists(Path.Combine(loaderDir, loaderVersionId + ".json"));
                        if (needInstall)
                        {
                            await ReportProgress(sender, 45, $"安装 Fabric {loaderVer}...");
                            await InstallLoaderAsync("fabric", mcVersion, sender, reportDone: false, startPct: 45, endPct: 65, specificVersion: loaderVer, acquireLock: false);
                        }
                        else
                        {
                            await ReportProgress(sender, 65, $"Fabric {loaderVer} 已存在");
                        }

                        // ⭐ 不管装没装，都扫描实际目录（InstallFabricAsync 会自己选最新版）
                        var versionsDir = Path.Combine(mcDir, "versions");
                        var candidates = Directory.GetDirectories(versionsDir)
                            .Select(Path.GetFileName)
                            .Where(d => d != null && d.StartsWith("fabric-loader-") && d.EndsWith("-" + mcVersion))
                            .ToList();
                        if (candidates.Count > 0)
                        {
                            candidates.Sort();
                            loaderVersionId = candidates[candidates.Count - 1];
                            DiagnosticLogger.Instance.Info($"[Modpack] ⭐ 实际 fabric 版本目录 = {loaderVersionId}");
                        }
                    }
                    else if (loaderType == "forge")
                    {
                        loaderVersionId = $"{mcVersion}-forge-{loaderVer}";
                        var forgeLoaderDir = Path.Combine(mcDir, "versions", loaderVersionId);
                        var _forgeJson = Path.Combine(forgeLoaderDir, loaderVersionId + ".json");
                        // 目录存在不代表装好了：json 不在就先清掉残留目录再装
                        if (!File.Exists(_forgeJson))
                        {
                            try { if (Directory.Exists(forgeLoaderDir)) Directory.Delete(forgeLoaderDir, true); } catch { }
                            await ReportProgress(sender, 45, $"安装 Forge {loaderVer}...");
                            await InstallLoaderAsync("forge", mcVersion, sender, reportDone: false, startPct: 45, endPct: 65, specificVersion: loaderVer, acquireLock: false);
                        }
                        else await ReportProgress(sender, 65, $"Forge 已存在");
                    }
                    else if (loaderType == "neoforge")
                    {
                        loaderVersionId = $"{mcVersion}-neoforge-{loaderVer}";
                        var neoforgeLoaderDir = Path.Combine(mcDir, "versions", loaderVersionId);
                        var _neoforgeJson = Path.Combine(neoforgeLoaderDir, loaderVersionId + ".json");
                        if (!File.Exists(_neoforgeJson))
                        {
                            try { if (Directory.Exists(neoforgeLoaderDir)) Directory.Delete(neoforgeLoaderDir, true); } catch { }
                            await ReportProgress(sender, 45, $"安装 NeoForge {loaderVer}...");
                            await InstallLoaderAsync("neoforge", mcVersion, sender, reportDone: false, startPct: 45, endPct: 65, specificVersion: loaderVer, acquireLock: false);
                        }
                        else await ReportProgress(sender, 65, $"NeoForge 已存在");
                    }
                }
                // 3.5 验证加载器装好了；fabric 缺了就直拉 profile json 兜底写版本目录
                if (!string.IsNullOrEmpty(loaderVersionId))
                {
                    var _loaderDir = Path.Combine(mcDir, "versions", loaderVersionId);
                    var _loaderJson = Path.Combine(_loaderDir, loaderVersionId + ".json");
                
                    if (!File.Exists(_loaderJson) && loaderType == "fabric")
                    {
                        try
                        {
                            await ReportProgress(sender, 44, $"补写加载器 {loaderVersionId}...");
                            Directory.CreateDirectory(_loaderDir);
                            var _pUrl = $"https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/{mcVersion}/{loaderVer}/profile/json";
                            var _pJson = await _http.GetStringAsync(_pUrl);
                            await File.WriteAllTextAsync(_loaderJson, _pJson);
                            DiagnosticLogger.Instance.Info($"[Modpack] 兜底写入加载器成功: {loaderVersionId}");
                        }
                        catch (Exception ex)
                        {
                            DiagnosticLogger.Instance.Info($"[Modpack] 兜底写入加载器失败: {ex.Message}");
                        }
                    }
                
                    if (!File.Exists(_loaderJson))
                    {
                        await ReportProgress(sender, 0, $"加载器 {loaderVersionId} 安装未完成", done: true);
                        throw new Exception($"加载器 {loaderVersionId} 安装未完成（{loaderType} {loaderVer}），请检查网络后重试。");
                    }
                }

                // 4. 建整合包版本目录
                Directory.CreateDirectory(versionDir);

                // 5. 写版本 JSON（继承父版本）
                string parentForInherit = loaderVersionId ?? mcVersion;
                var versionJson = new Dictionary<string, object>
                {
                    ["id"] = folderName,
                    ["inheritsFrom"] = parentForInherit,
                    ["type"] = "release",
                    ["name"] = displayName,
                    ["libraries"] = new List<object>()
                };
                var versionJsonText = JsonSerializer.Serialize(versionJson, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(Path.Combine(versionDir, folderName + ".json"), versionJsonText);

                // 标记为整合包：DetectLoaderKind 靠这个文件把它归到「整合包」分类
                try
                {
                    var modpackMarker = new
                    {
                        name = folderName,
                        source = "illusion-launcher",
                        installedAt = DateTime.Now.ToString("s")
                    };
                    File.WriteAllText(Path.Combine(versionDir, "illusion.modpack.json"),
                        JsonSerializer.Serialize(modpackMarker, new JsonSerializerOptions { WriteIndented = true }));
                }
                catch { }

                // 6. 下载 mod
                int total = 0;
                int done = 0;
                var failed = new System.Collections.Concurrent.ConcurrentBag<string>();

                if (isCfPack)
                {
                    // CF 包：从 API 查下载链接
                    total = _cfFileList.Count;
                    var cfSem = new SemaphoreSlim(12);
                    var cfTasks = new List<Task>();

                    foreach (var cf in _cfFileList)
                    {
                        var cfl = cf;
                        await cfSem.WaitAsync();
                        cfTasks.Add(Task.Run(async () =>
                        {
                            try
                            {
                                var url = await GetCfDownloadUrlAsync(cfl.ProjectID, cfl.FileID);
                                var fileName = Path.GetFileName(new Uri(url).AbsolutePath);
                                if (string.IsNullOrEmpty(fileName)) fileName = $"{cfl.ProjectID}-{cfl.FileID}.jar";
                                var savePath = Path.Combine(versionDir, "mods", fileName);
                                Directory.CreateDirectory(Path.GetDirectoryName(savePath));
                                // ⭐ 改走分段下载：大文件自动切片并发，避免单连接 7KB/s 拖死
                                try { await DownloadParallelAsync(url, savePath, null); }
                                catch (OperationCanceledException) { throw; }
                                catch { await DownloadFileAsync(url, url, savePath, null); }
                            }
                            catch (Exception ex)
                            {
                                Debug.WriteLine($"[CF] 下载失败 {cfl.ProjectID}/{cfl.FileID}: {ex.Message}");
                                failed.Add($"{cfl.ProjectID}/{cfl.FileID}");
                            }
                            finally
                            {
                                cfSem.Release();
                                int d = Interlocked.Increment(ref done);
                                double pct = 65 + (double)d / total * 28;
                                _ = ReportProgress(sender, pct, $"下载 mod {d}/{total}");
                            }
                        }));
                    }
                    await Task.WhenAll(cfTasks);
                }
                else
                {
                    // mrpack：直接下 files[] 里的 URL（⭐ 分片加速版：大文件切段，失败自动退回整文件下载）
                    total = fileList.Count;

                    // ⭐ 全局连接数上限：整文件算 1 个任务，分片每段算 1 个任务，同时最多这么多个
                    int maxConnections = 96;

                    // 进度：每个文件一个 0~1 的分数
                    var activeFractions = new System.Collections.Concurrent.ConcurrentDictionary<string, double>();
                    var fileBytes = new System.Collections.Concurrent.ConcurrentDictionary<string, long>();

                    long lastBytesForSpeed = Interlocked.Read(ref _totalBytesDownloaded);
                    var lastSpeedTime = DateTime.Now;
                    double currentSpeed = 0;
                    var lastUiPush = DateTime.MinValue;
                    double lastOverall = 0;
                    var pushLock = new object();

                    void PushModProgress(bool force = false)
                    {
                        lock (pushLock)
                        {
                            var now = DateTime.Now;
                            if (!force && (now - lastUiPush).TotalMilliseconds < 200) return;
                            lastUiPush = now;

                            double elapsed = (now - lastSpeedTime).TotalSeconds;
                            if (elapsed >= 0.3)
                            {
                                long currentBytes = Interlocked.Read(ref _totalBytesDownloaded);
                                currentSpeed = (currentBytes - lastBytesForSpeed) / elapsed;
                                lastBytesForSpeed = currentBytes;
                                lastSpeedTime = now;
                            }

                            double activeSum = 0;
                            foreach (var kv in activeFractions) activeSum += kv.Value;

                            int doneNow = Volatile.Read(ref done);
                            double overall = (doneNow + activeSum) / Math.Max(total, 1);
                            if (overall < 0) overall = 0;
                            if (overall > 1) overall = 1;
                            if (overall < lastOverall) overall = lastOverall;
                            lastOverall = overall;

                            string speedStr = currentSpeed >= 1024 * 1024
                                ? $"{currentSpeed / 1024 / 1024:F1} MB/s"
                                : $"{currentSpeed / 1024:F0} KB/s";

                            double pct = 65 + overall * 28;
                            _ = ReportProgress(sender, pct, $"下载 mod {doneNow}/{total} · {speedStr}");
                        }
                    }

                    // ⭐ 切片计划：1MB 一段，单文件最多 16 段（≥2MB 就切，小文件也能填满槽位）
                    const long ChunkBytes = 1L * 1024 * 1024;
                    const int MaxChunksPerFile = 16;

                    var chunkPlan = new List<(ModpackFile file, string savePath, int chunks, long size)>();
                    foreach (var mf in fileList)
                    {
                        var sp = Path.Combine(versionDir, mf.Path.Replace('/', Path.DirectorySeparatorChar));
                        long sz = mf.Size;
                        int ch = 1;
                        if (sz >= 2L * 1024 * 1024)
                        {
                            ch = (int)Math.Ceiling((double)sz / ChunkBytes);
                            if (ch > MaxChunksPerFile) ch = MaxChunksPerFile;
                            if (ch < 2) ch = 1;
                        }
                        chunkPlan.Add((mf, sp, ch, sz));
                    }

                    // ⭐ 队列：所有"段"排成一队，由固定数量的工人依次领取，连接数永远可控
                    var queue = new System.Collections.Concurrent.ConcurrentQueue<(ModpackFile file, string savePath, int chunks, long size, int idx, long start, long end)>();
                    foreach (var plan in chunkPlan)
                    {
                        if (plan.chunks <= 1)
                        {
                            queue.Enqueue((plan.file, plan.savePath, 1, plan.size, 0, 0, 0));
                        }
                        else
                        {
                            long per = plan.size / plan.chunks;
                            for (int i = 0; i < plan.chunks; i++)
                            {
                                long st = i * per;
                                long en = (i == plan.chunks - 1) ? plan.size - 1 : (st + per - 1);
                                queue.Enqueue((plan.file, plan.savePath, plan.chunks, plan.size, i, st, en));
                            }
                        }
                    }

                    // 单个分片的下载（只负责把这一段的字节写进自己的 .chunkN 文件）
                    async Task DownloadOneChunkAsync(ModpackFile mf, string savePath, int chunks, long size, int idx, long start, long end)
                    {
                        string partPath = savePath + ".chunk" + idx;
                        long need = end - start + 1;

                        // 断点续传：这一段已经下全了就直接跳过
                        if (File.Exists(partPath) && new FileInfo(partPath).Length == need) return;

                        Directory.CreateDirectory(Path.GetDirectoryName(savePath));

                        Exception lastEx = null;
                        for (int attempt = 0; attempt < 2; attempt++)
                        {
                            try
                            {
                                if (File.Exists(partPath)) { try { File.Delete(partPath); } catch { } }

                                await _httpGate.WaitAsync();
                                try
                                {
                                    using var req = new HttpRequestMessage(HttpMethod.Get, mf.Url);
                                    req.Version = System.Net.HttpVersion.Version11;
                                    req.VersionPolicy = HttpVersionPolicy.RequestVersionExact;
                                    req.Headers.Range = new RangeHeaderValue(start, end);

                                    using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                                    if (resp.StatusCode != System.Net.HttpStatusCode.PartialContent)
                                        throw new Exception("服务器不支持分片（返回 " + (int)resp.StatusCode + "）");

                                    using var stream = await resp.Content.ReadAsStreamAsync();
                                    using var fs = new FileStream(partPath, FileMode.Create, FileAccess.Write, FileShare.None, 131072);

                                    var buffer = new byte[131072];
                                    int read;
                                    while ((read = await stream.ReadAsync(buffer, 0, buffer.Length)) > 0)
                                    {
                                        await fs.WriteAsync(buffer, 0, read);
                                        Interlocked.Add(ref _totalBytesDownloaded, read);
                                        long nowBytes = fileBytes.AddOrUpdate(mf.Path, read, (k, v) => v + read);
                                        double frac = size > 0 ? (double)nowBytes / size : 0;
                                        if (frac > 0.999) frac = 0.999;
                                        activeFractions[mf.Path] = frac;
                                        PushModProgress();
                                    }
                                }
                                finally { _httpGate.Release(); }

                                if (new FileInfo(partPath).Length != need)
                                    throw new Exception("分片长度不符");
                                return;
                            }
                            catch (Exception ex)
                            {
                                lastEx = ex;
                                await Task.Delay(400);
                            }
                        }
                        throw lastEx ?? new Exception("分片下载失败");
                    }

                    // ⭐ 工人：48 个工人抢队列，谁空谁干活，连接数永远不超过 48
                    // ⭐ 每个文件还剩几段没下完；归零就当场合并、立刻计入完成
                    var remainingChunks = new System.Collections.Concurrent.ConcurrentDictionary<string, int>();
                    var finishedSet = new System.Collections.Concurrent.ConcurrentDictionary<string, byte>();
                    var planByPath = new Dictionary<string, (ModpackFile file, string savePath, int chunks, long size)>();
                    foreach (var plan in chunkPlan)
                    {
                        planByPath[plan.file.Path] = plan;
                        if (plan.chunks > 1) remainingChunks[plan.file.Path] = plan.chunks;
                    }

                    // ⭐ 收尾一个文件：该合并的合并、该校验的校验，然后计入完成数
                    async Task FinishFileAsync(string path)
                    {
                        if (!planByPath.TryGetValue(path, out var plan)) return;
                        if (!finishedSet.TryAdd(path, 1)) return;

                        try
                        {
                            if (plan.chunks <= 1)
                            {
                                if (!File.Exists(plan.savePath)) failed.Add(path);
                            }
                            else
                            {
                                string tmp = plan.savePath + ".part";
                                Directory.CreateDirectory(Path.GetDirectoryName(plan.savePath));

                                using (var outFs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 131072))
                                {
                                    for (int i = 0; i < plan.chunks; i++)
                                    {
                                        string cp = plan.savePath + ".chunk" + i;
                                        if (!File.Exists(cp)) throw new FileNotFoundException("缺少分片 " + i);
                                        using var inFs = new FileStream(cp, FileMode.Open, FileAccess.Read, FileShare.Read, 131072);
                                        await inFs.CopyToAsync(outFs, 131072);
                                    }
                                }

                                bool ok = string.IsNullOrEmpty(plan.file.Sha1) || VerifySha1(tmp, plan.file.Sha1);
                                if (!ok) { try { File.Delete(tmp); } catch { } throw new Exception("SHA1 校验失败"); }

                                if (File.Exists(plan.savePath)) { try { File.Delete(plan.savePath); } catch { } }
                                File.Move(tmp, plan.savePath);

                                for (int i = 0; i < plan.chunks; i++) { try { File.Delete(plan.savePath + ".chunk" + i); } catch { } }
                            }
                        }
                        catch (Exception ex)
                        {
                            DiagnosticLogger.Instance.Info($"[Modpack] 分片合并失败 {path}: {ex.Message}，退回整文件下载");
                            try
                            {
                                for (int i = 0; i < plan.chunks; i++) { try { File.Delete(plan.savePath + ".chunk" + i); } catch { } }
                                await DownloadFileAsync(plan.file.Url, plan.file.Url, plan.savePath, null, plan.file.Sha1, forceHttp11: true);
                                if (!File.Exists(plan.savePath)) failed.Add(path);
                            }
                            catch
                            {
                                failed.Add(path);
                            }
                        }
                        finally
                        {
                            activeFractions.TryRemove(path, out _);
                            Interlocked.Increment(ref done);
                            PushModProgress(true);
                        }
                    }

                    // ⭐ 工人：48 个工人抢队列，谁空谁干活，连接数永远不超过 48
                    int workerCount = Math.Min(maxConnections, queue.Count);
                    var workers = new List<Task>();
                    for (int w = 0; w < workerCount; w++)
                    {
                        workers.Add(Task.Run(async () =>
                        {
                            while (queue.TryDequeue(out var job))
                            {
                                try
                                {
                                    if (job.chunks <= 1)
                                    {
                                        // 没分片：走原来的整文件下载（断点续传 / SHA1 / 镜像回退全都有）
                                        activeFractions[job.file.Path] = 0;
                                        await DownloadFileAsync(job.file.Url, job.file.Url, job.savePath,
                                            (downloaded, totalBytes) =>
                                            {
                                                if (totalBytes <= 0) return;
                                                double frac = (double)downloaded / totalBytes;
                                                if (frac > 0.999) frac = 0.999;
                                                activeFractions[job.file.Path] = frac;
                                                PushModProgress();
                                            },
                                            job.file.Sha1, forceHttp11: true);

                                        await FinishFileAsync(job.file.Path);
                                    }
                                    else
                                    {
                                        await DownloadOneChunkAsync(job.file, job.savePath, job.chunks, job.size, job.idx, job.start, job.end);

                                        int left = remainingChunks.AddOrUpdate(job.file.Path, 0, (k, v) => v - 1);
                                        if (left <= 0) await FinishFileAsync(job.file.Path);
                                    }
                                }
                                catch (Exception ex)
                                {
                                    DiagnosticLogger.Instance.Info($"[Modpack] 下载失败 {job.file.Path}: {ex.Message}");
                                    if (job.chunks <= 1)
                                    {
                                        await FinishFileAsync(job.file.Path);
                                    }
                                    else
                                    {
                                        int left = remainingChunks.AddOrUpdate(job.file.Path, 0, (k, v) => v - 1);
                                        if (left <= 0) await FinishFileAsync(job.file.Path);
                                    }
                                }
                                finally
                                {
                                    PushModProgress(true);
                                }
                            }
                        }));
                    }
                    await Task.WhenAll(workers);

                    // ⭐ 兜底：万一有文件因为异常没走到收尾，这里补齐（已收尾的会直接被跳过）
                    foreach (var plan in chunkPlan)
                    {
                        await FinishFileAsync(plan.file.Path);
                    }
                    PushModProgress(true);
                }


                // ⭐ CF 包：右上角 toast 提示 mod 需手动下载
                if (isCfPack && _cfFileList.Count > 0 && failed.Count > 0)
                {
                    try
                    {
                        var toastDesc = $"CF 限制第三方下载，{failed.Count} 个 mod 需手动补";
                        var toastDescJson = JsonSerializer.Serialize(toastDesc, JsonOpts());
                        await RunOnUI(() => {
                            _ = sender.ExecuteScriptAsync($"showSideToast('⚠️ CF 整合包', {toastDescJson}, 0)");
                        });
                        _ = Task.Delay(6000).ContinueWith(_ =>
                        {
                            try
                            {
                                sender.ExecuteScriptAsync("hideSideToast()");
                            }
                            catch { }
                        });
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"[CF] toast 提示失败：{ex.Message}");
                    }
                }


                // 7. 解压 overrides + client-overrides
                await ReportProgress(sender, 94, "解压配置文件...");
                ExtractOverrides(mrpackPath, versionDir, "overrides");
                ExtractOverrides(mrpackPath, versionDir, "client-overrides");


                // 7.5 ⭐ 补全原版库 / assets，保证拖入即玩（不再等到启动时才下载）
                try
                {
                    var _vid = Path.GetFileName(versionDir.TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar));
                    await ReportProgress(sender, 95, "正在补全运行库与资源文件（首次可能较久）...");
                    await ProjBobcatRepairAsync(_vid, sender, 95, 99.5, false);
                    await ReportProgress(sender, 99.5, "运行库与资源已就绪");
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex) { DiagnosticLogger.Instance.Info($"[Modpack] 补全失败：{ex.Message}"); }


                // 7.6 ⭐ 扁平化：把父版本的库/参数并进来，断掉 inheritsFrom（父版本不再是启动依赖）
                try
                {
                    var _flattenId = Path.GetFileName(versionDir.TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar));
                    // ⭐ 已关闭扁平化（会漏库） 原调用：FlattenVersionJson(_flattenId);
                }
                catch (Exception ex) { DiagnosticLogger.Instance.Info($"[Modpack] 扁平化失败：{ex.Message}"); }

                // 8. 收尾
                if (failed.Count > 0)
                {
                    await ReportProgress(sender, 100, $"⚠️ 完成，但 {failed.Count} 个 mod 下载失败", done: true);
                    try
                    {
                        var doneJson = JsonSerializer.Serialize(new
                        {
                            ok = true,
                            title = "安装完成（部分失败）",
                            desc = $"{displayName} · {failed.Count} 个 mod 缺失"
                        }, JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModpackInstalled({doneJson})"); });
                    }
                    catch { }
                }
                else
                {
                    await ReportProgress(sender, 100, $" {displayName} 安装完成", done: true);
                    try
                    {
                        var doneJson = JsonSerializer.Serialize(new
                        {
                            ok = true,
                            title = "安装成功",
                            desc = $"{displayName} 已就绪"
                        }, JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModpackInstalled({doneJson})"); });
                    }
                    catch { }
                }

                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("scanInstalledToHome()"); });
                await Task.Delay(600);
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"selectVersion('{folderName}')"); });
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Info($"[Modpack] 安装失败：{ex}");
                await ReportProgress(sender, 0, $" 安装失败：{ex.Message}", done: true);
                try
                {
                    var failJson = JsonSerializer.Serialize(new
                    {
                        ok = false,
                        error = ex.Message
                    }, JsonOpts());
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModpackInstalled({failJson})"); });
                }
                catch { }
            }
            finally
            {
                await ExitDownloadLock(sender);
            }
        }

        private string SanitizeName(string name)
        {
            if (string.IsNullOrEmpty(name)) return "modpack";
            var sb = new StringBuilder();
            foreach (var c in name)
            {
                if (char.IsLetterOrDigit(c)) sb.Append(c);
                else if (c == '-' || c == '_') sb.Append(c);
                else sb.Append('_');
            }
            var s = System.Text.RegularExpressions.Regex.Replace(sb.ToString(), "_+", "_").Trim('_');
            return string.IsNullOrEmpty(s) ? "modpack" : s;
        }

        private async Task<string> GetCfDownloadUrlAsync(int modId, int fileId)
        {
            if (string.IsNullOrEmpty(_global.CurseForgeApiKey))
                throw new Exception("未配置 CurseForge API Key");

            var url = $"https://api.curseforge.com/v1/mods/{modId}/files/{fileId}/download-url";
            var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Add("x-api-key", _global.CurseForgeApiKey);
            req.Headers.Add("Accept", "application/json");

            var resp = await _http.SendAsync(req);
            if (!resp.IsSuccessStatusCode)
                throw new Exception($"CF API 返回 {(int)resp.StatusCode}");

            var json = await resp.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json).RootElement;
            if (!doc.TryGetProperty("data", out var data))
                throw new Exception("CF API 响应缺 data 字段");

            var urlStr = data.GetString();
            if (string.IsNullOrEmpty(urlStr))
                throw new Exception("CF 未返回下载链接（作者可能禁止 API 下载）");
            return urlStr;
        }

        private class CfFile
        {
            public int ProjectID { get; set; }
            public int FileID { get; set; }
            public bool Required { get; set; }
        }

        private void ParseCfZipFull(string path, out string name, out string mcVersion,
            out string loaderType, out string loaderVer, out List<CfFile> files)
        {
            name = null; mcVersion = null; loaderType = null; loaderVer = null; files = new List<CfFile>();

            using var zip = ZipFile.OpenRead(path);
            ZipArchiveEntry entry = zip.GetEntry("manifest.json");
            if (entry == null)
            {
                var topDirs = zip.Entries
                    .Where(e => e.FullName.EndsWith("/manifest.json", StringComparison.OrdinalIgnoreCase))
                    .Where(e => e.FullName.Count(c => c == '/') == 1)
                    .ToList();
                if (topDirs.Count > 0) entry = topDirs[0];
            }
            if (entry == null) throw new Exception("不是有效的 CF 整合包");

            using var sr = new StreamReader(entry.Open());
            var doc = JsonDocument.Parse(sr.ReadToEnd()).RootElement;

            if (doc.TryGetProperty("name", out var n)) name = n.GetString();
            if (string.IsNullOrEmpty(name)) name = Path.GetFileNameWithoutExtension(path);

            if (doc.TryGetProperty("minecraft", out var mc))
            {
                if (mc.TryGetProperty("version", out var v)) mcVersion = v.GetString();
                if (mc.TryGetProperty("modLoaders", out var loaders) && loaders.GetArrayLength() > 0)
                {
                    JsonElement primary = default;
                    bool found = false;
                    foreach (var l in loaders.EnumerateArray())
                    {
                        if (l.TryGetProperty("primary", out var p) && p.GetBoolean())
                        {
                            primary = l;
                            found = true;
                            break;
                        }
                    }
                    if (!found) primary = loaders.EnumerateArray().First();
                    if (primary.TryGetProperty("id", out var idEl))
                    {
                        var idStr = idEl.GetString();
                        if (!string.IsNullOrEmpty(idStr))
                        {
                            var idx = idStr.IndexOf('-');
                            if (idx > 0)
                            {
                                loaderType = idStr.Substring(0, idx);
                                loaderVer = idStr.Substring(idx + 1);
                            }
                        }
                    }
                }
            }

            if (doc.TryGetProperty("files", out var arr))
            {
                foreach (var f in arr.EnumerateArray())
                {
                    var cf = new CfFile();
                    if (f.TryGetProperty("projectID", out var pidEl)) cf.ProjectID = pidEl.GetInt32();
                    if (f.TryGetProperty("fileID", out var fidEl)) cf.FileID = fidEl.GetInt32();
                    if (f.TryGetProperty("required", out var reqEl)) cf.Required = reqEl.GetBoolean();
                    else cf.Required = true;

                    if (cf.ProjectID <= 0 || cf.FileID <= 0) continue;
                    files.Add(cf);
                }
            }
        }

        private void ParseMrpackFull(string path, out string name, out string mcVersion,
            out string loaderType, out string loaderVer, out List<ModpackFile> files)
        {
            name = null; mcVersion = null; loaderType = null; loaderVer = null; files = new List<ModpackFile>();

            using var zip = ZipFile.OpenRead(path);
            var entry = zip.GetEntry("modrinth.index.json");
            if (entry == null) throw new Exception("不是有效的 .mrpack");

            using var sr = new StreamReader(entry.Open());
            var doc = JsonDocument.Parse(sr.ReadToEnd()).RootElement;

            if (doc.TryGetProperty("name", out var n)) name = n.GetString();
            if (string.IsNullOrEmpty(name)) name = Path.GetFileNameWithoutExtension(path);

            if (doc.TryGetProperty("dependencies", out var deps))
            {
                foreach (var p in deps.EnumerateObject())
                {
                    var key = p.Name;
                    var val = p.Value.GetString();
                    if (key == "minecraft") mcVersion = val;
                    else if (key == "fabric-loader") { loaderType = "fabric"; loaderVer = val; }
                    else if (key == "forge") { loaderType = "forge"; loaderVer = val; }
                    else if (key == "neoforge") { loaderType = "neoforge"; loaderVer = val; }
                    else if (key == "quilt-loader") { loaderType = "quilt"; loaderVer = val; }
                }
            }

            if (doc.TryGetProperty("files", out var arr))
            {
                foreach (var f in arr.EnumerateArray())
                {
                    var mf = new ModpackFile();
                    if (f.TryGetProperty("path", out var pe)) mf.Path = pe.GetString();
                    if (f.TryGetProperty("downloads", out var ds) && ds.GetArrayLength() > 0)
                        mf.Url = ds[0].GetString();
                    if (f.TryGetProperty("hashes", out var hs) && hs.TryGetProperty("sha1", out var s1))
                        mf.Sha1 = s1.GetString();
                    if (f.TryGetProperty("fileSize", out var fsz) && fsz.ValueKind == JsonValueKind.Number)
                        mf.Size = fsz.GetInt64();

                    if (string.IsNullOrEmpty(mf.Path) || string.IsNullOrEmpty(mf.Url)) continue;
                    if (mf.Path.EndsWith(".disabled", StringComparison.OrdinalIgnoreCase)) continue;
                    files.Add(mf);
                }
            }
        }

        private void ExtractOverrides(string mrpackPath, string versionDir, string overrideFolder)
        {
            try
            {
                using var zip = ZipFile.OpenRead(mrpackPath);
                var prefix = overrideFolder + "/";
                foreach (var entry in zip.Entries)
                {
                    if (!entry.FullName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                    var rel = entry.FullName.Substring(prefix.Length);
                    if (string.IsNullOrEmpty(rel)) continue;

                    var dest = Path.Combine(versionDir, rel.Replace('/', Path.DirectorySeparatorChar));
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(dest);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        entry.ExtractToFile(dest, true);
                    }
                }
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Info($"[Modpack] 解压 {overrideFolder} 失败：{ex.Message}");
            }
        }
        private async Task ReportLaunchProgress(CoreWebView2 sender, double percent, string message, bool done = false)
        {
            var json = JsonSerializer.Serialize(new
            {
                type = "launch_progress",
                percent = Math.Round(percent, 2),
                message,
                done
            });
            await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onLaunchProgress({json})"); });
        }
    }
}
