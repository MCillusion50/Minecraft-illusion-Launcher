namespace Qomicex.Connector.Models;

public class ProtocolRequest
{
    public string Namespace { get; set; } = "";
    public string RequestType { get; set; } = "";
    public byte[] Body { get; set; } = [];
}

public class ProtocolResponse
{
    public byte Status { get; set; }
    public byte[] Body { get; set; } = [];
    public bool IsSuccess => Status == 0;
}
