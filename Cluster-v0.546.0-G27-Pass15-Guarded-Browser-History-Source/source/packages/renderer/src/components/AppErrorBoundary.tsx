import { Component, type ErrorInfo, type ReactNode } from "react";
import { ApiError } from "../core/api";
import { reportClientIncident } from "../core/client-incidents";
import { RequestErrorState } from "./RequestState";

type Props = { children: ReactNode };
type State = { error: Error | null; occurredAt: string | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, occurredAt: null };

  static getDerivedStateFromError(error: Error): State { return { error, occurredAt: new Date().toISOString() }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Cluster UI error", error, info.componentStack);
    reportClientIncident({ kind: "client.app_render_error", message: `${error.message}\n${info.componentStack || ""}` });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const recoveryError = new ApiError(
      "The Cluster interface could not render the current application state.",
      0,
      undefined,
      null,
      "CLIENT_RENDER_ERROR",
      { operation: "RENDER application", occurredAt: this.state.occurredAt },
    );
    return <main className="fatal-error-shell-v200">
      <section className="fatal-error-card-v200">
        <p className="eyebrow">Workspace recovery</p>
        <h1>Cluster hit a rendering error</h1>
        <RequestErrorState
          error={recoveryError}
          title="Cluster could not render this application state"
          onRetry={() => this.setState({ error: null, occurredAt: null })}
          retryLabel="Try again"
          onReload={() => window.location.reload()}
          reloadLabel="Reload Cluster"
        />
      </section>
    </main>;
  }
}
