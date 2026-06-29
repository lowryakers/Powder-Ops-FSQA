import { useState, useEffect, useRef } from 'react';
import { Shield, Wrench, Thermometer, Droplets, ScrollText, LayoutDashboard, Lock, HardHat, Settings, LogOut, FlaskConical, ClipboardCheck, FileWarning, FileText, GraduationCap, Package, Menu, X, ChevronDown } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
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

function Sidebar({ activeTab, setActiveTab, user, collapsed, onClose }) {
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
          const visibleItems = group.items.filter(i => !i.adminOnly || user.role === 'admin');
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
                        {item.label}
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
  const { user, loading, login, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const path = window.location.pathname;

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('app-logout', handler);
    return () => window.removeEventListener('app-logout', handler);
  }, [logout]);

  if (path === '/submit') {
    return <><SubmitWorkOrder /><UpdateBanner /></>;
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
    if (!user) return <LoginScreen onLogin={login} />;
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
    if (!user) return <LoginScreen onLogin={login} />;
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center">
              <Wrench size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-gray-900">Powder Ops</h1>
              <p className="text-xs text-gray-500">{user.department === 'qa' ? 'QA Tasks' : user.department === 'cleaning' ? 'Cleaning Tasks' : 'Maintenance Tasks'}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${user.department === 'qa' ? 'bg-teal-100 text-teal-700' : user.department === 'cleaning' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                {user.department === 'qa' ? 'QA' : user.department === 'cleaning' ? 'CLN' : 'WH'}
              </span>
              <span className="text-xs text-gray-500">{user.name}</span>
              <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">
          <OperatorView />
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
    return <LoginScreen onLogin={login} />;
  }

  const activeItem = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === activeTab);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:block flex-shrink-0 sticky top-0 h-screen">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} onClose={() => {}} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-60 shadow-xl">
            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="md:hidden bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-gray-600">
              <Menu size={22} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-gray-900 truncate">{activeItem?.label || 'Dashboard'}</h1>
            </div>
            <span className="text-xs text-gray-400">{user.name}</span>
            <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-20 md:pb-6 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && <ComplianceDashboard />}
          {activeTab === 'operator' && <OperatorView />}
          {activeTab === 'pm' && <PMPanel />}
          {activeTab === 'calibration' && <CalibrationPanel />}
          {activeTab === 'sanitation' && <SanitationPanel />}
          {activeTab === 'chemicals' && <ChemicalsPanel />}
          {activeTab === 'loto' && <LOTOPanel />}
          {activeTab === 'equipment' && <EquipmentPanel />}
          {activeTab === 'hygienic' && <HygienicDesignPanel />}
          {activeTab === 'capa' && <CAPAPanel />}
          {activeTab === 'sops' && <SOPPanel />}
          {activeTab === 'training' && <TrainingPanel />}
          {activeTab === 'recall' && <MockRecallPanel />}
          {activeTab === 'audit' && <AuditLogPanel />}
          {activeTab === 'settings' && <SettingsPanel />}
        </main>
      </div>

      <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
      <UpdateBanner />
    </div>
  );
}

export default App;
