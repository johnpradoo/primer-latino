// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbM--YzDZ6J2GRZKXGJD88eyKJTKuBRhc",
  authDomain: "primerlatino-admin.firebaseapp.com",
  projectId: "primerlatino-admin",
  storageBucket: "primerlatino-admin.firebasestorage.app",
  messagingSenderId: "26166116734",
  appId: "1:26166116734:web:b9634bc650c41703f0732f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { collection, addDoc, onSnapshot, orderBy, query, updateDoc, doc, serverTimestamp };