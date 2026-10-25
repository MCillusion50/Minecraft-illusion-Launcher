using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 自更新引导器：带 --apply-update 参数启动的实例只做三件事
    /// 1) 等旧进程退出  2) 覆盖安装目录  3) 重新启动主程序
    /// </summary>
    internal static class SelfUpdater
    {
        internal static void Run(string srcDir, string dstDir, int pid, string exeName)
        {
            // 1. 等旧进程退出（最多 60 秒，避免死等）
            try
            {
                var old = Process.GetProcessById(pid);
                if (!old.WaitForExit(60000)) return;
            }
            catch
            {
                // 进程已退出
            }

            // 给文件句柄一点释放时间
            Thread.Sleep(600);

            // 2. 覆盖文件
            CopyDirectory(srcDir, dstDir);

            // 3. 重新启动主程序
            try
            {
                var exe = Path.Combine(dstDir, exeName);
                if (File.Exists(exe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exe,
                        WorkingDirectory = dstDir,
                        UseShellExecute = true
                    });
                }
            }
            catch { }

            // 4. 清理更新缓存（失败不影响使用）
            try
            {
                var root = Path.GetDirectoryName(srcDir);
                if (!string.IsNullOrEmpty(root) && Directory.Exists(root))
                    Directory.Delete(root, true);
            }
            catch { }
        }

        private static void CopyDirectory(string src, string dst)
        {
            if (!Directory.Exists(src)) return;
            Directory.CreateDirectory(dst);

            foreach (var dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
            {
                var rel = dir.Substring(src.Length).TrimStart(Path.DirectorySeparatorChar);
                Directory.CreateDirectory(Path.Combine(dst, rel));
            }

            foreach (var file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                var rel = file.Substring(src.Length).TrimStart(Path.DirectorySeparatorChar);
                var target = Path.Combine(dst, rel);

                for (var attempt = 0; attempt < 5; attempt++)
                {
                    try
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target) ?? dst);
                        File.Copy(file, target, true);
                        break;
                    }
                    catch
                    {
                        Thread.Sleep(300);
                    }
                }
            }
        }
    }
}
