using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 加载器专属补丁库：只对特定主类生效，绝不改动其他版本的参数。
    /// 铁律：这里出问题最多影响对应版本，绝不影响已验证的 Forge 1.20.1 / Fabric / 原版。
    /// </summary>
    public static class LoaderPatches
    {

        /// <summary>
        /// ⭐ 对齐 PCL：不看版本号，只看 mainClass。
        /// 主类是加载器写死在 version json 里的，比版本号可靠 —— 新版本无需登记就能自动覆盖。
        /// </summary>
        private static string WhitelistGroupOf(string versionId, string mainClass)
        {
            var mc = mainClass ?? "";
            if (string.IsNullOrEmpty(mc)) return null;

            // Fabric / Quilt：KnotClient，只要 -cp
            if (mc.IndexOf("KnotClient", StringComparison.OrdinalIgnoreCase) >= 0
                || mc.IndexOf("fabricmc", StringComparison.OrdinalIgnoreCase) >= 0
                || mc.IndexOf("quiltmc", StringComparison.OrdinalIgnoreCase) >= 0)
                return "fabric";

            // 老 Forge（1.7.10 / 1.12.2）：launchwrapper，只要 -cp
            if (mc == "net.minecraft.launchwrapper.Launch"
                || mc.IndexOf("launchwrapper", StringComparison.OrdinalIgnoreCase) >= 0)
                return "legacy-launchwrapper";

            // Forge 1.14 ~ 1.16.x：ModLauncher（非 bootstrap），需要 -DlegacyClassPath + -cp
            if (mc.IndexOf("modlauncher.Launcher", StringComparison.OrdinalIgnoreCase) >= 0
                && mc.IndexOf("BootstrapLauncher", StringComparison.OrdinalIgnoreCase) < 0)
                return "forge-modlauncher";

            // Forge 1.17+ / 1.20.x / NeoForge / 新架构 fml.startup：统一走 forge-bootstrap
            if (mc.IndexOf("BootstrapLauncher", StringComparison.OrdinalIgnoreCase) >= 0
                || mc.IndexOf("fml.startup", StringComparison.OrdinalIgnoreCase) >= 0
                || mc.IndexOf("neoforged", StringComparison.OrdinalIgnoreCase) >= 0)
                return "forge-bootstrap";

            // 原版或未知加载器：不干预
            return null;
        }

        /// <summary>
        /// 最终规整：确保 -cp 与它的值紧挨着（相邻两项），且只保留一份。
        /// 主程序在补丁之后可能又插入参数，把 -cp 和值拆开 → Java 会把下一个 -D 参数当成 classpath，
        /// 表现为「-cp 后面接 -Djava.net...」直接崩。
        /// 做法：把 -cp 与紧随的 classpath 值摘出来，统一放到列表最前面，保证顺序和唯一性。
        /// </summary>
        private static void NormalizeClasspathArg(List<string> jvmArgs, string versionId)
        {
            if (jvmArgs == null) return;
            string cpValue = null;
            for (int i = jvmArgs.Count - 1; i >= 0; i--)
            {
                if (jvmArgs[i] != "-cp" && jvmArgs[i] != "-classpath") continue;
                // 取紧随其后的值（必须不是以 '-' 开头的开关）
                if (i + 1 < jvmArgs.Count)
                {
                    var v = jvmArgs[i + 1];
                    if (!string.IsNullOrEmpty(v) && !v.StartsWith("-") && v.IndexOf(';') > 0)
                    {
                        if (cpValue == null) cpValue = v;
                        jvmArgs.RemoveRange(i, 2);
                        continue;
                    }
                }
                // -cp 后面没跟有效值 → 直接删掉这个孤立开关
                DiagnosticLogger.Instance.Info($"[Patch] {versionId}: 移除孤立的 {jvmArgs[i]}（后面没有 classpath 值）");
                jvmArgs.RemoveAt(i);
            }

            if (!string.IsNullOrEmpty(cpValue))
            {
                jvmArgs.Insert(0, "-cp");
                jvmArgs.Insert(1, cpValue);
                DiagnosticLogger.Instance.Info($"[Patch] {versionId}: 规整 -cp，值 {cpValue.Length} 字符，已绑定到第 2 项");
            }
        }

        /// <summary>
        /// 把常见的英文崩溃信息翻译成人话 + 可操作的建​议。
        /// 返回 null 表示没匹配到已知问题。
        /// </summary>
        public static string DiagnoseError(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;

            if (text.Contains("Unrecognized option") || text.Contains("Could not create the Java Virtual Machine"))
                return "Java 版本与这个游戏不匹配。\n\n建议：到「设置 → Java」换一个匹配的 Java（1.17 及以上需要 Java 17+）。";

            if (text.Contains("Must use a Java") || text.Contains("requires Java"))
                return "这个版本需要更高版本的 Java。\n\n建议：到「设置 → Java」选择一个更新的 Java。";

            if (text.Contains("Cannot find launch target") || text.Contains("unable to launch"))
                return "加载器（Forge/NeoForge）安装不完整，缺少启动入口。\n\n建议：删除这个版本，重新安装加载器。";

            if (text.Contains("Module ") && text.Contains("not found"))
                return "缺少依赖模块文件。\n\n建议：检查网络后重试，或重新安装该版本。";

            if (text.Contains("Failed to find required file"))
                return "版本文件缺失。\n\n建议：用启动器重新安装这个版本。";

            if (text.Contains("OutOfMemoryError") || text.Contains("insufficient memory"))
                return "内存不足。\n\n建议：到设置里调低分配内存（例如 4G）。";

            if (text.Contains("ClassNotFoundException") || text.Contains("NoClassDefFoundError"))
                return "缺少必要的类文件，版本可能不完整。\n\n建议：重新安装该版本。";

            if (text.Contains("java.library.path") || text.Contains("UnsatisfiedLinkError"))
                return "原生库（natives）缺失或加载失败。\n\n建议：重新安装该版本，并检查杀毒软件是否误删了 dll。";

            if (text.Contains("Pixel format not accelerated") || text.Contains("GLFW error"))
                return "显卡驱动或 OpenGL 支持有问题。\n\n建议：更新显卡驱动后重试。";

            if (text.Contains("Missing or unsupported mandatory dependencies") || text.Contains("Mod resolution failed"))
                return "模组依赖缺失。\n\n建议：查看日志确认缺哪个模组的前置。";

            if (text.Contains("installation is corrupted"))
                return "加载器自检失败，安装文件不完整。\n\n建议：重新安装该版本。";

            return null;
        }

        /// <summary>
        /// 清理「裸 classpath」参数：不以 '-' 开头、不含空格、但含 ';' 的多路径串。
        /// 这类串是主程序把 classpathStr 直接塞进 jvmArgs 造成的，Java 会当主类名解析。
        /// </summary>
        public static int StripBareClasspath(List<string> jvmArgs, string versionId)
        {
            if (jvmArgs == null) return 0;
            int removed = 0;
            bool skipNext = false;
            for (int i = 0; i < jvmArgs.Count; i++)
            {
                var s = jvmArgs[i];
                // ⭐ 紧跟 -p / -cp 后面的那一项是它们的值，绝不能当「裸 classpath」删掉。
                //    1.20.1 的 -p 值形如 "D:\...a.jar;D:\...b.jar"，完全符合裸 classpath 特征，
                //    误删后 JVM 报 "Error: -p requires module path specification"。
                if (skipNext) { skipNext = false; continue; }
                if (string.IsNullOrEmpty(s)) continue;
                if (s == "-p" || s == "--module-path" || s == "-cp" || s == "-classpath")
                {
                    skipNext = true;
                    continue;
                }
                if (s.StartsWith("-")) continue;
                if (s.IndexOf(' ') >= 0) continue;
                if (s.IndexOf(';') <= 0) continue;
                var segs = s.Split(';');
                if (segs.Length < 3) continue;
                DiagnosticLogger.Instance.Info($"[Patch] {versionId}: 全局清理裸 classpath 参数（{s.Length} 字符，{segs.Length} 段）");
                jvmArgs.RemoveAt(i);
                i--;
                removed++;
            }
            return removed;
        }

        public static bool Apply(string versionId, string mainClass, List<string> jvmArgs, List<string> gameArgs, string mcDir, int javaMajor = 0)
        {
            try
            {
                if (string.IsNullOrEmpty(mainClass)) return false;

                // 0) 全局兜底：清理「裸 classpath」参数
                //    主程序部分分支会把 classpathStr 直接塞进 jvmArgs（没有 -cp 前缀），
                //    Java 会把它当主类名 → "找不到或无法加载主类 D:\...xxx.jar;D:\...yyy.jar"
                //    放在所有分支之前，任何 mainClass 都先清一遍，避免再漏（1.16.5 modlauncher 就漏过）。
                StripBareClasspath(jvmArgs, versionId);

                // ⭐ 版本白名单：只有登记过的版本才走特殊补丁，其余版本一律回落到原逻辑。
                //    目的是「改哪版限定哪版」，避免为了修 A 版本而波及已稳定的 B 版本。
                //    新增受支持版本时，只需在对应分组里加一行前缀即可。
                var group = WhitelistGroupOf(versionId, mainClass);
                if (group == null)
                {
                    DiagnosticLogger.Instance.Info($"[Patch] {versionId}: 不在补丁白名单内，保持原逻辑不干预（mainClass={mainClass}）");
                    return false;
                }
                DiagnosticLogger.Instance.Info($"[Patch] {versionId}: 命中白名单分组 [{group}]（mainClass={mainClass}）");

                // ⭐ 关键：模块参数（--add-opens / --add-exports / --add-modules / -p）能不能带，
                //    取决于「实际使用的 Java 版本」，不取决于加载器分支。
                //    Java 8 一个都不认识，带上就 Unrecognized option 秒退（Mojang 官方启动器也是按 Java 版本过滤的）。
                //    javaMajor > 0 = 调用方已告知真实版本；javaMajor == 0 = 未知，保持历史行为（参数照留，与改动前完全一致）。
                bool javaIs8Flag = javaMajor > 0 && javaMajor <= 8;
                if (javaMajor > 0)
                    DiagnosticLogger.Instance.Info($"[Patch] {versionId}: 实际 Java 主版本={javaMajor}（{(javaIs8Flag ? "低于 9，剔除模块参数" : "9+，保留模块参数")}）");

                // 老 Forge（1.7.10 / 1.12.2）：launchwrapper，只需 -cp
                if (group == "legacy-launchwrapper")
                {
                    var ok = SimpleClasspathMode(versionId, mainClass, jvmArgs, gameArgs, mcDir, "老 Forge");
                    NormalizeClasspathArg(jvmArgs, versionId);
                    return ok;
                }

                // 1.16.x Forge：主类是 cpw.mods.modlauncher.Launcher
                // 它是普通 Java 程序（不是模块化启动），只需要 -cp + 主类，但需要 -DlegacyClassPath 注册 launch target。
                if (group == "forge-modlauncher")
                {
                    var ok = SimpleClasspathMode(versionId, mainClass, jvmArgs, gameArgs, mcDir, "Forge1.16/modlauncher", keepLegacyClassPath: true, javaIs8: javaIs8Flag);
                    // ⭐ 1.16.x 不调用 NormalizeClasspathArg：
                    //    它会把 -cp 挪到最前、重排顺序，反而干扰 -DlegacyClassPath 的 layout。
                    //    SimpleClasspathMode 内部已经保证了 -cp 与值相邻。
                    return ok;
                }

                // 新版 Forge 26.x / 1.21.x：ForgeBootstrap，PCL 也用纯 -cp
                if (group == "forge-bootstrap")
                {
                    var ok = SimpleClasspathMode(versionId, mainClass, jvmArgs, gameArgs, mcDir, "ForgeBootstrap", keepLegacyClassPath: true, javaIs8: false, keepModulePath: true);
                    NormalizeClasspathArg(jvmArgs, versionId);
                    return ok;
                }

                // NeoForge 1.21+（BootstrapLauncher 新版）：PCL 同样只用 -cp
                if (group == "neoforge")
                {
                    var ok = SimpleClasspathMode(versionId, mainClass, jvmArgs, gameArgs, mcDir, "NeoForge");
                    NormalizeClasspathArg(jvmArgs, versionId);
                    return ok;
                }

                // Fabric / Quilt：KnotClient 是普通 Java 主类，走纯 -cp
                // javaIs8: false —— Fabric 用 Java 17+，必须保留 --add-opens/--add-exports
                if (group == "fabric")
                {
                    var ok = SimpleClasspathMode(versionId, mainClass, jvmArgs, gameArgs, mcDir, "Fabric", javaIs8: false);
                    NormalizeClasspathArg(jvmArgs, versionId);
                    return ok;
                }
            }
            catch (Exception ex)
            {
                DiagnosticLogger.Instance.Error($"[Patch] {versionId} 打补丁失败：{ex.Message}");
            }
            return false;
        }

        /// <summary>
        /// PCL 模式：清掉模块路径那套，只保留「client jar + 全部库」的 -cp
        /// </summary>
        private static bool SimpleClasspathMode(string versionId, string mainClass, List<string> jvmArgs, List<string> gameArgs, string mcDir, string tag, bool keepLegacyClassPath = false, bool javaIs8 = true, bool keepModulePath = false)
        {
            int removed = 0;

            // 1) 移除 -DlegacyClassPath（1.16.x modlauncher 需要保留，否则找不到 fmlclient 等 launch target）
            if (!keepLegacyClassPath)
                for (int i = jvmArgs.Count - 1; i >= 0; i--)
                    if (jvmArgs[i].StartsWith("-DlegacyClassPath=")) { jvmArgs.RemoveAt(i); removed++; }

            // 2) 移除 -p / --module-path（连值）
            //    ⚠️ 1.17+ Forge/NeoForge 的 BootstrapLauncher 必须保留 -p，
            //    否则 JVM 报 "Module org.objectweb.asm not found, required by org.openjdk.nashorn"。
            if (!keepModulePath)
                for (int i = jvmArgs.Count - 1; i >= 0; i--)
                {
                    if (jvmArgs[i] == "-p" || jvmArgs[i] == "--module-path")
                    {
                        if (i + 1 < jvmArgs.Count) jvmArgs.RemoveAt(i + 1);
                        jvmArgs.RemoveAt(i);
                        removed += 2;
                    }
                }

            // 3) 移除 --add-modules / ALL-MODULE-PATH
            if (!keepModulePath)
                for (int i = jvmArgs.Count - 1; i >= 0; i--)
                    if (jvmArgs[i] == "--add-modules" || jvmArgs[i] == "ALL-MODULE-PATH") { jvmArgs.RemoveAt(i); removed++; }
            // 4) 移除模块化专属参数：--add-opens / --add-exports
            //    ⚠️ 只有 Java 8 才需要删除（Java 8 不认识这些选项 → Unrecognized option → JVM 秒退）。
            //    ⭐ 1.16.5 Forge 36.2.42 实测要用 Java 17 启动（PCL 用的就是 java-runtime-delta = Java 17），
            //    这种情况必须保留 --add-exports / --add-opens，否则 ModLauncher 起不来。
            if (javaIs8)
            {
                for (int i = jvmArgs.Count - 1; i >= 0; i--)
                {
                    var a = jvmArgs[i];
                    if (a.StartsWith("--add-opens") || a.StartsWith("--add-exports"))
                    {
                        // 若开关后面跟的是值（不以 - 开头），必须成对删除，
                        // 否则残留的 java.base/java.util.jar=xxx 会被 Java 当成主类名。
                        bool hasValue = (i + 1 < jvmArgs.Count) && !jvmArgs[i + 1].StartsWith("-");
                        jvmArgs.RemoveAt(i);
                        if (hasValue && i < jvmArgs.Count) jvmArgs.RemoveAt(i);
                        removed++;
                    }
                    else if (a.Contains("--add-opens=") || a.Contains("--add-exports="))
                    {
                        jvmArgs.RemoveAt(i);
                        removed++;
                    }
                }
            }

            // 5) 清理「裸 classpath」参数（统一走 StripBareClasspath，避免两套判定不一致）
            removed += StripBareClasspath(jvmArgs, tag);

            // 6) 重建 -cp：client jar + 全部库
            int cpIdx = jvmArgs.IndexOf("-cp");
            if (cpIdx >= 0) { if (cpIdx + 1 < jvmArgs.Count) jvmArgs.RemoveAt(cpIdx + 1); jvmArgs.RemoveAt(cpIdx); }

            var realMc = ResolveMcVersion(mcDir, versionId);
            var parts = new List<string>();
            var jar = Path.Combine(mcDir, "versions", realMc, realMc + ".jar");
            if (File.Exists(jar)) parts.Add(jar);
            parts.AddRange(CollectLibraries(mcDir, versionId));

            if (parts.Count == 0)
            {
                DiagnosticLogger.Instance.Warn($"[Patch] {tag} {versionId}: 找不到任何 jar，跳过");
                return false;
            }

            jvmArgs.Insert(0, "-cp");
            jvmArgs.Insert(1, string.Join(";", parts));

            // 7) 1.16.x modlauncher 需要 -DlegacyClassPath（不含 client jar），
            //    否则 ModLauncher 扫不到 forge jar 里注册的 launch target（报 Cannot find launch target fmlclient）。
            //    主程序那段注入代码有括号错位、不可靠，这里自己按 parts 重建。
            if (keepLegacyClassPath)
            {
                for (int i = jvmArgs.Count - 1; i >= 0; i--)
                    if (jvmArgs[i].StartsWith("-DlegacyClassPath=")) jvmArgs.RemoveAt(i);

                var legacy = parts.Where(p => !p.Equals(jar, StringComparison.OrdinalIgnoreCase)).ToList();
                jvmArgs.Insert(0, "-DlegacyClassPath=" + string.Join(";", legacy));
                DiagnosticLogger.Instance.Info($"[Patch] {tag} {versionId}: 重建 -DlegacyClassPath（{legacy.Count} 项，不含 client jar）");
            }

            DiagnosticLogger.Instance.Info($"[Patch] {tag} {versionId}: 改用纯 -cp 模式（{parts.Count} 项），移除 {removed} 个模块参数");
            // ⭐ 老 Forge 需要 --tweakClass（从 minecraftArguments 老格式里抠）
            AddTweakClass(versionId, gameArgs, mcDir);
            return true;
        }

        /// <summary>从 jar 完整路径推出版本号（取倒数第二段目录名）。</summary>
        private static string VersionOfName(string fullPath)
        {
            try
            {
                var dir = Path.GetDirectoryName(fullPath);
                if (!string.IsNullOrEmpty(dir)) return Path.GetFileName(dir);
            }
            catch { }
            return "";
        }

        /// <summary>比较版本串：a>b 返 1，相等 0，a<b 返 -1。</summary>
        private static int CompareVer(string a, string b)
        {
            if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) return 0;
            var pa = (a ?? "").Split(new[] { '.', '-', '_' });
            var pb = (b ?? "").Split(new[] { '.', '-', '_' });
            int n = Math.Max(pa.Length, pb.Length);
            for (int i = 0; i < n; i++)
            {
                var sa = i < pa.Length ? pa[i] : "0";
                var sb = i < pb.Length ? pb[i] : "0";
                long na, nb;
                if (long.TryParse(sa, out na) && long.TryParse(sb, out nb))
                {
                    if (na != nb) return na > nb ? 1 : -1;
                }
                else
                {
                    var c = string.Compare(sa, sb, StringComparison.OrdinalIgnoreCase);
                    if (c != 0) return c > 0 ? 1 : -1;
                }
            }
            return 0;
        }

        /// <summary>沿继承链收集所有库的本地路径（去重）</summary>
        private static List<string> CollectLibraries(string mcDir, string versionId)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // group/artifact -> 在 result 里的下标，用于「同 artifact 保留最后一版」去重
            var gaIndex = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var cur = versionId;

            for (int depth = 0; depth < 6 && !string.IsNullOrEmpty(cur); depth++)
            {
                var jp = Path.Combine(mcDir, "versions", cur, cur + ".json");
                if (!File.Exists(jp)) break;
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(jp));
                    var root = doc.RootElement;
                    if (root.TryGetProperty("libraries", out var arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var lib in arr.EnumerateArray())
                        {
                            // 优先用 downloads.artifact.path；老版本（1.7.10/1.12.2）没有该字段，从 name 推导
                            string rel = null;
                            string ga = null; // group:artifact，用于跨版本去重
                            var nm0 = lib.TryGetProperty("name", out var nmEl0) ? (nmEl0.GetString() ?? "") : "";
                            var ps0 = nm0.Split(':');
                            if (ps0.Length == 3) ga = ps0[0] + ":" + ps0[1];
                            // 带 classifier 的（natives-windows 等）不参与跨版本去重，避免把主 jar 顶掉

                            if (lib.TryGetProperty("downloads", out var dl) && dl.TryGetProperty("artifact", out var art))
                                rel = art.TryGetProperty("path", out var pEl) ? pEl.GetString() : null;
                            if (string.IsNullOrEmpty(rel))
                            {
                                var ps = nm0.Split(':');
                                if (ps.Length >= 3)
                                {
                                    var grp = ps[0].Replace('.', '/');
                                    var art2 = ps[1];
                                    var ver = ps[2];
                                    var cls = ps.Length > 3 ? "-" + ps[3] : "";
                                    rel = grp + "/" + art2 + "/" + ver + "/" + art2 + "-" + ver + cls + ".jar";
                                }
                            }
                            if (string.IsNullOrEmpty(rel)) continue;
                            var full = Path.Combine(mcDir, "libraries", rel.Replace('/', Path.DirectorySeparatorChar));
                            if (!File.Exists(full)) continue;

                            // ⭐ 同 group:artifact 去重：保留「版本号更高」的那个，而不是靠出现顺序。
                            //    1.16.5.json 同时列 3.2.1 和 3.2.2；父版本(1.16.5)先合入、Forge 覆盖层在后，
                            //    仅按顺序删旧留新不可靠 → 会留下 3.2.1 造成 jemalloc/JNI 崩溃。
                            if (!string.IsNullOrEmpty(ga))
                            {
                                // 只有「不同文件」才需要覆盖；同一个文件重复出现直接跳过，避免日志刷屏。
                                if (gaIndex.TryGetValue(ga, out var oldPath)
                                    && !string.Equals(oldPath, full, StringComparison.OrdinalIgnoreCase))
                                {
                                    int oldIdx = result.IndexOf(oldPath);
                                    if (oldIdx >= 0)
                                    {
                                        var oldVer = VersionOfName(oldPath);
                                        var newVer = VersionOfName(full);
                                        if (CompareVer(newVer, oldVer) < 0)
                                            continue; // 新来的版本更低 → 保留旧的
                                        result.RemoveAt(oldIdx);
                                        seen.Remove(oldPath);
                                        DiagnosticLogger.Instance.Info($"[Patch] {versionId}: 版本覆盖 {Path.GetFileName(oldPath)} -> {Path.GetFileName(full)}");
                                    }
                                }
                                gaIndex[ga] = full;
                            }
                            if (seen.Add(full)) result.Add(full);
                        }
                    }
                    cur = root.TryGetProperty("inheritsFrom", out var inh) ? (inh.GetString() ?? "") : "";
                }
                catch { break; }
            }
            return result;
        }

        /// <summary>找真正带 client jar 的版本</summary>
        private static string ResolveMcVersion(string mcDir, string versionId)
        {
            var cur = versionId;
            for (int depth = 0; depth < 6 && !string.IsNullOrEmpty(cur); depth++)
            {
                if (File.Exists(Path.Combine(mcDir, "versions", cur, cur + ".jar"))) return cur;
                var jp = Path.Combine(mcDir, "versions", cur, cur + ".json");
                if (!File.Exists(jp)) break;
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(jp));
                    cur = doc.RootElement.TryGetProperty("inheritsFrom", out var inh) ? (inh.GetString() ?? "") : "";
                }
                catch { break; }
            }
            return versionId;
        }

        /// <summary>老版本 Forge（1.7.10/1.12.2）需要 --tweakClass，写在 minecraftArguments 字符串里</summary>
        private static void AddTweakClass(string versionId, List<string> gameArgs, string mcDir)
        {
            if (gameArgs == null || gameArgs.Any(a => a == "--tweakClass")) return;
            var cur = versionId;
            for (int d = 0; d < 6 && !string.IsNullOrEmpty(cur); d++)
            {
                var jp = Path.Combine(mcDir, "versions", cur, cur + ".json");
                if (!File.Exists(jp)) break;
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(jp));
                    var root = doc.RootElement;
                    if (root.TryGetProperty("minecraftArguments", out var maEl))
                    {
                        var ma = maEl.GetString() ?? "";
                        var i2 = ma.IndexOf("--tweakClass", StringComparison.OrdinalIgnoreCase);
                        if (i2 >= 0)
                        {
                            var rest = ma.Substring(i2 + 13).Trim();
                            var val = rest.Split(' ')[0];
                            if (!string.IsNullOrEmpty(val))
                            {
                                gameArgs.Add("--tweakClass");
                                gameArgs.Add(val);
                                DiagnosticLogger.Instance.Info($"[Patch] 老 Forge 补 --tweakClass {val}");
                                return;
                            }
                        }
                    }
                    cur = root.TryGetProperty("inheritsFrom", out var inh) ? (inh.GetString() ?? "") : "";
                }
                catch { break; }
            }
        }
    }
}
