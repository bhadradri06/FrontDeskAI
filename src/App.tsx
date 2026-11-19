import { useCallback, useEffect, useState } from 'react';
import { TopNav } from './components/TopNav';
import { ClinicSettingsPage } from './pages/ClinicSettingsPage';
import { PatientChatPage } from './pages/PatientChatPage';
import { StaffDashboardPage } from './pages/StaffDashboardPage';

function normalizePath(pathname: string): string {
  if (pathname.startsWith('/staff/settings/clinic')) return '/staff/settings/clinic';
  if (pathname.startsWith('/staff')) return '/staff';
  return '/';
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    normalizePath(window.location.pathname)
  );

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((target: string) => {
    const normalized = normalizePath(target);
    if (normalized !== window.location.pathname) {
      window.history.pushState({}, '', normalized);
    }
    setCurrentPath(normalized);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopNav currentPath={currentPath} onNavigate={navigate} />
      <main className="flex-1">
        {currentPath === '/' && <PatientChatPage />}
        {currentPath === '/staff' && <StaffDashboardPage onNavigate={navigate} />}
        {currentPath === '/staff/settings/clinic' && <ClinicSettingsPage onNavigate={navigate} />}
      </main>
    </div>
  );
}
