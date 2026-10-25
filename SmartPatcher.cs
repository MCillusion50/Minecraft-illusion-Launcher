using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace IllusionLauncherWPF
{
    // 补丁接口：所有奇葩老版本的修复，都实现这个接口
    public interface IForgeLegacyPatch
    {
        // 判断当前版本是不是命中这个补丁
        bool Match(VersionJson version);

        // 命中后，往 Libraries 里注入缺失的依赖
        void Apply(VersionJson version);
    }

    public static class SmartPatcher
    {
        // 这里登记所有的补丁插件，以后有新坑，在这里 new 一个放进来就行
        private static readonly List<IForgeLegacyPatch> _patches = new List<IForgeLegacyPatch>
        {
            new LegacyFmlLzmaPatch(),
            new Forge1122Patch()
        };

        public static void RunPatches(VersionJson version)
        {
            if (version == null) return;
            foreach (var patch in _patches)
            {
                if (patch.Match(version))
                {
                    patch.Apply(version);
                    System.Diagnostics.Debug.WriteLine($"[SmartPatcher] 已触发补丁: {patch.GetType().Name}");
                }
            }
        }
    }

    // ============================================================
    // 补丁 1：1.7.10 专属老 FML 补丁（注入 LZMA 和 老 ASM）
    // ============================================================
    public class LegacyFmlLzmaPatch : IForgeLegacyPatch
    {
        public bool Match(VersionJson version)
        {
            // 1.7.x 的特征：主类包含 cpw.mods.fml
            if (!string.IsNullOrEmpty(version.MainClass) && version.MainClass.Contains("cpw.mods.fml.relauncher"))
                return true;

            // 或者版本名里带 1.7.10 且是 Forge
            if (version.Id != null && version.Id.Contains("1.7.10") && version.Id.Contains("forge"))
                return true;

            return false;
        }

        public void Apply(VersionJson version)
        {
            if (version.Libraries == null) version.Libraries = new List<LibraryEntry>();

            // 强行补入 1.7.10 的保底依赖（Maven 坐标格式）
            var legacyLibs = new[]
            {
                "org.ow2.asm:asm-all:5.0.3",
                "org.ow2.asm:asm-debug-all:5.0.3",
                "lzma:lzma:0.0.1",
                "org.tukaani:xz:1.5"
            };

            foreach (var libName in legacyLibs)
            {
                // 如果已经有，就不重复塞了
                if (version.Libraries.Any(l => l.Name == libName)) continue;

                var coord = MavenCoordinate.Parse(libName);
                version.Libraries.Add(new LibraryEntry
                {
                    Name = libName,
                    Path = coord.ToRelativePath()
                });
            }
        }
    }

    // ============================================================
    // 补丁 2：1.12.2 专属老 Forge 补丁（注入 Universal 核心）
    // ============================================================
    public class Forge1122Patch : IForgeLegacyPatch
    {
        public bool Match(VersionJson version)
        {
            // 1.12.2 特征：版本名带 1.12.2 且带 forge
            if (version.Id != null && version.Id.Contains("1.12.2") && version.Id.Contains("forge"))
                return true;
            return false;
        }

        public void Apply(VersionJson version)
        {
            if (version.Libraries == null) version.Libraries = new List<LibraryEntry>();

            // 从版本号里提取出 forge 的版本（比如 1.12.2-forge-14.23.5.2860）
            var id = version.Id;
            var parts = id.Split(new[] { "-forge-" }, StringSplitOptions.None);
            if (parts.Length >= 2)
            {
                var fullVer = $"{parts[0]}-{parts[1]}"; // 拼成 1.12.2-14.23.5.2860
                var libName = $"net.minecraftforge:forge:{fullVer}:universal";

                if (version.Libraries.Any(l => l.Name != null && l.Name.Contains(libName)))
                    return;

                var coord = MavenCoordinate.Parse(libName);
                version.Libraries.Add(new LibraryEntry
                {
                    Name = libName,
                    Path = coord.ToRelativePath()
                });
            }
        }
    }
}