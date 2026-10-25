using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    public class MsAccountData
    {
        [JsonPropertyName("username")] public string Username { get; set; } = "";
        [JsonPropertyName("uuid")] public string Uuid { get; set; } = "";
        [JsonPropertyName("refreshToken")] public string RefreshToken { get; set; } = "";
        [JsonPropertyName("mcAccessToken")] public string McAccessToken { get; set; } = "";
        [JsonPropertyName("mcAccessTokenExpire")] public DateTime McAccessTokenExpire { get; set; }
        [JsonPropertyName("xuid")] public string Xuid { get; set; } = "";
    }

    public class DeviceCodeInfo
    {
        [JsonPropertyName("device_code")] public string DeviceCode { get; set; } = "";
        [JsonPropertyName("user_code")] public string UserCode { get; set; } = "";
        [JsonPropertyName("verification_uri")] public string VerificationUri { get; set; } = "";
        [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; }
        [JsonPropertyName("interval")] public int Interval { get; set; }
        [JsonPropertyName("message")] public string Message { get; set; } = "";
    }

    public sealed partial class MainWindow
    {
        // ⭐ ID
        private const string MS_CLIENT_ID = "79f1d245-a179-4778-bad3-5a93622ba324";
        private const string MS_TENANT_ID = "9cae8260-392d-4501-be00-779b2a735564";
        private const string MS_SCOPE = "XboxLive.signin offline_access";

        private const string MS_DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
        private const string MS_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
        private string GetMsAuthPath() => Path.Combine(GetConfigDir(), "msauth.json");

        private List<MsAccountData> LoadMsAccounts()
        {
            try
            {
                var p = GetMsAuthPath();
                if (File.Exists(p))
                {
                    var raw = File.ReadAllText(p);
                    var list = JsonSerializer.Deserialize<List<MsAccountData>>(raw) ?? new();

                    // ⭐ 迁移标记：文件里还有没加密的 token，就顺手转成密文
                    bool needMigrate = false;

                    // ⭐ token 解密（旧明文自动兼容）
                    foreach (var acc in list)
                    {
                        if (HasPlainSecret(acc.RefreshToken) || HasPlainSecret(acc.McAccessToken))
                            needMigrate = true;

                        acc.RefreshToken = SecretProtector.Unprotect(acc.RefreshToken);
                        acc.McAccessToken = SecretProtector.Unprotect(acc.McAccessToken);
                    }

                    // ⭐ 一次性把磁盘上的明文洗成 DPAPI 密文
                    if (needMigrate)
                    {
                        try
                        {
                            SaveMsAccounts(list);
                            Debug.WriteLine("[MSAuth] 已将明文 token 迁移为加密存储");
                        }
                        catch (Exception ex) { Debug.WriteLine($"[MSAuth] 迁移失败: {ex.Message}"); }
                    }

                    return list;
                }
            }
            catch { }
            return new List<MsAccountData>();
        }

        /// <summary>有值但不是密文 → 说明是历史明文，需要迁移。</summary>
        private static bool HasPlainSecret(string v)
            => !string.IsNullOrEmpty(v) && !SecretProtector.IsProtected(v);

        private void SaveMsAccounts(List<MsAccountData> list)
        {
            try
            {
                Directory.CreateDirectory(GetConfigDir());
                // ⭐ 落盘前加密 token，内存里保持明文
                var toSave = new List<MsAccountData>();
                foreach (var acc in list)
                {
                    toSave.Add(new MsAccountData
                    {
                        Username = acc.Username,
                        Uuid = acc.Uuid,
                        Xuid = acc.Xuid,
                        McAccessTokenExpire = acc.McAccessTokenExpire,
                        RefreshToken = SecretProtector.Protect(acc.RefreshToken),
                        McAccessToken = SecretProtector.Protect(acc.McAccessToken),
                    });
                }
                File.WriteAllText(GetMsAuthPath(),
                    JsonSerializer.Serialize(toSave, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex) { Debug.WriteLine($"[MSAuth] save fail: {ex.Message}"); }
        }

        // ⭐ 1. 请求设备代码
        private async Task<DeviceCodeInfo> RequestDeviceCodeAsync()
        {
            var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = MS_CLIENT_ID,
                ["scope"] = MS_SCOPE,
            });
            var resp = await _http.PostAsync(MS_DEVICE_CODE_URL, form);
            var text = await resp.Content.ReadAsStringAsync();
            Debug.WriteLine($"[MSAuth] device code resp: {text}");
            if (!resp.IsSuccessStatusCode)
                throw new Exception($"申请设备代码失败：{(int)resp.StatusCode} {text}");
            return JsonSerializer.Deserialize<DeviceCodeInfo>(text) ?? throw new Exception("解析设备代码失败");
        }

        // ⭐ 2. 轮询换 token（这里会阻塞直到用户完成登录或超时）
        private async Task<MsAccountData> PollForTokenAsync(DeviceCodeInfo dc, CancellationToken ct)
        {
            var deadline = DateTime.Now.AddSeconds(dc.ExpiresIn);
            int interval = Math.Max(dc.Interval, 3);

            while (DateTime.Now < deadline)
            {
                if (ct.IsCancellationRequested) throw new OperationCanceledException();

                await Task.Delay(interval * 1000, ct);

                var form = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["client_id"] = MS_CLIENT_ID,
                    ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
                    ["device_code"] = dc.DeviceCode,
                    ["scope"] = MS_SCOPE,
                });
                var resp = await _http.PostAsync(MS_TOKEN_URL, form);
                var text = await resp.Content.ReadAsStringAsync();
                Debug.WriteLine($"[MSAuth] poll resp: {(text.Length > 300 ? text.Substring(0, 300) : text)}");

                if (resp.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(text);
                    var root = doc.RootElement;
                    var msAccessToken = root.GetProperty("access_token").GetString();
                    var refreshToken = root.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : "";
                    return await ExchangeForMinecraftAsync(msAccessToken, refreshToken);
                }

                // pending / slow_down 继续等
                try
                {
                    using var doc = JsonDocument.Parse(text);
                    var err = doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() : "";
                    if (err == "authorization_pending") continue;
                    if (err == "slow_down") { interval += 2; continue; }
                    if (err == "expired_token") throw new Exception("设备代码已过期，请重新登录");
                    if (err == "authorization_declined") throw new Exception("用户拒绝了授权");
                    if (!string.IsNullOrEmpty(err)) throw new Exception($"登录失败：{err}");
                }
                catch (JsonException) { }
            }
            throw new Exception("登录超时，请重试");
        }

        // ⭐ 3. 完整认证链：MS token → XBL → XSTS → MC token → profile
        private async Task<MsAccountData> ExchangeForMinecraftAsync(string msAccessToken, string refreshToken)
        {
            // ---- Xbox Live ----
            var xblBody = new
            {
                Properties = new
                {
                    AuthMethod = "RPS",
                    SiteName = "user.auth.xboxlive.com",
                    RpsTicket = "d=" + msAccessToken,
                },
                RelyingParty = "http://auth.xboxlive.com",
                TokenType = "JWT",
            };
            var xblResp = await _http.PostAsync("https://user.auth.xboxlive.com/user/authenticate",
                new StringContent(JsonSerializer.Serialize(xblBody), Encoding.UTF8, "application/json"));
            var xblText = await xblResp.Content.ReadAsStringAsync();
            if (!xblResp.IsSuccessStatusCode)
                throw new Exception($"Xbox Live 认证失败：{(int)xblResp.StatusCode} {xblText}");
            using var xblDoc = JsonDocument.Parse(xblText);
            var xblToken = xblDoc.RootElement.GetProperty("Token").GetString();

            // ---- XSTS ----
            var xstsBody = new
            {
                Properties = new { SandboxId = "RETAIL", UserTokens = new[] { xblToken } },
                RelyingParty = "rp://api.minecraftservices.com/",
                TokenType = "JWT",
            };
            var xstsResp = await _http.PostAsync("https://xsts.auth.xboxlive.com/xsts/authorize",
                new StringContent(JsonSerializer.Serialize(xstsBody), Encoding.UTF8, "application/json"));
            var xstsText = await xstsResp.Content.ReadAsStringAsync();
            if (!xstsResp.IsSuccessStatusCode)
            {
                if (xstsText.Contains("\"XErr\""))
                {
                    // 常见错误提示
                    if (xstsText.Contains("2148916233")) throw new Exception("该微软账号没有 Xbox 账户，请先到 xbox.com 创建");
                    if (xstsText.Contains("2148916235")) throw new Exception("该账号所在地区不支持 Xbox Live");
                    if (xstsText.Contains("2148916238")) throw new Exception("未成年账号需家长同意");
                }
                throw new Exception($"XSTS 授权失败：{(int)xstsResp.StatusCode} {xstsText}");
            }
            using var xstsDoc = JsonDocument.Parse(xstsText);
            var xstsToken = xstsDoc.RootElement.GetProperty("Token").GetString();
            var uhs = xstsDoc.RootElement.GetProperty("DisplayClaims").GetProperty("xui")[0].GetProperty("uhs").GetString();
            string xuid = "";
            try { xuid = xstsDoc.RootElement.GetProperty("DisplayClaims").GetProperty("xui")[0].GetProperty("xid").GetString() ?? ""; } catch { }

            // ---- Minecraft Services ----
            var mcBody = new { identityToken = $"XBL3.0 x={uhs};{xstsToken}" };
            var mcResp = await _http.PostAsync("https://api.minecraftservices.com/authentication/login_with_xbox",
                new StringContent(JsonSerializer.Serialize(mcBody), Encoding.UTF8, "application/json"));
            var mcText = await mcResp.Content.ReadAsStringAsync();
            if (!mcResp.IsSuccessStatusCode)
                throw new Exception($"Minecraft 登录失败：{(int)mcResp.StatusCode}\n{mcText}");
            using var mcDoc = JsonDocument.Parse(mcText);
            var mcAccessToken = mcDoc.RootElement.GetProperty("access_token").GetString();
            int expiresIn = mcDoc.RootElement.TryGetProperty("expires_in", out var e2) ? e2.GetInt32() : 86400;

            // ---- Profile ----
            var profReq = new HttpRequestMessage(HttpMethod.Get, "https://api.minecraftservices.com/minecraft/profile");
            profReq.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", mcAccessToken);
            var profResp = await _http.SendAsync(profReq);
            var profText = await profResp.Content.ReadAsStringAsync();
            if (!profResp.IsSuccessStatusCode)
            {
                if ((int)profResp.StatusCode == 404)
                    throw new Exception("该账号没有购买 Minecraft");
                throw new Exception($"获取档案失败：{(int)profResp.StatusCode}\n{profText}");
            }
            using var profDoc = JsonDocument.Parse(profText);
            var uuid = profDoc.RootElement.GetProperty("id").GetString();
            var name = profDoc.RootElement.GetProperty("name").GetString();

            return new MsAccountData
            {
                Username = name,
                Uuid = uuid,
                RefreshToken = refreshToken ?? "",
                McAccessToken = mcAccessToken,
                McAccessTokenExpire = DateTime.UtcNow.AddSeconds(expiresIn),
                Xuid = xuid,
            };
        }

        // ⭐ 刷新：用 refreshToken 换新的一套
        private async Task<MsAccountData> RefreshMsAccountAsync(MsAccountData acc)
        {
            if (string.IsNullOrEmpty(acc.RefreshToken))
                throw new Exception("没有 refresh token，需要重新登录");

            var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = MS_CLIENT_ID,
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = acc.RefreshToken,
                ["scope"] = MS_SCOPE,
            });
            var resp = await _http.PostAsync(MS_TOKEN_URL, form);
            var text = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new Exception($"刷新失败：{(int)resp.StatusCode} {text}");
            using var doc = JsonDocument.Parse(text);
            var newMsToken = doc.RootElement.GetProperty("access_token").GetString();
            var newRefresh = doc.RootElement.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : acc.RefreshToken;
            return await ExchangeForMinecraftAsync(newMsToken, newRefresh);
        }

        // ⭐ 保证 token 有效（启动前调用）
        private async Task<MsAccountData> EnsureMsTokenValidAsync(MsAccountData acc)
        {
            if (!string.IsNullOrEmpty(acc.McAccessToken) &&
                acc.McAccessTokenExpire > DateTime.UtcNow.AddMinutes(5))
                return acc;

            Debug.WriteLine("[MSAuth] token 过期，刷新中...");
            var newAcc = await RefreshMsAccountAsync(acc);

            // 更新到磁盘
            var list = LoadMsAccounts();
            var idx = list.FindIndex(a => a.Uuid.Equals(newAcc.Uuid, StringComparison.OrdinalIgnoreCase));
            if (idx >= 0) list[idx] = newAcc;
            else list.Add(newAcc);
            SaveMsAccounts(list);

            return newAcc;
        }

        // ⭐ 启动前根据玩家名查正版账户
        private MsAccountData FindMsAccountByName(string username)
        {
            var list = LoadMsAccounts();
            return list.Find(a => a.Username.Equals(username, StringComparison.OrdinalIgnoreCase));
        }
    }
}