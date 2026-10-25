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
        private bool _busy;

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

        public MainWindow()
        {
            InitializeComponent();

            // 强制加载本地背景图
            try
            {
                var bitmap = LoadBackgroundBitmap();
                if (bitmap != null)
                {
                    // 直接把图片填进 Border.Background：Border 会严格按自己的 CornerRadius 裁剪，
                    // 尺寸自动跟随窗口，不再写死 592x432（那会盖住 1.5px 边框、圆角错位）。
                    BgContainer.Background = new System.Windows.Media.ImageBrush(bitmap)
                    {
                        Stretch = System.Windows.Media.Stretch.UniformToFill,
                        AlignmentX = System.Windows.Media.AlignmentX.Center,
                        AlignmentY = System.Windows.Media.AlignmentY.Center
                    };

                    // 预先做一张高斯模糊副本，给胶囊按钮当「毛玻璃」底用
                    _bgBlurred = CreateBlurredBackdrop(bitmap, 18);
                }
            }
            catch { }

            var args = Environment.GetCommandLineArgs();
            if (args.Length > 1 && args[1] == "--uninstall")
            {
                RunUninstall();
                return;
            }

            TxtPath.Text = DefaultInstallPath;
            UpdateSpaceLabel();

            // 布局到位/尺寸变化时重新对齐按钮的模糊背景（按钮位置一变就得重算 Viewbox）
            BgContainer.LayoutUpdated += (s, e) => UpdateGlassBackdrops();
            Loaded += (s, e) => UpdateGlassBackdrops();
        }

        // ---------- 毛玻璃按钮 ----------

        /// <summary>
        /// 读背景图：优先读内嵌资源（发版时安装器就是单独一个 exe，没有外部依赖），
        /// 读不到再回退到 exe 同目录的 bg.png（方便换图涋预览）。
        /// </summary>
        private static System.Windows.Media.Imaging.BitmapSource LoadBackgroundBitmap()
        {
            var asm = typeof(MainWindow).Assembly;

            using (var stream = asm.GetManifestResourceStream("bg.png"))
            {
                if (stream != null)
                {
                    var bmp = new System.Windows.Media.Imaging.BitmapImage();
                    bmp.BeginInit();
                    bmp.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                    bmp.StreamSource = stream;
                    bmp.EndInit();
                    bmp.Freeze();
                    return bmp;
                }
            }

            var imgPath = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bg.png");
            if (!System.IO.File.Exists(imgPath)) return null;

            var fileBmp = new System.Windows.Media.Imaging.BitmapImage();
            fileBmp.BeginInit();
            fileBmp.UriSource = new Uri(imgPath, UriKind.Absolute);
            fileBmp.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
            fileBmp.EndInit();
            fileBmp.Freeze();
            return fileBmp;
        }

        /// <summary>背景图的高斯模糊副本（尺寸与原图一致）。</summary>
        private System.Windows.Media.Imaging.BitmapSource _bgBlurred;

        /// <summary>
        /// 生成原图的高斯模糊版本。先向四周扩 padding 再模糊，最后裁掉边缘，
        /// 否则模糊会采样到图外的透明像素，导致按钮边缘发暗。
        /// </summary>
        private static System.Windows.Media.Imaging.BitmapSource CreateBlurredBackdrop(
            System.Windows.Media.Imaging.BitmapSource src, double radius)
        {
            int pad = (int)Math.Ceiling(radius * 2);
            int w = src.PixelWidth, h = src.PixelHeight;

            var dv = new System.Windows.Media.DrawingVisual();
            dv.Effect = new System.Windows.Media.Effects.BlurEffect
            {
                Radius = radius,
                KernelType = System.Windows.Media.Effects.KernelType.Gaussian,
                RenderingBias = System.Windows.Media.Effects.RenderingBias.Performance
            };
            using (var dc = dv.RenderOpen())
            {
                var brush = new System.Windows.Media.ImageBrush(src) { Stretch = System.Windows.Media.Stretch.Fill };
                dc.DrawRectangle(brush, null, new Rect(pad, pad, w, h));
            }

            var rtb = new System.Windows.Media.Imaging.RenderTargetBitmap(
                w + pad * 2, h + pad * 2, 96, 96, System.Windows.Media.PixelFormats.Pbgra32);
            rtb.Render(dv);

            var cropped = new System.Windows.Media.Imaging.CroppedBitmap(rtb, new Int32Rect(pad, pad, w, h));
            cropped.Freeze();
            return cropped;
        }

        /// <summary>让每个胶囊按钮的 GlassImg 图层显示「它背后那块背景图的模糊版」。</summary>
        private void UpdateGlassBackdrops()
        {
            if (_bgBlurred == null) return;

            double cw = BgContainer.ActualWidth, ch = BgContainer.ActualHeight;
            if (cw < 1 || ch < 1) return;

            double iw = _bgBlurred.PixelWidth, ih = _bgBlurred.PixelHeight;
            double scale = Math.Max(cw / iw, ch / ih);   // 与 UniformToFill 一致
            double ox = (cw - iw * scale) / 2.0;
            double oy = (ch - ih * scale) / 2.0;

            // 胶囊按钮 + 路径输入框，统一走同一套毛玻璃处理
            var controls = new System.Windows.Controls.Control[] { BtnBrowse, BtnInstall, BtnDone, BtnLaunch, TxtPath };
            foreach (var btn in controls)
            {
                if (btn == null || !btn.IsVisible || btn.ActualWidth < 1) continue;

                btn.ApplyTemplate();
                var glass = btn.Template.FindName("GlassImg", btn) as System.Windows.Controls.Border;
                if (glass == null) continue;

                Point btnPos, bgPos;
                try
                {
                    btnPos = btn.TransformToAncestor(this).Transform(new Point(0, 0));
                    bgPos = BgContainer.TransformToAncestor(this).Transform(new Point(0, 0));
                }
                catch { continue; }

                // 按钮左上角 → 卡片坐标 → 原图像素坐标
                double rx = ((btnPos.X - bgPos.X) - ox) / scale;
                double ry = ((btnPos.Y - bgPos.Y) - oy) / scale;
                double rw = btn.ActualWidth / scale;
                double rh = btn.ActualHeight / scale;

                rx = Math.Max(0, Math.Min(rx, iw - 1));
                ry = Math.Max(0, Math.Min(ry, ih - 1));
                rw = Math.Min(rw, iw - rx);
                rh = Math.Min(rh, ih - ry);
                if (rw <= 0 || rh <= 0) continue;

                var box = new Rect(rx, ry, rw, rh);
                if (glass.Tag is Rect prev && prev == box) continue;   // 没变化就不重建 Brush
                glass.Tag = box;

                glass.Background = new System.Windows.Media.ImageBrush(_bgBlurred)
                {
                    ViewboxUnits = System.Windows.Media.BrushMappingMode.Absolute,
                    Viewbox = box,
                    Stretch = System.Windows.Media.Stretch.Fill
                };
            }
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

        // ---------- 选择文件夹 ----------
        private void BtnBrowse_Click(object sender, RoutedEventArgs e)
        {
            if (_busy) return;
            var current = TxtPath.Text ?? "";
            var start = Directory.Exists(current) ? current : Path.GetPathRoot(current);

            var picked = FolderPicker.Pick("选择 Illusion Launcher 的安装文件夹", start);
            if (!string.IsNullOrEmpty(picked))
            {
                TxtPath.Text = picked;
                UpdateSpaceLabel();
            }
        }

        private void TxtPath_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
        {
            if (LblSpace != null) UpdateSpaceLabel();
        }

        private void UpdateSpaceLabel()
        {
            try
            {
                var text = TxtPath.Text ?? "";
                var root = Path.GetPathRoot(text);
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
            if (_busy) return;

            var target = (TxtPath.Text ?? "").Trim().TrimEnd('\\');
            if (target.Length < 4 || Path.GetPathRoot(target).TrimEnd('\\') == target)
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
            BtnInstall.Visibility = Visibility.Collapsed;
            PanelProgress.Visibility = Visibility.Visible;
            PanelDone.Visibility = Visibility.Collapsed;
            TxtPath.IsReadOnly = true;
            SetProgress(0);
            BtnClose.IsEnabled = false;

            try
            {
                await Task.Run(() => DoInstall(target));
                FinishInstall();
            }
            catch (Exception ex)
            {
                SetStatus("安装失败：" + ex.Message);
                PanelDone.Visibility = Visibility.Visible;
                _busy = false;
                BtnClose.IsEnabled = true;
                TxtPath.IsReadOnly = false;
            }
        }

        private void DoInstall(string target)
        {
            // 正式安装包：用内嵌的 payload.zip；
            // VS 调试运行：没有内嵌载荷，自动回退到 build\publish，让 F5 也能真实安装
            var devPayload = InstallService.HasPayload ? null : FindDevPayloadDir();

            if (!InstallService.HasPayload && devPayload == null)
            {
                for (var p = 0; p <= 100; p += 5)
                {
                    SetProgress(p * 0.85);
                    SetStatus(p < 70 ? $"正在解压程序文件… {p}%" : "正在创建快捷方式…");
                    System.Threading.Thread.Sleep(70);
                }
                SetProgress(100);
                SetStatus("演示模式：未找到 build\\publish，请先构建主程序或运行 make-release.ps1");
                return;
            }

            SetStatus("正在检查运行环境…");

            if (!InstallService.IsDotNet10DesktopInstalled())
            {
                SetStatus("未检测到 .NET 10 桌面运行时，正在安装…");
                InstallService.InstallPrereq(InstallService.NetRuntimeUrl,
                    "windowsdesktop-runtime-win-x64.exe", "/install /quiet /norestart", SetStatus);
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
                SetProgress(p * 0.85);
                SetStatus($"正在解压程序文件… {p:F0}%");
            });
            if (InstallService.HasPayload)
                InstallService.ExtractPayload(target, progress);
            else
                CopyDirectoryWithProgress(devPayload, target, progress);

            SetStatus("正在创建快捷方式…");
            SetProgress(90);
            var exePath = Path.Combine(target, InstallService.AppExeName);
            InstallService.CreateShortcut(InstallService.DesktopLnk, exePath, target);
            InstallService.CreateShortcut(InstallService.StartMenuLnk, exePath, target);

            SetStatus("正在写入卸载信息…");
            SetProgress(95);

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
            SetStatus($"已安装到 {TxtPath.Text}");
            SetProgress(100);
            PanelDone.Visibility = Visibility.Visible;
        }

        /// <summary>调试运行时：顺着 exe 目录往上找 build\publish（仓库根的构建产物）。</summary>
        private static string FindDevPayloadDir()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (var i = 0; i < 10 && dir != null; i++, dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "build", "publish");
                if (File.Exists(Path.Combine(candidate, InstallService.AppExeName))) return candidate;
            }
            return null;
        }

        /// <summary>把目录树复制到目标位置，按文件数报告进度（0-100）。</summary>
        private static void CopyDirectoryWithProgress(string source, string dest, IProgress<double> progress)
        {
            var files = Directory.GetFiles(source, "*", SearchOption.AllDirectories);
            for (var i = 0; i < files.Length; i++)
            {
                var relative = files[i].Substring(source.Length)
                    .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var outPath = Path.Combine(dest, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath));
                File.Copy(files[i], outPath, true);
                progress?.Report((i + 1) * 100.0 / files.Length);
            }
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