using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace IllusionLauncherWPF
{
    public sealed partial class MainWindow
    {
        /// <summary>GitHub 仓库全名（owner/repo）</summary>
        private const string UpdateRepo = "MCillusion50/Minecraft-illusion-Launcher";

        /// <summary>当前版本号，优先取 csproj 的 &lt;Version&gt;(InformationalVersion)，回退到程序集版本</summary>
        internal static string CurrentVersion
        {
            get
            {
                try
                {
                    var asm = Assembly.GetExecutingAssembly();
                    var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
                    if (!string.IsNullOrWhiteSpace(info))
                    {
                        var plus = info.IndexOf('+');
                        var v = (plus > 0 ? info.Substring(0, plus) : info).Trim();
                        if (v.Length > 0) return v;
                    }
                    var ver = asm.GetName().Version;
                    if (ver == null) return "0.0.0";
                    return $"{ver.Major}.{ver.Minor}.{(ver.Build < 0 ? 0 : ver.Build)}";
                }
                catch
                {
                    return "0.0.0";
                }
            }
        }

        /// <summary>查询 GitHub Release 最新版本，结果通过 onUpdateInfo(...) 回前端</summary>
        internal async Task CheckUpdateAsync(CoreWebView2 sender)
        {
            try
            {
                var current = CurrentVersion;
                string latest = "", htmlUrl = "", notes = "", assetName = "", assetUrl = "";
                long assetSize = 0;

                using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(25) })
                {
                    http.DefaultRequestHeaders.UserAgent.ParseAdd("IllusionLauncher/" + current);
                    http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

                    var url = $"https://api.github.com/repos/{UpdateRepo}/releases/latest";
                    var body = await http.GetStringAsync(url).ConfigureAwait(false);

                    using var doc = JsonDocument.Parse(body);
                    var root = doc.RootElement;

                    if (root.TryGetProperty("tag_name", out var tag) && tag.ValueKind == JsonValueKind.String)
                        latest = (tag.GetString() ?? "").Trim().TrimStart('v', 'V');
                    if (root.TryGetProperty("html_url", out var hu) && hu.ValueKind == JsonValueKind.String)
                        htmlUrl = hu.GetString() ?? "";
                    if (root.TryGetProperty("body", out var bd) && bd.ValueKind == JsonValueKind.String)
                        notes = Shorten(bd.GetString() ?? "", 900);

                    if (root.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var a in assets.EnumerateArray())
                        {
                            if (!a.TryGetProperty("name", out var n) || n.ValueKind != JsonValueKind.String) continue;
                            var name = n.GetString() ?? "";
                            if (!name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;

                            assetName = name;
                            if (a.TryGetProperty("browser_download_url", out var du) && du.ValueKind == JsonValueKind.String)
                                assetUrl = du.GetString() ?? "";
                            if (a.TryGetProperty("size", out var sz) && sz.TryGetInt64(out var sizeVal))
                                assetSize = sizeVal;
                            break;
                        }
                    }
                }

                var hasUpdate = CompareVersion(latest, current) > 0;
                await EvalAsync(sender, "onUpdateInfo(" + JsonSerializer.Serialize(new
                {
                    ok = true,
                    current,
                    latest,
                    hasUpdate,
                    htmlUrl,
                    notes,
                    assetName,
                    assetUrl,
                    assetSize
                }) + ");").ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                var notFound = ex is System.Net.Http.HttpRequestException hre &&
                               hre.StatusCode == System.Net.HttpStatusCode.NotFound;
                await EvalAsync(sender, "onUpdateInfo(" + JsonSerializer.Serialize(new
                {
                    ok = false,
                    noRelease = notFound,
                    current = CurrentVersion,
                    error = notFound ? "仓库尚未发布任何版本" : ex.Message
                }) + ");").ConfigureAwait(false);
            }
        }

        /// <summary>把版本号推给前端（关于页顶部显示），不再硬编码在 HTML 里</summary>
        internal Task SendAppVersionAsync(CoreWebView2 sender)
        {
            var version = CurrentVersion;
            var buildDate = "";
            try
            {
                var exe = Process.GetCurrentProcess().MainModule?.FileName;
                if (!string.IsNullOrEmpty(exe) && File.Exists(exe))
                    buildDate = File.GetLastWriteTime(exe).ToString("yyyy.MM.dd");
            }
            catch { }

            return EvalAsync(sender, "onAppVersion(" + JsonSerializer.Serialize(new
            {
                version,
                buildDate
            }) + ");");
        }

        /// <summary>自动更新：下载 → 大小/SHA256/ZIP 三重校验 → 解压 → 拉起自更新引导器 → 退出</summary>
        internal async Task ApplyUpdateAsync(CoreWebView2 sender, string assetUrl, string assetName, long expectedSize)
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                    "illusionLauncher", "update");
            try
            {
                if (Directory.Exists(root))
                {
                    try { Directory.Delete(root, true); } catch { }
                }
                Directory.CreateDirectory(root);

                var zipPath = Path.Combine(root, string.IsNullOrWhiteSpace(assetName) ? "update.zip" : assetName);

                // ---- 1. 下载（最多重试 3 次）----
                using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) })
                {
                    http.DefaultRequestHeaders.UserAgent.ParseAdd("IllusionLauncher/" + CurrentVersion);

                    Exception last = null;
                    for (var attempt = 0; attempt < 3; attempt++)
                    {
                        try
                        {
                            using var resp = await http.GetAsync(assetUrl, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                            resp.EnsureSuccessStatusCode();
                            var total = resp.Content.Headers.ContentLength ?? expectedSize;

                            using var src = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false);
                            using var dst = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None);
                            var buffer = new byte[81920];
                            long received = 0;
                            int read;
                            var lastTick = Environment.TickCount;
                            while ((read = await src.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0)
                            {
                                await dst.WriteAsync(buffer, 0, read).ConfigureAwait(false);
                                received += read;
                                if (Environment.TickCount - lastTick > 200)
                                {
                                    lastTick = Environment.TickCount;
                                    var pct = total > 0 ? (int)(received * 100 / total) : 0;
                                    await ReportProgressAsync(sender, "下载更新包", pct).ConfigureAwait(false);
                                }
                            }
                            last = null;
                            break;
                        }
                        catch (Exception ex)
                        {
                            last = ex;
                            await Task.Delay(1200).ConfigureAwait(false);
                        }
                    }
                    if (last != null) throw last;
                }

                // ---- 2. 大小校验 ----
                var fileLen = new FileInfo(zipPath).Length;
                if (expectedSize > 0 && fileLen != expectedSize)
                    throw new InvalidOperationException($"更新包大小不匹配（期望 {expectedSize}，实际 {fileLen}）");

                await ReportProgressAsync(sender, "校验更新包", 100).ConfigureAwait(false);

                // ---- 3. SHA256 校验（Release 里若有同名 .sha256 附件就强制比对）----
                var remoteSha = await TryFetchSha256Async(assetUrl).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(remoteSha))
                {
                    var localSha = ComputeSha256(zipPath);
                    if (!string.Equals(localSha, remoteSha, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("SHA256 校验失败，已中止更新");
                }

                // ---- 4. ZIP 完整性校验（逐条读一遍，触发 CRC 检查）----
                using (var zip = ZipFile.OpenRead(zipPath))
                {
                    if (zip.Entries.Count == 0) throw new InvalidOperationException("更新包是空的");
                    foreach (var entry in zip.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name)) continue;
                        using var s = entry.Open();
                        s.CopyTo(Stream.Null);
                    }
                }

                // ---- 5. 解压 ----
                await ReportProgressAsync(sender, "解压更新包", 100).ConfigureAwait(false);
                var filesDir = Path.Combine(root, "files");
                ZipFile.ExtractToDirectory(zipPath, filesDir);

                var entries = Directory.GetFileSystemEntries(filesDir);
                if (entries.Length == 1 && Directory.Exists(entries[0]))
                    filesDir = entries[0];

                // ---- 6. 关键文件校验 ----
                var installDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
                var exeName = Path.GetFileName(Process.GetCurrentProcess().MainModule?.FileName ?? "IllusionLauncherWPF.exe");
                if (!File.Exists(Path.Combine(filesDir, exeName)))
                    throw new InvalidOperationException($"更新包里找不到 {exeName}");
                if (!File.Exists(Path.Combine(filesDir, "wwwroot", "index.html")))
                    throw new InvalidOperationException("更新包里找不到 wwwroot\\index.html");

                // ---- 7. 拉起自更新引导器并退出 ----
                await ReportProgressAsync(sender, "准备重启", 100).ConfigureAwait(false);
                var pid = Process.GetCurrentProcess().Id;
                var psi = new ProcessStartInfo
                {
                    FileName = Path.Combine(installDir, exeName),
                    UseShellExecute = false,
                    WorkingDirectory = installDir
                };
                psi.ArgumentList.Add("--apply-update");
                psi.ArgumentList.Add(filesDir);
                psi.ArgumentList.Add(installDir);
                psi.ArgumentList.Add(pid.ToString());
                psi.ArgumentList.Add(exeName);
                Process.Start(psi);

                await Dispatcher.InvokeAsync(() => System.Windows.Application.Current.Shutdown());
            }
            catch (Exception ex)
            {
                await EvalAsync(sender, "onUpdateFailed(" + JsonSerializer.Serialize(new { error = ex.Message }) + ");").ConfigureAwait(false);
                try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
            }
        }

        private Task ReportProgressAsync(CoreWebView2 sender, string phase, int percent)
        {
            return EvalAsync(sender, "onUpdateProgress(" + JsonSerializer.Serialize(new { phase, percent }) + ");");
        }

        private static async Task<string> TryFetchSha256Async(string assetUrl)
        {
            try
            {
                if (string.IsNullOrEmpty(assetUrl)) return null;
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                http.DefaultRequestHeaders.UserAgent.ParseAdd("IllusionLauncher/" + CurrentVersion);
                var text = await http.GetStringAsync(assetUrl + ".sha256").ConfigureAwait(false);
                var m = System.Text.RegularExpressions.Regex.Match(text ?? "", "[0-9a-fA-F]{64}");
                return m.Success ? m.Value : null;
            }
            catch { return null; }
        }

        private static string ComputeSha256(string path)
        {
            using var sha = SHA256.Create();
            using var fs = File.OpenRead(path);
            return Convert.ToHexString(sha.ComputeHash(fs)).ToLowerInvariant();
        }

        /// <summary>在 UI 线程执行 JS（CoreWebView2 要求）</summary>
        private Task EvalAsync(CoreWebView2 sender, string js)
        {
            if (sender == null) return Task.CompletedTask;
            var tcs = new TaskCompletionSource<bool>();
            Dispatcher.InvokeAsync(async () =>
            {
                try { await sender.ExecuteScriptAsync(js); }
                catch { }
                tcs.TrySetResult(true);
            });
            return tcs.Task;
        }

        /// <summary>逐段比较版本号：a &gt; b 返回正数</summary>
        private static int CompareVersion(string a, string b)
        {
            var pa = (a ?? "").Split('.');
            var pb = (b ?? "").Split('.');
            var n = Math.Max(pa.Length, pb.Length);
            for (var i = 0; i < n; i++)
            {
                var x = i < pa.Length && int.TryParse(pa[i], out var xv) ? xv : 0;
                var y = i < pb.Length && int.TryParse(pb[i], out var yv) ? yv : 0;
                if (x != y) return x.CompareTo(y);
            }
            return 0;
        }

        /// <summary>把更新说明压成短字符串，避免把整个 Markdown 塞给前端</summary>
        private static string Shorten(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "";
            s = s.Replace("\r\n", "\n").Replace("\r", "\n").Trim();
            return s.Length <= max ? s : s.Substring(0, max) + "…";
        }
    }
}
