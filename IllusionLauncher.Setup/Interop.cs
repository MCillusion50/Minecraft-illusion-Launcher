using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace IllusionLauncher.Setup
{
    /// <summary>窗口亚克力/液态玻璃背景（Win10 1803+ / Win11）</summary>
    internal static class Acrylic
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct AccentPolicy
        {
            public int AccentState;
            public int AccentFlags;
            public int GradientColor;
            public int AnimationId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct WindowCompositionAttributeData
        {
            public int Attribute;
            public IntPtr Data;
            public int SizeOfData;
        }

        [DllImport("user32.dll")]
        private static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        private const int WCA_ACCENT_POLICY = 19;
        private const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;

        /// <summary>开启亚克力模糊。tint 为叠加色（A,R,G,B），建议半透明避免太糊。</summary>
        internal static void Enable(Window window, byte a, byte r, byte g, byte b)
        {
            try
            {
                var hwnd = new WindowInteropHelper(window).Handle;
                if (hwnd == IntPtr.Zero) return;

                var accent = new AccentPolicy
                {
                    AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND,
                    AccentFlags = 2,
                    // GradientColor 是 ABGR
                    GradientColor = (a << 24) | (b << 16) | (g << 8) | r,
                    AnimationId = 0
                };

                var size = Marshal.SizeOf(accent);
                var ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(accent, ptr, false);
                    var data = new WindowCompositionAttributeData
                    {
                        Attribute = WCA_ACCENT_POLICY,
                        Data = ptr,
                        SizeOfData = size
                    };
                    SetWindowCompositionAttribute(hwnd, ref data);
                }
                finally { Marshal.FreeHGlobal(ptr); }
            }
            catch { }
        }
    }

    /// <summary>系统原生"选择文件夹"对话框（比 WinForms 的老式对话框好看）</summary>
    internal static class FolderPicker
    {
        internal static string Pick(string title, string initialPath)
        {
            var dlg = (IFileOpenDialog)new FileOpenDialogRcw();
            try
            {
                uint options;
                dlg.GetOptions(out options);
                options |= FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
                dlg.SetOptions(options);

                if (!string.IsNullOrEmpty(title)) dlg.SetTitle(title);
                if (!string.IsNullOrEmpty(initialPath))
                {
                    try
                    {
                        IShellItem folder;
                        if (SHCreateItemFromParsingName(initialPath, IntPtr.Zero,
                                typeof(IShellItem).GUID, out folder) == 0 && folder != null)
                            dlg.SetFolder(folder);
                    }
                    catch { }
                }

                if (dlg.Show(IntPtr.Zero) != 0) return null;

                IShellItem item;
                if (dlg.GetResult(out item) != 0 || item == null) return null;

                IntPtr psz;
                if (item.GetDisplayName(SIGDN_FILESYSPATH, out psz) != 0) return null;
                try { return Marshal.PtrToStringUni(psz); }
                finally { Marshal.FreeCoTaskMem(psz); }
            }
            catch { return null; }
            finally { Marshal.ReleaseComObject(dlg); }
        }

        private const uint FOS_PICKFOLDERS = 0x20;
        private const uint FOS_FORCEFILESYSTEM = 0x40;
        private const uint FOS_PATHMUSTEXIST = 0x800;
        private const uint SIGDN_FILESYSPATH = 0x80058000;

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SHCreateItemFromParsingName(string path, IntPtr pbc,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem ppv);

        [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
        private class FileOpenDialogRcw { }

        [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"),
         InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IFileOpenDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            [PreserveSig] int SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
            [PreserveSig] int SetFileTypeIndex(uint iFileType);
            [PreserveSig] int GetFileTypeIndex(out uint piFileType);
            [PreserveSig] int Advise(IntPtr pfde, out uint pdwCookie);
            [PreserveSig] int Unadvise(uint dwCookie);
            [PreserveSig] int SetOptions(uint fos);
            [PreserveSig] int GetOptions(out uint fos);
            [PreserveSig] int SetDefaultFolder(IShellItem psi);
            [PreserveSig] int SetFolder(IShellItem psi);
            [PreserveSig] int GetFolder(out IShellItem ppsi);
            [PreserveSig] int GetCurrentSelection(out IShellItem ppsi);
            [PreserveSig] int SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            [PreserveSig] int GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
            [PreserveSig] int SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
            [PreserveSig] int SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
            [PreserveSig] int SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
            [PreserveSig] int GetResult(out IShellItem ppsi);
            [PreserveSig] int AddPlace(IShellItem psi, int fdap);
            [PreserveSig] int SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
            [PreserveSig] int Close(int hr);
            [PreserveSig] int SetClientGuid(ref Guid guid);
            [PreserveSig] int ClearClientData();
            [PreserveSig] int SetFilter(IntPtr pFilter);
        }

        [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),
         InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItem
        {
            [PreserveSig] int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            [PreserveSig] int GetParent(out IShellItem ppsi);
            [PreserveSig] int GetDisplayName(uint sigdnName, out IntPtr ppszName);
            [PreserveSig] int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
            [PreserveSig] int Compare(IShellItem psi, uint hint, out int piOrder);
        }
    }
}
