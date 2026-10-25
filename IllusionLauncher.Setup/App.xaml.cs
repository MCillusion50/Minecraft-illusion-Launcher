using System;
using System.Linq;
using System.Windows;

namespace IllusionLauncher.Setup
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            // 控制面板里的卸载项会调用 unins.exe --uninstall
            if (e.Args.Any(a => string.Equals(a, "--uninstall", StringComparison.OrdinalIgnoreCase)))
            {
                StartupUri = null;   // 不要再拉起安装界面
                base.OnStartup(e);
                var silent = e.Args.Any(a => string.Equals(a, "/quiet", StringComparison.OrdinalIgnoreCase));
                RunUninstall(silent);
                Shutdown();
                return;
            }

            base.OnStartup(e);
        }

        private static void RunUninstall(bool silent)
        {
            var installDir = System.IO.Path.GetDirectoryName(typeof(App).Assembly.Location) ?? string.Empty;

            if (!silent)
            {
                var answer = MessageBox.Show(
                    "将从本机移除 illusion Launcher：\n\n" + installDir +
                    "\n\n桌面 / 开始菜单快捷方式，以及控制面板里的卸载项会一并删除。\n" +
                    "如果安装目录里你自己放过文件（比如手动下载的 EasyTier 包），请先挪走。\n\n确定继续吗？",
                    "卸载 illusion Launcher",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Warning);

                if (answer != MessageBoxResult.Yes) return;
            }

            try
            {
                InstallService.Uninstall(installDir);
                if (!silent)
                    MessageBox.Show("卸载完成。", "illusion Launcher",
                        MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                if (!silent)
                    MessageBox.Show("卸载时出错：" + ex.Message, "卸载失败",
                        MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }
}
