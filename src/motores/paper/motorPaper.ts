// Motor de Paper Trading: une el flujo en vivo del motor (1 vez por segundo), las señales de las estrategias
// (Python, al cerrar cada barra), el Ejecutor y el Guardián. Vive mientras la app esté abierta.
//
// Ciclo de cada bot:
//   · cada segundo: Guardián (conexión, caída del día, cambio de día), funding y capital en vivo;
//   · cada barra nueva de su mercado: se pide la señal de la estrategia. El bot solo actúa cuando la señal CAMBIA
//     (entra en la siguiente entrada; no se sube a una posición que la estrategia abrió antes).
import type { Aviso } from '../notificaciones/canales';
import type { EstadoFeed } from '../worker/protocolo';
import type { EstrategiaEnVivo, SenalEstrategia } from '../laboratorio/protocolo';
import type { Combo } from '../juez/juez';
import type { Costos } from '../juez/costos';
import type { Proveedor } from '../almacen/almacen';
import { anotarCurva, anotarOperacion, aplicarFunding, cerrar, equity, precioMedio, rebalancear, type Bot, type MercadoVivo, type MotivoCierre, type OperacionPaper } from './ejecutor';
import { exposicionMaxima, fechaUtc, REGLAS_POR_DEFECTO, revisar, revisarOperacion, type ReglasGuardian } from './guardian';
import type { AlmacenPaper } from './almacenPaper';

export interface DepsPaper {
  senales: (xs: EstrategiaEnVivo[]) => Promise<SenalEstrategia[]>;
  avisar: (a: Aviso) => void;
  reloj: () => number;
  almacen: AlmacenPaper;
  local?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface EventoPaper {
  t: number;
  botId: string;
  nombre: string;
  texto: string;
  grave: boolean;
}

export interface NuevoBot {
  nombre: string;
  estrategiaId: string;
  codigo: string;
  combo: Combo;
  proveedor: Proveedor;
  simbolo: string;
  veredicto: string;
  score: number | null;
  capital: number;
  exposicion: number;
  costos: Costos;
  retornosJuez: number[];
}

const CLAVE_LOCAL = 'athenai.paper';
/** Más tiempo que esto sin actualizar (app cerrada) con una posición abierta = hueco: se cierra al volver. */
export const HUECO_MS = 60_000;
const GUARDAR_CADA_MS = 10_000;

const precioTxt = (v: number) => v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const claveMercado = (proveedor: string, simbolo: string) => `${proveedor}:${simbolo}`;

export function mercadoDe(f: EstadoFeed, t: number): MercadoVivo {
  const r = f.resumen;
  return { t, bid: r.bid, ask: r.ask, precio: f.precio ?? r.precio, atr: r.atr, libro10: r.libro10, fundingTasa: r.fundingTasa, enVivo: f.conexion === 'en-vivo' };
}

export class MotorPaper {
  bots: Bot[] = [];
  apagado = false;
  reglas: ReglasGuardian = REGLAS_POR_DEFECTO;
  bitacora: EventoPaper[] = [];
  cargado = false;
  private feeds: EstadoFeed[] = [];
  private mercados = new Map<string, MercadoVivo>();
  private filasVistas = new Map<string, number>();
  private pendientes = new Set<string>();
  private pidiendo: Promise<void> | null = null;
  private guardadoEn = new Map<string, number>();
  private oyentes = new Set<() => void>();

  constructor(private readonly deps: DepsPaper) {
    try {
      const x = JSON.parse(deps.local?.getItem(CLAVE_LOCAL) ?? 'null') as { apagado?: boolean; reglas?: Partial<ReglasGuardian> } | null;
      if (x) {
        this.apagado = !!x.apagado;
        this.reglas = { ...REGLAS_POR_DEFECTO, ...x.reglas };
      }
    } catch {
      // Valores por defecto.
    }
  }

  async cargar(): Promise<void> {
    this.bots = (await this.deps.almacen.leerBots()).sort((a, b) => a.creado - b.creado);
    const ahora = this.deps.reloj();
    for (const b of this.bots) if (b.posicion && ahora - b.ultimaActualizacion > HUECO_MS) b.hueco = true;
    this.cargado = true;
    this.avisarOyentes();
  }

  suscribir(o: () => void): () => void {
    this.oyentes.add(o);
    return () => this.oyentes.delete(o);
  }

  private avisarOyentes(): void {
    for (const o of this.oyentes) o();
  }

