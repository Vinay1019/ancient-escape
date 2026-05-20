import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;

export async function saveMoveToFirebase(moveData) {
  try {
    await addDoc(collection(db, "ancient_escape_moves"), {
      ...moveData,
      createdAt: serverTimestamp(),
    });

    return true;
  } catch (error) {
    console.error("Firebase save failed:", error);
    return false;
  }
}

export async function signInAdmin() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutAdmin() {
  await signOut(auth);
}

export function listenToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function isAdminUser(user) {
  return user?.email === ADMIN_EMAIL;
}

export async function getAllMoveRecords() {
  const q = query(collection(db, "ancient_escape_moves"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}