import { useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";

export const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
});

const auth = getAuth(firebaseApp);

export type GoogleUser = { email: string; name: string; uid: string };

// The signed-in person's picture: the Google account photo when they used Google sign-in, otherwise null.
export function useAccountPhoto(): string | null {
  const [photo, setPhoto] = useState<string | null>(() => auth.currentUser?.photoURL ?? null);
  useEffect(() => onAuthStateChanged(auth, (user) => setPhoto(user?.photoURL ?? null)), []);
  return photo;
}

export async function signInWithGoogle(): Promise<GoogleUser> {
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  const user = result.user;
  return { email: user.email ?? "", name: user.displayName ?? "", uid: user.uid };
}

export async function firebaseSignOut(): Promise<void> {
  await signOut(auth);
}

// The current Firebase ID token, or null when nobody is signed in with Firebase.
export async function currentIdToken(): Promise<string | null> {
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

export async function signUpWithEmail(email: string, password: string): Promise<GoogleUser> {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  return { email: user.email ?? email, name: user.displayName ?? "", uid: user.uid };
}

export async function signInWithEmail(email: string, password: string): Promise<GoogleUser> {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return { email: user.email ?? email, name: user.displayName ?? "", uid: user.uid };
}

// A short, plain message for a Firebase Auth error.
export function authMessage(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password do not match an account.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Log in instead.";
    case "auth/weak-password":
      return "Use at least 8 characters.";
    case "auth/too-many-requests":
      return "Too many tries. Wait a minute and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was closed before it finished.";
    case "auth/unauthorized-domain":
      return "This domain (saathi-511717.web.app) is not authorized in Firebase. Add it in Firebase Console > Authentication > Settings > Authorized domains.";
    case "auth/network-request-failed":
      return "No connection. Check the network and try again.";
    default:
      return "Sign-in did not finish. Try again.";
  }
}
