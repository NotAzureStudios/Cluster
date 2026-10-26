import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { ApiError } from "../core/api";
import { reportClientIncident } from "../core/client-incidents";
import { LoadingState } from "./LoadingState";
import { RequestErrorState } from "./RequestState";

type BoundaryProps = { children: ReactNode; label: string };
type BoundaryState = { error: Error | null; retryKey: number; occurredAt: string | null };

class FeatureErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, retryKey: 0, occurredAt: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error, occurredAt: new Date().toISOString() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Cluster] ${this.props.label} failed to render`, error, info.componentStack);
    reportClientIncident({ kind: "client.feature_render_error", message: `${this.props.label}: ${error.message}\n${info.componentStack || ""}` });
  }

  retry = () => this.setState((current) => ({ error: null, retryKey: current.retryKey + 1, occurredAt: null }));

  render() {
    if (this.state.error) {
      const recoveryError = new ApiError(
        "This workspace module could not render, but the rest of Cluster remains available.",
        0,
        undefined,
        null,
        "CLIENT_FEATURE_RENDER_ERROR",
        { operation: `RENDER ${this.props.label}`.slice(0, 200), occurredAt: this.state.occurredAt },
      );
      return (
        <section className="panel feature-error-v205" role="alert">
          <div>
            <p className="eyebrow">Workspace recovery</p>
            <RequestErrorState
              error={recoveryError}
              title={`${this.props.label} could not open`}
              onRetry={this.retry}
              retryLabel="Retry workspace"
              onReload={() => window.location.reload()}
              reloadLabel="Reload Cluster"
            />
          </div>
        </section>
      );
    }
    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}

export function LazyFeatureBoundary({ children, label }: BoundaryProps) {
  return (
    <FeatureErrorBoundary label={label}>
      <Suspense fallback={<LoadingState label={`Loading ${label.toLowerCase()}`} rows={6} className="lazy-page-loading-v200" />}>
        {children}
      </Suspense>
    </FeatureErrorBoundary>
  );
}
