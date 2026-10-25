using System;
using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using WinRT;

namespace IllusionLauncherWPF
{
    public class MonitorCaptureHelper
    {
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int left, top, right, bottom; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [ComImport]
        [Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IGraphicsCaptureItemInterop
        {
            IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
            IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
        }

        public GraphicsCaptureItem? CreateItemForPrimaryMonitor()
        {
            try
            {
                var hwnd = GetForegroundWindow();
                var hmon = MonitorFromWindow(hwnd, 1); // MONITOR_DEFAULTTONEAREST

                var mi = new MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                GetMonitorInfo(hmon, ref mi);

                var interop = GraphicsCaptureItem.As<IGraphicsCaptureItemInterop>();
                var iid = typeof(GraphicsCaptureItem).GUID;

                var ptr = interop.CreateForMonitor(hmon, ref iid);
                return Marshal.GetObjectForIUnknown(ptr) as GraphicsCaptureItem;
            }
            catch
            {
                return null;
            }
        }
    }
}