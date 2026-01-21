import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, Alert,
  useWindowDimensions, ScrollView, Animated
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import * as Network from 'expo-network';
import * as Haptics from 'expo-haptics';
import ColorPicker from 'react-native-wheel-color-picker';
import { sendWled } from '../api/wled';

/**
 * Pads por nombre (la app consulta /json/effects y traduce effectName -> índice fx real)
 * Solid se maneja como modo color (fx:0) + color del picker
 */
const PAD_DEFS = [
  { label: 'Solid', type: 'solid' }, // usa color picker
  { label: 'Fade', type: 'effectByName', effectName: 'Fade' },
  { label: 'Flash', type: 'effectByName', effectName: 'Strobe Mega' },
  { label: 'Linea', type: 'effectByName', effectName: 'Chase' },
  { label: 'Doble', type: 'effectByName', effectName: 'Bpm' },

  // 4 extra a criterio (muy típicos y vistosos)
  { label: 'Rainbow', type: 'effectByName', effectName: 'Chunchun' },
  { label: 'ChunChun', type: 'effectByName', effectName: 'Fire 2012' },
  { label: 'Meteor', type: 'effectByName', effectName: 'Meteor' },
  { label: 'Colorloop', type: 'effectByName', effectName: 'Colorloop' },
];

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '').trim();
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
  return String(s || '').trim().toLowerCase();
}

function findIndexByName(list, targetName) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const t = norm(targetName);
  if (!t) return 0;

  // match exacto
  const exact = list.findIndex((x) => norm(x) === t);
  if (exact >= 0) return exact;

  // match por "contiene" (tolerante a variaciones)
  const contains = list.findIndex((x) => norm(x).includes(t));
  if (contains >= 0) return contains;

  return 0;
}

