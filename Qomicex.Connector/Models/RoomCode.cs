using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Qomicex.Connector.Models;

public class RoomCode
{
    private const string Prefix = "U/";
    private const string Pattern = @"^U/([A-HJ-NP-Z0-9]{4})-([A-HJ-NP-Z0-9]{4})-([A-HJ-NP-Z0-9]{4})-([A-HJ-NP-Z0-9]{4})$";
    private const string Chars = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

    public string Raw { get; }
    public string NetworkNamePart { get; }
    public string SecretPart { get; }
    public string EasyTierNetworkName => $"scaffolding-mc-{NetworkNamePart}";
    public string EasyTierNetworkSecret => SecretPart;

    private RoomCode(string raw, string networkNamePart, string secretPart)
    {
        Raw = raw;
        NetworkNamePart = networkNamePart;
        SecretPart = secretPart;
    }

    public static RoomCode Parse(string code)
    {
        var match = Regex.Match(code, Pattern);
        if (!match.Success)
            throw new RoomCodeInvalidException($"无效的房间码格式: {code}");

        var networkPart = $"{match.Groups[1].Value}-{match.Groups[2].Value}";
        var secretPart = $"{match.Groups[3].Value}-{match.Groups[4].Value}";

        return new RoomCode(code, networkPart, secretPart);
    }

    public static RoomCode Generate()
    {
        Span<byte> buffer = stackalloc byte[8];
        string part1, part2;
        do
        {
            RandomNumberGenerator.Fill(buffer);
            part1 = Encode8(buffer);
        } while (!ValidateChecksum(part1));
        do
        {
            RandomNumberGenerator.Fill(buffer);
            part2 = Encode8(buffer);
        } while (!ValidateChecksum(part2));

        var raw = $"{Prefix}{part1[..4]}-{part1[4..]}-{part2[..4]}-{part2[4..]}";
        return Parse(raw);
    }

    private static string Encode8(ReadOnlySpan<byte> bytes)
    {
        var chars = new char[8];
        for (int i = 0; i < 8; i++)
            chars[i] = Chars[bytes[i] % Chars.Length];
        return new string(chars);
    }

    private static bool ValidateChecksum(string eightChars)
    {
        // base-34, little-endian, 被 7 整除
        // 34 mod 7 = 6 (=-1), 所以 mod 7 的幂次交替: 1, -1, 1, -1...
        long value = 0;
        for (int i = 0; i < 8; i++)
        {
            int digit = Chars.IndexOf(eightChars[i]);
            if (digit < 0) return false;
            value += (i % 2 == 0) ? digit : -digit;
        }
        return value % 7 == 0;
    }
}
