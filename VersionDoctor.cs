using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace IllusionLauncherWPF
{
    /// <summary>单个版本的健康状况</summary>
    public class VersionHealth
    {
        public string Name = "";
        public string JsonState = "ok";          // ok / missing / invalid
        public string ParentState = "n/a";       // ok / missing / n/a
        public bool FlattenBroken = false;       // 无 inheritsFrom 但缺关键库（扁平化失败残留）
        public bool HasBackup = false;           // 存在 .json.bak
        public int LibTotal = 0;
        public int LibMissing = 0;
        public bool AssetsIndexOk = true;
        public string AssetsIndexId = "";
        public int DuplicateMods = 0;
        public List<string> Problems = new List<string>();

        public bool Healthy => Problems.Count == 0;
        public bool Repairable => !(JsonState == "invalid" && !HasBackup);
    }

    /// <summary>
    /// 全版本智能体检 / 修复。
    /// 只读扫描 + 安全修复，所有破坏性操作前都会备份。
    /// </summary>
    public static class VersionDoctor
    {
        /// <summary>扫描全部版本</summary>
        public static List<VersionHealth> Scan(string mcDir, string assetsDir)
        {
            var list = new List<VersionHealth>();
            var versionsDir = Path.Combine(mcDir, "versions");
            if (!Directory.Exists(versionsDir)) return list;

            foreach (var dir in Directory.GetDirectories(versionsDir))
            {
                var name = Path.GetFileName(dir);
                var h = new VersionHealth { Name = name };
                var jsonPath = Path.Combine(dir, name + ".json");

                if (!File.Exists(jsonPath))
                {
                    h.JsonState = "missing";
                    h.Problems.Add("缺少版本 json");
                    list.Add(h);
                    continue;
                }

                JsonDocument doc;
                try { doc = JsonDocument.Parse(File.ReadAllText(jsonPath)); }
                catch
                {
                    h.JsonState = "invalid";
                    h.HasBackup = File.Exists(jsonPath + ".bak");
                    h.Problems.Add("json 语法损坏");
                    if (h.HasBackup) h.Problems.Add("可从 .bak 恢复");
                    list.Add(h);
                    continue;
                }

                using (doc)
                {
                    var root = doc.RootElement;
                    string inherits = root.TryGetProperty("inheritsFrom", out var inh) ? (inh.GetString() ?? "") : "";

                    // ② 扁平化破损：无 inheritsFrom、却有 libraries 但缺关键库
                    int libCount = 0;
                    var libNames = new List<string>();
                    if (root.TryGetProperty("libraries", out var libsEl) && libsEl.ValueKind == JsonValueKind.Array)
                    {
                        libCount = libsEl.GetArrayLength();
                        foreach (var l in libsEl.EnumerateArray())
                            if (l.TryGetProperty("name", out var n)) libNames.Add(n.GetString() ?? "");
                    }

                    h.HasBackup = File.Exists(jsonPath + ".bak");
                    if (string.IsNullOrEmpty(inherits) && libCount > 0)
                    {
                        bool hasClient = libNames.Any(n => n.Contains("minecraft:client"));
                        bool hasLwjgl = libNames.Any(n => n.Contains("lwjgl"));
                        if (!hasClient || !hasLwjgl)
                        {
                            h.FlattenBroken = true;
                            h.Problems.Add($"扁平化不完整（{libCount} 个库，缺原版核心库）");
                            if (h.HasBackup) h.Problems.Add("可从 .bak 恢复为继承模式");
                        }
                    }

                    // ③ 父版本存在性
                    if (!string.IsNullOrEmpty(inherits))
                    {
                        var parentDir = Path.Combine(versionsDir, inherits);
                        var parentJson = Path.Combine(parentDir, inherits + ".json");
                        if (!Directory.Exists(parentDir) || !File.Exists(parentJson))
                        {
                            h.ParentState = "missing";
                            h.Problems.Add($"父版本缺失：{inherits}");
                        }
                        else h.ParentState = "ok";
                    }

                    // ⑤ assets 索引
                    if (root.TryGetProperty("assetIndex", out var ai) && ai.ValueKind == JsonValueKind.Object
                        && ai.TryGetProperty("id", out var aiId))
                    {
                        h.AssetsIndexId = aiId.GetString() ?? "";
                        if (!string.IsNullOrEmpty(h.AssetsIndexId))
                        {
                            var idx = Path.Combine(assetsDir, "indexes", h.AssetsIndexId + ".json");
                            if (!File.Exists(idx))
                            {
                                h.AssetsIndexOk = false;
                                h.Problems.Add($"assets 索引缺失：{h.AssetsIndexId}");
                            }
                        }
                    }
                }

                // ④ 库文件逐个核对（仅对本版本 json 里声明的，继承的由父版本负责）
                CheckLibraries(mcDir, jsonPath, h);

                // ⑥ mods 目录重复
                CheckDuplicateMods(Path.Combine(dir, "mods"), h);

                list.Add(h);
            }

            return list;
        }

        /// <summary>核对本版本 json 里声明的库文件是否真实存在</summary>
        private static void CheckLibraries(string mcDir, string jsonPath, VersionHealth h)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
                if (!doc.RootElement.TryGetProperty("libraries", out var libs) || libs.ValueKind != JsonValueKind.Array)
                    return;

                foreach (var lib in libs.EnumerateArray())
                {
                    // 跳过 macOS / Linux 专用
                    if (lib.TryGetProperty("rules", out var rules))
                    {
                        bool appliesToWindows = true;
                        foreach (var r in rules.EnumerateArray())
                        {
                            var action = r.TryGetProperty("action", out var a) ? a.GetString() : "";
                            if (action != "allow") continue;
                            if (r.TryGetProperty("os", out var os) && os.TryGetProperty("name", out var osName))
                            {
                                var n = osName.GetString() ?? "";
                                if (n != "windows") appliesToWindows = false;
                            }
                        }
                        if (!appliesToWindows) continue;
                    }
                    // natives 形态的库不算主文件
                    if (lib.TryGetProperty("natives", out _)) continue;

                    h.LibTotal++;

                    string relPath = null;
                    if (lib.TryGetProperty("downloads", out var dl) && dl.TryGetProperty("artifact", out var art)
                        && art.TryGetProperty("path", out var p))
                    {
                        relPath = p.GetString();
                    }

                    if (string.IsNullOrEmpty(relPath))
                    {
                        // 退化为按 name 推算
                        var name = lib.TryGetProperty("name", out var nm) ? (nm.GetString() ?? "") : "";
                        relPath = NameToPath(name);
                    }
                    if (string.IsNullOrEmpty(relPath)) continue;

                    var full = Path.Combine(mcDir, "libraries", relPath.Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(full)) h.LibMissing++;
                }

                if (h.LibMissing > 0) h.Problems.Add($"缺少 {h.LibMissing} 个库文件");
            }
            catch (Exception ex) { Debug.WriteLine($"[Doctor] 库校验失败 {jsonPath}: {ex.Message}"); }
        }

        /// <summary>groupId:artifactId:version[:classifier][@ext] → 相对路径</summary>
        public static string NameToPath(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            var ext = ".jar";
            var at = name.IndexOf('@');
            if (at > 0) { ext = "." + name.Substring(at + 1); name = name.Substring(0, at); }

            var parts = name.Split(':');
            if (parts.Length < 3) return null;
            var group = parts[0].Replace('.', '/');
            var artifact = parts[1];
            var version = parts[2];
            var classifier = parts.Length > 3 ? "-" + parts[3] : "";
            return $"{group}/{artifact}/{version}/{artifact}-{version}{classifier}{ext}";
        }

        /// <summary>mods 目录里同一个 mod 存在多个版本</summary>
        private static void CheckDuplicateMods(string modsDir, VersionHealth h)
        {
            try
            {
                if (!Directory.Exists(modsDir)) return;
                var jars = Directory.GetFiles(modsDir, "*.jar");
                var groups = jars.GroupBy(f => NormalizeModName(Path.GetFileNameWithoutExtension(f)))
                                 .Where(g => g.Count() > 1).ToList();
                h.DuplicateMods = groups.Sum(g => g.Count() - 1);
                if (h.DuplicateMods > 0) h.Problems.Add($"{h.DuplicateMods} 个重复 mod（同 mod 多版本）");
            }
            catch (Exception ex) { Debug.WriteLine($"[Doctor] mods 扫描失败: {ex.Message}"); }
        }

        private static string NormalizeModName(string fileName)
        {
            // 去掉常见版本后缀：-1.20.1、_v2.3.4、-forge、+1.19 等
            var s = fileName.ToLowerInvariant();
            s = System.Text.RegularExpressions.Regex.Replace(s, @"[-_+](mc)?\d+(\.\d+)*.*$", "");
            s = System.Text.RegularExpressions.Regex.Replace(s, @"[-_](forge|fabric|neoforge|quilt).*$", "");
            return s;
        }

        /// <summary>从 .bak 恢复（扁平化破损 / json 损坏）</summary>
        public static bool RestoreBackup(string mcDir, string versionName, out string message)
        {
            var dir = Path.Combine(mcDir, "versions", versionName);
            var json = Path.Combine(dir, versionName + ".json");
            var bak = json + ".bak";
            if (!File.Exists(bak)) { message = "没有备份文件"; return false; }
            try
            {
                if (File.Exists(json)) File.Copy(json, json + ".broken", true);
                File.Copy(bak, json, true);
                message = "已从备份恢复";
                return true;
            }
            catch (Exception ex) { message = "恢复失败：" + ex.Message; return false; }
        }
    }
}
