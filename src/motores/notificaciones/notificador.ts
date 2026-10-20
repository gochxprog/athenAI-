// Notificador: convierte lo que pasa en la plataforma en avisos a Discord, Telegram y ntfy.
// Vigila los feeds (fallos y recuperación), la memoria del mercado ("hoy es distinto", régimen), el calendario
// (eventos fuertes) y el Juez. Anti-spam por aviso. Mientras la plataforma corra en el navegador, los avisos
// solo salen con la pestaña abierta (24/7 requiere el VPS, Bloque F).
import { canalesActivos, CONFIG_NOTIF_POR_DEFECTO, peticion, peticionArchivo, type Aviso, type Canal, type ConfigNotificaciones } from './canales';
import type { EstadoFeed } from '../worker/protocolo';
import type { EventoCalendario } from '../nucleo/calendario';

export interface EnvioRegistrado {
  t: number;
  aviso: Aviso;
  canal: Canal | null;
  ok: boolean;
  detalle: string;
}

const CLAVE = 'athenai.notificaciones';
/** Un mercado tiene que llevar este tiempo sin datos antes de avisar (evita avisos por microcortes). */
export const GRACIA_FALLO_MS = 30_000;

const NOMBRE_REGIMEN = { rango: 'rango', tendencia: 'tendencia', raro: 'día raro' } as const;

export class Notificador {
  config: ConfigNotificaciones;
  historial: EnvioRegistrado[] = [];
  private oyentes = new Set<() => void>();
  private ultimos = new Map<string, number>();
  // Estado observado (para detectar transiciones).
  private caidos = new Map<string, { desde: number; avisado: boolean }>();
  private distinto = new Map<string, boolean>();
  private regimen = new Map<string, string>();
  private eventosAvisados = new Set<string>();

  constructor(
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly almacen: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
    private readonly reloj: () => number = () => Date.now(),
  ) {
    this.config = this.leer();
  }

  private leer(): ConfigNotificaciones {
    try {
      const x = JSON.parse(this.almacen?.getItem(CLAVE) ?? 'null') as Partial<ConfigNotificaciones> | null;
      if (x) {
        const d = CONFIG_NOTIF_POR_DEFECTO;
        return { ...d, ...x, discord: { ...d.discord, ...x.discord }, telegram: { ...d.telegram, ...x.telegram }, ntfy: { ...d.ntfy, ...x.ntfy }, tipos: { ...d.tipos, ...x.tipos } };
      }
    } catch {
      // Configuración por defecto.
    }
    return CONFIG_NOTIF_POR_DEFECTO;
  }

  guardar(c: ConfigNotificaciones): void {
    this.config = c;
    try {
      this.almacen?.setItem(CLAVE, JSON.stringify(c));
    } catch {
      // Almacenamiento bloqueado: vale para esta sesión.
    }
    this.avisarOyentes();
  }

  suscribir(o: () => void): () => void {
    this.oyentes.add(o);
    return () => this.oyentes.delete(o);
  }

  private avisarOyentes(): void {
    for (const o of this.oyentes) o();
  }

  private registrar(e: EnvioRegistrado): void {
    this.historial = [e, ...this.historial].slice(0, 60);
    this.avisarOyentes();
  }

  /** Envía un aviso por los canales activos (respeta tipos y anti-spam salvo `forzar`). */
  async enviar(a: Aviso, opciones: { forzar?: boolean; solo?: Canal } = {}): Promise<EnvioRegistrado[]> {
    const c = this.config;
    if (!opciones.forzar) {
      if (!c.tipos[a.tipo]) return [];
      const previo = this.ultimos.get(a.clave);
      if (previo !== undefined && this.reloj() - previo < c.antiSpamMin * 60_000) return [];
    }
    const canales = opciones.solo ? [opciones.solo] : canalesActivos(c);
    if (!canales.length) {
      const e = { t: this.reloj(), aviso: a, canal: null, ok: false, detalle: 'Sin canales configurados' };
      if (!opciones.forzar) this.registrar(e);
      return [e];
    }
    this.ultimos.set(a.clave, this.reloj());
    return Promise.all(
      canales.map(async (canal) => {
        let e: EnvioRegistrado;
        try {
          const { url, init } = peticion(canal, c, a);
          const r = await this.fetchImpl(url, init);
          e = { t: this.reloj(), aviso: a, canal, ok: r.ok, detalle: r.ok ? 'Enviado' : `HTTP ${r.status}` };
        } catch (err) {
          e = { t: this.reloj(), aviso: a, canal, ok: false, detalle: err instanceof Error ? err.message : String(err) };
        }
        this.registrar(e);
        return e;
      }),
    );
  }

  /** Envía un archivo (un paper) a todos los canales activos. No usa anti-spam: lo pide el usuario. */
  async enviarArchivo(nombre: string, contenido: string, texto: string): Promise<EnvioRegistrado[]> {
    const aviso: Aviso = { tipo: 'juez', clave: `archivo:${nombre}`, titulo: `Paper: ${nombre}`, texto, prioridad: 'normal' };
    const canales = canalesActivos(this.config);
    if (!canales.length) return [{ t: this.reloj(), aviso, canal: null, ok: false, detalle: 'Sin canales configurados (Centro de datos → Notificaciones)' }];
    return Promise.all(
      canales.map(async (canal) => {
        let e: EnvioRegistrado;
        try {
          const { url, init } = peticionArchivo(canal, this.config, nombre, contenido, texto);
          const r = await this.fetchImpl(url, init);
          e = { t: this.reloj(), aviso, canal, ok: r.ok, detalle: r.ok ? 'Enviado' : `HTTP ${r.status}` };
        } catch (err) {
          e = { t: this.reloj(), aviso, canal, ok: false, detalle: err instanceof Error ? err.message : String(err) };
        }
        this.registrar(e);
        return e;
      }),
    );
  }

