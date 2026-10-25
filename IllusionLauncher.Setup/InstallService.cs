using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using Microsoft.Win32;

namespace IllusionLauncher.Setup
{
    /// <summary>安装/卸载的系统级操作（依赖检测、解压、快捷方式、注册表）</summary>
    internal static class InstallService
    {
        /// <summary>是否已内嵌安装载荷（VS 调试时通常没有，走演示流程）</summary>
        internal static bool HasPayload
        {
            get
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                    return s != null;
            }
        }

        internal const string AppExeName = "IllusionLauncherWPF.exe";
        internal const string UninstallerName = "unins.exe";
        internal const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\IllusionLauncher";
        internal const string NetRuntimeUrl = "https://aka.ms/dotnet/10.0/windowsdesktop-runtime-win-x64.exe";
        internal const string WebView2Url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

        // ---------- 依赖检测 ----------
        internal static bool IsDotNet10DesktopInstalled()
        {
            try
            {
                using (var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                           .OpenSubKey(@"SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App"))
                {
                    if (key == null) return false;
                    foreach (var name in key.GetValueNames())
                        if (name.StartsWith("10.", StringComparison.Ordinal)) return true;
                }
            }
            catch { }
            return false;
        }

        internal static bool IsWebView2Installed()
        {
            var paths = new[]
            {
                (RegistryHive.LocalMachine, RegistryView.Registry64, @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
                (RegistryHive.LocalMachine, RegistryView.Registry32, @"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
                (RegistryHive.CurrentUser, RegistryView.Default, @"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")
            };
            foreach (var (hive, view, sub) in paths)
            {
                try
                {
                    using (var key = RegistryKey.OpenBaseKey(hive, view).OpenSubKey(sub))
                        if (key != null) return true;
                }
                catch { }
            }
            return false;
        }

        /// <summary>下载并静默安装一个运行时</summary>
        internal static void InstallPrereq(string url, string fileName, string arguments, Action<string> status)
        {
            var target = Path.Combine(Path.GetTempPath(), fileName);
            status?.Invoke("正在下载运行库…");
            using (var wc = new WebClient())
            {
                wc.DownloadProgressChanged += (s, e) => status?.Invoke($"正在下载运行库… {e.ProgressPercentage}%");
                wc.DownloadFileCompleted += (s, e) => { };
                var task = wc.DownloadFileTaskAsync(new Uri(url), target);
                while (!task.Wait(200)) { }
                task.GetAwaiter().GetResult();
            }

            status?.Invoke("正在安装运行库…（可能需要 1-2 分钟）");
            var psi = new ProcessStartInfo
            {
                FileName = target,
                Arguments = arguments,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var proc = Process.Start(psi))
            {
                proc.WaitForExit();
            }
            try { File.Delete(target); } catch { }
        }

        // ---------- 载荷解压 ----------
        internal static void ExtractPayload(string destDir, IProgress<double> progress)
        {
            var asm = Assembly.GetExecutingAssembly();
            var stream = asm.GetManifestResourceStream("payload.zip");
            if (stream == null) throw new InvalidOperationException("安装包内缺少程序文件（payload.zip），请重新下载安装程序");

            Directory.CreateDirectory(destDir);
            using (stream)
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                var total = zip.Entries.Count;
                var done = 0;
                foreach (var entry in zip.Entries)
                {
                    var target = Path.Combine(destDir, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(target);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                    }
                    done++;
                    progress?.Report(total == 0 ? 100 : done * 100.0 / total);
                }
            }
        }

        // ---------- 快捷方式 ----------
        internal static void CreateShortcut(string lnkPath, string exePath, string workDir)
        {
            try
            {
                var dir = Path.GetDirectoryName(lnkPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

                var shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(lnkPath);
                shortcut.TargetPath = exePath;
                shortcut.WorkingDirectory = workDir;
                shortcut.IconLocation = exePath + ",0";
                shortcut.Description = "Illusion Launcher";
                shortcut.Save();
            }
            catch { }
        }

        internal static string DesktopLnk { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Illusion Launcher.lnk"); } }
        internal static string StartMenuLnk { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Illusion Launcher.lnk"); } }

        // ---------- 卸载信息 ----------
        internal static void WriteUninstallKey(string installDir, string version, string uninstallerPath)
        {
            try
            {
                using (var key = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                           .CreateSubKey(UninstallKey))
                {
                    key.SetValue("DisplayName", "Illusion Launcher");
                    key.SetValue("DisplayVersion", version);
                    key.SetValue("Publisher", "MCillusion50");
                    key.SetValue("DisplayIcon", Path.Combine(installDir, AppExeName));
                    key.SetValue("InstallLocation", installDir);
                    key.SetValue("UninstallString", "\"" + uninstallerPath + "\" --uninstall");
                    key.SetValue("QuietUninstallString", "\"" + uninstallerPath + "\" --uninstall /quiet");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
            }
            catch { }
        }

        internal static void RemoveUninstallKey()
        {
            try
            {
                RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                    .DeleteSubKeyTree(UninstallKey, false);
            }
            catch { }
        }

        /// <summary>结束正在运行的启动器，避免文件占用</summary>
        internal static void KillLauncher()
        {
            try
            {
                foreach (var name in new[] { "IllusionLauncherWPF", "easytier-core" })
                {
                    foreach (var p in Process.GetProcessesByName(name))
                    {
                        try { p.Kill(); p.WaitForExit(3000); } catch { }
                    }
                }
            }
            catch { }
        }

        /// <summary>卸载：删快捷方式、注册表、目录，最后删除自身</summary>
        internal static void Uninstall(string installDir)
        {
            KillLauncher();

            try { if (File.Exists(DesktopLnk)) File.Delete(DesktopLnk); } catch { }
            try { if (File.Exists(StartMenuLnk)) File.Delete(StartMenuLnk); } catch { }
            RemoveUninstallKey();

            // 用 cmd 延迟删除自身所在目录
            var bat = Path.Combine(Path.GetTempPath(), "il_uninstall_" + Guid.NewGuid().ToString("N") + ".bat");
            var lines = new[]
            {
                "@echo off",
                "ping -n 3 127.0.0.1 >nul",
                "rd /s /q \"" + installDir + "\"",
                "del \"%~f0\""
            };
            File.WriteAllLines(bat, lines, System.Text.Encoding.Default);

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = bat,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    UseShellExecute = true
                });
            }
            catch { }
        }
    }
}