/** Botón con sensación (hundimiento + sombra + ripple + haptics) */
function PressableFX({ label, style, onPress, active }) {
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
          shadowColor: '#000',
          shadowOpacity: pressed ? 0.35 : 0.2,
          shadowRadius: pressed ? 14 : 10,
          shadowOffset: { width: 0, height: pressed ? 10 : 6 },
        },
        { elevation: pressed ? 8 : 3 },
      ]}
    >
      <Pressable
        android_ripple={{ color: 'rgba(255,255,255,0.06)', borderless: false }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={async () => {
          try { await Haptics.selectionAsync(); } catch {}
          onPress?.();
        }}
        style={[
          style,
          pressed && { backgroundColor: '#0f1826' },
          active && { borderColor: '#22c55e', borderWidth: 2 },
        ]}
      >
        <Text style={S.padText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function Pad({ onLogout }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isLandscape = width > height;

  // Layout tipo imagen: pads a la izquierda, controles a la derecha
  const leftRatio = isLandscape ? 0.60 : 1.0;
  const rightRatio = isLandscape ? 0.40 : 1.0;

  const gap = 12;

  const numCols = useMemo(() => {
    // grid más "tablet friendly"
    if (!isLandscape) return width >= 700 ? 3 : 2;
    if (width >= 1200) return 4;
    if (width >= 900) return 3;
    return 2;
  }, [width, isLandscape]);

  const [host, setHost] = useState('http://192.168.4.1'); // AP típico WLED
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState('');

  const [effects, setEffects] = useState([]);   // /json/effects
  const [palettes, setPalettes] = useState([]); // /json/palettes (por si luego agregas selector)

  const [bri, setBri] = useState(160);
  const [sx, setSx] = useState(160);
  const [ix, setIx] = useState(160);
  const [colorHex, setColorHex] = useState('#ffffff');

  // Estado para trackear el efecto actual
  const [currentEffect, setCurrentEffect] = useState(null); // { label, fx, pal }
  const [statusMsg, setStatusMsg] = useState('');
  const [activePad, setActivePad] = useState(null);

  const [finding, setFinding] = useState(false);
  const [prefix, setPrefix] = useState('192.168.1');

  // ✅ CORRECCIÓN: Usar refs para almacenar valores actualizados
  const sliderValuesRef = useRef({ bri: 160, sx: 160, ix: 160 });
  const currentEffectRef = useRef(null);
  
  const sliderDebounceRef = useRef(null);
  const colorDebounceRef = useRef(null);
  const tapRef = useRef({ t: 0, hash: '' });

  // ✅ Actualizar refs cuando los estados cambien
  React.useEffect(() => {
    sliderValuesRef.current = { bri, sx, ix };
  }, [bri, sx, ix]);

  React.useEffect(() => {
    currentEffectRef.current = currentEffect;
  }, [currentEffect]);

  function toast(msg) {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 1200);
  }

  async function fetchJsonWithTimeout(url, ms = 1500) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(id); }
  }

  async function connectToHost(targetHost) {
    try {
      const base = (targetHost || host).replace(/\/$/, '');
      const info = await fetchJsonWithTimeout(`${base}/json/info`, 1800);
      const eff = await fetchJsonWithTimeout(`${base}/json/effects`, 2500);
      const pal = await fetchJsonWithTimeout(`${base}/json/palettes`, 2500);

      setHost(base);
      setConnected(true);
      setDeviceName(info?.name || 'WLED');
      setEffects(Array.isArray(eff) ? eff : []);
      setPalettes(Array.isArray(pal) ? pal : []);

      toast(`Conectado: ${info?.name || 'WLED'}`);
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    } catch {
      setConnected(false);
      setDeviceName('');
      setEffects([]);
      setPalettes([]);
      toast('No se pudo conectar');
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
    }
  }

  // ✅ CORRECCIÓN: Sliders live con valores actualizados desde refs
  function scheduleLiveUpdate(kind) {
    if (!connected) return;
    
    // Cancelar timeout anterior
    if (sliderDebounceRef.current) {
      clearTimeout(sliderDebounceRef.current);
    }

    // Crear nuevo timeout con los valores más recientes
    sliderDebounceRef.current = setTimeout(async () => {
      try {
        const { bri: currentBri, sx: currentSx, ix: currentIx } = sliderValuesRef.current;
        
        const partial = {};
        if (kind === 'bri' || kind === 'all') partial.bri = currentBri;
        if (kind === 'sx' || kind === 'ix' || kind === 'all') {
          partial.seg = [{ id: 0, sx: currentSx, ix: currentIx }];
        }
        await sendWled(host, { on: true, ...partial });
      } catch (error) {
        console.log('Error en slider update:', error);
      }
    }, 120);
  }

  // ✅ CORRECCIÓN: Enviar color al efecto actual (o sólido)
  function scheduleColorSend(nextHex) {
    if (!connected) return;
    
    // Cancelar timeout anterior
    if (colorDebounceRef.current) {
      clearTimeout(colorDebounceRef.current);
    }

    // Crear nuevo timeout
    colorDebounceRef.current = setTimeout(async () => {
      try {
        const rgb = hexToRgb(nextHex);
        const currentEffect = currentEffectRef.current;
        const { bri: currentBri, sx: currentSx, ix: currentIx } = sliderValuesRef.current;
        
        // Si estamos en modo sólido
        if (currentEffect?.label === 'Solid') {
          await sendWled(host, { 
            on: true, 
            bri: currentBri, 
            seg: [{ id: 0, fx: 0, pal: 0, sx: currentSx, ix: currentIx, col: [rgb] }] 
          });
        } 
        // Si estamos en un efecto (no sólido)
        else if (currentEffect && currentEffect.fx !== 0) {
          await sendWled(host, { 
            on: true, 
            bri: currentBri, 
            seg: [{ 
              id: 0, 
              fx: currentEffect.fx, 
              pal: currentEffect.pal || 0, 
              sx: currentSx, 
              ix: currentIx, 
              col: [rgb]  // ✅ Esto aplica el color al efecto actual
            }] 
          });
        }
      } catch (error) {
        console.log('Error en color update:', error);
      }
    }, 90);
  }

  async function applyPad(pad) {
    // throttle para no spamear
    const now = Date.now();
    if (now - tapRef.current.t < 350) return;
    tapRef.current.t = now;

    if (!connected) {
      toast('Primero conecta o detecta el WLED');
      return;
    }

    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}

    try {
      if (pad.type === 'solid') {
        // Modo sólido
        const rgb = hexToRgb(colorHex);
        const solidEffect = { label: 'Solid', fx: 0, pal: 0 };
        
        setCurrentEffect(solidEffect);
        setActivePad(pad.label);

        await sendWled(host, { 
          on: true, 
          bri, 
          seg: [{ id: 0, fx: 0, pal: 0, sx, ix, col: [rgb] }] 
        });
        
        toast(`Aplicado: ${pad.label}`);
        return;
      }

      // Modo efecto
      if (!effects.length) {
        toast('Cargando efectos...');
        return;
      }

      const fx = findIndexByName(effects, pad.effectName);
      const pal = 0; // puedes cambiar esto luego con selector de paleta
      const effectObj = { label: pad.label, fx, pal };
      
      const desiredHash = `${pad.label}|fx:${fx}|pal:${pal}|bri:${bri}|sx:${sx}|ix:${ix}`;
      if (tapRef.current.hash === desiredHash) return;

      // ✅ Aplicar efecto con el color actual
      const rgb = hexToRgb(colorHex);
      
      await sendWled(host, { 
        on: true, 
        bri, 
        seg: [{ 
          id: 0, 
          fx, 
          pal, 
          sx, 
          ix, 
          col: [rgb]  // Aplica el color actual al efecto
        }] 
      });
      
      tapRef.current.hash = desiredHash;
      setCurrentEffect(effectObj);
      setActivePad(pad.label);
      
      toast(`Aplicado: ${pad.label}`);
    } catch {
      toast('No se pudo aplicar');
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
    }
  }

  function toPrefixFromIP(ip) {
    const m = ip && ip.match(/^(\d+)\.(\d+)\.(\d+)\./);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  }

  function looksLikeWLED(j) {
    return j && typeof j === 'object' && (j.ver || j.name || j.info);
  }

  // Detección: AP shortcut + host actual + scan /24 (moderado)
  async function detectWled() {
    if (finding) return;
    setFinding(true);

    let pref = '192.168.1';
    try {
      const ip = await Network.getIpAddressAsync();
      const p = toPrefixFromIP(ip);
      if (p) pref = p;
    } catch {}
    setPrefix(pref);

    // 1) Atajo AP típico
    if (pref === '192.168.4') {
      try {
        const info = await fetchJsonWithTimeout('http://192.168.4.1/json/info', 1700);
        if (looksLikeWLED(info)) {
          await connectToHost('http://192.168.4.1');
          setFinding(false);
          return;
        }
      } catch {}
    }

    // 2) Probar host actual
    try {
      const base = host.replace(/\/$/, '');
      const info = await fetchJsonWithTimeout(`${base}/json/info`, 1100);
      if (looksLikeWLED(info)) {
        await connectToHost(base);
        setFinding(false);
        return;
      }
    } catch {}

    // 3) wled.local (puede o no servir según red)
    try {
      const info = await fetchJsonWithTimeout('http://wled.local/json/info', 1200);
      if (looksLikeWLED(info)) {
        await connectToHost('http://wled.local');
        setFinding(false);
        return;
      }
    } catch {}

    // 4) Scan /24 con concurrencia baja
    const ips = Array.from({ length: 254 }, (_, i) => `${pref}.${i + 1}`);
    const concurrency = 8;
    let idx = 0;
    let foundHost = null;

    async function worker() {
      while (idx < ips.length && !foundHost) {
        const my = idx++;
        const ip = ips[my];
        try {
          const info = await fetchJsonWithTimeout(`http://${ip}/json/info`, 900);
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

    Alert.alert('Detección', `No se encontró WLED en ${pref}.x.\nAsegúrate de estar en la misma red (o en el AP del ESP).`);
  }

  const leftWidth = useMemo(() => (isLandscape ? width * leftRatio : width), [width, isLandscape, leftRatio]);
  const itemWidth = useMemo(() => {
    const totalGaps = gap * (numCols - 1);
    return (leftWidth - 32 - totalGaps) / numCols;
  }, [leftWidth, numCols, gap]);

  // ---- UI ----

  const Controls = (
    <View style={{ gap: 12 }}>
      {/* Host + acciones */}
      <View style={S.card}>
        <Text style={S.cardTitle}>Conexión</Text>

        <TextInput
          value={host}
          onChangeText={(t) => {
            setHost(t);
            setConnected(false);
            setDeviceName('');
            setEffects([]);
            setPalettes([]);
            setCurrentEffect(null);
            setActivePad(null);
          }}
          placeholder="http://192.168.4.1"
          placeholderTextColor="#93a4bd"
          style={S.input}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={S.rowBtns}>
          <Pressable
            style={[S.btnSmall, { backgroundColor: connected ? '#16a34a' : '#2563eb' }]}
            onPress={() => connectToHost(host)}
          >
            <Text style={S.btnSmallTxt}>
              {connected ? (deviceName ? `Conectado: ${deviceName}` : 'Conectado') : 'Conectar'}
            </Text>
          </Pressable>

          <Pressable
            style={[S.btnSmall, { backgroundColor: finding ? '#555' : '#1d4ed8' }]}
            onPress={detectWled}
            disabled={finding}
          >
            <Text style={S.btnSmallTxt}>
              {finding ? 'Detectando…' : `Detectar (${prefix}.x)`}
            </Text>
          </Pressable>
        </View>

        <View style={S.rowBtns}>
          <Pressable style={[S.btnSmall, { backgroundColor: '#0b8' }]} onPress={() => connected && sendWled(host, { on: true }).catch(() => {})}>
            <Text style={S.btnSmallTxt}>Encender</Text>
          </Pressable>
          <Pressable style={[S.btnSmall, { backgroundColor: '#334' }]} onPress={() => connected && sendWled(host, { on: false }).catch(() => {})}>
            <Text style={S.btnSmallTxt}>Apagar</Text>
          </Pressable>
          <Pressable style={[S.btnSmall, { backgroundColor: '#444' }]} onPress={onLogout}>
            <Text style={S.btnSmallTxt}>Salir</Text>
          </Pressable>
        </View>

        <Text style={S.meta}>
          {connected ? `Efectos: ${effects.length || '…'} · Paletas: ${palettes.length || '…'}` : 'No conectado'}
        </Text>
        {currentEffect && (
          <Text style={[S.meta, { color: '#22c55e', marginTop: 4 }]}>
            Actual: {currentEffect.label}
          </Text>
        )}
      </View>

      {/* Color picker */}
      <View style={S.card}>
        <Text style={S.cardTitle}>Color</Text>
        
        <Text style={[S.meta, { marginBottom: 8 }]}>
          {currentEffect ? 
            `Aplicar color a: ${currentEffect.label}` : 
            'Selecciona un efecto primero'}
        </Text>
        
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <ColorPicker
            color={colorHex}
            onColorChangeComplete={(c) => {
              const next = typeof c === 'string' ? c : colorHex;
              setColorHex(next);
              
              // ✅ Siempre envía el color, ya sea a sólido o al efecto actual
              scheduleColorSend(next);
            }}
            thumbSize={28}
            sliderSize={0}
            noSnap={true}
            row={false}
            swatches={false}
            useNativeDriver={true}
          />
          <View style={S.colorRow}>
            <View style={[S.colorPreview, { backgroundColor: colorHex }]} />
            <Text style={S.colorHex}>{colorHex}</Text>
          </View>
        </View>
      </View>

      {/* Sliders */}
      <View style={S.card}>
        <Text style={S.cardTitle}>Controles</Text>

        <View style={S.sliderBlock}>
          <Text style={S.label}>Brillo: {bri}</Text>
          <Slider
            value={bri} 
            minimumValue={1} 
            maximumValue={255} 
            step={1}
            onValueChange={(v) => { 
              setBri(v);
              scheduleLiveUpdate('bri'); 
            }}
            onSlidingComplete={(v) => {
              // ✅ Enviar inmediatamente al soltar el slider
              setBri(v);
              if (connected) {
                sendWled(host, { on: true, bri: v }).catch(() => {});
              }
            }}
            style={S.slider}
          />
        </View>

        <View style={S.sliderBlock}>
          <Text style={S.label}>Velocidad (FX): {sx}</Text>
          <Slider
            value={sx} 
            minimumValue={0} 
            maximumValue={255} 
            step={1}
            onValueChange={(v) => { 
              setSx(v);
              scheduleLiveUpdate('sx'); 
            }}
            onSlidingComplete={(v) => {
              // ✅ Enviar inmediatamente al soltar el slider
              setSx(v);
              if (connected) {
                sendWled(host, { on: true, seg: [{ id: 0, sx: v }] }).catch(() => {});
              }
            }}
            style={S.slider}
          />
        </View>

        <View style={S.sliderBlock}>
          <Text style={S.label}>Intensidad (FX): {ix}</Text>
          <Slider
            value={ix} 
            minimumValue={0} 
            maximumValue={255} 
            step={1}
            onValueChange={(v) => { 
              setIx(v);
              scheduleLiveUpdate('ix'); 
            }}
            onSlidingComplete={(v) => {
              // ✅ Enviar inmediatamente al soltar el slider
              setIx(v);
              if (connected) {
                sendWled(host, { on: true, seg: [{ id: 0, ix: v }] }).catch(() => {});
              }
            }}
            style={S.slider}
          />
        </View>
      </View>
    </View>
  );

  const Pads = (
    <View style={[S.grid, { gap }]}>
      {PAD_DEFS.map((p, i) => (
        <PressableFX
          key={i}
          label={p.label}
          active={activePad === p.label}
          onPress={() => applyPad(p)}
          style={[S.padBtn, { width: itemWidth, height: itemWidth }]}
        />
      ))}
    </View>
  );

  return (
    <SafeAreaView style={S.safe} edges={['top','right','bottom','left']}>
      <Text style={S.title}>WLED Pad</Text>

      {statusMsg ? (
        <View style={S.toast}><Text style={S.toastTxt}>{statusMsg}</Text></View>
      ) : null}

      {!isLandscape ? (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
          {Controls}
          <View style={{ height: 14 }} />
          {Pads}
        </ScrollView>
      ) : (
        <View style={S.landRow}>
          {/* IZQUIERDA: PADS */}
          <View style={S.leftCol}>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
              {Pads}
            </ScrollView>
          </View>

          {/* DERECHA: CONTROLES */}
          <View style={S.rightCol}>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
              {Controls}
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f14', paddingHorizontal: 16 },
  title: { color: '#e5ecff', fontSize: 22, fontWeight: '800', marginTop: 8, marginBottom: 10 },

  toast: {
    backgroundColor: '#0f1522',
    borderColor: '#1f2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
    marginBottom: 10
  },
  toastTxt: { color: '#cbd5e1' },

  landRow: { flex: 1, flexDirection: 'row', gap: 16 },
  leftCol: { flexBasis: '60%', maxWidth: '60%', flexGrow: 0 },
  rightCol: { flexBasis: '40%', maxWidth: '40%', flexGrow: 0 },

  card: {
    backgroundColor: '#0f1522',
    borderColor: '#1f2937',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  cardTitle: { color: '#e5ecff', fontWeight: '900', fontSize: 14, marginBottom: 10 },

  input: {
    backgroundColor: '#0b0f14',
    color: '#e5ecff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderColor: '#273244',
    borderWidth: 1,
    marginBottom: 10
  },

  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnSmallTxt: { color: '#e5ecff', fontWeight: '800' },

  meta: { color: '#9fb0c8', fontWeight: '700', marginTop: 2 },

  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  colorPreview: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: '#273244' },
  colorHex: { color: '#9fb0c8', fontWeight: '700' },

  sliderBlock: { marginTop: 10 },
  label: { color: '#cbd5e1', marginBottom: 6, fontWeight: '800' },
  slider: { height: 36, width: '100%' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  padBtn: {
    backgroundColor: '#111827',
    borderColor: '#273244',
    borderWidth: 1,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  padText: { color: '#e5ecff', fontWeight: '900', fontSize: 18 },
});