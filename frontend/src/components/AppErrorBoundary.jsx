import React from 'react';

// Catches any unhandled render errors and shows a readable error screen instead of a blank page.
// Has to be a class component — React doesn't support error boundaries as function components.
export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  // React calls this when something below throws during render.
  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unknown application error',
    };
  }

  // Log the full error to the console for debugging.
  componentDidCatch(error, errorInfo) {
    console.error('Application render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white border border-red-200 rounded-lg p-6 space-y-3">
            <h1 className="text-xl font-bold text-gray-900">App failed to load</h1>
            <p className="text-sm text-gray-700">A runtime error occurred while rendering.</p>
            <pre className="text-xs bg-red-50 border border-red-100 text-red-800 p-3 rounded overflow-auto whitespace-pre-wrap">
              {this.state.errorMessage}
            </pre>
            <p className="text-xs text-gray-500">Open browser devtools console for full stack trace.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}