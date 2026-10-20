/**
 * Contenedor base de los paneles del Dashboard.
 * `connector` dibuja el punto de anclaje donde llegan/salen las líneas del Cerebro 3D.
 */
export default function Panel({ title, icon: Icon, connector, className = '', children }) {
  return (
    <section className={`glass-panel flex flex-col px-4 py-2.5 ${className}`}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="panel-label truncate">{title}</h3>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-cemento-400" strokeWidth={1.75} aria-hidden />}
      </header>
      {children}
      {connector && (
        <span
          aria-hidden
          className={`absolute top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full border border-cemento-300 bg-black lg:block ${
            connector === 'right' ? '-right-1' : '-left-1'
          }`}
        />
      )}
    </section>
  );
}
