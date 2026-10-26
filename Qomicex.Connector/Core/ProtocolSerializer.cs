using System.Buffers.Binary;
using System.Text;
using Qomicex.Connector.Models;

namespace Qomicex.Connector.Core;

public static class ProtocolSerializer
{
    public static byte[] SerializeRequest(ProtocolRequest request)
    {
        var typeStr = $"{request.Namespace}:{request.RequestType}";
        var typeBytes = Encoding.ASCII.GetBytes(typeStr);

        var buffer = new byte[1 + typeBytes.Length + 4 + request.Body.Length];
        buffer[0] = (byte)typeBytes.Length;
        typeBytes.CopyTo(buffer, 1);
        BinaryPrimitives.WriteUInt32BigEndian(buffer.AsSpan(1 + typeBytes.Length), (uint)request.Body.Length);
        request.Body.CopyTo(buffer, 5 + typeBytes.Length);
        return buffer;
    }

    public static ProtocolRequest DeserializeRequest(Stream stream)
    {
        var typeLen = ReadExactByte(stream);
        var typeBytes = ReadExact(stream, typeLen);
        var typeStr = Encoding.ASCII.GetString(typeBytes);
        var bodyLen = (int)ReadExactUInt32BigEndian(stream);
        var body = ReadExact(stream, bodyLen);

        var colonIndex = typeStr.IndexOf(':');
        if (colonIndex < 0)
            throw new ProtocolException($"无效的请求类型格式: {typeStr}");

        return new ProtocolRequest
        {
            Namespace = typeStr[..colonIndex],
            RequestType = typeStr[(colonIndex + 1)..],
            Body = body
        };
    }

    public static byte[] SerializeResponse(ProtocolResponse response)
    {
        var buffer = new byte[1 + 4 + response.Body.Length];
        buffer[0] = response.Status;
        BinaryPrimitives.WriteUInt32BigEndian(buffer.AsSpan(1), (uint)response.Body.Length);
        response.Body.CopyTo(buffer, 5);
        return buffer;
    }

    public static ProtocolResponse DeserializeResponse(Stream stream)
    {
        var status = ReadExactByte(stream);
        var bodyLen = (int)ReadExactUInt32BigEndian(stream);
        var body = ReadExact(stream, bodyLen);

        return new ProtocolResponse
        {
            Status = status,
            Body = body
        };
    }

    private static byte ReadExactByte(Stream stream)
    {
        var buffer = ReadExact(stream, 1);
        return buffer[0];
    }

    private static uint ReadExactUInt32BigEndian(Stream stream)
    {
        var buffer = ReadExact(stream, 4);
        return BinaryPrimitives.ReadUInt32BigEndian(buffer);
    }

    private static byte[] ReadExact(Stream stream, int count)
    {
        if (count == 0) return [];
        var buffer = new byte[count];
        var totalRead = 0;
        while (totalRead < count)
        {
            var read = stream.Read(buffer, totalRead, count - totalRead);
            if (read == 0)
                throw new ProtocolException($"流提前结束: 期望读取 {count} 字节，实际读取 {totalRead} 字节");
            totalRead += read;
        }
        return buffer;
    }
}