  private guardarLocal(): void {
    try {
      this.deps.local?.setItem(CLAVE_LOCAL, JSON.stringify({ apagado: this.apagado, reglas: this.reglas }));
    } catch {
      // Almacenamiento bloqueado: vale para esta sesión.
    }
  }

  operaciones(botId?: string): Promise<OperacionPaper[]> {
    return this.deps.almacen.leerOperaciones(botId);
  }

  mercado(b: Bot): MercadoVivo | null {
    return this.mercados.get(claveMercado(b.proveedor, b.simbolo)) ?? null;
  }

  feed(b: Bot): EstadoFeed | null {
    return this.feeds.find((f) => f.proveedor === b.proveedor && f.simbolo === b.simbolo) ?? null;
  }

  private anotar(b: Bot, texto: string, grave = false, avisar = true): void {
    const t = this.deps.reloj();
    this.bitacora = [{ t, botId: b.id, nombre: b.nombre, texto, grave }, ...this.bitacora].slice(0, 200);
    if (avisar) this.deps.avisar({ tipo: 'bot', clave: `bot:${b.id}:${texto.slice(0, 60)}:${t}`, titulo: `Bot «${b.nombre}» · ${b.simbolo}`, texto, prioridad: grave ? 'alta' : 'normal' });
  }

  private async guardar(b: Bot, forzar = true): Promise<void> {
    const ahora = this.deps.reloj();
    if (!forzar && ahora - (this.guardadoEn.get(b.id) ?? 0) < GUARDAR_CADA_MS) return;
    this.guardadoEn.set(b.id, ahora);
    await this.deps.almacen.guardarBot(b);
  }

  setReglas(r: Partial<ReglasGuardian>): void {
    this.reglas = { ...this.reglas, ...r };
    this.guardarLocal();
    this.avisarOyentes();
  }

  async crearBot(d: NuevoBot): Promise<Bot> {
    const max = exposicionMaxima(d.veredicto);
    if (!max) throw new Error(`El Juez no la aprobó (${d.veredicto || 'sin veredicto'}): no puede tener bot.`);
    if (!(d.capital > 0)) throw new Error('El capital tiene que ser mayor que 0.');
    if (this.apagado) throw new Error('El apagado de emergencia está activo: rearma el sistema primero.');
    const t = this.deps.reloj();
    const b: Bot = {
      id: `bot-${t}-${Math.round(Math.random() * 1e4)}`,
      nombre: d.nombre,
      estrategiaId: d.estrategiaId,
      codigo: d.codigo,
      combo: d.combo,
      proveedor: d.proveedor,
      simbolo: d.simbolo,
      creado: t,
      veredicto: d.veredicto,
      score: d.score,
      exposicion: Math.min(max, Math.max(0.01, d.exposicion)),
      capitalInicial: d.capital,
      capital: d.capital,
      posicion: null,
      estado: 'activo',
      motivo: 'Esperando la próxima entrada de la estrategia.',
      costos: d.costos,
      retornosJuez: d.retornosJuez.slice(-300),
      dia: { fecha: fechaUtc(t), pico: d.capital },
      pausadoDia: null,
      perdidasSeguidas: 0,
      operaciones: 0,
      retornoUnidadAcum: 0,
      ultimoFundingT: t,
      ultimaSenalT: null,
      ultimaSenal: null,
      ultimoPrecio: null,
      hueco: false,
      ultimaActualizacion: t,
      curva: [{ t, e: d.capital }],
    };
    this.bots.push(b);
    await this.guardar(b);
    this.pendientes.add(claveMercado(b.proveedor, b.simbolo));
    this.anotar(b, `Bot creado: ${b.capital.toLocaleString('es-ES')} USD, exposición ${b.exposicion}×.`);
    this.avisarOyentes();
    return b;
  }

  private async cerrarYRegistrar(b: Bot, motivo: MotivoCierre, m: MercadoVivo | null, revisarReglas: boolean): Promise<void> {
    if (!b.posicion) return;
    const t = this.deps.reloj();
    const op = cerrar(b, m ?? { t, bid: null, ask: null, precio: b.ultimoPrecio, atr: null, libro10: null, fundingTasa: null, enVivo: false }, motivo);
    if (op) await this.registrar(b, op, revisarReglas);
  }

