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

        /// <summary>
        /// 判断皮肤是不是 slim（细手臂）模型。
        /// 依据：64x64 皮肤里，classic 的手臂纹理会覆盖 (54,20)，而 slim 只画到 3px 宽，(54,20) 是透明。
        /// 这是社区通用判定方式（skinview3d 等都用这个坐标）。
        /// </summary>
        private static bool IsSlimSkin(byte[] pngBytes)
        {
            try
            {
                using var ms = new System.IO.MemoryStream(pngBytes);
                var bmp = new System.Windows.Media.Imaging.BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                bmp.StreamSource = ms;
                bmp.EndInit();

                // 64x32 老格式没有 slim/classic 之分
                if (bmp.PixelWidth < 64 || bmp.PixelHeight < 64) return false;

                var conv = new System.Windows.Media.Imaging.FormatConvertedBitmap(
                    bmp, System.Windows.Media.PixelFormats.Bgra32, null, 0);

                var pixel = new byte[4];
                conv.CopyPixels(new System.Windows.Int32Rect(54, 20, 1, 1), pixel, 4, 0);
                return pixel[3] == 0;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>读取正版账号 profile（含 capes 列表）。</summary>
                /// <summary>披风纹理裁剪：取 (1,1) 的 10x16 区域，放大 8 倍成 80x128，返回 dataUri。</summary>
        internal static string BuildCapeThumbDataUri(byte[] pngBytes)
        {
            try
            {
                System.Windows.Media.Imaging.BitmapImage src;
                using (var ms = new MemoryStream(pngBytes))
                {
                    src = new System.Windows.Media.Imaging.BitmapImage();
                    src.BeginInit();
                    src.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                    src.StreamSource = ms;
                    src.EndInit();
                }
                src.Freeze();
                if (src.PixelWidth < 11 || src.PixelHeight < 17) return null;

                var cropped = new System.Windows.Media.Imaging.CroppedBitmap(src, new System.Windows.Int32Rect(1, 1, 10, 16));
                var conv = new System.Windows.Media.Imaging.FormatConvertedBitmap(cropped, System.Windows.Media.PixelFormats.Pbgra32, null, 0);
                var pix = new byte[10 * 16 * 4];
                conv.CopyPixels(pix, 10 * 4, 0);

                const int f = 8, w = 10 * f, h = 16 * f;
                var dst = new byte[w * h * 4];
                for (var y = 0; y < h; y++)
                {
                    for (var x = 0; x < w; x++)
                    {
                        var si = ((y / f) * 10 + (x / f)) * 4;
                        var di = (y * w + x) * 4;
                        dst[di] = pix[si]; dst[di + 1] = pix[si + 1];
                        dst[di + 2] = pix[si + 2]; dst[di + 3] = pix[si + 3];
                    }
                }

                var outBmp = System.Windows.Media.Imaging.BitmapSource.Create(w, h, 96, 96,
                    System.Windows.Media.PixelFormats.Pbgra32, null, dst, w * 4);
                outBmp.Freeze();

                var enc = new System.Windows.Media.Imaging.PngBitmapEncoder();
                enc.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(outBmp));
                using var outMs = new MemoryStream();
                enc.Save(outMs);
                return "data:image/png;base64," + Convert.ToBase64String(outMs.ToArray());
            }
            catch { return null; }
        }

        /// <summary>下载披风纹理并生成缩略图。</summary>
        internal async Task<string> FetchCapeThumbAsync(string url)
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                var bytes = await http.GetByteArrayAsync(url);
                return BuildCapeThumbDataUri(bytes);
            }
            catch { return null; }
        }

internal async Task<(bool ok, string json, string error)> FetchProfileAsync(string username)
        {
            try
            {
                var acc = FindMsAccountByName(username);
                if (acc == null) return (false, null, "找不到正版账户");
                acc = await EnsureMsTokenValidAsync(acc);
                if (acc == null || string.IsNullOrEmpty(acc.McAccessToken))
                    return (false, null, "登录已过期，请重新登录");

                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                using var req = new HttpRequestMessage(HttpMethod.Get, "https://api.minecraftservices.com/minecraft/profile");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", acc.McAccessToken);
                req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                var resp = await http.SendAsync(req);
                var body = await resp.Content.ReadAsStringAsync();
                if (!resp.IsSuccessStatusCode)
                    return (false, null, $"HTTP {(int)resp.StatusCode}: {(body.Length > 200 ? body.Substring(0, 200) : body)}");
                try
                {
                    File.AppendAllText(Path.Combine(Path.GetTempPath(), "illusionlauncher-cape.log"),
                        $"[{DateTime.Now:HH:mm:ss}] profile: {(body.Length > 800 ? body.Substring(0, 800) : body)}\r\n");
                }
                catch { }
                return (true, body, null);
            }
            catch (Exception ex) { return (false, null, "异常：" + ex.Message); }
        }

        /// <summary>切换披风；capeId 为空表示取消披风。</summary>
        internal async Task<(bool ok, string error)> SetActiveCapeAsync(string username, string capeId)
        {
            try
            {
                var acc = FindMsAccountByName(username);
                if (acc == null) return (false, "找不到正版账户");
                acc = await EnsureMsTokenValidAsync(acc);
                if (acc == null || string.IsNullOrEmpty(acc.McAccessToken))
                    return (false, "登录已过期，请重新登录");

                var isNone = string.IsNullOrWhiteSpace(capeId);
                var attempts = new List<(HttpMethod method, string url, string json)>();
                if (isNone)
                {
                    attempts.Add((HttpMethod.Delete, "https://api.minecraftservices.com/minecraft/profile/capes/active", null));
                }
                else
                {
                    // Mojang 没公开文档，不同版本路径不同，逐个试
                    attempts.Add((HttpMethod.Put, "https://api.minecraftservices.com/minecraft/profile/capes/active/" + capeId, null));
                    attempts.Add((HttpMethod.Put, "https://api.minecraftservices.com/minecraft/profile/capes/active", "{\"capeId\":\"" + capeId + "\"}"));
                    attempts.Add((HttpMethod.Post, "https://api.minecraftservices.com/minecraft/profile/capes/active/" + capeId, null));
                }

                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                var lastErr = "未知错误";
                foreach (var a in attempts)
                {
                    try
                    {
                        using var req = new HttpRequestMessage(a.method, a.url);
                        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", acc.McAccessToken);
                        req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
                        if (a.json != null)
                            req.Content = new StringContent(a.json, Encoding.UTF8, "application/json");
                        var resp = await http.SendAsync(req);
                        var bodyText = await resp.Content.ReadAsStringAsync();
                        if (resp.IsSuccessStatusCode)
                            return (true, null);
                        lastErr = $"HTTP {(int)resp.StatusCode} [{a.method} {a.url}] {(bodyText.Length > 120 ? bodyText.Substring(0, 120) : bodyText)}";
                        if ((int)resp.StatusCode == 401 || (int)resp.StatusCode == 403)
                            break;
                    }
                    catch (Exception ex) { lastErr = "异常：" + ex.Message; }
                }
                return (false, lastErr);
            }
            catch (Exception ex) { return (false, "异常：" + ex.Message); }
        }

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
                // 自动检测模型：slim 皮肤在 (54,20) 处是透明像素，classic 不透明
                var detectedVariant = IsSlimSkin(pngBytes) ? "slim" : "classic";
                form.Add(new StringContent(detectedVariant, Encoding.UTF8), "variant");
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