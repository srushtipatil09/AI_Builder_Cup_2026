import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from "firebase/auth";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
});

const auth = getAuth(app);

export type GoogleUser = { email: string; name: string; uid: string };

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
