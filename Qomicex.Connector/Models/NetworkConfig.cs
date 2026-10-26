namespace Qomicex.Connector.Models;

public class NetworkConfig
{
    public string NetworkName { get; set; } = "";
    public string NetworkSecret { get; set; } = "";
    public string Hostname { get; set; } = "";
    public string? EasyTierPath { get; set; }
    public bool NoTun { get; set; } = true;
    public bool UseSmoltcp { get; set; } = false;
    public bool Dhcp { get; set; } = true;
    public string? Ipv4 { get; set; }
    public bool ListenRandomPorts { get; set; } = true;
    public string[] TcpWhitelist { get; set; } = [];
    public string[] PortForwards { get; set; } = [];
    public string[]? RelayNodes { get; set; }
}