  probar(canal: Canal): Promise<EnvioRegistrado[]> {
    return this.enviar({ tipo: 'fallo', clave: `prueba-${this.reloj()}`, titulo: 'Prueba de notificación', texto: 'Si ves esto, athenAI ya puede avisarte aquí: fallos, "hoy es distinto", eventos fuertes, decisiones del Juez y (pronto) bots.', prioridad: 'normal' }, { forzar: true, solo: canal });
  }

  /** Revisa los feeds (llamar cada vez que llegan, ≈ 1 Hz). */
  revisarFeeds(feeds: readonly EstadoFeed[]): void {
    const ahora = this.reloj();
    for (const f of feeds) {
      const id = `${f.proveedor}:${f.simbolo}`;
      const nombre = `${f.simbolo} (${f.proveedor})`;
      // Fallos y recuperación.
      const malo = f.conexion === 'error' || f.conexion === 'reconectando' || f.conexion === 'sin-datos';
      const c = this.caidos.get(id);
      if (malo) {
        if (!c) this.caidos.set(id, { desde: ahora, avisado: false });
        else if (!c.avisado && ahora - c.desde >= GRACIA_FALLO_MS) {
          c.avisado = true;
          void this.enviar({ tipo: 'fallo', clave: `fallo:${id}`, titulo: `${nombre}: sin datos`, texto: `${f.detalle || f.conexion} · desde hace ${Math.round((ahora - c.desde) / 1000)} s. Los datos de este tramo quedan marcados como hueco.`, prioridad: 'alta' });
        }
      } else if (f.conexion === 'en-vivo' && c) {
        this.caidos.delete(id);
        if (c.avisado) void this.enviar({ tipo: 'fallo', clave: `ok:${id}:${ahora}`, titulo: `${nombre}: recuperado`, texto: `Vuelve a recibir datos tras ${Math.round((ahora - c.desde) / 1000)} s sin conexión.`, prioridad: 'normal' });
      }
      // "Hoy es distinto".
      const mem = f.memoria?.memoria;
      if (mem) {
        const antes = this.distinto.get(id) ?? false;
        if (mem.distinto.aviso && !antes) void this.enviar({ tipo: 'riesgo', clave: `distinto:${id}`, titulo: `${f.simbolo}: hoy es distinto`, texto: mem.distinto.motivo, prioridad: 'alta' });
        this.distinto.set(id, mem.distinto.aviso);
      }
      // Cambio de régimen (no se avisa del primero que se calcula).
      const reg = f.memoria?.regimen;
      if (reg) {
        const antes = this.regimen.get(id);
        if (antes && antes !== reg.actual)
          void this.enviar({ tipo: 'regimen', clave: `regimen:${id}:${reg.actual}`, titulo: `${f.simbolo}: régimen ${NOMBRE_REGIMEN[reg.actual]}`, texto: `Pasa de ${NOMBRE_REGIMEN[antes as keyof typeof NOMBRE_REGIMEN] ?? antes} a ${NOMBRE_REGIMEN[reg.actual]} (probabilidad ${Math.round(reg.probabilidades[reg.actual] * 100)} %).`, prioridad: 'normal' });
        this.regimen.set(id, reg.actual);
      }
    }
  }

  /** Revisa el calendario (llamar cada ~30 s): aviso 30 min antes y al entrar en la ventana. */
  revisarCalendario(eventos: readonly EventoCalendario[]): void {
    const ahora = this.reloj();
    for (const e of eventos) {
      if (e.impacto !== 'alto') continue;
      const hora = new Date(e.t).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
      if (ahora >= e.t - 30 * 60_000 && ahora < e.t - e.antesMin * 60_000 && !this.eventosAvisados.has(`${e.id}:previo`)) {
        this.eventosAvisados.add(`${e.id}:previo`);
        void this.enviar({ tipo: 'evento', clave: `evento:${e.id}:previo`, titulo: `${e.nombre} en 30 min`, texto: `${hora}. La ventana de no operar empieza ${e.antesMin} min antes y dura hasta ${e.despuesMin} min después.`, prioridad: 'normal' });
      }
      if (ahora >= e.t - e.antesMin * 60_000 && ahora <= e.t + e.despuesMin * 60_000 && !this.eventosAvisados.has(`${e.id}:ventana`)) {
        this.eventosAvisados.add(`${e.id}:ventana`);
        void this.enviar({ tipo: 'evento', clave: `evento:${e.id}:ventana`, titulo: `${e.nombre}: ventana de no operar`, texto: `${hora}. No operar hasta ${e.despuesMin} min después del evento.`, prioridad: 'alta' });
      }
    }
  }

  /** Decisión del Juez sobre una estrategia. */
  juez(nombre: string, simbolo: string, veredicto: string, resumen: string): void {
    void this.enviar({ tipo: 'juez', clave: `juez:${nombre}:${this.reloj()}`, titulo: `Juez: «${nombre}» ${veredicto}`, texto: `${simbolo} · ${resumen}`, prioridad: veredicto === 'APROBADA' ? 'alta' : 'normal' });
  }

  /** Error grave de la plataforma (motor, guardado…). */
  error(texto: string): void {
    void this.enviar({ tipo: 'fallo', clave: `error:${texto.slice(0, 80)}`, titulo: 'Error en athenAI', texto, prioridad: 'alta' });
  }
}

export const notificador = new Notificador();
