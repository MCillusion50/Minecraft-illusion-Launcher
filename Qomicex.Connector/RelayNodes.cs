namespace Qomicex.Connector;

public static class RelayNodes
{
    public static IReadOnlyList<string> Default { get; } =
    [
        "https://etnode.zkitefly.eu.org/node1",
        "https://etnode.zkitefly.eu.org/node2"
    ];

    public static string[] Resolve(IEnumerable<string>? overrideNodes, IEnumerable<string>? additional)
    {
        var result = new List<string>(overrideNodes ?? Default);
        if (additional is not null)
            result.AddRange(additional);
        return result.ToArray();
    }
}
