import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Top-level React error boundary. A crash in any component (e.g. from
 * malformed file metadata) would otherwise white-screen the whole app
 * with no recovery path (review issue #17).
 *
 * Renders a tactical-styled fallback consistent with the NERV theme so
 * the user sees an actionable message instead of a blank window.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to the devtools console; a real app would ship this to telemetry.
    console.error("Unhandled renderer error", error, info.componentStack);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, message: "" });
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-nerv-bg text-nerv-text font-mono p-8">
        <div className="max-w-md w-full border border-nerv-orange/50 bg-nerv-panel p-6">
          <h1 className="font-display text-sm uppercase tracking-widest text-nerv-orange font-bold mb-3">
            ⚠ SYSTEM FAULT
          </h1>
          <p className="text-xs text-nerv-amber mb-2">
            An unexpected error occurred in the renderer.
          </p>
          <pre className="text-[10px] text-nerv-muted bg-nerv-bg border border-nerv-border p-2 mb-4 overflow-auto max-h-32 whitespace-pre-wrap break-all">
            {this.state.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            className="px-4 py-1.5 bg-nerv-orange hover:bg-nerv-amber text-nerv-bg font-mono font-bold text-xs uppercase cursor-pointer transition-colors"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }
}


export default ErrorBoundary;
