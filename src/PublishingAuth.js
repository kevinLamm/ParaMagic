// Firebase manages passwords, verification emails and resets. Tokens never enter drawing files.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, updateProfile, reload, signOut } from 'firebase/auth';

export function accountError(error) {
  const messages = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'An account already uses this email. Sign in or reset your password.',
    'auth/weak-password': 'Choose a stronger password with at least 15 characters.',
    'auth/password-does-not-meet-requirements': 'Choose a password with at least 15 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
    'auth/popup-blocked': 'Allow pop-up windows for ParaMagic, then try again.',
    'auth/account-exists-with-different-credential': 'Use the sign-in method you used when creating this account.',
    'auth/network-request-failed': 'Could not reach the account service. Check your connection and try again.',
    'auth/user-disabled': 'This account is disabled.',
    'auth/user-token-expired': 'Please sign in again.',
    'auth/unauthorized-domain': 'Sign-in is not configured for this site address yet.',
    'auth/operation-not-allowed': 'This sign-in option is not enabled yet.',
  };
  return new Error(messages[error?.code] || (error?.code ? 'The account service could not complete this action. Please try again.' : error.message));
}
export async function createPublishingAuth(config, { origin = window.location.origin } = {}) {
  const app = getApps().find(item => item.name === 'paramagic-accounts') || initializeApp(config, 'paramagic-accounts');
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  const actionSettings = { url: `${origin}/`, handleCodeInApp: false };
  let lastVerification = 0;
  async function sendVerification() {
    if (!auth.currentUser) throw new Error('Sign in first.');
    if (Date.now() - lastVerification < 60000) throw new Error('Please wait a minute before requesting another verification email.');
    await sendEmailVerification(auth.currentUser, actionSettings); lastVerification = Date.now();
  }
  return {
    currentUser: () => auth.currentUser,
    token: () => auth.currentUser?.getIdToken(),
    async google() { await signInWithPopup(auth, new GoogleAuthProvider()); },
    async email(email, password) { await signInWithEmailAndPassword(auth, email.trim(), password); },
    async register({ email, password, name }) {
      if ([...password].length < 15 || password.length > 128) throw new Error('Use a password between 15 and 128 characters.');
      const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) await updateProfile(result.user, { displayName: name.trim().slice(0, 100) });
      await sendVerification();
    },
    resend: sendVerification,
    async verify() {
      if (!auth.currentUser) throw new Error('Sign in first.');
      await reload(auth.currentUser);
      if (!auth.currentUser.emailVerified) throw new Error('Open the verification link in your email first, then try again.');
      await auth.currentUser.getIdToken(true);
    },
    async reset(email) {
      try { await sendPasswordResetEmail(auth, email.trim(), actionSettings); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    },
    signOut: () => signOut(auth),
  };
}
