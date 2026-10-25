using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace IllusionLauncherWPF
{
    // ============================================================
    // 数据模型：对齐 Mojang 版本 JSON 规范
    // ============================================================

    public class VersionJson
    {
        [JsonPropertyName("id")] public string Id { get; set; }
        [JsonPropertyName("inheritsFrom")] public string InheritsFrom { get; set; }
        [JsonPropertyName("mainClass")] public string MainClass { get; set; }
        [JsonPropertyName("minecraftArguments")] public string MinecraftArguments { get; set; }
        [JsonPropertyName("arguments")] public ArgumentsJson Arguments { get; set; }
        [JsonPropertyName("libraries")] public List<LibraryEntry> Libraries { get; set; } = new List<LibraryEntry>();
        [JsonPropertyName("assetIndex")] public AssetIndexJson AssetIndex { get; set; }
        [JsonPropertyName("assets")] public string Assets { get; set; }
        [JsonPropertyName("javaVersion")] public JavaVersionJson JavaVersion { get; set; }
        [JsonPropertyName("type")] public string Type { get; set; }

        // 运行时补充：记录这个 JSON 来自哪个版本 ID（合并链时用）
        [JsonIgnore] public string SourceVersionId { get; set; }
    }

    public class ArgumentsJson
    {
        [JsonPropertyName("game")] public List<JsonElement> Game { get; set; } = new List<JsonElement>();
        [JsonPropertyName("jvm")] public List<JsonElement> Jvm { get; set; } = new List<JsonElement>();
    }

    public class LibraryEntry
    {
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("url")] public string Url { get; set; }
        [JsonPropertyName("path")] public string Path { get; set; }
        [JsonPropertyName("rules")] public List<RuleEntry> Rules { get; set; }
        [JsonPropertyName("downloads")] public LibraryDownloads Downloads { get; set; }
        [JsonPropertyName("natives")] public Dictionary<string, string> Natives { get; set; }
        [JsonPropertyName("extract")] public ExtractEntry Extract { get; set; }
    }

    public class LibraryDownloads
    {
        [JsonPropertyName("artifact")] public DownloadArtifact Artifact { get; set; }
        [JsonPropertyName("classifiers")] public Dictionary<string, DownloadArtifact> Classifiers { get; set; }
    }

    public class DownloadArtifact
    {
        [JsonPropertyName("path")] public string Path { get; set; }
        [JsonPropertyName("url")] public string Url { get; set; }
        [JsonPropertyName("sha1")] public string Sha1 { get; set; }
        [JsonPropertyName("size")] public long Size { get; set; }
    }

    public class ExtractEntry
    {
        [JsonPropertyName("exclude")] public List<string> Exclude { get; set; }
    }

    public class RuleEntry
    {
        [JsonPropertyName("action")] public string Action { get; set; }
        [JsonPropertyName("os")] public OsRule Os { get; set; }
        [JsonPropertyName("features")] public Dictionary<string, bool> Features { get; set; }
    }

    public class OsRule
    {
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("arch")] public string Arch { get; set; }
        [JsonPropertyName("version")] public string Version { get; set; }
    }

    public class AssetIndexJson
    {
        [JsonPropertyName("id")] public string Id { get; set; }
        [JsonPropertyName("url")] public string Url { get; set; }
        [JsonPropertyName("sha1")] public string Sha1 { get; set; }
        [JsonPropertyName("size")] public long Size { get; set; }
        [JsonPropertyName("totalSize")] public long TotalSize { get; set; }
    }

    public class JavaVersionJson
    {
        [JsonPropertyName("component")] public string Component { get; set; }
        [JsonPropertyName("majorVersion")] public int MajorVersion { get; set; }
    }

    // ============================================================
    // Maven 坐标：解析 group:artifact:version[:classifier]
    // ============================================================

    public class MavenCoordinate
    {
        public string Group { get; private set; }
        public string Artifact { get; private set; }
        public string Version { get; private set; }
        public string Classifier { get; private set; }

        public bool IsValid => !string.IsNullOrEmpty(Group)
                               && !string.IsNullOrEmpty(Artifact)
                               && !string.IsNullOrEmpty(Version);

        // 解析 "group:artifact:version" 或 "group:artifact:version:classifier"
        public static MavenCoordinate Parse(string name)
        {
            var coord = new MavenCoordinate();
            if (string.IsNullOrWhiteSpace(name)) return coord;

            var parts = name.Split(':');
            if (parts.Length >= 3)
            {
                coord.Group = parts[0];
                coord.Artifact = parts[1];
                coord.Version = parts[2];
                if (parts.Length >= 4) coord.Classifier = parts[3];
            }
            return coord;
        }

        // 相对 libraries 根的路径：group 的 . 换成 /，文件名 artifact-version[-classifier].jar
        public string ToRelativePath()
        {
            if (!IsValid) return null;
            var groupPath = Group.Replace('.', '/');
            var fileName = Artifact + "-" + Version;
            if (!string.IsNullOrEmpty(Classifier)) fileName += "-" + Classifier;
            fileName += ".jar";
            return groupPath + "/" + Artifact + "/" + Version + "/" + fileName;
        }

        // 推导下载 URL（官方库前缀），实际下载阶段可替换为 BMCLAPI
        public string ToDownloadUrl(string baseUrl = "https://libraries.minecraft.net/")
        {
            var rel = ToRelativePath();
            if (rel == null) return null;
            if (!baseUrl.EndsWith("/")) baseUrl += "/";
            return baseUrl + rel;
        }

        public override string ToString()
        {
            return IsValid ? $"{Group}:{Artifact}:{Version}" + (string.IsNullOrEmpty(Classifier) ? "" : ":" + Classifier) : "(invalid)";
        }
    }

    // ============================================================
    // 解析器主体（第一版只做：读 JSON + 合并继承链 + 补 Maven 路径）
    // ============================================================

    public static class SmartVersionResolver
    {
        private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true
        };

        // 步骤1：读取并合并继承链
        public static VersionJson LoadMergedVersion(string mcDir, string versionId)
        {
            var chain = new List<VersionJson>();
            var currentId = versionId;
            var guard = 0;

            while (!string.IsNullOrEmpty(currentId) && guard < 20)
            {
                guard++;
                var jsonPath = Path.Combine(mcDir, "versions", currentId, currentId + ".json");
                if (!File.Exists(jsonPath))
                    throw new FileNotFoundException("找不到版本 JSON: " + jsonPath);

                var text = File.ReadAllText(jsonPath);
                var vj = JsonSerializer.Deserialize<VersionJson>(text, JsonOpts);
                if (vj == null)
                    throw new InvalidDataException("版本 JSON 解析失败: " + jsonPath);

                vj.SourceVersionId = currentId;
                chain.Add(vj);
                currentId = vj.InheritsFrom;
            }

            return MergeChain(chain);
        }

        // 合并：子在前父在后。标量字段子优先，libraries 直接拼接不去重
        private static VersionJson MergeChain(List<VersionJson> chain)
        {
            // chain[0] 是最子版本
            var merged = new VersionJson
            {
                Id = chain[0].Id,
                SourceVersionId = chain[0].SourceVersionId,
                Arguments = new ArgumentsJson()
            };

            // 标量字段：从子往父找第一个非空
            merged.MainClass = FirstNonNull(chain.Select(c => c.MainClass));
            merged.MinecraftArguments = FirstNonNull(chain.Select(c => c.MinecraftArguments));
            merged.Assets = FirstNonNull(chain.Select(c => c.Assets));
            merged.Type = FirstNonNull(chain.Select(c => c.Type));
            merged.AssetIndex = chain.Select(c => c.AssetIndex).FirstOrDefault(a => a != null);
            merged.JavaVersion = chain.Select(c => c.JavaVersion).FirstOrDefault(j => j != null);

            // libraries：子在前，父在后，直接拼
            foreach (var vj in chain)
            {
                if (vj.Libraries != null && vj.Libraries.Count > 0)
                    merged.Libraries.AddRange(vj.Libraries);
            }

            // arguments：子在前父在后合并；老版本 minecraftArguments 适配成 game 参数
            foreach (var vj in chain)
            {
                if (vj.Arguments != null)
                {
                    if (vj.Arguments.Game != null) merged.Arguments.Game.AddRange(vj.Arguments.Game);
                    if (vj.Arguments.Jvm != null) merged.Arguments.Jvm.AddRange(vj.Arguments.Jvm);
                }
            }

            // 如果完全没有 arguments.game，但有 minecraftArguments（老版本），拆成参数列表
            if (merged.Arguments.Game.Count == 0 && !string.IsNullOrWhiteSpace(merged.MinecraftArguments))
            {
                foreach (var token in merged.MinecraftArguments.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    merged.Arguments.Game.Add(JsonDocument.Parse(JsonSerializer.Serialize(token)).RootElement.Clone());
                }
            }

            return merged;
        }

        private static string FirstNonNull(IEnumerable<string> values)
        {
            foreach (var v in values)
                if (!string.IsNullOrEmpty(v)) return v;
            return null;
        }

        // 步骤2：把 libraries 里缺 path 的条目补上相对路径（写回 Path 字段）
        // 注意：这一步只补路径，不做规则过滤、不做去重，留给后续版本
        public static void FillMavenPaths(VersionJson version)
        {
            if (version?.Libraries == null) return;
            foreach (var lib in version.Libraries)
            {
                if (lib == null) continue;

                // 已有 path（Mojang 新版 JSON 的 downloads.artifact.path）直接用
                if (!string.IsNullOrEmpty(lib.Path)) continue;
                if (lib.Downloads?.Artifact != null && !string.IsNullOrEmpty(lib.Downloads.Artifact.Path))
                {
                    lib.Path = lib.Downloads.Artifact.Path;
                    continue;
                }

                // 否则从 name 推导
                var coord = MavenCoordinate.Parse(lib.Name);
                if (coord.IsValid)
                    lib.Path = coord.ToRelativePath();
            }
        }

        // 便捷入口：读 JSON + 合并 + 补路径，返回合并后的 VersionJson
        // 便捷入口：读 JSON + 合并 + 补路径，返回合并后的 VersionJson
        public static VersionJson ResolveRaw(string mcDir, string versionId)
        {
            var merged = LoadMergedVersion(mcDir, versionId);
            FillMavenPaths(merged);         // 先推导所有基础路径
            SmartPatcher.RunPatches(merged); // ⭐ 核心：跑补丁，缺啥补啥
            return merged;
        }

        // ============================================================
        // 以下为后续步骤占位，第一版故意留空，保证编译通过
        // 下一轮填：EvaluateRules（规则过滤）、ResolveClasspath（拓扑去重）、RunPatches
        // ============================================================

        // ============================================================
        // 步骤3：规则过滤（只保留当前 Windows x64 环境允许的库）
        // 步骤4：拓扑去重（按 group:artifact 保留最高版本，输出按首次出现位置）
        // ============================================================

        public static List<LibraryEntry> EvaluateRules(VersionJson version)
        {
            var result = new List<LibraryEntry>();
            if (version?.Libraries == null) return result;

            foreach (var lib in version.Libraries)
            {
                if (lib == null) continue;
                // 无 rules → 默认允许
                if (lib.Rules == null || lib.Rules.Count == 0)
                {
                    result.Add(lib);
                    continue;
                }
                if (IsAllowedByRules(lib.Rules))
                    result.Add(lib);
            }
            return result;
        }

        private static bool IsAllowedByRules(List<RuleEntry> rules)
        {
            bool allowed = false;
            foreach (var rule in rules)
            {
                if (rule == null) continue;
                bool matches = true;

                // OS 匹配：只认 windows + x64
                if (rule.Os != null)
                {
                    if (!string.IsNullOrEmpty(rule.Os.Name) &&
                        !rule.Os.Name.Equals("windows", StringComparison.OrdinalIgnoreCase))
                    {
                        matches = false;
                    }
                    if (matches && !string.IsNullOrEmpty(rule.Os.Arch))
                    {
                        var arch = rule.Os.Arch;
                        if (!arch.Equals("x86_64", StringComparison.OrdinalIgnoreCase) &&
                            !arch.Equals("x64", StringComparison.OrdinalIgnoreCase) &&
                            !arch.Equals("amd64", StringComparison.OrdinalIgnoreCase))
                        {
                            matches = false;
                        }
                    }
                }

                // features 匹配：当前不启用任何 feature，只要声明了 true 就不匹配
                if (matches && rule.Features != null)
                {
                    foreach (var f in rule.Features)
                    {
                        if (f.Value) { matches = false; break; }
                    }
                }

                // 最后一条命中的规则决定结果（Mojang 标准逻辑）
                if (matches)
                {
                    allowed = string.Equals(rule.Action, "allow", StringComparison.OrdinalIgnoreCase);
                }
            }
            return allowed;
        }

        public static List<string> ResolveClasspath(VersionJson version, string mcDir)
        {
            var filtered = EvaluateRules(version);
            var result = new List<string>();
            // key: group:artifact[:classifier] → (输出位置, 版本号)
            var seen = new Dictionary<string, (int Index, string Version)>(StringComparer.OrdinalIgnoreCase);
            var libsDir = Path.Combine(mcDir, "libraries");

            foreach (var lib in filtered)
            {
                if (string.IsNullOrEmpty(lib.Path)) continue;
                // natives 库不进 classpath
                if (lib.Path.IndexOf("-natives-", StringComparison.OrdinalIgnoreCase) >= 0) continue;

                var coord = MavenCoordinate.Parse(lib.Name);
                string key, ver;
                if (coord.IsValid)
                {
                    key = coord.Group + ":" + coord.Artifact;
                    if (!string.IsNullOrEmpty(coord.Classifier)) key += ":" + coord.Classifier;
                    ver = coord.Version;
                }
                else
                {
                    // 坐标解析不出，退化为按路径去重，不参与版本替换
                    key = "path:" + lib.Path.ToLowerInvariant();
                    ver = "0";
                }

                var absPath = Path.Combine(libsDir, lib.Path.Replace('/', Path.DirectorySeparatorChar));

                if (!seen.TryGetValue(key, out var existing))
                {
                    seen[key] = (result.Count, ver);
                    result.Add(absPath);
                }
                else if (CompareSemVer(ver, existing.Version) > 0)
                {
                    // 版本更高 → 替换到原位置，顺序按首次出现不变
                    result[existing.Index] = absPath;
                    seen[key] = (existing.Index, ver);
                }
            }
            return result;
        }

        // 语义版本比较：数字段按数值比，非数字段按字符串比
        private static int CompareSemVer(string a, string b)
        {
            if (string.IsNullOrEmpty(a)) a = "0";
            if (string.IsNullOrEmpty(b)) b = "0";

            var pa = a.Split(new[] { '.', '-' }, StringSplitOptions.RemoveEmptyEntries);
            var pb = b.Split(new[] { '.', '-' }, StringSplitOptions.RemoveEmptyEntries);
            int len = Math.Max(pa.Length, pb.Length);

            for (int i = 0; i < len; i++)
            {
                string sa = i < pa.Length ? pa[i] : "0";
                string sb = i < pb.Length ? pb[i] : "0";

                int na, nb;
                bool ia = int.TryParse(sa, out na);
                bool ib = int.TryParse(sb, out nb);

                if (ia && ib)
                {
                    if (na != nb) return na.CompareTo(nb);
                }
                else
                {
                    int cmp = string.Compare(sa, sb, StringComparison.OrdinalIgnoreCase);
                    if (cmp != 0) return cmp;
                }
            }
            return 0;
        }

    }
}