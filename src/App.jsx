import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Shield, Wrench, Thermometer, Droplets, ScrollText, LayoutDashboard, Lock, HardHat, Settings, LogOut, FlaskConical, ClipboardCheck, FileWarning, FileText, GraduationCap, Package, Menu, X, ChevronDown, Bell, ChevronRight, Factory, CalendarDays, BarChart3, TestTubes, ListChecks, BriefcaseBusiness, Network, Trash2, ShieldAlert, PauseCircle, PackageCheck, Scissors, Sparkles, MessageSquare, Home, Search, CalendarClock, Users } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useApiGet, apiPost } from './hooks/useApi';
import { getSocket } from './lib/socket';
import { visibleModuleIds, canViewModule } from './utils/permissions';
import { deptLabel } from './constants/departments';
import LoginScreen from './components/LoginScreen.jsx';
import SubmitWorkOrder from './components/SubmitWorkOrder.jsx';
import KnifeKiosk from './components/kiosk/KnifeKiosk.jsx';
import ComponentKiosk from './components/kiosk/ComponentKiosk.jsx';
import MaintenanceKiosk from './components/kiosk/MaintenanceKiosk.jsx';
import AiAskPanel from './components/compliance/AiAskPanel.jsx';
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
import QualitySchedulesPanel from './components/compliance/QualitySchedulesPanel.jsx';
import TeamActivityPanel from './components/compliance/TeamActivityPanel.jsx';
import AuditorView from './components/compliance/AuditorView.jsx';
import CAPAPanel from './components/compliance/CAPAPanel.jsx';
import DocumentRegistry from './components/compliance/DocumentRegistry.jsx';
import OrgChart from './components/compliance/OrgChart.jsx';
import DisposalsPanel from './components/compliance/DisposalsPanel.jsx';
import QMSRecordsPanel from './components/compliance/QMSRecordsPanel.jsx';
import TrainingPanel from './components/compliance/TrainingPanel.jsx';
import MockRecallPanel from './components/compliance/MockRecallPanel.jsx';
import ProductionLog from './components/compliance/ProductionLog.jsx';
import ProductionSchedule from './components/compliance/ProductionSchedule.jsx';
import ProductionDashboard from './components/compliance/ProductionDashboard.jsx';
import COAPanel from './components/compliance/COAPanel.jsx';
import CommsView from './components/comms/CommsView.jsx';
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
    label: 'Warehouse',
    items: [
      { id: 'component-signout', label: 'Component Sign In/Out', icon: PackageCheck },
      { id: 'maintenance-signout', label: 'Maintenance Sign In/Out', icon: Wrench },
      { id: 'knife-accountability', label: 'Knife / Razor Blade / Scissor', icon: Scissors },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { id: 'pm', label: 'Task Center', icon: Wrench },
      { id: 'equipment', label: 'Equipment', icon: Shield },
      { id: 'calibration', label: 'Calibration', icon: Thermometer },
      { id: 'loto', label: 'Lockout / Tagout', icon: Lock },
    ],
  },
  {
    label: 'Quality',
    items: [
      { id: 'coa', label: 'COA / Lab Testing', icon: TestTubes },
      { id: 'quality-schedules', label: 'Quality Schedules', icon: CalendarClock },
      { id: 'hygienic', label: 'Hygienic Design', icon: ClipboardCheck },
      { id: 'organoleptic', label: 'Organoleptic Sensory', icon: TestTubes },
      { id: 'capa', label: 'CAPA / Complaints', icon: FileWarning },
      { id: 'deviations', label: 'Deviations', icon: FileWarning },
      { id: 'non-conformance', label: 'Non-Conformance', icon: ShieldAlert },
      { id: 'on-hold', label: 'On Hold', icon: PauseCircle },
      { id: 'disposals', label: 'Disposals', icon: Trash2 },
      { id: 'recall', label: 'Mock Recall', icon: Package },
    ],
  },
  {
    label: 'Cleaning',
    items: [
      { id: 'sanitation', label: 'Sanitation', icon: Droplets },
      { id: 'chemicals', label: 'Chemicals', icon: FlaskConical },
    ],
  },
  {
    label: 'Document Control',
    items: [
      { id: 'sops', label: 'SOP Registry', icon: FileText },
      { id: 'work-instructions', label: 'Work Instructions', icon: ListChecks },
      { id: 'job-descriptions', label: 'Job Descriptions', icon: BriefcaseBusiness },
      { id: 'training', label: 'Training Records', icon: GraduationCap },
      { id: 'dcr', label: 'Document Change Requests', icon: ClipboardCheck },
      { id: 'org-chart', label: 'Org Chart', icon: Network },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'ask-ai', label: 'Ask AI', icon: Sparkles, adminOnly: true, aiOnly: true },
      { id: 'team-activity', label: 'Team Activity', icon: Users, adminOnly: true },
      { id: 'audit', label: 'Audit Log', icon: ScrollText },
      { id: 'settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
];

function Sidebar({ activeTab, setActiveTab, user, onClose, badges, scheduleNotice, onOpenComms }) {
  const { data: aiStatus } = useApiGet('/ai/status');
  const { data: commsChannels, refresh: refreshComms } = useApiGet('/comms/channels', [activeTab]);
  const commsUnread = (commsChannels || []).reduce((n, c) => n + (c.unread || 0), 0);
  const aiOn = !!aiStatus?.enabled;

  // Live-update the Messages unread badge when chat activity arrives.
  useEffect(() => {
    const s = getSocket();
    const onChange = () => refreshComms();
    s.on('channels:changed', onChange);
    return () => s.off('channels:changed', onChange);
  }, [refreshComms]);
  // All groups expanded by default — users prefer seeing every module at once.
  // (Groups are still individually collapsible.)
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
          <h1 className="text-sm font-bold text-gray-900 truncate">ReadyDoc</h1>
          <p className="text-[10px] text-gray-400 truncate">Powder Ops · FSQA</p>
        </div>
        <button onClick={onClose} className="ml-auto md:hidden text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>

      <div className="px-2 pt-2">
        <button
          onClick={() => { onOpenComms?.(); onClose?.(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 hover:bg-powder-50 hover:text-powder-700 border border-gray-200 transition-colors"
        >
          <MessageSquare size={16} className="text-powder-600" />
          <span className="flex-1 text-left">Messages</span>
          {commsUnread > 0 && (
            <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
              {commsUnread}
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 py-2 space-y-0.5">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(i => {
            if (i.adminOnly && user.role !== 'admin') return false;
            if (i.aiOnly && !aiOn) return false;
            return canViewModule(user, i.id);
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
                        {item.id === 'production-schedule' && scheduleNotice?.unseen && (
                          <span className="ml-auto flex-shrink-0 h-[18px] flex items-center rounded-full bg-emerald-500 text-white text-[9px] font-bold uppercase tracking-wide px-1.5">
                            {scheduleNotice.kind === 'new' ? 'New' : 'Updated'}
                          </span>
                        )}
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
            <div className="text-[10px] text-gray-400 truncate">{user.role} / {deptLabel(user.department)}</div>
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

// Flatten the nav to the modules this user may actually open (respects role,
// AI availability, and per-module access). Shared by search + mobile quick-tabs.
function accessibleNavItems(user, aiOn) {
  const flat = [];
  for (const g of NAV_GROUPS) {
    for (const i of g.items) {
      if (i.adminOnly && user.role !== 'admin') continue;
      if (i.aiOnly && !aiOn) continue;
      if (!canViewModule(user, i.id)) continue;
      flat.push({ ...i, group: g.label });
    }
  }
  return flat;
}

// Global "jump to a module" command palette. With ~30 modules, hunting through
// the sidebar is the main navigation friction; this lets anyone type a name (or
// press ⌘K / Ctrl-K) and jump straight there. Only shows modules the user can open.
function ModuleSearch({ user, onNavigate }) {
  const { data: aiStatus } = useApiGet('/ai/status');
  const aiOn = !!aiStatus?.enabled;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);

  const items = useMemo(() => accessibleNavItems(user, aiOn), [user, aiOn]);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(i => i.label.toLowerCase().includes(term) || i.group.toLowerCase().includes(term));
  }, [q, items]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { if (open) { setQ(''); setHi(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { setHi(0); }, [q]);

  const choose = (item) => { if (!item) return; onNavigate(item.id); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(true)} title="Search modules (⌘K)"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 text-sm w-48 lg:w-56">
        <Search size={15} />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden lg:inline text-[10px] text-gray-300 border border-gray-200 rounded px-1">⌘K</kbd>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search size={15} className="text-gray-400" />
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); choose(results[hi]); }
              }}
              placeholder="Jump to a module…" className="flex-1 text-sm outline-none bg-transparent" />
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">No matches</div>
            ) : results.map((item, idx) => (
              <button key={item.id} onMouseEnter={() => setHi(idx)} onClick={() => choose(item)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left ${idx === hi ? 'bg-powder-50 text-powder-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                <item.icon size={15} className={idx === hi ? 'text-powder-600' : 'text-gray-400'} />
                <span className="flex-1">{item.label}</span>
                <span className="text-[10px] text-gray-300">{item.group}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const MOBILE_TAB_LABELS = { dashboard: 'Home', operator: 'Operator', pm: 'Tasks', 'production-schedule': 'Schedule', 'production-log': 'Production', capa: 'CAPA', sanitation: 'Sanitation' };

function MobileBottomNav({ activeTab, setActiveTab, user }) {
  // Role-aware quick-tabs: prefer the modules most people use day-to-day, but
  // only ones this user can open, and fall back to their first accessible
  // modules so a warehouse operator gets useful tabs instead of CAPA/Sanitation.
  const quickTabs = useMemo(() => {
    const flat = accessibleNavItems(user, false);
    const byId = Object.fromEntries(flat.map(i => [i.id, i]));
    const preferred = ['dashboard', 'operator', 'pm', 'production-schedule', 'production-log', 'capa', 'sanitation'];
    const picked = [];
    const seen = new Set();
    for (const id of preferred) {
      if (byId[id] && !seen.has(id)) { picked.push(byId[id]); seen.add(id); }
      if (picked.length === 4) break;
    }
    for (const it of flat) {
      if (picked.length === 4) break;
      if (!seen.has(it.id)) { picked.push(it); seen.add(it.id); }
    }
    return picked.slice(0, 4).map(i => ({ id: i.id, label: MOBILE_TAB_LABELS[i.id] || i.label, icon: i.icon }));
  }, [user]);

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

function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('install_dismissed') === '1');

  // iOS Safari never fires beforeinstallprompt — users must add to the home
  // screen manually — so detect it and show step-by-step instructions instead.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const close = () => { setDismissed(true); localStorage.setItem('install_dismissed', '1'); };

  if (dismissed || isStandalone) return null;

  // iOS: instruction card (Share → Add to Home Screen)
  if (isIOS && !deferred) {
    return (
      <div className="fixed bottom-20 md:bottom-4 right-4 left-4 md:left-auto z-50 bg-white border border-gray-200 shadow-lg rounded-xl p-3 max-w-xs md:ml-auto">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center flex-shrink-0"><Shield size={18} className="text-white" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">Add ReadyDoc to Home Screen</p>
            <p className="text-xs text-gray-500">Get an app icon &amp; full-screen mode.</p>
          </div>
          <button onClick={() => setShowIosHelp(s => !s)} className="px-3 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700">{showIosHelp ? 'Hide' : 'How'}</button>
          <button onClick={close} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {showIosHelp && (
          <ol className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-600 space-y-1 list-decimal list-inside">
            <li>Tap the <span className="font-semibold">Share</span> button in Safari&apos;s toolbar.</li>
            <li>Choose <span className="font-semibold">Add to Home Screen</span>.</li>
            <li>Tap <span className="font-semibold">Add</span> — the icon appears on your home screen.</li>
          </ol>
        )}
      </div>
    );
  }

  // Android / desktop Chrome: native install prompt
  if (!deferred) return null;
  return (
    <div className="fixed bottom-20 md:bottom-4 right-4 z-50 bg-white border border-gray-200 shadow-lg rounded-xl p-3 flex items-center gap-3 max-w-xs">
      <div className="h-9 w-9 bg-powder-600 rounded-lg flex items-center justify-center flex-shrink-0"><Shield size={18} className="text-white" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">Install ReadyDoc</p>
        <p className="text-xs text-gray-500">Add to your home screen.</p>
      </div>
      <button onClick={async () => { deferred.prompt(); await deferred.userChoice.catch(() => {}); setDeferred(null); }}
        className="px-3 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700">Install</button>
      <button onClick={close} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
    </div>
  );
}

function App() {
  const { user, loading, login, loginWithToken, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [workspace, setWorkspace] = useState('fsqa');
  const [homePref, setHomePref] = useState('fsqa');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const homeApplied = useRef(false);

  // Apply the user's default landing workspace once, on first load after login.
  useEffect(() => {
    if (!user) { homeApplied.current = false; return; }
    setHomePref(user.home_workspace || 'fsqa');
    if (!homeApplied.current) {
      homeApplied.current = true;
      if (user.home_workspace === 'messages') setWorkspace('comms');
    }
  }, [user]);

  const setHome = useCallback((w) => {
    setHomePref(w);
    apiPost('/users/me/home', { workspace: w }).catch(() => {});
  }, []);
  const { data: notifications, refresh: refreshNotifications } = useApiGet('/compliance/notifications', [activeTab, user?.id]);
  const path = window.location.pathname;

  // Refresh the sidebar notice when the schedule is opened (clears the badge)
  // or an admin publishes it.
  useEffect(() => {
    const handler = () => refreshNotifications();
    window.addEventListener('schedule-notice-changed', handler);
    return () => window.removeEventListener('schedule-notice-changed', handler);
  }, [refreshNotifications]);

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

  if (path === '/kiosk/knife') {
    return <><KnifeKiosk /><UpdateBanner /></>;
  }

  if (path === '/kiosk/components') {
    return <><ComponentKiosk /><UpdateBanner /></>;
  }

  if (path === '/kiosk/maintenance') {
    return <><MaintenanceKiosk /><UpdateBanner /></>;
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
    return <LoginScreen onLogin={login} onLoginWithToken={loginWithToken} />;
  }

  // Messages workspace — full-screen, separable from the FSQA workspace.
  if (workspace === 'comms') {
    return <>
      <CommsView
        user={user}
        onExit={() => setWorkspace('fsqa')}
        onGoToSchedule={canViewModule(user, 'production-schedule') ? () => { setWorkspace('fsqa'); setActiveTab('production-schedule'); } : null}
        homePref={homePref}
        onSetHome={setHome}
      />
      <UpdateBanner />
    </>;
  }

  // Determine effective accessible modules for this user
  const allModuleIds = NAV_GROUPS.flatMap(g => g.items).filter(i => !i.adminOnly || user.role === 'admin').map(i => i.id);
  const effectiveModules = visibleModuleIds(user, allModuleIds);
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
          <OperatorView />
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
        <Sidebar activeTab={resolvedTab} setActiveTab={setActiveTab} user={user} onClose={() => {}} badges={notifications?.badges} scheduleNotice={notifications?.scheduleNotice} onOpenComms={() => setWorkspace('comms')} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-60 shadow-xl">
            <Sidebar activeTab={resolvedTab} setActiveTab={setActiveTab} user={user} onClose={() => setSidebarOpen(false)} badges={notifications?.badges} scheduleNotice={notifications?.scheduleNotice} onOpenComms={() => setWorkspace('comms')} />
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
              <ModuleSearch user={user} onNavigate={setActiveTab} />
              <button onClick={() => setHome('fsqa')} title={homePref === 'fsqa' ? 'ReadyDoc is your home screen' : 'Make ReadyDoc your home screen'}
                className={`p-1.5 rounded-lg transition-colors ${homePref === 'fsqa' ? 'text-powder-600 bg-powder-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                <Home size={18} />
              </button>
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
          {resolvedTab === 'ask-ai' && <AiAskPanel />}
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
          {resolvedTab === 'quality-schedules' && <QualitySchedulesPanel />}
          {resolvedTab === 'hygienic' && <HygienicDesignPanel />}
          {resolvedTab === 'coa' && <COAPanel />}
          {resolvedTab === 'capa' && <CAPAPanel />}
          {resolvedTab === 'sops' && <DocumentRegistry docType="sop" moduleId="sops" title="SOP Registry" typeLabel="SOP" />}
          {resolvedTab === 'work-instructions' && <DocumentRegistry docType="work_instruction" moduleId="work-instructions" title="Work Instructions" typeLabel="Work Instruction" />}
          {resolvedTab === 'job-descriptions' && <DocumentRegistry docType="job_description" moduleId="job-descriptions" title="Job Descriptions" typeLabel="Job Description" />}
          {resolvedTab === 'org-chart' && <OrgChart />}
          {resolvedTab === 'disposals' && <DisposalsPanel />}
          {resolvedTab === 'dcr' && <QMSRecordsPanel recordType="document_change_request" moduleId="dcr" />}
          {resolvedTab === 'deviations' && <QMSRecordsPanel recordType="deviation" moduleId="deviations" />}
          {resolvedTab === 'non-conformance' && <QMSRecordsPanel recordType="non_conformance" moduleId="non-conformance" />}
          {resolvedTab === 'on-hold' && <QMSRecordsPanel recordType="on_hold" moduleId="on-hold" />}
          {resolvedTab === 'component-signout' && <QMSRecordsPanel recordType="component_sign_out" moduleId="component-signout" />}
          {resolvedTab === 'maintenance-signout' && <QMSRecordsPanel recordType="maintenance_sign_out" moduleId="maintenance-signout" />}
          {resolvedTab === 'organoleptic' && <QMSRecordsPanel recordType="organoleptic" moduleId="organoleptic" />}
          {resolvedTab === 'knife-accountability' && <QMSRecordsPanel recordType="knife_accountability" moduleId="knife-accountability" />}
          {resolvedTab === 'training' && <TrainingPanel />}
          {resolvedTab === 'recall' && <MockRecallPanel />}
          {resolvedTab === 'team-activity' && user.role === 'admin' && <TeamActivityPanel />}
          {resolvedTab === 'audit' && <AuditLogPanel />}
          {resolvedTab === 'settings' && <SettingsPanel />}
        </main>
      </div>

      <MobileBottomNav activeTab={resolvedTab} setActiveTab={setActiveTab} user={user} />
      <UpdateBanner />
      <InstallPrompt />
    </div>
  );
}

export default App;
