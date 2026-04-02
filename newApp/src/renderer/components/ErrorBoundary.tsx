import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: "" };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ errorInfo: info.componentStack ?? "" });
    console.error("[ErrorBoundary] Caught render error:", error, info);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: "" });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          padding: "40px",
          background: "#0c0c0c",
          color: "#e4e4e7",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}>
          <div style={{
            maxWidth: 500,
            textAlign: "center",
          }}>
            <h1 style={{ fontSize: 24, marginBottom: 8, color: "#fff" }}>
              应用遇到了问题
            </h1>
            <p style={{ fontSize: 14, color: "#a1a1aa", marginBottom: 24, lineHeight: 1.6 }}>
              渲染进程发生了未捕获的错误。你可以尝试重试，或重启应用。
            </p>
            <div style={{
              padding: "12px 16px",
              marginBottom: 24,
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: 8,
              textAlign: "left",
              fontSize: 12,
              fontFamily: "monospace",
              color: "#fca5a5",
              maxHeight: 200,
              overflow: "auto",
            }}>
              {this.state.error?.message ?? "Unknown error"}
              {this.state.errorInfo && (
                <pre style={{ marginTop: 8, fontSize: 11, color: "#71717a", whiteSpace: "pre-wrap" }}>
                  {this.state.errorInfo}
                </pre>
              )}
            </div>
            <button
              onClick={this.handleRetry}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "1px solid rgba(103, 232, 249, 0.3)",
                background: "rgba(103, 232, 249, 0.1)",
                color: "#67e8f9",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
