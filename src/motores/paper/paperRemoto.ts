// Bots de Paper que corren en el VPS (junto a la grabadora): la plataforma solo los muestra y los maneja por la API.
// Misma forma que MotorPaper para que las pantallas no cambien. Se actualiza cada 2 s mientras alguien mira.
import type { Bot, MercadoVivo, OperacionPaper } from './ejecutor';
import type { EventoPaper, NuevoBot } from './motorPaper';
import { REGLAS_POR_DEFECTO, type ReglasGuardian } from './guardian';

/** Lo que necesita de la grabadora (ClienteGrabadora.api). */
export type ApiGrabadora = <T>(ruta: string, cuerpo?: unknown) => Promise<T | null>;

interface EstadoRemotoPaper {
  cargado: boolean;
  apagado: boolean;
  reglas: ReglasGuardian;
  bots: Bot[];
  bitacora: EventoPaper[];
}

export const CADA_MS_REMOTO = 2_000;

export class MotorPaperRemoto {
  bots: Bot[] = [];
  apagado = false;
  reglas: ReglasGuardian = REGLAS_POR_DEFECTO;
  bitacora: EventoPaper[] = [];
  cargado = false;
  /** El VPS respondió (hay bots 24/7 disponibles). */
  disponible = false;
  error: string | null = null;
  private oyentes = new Set<() => void>();
  private reloj: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly api: ApiGrabadora) {}

  suscribir(o: () => void): () => void {
    this.oyentes.add(o);
    if (!this.reloj) this.reloj = setInterval(() => void this.cargar(), CADA_MS_REMOTO);
    return () => {
      this.oyentes.delete(o);
      if (!this.oyentes.size && this.reloj) {
        clearInterval(this.reloj);
        this.reloj = null;
      }
    };
  }

  private avisar(): void {
    for (const o of this.oyentes) o();
  }

  /** Trae el estado de los bots del VPS. Si no hay grabadora o no tiene bots, queda «no disponible». */
  async cargar(): Promise<void> {
    try {
      const e = await this.api<EstadoRemotoPaper>('/api/paper');
      this.disponible = !!e;
      if (e) Object.assign(this, { bots: e.bots, apagado: e.apagado, reglas: e.reglas, bitacora: e.bitacora, cargado: e.cargado });
      this.error = null;
    } catch (err) {
      this.disponible = false;
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.avisar();
  }

  private async accion<T = unknown>(nombre: string, cuerpo: unknown = {}): Promise<T> {
    const r = await this.api<T>(`/api/paper/${nombre}`, cuerpo);
    await this.cargar();
    return r as T;
  }

  async operaciones(botId?: string): Promise<OperacionPaper[]> {
    const r = await this.api<{ operaciones: OperacionPaper[] }>(`/api/paper/operaciones${botId ? `?bot=${encodeURIComponent(botId)}` : ''}`);
    return r?.operaciones ?? [];
  }

  /** En el VPS el precio vivo lo lleva el bot (ultimoPrecio); aquí no hay feed propio. */
  mercado(b: Bot): MercadoVivo | null {
    void b;
    return null;
  }

  async crearBot(d: NuevoBot): Promise<Bot> {
    return (await this.accion<{ bot: Bot }>('crear', d)).bot;
  }

  pausar = (id: string) => this.accion('pausar', { id }).then(() => undefined);
  reanudar = (id: string) => this.accion('reanudar', { id }).then(() => undefined);
  borrar = (id: string) => this.accion('borrar', { id }).then(() => undefined);
  apagarTodo = () => this.accion('apagar').then(() => undefined);
  rearmar = (): void => void this.accion('rearmar');
  setReglas = (r: Partial<ReglasGuardian>): void => {
    this.reglas = { ...this.reglas, ...r };
    this.avisar();
    void this.accion('reglas', r);
  };
}
