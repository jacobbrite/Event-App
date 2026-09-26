// Small full-page building blocks shared by several screens.

export function Centered({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full text-center text-gray-700">{children}</div>
    </div>
  );
}

// Top row of every inner page: a clear, prominent way back on the left, and a
// small, quiet Log out on the right (so it's never hit by accident).
export function PageHeader({ backLabel, onBack, onLogout }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 font-semibold text-sm px-4 py-2 rounded-lg hover:bg-blue-100 transition"
      >
        <span aria-hidden="true">←</span> {backLabel}
      </button>
      {onLogout && (
        <button onClick={onLogout} className="text-xs text-gray-400 hover:text-gray-600">
          Log out
        </button>
      )}
    </div>
  );
}

export function ErrorScreen({ title, detail, onRetry, onLogout }) {
  return (
    <Centered>
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-500 mb-6">{detail}</p>
        <button
          onClick={onRetry}
          className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
        >
          Try again
        </button>
        <button onClick={onLogout} className="mt-4 text-xs text-gray-400 hover:text-gray-600">
          Log out
        </button>
      </div>
    </Centered>
  );
}
