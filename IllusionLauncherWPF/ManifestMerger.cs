using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace IllusionLauncherWPF
{
    /// <summary>合并后的单个库条目</summary>
    public sealed class MergedLibrary
    {
        public string Name = "";
        public string Path = "";       // downloads.artifact.path
        public string Url = "";        // downloads.artifact.url
        public string FullPath = "";   // 本地绝对路径
        public bool Exists;
    }

    /// <summary>唯一数据源：从版本 json 继承链一次性合并出的完整模型</summary>
    public sealed class MergedVersionModel
    {
        public string Id = "";
        public string MainClass = "";
        public string InheritsFrom = "";
        public string MinecraftVersion = "";   // 真正带 client jar 的版本
        public string ClientJar = "";
        public int JavaMajorVersion = 0;
        public string Assets = "";
        public string AssetIndexId = "";

        public List<MergedLibrary> Libraries = new List<MergedLibrary>();
        public List<string> JvmArguments = new List<string>();
        public List<string> GameArguments = new List<string>();

        /// <summary>是否存在 module path（Forge/NeoForge 标志）</summary>
        public bool HasModulePath =>
            JvmArguments.Any(a => a == "-p" || a == "--module-path");

        /// <summary>是否 NeoForge 系（仅用于旧逻辑兼容判断）</summary>
        public bool IsNeoForge =>
            Id.IndexOf("neoforge", StringComparison.OrdinalIgnoreCase) >= 0;

        public override string ToString() =>
            $"{Id}: main={MainClass}, mc={MinecraftVersion}, libs={Libraries.Count}, " +
            $"jvm={JvmArguments.Count}, game={GameArguments.Count}, modulePath={HasModulePath}";
    }

    /// <summary>
    /// 唯一的版本 json 合并器。所有需要"读继承链"的地方都应走这里，禁止再手写遍历。
    /// </summary>
    public static class ManifestMerger
    {
        private const int MaxDepth = 8;

        /// <summary>原始 json 链（子 → 父），不合并、不注入</summary>
        public static List<(string Id, JsonDocument Doc)> GetRawChain(string mcDir, string versionId)
        {
            var chain = new List<(string, JsonDocument)>();
            var cur = versionId;
            for (int depth = 0; depth < MaxDepth && !string.IsNullOrEmpty(cur); depth++)
            {
                var jsonPath = Path.Combine(mcDir, "versions", cur, cur + ".json");
                if (!File.Exists(jsonPath)) break;
                JsonDocument doc;
                try { doc = JsonDocument.Parse(File.ReadAllText(jsonPath)); }
                catch (Exception ex)
                {
                    DiagnosticLogger.Instance.Warn($"[Merger] {cur}.json 解析失败: {ex.Message}");
                    break;
                }
                chain.Add((cur, doc));
                cur = doc.RootElement.TryGetProperty("inheritsFrom", out var inh)
                    ? (inh.GetString() ?? "")
                    : "";
            }
            return chain;
        }

        /// <summary>找到真正带 client jar 的版本号（轻量，只读链不合并）</summary>
        public static string ResolveMinecraftVersion(string mcDir, string versionId)
        {
            foreach (var (id, _) in GetRawChain(mcDir, versionId))
            {
                if (File.Exists(Path.Combine(mcDir, "versions", id, id + ".jar"))) return id;
            }
            return versionId;
        }

        /// <summary>合并出完整模型（子优先，参数父→子拼接）</summary>
        public static MergedVersionModel Merge(string mcDir, string versionId)
        {
            var model = new MergedVersionModel { Id = versionId };
            var chain = GetRawChain(mcDir, versionId);
            if (chain.Count == 0)
            {
                DiagnosticLogger.Instance.Warn($"[Merger] 找不到版本 {versionId} 的 json");
                return model;
            }

            var libsDir = Path.Combine(mcDir, "libraries");

            // ---- 标量字段：子优先，父补齐 ----
            foreach (var key in new[] { "mainClass", "assets", "inheritsFrom" })
            {
                var v = FirstString(chain, key);
                if (v == null) continue;
                if (key == "mainClass") model.MainClass = v;
                else if (key == "assets") model.Assets = v;
                else model.InheritsFrom = v;
            }
            model.AssetIndexId = FirstString(chain, "assetIndex", "id") ?? "";
            var javaMajor = FirstInt(chain, "javaVersion", "majorVersion");
            model.JavaMajorVersion = javaMajor ?? 0;

            // ---- arguments：父在前、子在后 ----
            for (int i = chain.Count - 1; i >= 0; i--)
            {
                foreach (var a in ReadArgumentArray(chain[i].Doc.RootElement, "jvm"))
                    model.JvmArguments.Add(a);
                foreach (var a in ReadArgumentArray(chain[i].Doc.RootElement, "game"))
                    model.GameArguments.Add(a);
            }
            RewriteVariablePlaceholders(model, mcDir);

            // ---- libraries：按 group:artifact 去重，子优先 ----
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < chain.Count; i++)   // 子在前
            {
                if (!chain[i].Doc.RootElement.TryGetProperty("libraries", out var arr) ||
                    arr.ValueKind != JsonValueKind.Array) continue;
                foreach (var lib in arr.EnumerateArray())
                {
                    if (!lib.TryGetProperty("downloads", out var dl) ||
                        !dl.TryGetProperty("artifact", out var art)) continue;
                    var rel = art.TryGetProperty("path", out var pEl) ? pEl.GetString() : null;
                    if (string.IsNullOrEmpty(rel)) continue;

                    var name = lib.TryGetProperty("name", out var nEl) ? (nEl.GetString() ?? "") : rel;
                    var key = DedupKey(name);
                    if (!seen.Add(key)) continue;

                    var full = Path.Combine(libsDir, rel.Replace('/', Path.DirectorySeparatorChar));
                    model.Libraries.Add(new MergedLibrary
                    {
                        Name = name,
                        Path = rel,
                        Url = art.TryGetProperty("url", out var uEl) ? (uEl.GetString() ?? "") : "",
                        FullPath = full,
                        Exists = File.Exists(full)
                    });
                }
            }

            // ---- 找到真正带 client jar 的版本 ----
            foreach (var (id, _) in chain)
            {
                var jar = Path.Combine(mcDir, "versions", id, id + ".jar");
                if (File.Exists(jar))
                {
                    model.MinecraftVersion = id;
                    model.ClientJar = jar;
                    break;
                }
            }
            if (string.IsNullOrEmpty(model.MinecraftVersion) && chain.Count > 0)
                model.MinecraftVersion = chain[chain.Count - 1].Id;   // 兜底用最底层父版本

            DiagnosticLogger.Instance.Info($"[Merger] {model}");
            return model;
        }

        // ---------------- 内部工具 ----------------

        private static string DedupKey(string libName)
        {
            // name 形如 group:artifact:version[:classifier]
            var parts = libName.Split(':');
            return parts.Length >= 2 ? parts[0] + ":" + parts[1] : libName;
        }

        private static string FirstString(List<(string Id, JsonDocument Doc)> chain, params string[] path)
        {
            foreach (var (_, doc) in chain)
            {
                if (TryGetByPath(doc.RootElement, path, out var el) && el.ValueKind == JsonValueKind.String)
                    return el.GetString();
            }
            return null;
        }

        private static int? FirstInt(List<(string Id, JsonDocument Doc)> chain, params string[] path)
        {
            foreach (var (_, doc) in chain)
            {
                if (TryGetByPath(doc.RootElement, path, out var el) && el.ValueKind == JsonValueKind.Number &&
                    el.TryGetInt32(out var v))
                    return v;
            }
            return null;
        }

        private static bool TryGetByPath(JsonElement root, string[] path, out JsonElement result)
        {
            result = root;
            foreach (var key in path)
            {
                if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty(key, out result))
                    return false;
            }
            return true;
        }

        /// <summary>读取 arguments.jvm / arguments.game，兼容字符串数组与 {rules,value} 对象</summary>
        private static IEnumerable<string> ReadArgumentArray(JsonElement root, string kind)
        {
            if (!root.TryGetProperty("arguments", out var args) ||
                !args.TryGetProperty(kind, out var arr) ||
                arr.ValueKind != JsonValueKind.Array) yield break;

            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                {
                    var s = item.GetString();
                    if (!string.IsNullOrEmpty(s)) yield return s;
                }
                else if (item.ValueKind == JsonValueKind.Object &&
                         item.TryGetProperty("value", out var val))
                {
                    // 简化：忽略 rules 判断，直接取 value（Windows + 离线场景）
                    if (val.ValueKind == JsonValueKind.String)
                    {
                        var s = val.GetString();
                        if (!string.IsNullOrEmpty(s)) yield return s;
                    }
                    else if (val.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var v in val.EnumerateArray())
                        {
                            if (v.ValueKind != JsonValueKind.String) continue;
                            var s = v.GetString();
                            if (!string.IsNullOrEmpty(s)) yield return s;
                        }
                    }
                }
            }
        }

        /// <summary>把 ${...} 占位符替换成实际值（参数组装阶段之前完成）</summary>
        private static void RewriteVariablePlaceholders(MergedVersionModel model, string mcDir)
        {
            var librariesDir = Path.Combine(mcDir, "libraries");
            string Fix(string s) => s
                .Replace("${library_directory}", librariesDir)
                .Replace("${classpath_separator}", ";")
                .Replace("${version_name}", model.Id)
                .Replace("${game_directory}", Path.Combine(mcDir, "versions", model.Id))
                .Replace("${assets_root}", Path.Combine(mcDir, "assets"))
                .Replace("${assets_index_name}", model.AssetIndexId);

            for (int i = 0; i < model.JvmArguments.Count; i++)
                model.JvmArguments[i] = Fix(model.JvmArguments[i]);
            // game 参数里的 ${auth_*} 等由启动阶段填充，这里只处理路径类
            for (int i = 0; i < model.GameArguments.Count; i++)
                model.GameArguments[i] = Fix(model.GameArguments[i]);
        }
    }
}
