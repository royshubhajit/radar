import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  isFirebaseConfigured,
  subscribeToAuth,
  loginWithGoogle,
  logout
} from '../services/authService';
import {
  Flame,
  ShieldAlert,
  Lock,
  LogOut,
  RefreshCw,
  AlertTriangle,
  KeyRound
} from 'lucide-react';

interface AuthGateProps {
  children: React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((currentUser, authorized, loading) => {
      setUser(currentUser);
      setIsAuthorized(authorized);
      setIsLoading(loading);
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    const result = await loginWithGoogle();
    setIsSigningIn(false);
    if (!result.success && result.error && result.error !== 'Sign-in cancelled') {
      setAuthError(result.error);
    }
  };

  const handleSwitchAccount = async () => {
    await logout();
    await handleSignIn();
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[#07090e] flex flex-col items-center justify-center select-none text-slate-100 p-4">
        <div className="relative flex items-center justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center animate-pulse">
            <Flame className="w-8 h-8 text-rose-500" />
          </div>
          <div className="absolute inset-0 rounded-2xl border border-rose-500/20 animate-ping" />
        </div>
        <div className="flex items-center gap-2 text-sm font-mono text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin text-rose-500" />
          <span>Verifying access permissions...</span>
        </div>
      </div>
    );
  }

  // 2. Setup Required: Firebase credentials missing in .env
  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen w-full bg-[#07090e] flex items-center justify-center p-4 select-none text-slate-100">
        <div className="max-w-md w-full bg-[#10141d] border border-[#1e2638] rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/80">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-5 text-amber-400">
            <KeyRound className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold font-mono text-white mb-2 flex items-center gap-2">
            <span>Firebase Configuration Required</span>
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed mb-5">
            Email authentication is enabled, but your Firebase API keys have not been added to your local <code className="text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded">.env</code> file yet.
          </p>

          <div className="bg-[#090b10] border border-[#1a2130] rounded-xl p-4 mb-6 font-mono text-[11px] text-slate-300 space-y-2">
            <div className="text-slate-500 pb-1 border-b border-slate-800 font-semibold">Required in .env:</div>
            <div><span className="text-rose-400">VITE_FIREBASE_API_KEY</span>=AIzaSy...</div>
            <div><span className="text-rose-400">VITE_FIREBASE_AUTH_DOMAIN</span>=your-id.firebaseapp.com</div>
            <div><span className="text-rose-400">VITE_FIREBASE_PROJECT_ID</span>=your-id</div>
            <div><span className="text-rose-400">VITE_FIREBASE_APP_ID</span>=1:...</div>
            <div><span className="text-amber-400">VITE_ALLOWED_EMAILS</span>=you@gmail.com</div>
          </div>

          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Copy credentials from your Firebase Project Settings into .env and restart Vite.</span>
          </div>
        </div>
      </div>
    );
  }

  // 3. Unauthorized State: Logged in with an unapproved email
  if (user && !isAuthorized) {
    return (
      <div className="min-h-screen w-full bg-[#07090e] flex items-center justify-center p-4 select-none text-slate-100">
        <div className="max-w-md w-full bg-[#10141d] border border-rose-900/40 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-rose-950/20 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-5 text-rose-400 shadow-lg shadow-rose-950/40">
            <ShieldAlert className="w-7 h-7 animate-bounce" />
          </div>

          <h2 className="text-xl font-extrabold font-mono text-white mb-2">
            Access Restricted
          </h2>
          <p className="text-xs text-slate-400 mb-6">
            This crypto monitor terminal is private. Your email is not on the authorized whitelist.
          </p>

          <div className="bg-[#090b10] border border-rose-500/20 rounded-xl p-3 mb-6 flex items-center justify-center gap-2">
            <span className="text-xs font-mono text-slate-400">Signed in as:</span>
            <span className="text-xs font-mono font-bold text-rose-400 truncate max-w-[200px]">
              {user.email}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={handleSwitchAccount}
              disabled={isSigningIn}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold transition-all shadow-lg shadow-blue-600/25 active:scale-95"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSigningIn ? 'animate-spin' : ''}`} />
              <span>Switch Account</span>
            </button>

            <button
              onClick={() => logout()}
              className="px-4 py-2.5 rounded-xl bg-[#161c28] hover:bg-[#1f2738] border border-[#2b374e] text-slate-300 hover:text-white text-xs font-mono font-semibold transition-all flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Unauthenticated State: Clean Login Screen
  if (!user) {
    return (
      <div className="min-h-screen w-full bg-[#07090e] relative flex items-center justify-center p-4 select-none text-slate-100 overflow-hidden">
        {/* Subtle background radial glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-sm w-full bg-[#10141d]/90 backdrop-blur-xl border border-[#1e2638] rounded-2xl p-7 sm:p-9 shadow-2xl shadow-black/90 text-center">
          {/* Logo Badge */}
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500/20 to-red-600/30 border border-rose-500/40 flex items-center justify-center mb-5 shadow-lg shadow-rose-950/50">
            <Flame className="w-7 h-7 text-rose-500 animate-pulse" />
          </div>

          <div className="flex items-center justify-center gap-2 mb-1.5">
            <h1 className="text-xl font-extrabold tracking-tight text-white font-mono">
              DROP<span className="text-rose-500">RADAR</span>
            </h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 font-mono font-semibold">
              PRO
            </span>
          </div>

          <p className="text-xs text-slate-400 mb-7 leading-relaxed">
            Live 1m Candlestick &amp; Closed Candle Red Drop Scanner for Top 100 Cryptocurrencies
          </p>

          {/* Security lock indicator */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/60 border border-slate-700/50 text-[11px] font-mono text-slate-300 mb-6">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>Private Whitelist Access Only</span>
          </div>

          {authError && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono flex items-center gap-2 text-left">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* Google Sign-in Button */}
          <button
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-medium text-sm transition-all shadow-xl shadow-white/5 active:scale-[0.98] disabled:opacity-75 disabled:cursor-wait"
          >
            {isSigningIn ? (
              <RefreshCw className="w-4 h-4 animate-spin text-slate-700" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
            )}
            <span className="font-semibold tracking-wide">
              {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
            </span>
          </button>

          <p className="text-[10px] text-slate-500 mt-5 font-mono">
            Protected by Google Identity &amp; Whitelist Gate
          </p>
        </div>
      </div>
    );
  }

  // 5. Authorized State: Render dashboard
  return <>{children}</>;
};
