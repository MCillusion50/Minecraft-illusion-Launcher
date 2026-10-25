using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    public static class ModpackExporter
    {
        // ⭐ 加了 progress 参数
        public static async Task<string> ExportAsync(string versionId, string savePath, string mcDir, HttpClient http, IProgress<int> progress = null)
        {
            var versionDir = Path.Combine(mcDir, "versions", versionId);
            var modsDir = Path.Combine(versionDir, "mods");

            if (!Directory.Exists(versionDir))
                throw new Exception("版本文件夹不存在");

            // 1. 解析基础版本和加载器
            string baseMcVer = versionId;
            string loaderType = "vanilla";
            string loaderVer = "";

            var fabricMatch = Regex.Match(versionId, @"fabric-loader-([\d.]+)-(.+)");
            if (fabricMatch.Success)
            {
                loaderType = "fabric";
                loaderVer = fabricMatch.Groups[1].Value;
                baseMcVer = fabricMatch.Groups[2].Value;
            }
            else if (versionId.Contains("-forge-"))
            {
                loaderType = "forge";
                var parts = versionId.Split(new[] { "-forge-" }, StringSplitOptions.None);
                if (parts.Length >= 2) { baseMcVer = parts[0]; loaderVer = parts[1]; }
            }

            progress?.Report(5); // 进度 5%

            // 2. 扫描 Modrinth 索引
            var fileList = new List<object>();
            var onlineMods = new HashSet<string>();

            if (Directory.Exists(modsDir))
            {
                var jars = Directory.GetFiles(modsDir, "*.jar");
                int total = jars.Length;
                int current = 0;

                foreach (var jar in jars)
                {
                    current++;
                    // ⭐ 每查完一个，汇报一次进度（从 5% 到 80% 之间分配）
                    int pct = 5 + (int)((double)current / total * 75);
                    progress?.Report(pct);
                    await Task.Delay(60);
                    var modName = Path.GetFileNameWithoutExtension(jar).Split('-')[0];
                    try
                    {
                        var searchUrl = $"https://api.modrinth.com/v2/search?query={Uri.EscapeDataString(modName)}&limit=1";
                        var req = new HttpRequestMessage(HttpMethod.Get, searchUrl);
                        req.Headers.Add("User-Agent", "illusionLauncher/1.0.0");
                        var resp = await http.SendAsync(req);

                        if (resp.IsSuccessStatusCode)
                        {
                            var json = await resp.Content.ReadAsStringAsync();
                            var doc = JsonDocument.Parse(json).RootElement;
                            var hits = doc.GetProperty("hits");
                            if (hits.GetArrayLength() > 0)
                            {
                                var projectId = hits[0].GetProperty("project_id").GetString();
                                var verUrl = $"https://api.modrinth.com/v2/project/{projectId}/version?loaders=[%22{loaderType}%22]&game_versions=[%22{baseMcVer}%22]";
                                var vReq = new HttpRequestMessage(HttpMethod.Get, verUrl);
                                vReq.Headers.Add("User-Agent", "illusionLauncher/1.0.0");
                                var vResp = await http.SendAsync(vReq);

                                if (vResp.IsSuccessStatusCode)
                                {
                                    var vJson = await vResp.Content.ReadAsStringAsync();
                                    var vArr = JsonDocument.Parse(vJson).RootElement;
                                    if (vArr.GetArrayLength() > 0)
                                    {
                                        var v = vArr[0];
                                        var files = v.GetProperty("files");
                                        if (files.GetArrayLength() > 0)
                                        {
                                            var file = files[0];
                                            var url = file.GetProperty("url").GetString();
                                            var filename = file.GetProperty("filename").GetString();
                                            var hashes = file.GetProperty("hashes");
                                            var sha1 = hashes.TryGetProperty("sha1", out var s1) ? s1.GetString() : "";

                                            fileList.Add(new
                                            {
                                                path = $"mods/{filename}",
                                                hashes = new { sha1 = sha1 },
                                                downloads = new[] { url },
                                                fileSize = file.GetProperty("size").GetInt64()
                                            });
                                            onlineMods.Add(Path.GetFileName(jar));
                                            continue;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    catch { /* 失败就丢本地 */ }
                }
            }

            progress?.Report(85); // 查完了，进度 85%

            // 3. 写入 mrpack
            using var zip = ZipFile.Open(savePath, ZipArchiveMode.Create);

            var indexJson = new
            {
                formatVersion = 1,
                game = baseMcVer,
                versionId = versionId,
                name = versionId,
                files = fileList,
                dependencies = loaderType != "vanilla"
                    ? new Dictionary<string, string> { { "minecraft", baseMcVer }, { loaderType, loaderVer } }
                    : new Dictionary<string, string> { { "minecraft", baseMcVer } }
            };

            var entry = zip.CreateEntry("modrinth.index.json");
            using (var writer = new StreamWriter(entry.Open()))
            {
                writer.Write(JsonSerializer.Serialize(indexJson, new JsonSerializerOptions { WriteIndented = true }));
            }

            // 4. 打包 overrides
            var dirsToOverride = new[] { "config", "mods" };
            foreach (var dir in dirsToOverride)
            {
                var path = Path.Combine(versionDir, dir);
                if (!Directory.Exists(path)) continue;

                foreach (var file in Directory.GetFiles(path, "*", SearchOption.AllDirectories))
                {
                    if (dir == "mods" && onlineMods.Contains(Path.GetFileName(file))) continue;
                    var relPath = Path.GetRelativePath(versionDir, file);
                    zip.CreateEntryFromFile(file, $"overrides/{relPath}");
                }
            }

            progress?.Report(100);
            return savePath;
        }
    }
}