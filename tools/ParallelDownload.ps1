<#
.SYNOPSIS
    多线程分段下载器（与启动器 ThreadDownloader 同一套思路：Range 分段 + 并发 + 断点续传）。

.EXAMPLE
    .\ParallelDownload.ps1 -Url "https://gh-proxy.com/https://github.com/..." -OutFile "$env:TEMP\x.exe" -Connections 16
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int]$Connections = 16,
    [int]$ChunkMB = 4
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$cs = @'
using System;
using System.IO;
using System.Net;
using System.Threading;
using System.Collections.Generic;

namespace DshTools
{
    public static class ParallelDownloader
    {
        public static long Total;
        public static long Downloaded;
        public static int Segments;
        public static string LastError = "";
        private static readonly object Log = new object();

        private static HttpWebRequest MakeRequest(string url)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IllusionLauncher/1.0";
            req.Timeout = 60000;
            req.ReadWriteTimeout = 300000;
            req.AllowAutoRedirect = true;
            return req;
        }

        private static bool Probe(string url, out long size)
        {
            size = -1;
            try
            {
                var req = MakeRequest(url);
                req.Method = "GET";
                req.AddRange(0, 0);
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    string cr = resp.Headers["Content-Range"];
                    if (cr != null && cr.Contains("/"))
                    {
                        string s = cr.Substring(cr.LastIndexOf('/') + 1).Trim();
                        long v;
                        if (long.TryParse(s, out v)) { size = v; return true; }
                    }
                    if (resp.ContentLength > 1) { size = resp.ContentLength; return false; }
                }
            }
            catch (Exception ex) { LastError = "probe: " + ex.Message; }
            try
            {
                var req2 = MakeRequest(url);
                req2.Method = "HEAD";
                using (var resp2 = (HttpWebResponse)req2.GetResponse())
                {
                    if (resp2.ContentLength > 0) size = resp2.ContentLength;
                    return string.Equals(resp2.Headers["Accept-Ranges"], "bytes", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch (Exception ex) { LastError = "head: " + ex.Message; }
            return false;
        }

        private static void FetchSegment(string url, long start, long end, string segPath, int index)
        {
            for (int attempt = 0; attempt < 6; attempt++)
            {
                try
                {
                    long already = File.Exists(segPath) ? new FileInfo(segPath).Length : 0;
                    long reqStart = start + already;
                    if (reqStart > end) return;

                    var req = MakeRequest(url);
                    req.AddRange(reqStart, end);
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    using (var s = resp.GetResponseStream())
                    using (var fs = new FileStream(segPath, already > 0 ? FileMode.Append : FileMode.Create,
                                                   FileAccess.Write, FileShare.None, 131072))
                    {
                        var buf = new byte[131072];
                        int n;
                        while ((n = s.Read(buf, 0, buf.Length)) > 0)
                        {
                            fs.Write(buf, 0, n);
                            Interlocked.Add(ref Downloaded, n);
                        }
                    }
                    return;
                }
                catch (Exception ex)
                {
                    if (attempt == 5) throw new Exception("segment " + (index + 1) + " failed: " + ex.Message);
                    Thread.Sleep(700);
                }
            }
        }

        public static string Run(string url, string outFile, int connections, long chunkBytes)
        {
            Total = 0; Downloaded = 0; Segments = 0; LastError = "";
            try
            {
                if (connections < 1) connections = 1;
                if (connections > 64) connections = 64;
                if (chunkBytes < 1048576) chunkBytes = 1048576;

                long size;
                bool range = Probe(url, out size);
                if (size <= 0) return "FAIL: cannot probe size (" + LastError + ")";
                Total = size;

                string dir = Path.GetDirectoryName(outFile);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);

                if (!range || size <= chunkBytes)
                {
                    using (var wc = new WebClient())
                    {
                        wc.Headers.Add("User-Agent", "Mozilla/5.0");
                        wc.DownloadProgressChanged += delegate (object o, DownloadProgressChangedEventArgs e)
                        { Downloaded = e.BytesReceived; };
                        wc.DownloadFileAsync(new Uri(url), outFile);
                        while (wc.IsBusy) Thread.Sleep(200);
                    }
                    Downloaded = size;
                    return "OK";
                }

                string tempDir = outFile + ".parts";
                // 保留已有分片，支持断点续传；仅当分片总数不匹配时重建
                if (!Directory.Exists(tempDir)) Directory.CreateDirectory(tempDir);

                int chunks = (int)Math.Ceiling((double)size / chunkBytes);
                if (chunks > connections) chunks = connections;
                if (chunks < 1) chunks = 1;
                Segments = chunks;
                long segSize = (long)Math.Ceiling((double)size / chunks);

                var threads = new List<Thread>();
                var errors = new List<string>();
                for (int i = 0; i < chunks; i++)
                {
                    int idx = i;
                    long segStart = (long)i * segSize;
                    long segEnd = Math.Min(segStart + segSize - 1, size - 1);
                    if (segStart > segEnd) break;
                    string p = Path.Combine(tempDir, "seg_" + idx + ".part");
                    var t = new Thread(delegate ()
                    {
                        try { FetchSegment(url, segStart, segEnd, p, idx); }
                        catch (Exception ex) { lock (Log) { errors.Add(ex.Message); } }
                    });
                    t.IsBackground = true;
                    t.Start();
                    threads.Add(t);
                }
                foreach (var t in threads) t.Join();
                if (errors.Count > 0)
                    return "FAIL: " + string.Join("; ", errors.ToArray()) + " (分片已保留，可直接重跑续传)";

                using (var outFs = new FileStream(outFile, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20))
                {
                    for (int i = 0; i < chunks; i++)
                    {
                        string p = Path.Combine(tempDir, "seg_" + i + ".part");
                        if (!File.Exists(p)) throw new Exception("segment " + (i + 1) + " missing");
                        using (var segFs = File.OpenRead(p)) segFs.CopyTo(outFs, 1 << 20);
                    }
                }
                Downloaded = size;
                try { Directory.Delete(tempDir, true); } catch { }
                return "OK";
            }
            catch (Exception ex) { return "FAIL: " + ex.Message; }
        }
    }
}
'@

