using Microsoft.Extensions.DependencyInjection;
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Threading;
using System.Net;
using System.Net.Http;
using System.Windows;
using System.Linq; // ⭐ 需要这个来用 Contains

namespace IllusionLauncherWPF
{
    public partial class App : System.Windows.Application
    {
        public static IServiceProvider ServiceProvider { get; private set; }

        public App()
        {
            // 0. 自更新模式：等旧进程退出 → 覆盖安装目录 → 重启主程序。此模式不创建任何窗口
            var rawArgs = Environment.GetCommandLineArgs();
            if (rawArgs.Length >= 6 && rawArgs[1] == "--apply-update")
            {
                try { SelfUpdater.Run(rawArgs[2], rawArgs[3], int.Parse(rawArgs[4]), rawArgs[5]); }
                catch { }
                Environment.Exit(0);
                return;
            }

            // 提升连接数上限（ProjBobcat 多线程下载的前提）
            ServicePointManager.DefaultConnectionLimit = 512;

            // 注册 HttpClientFactory（DefaultResourceCompleter 的 required 属性）
            var services = new ServiceCollection();
            services.AddHttpClient();
            ServiceProvider = services.BuildServiceProvider();

            // 全局异常日志（调试用）
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                try
                {
                    File.WriteAllText(
                        Path.Combine(AppContext.BaseDirectory, "crash.log"),
                        e.ExceptionObject?.ToString() ?? "unknown");
                }
                catch { }
            };

            this.DispatcherUnhandledException += (s, e) =>
            {
                try
                {
                    File.WriteAllText(
                        Path.Combine(AppContext.BaseDirectory, "crash_ui.log"),
                        e.Exception?.ToString() ?? e.Exception?.Message ?? "unknown");
                }
                catch { }
                e.Handled = true;
            };
        }

        protected override void OnStartup(StartupEventArgs e)
        {
            // 1. 如果带了 --optimize 参数，极速清理模式：清理完直接退出
            if (e.Args.Contains("--optimize"))
            {
                NativeMemory.RunOptimize();
                Shutdown();
                return;
            }

            // 2. 如果带了 --elevated 参数，说明是提权后拉起的自己，正常启动
            if (e.Args.Contains("--elevated"))
            {
                base.OnStartup(e);
                StartMainWindow();
                return;
            }

            // 3. 正常双击启动：检查是不是管理员
            bool isAdmin = new System.Security.Principal.WindowsPrincipal(
                System.Security.Principal.WindowsIdentity.GetCurrent())
                .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);

            if (!isAdmin)
            {
                try
                {
                    // 尝试静默拉起管理员权限的自己
                    var psi = new ProcessStartInfo
                    {
                        FileName = Process.GetCurrentProcess().MainModule.FileName,
                        Arguments = string.Join(" ", e.Args) + " --elevated",
                        Verb = "runas",
                        UseShellExecute = true
                    };
                    Process.Start(psi);
                    Shutdown(); // 关闭没权限的老进程
                    return;
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // 玩家在 UAC 点了否
                 
                    // 依然正常启动没权限的版本
                    base.OnStartup(e);
                    StartMainWindow();
                    return;
                }
            }

            // 4. 本来就是管理员，直接启动
            base.OnStartup(e);
            StartMainWindow();
        }

        // 提取出来的启动窗口方法，方便复用
        private void StartMainWindow()
        {
            // 挂载异常监听
            DispatcherUnhandledException += (s, args) =>
            {
                try { System.IO.File.AppendAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "crash.log"), $"[FATAL-UI] {DateTime.Now}\n{args.Exception}\n\n"); } catch { }
            };

            var splash = new SplashWindow();
            splash.Show();

            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(2600) };
            timer.Tick += (s, args) =>
            {
                timer.Stop();
                var main = new MainWindow();
                MainWindow = main;
                main.Show();
                splash.Close();
            };
            timer.Start();
        }

        protected override void OnExit(ExitEventArgs e)
        {
            (ServiceProvider as IDisposable)?.Dispose();
            base.OnExit(e);
        }
    }
}