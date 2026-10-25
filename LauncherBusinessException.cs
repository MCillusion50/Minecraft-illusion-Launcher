using System;

namespace IllusionLauncherWPF
{
    /// <summary>业务异常：带可直接展示给用户的中文文案，入口必须捕获并转成 UI 提示</summary>
    public class LauncherBusinessException : Exception
    {
        public string UserMessage { get; }
        public string TechnicalDetail { get; }

        public LauncherBusinessException(string userMessage, string technicalDetail = null, Exception inner = null)
            : base(string.IsNullOrEmpty(technicalDetail) ? userMessage : technicalDetail, inner)
        {
            UserMessage = userMessage;
            TechnicalDetail = technicalDetail;
        }
    }

    /// <summary>环境异常：Java 缺失、目录无权限等，不属于代码 bug</summary>
    public class LauncherEnvironmentException : Exception
    {
        public string UserMessage { get; }

        public LauncherEnvironmentException(string userMessage, Exception inner = null) : base(userMessage, inner)
        {
            UserMessage = userMessage;
        }
    }
}
