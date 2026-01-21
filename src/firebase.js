import { initializeApp } from "firebase/app";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
 apiKey: "AIzaSyCqfOerP5AQ-3KmxGV3cePF8K3KgT-IzeA",
  authDomain: "testluces.firebaseapp.com",
  projectId: "testluces",
  storageBucket: "testluces.firebasestorage.app",
  messagingSenderId: "793810866161",
  appId: "1:793810866161:web:0dd796f22335d49ba4be50",
  measurementId: "G-FQ85L4SCR1"
};

const app = initializeApp(firebaseConfig);

// ✅ Auth persistente en React Native
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);
