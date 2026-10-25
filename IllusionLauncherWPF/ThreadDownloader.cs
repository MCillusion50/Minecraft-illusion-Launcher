using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 通用多线程下载器（"线程下载"胶囊区的后端）。
    ///
    /// 与现有的 DownloadParallelAsync 区别：
    ///   - 并发数、分片大小 由调用方传入（可调），不是写死的 16 段
    ///   - 支持任意 http/https 直链，不限于 Minecraft 资源
    ///
    /// 复用现有基础设施：_http（连接池）、_httpGate（全局并发闸门 160）、
    /// _dlSessionToken（取消令牌，与侧边 toast 的取消按钮共用）。
    /// 只新增文件，不改动任何现有下载逻辑。
    /// </summary>
    public sealed partial class MainWindow
    {
        /// <summary>
        /// 多线程分片下载任意文件。
        /// progress(downloaded, total, speedBytesPerSec) 由调用方节流使用（内部已按 300ms 节流）。
        /// 返回 (ok, errorMessage)。
        /// </summary>
        public async Task<(bool ok, string error)> ThreadDownloadAsync(
            string url, string savePath, int connections, long chunkBytes,
            Action<long, long, double> progress)
        {
            var ct = _dlSessionToken;
            string tempDir = null;

            try
            {
                if (string.IsNullOrWhiteSpace(url)) return (false, "下载链接为空");
                if (string.IsNullOrWhiteSpace(savePath)) return (false, "没有选择保存位置");
                if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                    !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    return (false, "只支持 http/https 直链");

                if (connections < 1) connections = 1;
                if (connections > 256) connections = 256;
                if (chunkBytes < 256 * 1024) chunkBytes = 256 * 1024;

                var (size, supportsRange) = await ProbeAsync(url, 15000);
                if (size <= 0) return (false, "探测不到文件大小（链接可能失效，或需要登录/Cookie）");

                var dir = Path.GetDirectoryName(savePath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

                // 不支持 Range 或文件很小 → 单连接直接下
                if (!supportsRange || size <= chunkBytes)
                {
                    await DownloadFileAsync(url, url, savePath, (d, t) => progress?.Invoke(d, t, 0), null);
                    return (true, "");
                }

                tempDir = savePath + ".parts";
                try { if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true); } catch { }
                Directory.CreateDirectory(tempDir);

                int chunks = (int)Math.Ceiling((double)size / chunkBytes);
                if (chunks > connections) chunks = connections;
                if (chunks < 1) chunks = 1;
                long segSize = (long)Math.Ceiling((double)size / chunks);

                long totalDownloaded = 0;
                long lastBytes = 0;
                var lastReport = DateTime.Now;
                var plock = new object();
                var tasks = new List<Task>();

                for (int i = 0; i < chunks; i++)
                {
                    int idx = i;
                    long start = i * segSize;
                    long end = Math.Min(start + segSize - 1, size - 1);
                    if (start > end) break;
                    string segPath = Path.Combine(tempDir, $"seg_{idx}.part");

                    tasks.Add(Task.Run(async () =>
                    {
                        long expected = end - start + 1;
                        if (File.Exists(segPath) && new FileInfo(segPath).Length == expected)
                        {
                            Interlocked.Add(ref totalDownloaded, expected);
                            return;
                        }

                        for (int retry = 0; retry < 3; retry++)
                        {
                            try
                            {
                                long already = File.Exists(segPath) ? new FileInfo(segPath).Length : 0;
                                long reqStart = start + already;
                                if (reqStart > end) reqStart = end;

                                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                                req.Headers.Range = new RangeHeaderValue(reqStart, end);

                                await _httpGate.WaitAsync(ct);
                                HttpResponseMessage resp;
                                try
                                {
                                    resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                                }
                                finally { _httpGate.Release(); }

                                using (resp)
                                {
                                    if (resp.StatusCode != System.Net.HttpStatusCode.PartialContent &&
                                        resp.StatusCode != System.Net.HttpStatusCode.OK)
                                        resp.EnsureSuccessStatusCode();

                                    using var stream = await resp.Content.ReadAsStreamAsync(ct);
                                    using var fs = new FileStream(segPath, already > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None, 131072, true);

                                    var buf = new byte[131072];
                                    int read;
                                    while ((read = await stream.ReadAsync(buf, 0, buf.Length, ct)) > 0)
                                    {
                                        await fs.WriteAsync(buf, 0, read, ct);
                                        Interlocked.Add(ref totalDownloaded, read);

                                        lock (plock)
                                        {
                                            var now = DateTime.Now;
                                            if ((now - lastReport).TotalMilliseconds >= 300)
                                            {
                                                double secs = (now - lastReport).TotalSeconds;
                                                double speed = secs > 0 ? (totalDownloaded - lastBytes) / secs : 0;
                                                progress?.Invoke(totalDownloaded, size, speed);
                                                lastReport = now;
                                                lastBytes = totalDownloaded;
                                            }
                                        }
                                    }
                                }
                                return;
                            }
                            catch (OperationCanceledException) { throw; }
                            catch
                            {
                                if (retry < 2) await Task.Delay(600, ct);
                            }
                        }
                        throw new Exception($"第 {idx + 1} 段下载失败（已重试 3 次）");
                    }, ct));
                }

                await Task.WhenAll(tasks);

                // 按顺序合并分片
                using (var outFs = new FileStream(savePath, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20, true))
                {
                    for (int i = 0; i < chunks; i++)
                    {
                        var segPath = Path.Combine(tempDir, $"seg_{i}.part");
                        if (!File.Exists(segPath))
                            throw new Exception($"第 {i + 1} 段文件缺失，合并中断");
                        using var segFs = File.OpenRead(segPath);
                        await segFs.CopyToAsync(outFs, ct);
                    }
                }

                try { Directory.Delete(tempDir, true); } catch { }
                tempDir = null;

                progress?.Invoke(size, size, 0);
                DiagnosticLogger.Instance.Info($"[ThreadDL] 完成：{Path.GetFileName(savePath)}，{size / 1024} KB，{chunks} 段");
                return (true, "");
            }
            catch (OperationCanceledException)
            {
                try { if (tempDir != null && Directory.Exists(tempDir)) Directory.Delete(tempDir, true); } catch { }
                try { if (File.Exists(savePath)) File.Delete(savePath); } catch { }
                return (false, "已取消");
            }
            catch (Exception ex)
            {
                try { if (tempDir != null && Directory.Exists(tempDir)) Directory.Delete(tempDir, true); } catch { }
                DiagnosticLogger.Instance.Error("[ThreadDL] 失败：" + ex.Message);
                return (false, ex.Message);
            }
        }
    }
}
