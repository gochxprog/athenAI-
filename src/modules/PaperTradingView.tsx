import Encabezado from '@/components/ui/Encabezado';
import SinMotor from '@/components/ui/SinMotor';

export default function PaperTradingView() {
  return (
    <div className="space-y-4">
      <Encabezado modulo="Paper Trading" titulo="Bots en Paper (sin dinero real)" descripcion="Las estrategias aprobadas por el Juez operan sin dinero real sobre el mercado real de Binance, vigiladas por el Guardián." />
      <SinMotor titulo="Bots" motor="Paper Trading (Ejecutor) y Guardián — es el siguiente motor en construcción">
        <p>El Ejecutor convertirá cada estrategia APROBADA para Paper Trading en un bot que opera al precio vivo de Binance, con comisión, deslizamiento según el libro y funding. Cada operación quedará guardada en este navegador.</p>
        <p className="mt-1">El Guardián vigilará la caída máxima, las pérdidas seguidas y la banda P5–P95 del Monte Carlo, con apagado de emergencia y avisos a Discord / Telegram.</p>
      </SinMotor>
    </div>
  );
}
