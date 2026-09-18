import { useState } from 'react';
import { supabase } from './supabaseClient';

function Auth() {
  const [isSignUp, setIsSignUp] = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');

    if (isForgot) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        setMessage(error.message);
      } else {
        // Same message whether or not the email has an account, so this form
        // can't be used to find out who is signed up.
        setMessage('If an account exists for that email, a reset link is on its way.');
      }
      return;
    }

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName } },
      });
      if (error) {
        setMessage(error.message);
      } else {
        setMessage('Check your email to confirm your account!');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
          {isForgot ? 'Reset your password' : isSignUp ? 'Create an account' : 'Log in'}
        </h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignUp && (
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
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition"
          >
            {isForgot ? 'Send Reset Link' : isSignUp ? 'Sign Up' : 'Log In'}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-center text-sm text-gray-600">{message}</p>
        )}

        {!isSignUp && !isForgot && (
          <button
            onClick={() => {
              setIsForgot(true);
              setMessage('');
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
            setMessage('');
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