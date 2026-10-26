namespace Qomicex.Connector.Core;

public static class ProtocolNegotiator
{
    public static IReadOnlyList<string> Negotiate(IReadOnlyList<string> myProtocols, IReadOnlyList<string> centerProtocols)
    {
        var centerSet = new HashSet<string>(centerProtocols);
        return myProtocols.Where(p => centerSet.Contains(p)).ToList();
    }
}
