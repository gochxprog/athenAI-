import { NAV_SECTIONS } from './navigation.js';

export default function Sidebar({ activeId, onNavigate }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-cemento-700 bg-cemento-900/60 md:flex">
      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="mb-6 last:mb-0">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-label text-cemento-400">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.id}>
                  <NavItem item={item} active={item.id === activeId} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-cemento-700 px-5 py-4 font-mono text-[10px] uppercase tracking-label text-cemento-400">
        Build 4.0.0 · Módulo A
      </div>
    </aside>
  );
}

function NavItem({ item, active, onNavigate }) {
  const Icon = item.icon;
  const base = 'group flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-[13px] transition-colors';
  const state = active
    ? 'bg-cemento-700 text-white shadow-[inset_2px_0_0_0_#fff]'
    : item.implemented
      ? 'text-cemento-200 hover:bg-cemento-800 hover:text-white'
      : 'cursor-default text-cemento-300';

  return (
    <button
      type="button"
      className={`${base} ${state}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => item.implemented && onNavigate(item.id)}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden />
      <span className="truncate">{item.label}</span>
    </button>
  );
}
