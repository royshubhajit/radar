import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
  Auth
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || ''
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
const googleProvider = new GoogleAuthProvider();

// Configure Google Auth provider options
googleProvider.setCustomParameters({
  prompt: 'select_account' // Always prompt account selection
});

if (isFirebaseConfigured) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (err) {
    console.error('Failed to initialize Firebase Auth:', err);
  }
}

/**
 * Returns the parsed list of allowed email addresses from environment variables.
 */
export function getAllowedEmails(): string[] {
  const raw = import.meta.env.VITE_ALLOWED_EMAILS || '';
  return raw
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Checks if a given email is present in the allowed whitelist.
 */
export function isEmailAuthorized(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = getAllowedEmails();
  if (allowed.length === 0) {
    // If no whitelist is configured, reject to stay secure
    return false;
  }
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Signs in using Google Popup.
 */
export async function loginWithGoogle(): Promise<{ success: boolean; user?: User; error?: string }> {
  if (!auth) {
    return {
      success: false,
      error: 'Firebase is not configured. Please add your credentials to the .env file.'
    };
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    return { success: true, user: result.user };
  } catch (err: any) {
    // Suppress benign user-cancelled popup errors
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      return { success: false, error: 'Sign-in cancelled' };
    }
    console.error('Google Sign-In error:', err);
    return {
      success: false,
      error: err.message || 'Failed to sign in with Google'
    };
  }
}

/**
 * Signs out the currently authenticated user.
 */
export async function logout(): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Sign-out error:', err);
  }
}

/**
 * Subscribes to Firebase Auth state changes.
 */
export function subscribeToAuth(
  callback: (user: User | null, isAuthorized: boolean, isLoading: boolean) => void
): () => void {
  if (!auth) {
    // If Firebase is not configured, inform callback immediately
    callback(null, false, false);
    return () => {};
  }

  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      callback(null, false, false);
    } else {
      const authorized = isEmailAuthorized(user.email);
      callback(user, authorized, false);
    }
  });
}

/**
 * Returns current user synchronously if available.
 */
export function getCurrentUser(): User | null {
  return auth?.currentUser || null;
}
