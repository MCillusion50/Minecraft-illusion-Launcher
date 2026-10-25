using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    public class ModDependency
    {
        public string Id { get; set; }
        public string VersionRange { get; set; }
        public bool IsMandatory { get; set; } = true;
    }

    public class ModInfo
    {
        public string FileName { get; set; }
        public string Id { get; set; }
        public string Name { get; set; }
        public string Version { get; set; }
        public List<ModDependency> Depends { get; set; } = new List<ModDependency>();
        public List<string> MixinTargets { get; set; } = new List<string>();
        public string LoaderType { get; set; } // "fabric" / "forge"
    }

    public class ModConflictResult
    {
        public string Title { get; set; }       // 简短标题，如 "严重冲突"
        public string Message { get; set; }     // 详细说明
        public string Level { get; set; }       // "error" 或 "warning"
    }

    public static class ModConflictScanner
    {
        // ⭐ 必死的硬冲突对
        private static readonly List<(string id1, string id2, string reason)> KnownConflicts = new()
        {
            ("optifine", "sodium", "OptiFine 与 Sodium 渲染机制不兼容，会导致游戏黑屏或崩溃。请二选一。"),
            ("optifine", "embeddium", "OptiFine 与 Embeddium 冲突，请二选一。"),
            ("optifine", "iris", "OptiFine 与 Iris 光影系统冲突。如果要在 Forge 用光影，请用 Oculus。"),
            ("sodium", "embeddium", "Sodium (Fabric) 和 Embeddium (Forge) 是同源产品，不能同时装。"),
            ("oculus", "iris", "Oculus 是 Forge 的 Iris 移植版，不能交叉混装。"),
            ("jei", "rei", "JEI 与 REI 物品管理器冲突，会导致配方列表崩溃。"),
            ("xaeros_minimap", "journeymap", "Xaero 小地图与 JourneyMap 冲突，会导致严重掉帧和地图数据错乱。")
        };

        // ⭐ 新增了 IProgress<string> progress 参数
        public static async Task<List<ModConflictResult>> CheckConflictsAsync(string modsDir, string targetMcVersion, IProgress<string> progress = null)
        {
            var results = new List<ModConflictResult>();
            if (!Directory.Exists(modsDir)) return results;

            var mods = new Dictionary<string, ModInfo>(StringComparer.OrdinalIgnoreCase);
            var mixinScanner = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            var files = Directory.GetFiles(modsDir, "*.jar", SearchOption.TopDirectoryOnly);

            int total = files.Length;
            int current = 0;

            // 1. 解析所有 JAR
            foreach (var file in files)
            {
                current++;
                progress?.Report($"正在安检模组 ({current}/{total}) ...");

                try
                {
                    var info = await ExtractModInfoAsync(file, targetMcVersion);
                    if (info == null || string.IsNullOrEmpty(info.Id)) continue;
                    info.FileName = Path.GetFileName(file);

                    // 检测加载器混装 (只查死敌：Forge 和 Fabric)
                    if (mods.Any(m => m.Value.LoaderType != info.LoaderType && m.Value.LoaderType != null))
                    {
                        bool isFatalMix = (info.LoaderType == "fabric" && mods.Values.Any(m => m.LoaderType == "forge")) ||
                                          (info.LoaderType == "forge" && mods.Values.Any(m => m.LoaderType == "fabric"));
                        if (isFatalMix)
                        {
                            results.Add(new ModConflictResult
                            {
                                Title = "加载器混装",
                                Message = $"发现 {info.LoaderType} 模组【{info.Name}】混入了其他加载器的环境中。请清理。",
                                Level = "error"
                            });
                        }
                    }

                    // 检测重复 ID
                    if (mods.ContainsKey(info.Id))
                    {
                        results.Add(new ModConflictResult
                        {
                            Title = "重复模组",
                            Message = $"发现多个【{info.Name}】({info.Id})\n请删除多余的版本，否则必崩！",
                            Level = "error"
                        });
                    }
                    else
                    {
                        mods[info.Id] = info;
                    }

                    // 记录 Mixin
                    foreach (var target in info.MixinTargets)
                    {
                        if (!mixinScanner.ContainsKey(target))
                            mixinScanner[target] = new List<string>();
                        mixinScanner[target].Add(info.Name);
                    }
                }
                catch { }
            }

            progress?.Report("正在校验模组依赖关系...");

            // 2. 依赖缺失校验（通用排除法）
            // 只要系统里装了 fabric-api 或 quilted-fabric-api 或 forge，就默认满足 fabric 内部 API 依赖
            bool hasFabricApi = mods.ContainsKey("fabric-api") || mods.ContainsKey("fabric") || mods.ContainsKey("quilted-fabric-api");
            bool hasForge = mods.Keys.Any(k => k.Contains("forge"));

            foreach (var mod in mods.Values)
            {
                foreach (var dep in mod.Depends)
                {
                    // 基础过滤
                    if (dep.Id == "minecraft" || dep.Id == "java" || dep.Id == "fabricloader" || dep.Id == "forge" || dep.Id == "neoforge") continue;
                    // 很多模组（比如 Xaero 系列）会把前置直接打包在自己的 jar 里，但元数据没改
                    if (dep.Id == "xaerolib" || dep.Id == "yacl" || dep.Id == "fabric-language-kotlin") continue;
                    // 核心：如果是 Fabric 内部子模块，且系统里装了 fabric-api，直接放过
                    if ((dep.Id.StartsWith("fabric-") || dep.Id.StartsWith("fabric_")) && hasFabricApi) continue;
                    if (dep.Id.StartsWith("forge-") && hasForge) continue;

                    if (!mods.ContainsKey(dep.Id) && dep.IsMandatory)
                    {
                        results.Add(new ModConflictResult
                        {
                            Title = "缺失前置",
                            Message = $"【{mod.Name}】必须依赖【{dep.Id}】运行，请前往下载前置模组。",
                            Level = "error"
                        });
                    }
                }
            }

            // 3. 黑名单硬冲突（只留必死的）
            foreach (var conflict in KnownConflicts)
            {
                if (mods.ContainsKey(conflict.id1) && mods.ContainsKey(conflict.id2))
                {
                    results.Add(new ModConflictResult
                    {
                        Title = "严重冲突",
                        Message = $"【{mods[conflict.id1].Name}】与【{mods[conflict.id2].Name}】不兼容！\n原因：{conflict.reason}",
                        Level = "error"
                    });
                }
            }

            return results;
        }
        private static async Task<ModInfo> ExtractModInfoAsync(string jarPath, string targetMcVersion)
        {
            using var zip = ZipFile.OpenRead(jarPath);
            var info = new ModInfo();

            // --- 提取 Mixin 记录 ---
            var mixinEntries = zip.Entries.Where(e => e.FullName.EndsWith(".mixins.json") || e.FullName.EndsWith(".mixin.json"));
            foreach (var entry in mixinEntries)
            {
                using var mReader = new StreamReader(entry.Open());
                var mJson = await mReader.ReadToEndAsync();
                try
                {
                    var mDoc = JsonDocument.Parse(mJson).RootElement;
                    if (mDoc.TryGetProperty("mixins", out var mixins))
                    {
                        foreach (var mx in mixins.EnumerateArray())
                        {
                            info.MixinTargets.Add(mx.GetString());
                        }
                    }
                }
                catch { }
            }

            // --- Fabric 解析 ---
            var fabricEntry = zip.GetEntry("fabric.mod.json");
            if (fabricEntry != null)
            {
                info.LoaderType = "fabric";
                using var reader = new StreamReader(fabricEntry.Open());
                var json = await reader.ReadToEndAsync();
                var doc = JsonDocument.Parse(json).RootElement;
                info.Id = doc.TryGetProperty("id", out var id) ? id.GetString() : null;
                info.Name = doc.TryGetProperty("name", out var n) ? n.GetString() : info.Id;
                info.Version = doc.TryGetProperty("version", out var v) ? v.GetString() : "Unknown";

                if (doc.TryGetProperty("depends", out var depends))
                {
                    foreach (var prop in depends.EnumerateObject())
                    {
                        info.Depends.Add(new ModDependency { Id = prop.Name, VersionRange = prop.Value.ToString() });
                    }
                }
                return info;
            }

            // --- Forge/NeoForge 解析 ---
            var forgeEntry = zip.GetEntry("META-INF/mods.toml");
            if (forgeEntry != null)
            {
                info.LoaderType = "forge";
                using var reader = new StreamReader(forgeEntry.Open());
                var toml = await reader.ReadToEndAsync();

                var modIdMatch = Regex.Match(toml, @"modId\s*=\s*""([^""]+)""");
                if (modIdMatch.Success) info.Id = modIdMatch.Groups[1].Value;

                var nameMatch = Regex.Match(toml, @"displayName\s*=\s*""([^""]+)""");
                info.Name = nameMatch.Success ? nameMatch.Groups[1].Value : info.Id;

                var verMatch = Regex.Match(toml, @"version\s*=\s*""([^""]+)""");
                info.Version = verMatch.Success ? verMatch.Groups[1].Value : "Unknown";

                // 提取强制依赖
                var depMatches = Regex.Matches(toml, @"\[\[dependencies\..*?\]\](?:(?!\[\[).)*?modId\s*=\s*""([^""]+)""(?:(?!\[\[).)*?mandatory\s*=\s*true", RegexOptions.Singleline);
                foreach (Match m in depMatches)
                {
                    var depId = m.Groups[1].Value;
                    if (depId != "minecraft" && depId != "forge" && depId != "neoforge")
                        info.Depends.Add(new ModDependency { Id = depId, IsMandatory = true });
                }
                return info;
            }

            return null;
        }
    }
}