using Microsoft.Web.WebView2.Core;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Windows.Storage.Pickers;

namespace IllusionLauncherWPF
{
    public class JavaInfo
    {
        [JsonPropertyName("version")] public string Version { get; set; } = "";
        [JsonPropertyName("majorVersion")] public int MajorVersion { get; set; }
        [JsonPropertyName("vendor")] public string Vendor { get; set; } = "";
        [JsonPropertyName("path")] public string Path { get; set; } = "";
        [JsonPropertyName("valid")] public bool Valid { get; set; }
    }

    public class SkinEntry
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("fileName")] public string FileName { get; set; } = "";
        [JsonPropertyName("addedAt")] public string AddedAt { get; set; } = "";
    }

    public class SkinAssignment
    {
        [JsonPropertyName("userSkin")] public Dictionary<string, string> UserSkin { get; set; } = new();
    }

    public class LaunchStats
    {
        [JsonPropertyName("totalPlayTimeSeconds")] public long TotalPlayTimeSeconds { get; set; }
        [JsonPropertyName("launchCount")] public int LaunchCount { get; set; }
        [JsonPropertyName("lastLaunch")] public string LastLaunch { get; set; } = "";
        [JsonPropertyName("perInstance")] public Dictionary<string, InstanceStats> PerInstance { get; set; } = new();
    }

    public class InstanceStats
    {
        [JsonPropertyName("playTimeSeconds")] public long PlayTimeSeconds { get; set; }
        [JsonPropertyName("launchCount")] public int LaunchCount { get; set; }
    }

    public sealed partial class MainWindow
    {
        private List<JavaInfo> _detectedJava = new();
        private const string MODRINTH = "https://api.modrinth.com/v2";
        private const string MODRINTH_UA = "illusionLauncher/1.0.0 (contact@example.com)";

        internal async Task<bool> HandleFeatureMessage(string action, JsonElement root, CoreWebView2 sender)
        {
            switch (action)
            {
                case "get_version":
                    _ = Task.Run(() => SendAppVersionAsync(sender));
                    return true;
                case "apply_update":
                    {
                        var u = root.TryGetProperty("url", out var uu) && uu.ValueKind == JsonValueKind.String ? uu.GetString() : null;
                        var n = root.TryGetProperty("name", out var nn) && nn.ValueKind == JsonValueKind.String ? nn.GetString() : "update.zip";
                        long sz = root.TryGetProperty("size", out var ss) && ss.TryGetInt64(out var szv) ? szv : 0;
                        if (!string.IsNullOrEmpty(u))
                            _ = Task.Run(() => ApplyUpdateAsync(sender, u, n, sz));
                        return true;
                    }
                case "check_update":
                    _ = Task.Run(() => CheckUpdateAsync(sender));
                    return true;
                case "set_default_java":
                    {
                        var path = root.GetProperty("path").GetString();
                        _global.JavaPath = path ?? "";
                        SaveGlobalConfig();
                        return true;
                    }

                case "get_mod_versions_info":
                    {
                        var projectId = root.GetProperty("projectId").GetString();
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                // 去 Modrinth 查这个模组支持的所有版本和加载器
                                var url = $"{MODRINTH}/project/{projectId}/version";
                                var req = new HttpRequestMessage(HttpMethod.Get, url);
                                req.Headers.Add("User-Agent", MODRINTH_UA);
                                var resp = await _http.SendAsync(req);
                                if (resp.IsSuccessStatusCode)
                                {
                                    var json = await resp.Content.ReadAsStringAsync();
                                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModVersionsInfo({{ ok: true, raw: JSON.stringify({json}) }})"); });
                                }
                                else
                                {
                                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModVersionsInfo({{ ok: false }})"); });
                                }
                            }
                            catch { }
                        });
                        return true;
                    }

                case "download_modrinth_file":
                    {
                        var url = root.GetProperty("url").GetString();
                        var fileName = root.GetProperty("fileName").GetString();
                        var saveVersion = root.TryGetProperty("saveVersion", out var sv) ? sv.GetString() : null;
                        var projectType = root.GetProperty("projectType").GetString();

                        _ = Task.Run(async () =>
                        {
                            if (!await TryEnterDownloadLock(sender)) return;
                            BeginDownloadSession();
                            try
                            {
                                string subFolder = projectType switch { "mod" => "mods", "resourcepack" => "resourcepacks", "shader" => "shaderpacks", _ => "mods" };
                                string saveDir = string.IsNullOrEmpty(saveVersion)
                                    ? Path.Combine(GetMcDir(), subFolder)
                                    : Path.Combine(GetMcDir(), "versions", saveVersion, subFolder);

                                Directory.CreateDirectory(saveDir);
                                var savePath = Path.Combine(saveDir, fileName);

                                await ReportProgress(sender, 5, $"正在下载 {fileName}...");
                                await DownloadParallelAsync(url, savePath, (d, t, speed) =>
                                {
                                    if (t > 0) _ = ReportProgress(sender, (double)d / t * 100, $"下载中 {d / 1024 / 1024}MB / {t / 1024 / 1024}MB");
                                });

                                await ReportProgress(sender, 100, $"{fileName} 下载完成", done: true);
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthInstallDone({{ok:true, version:'{saveVersion ?? "全局"}', folder:'{subFolder}'}})"); });
                            }
                            catch (OperationCanceledException)
                            {
                                await ReportProgress(sender, 0, "已取消下载", done: true);
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onModrinthInstallDone({ok:false, error:'已取消下载'})"); });
                            }
                            catch (Exception ex)
                            {
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthInstallDone({{ok:false, error:'{ex.Message.Replace("'", "\\'")}'}})"); });
                            }
                            finally
                            {
                                EndDownloadSession();
                                await ExitDownloadLock(sender);
                            }
                        });
                        return true;
                    }

                case "fetch_avatar":
                    {
                        var uuid = root.GetProperty("uuid").GetString();
                        if (string.IsNullOrEmpty(uuid)) { await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onAvatarFetched({ok:false})"); }); return true; }
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                // 优先：读 Mojang 官方皮肤纹理，本地裁剪生成头像（第三方 CDN 已全部失效）
                            var official = await BuildAvatarFromMojangSkinAsync(uuid);
                            if (official != null)
                            {
                                var officialPayload = JsonSerializer.Serialize(new { ok = true, uuid, dataUri = official });
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onAvatarFetched(" + officialPayload + ")"); });
                                return;
                            }

                            var url = $"https://mc-heads.net/avatar/{uuid}/80/right/hat";
                                var req = new HttpRequestMessage(HttpMethod.Get, url);
                                req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
                                req.Headers.TryAddWithoutValidation("Accept", "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5");
                                req.Headers.TryAddWithoutValidation("Referer", "https://mc-heads.net/");

                                using var http = new HttpClient();
                                var resp = await http.SendAsync(req);
                                if (!resp.IsSuccessStatusCode)
                                {
                                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onAvatarFetched({ok:false})"); });
                                    return;
                                }
                                var bytes = await resp.Content.ReadAsByteArrayAsync();
                                var base64 = Convert.ToBase64String(bytes);
                                var dataUri = "data:image/png;base64," + base64;
                                var json = JsonSerializer.Serialize(new { ok = true, uuid = uuid, dataUri = dataUri });
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onAvatarFetched({json})"); });
                            }
                            catch (Exception ex)
                            {
                                Debug.WriteLine($"[Avatar] {ex.Message}");
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onAvatarFetched({ok:false})"); });
                            }
                        });
                        return true;
                    }
                case "list_java":
                    {
                        var json = JsonSerializer.Serialize(_detectedJava, JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onJavaDetected({json})"); });
                        return true;
                    }
                case "load_stats":
                    {
                        var json = JsonSerializer.Serialize(LoadStats(), JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onStatsLoaded({json})"); });
                        return true;
                    }
                case "list_skins":
                    {
                        var json = JsonSerializer.Serialize(ListSkins(), JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onSkinLibrary({json})"); });
                        return true;
                    }
                case "import_skin":
                    await ImportSkinAsync(sender);
                    return true;
                case "delete_skin":
                    {
                        var id = root.GetProperty("id").GetString();
                        DeleteSkin(id);
                        var json = JsonSerializer.Serialize(ListSkins(), JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onSkinLibrary({json})"); });
                        return true;
                    }
                case "apply_skin":
                    {
                        var id = root.GetProperty("id").GetString();
                        var username = root.GetProperty("username").GetString();
                        var assign = LoadSkinAssignment();
                        assign.UserSkin[username] = id;
                        SaveSkinAssignment(assign);

                        var list = ListSkins();
                        var entry = list.FirstOrDefault(s => s.Id == id);
                        var fileName = entry?.FileName ?? "";

                        var resp = JsonSerializer.Serialize(new { ok = true, id = id, fileName = fileName, username = username });
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onSkinApplied({resp})"); });
                        return true;
                    }
                case "pick_java_for_version":
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        _ = Dispatcher.InvokeAsync(async () =>
                        {
                            await PickJavaForVersionAsync(versionId, sender);
                        });
                        return true;
                    }



                case "pick_java_folder_for_version":
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        _ = Dispatcher.InvokeAsync(async () =>
                        {
                            await PickJavaFolderForVersionAsync(versionId, sender);
                        });
                        return true;
                    }
                case "clear_version_java":
                    {
                        var versionId = root.GetProperty("versionId").GetString();
                        var cfg = LoadVersionConfig(versionId);
                        cfg.JavaPath = "";
                        SaveVersionConfig(versionId, cfg);
                        var resp = JsonSerializer.Serialize(new { ok = true, versionId = versionId, javaPath = "" });
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onVersionJavaUpdated({resp})"); });
                        return true;
                    }
                case "search_modrinth":
                    {
                        var query = root.GetProperty("query").GetString();
                        var projectType = root.GetProperty("projectType").GetString();
                        int offset = 0;
                        if (root.TryGetProperty("offset", out var off)) offset = off.GetInt32();
                        _ = Task.Run(() => SearchModrinthAsync(query, projectType, offset, sender));
                        return true;
                    }

                case "modrinth_detail":
                    {
                        var projectId = root.GetProperty("projectId").GetString();
                        _ = Task.Run(() => ModrinthDetailAsync(projectId, sender));
                        return true;
                    }
                case "install_modrinth":
                    {
                        var projectId = root.GetProperty("projectId").GetString();
                        var projectType = root.GetProperty("projectType").GetString();
                        string gameVersion = null;
                        if (root.TryGetProperty("gameVersion", out var gv)) gameVersion = gv.GetString();
                        string loader = null;
                        if (root.TryGetProperty("loader", out var ld)) loader = ld.GetString();
                        var saveVersion = root.TryGetProperty("saveVersion", out var sv) ? sv.GetString() : null;
                        _ = Task.Run(() => InstallModrinthAsync(projectId, projectType, gameVersion, saveVersion, loader, sender));
                        return true;
                    }
                case "list_installed_versions":
                    {
                        var versions = new List<string>();
                        var versionsDir = Path.Combine(GetMcDir(), "versions");
                        if (Directory.Exists(versionsDir))
                        {
                            foreach (var dir in Directory.GetDirectories(versionsDir))
                            {
                                var name = Path.GetFileName(dir);
                                if (File.Exists(Path.Combine(dir, name + ".json")))
                                    versions.Add(name);
                            }
                        }
                        var json = JsonSerializer.Serialize(versions, JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onInstalledVersionsForDownload({json})"); });
                        return true;
                    }

                case "ms_login_start":
                    {
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var dc = await RequestDeviceCodeAsync();

                                var json = JsonSerializer.Serialize(new
                                {
                                    ok = true,
                                    userCode = dc.UserCode,
                                    verificationUri = dc.VerificationUri,
                                    message = dc.Message,
                                }, JsonOpts());
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onMsLoginDeviceCode({json})"); });

                                var acc = await PollForTokenAsync(dc, CancellationToken.None);

                                var list = LoadMsAccounts();
                                var idx = list.FindIndex(a =>
                                    a.Uuid.Equals(acc.Uuid, StringComparison.OrdinalIgnoreCase));
                                if (idx >= 0) list[idx] = acc;
                                else list.Add(acc);
                                SaveMsAccounts(list);

                                var doneJson = JsonSerializer.Serialize(new
                                {
                                    ok = true,
                                    name = acc.Username,
                                    uuid = acc.Uuid,
                                }, JsonOpts());
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onMsLoginSuccess({doneJson})"); });
                            }
                            catch (Exception ex)
                            {
                                Debug.WriteLine($"[MSLogin] {ex}");
                                var safe = ex.Message
                                    .Replace("\\", "\\\\")
                                    .Replace("'", "\\'")
                                    .Replace("\n", "\\n")
                                    .Replace("\r", "");
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onMsLoginFailed({{error:'{safe}'}})"); });
                            }
                        });
                        return true;
                    }

                case "ms_list_accounts":
                    {
                        var list = LoadMsAccounts();
                        var json = JsonSerializer.Serialize(
                            list.Select(a => new { name = a.Username, uuid = a.Uuid }),
                            JsonOpts());
                        await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onMsAccounts({json})"); });
                        return true;
                    }

                case "ms_logout":
                    {
                        var uuid = root.GetProperty("uuid").GetString();
                        var list = LoadMsAccounts();
                        list.RemoveAll(a => a.Uuid.Equals(uuid, StringComparison.OrdinalIgnoreCase));
                        SaveMsAccounts(list);
                        return true;
                    }

                case "upload_skin_to_mojang":
                    {
                        var username = root.GetProperty("username").GetString();
                        var skinId = root.GetProperty("skinId").GetString();
                        var variant = root.TryGetProperty("variant", out var v) ? v.GetString() : "classic";

                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var list = ListSkins();
                                var entry = list.Find(s => s.Id == skinId);
                                if (entry == null)
                                {
                                    await RunOnUI(() =>
                                    {
                                        _ = sender.ExecuteScriptAsync(
                                        "onSkinUploadResult({ok:false,error:'皮肤不存在'})");
                                    });
                                    return;
                                }
                                var skinPath = Path.Combine(GetSkinsDir(), entry.FileName);

                                var ok = await UploadSkinToMojangAsync(username, skinPath, variant);

                                var json = JsonSerializer.Serialize(new
                                {
                                    ok = ok,
                                    username = username,
                                    error = ok ? "" : SkinUploadLastError
                                }, JsonOpts());
                                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onSkinUploadResult({json})"); });
                            }
                            catch (Exception ex)
                            {
                                var safe = ex.Message.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n");
                                await RunOnUI(() =>
                                {
                                    _ = sender.ExecuteScriptAsync(
                                    $"onSkinUploadResult({{ok:false,error:'{safe}'}})");
                                });
                            }
                        });
                        return true;
                    }

                case "create_room":
                    {
                        var playerName = root.GetProperty("playerName").GetString() ?? "Player";
                        var minecraftPort = root.GetProperty("minecraftPort").GetInt32();
                        _ = Task.Run(() => CreateRoomAsync(sender, playerName, minecraftPort));
                        return true;
                    }
                case "close_room":
                    _ = Task.Run(() => CloseRoomAsync(sender));
                    return true;
                case "join_room":
                    {
                        var playerName = root.GetProperty("playerName").GetString() ?? "Player";
                        var roomCode = root.GetProperty("roomCode").GetString() ?? "";
                        _ = Task.Run(() => JoinRoomAsync(sender, playerName, roomCode));
                        return true;
                    }
                case "leave_room":
                    _ = Task.Run(() => LeaveRoomAsync(sender));
                    return true;

                case "open_url":
                    {
                        var url = root.GetProperty("url").GetString();
                        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
                        return true;
                    }
            }
            return false;
        }

        private static JsonSerializerOptions JsonOpts() => new()
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };

        private string GetJavaVendor(string javaExe)
        {
            try
            {
                var psi = new ProcessStartInfo(javaExe, "-version")
                {
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using var proc = Process.Start(psi);
                var text = proc.StandardError.ReadToEnd() + proc.StandardOutput.ReadToEnd();
                proc.WaitForExit(3000);
                if (text.Contains("Temurin") || text.Contains("Adoptium")) return "Adoptium";
                if (text.Contains("Microsoft")) return "Microsoft";
                if (text.Contains("Oracle")) return "Oracle";
                if (text.Contains("Zulu")) return "Zulu";
                if (text.Contains("Corretto")) return "Amazon";
                if (text.Contains("Liberica")) return "BellSoft";
            }
            catch { }
            return "Unknown";
        }

        private string ReadLatestCrashLog(string mcDir)
        {
            try
            {
                var cutoff = DateTime.Now.AddMinutes(-1);
                var parts = new List<string>();

                var logFile = Path.Combine(mcDir, "logs", "latest.log");
                if (File.Exists(logFile) && File.GetLastWriteTime(logFile) > cutoff)
                {
                    var lines = File.ReadAllLines(logFile);
                    var tail = string.Join("\n", lines.Skip(Math.Max(0, lines.Length - 200)));
                    parts.Add("----- latest.log（最后 200 行）-----");
                    parts.Add(tail);
                }

                var crashDir = Path.Combine(mcDir, "crash-reports");
                if (Directory.Exists(crashDir))
                {
                    var latest = Directory.GetFiles(crashDir, "crash-*.txt")
                        .Where(f => File.GetLastWriteTime(f) > cutoff)
                        .OrderByDescending(f => File.GetLastWriteTime(f))
                        .FirstOrDefault();
                    if (latest != null)
                    {
                        var text = File.ReadAllText(latest);
                        if (text.Length > 60000) text = text.Substring(0, 60000);
                        parts.Add("");
                        parts.Add($"----- {Path.GetFileName(latest)} -----");
                        parts.Add(text);
                    }
                }

                if (parts.Count == 0)
                {
                    var launcherLog = Path.Combine(mcDir, "logs", $"launcher-{DateTime.Now:yyyyMMdd}.log");
                    if (File.Exists(launcherLog))
                    {
                        var lines = File.ReadAllLines(launcherLog);
                        var tail = string.Join("\n", lines.Skip(Math.Max(0, lines.Length - 100)));
                        parts.Add("----- 启动器日志（最后 100 行）-----");
                        parts.Add(tail);
                    }
                }

                if (parts.Count > 0) return string.Join("\n", parts);
            }
            catch { }
            return null;
        }

        private string GetStatsPath() => Path.Combine(GetConfigDir(), "stats.json");

        private LaunchStats LoadStats()
        {
            try
            {
                var path = GetStatsPath();
                if (File.Exists(path))
                    return JsonSerializer.Deserialize<LaunchStats>(File.ReadAllText(path)) ?? new LaunchStats();
            }
            catch { }
            return new LaunchStats();
        }

        private void SaveStats(LaunchStats stats)
        {
            try
            {
                Directory.CreateDirectory(GetConfigDir());
                File.WriteAllText(GetStatsPath(),
                    JsonSerializer.Serialize(stats, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { }
        }

        private string GetSkinsDir() => Path.Combine(GetConfigDir(), "skins");
        private string GetSkinIndexPath() => Path.Combine(GetSkinsDir(), "index.json");
        private string GetSkinAssignPath() => Path.Combine(GetSkinsDir(), "assign.json");

        private List<SkinEntry> ListSkins()
        {
            try
            {
                var path = GetSkinIndexPath();
                if (File.Exists(path))
                    return JsonSerializer.Deserialize<List<SkinEntry>>(File.ReadAllText(path)) ?? new List<SkinEntry>();
            }
            catch { }
            return new List<SkinEntry>();
        }

        private void SaveSkinIndex(List<SkinEntry> list)
        {
            try
            {
                Directory.CreateDirectory(GetSkinsDir());
                File.WriteAllText(GetSkinIndexPath(),
                    JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { }
        }

        private SkinAssignment LoadSkinAssignment()
        {
            try
            {
                var path = GetSkinAssignPath();
                if (File.Exists(path))
                    return JsonSerializer.Deserialize<SkinAssignment>(File.ReadAllText(path)) ?? new SkinAssignment();
            }
            catch { }
            return new SkinAssignment();
        }

        private void SaveSkinAssignment(SkinAssignment a)
        {
            try
            {
                Directory.CreateDirectory(GetSkinsDir());
                File.WriteAllText(GetSkinAssignPath(),
                    JsonSerializer.Serialize(a, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { }
        }

        private void DeleteSkin(string id)
        {
            try
            {
                var list = ListSkins();
                var entry = list.FirstOrDefault(s => s.Id == id);
                if (entry != null)
                {
                    var file = Path.Combine(GetSkinsDir(), entry.FileName);
                    if (File.Exists(file)) File.Delete(file);
                    list.Remove(entry);
                    SaveSkinIndex(list);
                }
            }
            catch { }
        }

        private async Task ImportSkinAsync(CoreWebView2 sender)
        {
            try
            {
                // ⭐ 改用 WPF 原生的 OpenFileDialog，绝对弹窗
                var dialog = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "选择皮肤",
                    Filter = "PNG 图片|*.png",
                    CheckFileExists = true
                };

                // 必须指定 MainWindow 作为弹窗的父级
                if (dialog.ShowDialog(System.Windows.Application.Current.MainWindow) != true)
                {
                    return;
                }

                var destDir = GetSkinsDir();
                Directory.CreateDirectory(destDir);
                var id = Guid.NewGuid().ToString("N").Substring(0, 8);
                var dest = Path.Combine(destDir, id + ".png");
                File.Copy(dialog.FileName, dest, true);

                var list = ListSkins();
                list.Add(new SkinEntry
                {
                    Id = id,
                    Name = Path.GetFileNameWithoutExtension(dialog.SafeFileName),
                    FileName = id + ".png",
                    AddedAt = DateTime.Now.ToString("s"),
                });
                SaveSkinIndex(list);

                var json = JsonSerializer.Serialize(list, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onSkinLibrary({json})"); });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ImportSkin] {ex.Message}");
                System.Windows.MessageBox.Show("导入皮肤失败: " + ex.Message, "错误");
            }
        }

        private async Task PickJavaForVersionAsync(string versionId, CoreWebView2 sender)
        {
            try
            {
                var dlg = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "选择 java.exe",
                    Filter = "java.exe|java.exe|所有可执行文件|*.exe",
                    CheckFileExists = true
                };

                // ⭐ 核心：使用 System.Windows 全称解决 Application 冲突
                if (dlg.ShowDialog(System.Windows.Application.Current.MainWindow) != true)
                {
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onVersionJavaPickResult({ok:false,cancelled:true})"); });
                    return;
                }

                if (!Path.GetFileName(dlg.FileName).Equals("java.exe", StringComparison.OrdinalIgnoreCase))
                {
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onVersionJavaPickResult({ok:false,error:'请选择 java.exe'})"); });
                    return;
                }

                string versionStr = "未知";
                bool valid = false;
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = dlg.FileName,
                        Arguments = "-version",
                        RedirectStandardError = true,
                        RedirectStandardOutput = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    };
                    using var proc = Process.Start(psi);
                    var errTask = proc.StandardError.ReadToEndAsync();
                    var outTask = proc.StandardOutput.ReadToEndAsync();
                    await proc.WaitForExitAsync();
                    var err = await errTask + await outTask;
                    var match = System.Text.RegularExpressions.Regex.Match(err, "version \"([^\"]+)\"");
                    if (match.Success) { versionStr = match.Groups[1].Value; valid = true; }
                }
                catch { }

                if (!valid)
                {
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onVersionJavaPickResult({ok:false,error:'java.exe 无法运行'})"); });
                    return;
                }

                var cfg = LoadVersionConfig(versionId);
                cfg.JavaPath = dlg.FileName;
                SaveVersionConfig(versionId, cfg);

                var resp = JsonSerializer.Serialize(new
                {
                    ok = true,
                    versionId = versionId,
                    javaPath = dlg.FileName,
                    javaVersion = versionStr
                }, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onVersionJavaUpdated({resp})"); });
            }
            catch (Exception ex)
            {
                var safeErr = ex.Message.Replace("'", "\\'").Replace("\r", "").Replace("\n", "");
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onVersionJavaPickResult({{ok:false,error:'弹窗异常：{safeErr}'}})"); });
            }
        }

        private async Task PickJavaFolderForVersionAsync(string versionId, CoreWebView2 sender)
        {
            try
            {
                using var dlg = new System.Windows.Forms.FolderBrowserDialog
                {
                    Description = "选择 Java 目录（包含 bin 的文件夹）",
                    UseDescriptionForTitle = true,
                    ShowNewFolderButton = false
                };

                if (dlg.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                {
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onVersionJavaPickResult({ok:false,cancelled:true})"); });
                    return;
                }

                string javaExe = Path.Combine(dlg.SelectedPath, "bin", "java.exe");
                if (!File.Exists(javaExe))
                {
                    javaExe = FindJavaExeInDirPublic(dlg.SelectedPath, 3);
                }

                if (javaExe == null || !File.Exists(javaExe))
                {
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onVersionJavaPickResult({ok:false,error:'目录里找不到 bin/java.exe'})"); });
                    return;
                }

                string versionStr = "未知";
                bool valid = false;
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = javaExe,
                        Arguments = "-version",
                        RedirectStandardError = true,
                        RedirectStandardOutput = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    };
                    using var proc = Process.Start(psi);
                    var errTask = proc.StandardError.ReadToEndAsync();
                    var outTask = proc.StandardOutput.ReadToEndAsync();
                    await proc.WaitForExitAsync();
                    var err = await errTask + await outTask;
                    var match = System.Text.RegularExpressions.Regex.Match(err, "version \"([^\"]+)\"");
                    if (match.Success) { versionStr = match.Groups[1].Value; valid = true; }
                }
                catch { }

                if (!valid)
                {
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onVersionJavaPickResult({ok:false,error:'java.exe 无法运行'})"); });
                    return;
                }

                var cfg = LoadVersionConfig(versionId);
                cfg.JavaPath = javaExe;
                SaveVersionConfig(versionId, cfg);

                var resp = JsonSerializer.Serialize(new
                {
                    ok = true,
                    versionId = versionId,
                    javaPath = javaExe,
                    javaVersion = versionStr
                }, JsonOpts());
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onVersionJavaUpdated({resp})"); });
            }
            catch (Exception ex)
            {
                var safeErr = ex.Message.Replace("'", "\\'").Replace("\r", "").Replace("\n", "");
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onVersionJavaPickResult({{ok:false,error:'弹窗异常：{safeErr}'}})"); });
            }
        }

        private string FindJavaExeInDirPublic(string baseDir, int depth)
        {
            if (depth < 0) return null;
            try
            {
                var direct = Path.Combine(baseDir, "bin", "java.exe");
                if (File.Exists(direct)) return direct;
                foreach (var sub in Directory.GetDirectories(baseDir))
                {
                    var found = FindJavaExeInDirPublic(sub, depth - 1);
                    if (found != null) return found;
                }
            }
            catch { }
            return null;
        }

        private async Task SearchModrinthAsync(string query, string projectType, int offset, CoreWebView2 sender)
        {
            try
            {
                var q = string.IsNullOrWhiteSpace(query) ? "" : query;
                var facets = $"[[\"project_type:{projectType}\"]]";
                var index = string.IsNullOrWhiteSpace(q) ? "downloads" : "relevance";
                var url = $"{MODRINTH}/search?query={Uri.EscapeDataString(q)}&limit=20&offset={offset}" +
                          $"&index={index}&facets={Uri.EscapeDataString(facets)}";
                var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("User-Agent", MODRINTH_UA);
                var resp = await _http.SendAsync(req);
                var text = await resp.Content.ReadAsStringAsync();
                var json = JsonSerializer.Serialize(new { ok = resp.IsSuccessStatusCode, raw = text, offset, projectType });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthResult({json})"); });
            }
            catch (Exception ex)
            {
                var json = JsonSerializer.Serialize(new { ok = false, error = ex.Message, offset, projectType });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthResult({json})"); });
            }
        }

        private async Task ModrinthDetailAsync(string projectId, CoreWebView2 sender)
        {
            try
            {
                var req = new HttpRequestMessage(HttpMethod.Get, $"{MODRINTH}/project/{projectId}");
                req.Headers.Add("User-Agent", MODRINTH_UA);
                var resp = await _http.SendAsync(req);
                var text = await resp.Content.ReadAsStringAsync();
                var json = JsonSerializer.Serialize(new { ok = resp.IsSuccessStatusCode, raw = text });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthDetail({json})"); });
            }
            catch (Exception ex)
            {
                var json = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthDetail({json})"); });
            }
        }

        private async Task InstallModrinthAsync(string projectId, string projectType, string gameVersion, string saveVersion, string loader, CoreWebView2 sender)
        {
            if (!await TryEnterDownloadLock(sender)) return;
            try
            {
                var mcDir = GetMcDir();

                var req = new HttpRequestMessage(HttpMethod.Get, $"{MODRINTH}/project/{projectId}/version");
                req.Headers.Add("User-Agent", MODRINTH_UA);
                var resp = await _http.SendAsync(req);
                var text = await resp.Content.ReadAsStringAsync();
                var arr = JsonDocument.Parse(text).RootElement;
                if (arr.GetArrayLength() == 0)
                {
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync("onModrinthInstallDone({ok:false,error:'该项目没有任何发布版本'})"); });
                    return;
                }

                JsonElement? chosen = null;
                foreach (var v in arr.EnumerateArray())
                {
                    if (!string.IsNullOrEmpty(gameVersion) && v.TryGetProperty("game_versions", out var gvs))
                    {
                        bool matchGame = false;
                        foreach (var g in gvs.EnumerateArray())
                            if (g.GetString() == gameVersion) { matchGame = true; break; }
                        if (!matchGame) continue;
                    }
                    if (projectType == "mod" && !string.IsNullOrEmpty(loader) && loader != "none")
                    {
                        if (v.TryGetProperty("loaders", out var loaders))
                        {
                            bool hasLoader = false;
                            foreach (var l in loaders.EnumerateArray())
                                if (l.GetString() == loader) { hasLoader = true; break; }
                            if (!hasLoader) continue;
                        }
                    }
                    chosen = v;
                    break;
                }

                if (chosen == null)
                {
                    var detail = string.IsNullOrEmpty(gameVersion)
                        ? "该项目没有可用版本"
                        : $"没有匹配 MC {gameVersion}"
                          + (string.IsNullOrEmpty(loader) || loader == "none" ? "" : $" + {loader}")
                          + " 的版本，请检查版本号或加载器";
                    var safe = detail.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n");
                    await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthInstallDone({{ok:false,error:'{safe}'}})"); });
                    return;
                }

                var files = chosen.Value.GetProperty("files");
                JsonElement primary = default;
                bool foundPrimary = false;
                foreach (var f in files.EnumerateArray())
                {
                    if (f.TryGetProperty("primary", out var p) && p.GetBoolean()) { primary = f; foundPrimary = true; break; }
                }
                if (!foundPrimary) primary = files.EnumerateArray().First();

                var fileUrl = primary.GetProperty("url").GetString();
                var fileName = primary.GetProperty("filename").GetString();
                string sha1 = null;
                if (primary.TryGetProperty("hashes", out var hashes) && hashes.TryGetProperty("sha1", out var s1))
                    sha1 = s1.GetString();

                string subFolder = projectType switch
                {
                    "mod" => "mods",
                    "resourcepack" => "resourcepacks",
                    "shader" => "shaderpacks",
                    _ => "mods"
                };

                string saveDir;
                if (!string.IsNullOrEmpty(saveVersion))
                    saveDir = Path.Combine(mcDir, "versions", saveVersion, subFolder);
                else
                    saveDir = Path.Combine(mcDir, subFolder);

                Directory.CreateDirectory(saveDir);
                var savePath = Path.Combine(saveDir, fileName);

                await ReportProgress(sender, 5, $"正在下载 {fileName}...");

                await DownloadParallelAsync(fileUrl, savePath, (d, t, speed) =>
                {
                    if (t > 0)
                    {
                        double pct = (double)d / t * 95;
                        string sp = speed > 0 ? $" · {FormatSpeed(speed)}" : "";
                        _ = ReportProgress(sender, pct, $"{fileName} {d / 1024 / 1024}MB / {t / 1024 / 1024}MB{sp}");
                    }
                }, sha1);

                await ReportProgress(sender, 100, $" {fileName} 已安装到 {saveVersion ?? "全局"}");
                var doneMsg = JsonSerializer.Serialize(new { ok = true, version = saveVersion ?? "全局", folder = subFolder });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthInstallDone({doneMsg})"); });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[InstallModrinth] {ex}");
                var msg = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
                await RunOnUI(() => { _ = sender.ExecuteScriptAsync($"onModrinthInstallDone({msg})"); });
            }
            finally
            {
                await ExitDownloadLock(sender);
            }
        }
        /// <summary>把位图转成 Pbgra32 像素数组，便于手工拼接/放大。</summary>
        private static byte[] ToPbgra32Pixels(System.Windows.Media.Imaging.BitmapSource bmp, int w, int h)
        {
            var conv = new System.Windows.Media.Imaging.FormatConvertedBitmap(
                bmp, System.Windows.Media.PixelFormats.Pbgra32, null, 0);
            var buf = new byte[w * h * 4];
            conv.CopyPixels(buf, w * 4, 0);
            return buf;
        }

        /// <summary>
        /// 读 Mojang 官方皮肤纹理，本地裁 8x8 头部放大到 64x64（叠加帽子层）。
        /// </summary>
        private static async Task<string> BuildAvatarFromMojangSkinAsync(string uuid)
        {
            try
            {
                var clean = (uuid ?? "").Replace("-", "");
                if (clean.Length != 32) return null;

                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
                var profileJson = await http.GetStringAsync("https://sessionserver.mojang.com/session/minecraft/profile/" + clean);

                string skinUrl = null;
                using (var doc = JsonDocument.Parse(profileJson))
                {
                    if (doc.RootElement.TryGetProperty("properties", out var props) && props.GetArrayLength() > 0)
                    {
                        var b64 = props[0].GetProperty("value").GetString();
                        var texturesJson = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(b64));
                        using var texDoc = JsonDocument.Parse(texturesJson);
                        skinUrl = texDoc.RootElement.GetProperty("textures").GetProperty("SKIN").GetProperty("url").GetString();
                    }
                }
                if (string.IsNullOrWhiteSpace(skinUrl)) return null;

                var skinBytes = await http.GetByteArrayAsync(skinUrl);
                System.Windows.Media.Imaging.BitmapImage skin;
                using (var ms = new System.IO.MemoryStream(skinBytes))
                {
                    skin = new System.Windows.Media.Imaging.BitmapImage();
                    skin.BeginInit();
                    skin.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                    skin.StreamSource = ms;
                    skin.EndInit();
                }
                skin.Freeze();

                if (skin.PixelWidth < 64 || skin.PixelHeight < 16) return null;

                var head = new System.Windows.Media.Imaging.CroppedBitmap(skin, new System.Windows.Int32Rect(8, 8, 8, 8));
                System.Windows.Media.Imaging.BitmapSource hat = null;
                if (skin.PixelHeight >= 16)
                    hat = new System.Windows.Media.Imaging.CroppedBitmap(skin, new System.Windows.Int32Rect(40, 8, 8, 8));

                // 手动像素合成 + 8 倍最近邻放大：WPF 的插值设置在这里不可靠，会糊成一片
                var headPix = ToPbgra32Pixels(head, 8, 8);
                var hatPix = hat != null ? ToPbgra32Pixels(hat, 8, 8) : null;

                // 头部内缩 2px、帽子层铺满整个画布 —— 帽子四周外露一圈，头像就有立体感了
                const int outSize = 64;
                const int inset = 2;
                const int headSize = outSize - inset * 2;

                var dst = new byte[outSize * outSize * 4];
                for (var y = 0; y < outSize; y++)
                {
                    for (var x = 0; x < outSize; x++)
                    {
                        var di = (y * outSize + x) * 4;

                        // ① 帽子层（overlay）：铺满 64x64，不透明像素优先
                        if (hatPix != null)
                        {
                            var hx = x * 8 / outSize;
                            var hy = y * 8 / outSize;
                            var hi = (hy * 8 + hx) * 4;
                            if (hatPix[hi + 3] > 0)
                            {
                                dst[di] = hatPix[hi];
                                dst[di + 1] = hatPix[hi + 1];
                                dst[di + 2] = hatPix[hi + 2];
                                dst[di + 3] = hatPix[hi + 3];
                                continue;
                            }
                        }

                        // ② 头部层：内缩 inset，居中放置
                        if (x >= inset && x < outSize - inset && y >= inset && y < outSize - inset)
                        {
                            var hx2 = (x - inset) * 8 / headSize;
                            var hy2 = (y - inset) * 8 / headSize;
                            var hi2 = (hy2 * 8 + hx2) * 4;
                            dst[di] = headPix[hi2];
                            dst[di + 1] = headPix[hi2 + 1];
                            dst[di + 2] = headPix[hi2 + 2];
                            dst[di + 3] = headPix[hi2 + 3];
                        }
                    }
                }

                System.Windows.Media.Imaging.BitmapSource rtb =
                    System.Windows.Media.Imaging.BitmapSource.Create(outSize, outSize, 96, 96,
                        System.Windows.Media.PixelFormats.Pbgra32, null, dst, outSize * 4);
                rtb.Freeze();

                var enc = new System.Windows.Media.Imaging.PngBitmapEncoder();
                enc.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(rtb));
                using var outMs = new System.IO.MemoryStream();
                enc.Save(outMs);
                return "data:image/png;base64," + Convert.ToBase64String(outMs.ToArray());
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[Avatar] official skin failed: " + ex.Message);
                return null;
            }
        }

    }
}