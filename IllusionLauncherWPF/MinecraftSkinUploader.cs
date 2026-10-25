using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    public sealed partial class MainWindow
    {
        // ⭐ 上传皮肤到 Mojang（正版账号）
        // variant: "classic"（Steve 模型）或 "slim"（Alex 模型）
        private async Task<bool> UploadSkinToMojangAsync(string username, string skinPngPath, string variant = "classic")
        {
            try
            {
                // 1. 拿这个账户的正版 accessToken
                var msAcc = FindMsAccountByName(username);
                if (msAcc == null)
                {
                    Debug.WriteLine($"[SkinUpload] 找不到正版账户 {username}");
                    return false;
                }
                msAcc = await EnsureMsTokenValidAsync(msAcc);
                if (string.IsNullOrEmpty(msAcc.McAccessToken))
                {
                    Debug.WriteLine("[SkinUpload] accessToken 为空");
                    return false;
                }

                // 2. 读 PNG
                if (!File.Exists(skinPngPath))
                {
                    Debug.WriteLine($"[SkinUpload] 皮肤不存在：{skinPngPath}");
                    return false;
                }
                var pngBytes = await File.ReadAllBytesAsync(skinPngPath);
                var pngBase64 = Convert.ToBase64String(pngBytes);

                // 3. 构造 JSON（Mojang 要求 base64 data URI）
                var body = new
                {
                    variant = variant,
                    file = "data:image/png;base64," + pngBase64
                };
                var json = JsonSerializer.Serialize(body);

                // 4. POST
                var req = new HttpRequestMessage(HttpMethod.Post,
     "https://api.minecraftservices.com/minecraft/profile/skins");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", msAcc.McAccessToken);
                req.Headers.TryAddWithoutValidation("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                req.Headers.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9");
                req.Headers.TryAddWithoutValidation("Origin", "https://www.minecraft.net");
                req.Headers.TryAddWithoutValidation("Referer", "https://www.minecraft.net/");
                req.Content = new StringContent(json, Encoding.UTF8, "application/json");

                using var skinHttp = new HttpClient();
                Debug.WriteLine($"[SkinUpload] URL: {req.RequestUri}");
                Debug.WriteLine($"[SkinUpload] Auth: {(msAcc.McAccessToken.Length > 30 ? msAcc.McAccessToken.Substring(0, 30) + "..." : msAcc.McAccessToken)}");
                Debug.WriteLine($"[SkinUpload] UA: {string.Join(",", req.Headers.GetValues("User-Agent"))}");
                var resp = await skinHttp.SendAsync(req);
                var respText = await resp.Content.ReadAsStringAsync();
                Debug.WriteLine($"[SkinUpload] HTTP {(int)resp.StatusCode}: {respText}");

                if (!resp.IsSuccessStatusCode)
                {
                    // 常见错误
                    if (respText.Contains("NOT_ALLOWED"))
                        Debug.WriteLine("[SkinUpload] 账号未购买 MC 或未成年");
                    else if (respText.Contains("RATE_LIMITED"))
                        Debug.WriteLine("[SkinUpload] 上传太频繁，稍后再试");
                    else if (respText.Contains("DUPLICATE"))
                        Debug.WriteLine("[SkinUpload] 该皮肤已存在");
                    return false;
                }

                Debug.WriteLine($"[SkinUpload]  皮肤上传成功：{username}");
                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[SkinUpload] 异常：{ex}");
                return false;
            }
        }
    }
}