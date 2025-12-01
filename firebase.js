// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCbSu-l8g5pjK6hbmHvWX5DM7mFILrDdBQ",
  authDomain: "primer-latino.firebaseapp.com",
  projectId: "primer-latino",
  storageBucket: "primer-latino.firebasestorage.app",
  messagingSenderId: "2296587777930",
  appId: "1:296587777930:web:44467ab54eb20b1a959a73"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { collection, addDoc, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp };