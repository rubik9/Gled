import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import PadScreen from "./src/screens/PadScreen";
import Paywall from "./src/screens/Paywall";
import { auth, db } from "./src/firebase";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";

function toMsFromFirestoreTimestamp(ts) {
  // Firestore Timestamp tiene .toMillis() y .toDate()
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  // por si alguien guarda epoch ms como número
  if (typeof ts === "number") return ts;
  return null;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [allowed, setAllowed] = useState(false); // active && notExpired
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const stopUserSnapRef = useRef(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      // cerrar listener anterior
      if (stopUserSnapRef.current) {
        stopUserSnapRef.current();
        stopUserSnapRef.current = null;
      }

      setUser(u);

      if (!u) {
        setAllowed(false);
        setLoading(false);
        return;
      }

      setLoading(true);

      // crear/actualizar perfil básico (SIN active/expiresAt)
      try {
        await setDoc(
          doc(db, "users", u.uid),
          {
            email: u.email ?? null,
            displayName: u.displayName ?? null,
            createdAt: serverTimestamp(),
            lastSeen: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.log("setDoc users error:", e?.code, e?.message);
      }

      // snapshot a users/{uid}
      stopUserSnapRef.current = onSnapshot(
        doc(db, "users", u.uid),
        (snap) => {
          const d = snap.data() || {};

          const isActive = d.active === true;

          const expiresMs = toMsFromFirestoreTimestamp(d.expiresAt);
          const isExpired = typeof expiresMs === "number" && expiresMs <= Date.now();

          setAllowed(isActive && !isExpired);
          setLoading(false);
        },
        (err) => {
          console.log("user snapshot error:", err?.code, err?.message);
          setAllowed(false);
          setLoading(false);
        }
      );
    });

    return () => {
      if (stopUserSnapRef.current) {
        stopUserSnapRef.current();
        stopUserSnapRef.current = null;
      }
      unsubAuth();
    };
  }, []);

  async function doLogin() {
    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), password.trim());
    } catch (e) {
      Alert.alert("Login", String(e?.message || e));
      setLoading(false);
    }
  }

  async function doLogout() {
    try {
      if (stopUserSnapRef.current) {
        stopUserSnapRef.current();
        stopUserSnapRef.current = null;
      }
      await signOut(auth);
    } catch (e) {
      Alert.alert("Logout", String(e?.message || e));
    }
  }

  return (
    <SafeAreaProvider>
      {loading ? (
        <SafeAreaView style={S.center}>
          <ActivityIndicator />
          <Text style={S.muted}>Cargando...</Text>
        </SafeAreaView>
      ) : !user ? (
        <SafeAreaView style={S.container}>
          <Text style={S.title}>Iniciar sesión</Text>

          <TextInput
            style={S.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <TextInput
            style={S.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Contraseña"
            placeholderTextColor="#64748b"
            secureTextEntry
          />

          <Pressable style={S.btn} onPress={doLogin}>
            <Text style={S.btnTxt}>Entrar</Text>
          </Pressable>

          <Text style={S.hint}>
            Si tu acceso está inactivo o vencido, verás la pantalla de solicitud.
          </Text>
        </SafeAreaView>
      ) : !allowed ? (
        <Paywall user={user} onLogout={doLogout} />
      ) : (
        <PadScreen user={user} onLogout={doLogout} />
      )}
    </SafeAreaProvider>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0f14",
    padding: 16,
    justifyContent: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0b0f14",
  },
  title: {
    color: "#e5ecff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
  },
  muted: {
    color: "#cbd5e1",
    marginTop: 8,
  },
  hint: {
    color: "#94a3b8",
    marginTop: 12,
    lineHeight: 18,
  },
  input: {
    backgroundColor: "#0f1522",
    color: "#e5ecff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderColor: "#1f2937",
    borderWidth: 1,
    marginBottom: 10,
  },
  btn: {
    backgroundColor: "#00bb88",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnTxt: {
    color: "#071c12",
    fontSize: 16,
    fontWeight: "800",
  },
});
