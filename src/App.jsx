import { useState } from 'react';
import { Shield, Wrench, ClipboardCheck, Thermometer, Droplets, ScrollText, LayoutDashboard, Lock, HardHat } from 'lucide-react';
import ComplianceDashboard from './components/compliance/ComplianceDashboard.jsx';
import EquipmentPanel from './components/compliance/EquipmentPanel.jsx';
import PMPanel from './components/compliance/PMPanel.jsx';
import ChecklistPanel from './components/compliance/ChecklistPanel.jsx';
import CalibrationPanel from './components/compliance/CalibrationPanel.jsx';
import SanitationPanel from './components/compliance/SanitationPanel.jsx';
import LOTOPanel from './components/compliance/LOTOPanel.jsx';
import AuditLogPanel from './components/compliance/AuditLogPanel.jsx';
import OperatorView from './components/compliance/OperatorView.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'operator', label: 'Operator', icon: HardHat },
  { id: 'pm', label: 'PM', icon: Wrench },
  { id: 'checklists', label: 'Checklists', icon: ClipboardCheck },
  { id: 'calibration', label: 'Calibration', icon: Thermometer },
  { id: 'sanitation', label: 'Sanitation', icon: Droplets },
  { id: 'loto', label: 'LOTO', icon: Lock },
  { id: 'equipment', label: 'Equipment', icon: Shield },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
];

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

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
            <nav className="hidden md:flex gap-1 bg-gray-100 rounded-lg p-1">
              {TABS.map((tab) => (
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
          </div>
          {/* Mobile nav */}
          <nav className="md:hidden flex gap-1 mt-2 overflow-x-auto pb-1">
            {TABS.map((tab) => (
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
        {activeTab === 'checklists' && <ChecklistPanel />}
        {activeTab === 'calibration' && <CalibrationPanel />}
        {activeTab === 'sanitation' && <SanitationPanel />}
        {activeTab === 'loto' && <LOTOPanel />}
        {activeTab === 'equipment' && <EquipmentPanel />}
        {activeTab === 'audit' && <AuditLogPanel />}
      </main>
    </div>
  );
}

export default App;