  private async registrar(b: Bot, op: OperacionPaper, revisarReglas = true): Promise<void> {
    anotarOperacion(b, op);
    op.id = await this.deps.almacen.agregarOperacion(op);
    const signo = op.pnl >= 0 ? '+' : '−';
    this.anotar(b, `Cierra ${op.lado > 0 ? 'largo' : 'corto'} a ${precioTxt(op.precioSalida)}: ${signo}${precioTxt(Math.abs(op.pnl))} USD (${signo}${precioTxt(Math.abs(op.retorno * 100))} %)${op.motivo !== 'senal' ? ` · motivo: ${op.motivo}` : ''}.`);
    if (!revisarReglas || b.estado !== 'activo') return;
    const acc = revisarOperacion(b, this.reglas);
    if (acc) {
      b.estado = acc.tipo;
      b.motivo = acc.texto;
      this.anotar(b, acc.texto, true);
      await this.cerrarYRegistrar(b, 'guardian', this.mercado(b), false);
    }
  }

  async pausar(id: string): Promise<void> {
    const b = this.bots.find((x) => x.id === id);
    if (!b) return;
    await this.cerrarYRegistrar(b, 'manual', this.mercado(b), false);
    b.estado = 'pausado';
    b.motivo = 'Pausado por ti.';
    this.anotar(b, 'Pausado por ti.', false, false);
    await this.guardar(b);
    this.avisarOyentes();
  }

  async reanudar(id: string): Promise<void> {
    const b = this.bots.find((x) => x.id === id);
    if (!b || this.apagado) return;
    if (b.estado === 'cuarentena') b.perdidasSeguidas = 0;
    b.estado = 'activo';
    b.motivo = 'Esperando la próxima entrada de la estrategia.';
    b.ultimaSenal = null;
    b.pausadoDia = null;
    this.pendientes.add(claveMercado(b.proveedor, b.simbolo));
    this.anotar(b, 'Reanudado por ti.', false, false);
    await this.guardar(b);
    this.avisarOyentes();
  }

  async borrar(id: string): Promise<void> {
    const b = this.bots.find((x) => x.id === id);
    if (!b) return;
    this.bots = this.bots.filter((x) => x.id !== id);
    await this.deps.almacen.borrarBot(id);
    this.avisarOyentes();
  }

  /** Apagado de emergencia: cierra todas las posiciones al precio de ahora y apaga todos los bots. */
  async apagarTodo(): Promise<void> {
    this.apagado = true;
    this.guardarLocal();
    for (const b of this.bots) {
      await this.cerrarYRegistrar(b, 'apagado', this.mercado(b), false);
      b.estado = 'apagado';
      b.motivo = 'Apagado de emergencia.';
      await this.guardar(b);
    }
    this.bitacora = [{ t: this.deps.reloj(), botId: '', nombre: 'Guardián', texto: 'Apagado de emergencia: todas las posiciones cerradas y todos los bots apagados.', grave: true }, ...this.bitacora];
    this.deps.avisar({ tipo: 'bot', clave: `apagado:${this.deps.reloj()}`, titulo: 'Apagado de emergencia', texto: 'Todas las posiciones de Paper cerradas y todos los bots apagados.', prioridad: 'alta' });
    this.avisarOyentes();
  }

  /** Quita el apagado de emergencia. Los bots siguen apagados hasta que reanudes cada uno. */
  rearmar(): void {
    this.apagado = false;
    this.guardarLocal();
    this.avisarOyentes();
  }

  /** Llamado con cada resumen de los feeds (1 vez por segundo). */
  alFeeds(feeds: readonly EstadoFeed[]): Promise<void> {
    this.feeds = [...feeds];
    const ahora = this.deps.reloj();
    for (const f of feeds) {
      const k = claveMercado(f.proveedor, f.simbolo);
      this.mercados.set(k, mercadoDe(f, ahora));
      const previas = this.filasVistas.get(k);
      if (previas !== undefined && f.filas !== previas) this.pendientes.add(k);
      this.filasVistas.set(k, f.filas);
    }
    return this.revisarTodos(ahora);
  }

  private async revisarTodos(ahora: number): Promise<void> {
    if (!this.cargado) return;
    for (const b of this.bots) await this.revisarBot(b, ahora);
    if (this.pendientes.size && !this.pidiendo) {
      const claves = new Set(this.pendientes);
      this.pendientes.clear();
      // No se espera: Python puede tardar y el Guardián sigue revisando cada segundo mientras tanto.
      this.pidiendo = this.procesarSenales(claves)
        .catch((e) => {
          this.bitacora = [{ t: this.deps.reloj(), botId: '', nombre: 'Ejecutor', texto: `No se pudo calcular la señal: ${e instanceof Error ? e.message : String(e)}`, grave: false }, ...this.bitacora];
        })
        .finally(() => {
          this.pidiendo = null;
          this.avisarOyentes();
        });
    }
    this.avisarOyentes();
  }

