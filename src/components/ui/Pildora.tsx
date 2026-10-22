import { memo } from 'react';
import { motion } from 'framer-motion';

/**
 * Píldora animada de la pestaña elegida (motion + layoutId). Va aparte y con `memo`: si se vuelve a dibujar con cada
 * precio (5 veces por segundo), framer-motion mide toda la página cada vez y la plataforma se traba.
 */
const Pildora = memo(function Pildora({ id, className, rigidez = 400 }: { id: string; className: string; rigidez?: number }) {
  return <motion.span layoutId={id} className={className} transition={{ type: 'spring', stiffness: rigidez, damping: 34 }} />;
});

export default Pildora;
