import { useState } from 'react';
import { supabase } from './supabaseClient';

// Turn Supabase's raw error strings into something a guest can act on.
function friendlyError(message) {
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (/invalid login credentials/i.test(message)) {
    return 'Incorrect email or password.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Please confirm your email first — check your inbox for the link.';
  }
  return message;
}

function Auth() {
  const [isSignUp, setIsSignUp] = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null); // { text, isError }
  const [busy, setBusy] = useState(false);

  function showError(error) {
    setMessage({ text: friendlyError(error.message), isError: true });
  }

  async function handleGoogle() {
    setMessage(null);
    // Leaves the site for Google, then returns to this address signed in. The
    // return address must be on Supabase's Redirect URLs allowlist.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) showError(error);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);

    if (isForgot) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        showError(error);
      } else {
        // Same message whether or not the email has an account, so this form
        // can't be used to find out who is signed up.
        setMessage({
          text: 'If an account exists for that email, a reset link is on its way.',
          isError: false,
        });
      }
    } else if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName } },
      });
      if (error) {
        showError(error);
      } else {
        setMessage({ text: 'Check your email to confirm your account!', isError: false });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) showError(error);
    }

    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
          {isForgot ? 'Reset your password' : isSignUp ? 'Create an account' : 'Log in'}
        </h1>
        {!isForgot && (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              className="w-full flex items-center justify-center gap-3 border border-gray-300 text-gray-800 font-semibold py-3 rounded-xl hover:bg-gray-50 transition"
            >
              <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              Continue with Google
            </button>
            <div className="flex items-center gap-3 my-4 text-xs text-gray-400">
              <span className="flex-1 border-t border-gray-200" />
              or use your email
              <span className="flex-1 border-t border-gray-200" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignUp && !isForgot && (
            <>
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </>
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {!isForgot && (
            <input
              type="password"
              placeholder={isSignUp ? 'Password (at least 6 characters)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isSignUp ? 6 : undefined}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
          >
            {busy
              ? 'Please wait...'
              : isForgot
                ? 'Send Reset Link'
                : isSignUp
                  ? 'Sign Up'
                  : 'Log In'}
          </button>
        </form>

        {message && (
          <p
            className={`mt-4 text-center text-sm ${
              message.isError ? 'text-red-600' : 'text-green-700'
            }`}
          >
            {message.text}
          </p>
        )}

        {!isSignUp && !isForgot && (
          <button
            onClick={() => {
              setIsForgot(true);
              setMessage(null);
            }}
            className="mt-4 text-sm text-gray-500 hover:underline w-full text-center"
          >
            Forgot password?
          </button>
        )}

        <button
          onClick={() => {
            if (isForgot) {
              setIsForgot(false);
            } else {
              setIsSignUp(!isSignUp);
            }
            setMessage(null);
          }}
          className="mt-4 text-sm text-blue-600 hover:underline w-full text-center"
        >
          {isForgot
            ? 'Back to log in'
            : isSignUp
              ? 'Already have an account? Log in'
              : "Don't have an account? Sign up"}
        </button>

        <p className="mt-6 text-center text-xs text-gray-400">
          By continuing you agree to our{' '}
          <a href="/terms.html" className="underline hover:text-gray-600">
            Terms
          </a>{' '}
          and{' '}
          <a href="/privacy.html" className="underline hover:text-gray-600">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export default Auth;
