namespace Qomicex.Connector;

public class ScaffoldingException : Exception
{
    public ScaffoldingException(string message) : base(message) { }
    public ScaffoldingException(string message, Exception? inner) : base(message, inner) { }
}

public class RoomCodeInvalidException : ScaffoldingException
{
    public RoomCodeInvalidException(string message) : base(message) { }
    public RoomCodeInvalidException(string message, Exception? inner) : base(message, inner) { }
}

public class EasyTierStartException : ScaffoldingException
{
    public EasyTierStartException(string message) : base(message) { }
    public EasyTierStartException(string message, Exception? inner) : base(message, inner) { }
}

public class EasyTierTimeoutException : ScaffoldingException
{
    public EasyTierTimeoutException(string message) : base(message) { }
    public EasyTierTimeoutException(string message, Exception? inner) : base(message, inner) { }
}

public class CenterNotFoundException : ScaffoldingException
{
    public CenterNotFoundException(string message) : base(message) { }
    public CenterNotFoundException(string message, Exception? inner) : base(message, inner) { }
}

public class CenterConnectionException : ScaffoldingException
{
    public CenterConnectionException(string message) : base(message) { }
    public CenterConnectionException(string message, Exception? inner) : base(message, inner) { }
}

public class ProtocolException : ScaffoldingException
{
    public ProtocolException(string message) : base(message) { }
    public ProtocolException(string message, Exception? inner) : base(message, inner) { }
}

public class HeartbeatTimeoutException : ScaffoldingException
{
    public HeartbeatTimeoutException(string message) : base(message) { }
    public HeartbeatTimeoutException(string message, Exception? inner) : base(message, inner) { }
}
