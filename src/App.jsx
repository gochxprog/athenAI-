import { useState } from 'react';
import Sidebar from './components/layout/Sidebar.jsx';
import TopBar from './components/layout/TopBar.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

// Vistas registradas. Cada módulo añade aquí su página.
const VIEWS = {
  dashboard: { title: 'Panel General', Component: DashboardPage },
};

export default function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const { title, Component } = VIEWS[activeView] ?? VIEWS.dashboard;

  return (
    <div className="flex h-full flex-col bg-black">
      <TopBar subtitle={title} />
      <div className="flex min-h-0 flex-1">
        <Sidebar activeId={activeView} onNavigate={setActiveView} />
        <main className="min-w-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <Component />
        </main>
      </div>
    </div>
  );
}
