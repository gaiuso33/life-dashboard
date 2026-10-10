import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { rawSaved, readBackup, restoreBackup } from '../repository';
import { downloadText } from '../sync';
import { todayKey } from '../utils';

interface Props {
  children: ReactNode;
  /** Inside the app: only the current screen is replaced, so the navigation still works. */
  inline?: boolean;
}

/**
 * Catches a crash while drawing a screen so the person sees a plain explanation and a way to keep their data
 * instead of a blank page. It reads the saved text directly, so it works even if the app's own state is broken.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Life Dashboard crashed:', error, info.componentStack);
  }

  download = () => {
    const raw = rawSaved();
    if (raw) downloadText(`life-dashboard-recovered-${todayKey()}.json`, raw);
    else window.alert('There is no saved data on this device to download.');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const backup = readBackup();
    return (
      <div className={this.props.inline ? 'page' : 'welcome'}>
        <div className="panel crash" role="alert">
          <h1>{this.props.inline ? 'This screen hit a problem' : 'Something went wrong'}</h1>
          <p className="note first">Your data is still saved on this device. You can download a copy now, then try again.</p>
          <div className="row-action">
            <button className="btn primary" onClick={this.download}>
              Download my data
            </button>
            {this.props.inline ? (
              <button className="btn" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
            ) : (
              <button className="btn" onClick={() => window.location.reload()}>
                Reload
              </button>
            )}
            {backup && (
              <button
                className="btn"
                onClick={() => {
                  if (window.confirm('Go back to the last automatic backup? Changes made since then are lost. Download your data first if you might want them.') && restoreBackup()) window.location.reload();
                }}
              >
                Restore the last backup
              </button>
            )}
          </div>
          <details className="preview">
            <summary>Technical details</summary>
            <pre>{String(error.stack ?? error.message).slice(0, 1500)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
