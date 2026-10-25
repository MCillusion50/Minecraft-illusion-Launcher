using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace IllusionLauncherWPF
{
    internal static class McOptimizer
    {
        // ============ P/Invoke ============
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr h);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetProcessInformation(
            IntPtr hProcess, int infoClass, ref PROCESS_POWER_THROTTLING_STATE state, int size);

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_POWER_THROTTLING_STATE
        {
            public uint Version;
            public uint ControlMask;
            public uint StateMask;
        }

        private const int ProcessPowerThrottling = 4;
        private const uint PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1;
        private const uint PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1;
        private const uint PROCESS_SET_INFORMATION = 0x0200;
        private const uint PROCESS_QUERY_INFORMATION = 0x0400;

        // ============ 对外方法 ============

        /// <summary>
        /// MC 启动后调用：设 AboveNormal 优先级 + 关闭 Windows 电源节流。
        /// 只改这两个进程属性，其他什么都不动。
        /// </summary>
        public static void Boost(Process proc)
        {
            if (proc == null) return;
            try { if (proc.HasExited) return; } catch { return; }

            SetPriority(proc);
            DisablePowerThrottling(proc);
        }

        private static void SetPriority(Process proc)
        {
            try
            {
                proc.PriorityClass = ProcessPriorityClass.AboveNormal;
                Debug.WriteLine("[McOpt] 优先级 → AboveNormal");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[McOpt] 设置优先级失败：{ex.Message}");
            }
        }

        private static void DisablePowerThrottling(Process proc)
        {
            IntPtr h = IntPtr.Zero;
            try
            {
                h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, false, proc.Id);
                if (h == IntPtr.Zero)
                {
                    Debug.WriteLine("[McOpt] OpenProcess 失败，跳过电源节流");
                    return;
                }

                var state = new PROCESS_POWER_THROTTLING_STATE
                {
                    Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                    ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
                    StateMask = 0,   // 0 = 关闭节流
                };
                bool ok = SetProcessInformation(h, ProcessPowerThrottling, ref state,
                    Marshal.SizeOf<PROCESS_POWER_THROTTLING_STATE>());
                Debug.WriteLine($"[McOpt] 关闭电源节流：{(ok ? "成功" : "失败")}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[McOpt] 电源节流异常：{ex.Message}");
            }
            finally
            {
                if (h != IntPtr.Zero) CloseHandle(h);
            }
        }
    }
}