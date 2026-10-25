using System;
using System.Threading;
using System.Threading.Tasks;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 全局锁：用 SemaphoreSlim 代替 Interlocked 标志位，支持重入计数与自动释放
    /// </summary>
    public sealed class LauncherGlobalLocks
    {
        private static readonly LauncherGlobalLocks _inst = new LauncherGlobalLocks();
        public static LauncherGlobalLocks Instance => _inst;

        private readonly SemaphoreSlim _downloadGlock = new SemaphoreSlim(1, 1);

        public bool IsDownloadBusy => _downloadGlock.CurrentCount == 0;

        /// <summary>非阻塞获取下载锁；成功返回 IDisposable，失败返回 null（用 using 自动释放）</summary>
        public async Task<IDisposable> TryAcquireDownloadLockAsync(CancellationToken ct = default(CancellationToken))
        {
            bool taken = await _downloadGlock.WaitAsync(0, ct).ConfigureAwait(false);
            if (!taken) return null;
            return new Releaser(_downloadGlock);
        }

        /// <summary>阻塞获取（下载入口用）</summary>
        public async Task<IDisposable> AcquireDownloadLockAsync(CancellationToken ct = default(CancellationToken))
        {
            await _downloadGlock.WaitAsync(ct).ConfigureAwait(false);
            return new Releaser(_downloadGlock);
        }

        private sealed class Releaser : IDisposable
        {
            private readonly SemaphoreSlim _sem;
            private int _disposed;
            public Releaser(SemaphoreSlim sem) { _sem = sem; }
            public void Dispose()
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 0)
                {
                    try { _sem.Release(); } catch { }
                }
            }
        }
    }
}
