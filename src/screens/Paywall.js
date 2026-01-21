import React, { useState } from "react";
import { View, Text, Pressable, TextInput, Alert, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export default function Paywall({ user, onLogout }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function requestAccess() {
    try {
      setSending(true);
      await addDoc(collection(db, "payments"), {
        uid: user.uid,
        email: user.email ?? null,
        createdAt: serverTimestamp(),
        status: "pending",
        note: note.trim(),
      });
      Alert.alert(
        "Solicitud enviada",
        "Tu solicitud fue enviada. Cuando tu cuenta sea activada, la app se abrirá automáticamente."
      );
      setNote("");
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={S.container}>
      <Text style={S.title}>Cuenta no activa</Text>

      <Text style={S.text}>
        Tu cuenta aún no está habilitada para usar la aplicación.
        Solicita acceso al administrador.
      </Text>

      <TextInput
        style={S.input}
        value={note}
        onChangeText={setNote}
        placeholder="Mensaje opcional"
        placeholderTextColor="#64748b"
        multiline
      />

      <Pressable style={[S.btn, sending && S.disabled]} onPress={requestAccess} disabled={sending}>
        <Text style={S.btnTxt}>{sending ? "Enviando..." : "Solicitar acceso"}</Text>
      </Pressable>

      <Pressable style={S.link} onPress={onLogout}>
        <Text style={S.linkTxt}>Cerrar sesión</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0f14",
    padding: 16,
    justifyContent: "center",
  },
  title: {
    color: "#e5ecff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
  },
  text: {
    color: "#cbd5e1",
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#0f1522",
    color: "#e5ecff",
    borderColor: "#1f2937",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    minHeight: 60,
  },
  btn: {
    backgroundColor: "#00bb88",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  disabled: {
    opacity: 0.6,
  },
  btnTxt: {
    color: "#071c12",
    fontWeight: "800",
    fontSize: 16,
  },
  link: {
    marginTop: 16,
    alignItems: "center",
  },
  linkTxt: {
    color: "#94a3b8",
  },
});
