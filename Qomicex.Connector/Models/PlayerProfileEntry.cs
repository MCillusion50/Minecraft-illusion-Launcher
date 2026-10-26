using System.Text.Json.Serialization;

namespace Qomicex.Connector.Models;

public record PlayerProfileEntry
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    [JsonPropertyName("machine_id")]
    public string MachineId { get; init; } = "";

    [JsonPropertyName("easytier_id")]
    public string? EasyTierId { get; init; }

    [JsonPropertyName("vendor")]
    public string Vendor { get; init; } = "";

    [JsonPropertyName("kind")]
    public string? Kind { get; init; }
}
