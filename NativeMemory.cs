using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace IllusionLauncherWPF
{
    public static class NativeMemory
    {
        [DllImport("ntdll.dll")]
        private static extern int NtSetSystemInformation(int SystemInformationClass, IntPtr SystemInformation, int SystemInformationLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccesss, out IntPtr TokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, int BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [DllImport("psapi.dll", SetLastError = true)]
        private static extern bool EmptyWorkingSet(IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        private const uint PROCESS_SET_QUOTA = 0x0100;
        private const uint PROCESS_QUERY_INFORMATION = 0x0400;

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct TOKEN_PRIVILEGES
        {
            public int PrivilegeCount;
            public long Luid;
            public int Attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private class MEMORYSTATUSEX
        {
            public uint dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
        }

        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX lpBuffer);

        public static long GetAvailableMemory()
        {
            var mem = new MEMORYSTATUSEX();
            GlobalMemoryStatusEx(mem);
            return (long)mem.ullAvailPhys;
        }

        /// <summary>总物理内存（MB），用于自动内存分配</summary>
        public static int GetTotalPhysicalMemoryMB()
        {
            try
            {
                var mem = new MEMORYSTATUSEX();
                if (!GlobalMemoryStatusEx(mem) || mem.ullTotalPhys == 0) return 8192;
                return (int)(mem.ullTotalPhys / 1024UL / 1024UL);
            }
            catch { return 8192; }
        }

        public static void RunOptimize()
        {
            // 1. 提权：获取系统级进程权限
            EnablePrivilege("SeProfileSingleProcessPrivilege");
            EnablePrivilege("SeIncreaseQuotaPrivilege");

            // 2. 核心：清理系统备用列表（MemoryPurgeStandbyList）
            CallNtMemoryCommand(3);
            CallNtMemoryCommand(4);
            CallNtMemoryCommand(5);

            // 3. 辅助：把所有进程的物理内存压缩回页面文件
            EmptyAllWorkingSets();
        }

        private static void CallNtMemoryCommand(int command)
        {
            IntPtr ptr = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                Marshal.WriteInt32(ptr, command);
                // 0x50 对应 SystemMemoryListInformation
                NtSetSystemInformation(0x50, ptr, sizeof(int));
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
        }

        private static void EmptyAllWorkingSets()
        {
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id > 4)
                    {
                        IntPtr hProcess = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, p.Id);
                        if (hProcess != IntPtr.Zero)
                        {
                            EmptyWorkingSet(hProcess);
                            CloseHandle(hProcess);
                        }
                    }
                }
                catch { }
            }
        }

        private static void EnablePrivilege(string privilege)
        {
            IntPtr tokenHandle;
            if (!OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, out tokenHandle)) return;
            try
            {
                long luid;
                if (!LookupPrivilegeValue(null, privilege, out luid)) return;

                TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES
                {
                    PrivilegeCount = 1,
                    Luid = luid,
                    Attributes = 0x00000002 // SE_PRIVILEGE_ENABLED
                };
                AdjustTokenPrivileges(tokenHandle, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
            }
            finally
            {
                CloseHandle(tokenHandle);
            }
        }
    }
}