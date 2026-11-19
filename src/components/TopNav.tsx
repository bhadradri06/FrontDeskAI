interface TopNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  actionLabel?: string;
  onAction?: () => void;
}

export function TopNav({ currentPath, onNavigate, actionLabel, onAction }: TopNavProps) {
  const isPatient = currentPath === '/';
  const isStaff = currentPath === '/staff';
  const isClinicSettings = currentPath === '/staff/settings/clinic';

  return (
    <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onNavigate('/');
        }}
        className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
      >
        FrontDesk AI
      </a>

      {/* Zone 2: Concise single-line navigation links */}
      <nav aria-label="Primary navigation" className="flex items-center gap-4 sm:gap-6 text-sm font-medium">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/');
          }}
          className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
            isPatient
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Patient Chat
        </a>
        <a
          href="/staff"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/staff');
          }}
          className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
            isStaff
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Staff Desk
        </a>
        <a
          href="/staff/settings/clinic"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/staff/settings/clinic');
          }}
          className={`hidden sm:inline-block whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
            isClinicSettings
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Clinic Data
        </a>
      </nav>

      {/* Zone 3: Single contextual primary action */}
      <div className="shrink-0">
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="min-h-[38px] px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {actionLabel}
          </button>
        ) : (
          <a
            href="/staff"
            onClick={(e) => {
              e.preventDefault();
              onNavigate(isPatient ? '/staff' : '/');
            }}
            className="inline-flex items-center min-h-[38px] px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {isPatient ? 'Staff Portal' : 'Open Chat'}
          </a>
        )}
      </div>
    </header>
  );
}
