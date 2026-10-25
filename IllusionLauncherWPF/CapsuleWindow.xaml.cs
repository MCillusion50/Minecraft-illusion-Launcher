using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace IllusionLauncherWPF
{
    public partial class CapsuleWindow : Window
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        public CapsuleWindow(string playerName, string versionName, string avatarPath)
        {
            InitializeComponent();

            PlayerName.Text = playerName;
            VersionName.Text = versionName;

            this.Loaded += (s, e) =>
            {
                EnableAcrylic();
                PositionWindow();
            };
        }

        private void OpenScreenshots_Click(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true; // 阻止窗口被拖动
            if (System.Windows.Application.Current.MainWindow is MainWindow mainWin)
            {
                mainWin.OpenCurrentScreenshotsFolder(); // 呼叫主窗口去开文件夹
            }
        }

        private void IslandBody_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Left)
            {
                PlayClickBounce();
            }
        }

        private void PlayClickBounce()
        {
            // 1. 瞬间压扁一点（模拟按下去）
            IslandScale.ScaleX = 0.95;
            IslandScale.ScaleY = 0.9;

            // 2. 用弹性曲线弹回 1.0（Duang~）
            var bounceX = new System.Windows.Media.Animation.DoubleAnimation
            {
                To = 1.0,
                Duration = TimeSpan.FromMilliseconds(400),
                EasingFunction = new System.Windows.Media.Animation.ElasticEase
                {
                    EasingMode = System.Windows.Media.Animation.EasingMode.EaseOut,
                    Oscillations = 2,
                    Springiness = 4
                }
            };
            var bounceY = new System.Windows.Media.Animation.DoubleAnimation
            {
                To = 1.0,
                Duration = TimeSpan.FromMilliseconds(400),
                EasingFunction = new System.Windows.Media.Animation.ElasticEase
                {
                    EasingMode = System.Windows.Media.Animation.EasingMode.EaseOut,
                    Oscillations = 2,
                    Springiness = 4
                }
            };

            IslandScale.BeginAnimation(System.Windows.Media.ScaleTransform.ScaleXProperty, bounceX);
            IslandScale.BeginAnimation(System.Windows.Media.ScaleTransform.ScaleYProperty, bounceY);
        }

        private void EnableAcrylic()
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            int useAcrylic = 1;
            DwmSetWindowAttribute(hwnd, 38, ref useAcrylic, sizeof(int));
        }

        private void PositionWindow()
        {
            var workArea = SystemParameters.WorkArea;
            this.Left = workArea.Right - this.Width - 10;
            this.Top = workArea.Bottom - this.Height - 10;
        }

        private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed)
            {
                this.DragMove();
            }
        }

        // 辅助方法：播放收回动画并在结束后执行动作
        private void PlayShrinkAndClose(Action onComplete)
        {
            // ⭐ 宽度从 240 收回到 0
            var shrinkW = new System.Windows.Media.Animation.DoubleAnimation
            {
                From = 240,
                To = 0,
                Duration = TimeSpan.FromMilliseconds(800),
                EasingFunction = new System.Windows.Media.Animation.CubicEase { EasingMode = System.Windows.Media.Animation.EasingMode.EaseIn }
            };
            IslandBody.BeginAnimation(Border.WidthProperty, shrinkW);

            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(800) };
            timer.Tick += (s, args) =>
            {
                timer.Stop();
                onComplete?.Invoke();
                this.Close();
            };
            timer.Start();
        }

        // 点击展开按钮
        private void Restore_Click(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;

            // 调用收回动画，并在结束后唤回主界面
            PlayShrinkAndClose(() =>
            {
                if (System.Windows.Application.Current.MainWindow is MainWindow mainWin)
                {
                    mainWin.ClearCapsule();
                    mainWin.Show();
                    mainWin.WindowState = WindowState.Normal;
                    mainWin.Activate();
                }
            });
        }

        // 点击关闭按钮
        private async void Close_Click(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;

            // 调用收回动画，结束后唤回主界面
            PlayShrinkAndClose(async () =>
            {
                if (System.Windows.Application.Current.MainWindow is MainWindow mainWin)
                {
                    mainWin.ClearCapsule();
                    mainWin.Show();
                    mainWin.WindowState = WindowState.Normal;
                    mainWin.Activate();
                }

                // ⭐ 核心：等动画彻底播完，主界面切出来了，再给 Java 补最后一刀
                await Task.Delay(500); // 500毫秒延迟，觉得快可以改 800

                if (System.Windows.Application.Current.MainWindow is MainWindow mainWin2)
                {
                    mainWin2.ForceCloseGameFromCapsule();
                }
            });
        }
    }
}