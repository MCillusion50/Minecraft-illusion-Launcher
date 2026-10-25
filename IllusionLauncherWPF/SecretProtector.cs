using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace IllusionLauncherWPF
{
    /// <summary>
    /// 用 Windows DPAPI（当前用户作用域）加密/解密敏感字符串。
    /// 加密后的数据只有本机、当前 Windows 账户能解开；拷到别的电脑上就是一堆废数据。
    /// 兼容旧明文：不带前缀的字符串会被原样返回，方便从明文平滑迁移。
    /// </summary>
    internal static class SecretProtector
    {
        private const string Prefix = "enc1:";

        [StructLayout(LayoutKind.Sequential)]
        private struct DATA_BLOB
        {
            public int cbData;
            public IntPtr pbData;
        }

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CryptProtectData(
            ref DATA_BLOB pDataIn, string szDataDescr, IntPtr pOptionalEntropy,
            IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DATA_BLOB pDataOut);

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CryptUnprotectData(
            ref DATA_BLOB pDataIn, IntPtr ppszDataDescr, IntPtr pOptionalEntropy,
            IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DATA_BLOB pDataOut);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr hMem);

        private const int CRYPTPROTECT_UI_FORBIDDEN = 0x1;

        public static bool IsProtected(string value)
            => !string.IsNullOrEmpty(value) && value.StartsWith(Prefix, StringComparison.Ordinal);

        /// <summary>加密。空值或已经加密过的直接原样返回。</summary>
        public static string Protect(string plain)
        {
            if (string.IsNullOrEmpty(plain)) return plain ?? "";
            if (IsProtected(plain)) return plain;

            try
            {
                var data = Encoding.UTF8.GetBytes(plain);
                var inBlob = new DATA_BLOB { cbData = data.Length, pbData = Marshal.AllocHGlobal(data.Length) };
                Marshal.Copy(data, 0, inBlob.pbData, data.Length);

                DATA_BLOB outBlob;
                bool ok = CryptProtectData(ref inBlob, "IllusionLauncher", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                                           CRYPTPROTECT_UI_FORBIDDEN, out outBlob);
                Marshal.FreeHGlobal(inBlob.pbData);

                if (!ok) return plain;   // 失败就退回明文，绝不丢数据

                try
                {
                    var outBytes = new byte[outBlob.cbData];
                    Marshal.Copy(outBlob.pbData, outBytes, 0, outBlob.cbData);
                    return Prefix + Convert.ToBase64String(outBytes);
                }
                finally { LocalFree(outBlob.pbData); }
            }
            catch { return plain; }
        }

        /// <summary>解密。明文（无前缀）原样返回；解密失败也原样返回，绝不抛异常。</summary>
        public static string Unprotect(string stored)
        {
            if (string.IsNullOrEmpty(stored)) return stored ?? "";
            if (!IsProtected(stored)) return stored;   // 旧明文，直接当明文用

            try
            {
                var raw = Convert.FromBase64String(stored.Substring(Prefix.Length));
                var inBlob = new DATA_BLOB { cbData = raw.Length, pbData = Marshal.AllocHGlobal(raw.Length) };
                Marshal.Copy(raw, 0, inBlob.pbData, raw.Length);

                DATA_BLOB outBlob;
                bool ok = CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                                             CRYPTPROTECT_UI_FORBIDDEN, out outBlob);
                Marshal.FreeHGlobal(inBlob.pbData);

                if (!ok) return stored;

                try
                {
                    var outBytes = new byte[outBlob.cbData];
                    Marshal.Copy(outBlob.pbData, outBytes, 0, outBlob.cbData);
                    return Encoding.UTF8.GetString(outBytes);
                }
                finally { LocalFree(outBlob.pbData); }
            }
            catch { return stored; }
        }
    }
}
