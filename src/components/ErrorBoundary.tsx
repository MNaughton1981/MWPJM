import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Top-level error boundary.
 *
 * Without this, any uncaught throw inside a render or effect crashes
 * the whole React tree and the page goes white — which on a phone
 * looks identical to the OS killing the tab. The user has no
 * indication of what happened, no way to recover other than full app
 * reload, and (since Workboard is a PWA) often loses unsaved typing
 * if the reload reaches the service worker.
 *
 * With this, an uncaught throw renders a recoverable error card with
 * the message, the stack (collapsed), and a Reload button that just
 * triggers a router-level remount via window.location.reload().
 *
 * Sticky drafts (introduced in PR #23) persist through the reload via
 * the zustand store + localStorage, so the user's typed-but-unsent
 * note survives even a hard error.
 *
 * NOTE: Error boundaries only catch errors during render, lifecycle,
 * and constructors — NOT in event handlers, async callbacks, or
 * setTimeout. Those still need their own try/catch (see
 * UpdateComposer.tsx#sendWithPhotos for the pattern). The boundary is
 * the safety net for the cases we forget to wrap.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console so it's visible in remote debugging.
    // Don't try to telemetry — Workboard has no backend.
    // eslint-disable-next-line no-console
    console.error('Uncaught render error:', error, info);
  }

  reset = (): void => {
    // Hard reload is the most reliable recovery on a PWA: it clears
    // any half-rendered state, re-runs effects, and gives any pending
    // service-worker update a chance to apply.
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    const err = this.state.error;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full card p-5 space-y-3">
          <div className="text-2xl">⚠️</div>
          <h1 className="text-lg font-semibold text-slate-900">
            Something broke
          </h1>
          <p className="text-sm text-slate-700">
            Workboard hit an error it couldn't recover from. Your typed
            drafts and photos are safe — they're stored locally and will
            still be there after a reload.
          </p>
          <details className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
            <summary className="cursor-pointer font-medium">
              Error details
            </summary>
            <div className="mt-2 space-y-1">
              <div className="font-mono text-rose-700 break-all">
                {err.name}: {err.message}
              </div>
              {err.stack && (
                <pre className="whitespace-pre-wrap font-mono text-[10px] text-slate-500 max-h-40 overflow-auto">
                  {err.stack}
                </pre>
              )}
            </div>
          </details>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-primary text-sm flex-1"
              onClick={this.reset}
            >
              Reload Workboard
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            If this keeps happening on the same screen, screenshot the
            error details above so it can be diagnosed.
          </p>
        </div>
      </div>
    );
  }
}
