// Rithmic (CME, COMEX, NYMEX…) a través de un PUENTE.
//
// Rithmic no permite conectar desde un navegador: su API (R|Protocol) exige un cliente certificado con nombre de
// aplicación aprobado por Rithmic y credenciales que no deben viajar por una página web. El puente es un servicio
// propio (en el VPS) que inicia sesión en Rithmic y re-publica el mercado con el MISMO protocolo que el servidor
// del puente de athenAI (SSE de trades + vista del libro, ver puenteSSE.ts). athenAI le pasa las credenciales una sola vez:
//
//   POST {puente}/api/rithmic/login  { usuario, contrasena, sistema, gateway }  → { ok: true } | { ok: false, mensaje }
//   después: GET {puente}/api/realtime/stream … (protocolo del puente)

export interface CredencialesRithmic {
  usuario: string;
  contrasena: string;
  /** Sistema de Rithmic: "Rithmic Paper Trading", "Rithmic 01", "Apex", "TopstepTrader"… */
  sistema: string;
  /** Gateway: "Chicago Area", "Europe", "Singapore"… */
  gateway: string;
}

export const SISTEMAS_RITHMIC = ['Rithmic Paper Trading', 'Rithmic 01', 'Rithmic Test', 'Apex', 'TopstepTrader', 'Bulenox'];
export const GATEWAYS_RITHMIC = ['Chicago Area', 'Europe', 'Singapore', 'Sydney', 'Tokyo'];

export async function iniciarSesionRithmic(puente: string, c: CredencialesRithmic, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  if (!puente) throw new Error('Falta la URL del puente de Rithmic');
  if (!c.usuario || !c.contrasena) throw new Error('Faltan usuario o contraseña de Rithmic');
  let r: Response;
  try {
    r = await fetchImpl(`${puente.replace(/\/+$/, '')}/api/rithmic/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(c),
    });
  } catch {
    throw new Error(`No hay puente de Rithmic en ${puente}. Rithmic no acepta conexiones directas desde el navegador: hace falta el puente R|Protocol en tu VPS.`);
  }
  const cuerpo = (await r.json().catch(() => ({}))) as { ok?: boolean; mensaje?: string };
  if (!r.ok || cuerpo.ok === false) throw new Error(cuerpo.mensaje ?? `El puente rechazó el inicio de sesión (HTTP ${r.status})`);
}
