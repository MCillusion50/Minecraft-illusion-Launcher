using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;

namespace IllusionLauncherWPF
{
    public enum DiagLevel { Trace, Info, Warn, Error, Fatal }

    /// <summary>
    /// 统一诊断日志：一份写入，三处分发（VS 输出 / 内存池给 UI / 本地文件）
    /// </summary>
    public sealed class DiagnosticLogger
    {
        private static readonly DiagnosticLogger _inst = new DiagnosticLogger();
        public static DiagnosticLogger Instance => _inst;

        private readonly ConcurrentQueue<string> _recent = new ConcurrentQueue<string>();
        private readonly object _fileLock = new object();
        private string _logPath;

        /// <summary>UI 层可订阅：用来把关键日志显示在圆环/诊断面板</summary>
        public event Action<DiagLevel, string> OnLog;

        public void Init(string baseDir)
        {
            try
            {
                var dir = Path.Combine(baseDir, "logs");
                Directory.CreateDirectory(dir);
                _logPath = Path.Combine(dir, "launcher_diagnose.log");
                // ⭐ 覆盖前先留存上一轮：否则用户崩溃后重启启动器，现场就被清空，
                //    此时导出的诊断包里日志是空壳（最需要证据的时候偏偏没有）。
                try
                {
                    if (File.Exists(_logPath) && new FileInfo(_logPath).Length > 100)
                        File.Copy(_logPath, Path.Combine(dir, "launcher_diagnose.prev.log"), true);
                }
                catch { }
                File.WriteAllText(_logPath, "===== 诊断日志 " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " =====\r\n");
            }
            catch { _logPath = null; }
        }

        public void Write(DiagLevel level, string message)
        {
            var line = "[" + DateTime.Now.ToString("HH:mm:ss.fff") + "][" + level + "] " + message;
            Debug.WriteLine(line);

            _recent.Enqueue(line);
            while (_recent.Count > 800)
            {
                string _;
                _recent.TryDequeue(out _);
            }

            lock (_fileLock)
            {
                if (_logPath != null)
                {
                    try { File.AppendAllText(_logPath, line + "\r\n"); } catch { }
                }
            }

            var h = OnLog;
            if (h != null) { try { h(level, message); } catch { } }
        }

        public void Trace(string m) { Write(DiagLevel.Trace, m); }
        public void Info(string m) { Write(DiagLevel.Info, m); }
        public void Warn(string m) { Write(DiagLevel.Warn, m); }
        public void Error(string m) { Write(DiagLevel.Error, m); }
        public void Fatal(string m) { Write(DiagLevel.Fatal, m); }
        public void Error(string m, Exception ex)
        {
            Write(DiagLevel.Error, m + " | " + (ex == null ? "null" : ex.GetType().Name + ": " + ex.Message));
        }

        public string DumpRecent(int count = 200)
        {
            var arr = _recent.ToArray();
            int start = Math.Max(0, arr.Length - count);
            var sb = new System.Text.StringBuilder();
            for (int i = start; i < arr.Length; i++) sb.AppendLine(arr[i]);
            return sb.ToString();
        }
    }
}
