export async function sendWled(host, payload) {
  const base = String(host || "").replace(/\/$/, "");
  const url = `${base}/json/state`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WLED HTTP ${res.status} ${text}`);
  }

  // WLED suele responder JSON; por si responde vacío:
  try {
    return await res.json();
  } catch {
    return null;
  }
}
