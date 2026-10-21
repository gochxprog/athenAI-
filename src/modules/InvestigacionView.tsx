import Encabezado from '@/components/ui/Encabezado';
import SinMotor from '@/components/ui/SinMotor';

export default function InvestigacionView() {
  return (
    <div className="space-y-4">
      <Encabezado modulo="Investigación" titulo="Red de hipótesis" descripcion="Las ideas que la plataforma encuentre sola (con el Etiquetador, los Patrones y el machine learning), unidas por los datos que usan, y su paso por el Juez." />
      <SinMotor titulo="Hipótesis" motor="Selección de Features, Patrones y modelos (bloque de machine learning)">
        <p>Cuando existan, cada hipótesis será una idea real sacada de tus datos grabados: qué Features la sostienen, qué dijo el Juez y en qué estado está (nueva, en prueba, aprobada o rechazada).</p>
        <p className="mt-1">Mientras tanto, el Etiquetador ya prepara los ejemplos de entrenamiento: Laboratorio → Etiquetador.</p>
      </SinMotor>
    </div>
  );
}
