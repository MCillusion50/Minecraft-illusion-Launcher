using System.Text.Json.Serialization;
using Qomicex.Connector.Models;

namespace Qomicex.Connector;

[JsonSourceGenerationOptions(WriteIndented = false, PropertyNamingPolicy = JsonKnownNamingPolicy.SnakeCaseLower)]
[JsonSerializable(typeof(PlayerProfileEntry))]
[JsonSerializable(typeof(PlayerProfileEntry[]))]
public partial class ConnectorJsonContext : JsonSerializerContext
{
}
