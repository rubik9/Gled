import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Alert,
  useWindowDimensions,
  ScrollView,
  Animated,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import * as Network from "expo-network";
import * as Haptics from "expo-haptics";
import ColorPicker from "react-native-wheel-color-picker";
import { sendWled } from "../api/wled";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";


/**
 * Pads con valores por defecto de brillo, velocidad e intensidad
 * Incluye efecto especial "Apagar" que apaga todos los LEDs
 */
const PAD_DEFS = [
  {
    label: "Solid",
    type: "solid",
    defaultBri: 200,
    defaultSx: 128,
    defaultIx: 128,
    defaultColor: "#ffffff",
  },
  {
    label: "Apagar",
    type: "off",
    color: "#ff4444",
  },
];


function hexToRgb(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return [r, g, b];
  }
  if (h.length !== 6) return [255, 255, 255];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function findIndexByName(list, targetName) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const t = norm(targetName);
  if (!t) return 0;

  const exact = list.findIndex((x) => norm(x) === t);
  if (exact >= 0) return exact;

  const contains = list.findIndex((x) => norm(x).includes(t));
  if (contains >= 0) return contains;

  return 0;
}

function PressableFX({ label, style, onPress, active, isOffButton = false }) {
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);

  function pressIn() {
    setPressed(true);
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      friction: 6,
      tension: 120,
    }).start();
  }
  function pressOut() {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 120,
    }).start(() => setPressed(false));
  }

  return (
    <Animated.View
      style={[
        { transform: [{ scale }] },
        {
          shadowColor: isOffButton ? "#ff4444" : "#000",
          shadowOpacity: pressed ? 0.45 : 0.3,
          shadowRadius: pressed ? 16 : 12,
          shadowOffset: { width: 0, height: pressed ? 12 : 8 },
        },
        { elevation: pressed ? 10 : 5 },
      ]}
    >
      <Pressable
        android_ripple={{
          color: isOffButton
            ? "rgba(255, 68, 68, 0.15)"
            : "rgba(255,255,255,0.06)",
          borderless: false,
        }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={async () => {
          try {
            await Haptics.selectionAsync();
          } catch {}
          onPress?.();
        }}
        style={[
          style,
          pressed && {
            backgroundColor: isOffButton ? "#1a0f0f" : "#0f1826",
          },
          active && {
            borderColor: isOffButton ? "#ff4444" : "#22c55e",
            borderWidth: 2,
          },
          isOffButton && {
            backgroundColor: "#2a1a1a",
            borderColor: "#ff4444",
          },
        ]}
      >
        <Text style={[S.padText, isOffButton && { color: "#ff8888" }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function Pad({ user, onLogout }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  const leftRatio = isLandscape ? 0.6 : 1.0;
  const rightRatio = isLandscape ? 0.4 : 1.0;
  const gap = 12;

  const numCols = useMemo(() => {
    if (!isLandscape) return width >= 700 ? 3 : 2;
    if (width >= 1200) return 4;
    if (width >= 900) return 3;
    return 2;
  }, [width, isLandscape]);

  const [host, setHost] = useState("http://192.168.4.1");
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [effects, setEffects] = useState([]);
  const [palettes, setPalettes] = useState([]);

  const [bri, setBri] = useState(160);
  const [sx, setSx] = useState(160);
  const [ix, setIx] = useState(160);
  const [colorHex, setColorHex] = useState("#ffffff");

  const [currentEffect, setCurrentEffect] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [activePad, setActivePad] = useState(null);
  const [isPoweredOn, setIsPoweredOn] = useState(true);

  const [finding, setFinding] = useState(false);
  const [prefix, setPrefix] = useState("192.168.1");

  const sliderValuesRef = useRef({ bri: 160, sx: 160, ix: 160 });
  const currentEffectRef = useRef(null);
  const sliderDebounceRef = useRef(null);
  const colorDebounceRef = useRef(null);
  const tapRef = useRef({ t: 0, hash: "" });
  const autoAdjustRef = useRef(null);
  const [pads, setPads] = useState(PAD_DEFS);

useEffect(() => {
  if (!user?.uid) return;

  const ref = doc(db, "users", user.uid, "config", "pads");

  const unsub = onSnapshot(ref, async (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data?.pads) && data.pads.length > 0) {
        setPads(data.pads);
      } else {
        setPads(PAD_DEFS);
      }
      return;
    }

    // No existe: lo creamos con el PAD_DEFS local (como maps, no strings)
    try {
      await setDoc(ref, {
        version: 1,
        updatedAt: serverTimestamp(),
        pads: PAD_DEFS,
      });
      setPads(PAD_DEFS);
    } catch (e) {
      console.log("No se pudo crear config/pads:", e?.code, e?.message);
      setPads(PAD_DEFS);
    }
  });

  return () => unsub();
}, [user?.uid]);

  useEffect(() => {
    sliderValuesRef.current = { bri, sx, ix };
  }, [bri, sx, ix]);

  useEffect(() => {
    currentEffectRef.current = currentEffect;
  }, [currentEffect]);

  useEffect(() => {
    return () => {
      if (autoAdjustRef.current) {
        clearInterval(autoAdjustRef.current);
      }
    };
  }, []);

  function toast(msg) {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), 1200);
  }

  async function fetchJsonWithTimeout(url, ms = 1500) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(id);
    }
  }

  async function connectToHost(targetHost) {
    try {
      const base = (targetHost || host).replace(/\/$/, "");
      const info = await fetchJsonWithTimeout(`${base}/json/info`, 1800);
      const eff = await fetchJsonWithTimeout(`${base}/json/effects`, 2500);
      const pal = await fetchJsonWithTimeout(`${base}/json/palettes`, 2500);

      setHost(base);
      setConnected(true);
      setDeviceName(info?.name || "WLED");
      setEffects(Array.isArray(eff) ? eff : []);
      setPalettes(Array.isArray(pal) ? pal : []);

      toast(`Conectado: ${info?.name || "WLED"}`);
      try {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      } catch {}
    } catch {
      setConnected(false);
      setDeviceName("");
      setEffects([]);
      setPalettes([]);
      toast("No se pudo conectar");
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    }
  }

  function scheduleLiveUpdate(kind) {
    if (!connected || !isPoweredOn) return;

    if (sliderDebounceRef.current) {
      clearTimeout(sliderDebounceRef.current);
    }

    sliderDebounceRef.current = setTimeout(async () => {
      try {
        const {
          bri: currentBri,
          sx: currentSx,
          ix: currentIx,
        } = sliderValuesRef.current;
        const partial = {};
        if (kind === "bri" || kind === "all") partial.bri = currentBri;
        if (kind === "sx" || kind === "ix" || kind === "all") {
          partial.seg = [{ id: 0, sx: currentSx, ix: currentIx }];
        }
        await sendWled(host, { on: true, ...partial });
      } catch (error) {
        console.log("Error en slider update:", error);
      }
    }, 120);
  }

  function scheduleColorSend(nextHex) {
    if (!connected || !isPoweredOn) return;

    if (colorDebounceRef.current) {
      clearTimeout(colorDebounceRef.current);
    }

    colorDebounceRef.current = setTimeout(async () => {
      try {
        const rgb = hexToRgb(nextHex);
        const currentEffect = currentEffectRef.current;
        const {
          bri: currentBri,
          sx: currentSx,
          ix: currentIx,
        } = sliderValuesRef.current;

        if (currentEffect?.label === "Solid") {
          await sendWled(host, {
            on: true,
            bri: currentBri,
            seg: [
              {
                id: 0,
                fx: 0,
                pal: 0,
                sx: currentSx,
                ix: currentIx,
                col: [rgb],
              },
            ],
          });
        } else if (currentEffect && currentEffect.fx !== 0) {
          // ✅ No enviar color si el efecto tiene paleta fija
          const pad = pads.find((p) => p.label === currentEffect.label);
          const useColor = pad?.fixedPalette ? [] : [rgb];

          await sendWled(host, {
            on: true,
            bri: currentBri,
            seg: [
              {
                id: 0,
                fx: currentEffect.fx,
                pal: currentEffect.pal || 0,
                sx: currentSx,
                ix: currentIx,
                col: useColor,
              },
            ],
          });
        }
      } catch (error) {
        console.log("Error en color update:", error);
      }
    }, 90);
  }

  async function turnOffLights() {
    if (!connected) {
      toast("Primero conecta o detecta el WLED");
      return;
    }

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await sendWled(host, { on: false });
      setIsPoweredOn(false);
      setActivePad("Apagar");
      setCurrentEffect(null);
      toast("LEDs apagados");
    } catch (error) {
      console.error("Error al apagar:", error);
      toast("Error al apagar");
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    }
  }

  async function turnOnLights() {
    if (!connected) {
      toast("Primero conecta o detecta el WLED");
      return;
    }

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await sendWled(host, { on: true, bri });
      setIsPoweredOn(true);
      toast("LEDs encendidos");
    } catch (error) {
      console.error("Error al encender:", error);
      toast("Error al encender");
    }
  }

  function resetToDefaults() {
    const current = pads.find((p) => p.label === activePad);
    if (current) {
      if (current.defaultBri !== undefined) {
        setBri(current.defaultBri);
        if (connected && isPoweredOn)
          sendWled(host, { on: true, bri: current.defaultBri }).catch(() => {});
      }
      if (current.defaultSx !== undefined) {
        setSx(current.defaultSx);
      }
      if (current.defaultIx !== undefined) {
        setIx(current.defaultIx);
      }
      if (current.defaultColor) {
        setColorHex(current.defaultColor);
      }

      if (current.defaultSx !== undefined || current.defaultIx !== undefined) {
        setTimeout(() => {
          if (connected && isPoweredOn) {
            sendWled(host, {
              on: true,
              seg: [
                {
                  id: 0,
                  sx: current.defaultSx !== undefined ? current.defaultSx : sx,
                  ix: current.defaultIx !== undefined ? current.defaultIx : ix,
                },
              ],
            }).catch(() => {});
          }
        }, 50);
      }

      toast(`Reset a valores por defecto de ${current.label}`);
    }
  }

  async function applyPad(pad) {
    const now = Date.now();
    if (now - tapRef.current.t < 350) return;
    tapRef.current.t = now;

    if (!connected) {
      toast("Primero conecta o detecta el WLED");
      return;
    }

    if (pad.type === "off") {
      await turnOffLights();
      return;
    }

    if (!isPoweredOn && pad.type !== "off") {
      await turnOnLights();
    }

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    try {
      if (pad.defaultBri !== undefined) {
        setBri(pad.defaultBri);
        if (isPoweredOn) {
          await sendWled(host, { on: true, bri: pad.defaultBri });
        }
      }
      if (pad.defaultSx !== undefined) {
        setSx(pad.defaultSx);
      }
      if (pad.defaultIx !== undefined) {
        setIx(pad.defaultIx);
      }
      if (pad.defaultColor) {
        setColorHex(pad.defaultColor);
      }

      if (pad.type === "solid") {
        const rgb = hexToRgb(colorHex);
        const solidEffect = { label: "Solid", fx: 0, pal: 0 };

        setCurrentEffect(solidEffect);
        setActivePad(pad.label);

        setTimeout(async () => {
          if (isPoweredOn) {
            await sendWled(host, {
              on: true,
              bri,
              seg: [{ id: 0, fx: 0, pal: 0, sx, ix, col: [rgb] }],
            });
          }
        }, 100);

        toast(`Aplicado: ${pad.label} (Bri: ${bri}, Vel: ${sx})`);
        return;
      }

      if (!effects.length) {
        toast("Cargando efectos...");
        return;
      }

      const fx = findIndexByName(effects, pad.effectName);
      let pal = 0; // Paleta por defecto

      // ✅ SOLO ESTE BLOQUE NUEVO: Buscar paleta fija si existe
      if (pad.fixedPalette && palettes.length > 0) {
        const targetPalette = norm(pad.fixedPalette);
        const foundIndex = palettes.findIndex((p) => norm(p) === targetPalette);

        if (foundIndex >= 0) {
          pal = foundIndex;
        } else {
          // Si no encuentra exacto, buscar por "contiene"
          const containsIndex = palettes.findIndex((p) =>
            norm(p).includes(targetPalette),
          );
          if (containsIndex >= 0) {
            pal = containsIndex;
          }
        }
      }

      const effectObj = {
        label: pad.label,
        fx,
        pal,
        hasFixedPalette: !!pad.fixedPalette,
      };

      const desiredHash = `${pad.label}|fx:${fx}|pal:${pal}|bri:${bri}|sx:${sx}|ix:${ix}`;
      if (tapRef.current.hash === desiredHash) return;

      // ✅ Para efectos con paleta fija, NO usar color del picker
      const useColor = pad.fixedPalette ? [] : [hexToRgb(colorHex)];

      setTimeout(async () => {
        if (isPoweredOn) {
          await sendWled(host, {
            on: true,
            bri,
            seg: [
              {
                id: 0,
                fx,
                pal, // ✅ Incluye paleta si es fija
                sx,
                ix,
                col: useColor, // ✅ Solo color si NO tiene paleta fija
              },
            ],
          });
        }
      }, 150);

      tapRef.current.hash = desiredHash;
      setCurrentEffect(effectObj);
      setActivePad(pad.label);

      // ✅ Toast especial para efecto con paleta fija
      if (pad.fixedPalette) {
        toast(`✨ ${pad.label} (con paleta ${pad.fixedPalette})`);
      } else {
        toast(`Aplicado: ${pad.label} (Bri: ${bri}, Vel: ${sx})`);
      }
    } catch {
      toast("No se pudo aplicar");
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    }
  }

  function toPrefixFromIP(ip) {
    const m = ip && ip.match(/^(\d+)\.(\d+)\.(\d+)\./);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  }

  function looksLikeWLED(j) {
    return j && typeof j === "object" && (j.ver || j.name || j.info);
  }

  async function detectWled() {
    if (finding) return;
    setFinding(true);

    let pref = "192.168.1";
    try {
      const ip = await Network.getIpAddressAsync();
      const p = toPrefixFromIP(ip);
      if (p) pref = p;
    } catch {}
    setPrefix(pref);

    if (pref === "192.168.4") {
      try {
        const info = await fetchJsonWithTimeout(
          "http://192.168.4.1/json/info",
          1700,
        );
        if (looksLikeWLED(info)) {
          await connectToHost("http://192.168.4.1");
          setFinding(false);
          return;
        }
      } catch {}
    }

    try {
      const base = host.replace(/\/$/, "");
      const info = await fetchJsonWithTimeout(`${base}/json/info`, 1100);
      if (looksLikeWLED(info)) {
        await connectToHost(base);
        setFinding(false);
        return;
      }
    } catch {}

    try {
      const info = await fetchJsonWithTimeout(
        "http://wled.local/json/info",
        1200,
      );
      if (looksLikeWLED(info)) {
        await connectToHost("http://wled.local");
        setFinding(false);
        return;
      }
    } catch {}

    const ips = Array.from({ length: 254 }, (_, i) => `${pref}.${i + 1}`);
    const concurrency = 8;
    let idx = 0;
    let foundHost = null;

    async function worker() {
      while (idx < ips.length && !foundHost) {
        const my = idx++;
        const ip = ips[my];
        try {
          const info = await fetchJsonWithTimeout(
            `http://${ip}/json/info`,
            900,
          );
          if (looksLikeWLED(info)) {
            foundHost = `http://${ip}`;
            return;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 8));
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    setFinding(false);

    if (foundHost) {
      await connectToHost(foundHost);
      return;
    }

    Alert.alert(
      "Detección",
      `No se encontró WLED en ${pref}.x.\nAsegúrate de estar en la misma red (o en el AP del ESP).`,
    );
  }

  const leftWidth = useMemo(
    () => (isLandscape ? width * leftRatio : width),
    [width, isLandscape, leftRatio],
  );
  const itemWidth = useMemo(() => {
    const totalGaps = gap * (numCols - 1);
    return (leftWidth - 32 - totalGaps) / numCols;
  }, [leftWidth, numCols, gap]);

  const Controls = (
    <View style={{ gap: 12 }}>
      <View style={S.card}>
        <Text style={S.cardTitle}>Conexión</Text>

        <TextInput
          value={host}
          onChangeText={(t) => {
            setHost(t);
            setConnected(false);
            setDeviceName("");
            setEffects([]);
            setPalettes([]);
            setCurrentEffect(null);
            setActivePad(null);
            setIsPoweredOn(true);
          }}
          placeholder="http://192.168.4.1"
          placeholderTextColor="#93a4bd"
          style={S.input}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={S.rowBtns}>
          <Pressable
            style={[
              S.btnSmall,
              { backgroundColor: connected ? "#16a34a" : "#2563eb" },
            ]}
            onPress={() => connectToHost(host)}
          >
            <Text style={S.btnSmallTxt}>
              {connected
                ? deviceName
                  ? `Conectado: ${deviceName}`
                  : "Conectado"
                : "Conectar"}
            </Text>
          </Pressable>

          <Pressable
            style={[
              S.btnSmall,
              { backgroundColor: finding ? "#555" : "#1d4ed8" },
            ]}
            onPress={detectWled}
            disabled={finding}
          >
            <Text style={S.btnSmallTxt}>
              {finding ? "Detectando…" : `Detectar (${prefix}.x)`}
            </Text>
          </Pressable>
        </View>

        <View style={S.rowBtns}>
          <Pressable
            style={[
              S.btnSmall,
              { backgroundColor: isPoweredOn ? "#0b8" : "#555" },
            ]}
            onPress={() => connected && turnOnLights()}
          >
            <Text style={S.btnSmallTxt}>Encender</Text>
          </Pressable>
          <Pressable
            style={[
              S.btnSmall,
              { backgroundColor: !isPoweredOn ? "#ff4444" : "#334" },
            ]}
            onPress={() => connected && turnOffLights()}
          >
            <Text style={S.btnSmallTxt}>Apagar</Text>
          </Pressable>
          <Pressable
            style={[S.btnSmall, { backgroundColor: "#444" }]}
            onPress={onLogout}
          >
            <Text style={S.btnSmallTxt}>Salir</Text>
          </Pressable>
          {/* {activePad && activePad !== "Apagar" && (
            <Pressable
              style={[S.btnSmall, { backgroundColor: "#666" }]}
              onPress={resetToDefaults}
            >
              <Text style={S.btnSmallTxt}>Reset Defaults</Text>
            </Pressable>
          )} */}
        </View>

        <Text style={S.meta}>
          {connected
            ? `Efectos: ${effects.length || "…"} · Paletas: ${palettes.length || "…"}`
            : "No conectado"}
        </Text>

        <View
          style={[
            S.powerStatus,
            { backgroundColor: isPoweredOn ? "#1a2e1a" : "#2e1a1a" },
          ]}
        >
          <Text
            style={[
              S.powerStatusText,
              { color: isPoweredOn ? "#4ade80" : "#f87171" },
            ]}
          >
            {isPoweredOn ? "● ENCENDIDO" : "○ APAGADO"}
          </Text>
        </View>

        {currentEffect && (
          <View style={S.effectInfo}>
            <Text style={S.effectInfoText}>
              {currentEffect.label} | Bri: {bri} | Vel: {sx} | Int: {ix}
            </Text>
            {(() => {
              const pad = pads.find((p) => p.label === currentEffect.label);
              if (pad && (pad.defaultBri || pad.defaultSx || pad.defaultIx)) {
                return (
                  <Text style={S.effectDefaults}>
                    Valores por defecto: Bri {pad.defaultBri || "--"}, Vel{" "}
                    {pad.defaultSx || "--"}, Int {pad.defaultIx || "--"}
                    {pad.fixedPalette && ` | Paleta: ${pad.fixedPalette}`}
                  </Text>
                );
              }
              return null;
            })()}
          </View>
        )}
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Color</Text>

        <Text style={[S.meta, { marginBottom: 8 }]}>
          {currentEffect
            ? `Aplicar color a: ${currentEffect.label}`
            : isPoweredOn
              ? "Selecciona un efecto primero"
              : "LEDs apagados"}
        </Text>

        <View
          style={{
            alignItems: "center",
            marginTop: 5,
            height: 320, // ✅ Contenedor más alto
            justifyContent: "center",
          }}
        >
          <ColorPicker
            color={colorHex}
            onColorChangeComplete={(c) => {
              const next = typeof c === "string" ? c : colorHex;
              setColorHex(next);
              if (isPoweredOn) {
                scheduleColorSend(next);
              }
            }}
            thumbSize={40}
            sliderSize={0}
            noSnap={true}
            row={false}
            swatches={false}
            useNativeDriver={true}
            disabled={!isPoweredOn}
            style={{
      width: 315, // ✅ Ancho personalizado
      height: 315, // ✅ Alto personalizado
    }}
          />
          <View style={S.colorRow}>
            <View
              style={[
                S.colorPreview,
                {
                  backgroundColor: colorHex,
                  opacity: isPoweredOn ? 1 : 0.5,
                },
              ]}
            />
            <Text style={[S.colorHex, { opacity: isPoweredOn ? 1 : 0.5 }]}>
              {colorHex}
            </Text>
          </View>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Controles</Text>

        {!isPoweredOn && (
          <View style={S.disabledOverlay}>
            <Text style={S.disabledText}>LEDs apagados</Text>
          </View>
        )}

        <View style={[S.sliderBlock, { opacity: isPoweredOn ? 1 : 0.5 }]}>
          <Text style={S.label}>Brillo: {bri}</Text>
          <Slider
            value={bri}
            minimumValue={1}
            maximumValue={255}
            step={1}
            onValueChange={(v) => {
              setBri(v);
              if (isPoweredOn) scheduleLiveUpdate("bri");
            }}
            onSlidingComplete={(v) => {
              setBri(v);
              if (connected && isPoweredOn) {
                sendWled(host, { on: true, bri: v }).catch(() => {});
              }
            }}
            style={S.slider}
            disabled={!isPoweredOn}
            minimumTrackTintColor={isPoweredOn ? "#3b82f6" : "#666"}
            maximumTrackTintColor={isPoweredOn ? "#1e293b" : "#444"}
            thumbTintColor={isPoweredOn ? "#60a5fa" : "#888"}
          />
        </View>

        <View style={[S.sliderBlock, { opacity: isPoweredOn ? 1 : 0.5 }]}>
          <Text style={S.label}>Velocidad (FX): {sx}</Text>
          <Slider
            value={sx}
            minimumValue={0}
            maximumValue={255}
            step={1}
            onValueChange={(v) => {
              setSx(v);
              if (isPoweredOn) scheduleLiveUpdate("sx");
            }}
            onSlidingComplete={(v) => {
              setSx(v);
              if (connected && isPoweredOn) {
                sendWled(host, { on: true, seg: [{ id: 0, sx: v }] }).catch(
                  () => {},
                );
              }
            }}
            style={S.slider}
            disabled={!isPoweredOn}
            minimumTrackTintColor={isPoweredOn ? "#3b82f6" : "#666"}
            maximumTrackTintColor={isPoweredOn ? "#1e293b" : "#444"}
            thumbTintColor={isPoweredOn ? "#60a5fa" : "#888"}
          />
        </View>

        <View style={[S.sliderBlock, { opacity: isPoweredOn ? 1 : 0.5 }]}>
          <Text style={S.label}>Intensidad (FX): {ix}</Text>
          <Slider
            value={ix}
            minimumValue={0}
            maximumValue={255}
            step={1}
            onValueChange={(v) => {
              setIx(v);
              if (isPoweredOn) scheduleLiveUpdate("ix");
            }}
            onSlidingComplete={(v) => {
              setIx(v);
              if (connected && isPoweredOn) {
                sendWled(host, { on: true, seg: [{ id: 0, ix: v }] }).catch(
                  () => {},
                );
              }
            }}
            style={S.slider}
            disabled={!isPoweredOn}
            minimumTrackTintColor={isPoweredOn ? "#3b82f6" : "#666"}
            maximumTrackTintColor={isPoweredOn ? "#1e293b" : "#444"}
            thumbTintColor={isPoweredOn ? "#60a5fa" : "#888"}
          />
        </View>
      </View>
    </View>
  );

  const Pads = (
    <View style={[S.grid, { gap }]}>
      {pads.map((p, i) => (
        <PressableFX
          key={i}
          label={p.label}
          active={activePad === p.label}
          onPress={() => applyPad(p)}
          isOffButton={p.type === "off"}
          style={[
            S.padBtn,
            { width: itemWidth, height: itemWidth },
            p.type === "off" && S.offButton,
          ]}
        />
      ))}
    </View>
  );

  return (
    <SafeAreaView style={S.safe} edges={["top", "right", "bottom", "left"]}>
      <Text style={S.title}>WLED Pad</Text>

      {statusMsg ? (
        <View style={S.toast}>
          <Text style={S.toastTxt}>{statusMsg}</Text>
        </View>
      ) : null}

      {!isLandscape ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {Controls}
          <View style={{ height: 14 }} />
          {Pads}
        </ScrollView>
      ) : (
        <View style={S.landRow}>
          <View style={S.leftCol}>
            <ScrollView
              contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
              keyboardShouldPersistTaps="handled"
            >
              {Pads}
            </ScrollView>
          </View>

          <View style={S.rightCol}>
            <ScrollView
              contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
              keyboardShouldPersistTaps="handled"
            >
              {Controls}
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0f14", paddingHorizontal: 16 },
  title: {
    color: "#e5ecff",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 8,
    marginBottom: 10,
  },

  toast: {
    backgroundColor: "#0f1522",
    borderColor: "#1f2937",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  toastTxt: { color: "#cbd5e1" },

  landRow: { flex: 1, flexDirection: "row", gap: 16 },
  leftCol: { flexBasis: "60%", maxWidth: "60%", flexGrow: 0 },
  rightCol: { flexBasis: "40%", maxWidth: "40%", flexGrow: 0 },

  card: {
    backgroundColor: "#0f1522",
    borderColor: "#1f2937",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    position: "relative",
  },

  cardTitle: {
    color: "#e5ecff",
    fontWeight: "900",
    fontSize: 14,
    marginBottom: 10,
  },

  input: {
    backgroundColor: "#0b0f14",
    color: "#e5ecff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderColor: "#273244",
    borderWidth: 1,
    marginBottom: 10,
  },

  rowBtns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnSmallTxt: { color: "#e5ecff", fontWeight: "800" },

  meta: { color: "#9fb0c8", fontWeight: "700", marginTop: 2 },

  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  colorPreview: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#273244",
  },
  colorHex: { color: "#9fb0c8", fontWeight: "700" },

  sliderBlock: { marginTop: 10 },
  label: { color: "#cbd5e1", marginBottom: 6, fontWeight: "800" },
  slider: { height: 36, width: "100%" },

  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  padBtn: {
    backgroundColor: "#111827",
    borderColor: "#273244",
    borderWidth: 1,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  offButton: {
    backgroundColor: "#2a1a1a",
    borderColor: "#ff4444",
  },
  padText: { color: "#e5ecff", fontWeight: "900", fontSize: 18 },

  effectInfo: {
    backgroundColor: "#1a1f2e",
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  effectInfoText: {
    color: "#22c55e",
    fontWeight: "700",
    fontSize: 14,
  },
  effectDefaults: {
    color: "#93a4bd",
    fontSize: 12,
    marginTop: 4,
  },

  powerStatus: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  powerStatusText: {
    fontWeight: "900",
    fontSize: 12,
  },

  disabledOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
    borderRadius: 14,
  },
  disabledText: {
    color: "#94a3b8",
    fontWeight: "800",
    fontSize: 16,
  },
});
