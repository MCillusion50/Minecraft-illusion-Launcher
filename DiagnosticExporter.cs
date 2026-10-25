using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 一键导出诊断包。
    ///
    /// 打包内容：launcher_diagnose.log / launcher_args.log / latest.log / debug.log
    ///           + 全局配置 + 各版本 json + 环境信息（environment.txt）
    ///
    /// ⭐ 打包前统一脱敏：访问令牌、JWT、DPAPI 密文、API Key、URL 里的 key/token、
    ///    Windows 用户名路径，全部替换为 ***，避免用户把敏感信息发给别人。
    ///
    /// 设计原则：只新增文件，不改动任何现有逻辑；任何一步失败都只影响诊断包本身，不影响启动游戏。
    /// </summary>
    public sealed partial class MainWindow
    {
        // 脱敏规则（顺序有意义：先干掉整条 --accessToken，再处理裸 JWT / enc1: 密文）
        private static readonly Regex[] _diagSecretPatterns =
        {
            new Regex(@"(--accessToken\s+)\S+", RegexOptions.IgnoreCase),
            new Regex(@"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", RegexOptions.IgnoreCase),
            new Regex(@"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}"),
            new Regex(@"(enc1:)[A-Za-z0-9+/=]+"),
            new Regex(@"(""(?:refreshToken|mcAccessToken|curseForgeApiKey|accessToken|token|apiKey)""\s*:\s*"")[^""]*("")", RegexOptions.IgnoreCase),
            new Regex(@"([?&](?:key|token|access_token|api_key)=)[^&\s]+", RegexOptions.IgnoreCase),
        };

        private static string SanitizeDiagText(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
            foreach (var re in _diagSecretPatterns)
            {
                text = re.Replace(text, m =>
                {
                    if (m.Groups.Count >= 3) return m.Groups[1].Value + "***" + m.Groups[2].Value;
                    if (m.Groups.Count == 2) return m.Groups[1].Value + "***";
                    return "***";
                });
            }
            // Windows 用户名路径：C:\Users\张三\... → C:\Users\***\...
            text = Regex.Replace(text, @"([A-Za-z]:\\Users\\)[^\\\r\n""']+", "$1***");
            return text;
        }

        private static void WriteDiagEntry(ZipArchive zip, string entryName, string content)
        {
            try
            {
                var e = zip.CreateEntry(entryName, CompressionLevel.Optimal);
                using var s = e.Open();
                using var w = new StreamWriter(s, new UTF8Encoding(false));
                w.Write(SanitizeDiagText(content ?? ""));
            }
            catch { }
        }

        /// <summary>读取文件并写入 zip（日志被游戏占用时用共享读，不会失败）</summary>
        private static bool AddDiagFile(ZipArchive zip, string srcPath, string entryName)
        {
            try
            {
                if (!File.Exists(srcPath)) return false;
                string text;
                using (var fs = new FileStream(srcPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var sr = new StreamReader(fs, Encoding.UTF8, true))
                {
                    text = sr.ReadToEnd();
                }
                WriteDiagEntry(zip, entryName, text);
                return true;
            }
            catch { return false; }
        }

        private static string JsStr(string s) =>
            "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ") + "\"";

        /// <summary>环境信息文本（不含任何敏感内容）</summary>
        private string BuildDiagEnvReport(string mcDir)
        {
            var sb = new StringBuilder();
            sb.AppendLine("===== illusionLauncher 诊断环境 =====");
            sb.AppendLine("导出时间    : " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            sb.AppendLine("操作系统    : " + RuntimeInformation.OSDescription);
            sb.AppendLine("系统架构    : " + RuntimeInformation.OSArchitecture);
            sb.AppendLine("处理器线程  : " + Environment.ProcessorCount);
            try { sb.AppendLine("系统内存    : " + (GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / 1024 / 1024) + " MB"); } catch { }
            sb.AppendLine("运行库      : " + RuntimeInformation.FrameworkDescription);
            sb.AppendLine("游戏目录    : " + mcDir);
            sb.AppendLine("配置目录    : " + GetConfigDir());
            sb.AppendLine("内存分配    : " + (_global?.MaxMemoryMB ?? 0) + " MB");
            sb.AppendLine("JVM 参数    : " + (_global?.JvmArgs ?? ""));
            sb.AppendLine("游戏参数    : " + (_global?.GameArgs ?? ""));
            sb.AppendLine("全局 Java   : " + (string.IsNullOrEmpty(_global?.JavaPath) ? "(自动匹配)" : "(已手动指定)"));
            sb.AppendLine();

            sb.AppendLine("===== 本地 Java 运行时 =====");
            try
            {
                var jd = GetJavaDir();
                if (Directory.Exists(jd))
                {
                    foreach (var sub in Directory.GetDirectories(jd))
                        sb.AppendLine(" - " + Path.GetFileName(sub));
                }
                else sb.AppendLine(" (Java 目录不存在)");
            }
            catch (Exception ex) { sb.AppendLine(" (读取失败: " + ex.Message + ")"); }
            sb.AppendLine();

            sb.AppendLine("===== 已安装版本 =====");
            try
            {
                var verDir = Path.Combine(mcDir, "versions");
                if (Directory.Exists(verDir))
                {
                    foreach (var d in Directory.GetDirectories(verDir).OrderBy(x => x))
                        sb.AppendLine(" - " + Path.GetFileName(d));
                }
                else sb.AppendLine(" (versions 目录不存在)");
            }
            catch (Exception ex) { sb.AppendLine(" (读取失败: " + ex.Message + ")"); }

            return sb.ToString();
        }

        /// <summary>
        /// 导出诊断包到用户选择的位置。完成后回调前端 onDiagExported(ok, pathOrMessage)。
        /// </summary>
        public async Task ExportDiagnosticsAsync(CoreWebView2 sender)
        {
            string outPath = "";
            try
            {
                var dlg = new Microsoft.Win32.SaveFileDialog
                {
                    Title = "导出诊断包",
                    FileName = "illusionLauncher_diag_" + DateTime.Now.ToString("yyyyMMdd_HHmm") + ".zip",
                    Filter = "ZIP 压缩包 (*.zip)|*.zip",
                    DefaultExt = ".zip",
                    AddExtension = true,
                };
                await RunOnUI(() => { if (dlg.ShowDialog() == true) outPath = dlg.FileName; });

                if (string.IsNullOrEmpty(outPath))
                {
                    await RunOnUI(() => { try { _ = sender.ExecuteScriptAsync("onDiagExported(false,'已取消')"); } catch { } });
                    return;
                }

                var mcDir = GetMcDir();
                int n = 0;

                using (var zip = ZipFile.Open(outPath, ZipArchiveMode.Create))
                {
                    // 1) 日志
                    foreach (var p in new[]
                    {
                        Path.Combine(mcDir, "logs", "launcher_diagnose.log"),
                        Path.Combine(mcDir, "logs", "launcher_diagnose.prev.log"),
                        Path.Combine(mcDir, "logs", "launcher_args.log"),
                        Path.Combine(mcDir, "logs", "latest.log"),
                        Path.Combine(mcDir, "logs", "debug.log"),
                    })
                    {
                        if (AddDiagFile(zip, p, "logs/" + Path.GetFileName(p))) n++;
                    }

                    // 2) 全局配置（脱敏后）
                    var cfg = GetGlobalConfigPath();
                    if (AddDiagFile(zip, cfg, "config/global.json")) n++;

                    // 3) 各版本 json（体积小，能看出继承了哪个加载器）
                    var verDir = Path.Combine(mcDir, "versions");
                    if (Directory.Exists(verDir))
                    {
                        foreach (var d in Directory.GetDirectories(verDir))
                        {
                            var name = Path.GetFileName(d);
                            var vj = Path.Combine(d, name + ".json");
                            if (AddDiagFile(zip, vj, "versions/" + name + ".json")) n++;
                        }
                    }

                    // 4) 环境信息
                    WriteDiagEntry(zip, "environment.txt", BuildDiagEnvReport(mcDir));
                    n++;
                }

                long sizeKb = 0;
                try { sizeKb = new FileInfo(outPath).Length / 1024; } catch { }
                DiagnosticLogger.Instance.Info($"[Diag] 诊断包已导出：{n} 个条目 / {sizeKb} KB → {outPath}");

                await RunOnUI(() => { try { _ = sender.ExecuteScriptAsync("onDiagExported(true," + JsStr(outPath) + ")"); } catch { } });
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Error("[Diag] 导出失败：" + ex.Message);
                try
                {
                    await RunOnUI(() => { try { _ = sender.ExecuteScriptAsync("onDiagExported(false," + JsStr("导出失败：" + ex.Message) + ")"); } catch { } });
                }
                catch { }
            }
        }
    }
}
