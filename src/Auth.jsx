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
      </div>
    </div>
  );
}

export default Auth;
