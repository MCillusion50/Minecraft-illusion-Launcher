namespace Qomicex.Connector.Models;

public enum PlayerKind { Host, Guest }

public class PlayerInfo
{
    public string Name { get; set; } = "";
    public string MachineId { get; set; } = "";
    public string? EasyTierId { get; set; }
    public string Vendor { get; set; } = "";
    public PlayerKind Kind { get; set; }
}
