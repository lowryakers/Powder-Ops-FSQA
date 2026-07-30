import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Catches a failure inside the module pane so it can't blank the whole app.
 *
 * Modules load as separate bundles, which introduces a failure the single-file
 * build didn't have: a deploy replaces the hashed chunk files, and a phone that
 * has had the page open since before the deploy asks for a chunk that no longer
 * exists. The import rejects, React unmounts the tree, and the operator gets a
 * white screen mid-shift. That case is a reload away from fixed, so say so and
 * offer the button — but reload only on the user's press. Auto-reloading would
 * throw away whatever they had half-typed in a form.
 *
 * Resets on `resetKey` (the active tab), so navigating away from a broken
 * module gives you a working app again without a reload.
 */
export default class ModuleBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error, info) {
    console.error('[module] render failed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // A failed dynamic import is nearly always "this build moved on".
    const stale = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i
      .test(String(error?.message || ''));

    return (
      <div className="py-16 px-6 text-center">
        <AlertTriangle size={30} className="mx-auto text-amber-500" />
        <p className="mt-3 font-semibold text-gray-900">
          {stale ? 'ReadyDoc was updated' : "This screen didn't load"}
        </p>
        <p className="mt-1 text-sm text-gray-500 max-w-sm mx-auto">
          {stale
            ? 'A new version was released while this page was open. Reload to pick it up — nothing you have already saved is affected.'
            : 'Something went wrong opening this module. Reload, or pick another module from the menu.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700"
        >
          <RefreshCw size={14} /> Reload
        </button>
        {!stale && (
          <p className="mt-3 text-[11px] text-gray-400 break-words max-w-md mx-auto">{String(error?.message || error)}</p>
        )}
      </div>
    );
  }
}
