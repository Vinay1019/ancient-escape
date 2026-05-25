import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
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

console.log("Firebase API key from env:", import.meta.env.VITE_FIREBASE_API_KEY);
console.log("Admin email from env:", import.meta.env.VITE_ADMIN_EMAIL);

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

export async function createOnlineRoom(roomData) {
  try {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(db, "ancient_escape_rooms", roomCode);

    await setDoc(roomRef, {
      roomCode,
      status: "waiting",
      hostJoined: true,
      guestJoined: false,
      currentTurn: "host",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...roomData,
    });

    return roomCode;
  } catch (error) {
    console.error("Create online room failed:", error);
    throw error;
  }
}

export async function joinOnlineRoom(roomCode, guestData) {
  try {
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const roomRef = doc(db, "ancient_escape_rooms", cleanRoomCode);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists()) {
      throw new Error("Room not found");
    }

    const roomData = roomSnap.data();

    if (roomData.guestJoined) {
      throw new Error("Room already has two players");
    }

    const hostRole = roomData.host?.gameRole || "participant";
    const guestRole = guestData.gameRole || (hostRole === "participant" ? "guardian" : "participant");

    if (guestRole === hostRole) {
      throw new Error(`The ${guestRole} role is already taken. Choose the other role.`);
    }

    await updateDoc(roomRef, {
      guestJoined: true,
      guest: {
        ...guestData,
        gameRole: guestRole,
      },
      status: "ready",
      updatedAt: serverTimestamp(),
    });

    return cleanRoomCode;
  } catch (error) {
    console.error("Join online room failed:", error);
    throw error;
  }
}

export function listenOnlineRoom(roomCode, callback) {
  const cleanRoomCode = roomCode.trim().toUpperCase();
  const roomRef = doc(db, "ancient_escape_rooms", cleanRoomCode);

  return onSnapshot(
    roomRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data());
      }
    },
    (error) => {
      console.error("Listen online room failed:", error);
    }
  );
}

export async function updateOnlineRoom(roomCode, updates) {
  try {
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const roomRef = doc(db, "ancient_escape_rooms", cleanRoomCode);

    await updateDoc(roomRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });

    return true;
  } catch (error) {
    console.error("Update online room failed:", error);
    return false;
  }
}