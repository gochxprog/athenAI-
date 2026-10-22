import { lazy, Suspense, useEffect, useState } from 'react';
import Shell from './Shell';
import Panel from './pantallas/Panel';
import { TODAS, type IdPantalla } from './menu';

const Laboratorio = lazy(() => import('./pantallas/laboratorio/Laboratorio'));
const Biblioteca = lazy(() => import('./pantallas/biblioteca/Biblioteca'));
const Paper = lazy(() => import('./pantallas/paper/Paper'));
const Mercado = lazy(() => import('./pantallas/mercado/Mercado'));
const Datos = lazy(() => import('./pantallas/sistema/Datos'));
const Sistema = lazy(() => import('./pantallas/sistema/Sistema'));
const Diario = lazy(() => import('./pantallas/diario/Diario'));

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
      <Suspense fallback={null}>{pantalla === 'laboratorio' ? <Laboratorio /> : pantalla === 'biblioteca' ? <Biblioteca /> : pantalla === 'paper' ? <Paper /> : pantalla === 'mercado' ? <Mercado /> : pantalla === 'datos' ? <Datos /> : pantalla === 'sistema' ? <Sistema /> : pantalla === 'diario' ? <Diario /> : <Panel />}</Suspense>
    </Shell>
  );
}
