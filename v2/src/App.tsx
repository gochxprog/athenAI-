import { useEffect, useState } from 'react';
import Shell from './Shell';
import Panel from './pantallas/Panel';
import { TODAS, type IdPantalla } from './menu';

// Ruta en el hash (#/panel). Solo existen las pantallas ya construidas; el resto del menú va con candado.
const leer = (): IdPantalla => {
  const id = location.hash.slice(2) as IdPantalla;
  return TODAS.some((x) => x.id === id && !x.fase) ? id : 'panel';
};

export default function App() {
  const [pantalla, setPantalla] = useState(leer);
  useEffect(() => {
    const f = () => setPantalla(leer());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return (
    <Shell pantalla={pantalla} ir={(id) => (location.hash = `/${id}`)}>
      <Panel />
    </Shell>
  );
}
