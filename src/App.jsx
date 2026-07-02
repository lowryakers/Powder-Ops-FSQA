import { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, Wrench, Thermometer, Droplets, ScrollText, LayoutDashboard, Lock, HardHat, Settings, LogOut, FlaskConical, ClipboardCheck, FileWarning, FileText, GraduationCap, Package, Menu, X, ChevronDown, Bell, ChevronRight, Factory, CalendarDays, BarChart3 } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useApiGet } from './hooks/useApi';
import LoginScreen from './components/LoginScreen.jsx';
import SubmitWorkOrder from './components/SubmitWorkOrder.jsx';
import ComplianceDashboard from './components/compliance/ComplianceDashboard.jsx';
import EquipmentPanel from './components/compliance/EquipmentPanel.jsx';
import PMPanel from './components/compliance/PMPanel.jsx';
import CalibrationPanel from './components/compliance/CalibrationPanel.jsx';
import SanitationPanel from './components/compliance/SanitationPanel.jsx';
import LOTOPanel from './components/compliance/LOTOPanel.jsx';
import AuditLogPanel from './components/compliance/AuditLogPanel.jsx';
import OperatorView from './components/compliance/OperatorView.jsx';
import SettingsPanel from './components/compliance/SettingsPanel.jsx';
import ChemicalsPanel from './components/compliance/ChemicalsPanel.jsx';
import HygienicDesignPanel from './components/compliance/HygienicDesignPanel.jsx';
import AuditorView from './components/compliance/AuditorView.jsx';
import CAPAPanel from './components/compliance/CAPAPanel.jsx';
import SOPPanel from './components/compliance/SOPPanel.jsx';
import TrainingPanel from './components/compliance/TrainingPanel.jsx';
import MockRecallPanel from './components/compliance/MockRecallPanel.jsx';
import ProductionLog from './components/compliance/ProductionLog.jsx';
import ProductionSchedule from './components/compliance/ProductionSchedule.jsx';
import ProductionDashboard from './components/compliance/ProductionDashboard.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'operator', label: 'Operator View', icon: HardHat },
    ],
  },
  {
    label: 'Production',
    items: [
      { id: 'production-log', label: 'Production Log', icon: Factory },
      { id: 'production-schedule', label: 'Schedule', icon: CalendarDays },
      { id: 'production-dashboard', label: 'Production KPIs', icon: BarChart3 },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { id: 'pm', label: 'Preventive Maintenance', icon: Wrench },
      { id: 'equipment', label: 'Equipment', icon: Shield },
      { id: 'calibration', label: 'Calibration', icon: Thermometer },
      { id: 'loto', label: 'Lockout / Tagout', icon: Lock },
    ],
  },
  {
    label: 'Quality & Safety',
    items: [
      { id: 'sanitation', label: 'Sanitation', icon: Droplets },
      { id: 'chemicals', label: 'Chemicals', icon: FlaskConical },
      { id: 'hygienic', label: 'Hygienic Design', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { id: 'capa', label: 'CAPA / Complaints', icon: FileWarning },
      { id: 'sops', label: 'SOP Registry', icon: FileText },
      { id: 'training', label: 'Training Records', icon: GraduationCap },
      { id: 'recall', label: 'Mock Recall', icon: Package },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'audit', label: 'Audit Log', icon: ScrollText },
      { id: 'settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
];

function Sidebar({ activeTab, setActiveTab, user, collapsed, onClose, badges }) {
  const activeGroup = NAV_GROUPS.find(g => g.items.some(i => i.id === activeTab));
  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {};
    NAV_GROUPS.forEach(g => { initial[g.label] = true; });
    return initial;
  });

  const toggleGroup = (label) => {
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <nav className="h-full flex flex-col bg-white border-r border-gray-200 w-60 overflow-y-auto">
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
        <div className="h-8 w-8 bg-powder-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Shield size={16} className="text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-gray-900 truncate">Powder Ops FSQA</h1>
          <p className="text-[10px] text-gray-400 truncate">Compliance & PM</p>
        </div>
        <button onClick={onClose} className="ml-auto md:hidden text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 py-2 space-y-0.5">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(i => {
            if (i.adminOnly && user.role !== 'admin') return false;
            if (user.role === 'admin') return true;
            if (user.module_access && !user.module_access.includes(i.id)) return false;
            return true;
          });
          if (visibleItems.length === 0) return null;
          const isOpen = openGroups[group.label];
          const hasActive = visibleItems.some(i => i.id === activeTab);

          return (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.label)}
                className={`w-full flex items-center justify-between px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider ${hasActive ? 'text-powder-700' : 'text-gray-400'} hover:text-gray-600`}
              >
                {group.label}
                <ChevronDown size={12} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
              </button>
              {isOpen && (
                <div className="space-y-0.5 pb-1">
                  {visibleItems.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveTab(item.id); onClose?.(); }}
                        className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                          isActive
                            ? 'bg-powder-50 text-powder-700 font-medium border-r-2 border-powder-600'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <item.icon size={16} className={isActive ? 'text-powder-600' : 'text-gray-400'} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {badges?.[item.id] > 0 && (
                          <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
                            {badges[item.id]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-powder-100 flex items-center justify-center text-xs font-bold text-powder-700">
            {(user.name || '?')[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
            <div className="text-[10px] text-gray-400 truncate">{user.role} / {user.department === 'qa' ? 'QA' : user.department === 'cleaning' ? 'Cleaning' : 'Warehouse'}</div>
          </div>
          <button onClick={() => window.dispatchEvent(new CustomEvent('app-logout'))} className="text-gray-400 hover:text-gray-600" title="Sign Out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}

function NotificationBell({ notifications, onNavigate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const items = notifications?.items || [];
  const total = notifications?.total || 0;
  const severityIcon = { critical: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-blue-400' };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative text-gray-500 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
        <Bell size={20} />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5">
            {total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Notifications</h3>
            {total > 0 ? (
              <span className="text-xs text-gray-500">{total} action{total !== 1 ? 's' : ''} needed</span>
            ) : (
              <span className="text-xs text-green-600 font-medium">All clear</span>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">No notifications</div>
            ) : items.map(item => (
              <button key={item.id} onClick={() => { onNavigate(item.tab); setOpen(false); }}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 text-left transition-colors">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityIcon[item.severity]}`} />
                <span className="flex-1 text-sm text-gray-700">{item.label}</span>
                <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileBottomNav({ activeTab, setActiveTab }) {
  const quickTabs = [
    { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
    { id: 'pm', label: 'PM', icon: Wrench },
    { id: 'capa', label: 'CAPA', icon: FileWarning },
    { id: 'sanitation', label: 'Sanitation', icon: Droplets },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-area-bottom">
      <div className="flex">
        {quickTabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                isActive ? 'text-powder-600' : 'text-gray-400'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function App() {
  const { user, loading, login, loginWithToken, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: notifications } = useApiGet('/compliance/notifications', [activeTab, user?.id]);
  const [opLang, setOpLang] = useState(() => localStorage.getItem('op_lang') || 'en');
  const toggleLang = useCallback((lang) => { setOpLang(lang); localStorage.setItem('op_lang', lang); }, []);
  const path = window.location.pathname;

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('app-logout', handler);
    return () => window.removeEventListener('app-logout', handler);
  }, [logout]);

  useEffect(() => {
    const handler = (e) => setActiveTab(e.detail?.tab || 'dashboard');
    window.addEventListener('app-navigate', handler);
    return () => window.removeEventListener('app-navigate', handler);
  }, []);

  if (path === '/submit') {
    return <><SubmitWorkOrder /><UpdateBanner /></>;
  }

  if (path === '/production-entry') {
    if (loading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="h-10 w-10 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
              <Factory size={20} className="text-white" />
            </div>
            <p className="text-gray-500 text-sm">Loading...</p>
          </div>
        </div>
      );
    }
    if (!user) return <LoginScreen onLogin={login} onLoginWithToken={loginWithToken} />;
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="h-9 w-9 bg-green-600 rounded-lg flex items-center justify-center">
              <Factory size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-gray-900">End of Day Report</h1>
              <p className="text-xs text-gray-500">SQF Production Entry</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900">{user.name}</div>
              <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600">Sign Out</button>
            </div>
          </div>
        </header>
        <div className="max-w-3xl mx-auto px-4 py-6">
          <ProductionLog user={user} directEntry />
        </div>
        <UpdateBanner />
      </div>
    );
  }

  if (path === '/auditor') {
    if (loading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="h-10 w-10 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
              <Shield size={20} className="text-white" />
            </div>
            <p className="text-gray-500 text-sm">Loading...</p>
          </div>
        </div>
      );
    }
    if (!user) return <LoginScreen onLogin={login} onLoginWithToken={loginWithToken} />;
    return <><AuditorView /><UpdateBanner /></>;
  }

  if (path === '/operator') {
    if (loading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="h-10 w-10 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
              <Wrench size={20} className="text-white" />
            </div>
            <p className="text-gray-500 text-sm">Loading...</p>
          </div>
        </div>
      );
    }
    if (!user) return <LoginScreen onLogin={login} onLoginWithToken={loginWithToken} />;
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center">
              <Wrench size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-gray-900">Powder Ops</h1>
              <p className="text-xs text-gray-500">{{ qa: 'QA Tasks', cleaning: 'Cleaning Tasks', maintenance: 'Maintenance Tasks', warehouse: 'Warehouse Tasks' }[user.department] || 'My Tasks'}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => toggleLang('en')}
                  className={`px-2 py-1 text-[10px] font-bold transition-colors ${opLang === 'en' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  EN
                </button>
                <button onClick={() => toggleLang('es')}
                  className={`px-2 py-1 text-[10px] font-bold transition-colors ${opLang === 'es' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  ES
                </button>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${{ qa: 'bg-teal-100 text-teal-700', cleaning: 'bg-amber-100 text-amber-700', maintenance: 'bg-violet-100 text-violet-700', warehouse: 'bg-indigo-100 text-indigo-700' }[user.department] || 'bg-gray-100 text-gray-700'}`}>
                {{ qa: 'QA', cleaning: 'CLN', maintenance: 'MNT', warehouse: 'WH' }[user.department] || user.department?.toUpperCase()}
              </span>
              <span className="text-xs text-gray-500">{user.name}</span>
              <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">
          <OperatorView lang={opLang} />
        </main>
        <UpdateBanner />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            <Shield size={24} className="text-white" />
          </div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={login} onLoginWithToken={loginWithToken} />;
  }

  // Determine effective accessible modules for this user
  const allModuleIds = NAV_GROUPS.flatMap(g => g.items).filter(i => !i.adminOnly || user.role === 'admin').map(i => i.id);
  const effectiveModules = user.role === 'admin' ? allModuleIds : (user.module_access || allModuleIds);
  const operatorOnly = effectiveModules.length === 1 && effectiveModules[0] === 'operator';

  // If user only has operator view access, render the standalone operator layout
  if (operatorOnly) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center">
              <Wrench size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-gray-900">Powder Ops</h1>
              <p className="text-xs text-gray-500">{{ qa: 'QA Tasks', cleaning: 'Cleaning Tasks', maintenance: 'Maintenance Tasks', warehouse: 'Warehouse Tasks' }[user.department] || 'My Tasks'}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => toggleLang('en')}
                  className={`px-2 py-1 text-[10px] font-bold transition-colors ${opLang === 'en' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  EN
                </button>
                <button onClick={() => toggleLang('es')}
                  className={`px-2 py-1 text-[10px] font-bold transition-colors ${opLang === 'es' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                  ES
                </button>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${{ qa: 'bg-teal-100 text-teal-700', cleaning: 'bg-amber-100 text-amber-700', maintenance: 'bg-violet-100 text-violet-700', warehouse: 'bg-indigo-100 text-indigo-700' }[user.department] || 'bg-gray-100 text-gray-700'}`}>
                {{ qa: 'QA', cleaning: 'CLN', maintenance: 'MNT', warehouse: 'WH' }[user.department] || user.department?.toUpperCase()}
              </span>
              <span className="text-xs text-gray-500">{user.name}</span>
              <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">
          <OperatorView lang={opLang} />
        </main>
        <UpdateBanner />
      </div>
    );
  }

  // Show first accessible module if current tab isn't accessible
  const resolvedTab = effectiveModules.includes(activeTab) ? activeTab : (effectiveModules[0] || 'dashboard');
  const activeItem = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === resolvedTab);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:block flex-shrink-0 sticky top-0 h-screen">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} onClose={() => {}} badges={notifications?.badges} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-60 shadow-xl">
            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} onClose={() => setSidebarOpen(false)} badges={notifications?.badges} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Desktop top bar */}
        <header className="hidden md:block bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-6 lg:px-8 py-2.5 flex items-center justify-between max-w-7xl mx-auto">
            <h1 className="text-sm font-semibold text-gray-700">{activeItem?.label || 'Dashboard'}</h1>
            <div className="flex items-center gap-3">
              <NotificationBell notifications={notifications} onNavigate={setActiveTab} />
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-powder-100 flex items-center justify-center text-xs font-bold text-powder-700">
                  {(user.name || '?')[0]}
                </div>
                <span className="text-sm text-gray-600">{user.name}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile top bar */}
        <header className="md:hidden bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-gray-600">
              <Menu size={22} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-gray-900 truncate">{activeItem?.label || 'Dashboard'}</h1>
            </div>
            <NotificationBell notifications={notifications} onNavigate={setActiveTab} />
            <span className="text-xs text-gray-400">{user.name}</span>
            <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-20 md:pb-6 max-w-7xl w-full mx-auto">
          {resolvedTab === 'dashboard' && <ComplianceDashboard />}
          {resolvedTab === 'operator' && <OperatorView />}
          {resolvedTab === 'production-log' && <ProductionLog user={user} />}
          {resolvedTab === 'production-schedule' && <ProductionSchedule user={user} />}
          {resolvedTab === 'production-dashboard' && <ProductionDashboard />}
          {resolvedTab === 'pm' && <PMPanel />}
          {resolvedTab === 'calibration' && <CalibrationPanel />}
          {resolvedTab === 'sanitation' && <SanitationPanel />}
          {resolvedTab === 'chemicals' && <ChemicalsPanel />}
          {resolvedTab === 'loto' && <LOTOPanel />}
          {resolvedTab === 'equipment' && <EquipmentPanel />}
          {resolvedTab === 'hygienic' && <HygienicDesignPanel />}
          {resolvedTab === 'capa' && <CAPAPanel />}
          {resolvedTab === 'sops' && <SOPPanel />}
          {resolvedTab === 'training' && <TrainingPanel />}
          {resolvedTab === 'recall' && <MockRecallPanel />}
          {resolvedTab === 'audit' && <AuditLogPanel />}
          {resolvedTab === 'settings' && <SettingsPanel />}
        </main>
      </div>

      <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
      <UpdateBanner />
    </div>
  );
}

export default App;
