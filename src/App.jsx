import { useState } from 'react';
import { Shield, Wrench, Thermometer, Droplets, ScrollText, LayoutDashboard, Lock, HardHat, Settings, LogOut, FlaskConical, ClipboardCheck } from 'lucide-react';
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
import UpdateBanner from './components/UpdateBanner.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'operator', label: 'Operator', icon: HardHat },
  { id: 'pm', label: 'PM', icon: Wrench },
  { id: 'calibration', label: 'Calibration', icon: Thermometer },
  { id: 'sanitation', label: 'Sanitation', icon: Droplets },
  { id: 'chemicals', label: 'Chemicals', icon: FlaskConical },
  { id: 'loto', label: 'LOTO', icon: Lock },
  { id: 'equipment', label: 'Equipment', icon: Shield },
  { id: 'hygienic', label: 'Design', icon: ClipboardCheck },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings, adminOnly: true },
];

function App() {
  const { user, loading, login, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const path = window.location.pathname;

  if (path === '/submit') {
    return <><SubmitWorkOrder /><UpdateBanner /></>;
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

    if (!user) {
      return <LoginScreen onLogin={login} />;
    }

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

  const visibleTabs = TABS.filter(t => !t.adminOnly || user.role === 'admin');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center">
                <Shield size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Powder Ops FSQA</h1>
                <p className="text-xs text-gray-500">Compliance & Preventive Maintenance</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <nav className="hidden md:flex gap-1 bg-gray-100 rounded-lg p-1">
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <tab.icon size={15} />
                    <span className="hidden lg:inline">{tab.label}</span>
                  </button>
                ))}
              </nav>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 hidden sm:inline">{user.name}</span>
                <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </div>
          {/* Mobile nav */}
          <nav className="md:hidden flex gap-1 mt-2 overflow-x-auto pb-1">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-powder-600 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                <tab.icon size={13} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'dashboard' && <ComplianceDashboard />}
        {activeTab === 'operator' && <OperatorView />}
        {activeTab === 'pm' && <PMPanel />}
        {activeTab === 'calibration' && <CalibrationPanel />}
        {activeTab === 'sanitation' && <SanitationPanel />}
        {activeTab === 'chemicals' && <ChemicalsPanel />}
        {activeTab === 'loto' && <LOTOPanel />}
        {activeTab === 'equipment' && <EquipmentPanel />}
        {activeTab === 'hygienic' && <HygienicDesignPanel />}
        {activeTab === 'audit' && <AuditLogPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>
      <UpdateBanner />
    </div>
  );
}

export default App;
