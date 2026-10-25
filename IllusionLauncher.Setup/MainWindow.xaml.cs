using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace IllusionLauncher.Setup
{
    public partial class MainWindow : Window
    {
        private const string DefaultInstallPath = @"C:\Program Files\IllusionLauncher";
        private static string AppVersion
        {
            get
            {
                try
                {
                    var v = Assembly.GetExecutingAssembly().GetName().Version;
                    return v == null ? "0.0.0" : $"{v.Major}.{v.Minor}.{v.Build}";
                }
                catch { return "0.0.0"; }
            }
        }

        private bool _busy;

        public MainWindow()
        {
            InitializeComponent();

            if (LblVersion != null) LblVersion.Text = "幻境启动器 · v" + AppVersion;

            var args = Environment.GetCommandLineArgs();
            if (args.Length > 1 && args[1] == "--uninstall")
            {
                RunUninstall();
                return;
            }

            TxtPath.Text = DefaultInstallPath;
            UpdateSpaceLabel();
        }

        // ---------- 卸载模式 ----------
        private void RunUninstall()
        {
            var dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? "";
            var quiet = Array.IndexOf(Environment.GetCommandLineArgs(), "/quiet") > 0;

            if (!quiet)
            {
                var r = MessageBox.Show(
                    "确定要卸载 Illusion Launcher 吗？\n\n" +
                    "游戏版本、存档和启动器配置不会被删除（它们在游戏目录和 %APPDATA% 中）。",
                    "卸载 Illusion Launcher", MessageBoxButton.OKCancel, MessageBoxImage.Question);
                if (r != MessageBoxResult.OK) { Application.Current.Shutdown(); return; }
            }

            InstallService.Uninstall(dir.TrimEnd(Path.DirectorySeparatorChar));
            Application.Current.Shutdown();
        }

        // ---------- 窗口拖动 / 关闭 ----------
        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ButtonState == MouseButtonState.Pressed) DragMove();
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            if (_busy) return;
            Close();
        }

        // ---------- 导航 ----------
        private void ShowScreen(UIElement screen)
        {
            ScreenWelcome.Visibility = screen == ScreenWelcome ? Visibility.Visible : Visibility.Collapsed;
            ScreenPath.Visibility = screen == ScreenPath ? Visibility.Visible : Visibility.Collapsed;
            ScreenInstall.Visibility = screen == ScreenInstall ? Visibility.Visible : Visibility.Collapsed;
        }

        private void BtnStart_Click(object sender, RoutedEventArgs e) => ShowScreen(ScreenPath);

        private void BtnBack_Click(object sender, RoutedEventArgs e) => ShowScreen(ScreenWelcome);

        private void BtnBrowse_Click(object sender, RoutedEventArgs e)
        {
            using (var dlg = new System.Windows.Forms.FolderBrowserDialog())
            {
                dlg.Description = "选择 Illusion Launcher 的安装位置";
                dlg.ShowNewFolderButton = true;
                if (Directory.Exists(TxtPath.Text)) dlg.SelectedPath = TxtPath.Text;

                if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    TxtPath.Text = Path.Combine(dlg.SelectedPath, "IllusionLauncher");
                    UpdateSpaceLabel();
                }
            }
        }

        private void UpdateSpaceLabel()
        {
            try
            {
                var root = Path.GetPathRoot(TxtPath.Text);
                if (string.IsNullOrEmpty(root)) { LblSpace.Text = ""; return; }

                var drive = new DriveInfo(root);
                var free = drive.AvailableFreeSpace / (1024.0 * 1024.0 * 1024.0);
                LblSpace.Text = $"{drive.Name} 可用空间 {free:F1} GB";
                LblSpace.Foreground = free < 0.6
                    ? (Brush)FindResource("Danger")
                    : (Brush)FindResource("TextSecondary");
            }
            catch { LblSpace.Text = ""; }
        }

        // ---------- 安装 ----------
        private async void BtnInstall_Click(object sender, RoutedEventArgs e)
        {
            var target = (TxtPath.Text ?? "").Trim();
            if (target.Length < 4 || Path.GetPathRoot(target) == target)
            {
                MessageBox.Show("请选择一个具体的安装文件夹，不能直接装在磁盘根目录。", "路径无效",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try { Directory.CreateDirectory(target); }
            catch (Exception ex)
            {
                MessageBox.Show("无法在该位置创建文件夹：" + ex.Message, "路径无效",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            _busy = true;
            ShowScreen(ScreenInstall);
            LblInstallTitle.Text = "正在安装…";
            PanelDone.Visibility = Visibility.Collapsed;
            SetProgress(0);
            BtnClose.IsEnabled = false;

            try
            {
                await Task.Run(() => DoInstall(target));
                FinishInstall();
            }
            catch (Exception ex)
            {
                LblInstallTitle.Text = "安装失败";
                SetStatus(ex.Message);
                PanelDone.Visibility = Visibility.Visible;
                _busy = false;
                BtnClose.IsEnabled = true;
            }
        }

        private void DoInstall(string target)
        {
            SetStatus("正在检查运行环境…");

            if (!InstallService.IsDotNet10DesktopInstalled())
            {
                SetStatus("未检测到 .NET 10 桌面运行时，正在安装…");
                InstallService.InstallPrereq(InstallService.NetRuntimeUrl,
                    "windowsdesktop-runtime-win10-x64.exe", "/install /quiet /norestart", SetStatus);
            }

            if (!InstallService.IsWebView2Installed())
            {
                SetStatus("未检测到 WebView2 运行时，正在安装…");
                InstallService.InstallPrereq(InstallService.WebView2Url,
                    "MicrosoftEdgeWebview2Setup.exe", "/silent /install", SetStatus);
            }

            InstallService.KillLauncher();

            SetStatus("正在解压程序文件…");
            var progress = new Progress<double>(p =>
            {
                // 解压占进度条的 0~85%
                SetProgress(p * 0.85);
                SetStatus($"正在解压程序文件… {p:F0}%");
            });
            InstallService.ExtractPayload(target, progress);

            SetStatus("正在创建快捷方式…");
            SetProgress(90);
            var exePath = Path.Combine(target, InstallService.AppExeName);
            InstallService.CreateShortcut(InstallService.DesktopLnk, exePath, target);
            InstallService.CreateShortcut(InstallService.StartMenuLnk, exePath, target);

            SetStatus("正在写入卸载信息…");
            SetProgress(95);

            // 把安装器自身复制进去当卸载程序
            var uninstaller = Path.Combine(target, InstallService.UninstallerName);
            try { File.Copy(Assembly.GetExecutingAssembly().Location, uninstaller, true); } catch { }
            InstallService.WriteUninstallKey(target, AppVersion, uninstaller);

            SetProgress(100);
            SetStatus("安装完成");
        }

        // ---------- UI 更新（跨线程） ----------
        private void SetStatus(string text)
        {
            Dispatcher.InvokeAsync(() => LblStatus.Text = text);
        }

        private void SetProgress(double percent)
        {
            Dispatcher.InvokeAsync(() =>
            {
                if (percent < 0) percent = 0;
                if (percent > 100) percent = 100;
                var trackWidth = TrackBar.ActualWidth;
                if (trackWidth <= 0) trackWidth = 320;
                ProgressFill.Width = trackWidth * percent / 100.0;
            });
        }

        private void FinishInstall()
        {
            _busy = false;
            BtnClose.IsEnabled = true;
            LblInstallTitle.Text = "安装完成";
            SetStatus($"已安装到 {TxtPath.Text}");
            SetProgress(100);
            PanelDone.Visibility = Visibility.Visible;
        }

        private void BtnLaunch_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var exePath = Path.Combine(TxtPath.Text, InstallService.AppExeName);
                if (File.Exists(exePath))
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        UseShellExecute = true,
                        WorkingDirectory = TxtPath.Text
                    });
            }
            catch { }
            Close();
        }
    }
}
