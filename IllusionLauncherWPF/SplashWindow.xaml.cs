using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace IllusionLauncherWPF
{
    public partial class SplashWindow : Window
    {
        private MediaPlayer _player;
        private bool _animationStarted = false;

        // ⭐ 时间参数（和 WinUI 版一致）
        private const int SoundToLogoDelayMs = 260;
        private const int FadeInDurationMs = 400;
        private const int LogoHoldMs = 1800;
        private const int FadeOutDurationMs = 800;

        public SplashWindow()
        {
            InitializeComponent();
            PlayStartupSound();
        }

        public void PlayAnimation()
        {
            if (!_animationStarted) StartAnimationTimers();
        }

        private void PlayStartupSound()
        {
            try
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Assets", "startup.mp3");
                if (!File.Exists(path))
                {
                    Debug.WriteLine("[Splash] 找不到 startup.mp3，直接开始动画");
                    StartAnimationTimers();
                    return;
                }

                _player = new MediaPlayer();
                _player.Volume = 0.6;
                _player.MediaOpened += (s, e) =>
                {
                    Dispatcher.Invoke(() => StartAnimationTimers());
                };
                _player.MediaFailed += (s, e) =>
                {
                    Debug.WriteLine($"[Splash] MediaFailed: {e.ErrorException?.Message}");
                    Dispatcher.Invoke(() => StartAnimationTimers());
                };
                _player.Open(new Uri(path, UriKind.Absolute));
                _player.Play();

                // 3 秒兜底
                var fallback = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
                fallback.Tick += (s, e) =>
                {
                    fallback.Stop();
                    StartAnimationTimers();
                };
                fallback.Start();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Splash] 音效播放失败：{ex.Message}");
                StartAnimationTimers();
            }
        }

        private void StartAnimationTimers()
        {
            if (_animationStarted) return;
            _animationStarted = true;

            Debug.WriteLine("[Splash] StartAnimationTimers 被调用");

            var t1 = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(SoundToLogoDelayMs) };
            t1.Tick += (s, e) =>
            {
                t1.Stop();
                Debug.WriteLine($"[Splash] 触发 FadeIn, LogoImage.Opacity={LogoImage.Opacity}");
                var sb = (Storyboard)FindResource("FadeInStoryboard");
                sb.Begin(this);
                Debug.WriteLine($"[Splash] FadeIn.Begin 已调用");
            };
            t1.Start();

            var totalMs = SoundToLogoDelayMs + FadeInDurationMs + LogoHoldMs;
            var t2 = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(totalMs) };
            t2.Tick += (s, e) =>
            {
                t2.Stop();
                var sb = (Storyboard)FindResource("HideStoryboard");
                sb.Begin(this);
            };
            t2.Start();
        }
    }
}