using System.Net.Http;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 版本完整性检查 + 自动补全（新实现，不改动旧的 EnsureLibrariesAsync）。
    ///
    /// 设计目标：
    ///   1. 一次算出「这个版本需要的全部文件」——libraries / natives / 客户端 jar
    ///   2. 缺失或损坏（长度不符、sha1 不符）的，自动从多个源补
    ///   3. 每个文件独立选择源，失败自动换下一个，全失败才计入 failed
    ///
    /// 只新增文件，不修改 MainWindow 现有任何方法。
    /// </summary>
    public sealed partial class MainWindow
    {
        private sealed class WantFile
        {
            public string Full;   // 绝对路径
            public string Rel;    // maven 相对路径（candidates 拼接用）
            public string Url;    // json 里给的官方地址
            public string Sha1;
            public long Size;
            public string Kind;   // library / native / client
        }

        private sealed class RepairResult
        {
            public int Total;
            public int AlreadyOk;
            public int Fixed;
            public int Failed;
            public readonly List<string> FailedItems = new List<string>();
        }

        // 镜像优先级：先国内，再官方
        private static readonly string[] _mavenMirrors = new[]
        {
            // 国内镜像优先（速度快，但覆盖不全）
            "https://bmclapi2.bangbang93.com/maven",
            "https://maven.aliyun.com/repository/public",
            "https://repo.huaweicloud.com/repository/maven",
            "https://mirrors.cloud.tencent.com/nexus/repository/maven-public",
            "https://mirror.nju.edu.cn/maven",
            "https://mirrors.ustc.edu.cn/maven",
            // Forge 官方 maven（1.13~1.20 的 Forge 库只在它上面有正确版本）
            "https://maven.minecraftforge.net",
            // Mojang 官方（绝大多数 libraries 的最终来源）
            "https://libraries.minecraft.net",
        };

        /// <summary>
        /// 判断文件是否就位。长度必须完全匹配（json 给了 size 时）；
        /// 小文件额外校验 sha1（官方存在 22 字节空壳 jar 这种特例）。
        /// </summary>
        private static bool WantFileOk(WantFile w)
        {
            try
            {
                if (!File.Exists(w.Full)) return false;
                var len = new FileInfo(w.Full).Length;
                if (len <= 0) return false;
                if (w.Size > 0 && len != w.Size) return false;
                // 体积太小（可能是错误页/半截文件）时用 sha1 确认
                if (len <= 200 && !string.IsNullOrEmpty(w.Sha1))
                    return VerifySha1Static(w.Full, w.Sha1);
                return true;
            }
            catch { return false; }
        }

        private static bool VerifySha1Static(string path, string expected)
        {
            try
            {
                using var sha = System.Security.Cryptography.SHA1.Create();
                using var fs = File.OpenRead(path);
                var actual = BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
                return string.Equals(actual, expected.ToLowerInvariant(), StringComparison.Ordinal);
            }
            catch { return false; }
        }

        /// <summary>
        /// 沿 inheritsFrom 收集这个版本需要的全部文件。
        /// 只处理 windows-native、客户端 jar、普通库；assets 不在此列（另行处理）。
        /// </summary>
        private List<WantFile> CollectWantedFiles(string versionId, string mcDir)
        {
            var list = new List<WantFile>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var libDir = Path.Combine(mcDir, "libraries");

            string cur = versionId;
            int depth = 0;
            while (!string.IsNullOrEmpty(cur) && depth++ < 6)
            {
                var jp = Path.Combine(mcDir, "versions", cur, cur + ".json");
                if (!File.Exists(jp)) break;

                JsonDocument doc;
                try { doc = JsonDocument.Parse(File.ReadAllText(jp)); }
                catch { break; }

                using (doc)
                {
                    var root = doc.RootElement;

                    if (root.TryGetProperty("libraries", out var libs) && libs.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var lib in libs.EnumerateArray())
                        {
                            if (!lib.TryGetProperty("downloads", out var dl) || dl.ValueKind != JsonValueKind.Object) continue;

                            if (dl.TryGetProperty("artifact", out var art) && art.ValueKind == JsonValueKind.Object)
                                AddWant(list, seen, libDir, art, "library");

                            if (dl.TryGetProperty("classifiers", out var cls) && cls.ValueKind == JsonValueKind.Object)
                            {
                                foreach (var kv in cls.EnumerateObject())
                                {
                                    // 只取 windows 原生包
                                    if (kv.Name.IndexOf("windows", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                    AddWant(list, seen, libDir, kv.Value, "native");
                                }
                            }
                        }
                    }

                    // 客户端 jar
                    if (root.TryGetProperty("downloads", out var jdl)
                        && jdl.ValueKind == JsonValueKind.Object
                        && jdl.TryGetProperty("client", out var cli)
                        && cli.ValueKind == JsonValueKind.Object)
                    {
                        var jarPath = Path.Combine(mcDir, "versions", cur, cur + ".jar");
                        if (seen.Add(jarPath))
                        {
                            list.Add(new WantFile
                            {
                                Full = jarPath,
                                Rel = null,
                                Url = cli.TryGetProperty("url", out var u1) ? u1.GetString() : null,
                                Sha1 = cli.TryGetProperty("sha1", out var s1) ? s1.GetString() : null,
                                Size = cli.TryGetProperty("size", out var z1) ? z1.GetInt64() : 0,
                                Kind = "client"
                            });
                        }
                    }

                    cur = root.TryGetProperty("inheritsFrom", out var inh) ? inh.GetString() : null;
                }
            }

            return list;
        }

        /// <summary>
        /// Forge 1.14.x / 1.15.x 的 forge-xxx.jar 是 installer 本地跑 processors 生成的「薄包」
        /// （只有 META-INF/services 服务注册，约 172KB）；maven 同路径放的是 universal 本体（约 2.2MB），
        /// size 永远对不上 → 补全判损坏 → 下载覆盖 → 把正确文件换成 universal → 版本彻底跑不起来。
        /// 所以这两个世代的 forge 薄包不参与补全；1.16.5+ 的 maven 文件是正确的，保持原行为。
        /// </summary>
        private static bool IsForgeInstallerOnlyArtifact(string rel)
        {
            if (string.IsNullOrEmpty(rel)) return false;
            var p = rel.Replace('\\', '/').ToLowerInvariant();
            if (!p.StartsWith("net/minecraftforge/forge/")) return false;
            if (!(p.StartsWith("net/minecraftforge/forge/1.14") || p.StartsWith("net/minecraftforge/forge/1.15"))) return false;
            var fn = p.Substring(p.LastIndexOf('/') + 1);
            if (fn.Contains("-universal") || fn.Contains("-installer") || fn.Contains("-client")) return false;
            return fn.EndsWith(".jar");
        }

        private static void AddWant(List<WantFile> list, HashSet<string> seen, string libDir, JsonElement art, string kind)
        {
            try
            {
                var rel = art.TryGetProperty("path", out var p) ? p.GetString() : null;
                if (string.IsNullOrEmpty(rel)) return;
                // ⭐ installer 产物免疫：否则补全会把正确文件覆盖成 maven 上的错误版本
                if (IsForgeInstallerOnlyArtifact(rel)) return;

                var full = Path.Combine(libDir, rel.Replace('/', Path.DirectorySeparatorChar));
                if (!seen.Add(full)) return;

                list.Add(new WantFile
                {
                    Full = full,
                    Rel = rel,
                    Url = art.TryGetProperty("url", out var u) ? u.GetString() : null,
                    Sha1 = art.TryGetProperty("sha1", out var s) ? s.GetString() : null,
                    Size = art.TryGetProperty("size", out var z) ? z.GetInt64() : 0,
                    Kind = kind
                });
            }
            catch { }
        }

        /// <summary>
        /// 尝试从多源下载单个文件，成功返回 true。
        /// 每换一个源都会清掉半截文件，避免 sha1 校验反复失败。
        /// </summary>
        // 源健康度：连续失败 3 次进入 10 分钟冷却，到期后自动重新参与（"轮流测试正常的源"）
        private static readonly Dictionary<string, int> _mirrorFailStreak = new(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<string, DateTime> _mirrorCooldownUntil = new(StringComparer.OrdinalIgnoreCase);

        private static IEnumerable<string> OrderedMirrors()
        {
            var now = DateTime.UtcNow;
            return _mavenMirrors
                .Where(u => !_mirrorCooldownUntil.TryGetValue(u, out var until) || until <= now)
                .OrderBy(u => _mirrorFailStreak.TryGetValue(u, out var f) ? f : 0)
                .ToList();
        }

        private static void NoteMirror(string baseUrl, bool ok)
        {
            if (string.IsNullOrEmpty(baseUrl)) return;
            if (ok)
            {
                _mirrorFailStreak[baseUrl] = 0;
                _mirrorCooldownUntil.Remove(baseUrl);
                return;
            }
            _mirrorFailStreak.TryGetValue(baseUrl, out var f);
            f++;
            _mirrorFailStreak[baseUrl] = f;
            if (f == 3)
            {
                _mirrorCooldownUntil[baseUrl] = DateTime.UtcNow.AddMinutes(10);
                DiagnosticLogger.Instance.Info($"[Repair] 源连续失败，冷却 10 分钟：{baseUrl}");
            }
        }

        /// <summary>
        /// 并发探测所有源，返回「可用且按响应速度排序」的源列表。
        /// 用 Range 请求只要 1KB，测速快、不浪费流量。
        /// </summary>
        private async Task<List<string>> ProbeMirrorsAsync(string rel, Action<string> log)
        {
            var cands = OrderedMirrors().ToList();
            if (string.IsNullOrEmpty(rel) || cands.Count == 0) return cands;

            var tasks = cands.Select(async b =>
            {
                var url = b.TrimEnd(new[] { '/' }) + "/" + rel.TrimStart(new[] { '/' });
                var sw = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 1023);
                    using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                    sw.Stop();
                    if (resp.IsSuccessStatusCode || (int)resp.StatusCode == 206)
                        return (url: b, ms: sw.ElapsedMilliseconds, ok: true);
                }
                catch { }
                return (url: b, ms: long.MaxValue, ok: false);
            });

            var results = await Task.WhenAll(tasks);
            var good = results.Where(r => r.ok).OrderBy(r => r.ms).Select(r => r.url).ToList();
            if (good.Count > 0)
                log?.Invoke($"[Repair] 并发探测 {cands.Count} 个源，可用 {good.Count} 个，最快：{new Uri(good[0]).Host}");
            else
                log?.Invoke($"[Repair] 并发探测 {cands.Count} 个源，全部不可用");
            return good;
        }

        private async Task<bool> TryFetchFileAsync(WantFile w, Action<string> log)
        {
                List<string> _fastMirrors = new List<string>();
            // 1) 镜像源：按健康度排序（好的优先，冷却中的跳过）
            if (!string.IsNullOrEmpty(w.Rel))
            {
                // ⭐ 先并发探测各源速度，快源优先（避免串行等待慢源超时）
                _fastMirrors = await ProbeMirrorsAsync(w.Rel, log);
                foreach (var b in _fastMirrors)
                {
                var url = b.TrimEnd(new[] { '/' }) + "/" + w.Rel.TrimStart(new[] { '/' });
                    try
                    {
                        await DownloadFileAsync(url, url, w.Full, null, string.IsNullOrEmpty(w.Sha1) ? null : w.Sha1);
                        if (WantFileOk(w)) { NoteMirror(b, true); return true; }
                        NoteMirror(b, false);
                        try { if (File.Exists(w.Full)) File.Delete(w.Full); } catch { }
                    }
                    catch
                    {
                        NoteMirror(b, false);
                        try { if (File.Exists(w.Full)) File.Delete(w.Full); } catch { }
                    }
                }
            }

        // 1.5) 降级：上面的严格校验全失败时，再试一遍「不校验 SHA1」
        //      json 里记录的 SHA1 可能已过期（Forge 的 maven 文件会被重建），
        //      此时严格校验会让 8 个源全部误判，反而拿不到本来可用的文件。
        if (!string.IsNullOrEmpty(w.Rel))
        {
            foreach (var b in _fastMirrors.Take(3))
            {
                var url = b.TrimEnd(new[] { '/' }) + "/" + w.Rel.TrimStart(new[] { '/' });
                try
                {
                    await DownloadFileAsync(url, url, w.Full, null, null);
                    if (File.Exists(w.Full) && new FileInfo(w.Full).Length > 1024)
                    {
                        log?.Invoke($"[Repair] ⚠ {Path.GetFileName(w.Full)} SHA1 与 json 记录不符，但已获取（json 可能过期）");
                        return true;
                    }
                }
                catch { }
                try { if (File.Exists(w.Full)) File.Delete(w.Full); } catch { }
            }
        }

            // 2) 最后用 json 里给的官方地址
            if (!string.IsNullOrEmpty(w.Url))
            {
                try
                {
                    await DownloadFileAsync(w.Url, w.Url, w.Full, null, string.IsNullOrEmpty(w.Sha1) ? null : w.Sha1);
                    if (WantFileOk(w)) return true;
                    try { if (File.Exists(w.Full)) File.Delete(w.Full); } catch { }
                }
                catch { }
            }

            log?.Invoke($"[Repair] ✘ 无法获取 {w.Kind}: {Path.GetFileName(w.Full)}");
            return false;
        }

        /// <summary>
        /// 完整检查 + 自动补全。返回统计结果；不抛异常。
        /// </summary>
        private async Task<RepairResult> RepairVersionAsync(string versionId, string mcDir, Action<string> log = null)
        {
            var result = new RepairResult();
            try
            {
                var wants = CollectWantedFiles(versionId, mcDir);
                result.Total = wants.Count;
                if (result.Total == 0)
                {
                    log?.Invoke($"[Repair] {versionId}: 未能解析到任何期望文件（json 可能损坏）");
                    return result;
                }

                var missing = new List<WantFile>();
                foreach (var w in wants)
                {
                    if (WantFileOk(w)) result.AlreadyOk++;
                    else missing.Add(w);
                }

                log?.Invoke($"[Repair] {versionId}: 共 {result.Total} 个文件，就位 {result.AlreadyOk}，缺失/损坏 {missing.Count}");

                if (missing.Count == 0) return result;

                // 并发 6：既快又不会把网络打满
                using var gate = new SemaphoreSlim(6);
                var tasks = missing.Select(async w =>
                {
                    await gate.WaitAsync();
                    try
                    {
                        var ok = await TryFetchFileAsync(w, log);
                        if (ok)
                        {
                            Interlocked.Increment(ref result.Fixed);
                            log?.Invoke($"[Repair] ✔ 补齐 {w.Kind}: {Path.GetFileName(w.Full)}");
                        }
                        else
                        {
                            Interlocked.Increment(ref result.Failed);
                            lock (result.FailedItems) result.FailedItems.Add(w.Kind + ": " + Path.GetFileName(w.Full));
                            log?.Invoke($"[Repair] ✘ 无法获取 {w.Kind}: {Path.GetFileName(w.Full)}");
                        }
                    }
                    finally { gate.Release(); }
                }).ToList();

                await Task.WhenAll(tasks);
                log?.Invoke($"[Repair] {versionId}: 完成，补齐 {result.Fixed}，失败 {result.Failed}");
            }
            catch (Exception ex)
            {
                log?.Invoke($"[Repair] 异常：{ex.Message}");
            }
            return result;
        }
    }
}
