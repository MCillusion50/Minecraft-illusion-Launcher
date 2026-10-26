using Microsoft.Web.WebView2.Core;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    public sealed partial class MainWindow
    {
        // =========================================================
        // Forge 1.13+ 自研安装器（不跑官方 installer 的联网下载）
        // 流程：解压 installer → 下依赖库 → 跑 processors → 写版本 JSON
        // =========================================================

        /// <summary>
        /// 安装 Forge/NeoForge installer（新格式，1.13+）
        /// </summary>
        private async Task InstallForgeModernAsync(string installerPath, string versionId, string mcDir, CoreWebView2 sender, double startPct = 0, double endPct = 100)
        {
            double S(double p) => startPct + (endPct - startPct) * p / 100.0;
            Debug.WriteLine($"[InstallForgeModern] 进入方法：versionId={versionId}");

            // 处理器跳过计数：>0 说明安装残缺，最终必须报失败而不是「安装完成」
            int pSkippedTotal = 0;

            // ⭐ 优先走官方静默安装（--installClient）：processors 由官方代码执行，
            //    生成的薄包（约 172KB，带 META-INF/services 注册）一定正确。实测 1.14.4/1.15.2 各约 10 秒。
            //    失败/超时才退回下面的自研流程，不改变已有行为。NeoForge 暂不走这条（未验证通过）。
            if (!versionId.Contains("neoforge", StringComparison.OrdinalIgnoreCase))
            {
                if (await TryOfficialSilentInstallAsync(installerPath, versionId, mcDir, sender, startPct, endPct))
                    return;
                await ReportProgress(sender, S(2), "官方安装器未成功，改用自研流程...");
            }

            await ReportProgress(sender, S(1), $"解析 {versionId} installer...");
            Debug.WriteLine($"[InstallForgeModern] 开始解压 installer...");

            var tempDir = Path.Combine(Path.GetTempPath(), "forge_installer_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);
            try
            {
                // ---------- 1. 解压 installer ----------
                using (var zip = ZipFile.OpenRead(installerPath))
                {
                    foreach (var entry in zip.Entries)
                    {
                        var destPath = Path.Combine(tempDir, entry.FullName);
                        if (string.IsNullOrEmpty(entry.Name))
                            Directory.CreateDirectory(destPath);
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                            entry.ExtractToFile(destPath, true);
                        }
                    }
                }
                Debug.WriteLine($"[InstallForgeModern]  installer 解压完成");

                // ---------- 2. 读 install_profile.json ----------
                var profilePath = Path.Combine(tempDir, "install_profile.json");
                if (!File.Exists(profilePath))
                    throw new Exception("install_profile.json 不存在，不是新格式 installer");

                var profileText = await File.ReadAllTextAsync(profilePath);
                var profile = JsonDocument.Parse(profileText).RootElement;
                Debug.WriteLine($"[InstallForgeModern]  读取 install_profile.json 完成");

                if (!profile.TryGetProperty("spec", out _) && !profile.TryGetProperty("processors", out _))
                    throw new Exception("不是新格式 installer");

                var versionJsonPath = Path.Combine(tempDir, "version.json");
                if (!File.Exists(versionJsonPath))
                    throw new Exception("installer 里缺 version.json");

                var versionJsonText = await File.ReadAllTextAsync(versionJsonPath);
                var versionRoot = JsonDocument.Parse(versionJsonText).RootElement;

                // ---------- 3. 下载 libraries ----------
                Debug.WriteLine($"[InstallForgeModern] 开始收集依赖库...");
                await ReportProgress(sender, S(5), "下载 Forge 依赖库...");

                var libs = new List<(string url, string savePath, string sha1, string name)>();
                if (profile.TryGetProperty("libraries", out var libsArr))
                    foreach (var lib in libsArr.EnumerateArray())
                        CollectLibrary(lib, mcDir, libs);
                if (versionRoot.TryGetProperty("libraries", out var vLibs))
                    foreach (var lib in vLibs.EnumerateArray())
                        CollectLibrary(lib, mcDir, libs);

                libs = libs.GroupBy(l => l.savePath, StringComparer.OrdinalIgnoreCase)
                           .Select(g => g.First()).ToList();

                Debug.WriteLine($"[InstallForgeModern] 依赖库共 {libs.Count} 个");

                int total = libs.Count;
                int done = 0;
                var sem = new System.Threading.SemaphoreSlim(8);
                var tasks = new List<Task>();
                foreach (var (url, savePath, sha1, name) in libs)
                {
                    await sem.WaitAsync();
                    var u = url; var s = savePath; var h = sha1; var n = name;
                    tasks.Add(Task.Run(async () =>
                    {
                        try
                        {
                            if (File.Exists(s)) return;
                            // maven.neoforged.net / maven.minecraftforge.net 在国内基本不可达，直接走镜像链
                            var _done = false;
                            foreach (var _cand in BuildMirrorCandidates(u))
                            {
                                if (_done) break;
                                for (int _a = 0; _a < 2 && !_done; _a++)
                                {
                                    try { await DownloadFileAsync(_cand, s, null, h); _done = true; }
                                    catch (OperationCanceledException) { throw; }
                                    catch { }
                                }
                            }
                            if (!_done) throw new Exception($"所有下载源均失败：{u}");
                        }
                        catch (Exception ex) { Debug.WriteLine($"[ForgeDL] {n} 失败：{ex.Message}"); }
                        finally
                        {
                            sem.Release();
                            int d = System.Threading.Interlocked.Increment(ref done);
                            if (d % 5 == 0 || d == total)
                            {
                                double pct = S(5) + (double)d / Math.Max(total, 1) * (S(45) - S(5));
                                _ = ReportProgress(sender, pct, $"依赖库 {d}/{total}");
                            }
                        }
                    }));
                }
                await Task.WhenAll(tasks);
                Debug.WriteLine($"[InstallForgeModern]  依赖库下载完成");

                // ---------- 4. 跑 processors ----------
                Debug.WriteLine($"[InstallForgeModern] 开始执行处理器...");
                await ReportProgress(sender, S(50), "执行 Forge 安装处理器...");

                if (profile.TryGetProperty("processors", out var processors))
                {
                    var dataDict = ParseDataDict(profile, mcDir, tempDir, installerPath);
                    // ⭐ 填 MINECRAFT_JAR
                    string mcVersion = versionId;
                    int ni = versionId.IndexOf("-neoforge-", StringComparison.OrdinalIgnoreCase);
                    int fi = versionId.IndexOf("-forge-", StringComparison.OrdinalIgnoreCase);
                    if (ni > 0) mcVersion = versionId.Substring(0, ni);
                    else if (fi > 0) mcVersion = versionId.Substring(0, fi);
                    dataDict["MINECRAFT_JAR"] = Path.Combine(mcDir, "versions", mcVersion, mcVersion + ".jar");
                    int _needJava = GetProcessorJavaVersion(versionId);
                    var javaExe = FindJavaForProcessors(mcDir, _needJava);
                    if (javaExe == null)
                        throw new Exception("找不到 Java 8+，无法执行处理器");
                    Debug.WriteLine($"[InstallForgeModern] 使用 Java：{javaExe}");

                    int pTotal = processors.GetArrayLength();
                    int pIdx = 0;
                    foreach (var proc in processors.EnumerateArray())
                    {
                        pIdx++;
                        if (proc.TryGetProperty("sides", out var sides))
                        {
                            bool hasClient = sides.EnumerateArray().Any(x => x.GetString() == "client");
                            if (!hasClient) continue;
                        }

                        var jarName = proc.GetProperty("jar").GetString();

                        var jarPath = ResolveProcessorJar(jarName, mcDir, tempDir);
                        if (jarPath == null)
                        {
                            Debug.WriteLine($"[InstallForgeModern] ⚠️ 跳过处理器，找不到 jar：{jarName}");
                            pSkippedTotal++;
                            continue;
                        }

                        string mainClass = proc.TryGetProperty("mainClass", out var mcEl) ? mcEl.GetString() : null;
                        if (string.IsNullOrEmpty(mainClass))
                        {
                            mainClass = ReadMainClassFromJar(jarPath);
                        }
                        if (string.IsNullOrEmpty(mainClass))
                        {
                            Debug.WriteLine($"[InstallForgeModern] ⚠️ 跳过处理器，无法确定 Main-Class：{jarName}");
                            pSkippedTotal++;
                            continue;
                        }

                        var cp = new List<string>();
                        if (proc.TryGetProperty("classpath", out var cpArr))
                            foreach (var c in cpArr.EnumerateArray())
                            {
                                var coord = c.GetString();
                                // Maven 坐标：group:artifact:version[:classifier][@ext]
                                // ⭐ 先把 @ext 拆出去
                                var ext = "jar";
                                var atIdx = coord.IndexOf('@');
                                if (atIdx >= 0)
                                {
                                    ext = coord.Substring(atIdx + 1);
                                    coord = coord.Substring(0, atIdx);
                                }
                                var parts = coord.Split(':');
                                if (parts.Length < 3) continue;
                                var group = parts[0].Replace('.', '/');
                                var artifact = parts[1];
                                var version = parts[2];
                                var classifier = parts.Length > 3 ? parts[3] : null;
                                var fileName = classifier != null
                                    ? $"{artifact}-{version}-{classifier}.{ext}"
                                    : $"{artifact}-{version}.{ext}";
                                var fullPath = Path.Combine(mcDir, "libraries", group, artifact, version, fileName);
                                if (!cp.Contains(fullPath)) cp.Add(fullPath);
                            }
                     
                        cp.Insert(0, jarPath);

                        var args = new List<string>();
                        if (proc.TryGetProperty("args", out var argsArr))
                            foreach (var a in argsArr.EnumerateArray())
                            {
                                var val = a.GetString() ?? "";
                                val = SubstituteData(val, dataDict);
                                args.Add(val);
                            }

                        Debug.WriteLine($"[InstallForgeModern] 运行处理器：{mainClass}");
                        await RunProcessorAsync(javaExe, cp, mainClass, args, mcDir);

                        // 1. 映射到整体的进度条位置（50% ~ 95%）
                        double mappedPct = S(50) + ((double)pIdx / Math.Max(pTotal, 1)) * (S(95) - S(50));

                        // 2. 单独计算处理器的百分比，保留1位小数（例如 33.3%）
                        double currentPct = (double)pIdx / Math.Max(pTotal, 1) * 100;

                        // 3. 发送带小数点的进度
                        _ = ReportProgress(sender, mappedPct, $"处理器 {pIdx}/{pTotal} · {currentPct:F1}%");

                        // 4. 强制停顿 80 毫秒，让 UI 有时间渲染数字跳动
                        await Task.Delay(80);
                    }
                }
                Debug.WriteLine($"[InstallForgeModern]  处理器执行完成");

                // ⭐ 绝不假成功：只要有处理器被跳过（依赖库没下到 / jar 无法识别），
                //    生成的版本一定残缺，启动必失败。必须报错，不能写「安装完成」。
                if (pSkippedTotal > 0)
                {
                    DiagnosticLogger.Instance.Error($"[InstallForge] {versionId}：{pSkippedTotal} 个处理器被跳过（依赖库缺失），安装不完整");
                    throw new Exception($"安装不完整：{pSkippedTotal} 个处理器被跳过（依赖库没下载到）。这个版本启动不了，请检查网络后重试。");
                }
                // ⭐ 加上这一句：通知前端处理器跑完了，正在做后续收尾（防止卡100%被误认为死机）
                await ReportProgress(sender, S(95), "处理器执行完毕，正在写入配置...");

                // ---------- 5. 写版本 JSON ----------
                await ReportProgress(sender, S(97), "写入版本文件...");
                var versionDir = Path.Combine(mcDir, "versions", versionId);
                Directory.CreateDirectory(versionDir);
                var finalJsonPath = Path.Combine(versionDir, versionId + ".json");
                await File.WriteAllTextAsync(finalJsonPath, versionJsonText);
                Debug.WriteLine($"[InstallForgeModern]  版本 JSON 已写入：{finalJsonPath}");

           //     await ReportProgress(sender, S(100), $" {versionId} 安装完成", done: false);
                Debug.WriteLine($"[InstallForgeModern]  {versionId} 安装完成");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[InstallForgeModern]  异常：{ex}");
                throw;
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }
        }

        // =========================================================
        // 辅助方法
        // =========================================================

        private void CollectLibrary(JsonElement lib, string mcDir, List<(string url, string savePath, string sha1, string name)> list)
        {
            try
            {
                if (!lib.TryGetProperty("downloads", out var dl)) return;
                if (!dl.TryGetProperty("artifact", out var art)) return;
                var path = art.GetProperty("path").GetString();
                if (string.IsNullOrEmpty(path)) return;
                var url = art.TryGetProperty("url", out var u) ? u.GetString() : null;
                if (string.IsNullOrEmpty(url)) return;
                var sha1 = art.TryGetProperty("sha1", out var s) ? s.GetString() : null;
                var savePath = Path.Combine(mcDir, "libraries", path.Replace('/', Path.DirectorySeparatorChar));
                var name = lib.TryGetProperty("name", out var n) ? n.GetString() : path;
                list.Add((url, savePath, sha1, name));
            }
            catch { }
        }

                /// <summary>
        /// 返回可尝试的下载地址：镜像排前面（官方源在国内被墙），官方地址作为最后兜底。
        /// </summary>
        private static List<string> BuildMirrorCandidates(string url)
        {
            var prefixes = new[]
            {
                "https://maven.neoforged.net/releases/",
                "https://maven.minecraftforge.net/"
            };

            foreach (var prefix in prefixes)
            {
                if (!url.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                var rel = url.Substring(prefix.Length);
                return new List<string>
                {
                    "https://bmclapi2.bangbang93.com/maven/" + rel,
                    "https://maven.aliyun.com/repository/public/" + rel,
                    "https://repo.huaweicloud.com/repository/maven/" + rel,
                    "https://mirrors.cloud.tencent.com/nexus/repository/maven-public/" + rel,
                    url
                };
            }

            return new List<string> { url };
        }

private string ReplaceToMirror(string url)
        {
            if (url.Contains("maven.neoforged.net/releases/"))
                return url.Replace("maven.neoforged.net/releases/", "bmclapi2.bangbang93.com/maven/");
            if (url.Contains("maven.minecraftforge.net/"))
                return url.Replace("maven.minecraftforge.net/", "bmclapi2.bangbang93.com/maven/");
            if (url.Contains("libraries.minecraft.net/"))
                return url.Replace("libraries.minecraft.net/", "bmclapi2.bangbang93.com/maven/");
            return url;
        }

        /// <summary>
        /// 解析 install_profile.json 的 data 字段，得到变量字典
        /// </summary>
        private Dictionary<string, string> ParseDataDict(JsonElement profile, string mcDir, string tempDir, string installerPath)
        {
            var dict = new Dictionary<string, string>();
            dict["SIDE"] = "client";
            dict["MINECRAFT_JAR"] = ""; // 运行时根据版本填
            dict["INSTALLER"] = installerPath;
            dict["ROOT"] = mcDir;
            dict["LIBRARY_DIR"] = Path.Combine(mcDir, "libraries");

            if (profile.TryGetProperty("data", out var data))
            {
                foreach (var kv in data.EnumerateObject())
                {
                    var value = "";
                    if (kv.Value.TryGetProperty("client", out var cv))
                        value = cv.GetString() ?? "";
                    else if (kv.Value.ValueKind == JsonValueKind.String)
                        value = kv.Value.GetString() ?? "";

                    // value 里可能有 [xxx] 或 'xxx' 引用，需要展开
                    value = Regex.Replace(value, @"\[([^\]]+)\]", m => m.Groups[1].Value);
                    value = value.Trim('\'', '"');
                    // ⭐ /data/xxx 是 installer 内部的相对路径，拼到 tempDir
                    if (value.StartsWith("/data/", StringComparison.OrdinalIgnoreCase))
                    {
                        value = Path.Combine(tempDir, value.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                    }
                    dict[kv.Name] = value;
                }
            }
            return dict;
        }

        private string SubstituteData(string input, Dictionary<string, string> dataDict)
        {
            if (string.IsNullOrEmpty(input)) return input;
            var result = input;

            // 1. 先替换 {变量}
            foreach (var kv in dataDict)
                result = result.Replace("{" + kv.Key + "}", kv.Value);

            // 2. Maven 坐标转实际路径：[group:artifact:version@ext] 或 group:artifact:version[:classifier][@ext]
            var mcDir = dataDict.TryGetValue("ROOT", out var r) ? r : "";
            result = Regex.Replace(result,
 @"\[?([a-zA-Z0-9\.\-_]+):([a-zA-Z0-9\.\-_]+):([a-zA-Z0-9\.\-_]+)(?::([a-zA-Z0-9\.\-_]+))?(?:@([a-zA-Z0-9\.]+))?\]?",
   m =>
   {
       var group = m.Groups[1].Value.Replace('.', '/');
       var artifact = m.Groups[2].Value;
       var version = m.Groups[3].Value;
       var classifier = m.Groups[4].Success && !string.IsNullOrEmpty(m.Groups[4].Value) ? m.Groups[4].Value : null;
       var ext = m.Groups[5].Success ? m.Groups[5].Value : "jar";

       var fileName = classifier != null
           ? $"{artifact}-{version}-{classifier}.{ext}"
           : $"{artifact}-{version}.{ext}";

       if (ext == "jar" || ext == "zip")
       {
           var libPath = Path.Combine(mcDir, "libraries", group, artifact, version, fileName);
           if (File.Exists(libPath)) return libPath;
       }
       var outPath = Path.Combine(mcDir, "libraries", group, artifact, version, fileName);
       return outPath;
   });

            return result;
        }

        private string ResolveProcessorJar(string jarMaven, string mcDir, string tempDir)
        {
            // jarMaven 形如 net.minecraftforge:installertools:1.4.3:fatjar
            // 或 net.minecraftforge:installertools:1.4.3
            // 先看 install_profile.json 里的 libraries 有没有
            var parts = jarMaven.Split(':');
            if (parts.Length < 3) return null;
            var group = parts[0].Replace('.', '/');
            var artifact = parts[1];
            var version = parts[2];
            var classifier = parts.Length > 3 ? parts[3] : null;

            var fileName = classifier != null
                ? $"{artifact}-{version}-{classifier}.jar"
                : $"{artifact}-{version}.jar";
            var path = Path.Combine(mcDir, "libraries", group, artifact, version, fileName);
            if (File.Exists(path)) return path;

            // 回退到临时目录（installer 自带的 maven 目录）
            var altPath = Path.Combine(tempDir, "maven", group, artifact, version, fileName);
            if (File.Exists(altPath)) return altPath;

            return null;
        }

        /// <summary>
        /// processor 需要什么 Java：按目标 MC 版本判定。
        /// 1.14~1.16 → Java 8；1.17~1.20.4 → Java 17；1.20.5+ / 1.21+ / 26.x（NeoForge）→ Java 21。
        /// 以前不判断，全局 Java 指向哪个就用哪个，导致 NeoForge 26.2 用 Java 8 跑处理器必然失败。
        /// </summary>
        private int GetProcessorJavaVersion(string versionId)
        {
            var mc = versionId ?? "";
            var ni = mc.IndexOf("-neoforge-", StringComparison.OrdinalIgnoreCase);
            var fi = mc.IndexOf("-forge-", StringComparison.OrdinalIgnoreCase);
            if (ni > 0) mc = mc.Substring(0, ni);
            else if (fi > 0) mc = mc.Substring(0, fi);

            if (mc.StartsWith("26.") || mc.StartsWith("1.21") || mc.StartsWith("1.20.5") || mc.StartsWith("1.20.6")) return 21;
            if (mc.StartsWith("1.17") || mc.StartsWith("1.18") || mc.StartsWith("1.19") || mc.StartsWith("1.20")) return 17;
            return 8;
        }

        /// <summary>
        /// 按需要的 Java 主版本挑选可执行文件：优先「≥ required 且最低」的，避免拿 Java 25 去跑只认 17 的老处理器。
        /// 一个合格的都没有时，返回现有最高版本（尽力而为；失败会被后续校验拦住，不会假成功）。
        /// </summary>
        private string FindJavaForProcessors(string mcDir, int requiredJava)
        {
            var candidates = new List<string>();
            try
            {
                if (!string.IsNullOrEmpty(_global.JavaPath) && File.Exists(_global.JavaPath))
                    candidates.Add(_global.JavaPath);
            }
            catch { }

            try
            {
                var javaDir = Path.Combine(mcDir, "java");
                if (Directory.Exists(javaDir))
                {
                    foreach (var d in Directory.GetDirectories(javaDir))
                    {
                        var direct = Path.Combine(d, "bin", "java.exe");
                        if (File.Exists(direct)) candidates.Add(direct);
                        try
                        {
                            foreach (var s in Directory.GetDirectories(d))
                            {
                                var exe = Path.Combine(s, "bin", "java.exe");
                                if (File.Exists(exe)) candidates.Add(exe);
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }

            var scored = new List<(string path, int ver)>();
            foreach (var p in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    int v = GetJavaVersion(p);
                    if (v > 0) scored.Add((p, v));
                }
                catch { }
            }
            if (scored.Count == 0) return FindJavaForForgeProcessor(mcDir);

            var ok = scored.Where(x => x.ver >= requiredJava).OrderBy(x => x.ver).ToList();
            if (ok.Count > 0)
            {
                Debug.WriteLine($"[InstallForgeModern] 需要 Java {requiredJava}+，选用 Java {ok[0].ver}：{ok[0].path}");
                return ok[0].path;
            }

            var best = scored.OrderByDescending(x => x.ver).First();
            Debug.WriteLine($"[InstallForgeModern] 没有 Java {requiredJava}+，只能用 Java {best.ver}：{best.path}");
            return best.path;
        }

        private string FindJavaForForgeProcessor(string mcDir)
        {
            // 1) 最优先：启动器设置里的全局 Java（1.20.1 需要 Java 17+，不是 Java 8）
            if (!string.IsNullOrEmpty(_global.JavaPath) && File.Exists(_global.JavaPath))
                return _global.JavaPath;
        
            // 2) 再找 mcDir/java 下的任意 JRE（优先高版本）
            var javaDir = Path.Combine(mcDir, "java");
            if (Directory.Exists(javaDir))
            {
                var jres = Directory.GetDirectories(javaDir)
                    .OrderByDescending(d => d, StringComparer.OrdinalIgnoreCase);
                foreach (var d in jres)
                {
                    foreach (var s in Directory.GetDirectories(d))
                    {
                        var exe = Path.Combine(s, "bin", "java.exe");
                        if (File.Exists(exe)) return exe;
                    }
                    var direct = Path.Combine(d, "bin", "java.exe");
                    if (File.Exists(direct)) return direct;
                }
            }
        
            // 3) 最后：环境变量里的 java
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo("java", "-version")
                { RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
                using var proc = System.Diagnostics.Process.Start(psi);
                proc.WaitForExit(3000);
                return "java";
            }
            catch { }
        
            return null;
        }

        /// <summary>
        /// 用官方 installer 的 --installClient 无头模式安装。成功返回 true，失败返回 false（由调用方回退）。
        /// 为什么优先它：Forge 1.14/1.15 的薄包只有官方 processors 能正确生成，maven 上放的是 universal 本体。
        /// </summary>
        private async Task<bool> TryOfficialSilentInstallAsync(string installerPath, string versionId, string mcDir, CoreWebView2 sender, double startPct, double endPct)
        {
            try
            {
                double S(double p) => startPct + (endPct - startPct) * p / 100.0;

                var javaExe = FindJavaForInstallers(mcDir);
                if (string.IsNullOrEmpty(javaExe))
                {
                    DiagnosticLogger.Instance.Warn("[Forge] 找不到可用 Java，跳过官方静默安装");
                    return false;
                }

                EnsureLauncherProfiles(mcDir);
                await ReportProgress(sender, S(3), "运行官方安装器（静默模式）...");

                var psi = new ProcessStartInfo
                {
                    FileName = javaExe,
                    WorkingDirectory = mcDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                psi.ArgumentList.Add("-jar");
                psi.ArgumentList.Add(installerPath);
                psi.ArgumentList.Add("--installClient");
                psi.ArgumentList.Add(mcDir);

                var proc = Process.Start(psi);
                if (proc == null) return false;

                // 实时收集 installer 输出（它用 \r 刷进度，这里取最后一行当心跳提示）
                var sbOut = new StringBuilder();
                var sbErr = new StringBuilder();
                string lastLine = "";
                proc.OutputDataReceived += (s, e) =>
                {
                    if (e.Data == null) return;
                    lock (sbOut)
                    {
                        sbOut.AppendLine(e.Data);
                        var t = e.Data.Trim();
                        if (t.Length > 0) lastLine = t;
                    }
                };
                proc.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data == null) return;
                    lock (sbErr) sbErr.AppendLine(e.Data);
                };
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                // ⭐ 心跳：官方安装器可能还要下载几十个依赖库（1.16.4 实测 57 秒），
                //    期间必须往界面报进度，否则用户会以为卡死。每 4 秒刷一次，并带上它正在做什么。
                var sw = Stopwatch.StartNew();
                const int TimeoutSec = 180;
                while (!proc.HasExited)
                {
                    if (sw.Elapsed.TotalSeconds > TimeoutSec)
                    {
                        try { proc.Kill(entireProcessTree: true); } catch { }
                        DiagnosticLogger.Instance.Warn($"[Forge] 官方静默安装超时（{TimeoutSec}s），回退自研流程");
                        return false;
                    }
                    await Task.Delay(4000);
                    if (proc.HasExited) break;

                    string hint;
                    lock (sbOut)
                    {
                        hint = string.IsNullOrEmpty(lastLine)
                            ? ""
                            : " · " + (lastLine.Length > 46 ? lastLine.Substring(0, 46) + "…" : lastLine);
                    }
                    var pct = S(3) + (S(45) - S(3)) * Math.Min(sw.Elapsed.TotalSeconds, 60) / 60.0;
                    await ReportProgress(sender, pct, $"官方安装器运行中 {sw.Elapsed.TotalSeconds:F0}s{hint}");
                }
                proc.WaitForExit(); // 等输出流刷完

                var exit = proc.ExitCode;
                string stdout, stderr;
                lock (sbOut) stdout = sbOut.ToString();
                lock (sbErr) stderr = sbErr.ToString();
                DiagnosticLogger.Instance.Info($"[Forge] 官方静默安装退出码={exit}（耗时 {sw.Elapsed.TotalSeconds:F1}s）");

                if (exit != 0)
                {
                    DiagnosticLogger.Instance.Warn("[Forge] 官方静默安装失败：" + stderr.Trim());
                    return false;
                }
                if (stdout.IndexOf("Successfully installed", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    DiagnosticLogger.Instance.Warn("[Forge] 官方安装器未报告成功，回退自研流程");
                    return false;
                }
                if (!VerifyForgeInstallLooksSane(versionId, mcDir))
                {
                    DiagnosticLogger.Instance.Warn("[Forge] 官方安装后校验不通过，回退自研流程");
                    return false;
                }

                DiagnosticLogger.Instance.Info($"[Forge] 官方静默安装完成：{versionId}");
                await ReportProgress(sender, endPct, $"Forge {versionId} 安装完成");
                return true;
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Warn("[Forge] 官方静默安装异常，回退自研：" + ex.Message);
                return false;
            }
        }

        /// <summary>installer 需要目录里有 launcher_profiles.json，没有就写一个最小的。</summary>
        private void EnsureLauncherProfiles(string mcDir)
        {
            try
            {
                var p = Path.Combine(mcDir, "launcher_profiles.json");
                if (File.Exists(p)) return;
                File.WriteAllText(p, "{\"profiles\":{},\"selectedProfile\":\"\",\"clientToken\":\"illusion-launcher\",\"authenticationDatabase\":{},\"launcherVersion\":{\"name\":\"1.0.0\",\"format\":21}}");
            }
            catch { }
        }

        /// <summary>选一个适合跑 installer 的 Java：优先 Java 8（1.14~1.16 的 installer 在 8 上最稳）。</summary>
        private string FindJavaForInstallers(string mcDir)
        {
            try
            {
                var jd = Path.Combine(mcDir, "java");
                if (Directory.Exists(jd))
                {
                    foreach (var sub in Directory.GetDirectories(jd).OrderBy(x => x))
                    {
                        var name = Path.GetFileName(sub).ToLowerInvariant();
                        if (!(name.Contains("jre-8") || name.Contains("jdk8") || name.Contains("1.8"))) continue;
                        var exe = Directory.GetFiles(sub, "java.exe", SearchOption.AllDirectories).FirstOrDefault();
                        if (!string.IsNullOrEmpty(exe)) return exe;
                    }
                }
            }
            catch { }
            return FindJavaForForgeProcessor(mcDir);
        }

        /// <summary>安装后校验：版本 json 存在，且 forge 薄包大小与 json 声明一致。</summary>
        private bool VerifyForgeInstallLooksSane(string versionId, string mcDir)
        {
            try
            {
                var jp = Path.Combine(mcDir, "versions", versionId, versionId + ".json");
                if (!File.Exists(jp)) return false;

                using var doc = JsonDocument.Parse(File.ReadAllText(jp));
                if (!doc.RootElement.TryGetProperty("libraries", out var libs) || libs.ValueKind != JsonValueKind.Array)
                    return true;

                foreach (var lib in libs.EnumerateArray())
                {
                    if (!lib.TryGetProperty("name", out var n)) continue;
                    var name = n.GetString() ?? "";
                    if (!name.StartsWith("net.minecraftforge:forge:", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!lib.TryGetProperty("downloads", out var dl) || !dl.TryGetProperty("artifact", out var art)) continue;
                    if (!art.TryGetProperty("path", out var pEl)) continue;
                    var rel = pEl.GetString();
                    if (string.IsNullOrEmpty(rel)) continue;

                    var full = Path.Combine(mcDir, "libraries", rel.Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(full))
                    {
                        DiagnosticLogger.Instance.Warn("[Forge] 校验：薄包不存在 " + rel);
                        return false;
                    }
                    if (art.TryGetProperty("size", out var szEl))
                    {
                        long declared = szEl.GetInt64();
                        long real = new FileInfo(full).Length;
                        if (declared > 0 && declared != real)
                        {
                            DiagnosticLogger.Instance.Warn($"[Forge] 校验：薄包大小不符 declared={declared} real={real} {rel}");
                            return false;
                        }
                    }
                }
                return true;
            }
            catch { return false; }
        }

        private async Task RunProcessorAsync(string javaExe, List<string> classpath, string mainClass, List<string> args, string mcDir)
        {
            var psi = new ProcessStartInfo
            {
                FileName = javaExe,
                WorkingDirectory = mcDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.ArgumentList.Add("-cp");
            psi.ArgumentList.Add(string.Join(";", classpath));
            psi.ArgumentList.Add(mainClass);

            foreach (var a in args) psi.ArgumentList.Add(a);

            Debug.WriteLine($"[Processor] {mainClass} {string.Join(" ", args)}");

            var proc = Process.Start(psi);
            var stdout = proc.StandardOutput.ReadToEndAsync();
            var stderr = proc.StandardError.ReadToEndAsync();
            await Task.WhenAll(stdout, stderr);
            await proc.WaitForExitAsync();

            Debug.WriteLine($"[Processor stdout] {stdout.Result}");
            if (proc.ExitCode != 0)
            {
                Debug.WriteLine($"[Processor stderr] {stderr.Result}");
                throw new Exception($"processor {mainClass} 失败（exit {proc.ExitCode}）");
            }
        }
        /// <summary>
        /// 从 "1.20.1-47.4.26" 提取 "47.4.26"
        /// </summary>
        private string ParseForgeVersionShort(string full)
        {
            var idx = full.IndexOf('-');
            if (idx < 0) return full;
            return full.Substring(idx + 1);
        }
        /// <summary>
        /// 从 jar 的 MANIFEST.MF 读 Main-Class
        /// </summary>
        private string ReadMainClassFromJar(string jarPath)
        {
            try
            {
                using var zip = ZipFile.OpenRead(jarPath);
                var manifest = zip.GetEntry("META-INF/MANIFEST.MF");
                if (manifest == null) return null;
                using var reader = new StreamReader(manifest.Open());
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (line.StartsWith("Main-Class:", StringComparison.OrdinalIgnoreCase))
                        return line.Substring("Main-Class:".Length).Trim();
                }
            }
            catch { }
            return null;
        }
    }

}