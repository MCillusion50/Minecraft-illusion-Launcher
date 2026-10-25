using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 自更新引导器：带 --apply-update 参数的实例只做三件事
    /// 1) 等旧进程退出  2) 覆盖安装目录  3) 重新启动主程序
    /// 注意：本进程自己就是从安装目录启动的，exe 和已加载的 dll 会被锁定，
    ///       所以遇到占用时先把目标文件改名成 .old 让位，再写入新文件（下次启动清理 .old）。
    /// </summary>
    internal static class SelfUpdater
    {
        internal static void Run(string srcDir, string dstDir, int pid, string exeName)
        {
            MainWindow.UpdateLog($"=== updater start === src={srcDir} dst={dstDir} pid={pid} exe={exeName}");

            // 先杀掉可能残留的联机后端，否则它会锁着 EasyTier 目录下的文件导致覆盖失败
            MainWindow.KillEasyTierBackend();

            // 1. 等旧进程退出（最多 60 秒）
            try
            {
                var old = Process.GetProcessById(pid);
                if (!old.WaitForExit(60000))
                {
                    MainWindow.UpdateLog("old process did not exit in 60s, abort");
                    return;
                }
            }
            catch
            {
                // 旧进程已退出
            }

            Thread.Sleep(600);

            // 2. 覆盖文件
            int copied = 0, failed = 0;
            try
            {
                CopyDirectory(srcDir, dstDir, ref copied, ref failed);
            }
            catch (Exception ex)
            {
                MainWindow.UpdateLog("copy crashed: " + ex);
            }
            MainWindow.UpdateLog($"copy done: copied={copied} failed={failed}");

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
                    MainWindow.UpdateLog("restarted: " + exe);
                }
                else
                {
                    MainWindow.UpdateLog("restart skipped, exe missing: " + exe);
                }
            }
            catch (Exception ex)
            {
                MainWindow.UpdateLog("restart failed: " + ex);
            }

            // 4. 清理更新缓存（失败不影响使用）
            try
            {
                var root = Path.GetDirectoryName(srcDir);
                if (!string.IsNullOrEmpty(root) && Directory.Exists(root))
                    Directory.Delete(root, true);
            }
            catch (Exception ex)
            {
                MainWindow.UpdateLog("cleanup failed: " + ex.Message);
            }

            MainWindow.UpdateLog("=== updater end ===");
        }

        private static void CopyDirectory(string src, string dst, ref int copied, ref int failed)
        {
            if (!Directory.Exists(src))
            {
                MainWindow.UpdateLog("source dir missing: " + src);
                return;
            }

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

                var ok = false;
                for (var attempt = 0; attempt < 5; attempt++)
                {
                    try
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target) ?? dst);
                        File.Copy(file, target, true);
                        ok = true;
                        break;
                    }
                    catch (Exception ex)
                    {
                        // 第二轮仍失败，基本就是被占用：改名让位
                        if (attempt == 1)
                        {
                            try
                            {
                                var bak = target + ".old";
                                if (File.Exists(bak)) File.Delete(bak);
                                if (File.Exists(target)) File.Move(target, bak);
                                MainWindow.UpdateLog("renamed to .old: " + rel);
                            }
                            catch (Exception rex)
                            {
                                MainWindow.UpdateLog($"rename failed ({rel}): {rex.Message}");
                            }
                        }
                        else if (attempt == 4)
                        {
                            MainWindow.UpdateLog($"copy give up ({rel}): {ex.Message}");
                        }
                        Thread.Sleep(250);
                    }
                }

                if (ok) copied++; else failed++;
            }
        }
    }
}
