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
        /// <summary>最近一次上传失败的可读原因（直接展示到 UI）。</summary>
        private static string SkinUploadLastError = "";

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

                // 3. 用 multipart/form-data 上传。
                //    注意：JSON + data URI 的写法会被 Azure Front Door 的 WAF 直接 403
                //    （返回 "The request is blocked." 的 HTML 页），multipart 才能正常通过。
                var form = new MultipartFormDataContent();
                form.Add(new StringContent(string.IsNullOrEmpty(variant) ? "classic" : variant, Encoding.UTF8), "variant");
                var filePart = new ByteArrayContent(pngBytes);
                filePart.Headers.ContentType = new MediaTypeHeaderValue("image/png");
                form.Add(filePart, "file", Path.GetFileName(skinPngPath));

                // 4. POST
                var req = new HttpRequestMessage(HttpMethod.Post,
     "https://api.minecraftservices.com/minecraft/profile/skins");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", msAcc.McAccessToken);
                req.Headers.TryAddWithoutValidation("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                req.Content = form;

                using var skinHttp = new HttpClient();
                Debug.WriteLine($"[SkinUpload] URL: {req.RequestUri}");
                Debug.WriteLine($"[SkinUpload] Auth: {(msAcc.McAccessToken.Length > 30 ? msAcc.McAccessToken.Substring(0, 30) + "..." : msAcc.McAccessToken)}");
                Debug.WriteLine($"[SkinUpload] UA: {string.Join(",", req.Headers.GetValues("User-Agent"))}");
                var resp = await skinHttp.SendAsync(req);
                var respText = await resp.Content.ReadAsStringAsync();
                Debug.WriteLine($"[SkinUpload] HTTP {(int)resp.StatusCode}: {respText}");

                if (!resp.IsSuccessStatusCode)
                {
                    var hint = "";
                    if (respText.Contains("NOT_ALLOWED")) hint = "账号未购买 MC 或受限";
                    else if (respText.Contains("RATE_LIMITED")) hint = "上传太频繁，稍后再试";
                    else if (respText.Contains("DUPLICATE")) hint = "该皮肤已存在";
                    SkinUploadLastError = ("HTTP " + (int)resp.StatusCode + " " + hint + " " + respText).Trim();
                    if (SkinUploadLastError.Length > 280) SkinUploadLastError = SkinUploadLastError.Substring(0, 280);
                    Debug.WriteLine("[SkinUpload] 失败：" + SkinUploadLastError);
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