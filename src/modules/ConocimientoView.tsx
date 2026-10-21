import Encabezado from '@/components/ui/Encabezado';
import SinMotor from '@/components/ui/SinMotor';
import { useFeeds } from '@/components/orderflow/OrderFlowChart';
import { num } from '@/lib/format';

export default function ConocimientoView() {
  const { feeds } = useFeeds();
  const filas = feeds.feeds.reduce((a, f) => a + f.filas, 0);
  return (
    <div className="space-y-4">
      <Encabezado modulo="Conocimiento" titulo="Patrones del mercado" descripcion="Momentos parecidos agrupados a partir de tus datos grabados y qué pasó después de cada grupo." />
      <SinMotor titulo="Patrones" motor="Patrones (agrupa momentos parecidos de tus datos)">
        <p>Este motor agrupará las ventanas de tus barras grabadas por su huella (dirección, volatilidad, agresión, absorción, OI, liquidaciones) y mostrará cada patrón con cuántas veces aparece y qué pasó después.</p>
        <p className="mt-1">Barras de Features en esta sesión: {num(filas)}. La memoria del mercado (día gemelo, «hoy es distinto») ya funciona en Order Flow → Memoria.</p>
      </SinMotor>
    </div>
  );
}
