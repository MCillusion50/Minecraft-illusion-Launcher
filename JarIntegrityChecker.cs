using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using System.Diagnostics;

namespace IllusionLauncherWPF
{
    public class JarIntegrityChecker
    {
        // 定义一个下载委托，这样不需要把 MainWindow 的下载方法全盘搬过来
        public delegate Task DownloadDelegate(string url, string savePath);

        /// <summary>
        /// 检查并修复缺失的关键依赖库
        /// </summary>
        /// <param name="mcDir">游戏根目录</param>
        /// <param name="versionId">当前启动的版本号</param>
        /// <param name="downloadFunc">你主程序里的 DownloadFileAsync</param>
        /// <returns>修复的数量</returns>
        public static async Task<int> CheckAndRepairAsync(string mcDir, string versionId, DownloadDelegate downloadFunc)
        {
            int repairedCount = 0;
            var libsDir = Path.Combine(mcDir, "libraries");

            // =========================================================
            // 1. 老版本 Forge 必备：launchwrapper
            // =========================================================
            if (versionId.Contains("1.7.10") || versionId.Contains("1.12.2") || versionId.Contains("forge"))
            {
                var lwPath = Path.Combine(libsDir, "net", "minecraft", "launchwrapper", "1.12", "launchwrapper-1.12.jar");
                if (!File.Exists(lwPath) || new FileInfo(lwPath).Length < 1000) // 小于 1KB 视为损坏
                {
                    Debug.WriteLine($"[JarCheck] 缺少 launchwrapper，正在修复...");
                    Directory.CreateDirectory(Path.GetDirectoryName(lwPath)!);
                    try
                    {
                        await downloadFunc("https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar", lwPath);
                        repairedCount++;
                    }
                    catch
                    {
                        try { await downloadFunc("https://bmclapi2.bangbang93.com/maven/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar", lwPath); if (IsValidJar(lwPath)) repairedCount++; else Debug.WriteLine("[JarCheck] launchwrapper 修复失败（文件无效）"); } catch { }
                    }
                }
            }

            // =========================================================
            // 2. 老版本 Forge 核心 Universal Jar & ASM 依赖
            // =========================================================
            if (versionId.Contains("-forge-") && versionId.StartsWith("1."))
            {
                var parts = versionId.Split(new[] { "-forge-" }, StringSplitOptions.None);
                if (parts.Length >= 2)
                {
                    var mcVer = parts[0];
                    var forgeVer = parts[1];
                    var fullVer = $"{mcVer}-{forgeVer}";

                    // --- 2.1 修复 Forge 核心 ---
                    var forgePath = Path.Combine(libsDir, "net", "minecraftforge", "forge", fullVer, $"forge-{fullVer}-universal.jar");
                    if (!File.Exists(forgePath) || new FileInfo(forgePath).Length < 1024 * 500)
                    {
                        Debug.WriteLine($"[JarCheck] 缺失老版 Forge 核心，正在修复...");
                        Directory.CreateDirectory(Path.GetDirectoryName(forgePath)!);

                        var forgeUrls = new[]
                        {
                            $"https://maven.minecraftforge.net/net/minecraftforge/forge/{fullVer}/forge-{fullVer}-universal.jar",
                            $"https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/{fullVer}/forge-{fullVer}-universal.jar"
                        };

                        foreach (var url in forgeUrls)
                        {
                            try
                            {
                                await downloadFunc(url, forgePath);
                                repairedCount++;
                                Debug.WriteLine($"[JarCheck] ✅ Forge 核心修复成功");
                                break;
                            }
                            catch { Debug.WriteLine($"[JarCheck] ⚠️ Forge 核心下载失败，尝试下一个源..."); }
                        }
                    }

                    // --- 2.2 修复老版本专属依赖库 (ASM + LZMA) ---
                    var legacyLibs = new Dictionary<string, string>
                    {
                        // 之前的 ASM
                        { "org/ow2/asm/asm-all/5.0.3/asm-all-5.0.3.jar", "https://libraries.minecraft.net/org/ow2/asm/asm-all/5.0.3/asm-all-5.0.3.jar" },
                        { "org/ow2/asm/asm-debug-all/5.0.3/asm-debug-all-5.0.3.jar", "https://libraries.minecraft.net/org/ow2/asm/asm-debug-all/5.0.3/asm-debug-all-5.0.3.jar" },
                        
                        // ⭐ 新增：LZMA 解压库 (解决当前报错)
                        { "lzma/lzma/0.0.1/lzma-0.0.1.jar", "https://libraries.minecraft.net/lzma/lzma/0.0.1/lzma-0.0.1.jar" },
                        { "org/tukaani/xz/1.5/xz-1.5.jar", "https://libraries.minecraft.net/org/tukaani/xz/1.5/xz-1.5.jar" }
                    };

                    foreach (var lib in legacyLibs)
                    {
                        var libPath = Path.Combine(libsDir, lib.Key.Replace('/', Path.DirectorySeparatorChar));
                        if (!File.Exists(libPath) || new FileInfo(libPath).Length < 1024)
                        {
                            Debug.WriteLine($"[JarCheck] 缺失老版依赖 {lib.Key}，正在修复...");
                            Directory.CreateDirectory(Path.GetDirectoryName(libPath)!);
                            // 修复：下载后必须校验文件真的落地且大小合理，否则不能计入「已修复」
                            bool _ok = false;
                            try { await downloadFunc(lib.Value, libPath); _ok = IsValidJar(libPath); }
                            catch { }
                            if (!_ok)
                            {
                                try
                                {
                                    var bmclUrl = lib.Value.Replace("libraries.minecraft.net", "bmclapi2.bangbang93.com/maven");
                                    await downloadFunc(bmclUrl, libPath);
                                    _ok = IsValidJar(libPath);
                                }
                                catch { }
                            }
                            if (_ok) repairedCount++;
                            else Debug.WriteLine($"[JarCheck] 修复失败 {lib.Key}（所有源均不可用或内容异常）");
                        }
                    }// 补 ASM 依赖
                }
            }

            // =========================================================
            // 3. NeoForge 核心
            // =========================================================
            if (versionId.Contains("-neoforge-"))
            {
                var parts = versionId.Split(new[] { "-neoforge-" }, StringSplitOptions.None);
                if (parts.Length == 2)
                {
                    var nfVer = parts[1];
                    var artifact = parts[0] == "1.20.1" ? "forge" : "neoforge";
                    var nfPath = Path.Combine(libsDir, "net", "neoforged", artifact, nfVer, $"{artifact}-{nfVer}-universal.jar");

                    if (!File.Exists(nfPath) || new FileInfo(nfPath).Length < 1024 * 100)
                    {
                        Debug.WriteLine($"[JarCheck] 缺少 NeoForge 核心，正在修复...");
                        Directory.CreateDirectory(Path.GetDirectoryName(nfPath)!);
                        var url = $"https://bmclapi2.bangbang93.com/maven/net/neoforged/{artifact}/{nfVer}/{artifact}-{nfVer}-universal.jar";
                        try { await downloadFunc(url, nfPath); if (IsValidJar(nfPath)) repairedCount++; else Debug.WriteLine($"[JarCheck] NeoForge 修复失败（文件未落地）: {url}"); } catch (Exception _ex) { Debug.WriteLine($"[JarCheck] NeoForge 修复失败: {_ex.Message}"); }
                    }
                }
            }

            return repairedCount;
        }

        /// <summary>
        /// 判断文件是否是有效的 jar/zip：检查 ZIP 魔法头 PK\x03\x04。
        /// 比"大小 > 1KB"可靠 —— 下载到 HTML 404 页面会被正确识别为无效。
        /// </summary>
        private static bool IsValidJar(string path)
        {
            try
            {
                if (!File.Exists(path)) return false;
                if (new FileInfo(path).Length < 1024) return false;
                using var fs = File.OpenRead(path);
                var b = new byte[4];
                if (fs.Read(b, 0, 4) < 4) return false;
                return b[0] == 0x50 && b[1] == 0x4B;
            }
            catch { return false; }
        }
    }
}