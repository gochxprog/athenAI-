// Pedidos a la grabadora (misma dirección, con la sesión): GET sin cuerpo, POST con JSON. Errores en español del VPS.
export async function pedir<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(ruta, cuerpo === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const x = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok || x.error) throw new Error(x.error ?? `El VPS respondió ${r.status}`);
  return x;
}
