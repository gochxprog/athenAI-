import { createContext, useContext } from 'react';
import type { Modulo } from '@/types/nav';

export const NavegacionContexto = createContext<(m: Modulo) => void>(() => {});

/** Permite que cualquier tarjeta lleve a otro módulo (mismo historial que el menú). */
export function useNavegar() {
  return useContext(NavegacionContexto);
}