  /** Espera a que termine la señal en curso (pruebas). */
  async esperarSenales(): Promise<void> {
    await this.pidiendo;
  }

  private async revisarBot(b: Bot, ahora: number): Promise<void> {
    const m = this.mercado(b);
    const f = this.feed(b);
    const vivo = !!m && m.enVivo && precioMedio(m) !== null;
    if (b.estado === 'apagado' || b.estado === 'pausado' || b.estado === 'cuarentena' || b.estado === 'fuera-de-banda') {
      if (vivo) {
        b.ultimoPrecio = precioMedio(m!);
        anotarCurva(b, ahora, equity(b, m));
      }
      await this.guardar(b, false);
      return;
    }
    const acc = revisar(b, m, equity(b, vivo ? m : null), this.reglas);
    if (acc?.tipo === 'sin-datos') {
      b.estado = 'sin-datos';
      b.motivo = acc.texto;
      if (b.posicion) b.hueco = true;
      this.anotar(b, acc.texto, !!b.posicion);
      await this.guardar(b);
      return;
    }
    if (acc?.tipo === 'datos-vuelven' || acc?.tipo === 'nuevo-dia') {
      b.estado = 'activo';
      b.motivo = '';
      b.pausadoDia = null;
      b.ultimaSenal = null;
      this.anotar(b, acc.texto, false, acc.tipo === 'nuevo-dia');
    }
    if (!vivo) return;
    if (b.hueco) {
      b.hueco = false;
      if (b.posicion) {
        this.anotar(b, 'Hubo un corte de datos con la posición abierta: se cierra ahora (nunca se mantiene a través de un hueco).', true);
        await this.cerrarYRegistrar(b, 'hueco', m, true);
      }
    }
    aplicarFunding(b, m!.t, m!.fundingTasa, precioMedio(m!));
    b.ultimoPrecio = precioMedio(m!);
    b.ultimaActualizacion = ahora;
    const e = equity(b, m);
    anotarCurva(b, ahora, e);
    if (acc?.tipo === 'caida-dia') {
      await this.cerrarYRegistrar(b, 'guardian', m, false);
      b.estado = 'pausado-dia';
      b.pausadoDia = fechaUtc(m!.t);
      b.motivo = acc.texto;
      this.anotar(b, acc.texto, true);
      await this.guardar(b);
      return;
    }
    if (b.estado === 'activo' && f && !f.guardando) b.motivo = 'Este mercado no se está grabando: la estrategia no recibe barras nuevas. Activa el guardado en Datos.';
    await this.guardar(b, false);
  }

  private async procesarSenales(claves: Set<string>): Promise<void> {
    const bots = this.bots.filter((b) => b.estado === 'activo' && !this.apagado && claves.has(claveMercado(b.proveedor, b.simbolo)));
    if (!bots.length) return;
    const xs = await this.deps.senales(bots.map((b) => ({ id: b.id, codigo: b.codigo, combo: b.combo, proveedor: b.proveedor, simbolo: b.simbolo })));
    for (const s of xs) {
      const b = this.bots.find((x) => x.id === s.id);
      if (!b || b.estado !== 'activo' || this.apagado) continue;
      if (s.posicion === null) {
        b.motivo = s.error ?? 'La estrategia no devolvió señal.';
        continue;
      }
      const m = this.mercado(b);
      const primera = b.ultimaSenal === null;
      const cambia = !primera && s.posicion !== b.ultimaSenal;
      b.ultimaSenal = s.posicion;
      b.ultimaSenalT = s.t;
      if (primera) {
        b.motivo = s.posicion !== 0 ? 'La estrategia ya estaba dentro: el bot espera su próxima entrada.' : '';
        await this.guardar(b);
        continue;
      }
      if (!cambia || !m?.enVivo) continue;
      b.motivo = '';
      const antes = b.posicion?.lado ?? 0;
      const ops = rebalancear(b, s.posicion, m);
      for (const op of ops) await this.registrar(b, op);
      if (b.estado !== 'activo') await this.cerrarYRegistrar(b, 'guardian', m, false);
      else if (b.posicion && b.posicion.lado !== antes) this.anotar(b, `Abre ${b.posicion.lado > 0 ? 'largo' : 'corto'} a ${precioTxt(b.posicion.precioEntrada)} · ${(b.posicion.cantidad * b.posicion.precioEntrada).toLocaleString('es-ES', { maximumFractionDigits: 0 })} USD.`);
      await this.guardar(b);
    }
  }
}
