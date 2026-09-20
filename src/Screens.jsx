// Small full-page building blocks shared by several screens.

export function Centered({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full text-center text-gray-700">{children}</div>
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
        <button
          onClick={onLogout}
          className="mt-3 w-full bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
        >
          Log Out
        </button>
      </div>
    </Centered>
  );
}