if (-not ('DshTools.ParallelDownloader' -as [type])) {
    Add-Type -TypeDefinition $cs -Language CSharp
}

Write-Host "目标: $Url" -ForegroundColor Cyan
Write-Host "保存: $OutFile" -ForegroundColor Cyan

$ps = [powershell]::Create()
[void]$ps.AddScript({
    param($u, $o, $c, $ch)
    [DshTools.ParallelDownloader]::Run($u, $o, $c, $ch)
}).AddArgument($Url).AddArgument($OutFile).AddArgument($Connections).AddArgument([long]$ChunkMB * 1MB)

$handle = $ps.BeginInvoke()
$lastPct = -1
while (-not $handle.IsCompleted) {
    Start-Sleep -Milliseconds 500
    $t = [DshTools.ParallelDownloader]::Total
    $d = [DshTools.ParallelDownloader]::Downloaded
    if ($t -gt 0) {
        $pct = [int](100.0 * $d / $t)
        if ($pct -ne $lastPct) {
            Write-Host ("`r  {0,3}%  {1:N1} / {2:N1} MB  ({3} 段)" -f $pct, ($d / 1MB), ($t / 1MB), [DshTools.ParallelDownloader]::Segments) -NoNewline
            $lastPct = $pct
        }
    }
}

$result = $ps.EndInvoke($handle) | Select-Object -Last 1
$ps.Dispose()
Write-Host ""
if ($result -eq 'OK') {
    $fi = Get-Item $OutFile
    Write-Host ("完成: {0}  {1:N2} MB" -f $fi.FullName, ($fi.Length / 1MB)) -ForegroundColor Green
    exit 0
} else {
    Write-Host "失败: $result" -ForegroundColor Red
    exit 1
}
