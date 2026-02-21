import { Component, type ReactNode } from "react";
import { useErrorLogStore } from "../stores/errorLogStore";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    useErrorLogStore
      .getState()
      .addError("ERROR", `React render error: ${error.message}`);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-red-400">Something went wrong</p>
            <pre className="max-w-full overflow-auto rounded bg-zinc-800 p-3 text-xs text-zinc-400">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-600"
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
