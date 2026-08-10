import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { Shield, Wrench, Thermometer, Droplets, ScrollText, LayoutDashboard, Lock, HardHat, Settings, LogOut, FlaskConical, ClipboardCheck, FileWarning, FileText, GraduationCap, Package, Menu, X, ChevronDown, Bell, ChevronRight, Factory, CalendarDays, BarChart3, TestTubes,  Network, Trash2,  PackageCheck, Scissors, Sparkles, MessageSquare, Home, Search, CalendarClock, Users, KeyRound, ShoppingCart, AlarmClock, Eye, PackageSearch, PanelRight, MessageSquarePlus, BadgeCheck, Smartphone, Lightbulb, Landmark, Newspaper, BadgeDollarSign, Scale , ShieldCheck, FileCheck2, Map as MapIcon, Archive, Sliders } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useApiGet, apiPost } from './hooks/useApi';
import { getSocket } from './lib/socket';
import ModuleTabs from './components/common/ModuleTabs.jsx';
import { useModuleTabs } from './lib/useModuleTabs.js';
import { setAppBadge } from './lib/appBadge';
import { onDataChanged } from './lib/dataChanged';
import { useEdgeSwipe } from './lib/useEdgeSwipe';
import { useInstallPrompt, installEnvironment } from './lib/useInstallPrompt.js';
import { visibleModuleIds, canViewModule, hasExplicitGrant, canSeeQaReview } from './utils/permissions';
import { deptLabel } from './constants/departments';
import LoginScreen from './components/LoginScreen.jsx';
import AttentionBar from './components/AttentionBar.jsx';
import ModuleBoundary from './components/ModuleBoundary.jsx';
import InstallHelp from './components/InstallHelp.jsx';
import SubmitWorkOrder from './components/SubmitWorkOrder.jsx';
import KnifeKiosk from './components/kiosk/KnifeKiosk.jsx';
import ComponentKiosk from './components/kiosk/ComponentKiosk.jsx';
import MaintenanceKiosk from './components/kiosk/MaintenanceKiosk.jsx';
import ScaleKiosk from './components/kiosk/ScaleKiosk.jsx';
const AiAskPanel = lazy(() => import('./components/compliance/AiAskPanel.jsx'));
const ComplianceDashboard = lazy(() => import('./components/compliance/ComplianceDashboard.jsx'));
const EquipmentPanel = lazy(() => import('./components/compliance/EquipmentPanel.jsx'));
const PMPanel = lazy(() => import('./components/compliance/PMPanel.jsx'));
const CalibrationPanel = lazy(() => import('./components/compliance/CalibrationPanel.jsx'));
const SanitationPanel = lazy(() => import('./components/compliance/SanitationPanel.jsx'));
const QAInspectionsPanel = lazy(() => import('./components/compliance/QAInspectionsPanel.jsx'));
const QAReviewPanel = lazy(() => import('./components/compliance/QAReviewPanel.jsx'));
const LOTOPanel = lazy(() => import('./components/compliance/LOTOPanel.jsx'));
const AuditLogPanel = lazy(() => import('./components/compliance/AuditLogPanel.jsx'));
const OperatorView = lazy(() => import('./components/compliance/OperatorView.jsx'));
const SettingsPanel = lazy(() => import('./components/compliance/SettingsPanel.jsx'));
const ChemicalsPanel = lazy(() => import('./components/compliance/ChemicalsPanel.jsx'));
const HygienicDesignPanel = lazy(() => import('./components/compliance/HygienicDesignPanel.jsx'));
const QualitySchedulesPanel = lazy(() => import('./components/compliance/QualitySchedulesPanel.jsx'));
const TeamActivityPanel = lazy(() => import('./components/compliance/TeamActivityPanel.jsx'));
const AuditorView = lazy(() => import('./components/compliance/AuditorView.jsx'));
const CAPAPanel = lazy(() => import('./components/compliance/CAPAPanel.jsx'));
const DocumentRegistry = lazy(() => import('./components/compliance/DocumentRegistry.jsx'));
const OrgChart = lazy(() => import('./components/compliance/OrgChart.jsx'));
const DisposalsPanel = lazy(() => import('./components/compliance/DisposalsPanel.jsx'));
const QMSRecordsPanel = lazy(() => import('./components/compliance/QMSRecordsPanel.jsx'));
const KnifePanel = lazy(() => import('./components/compliance/KnifePanel.jsx'));
const ReceivingLogPanel = lazy(() => import('./components/warehouse/ReceivingLogPanel.jsx'));
import { RequestModal } from './components/common/RequestBox.jsx';
import OfflineBar from './components/common/OfflineBar.jsx';
const FlavorPanel = lazy(() => import('./components/compliance/FlavorPanel.jsx'));
const CertificationsPanel = lazy(() => import('./components/compliance/CertificationsPanel.jsx'));
const CriticalPanel = lazy(() => import('./components/compliance/CriticalPanel.jsx'));
import ApprovePage from './components/ApprovePage.jsx';
const TrainingPanel = lazy(() => import('./components/compliance/TrainingPanel.jsx'));
const MockRecallPanel = lazy(() => import('./components/compliance/MockRecallPanel.jsx'));
const MeetingsPanel = lazy(() => import('./components/compliance/MeetingsPanel.jsx'));
const InternalAuditsPanel = lazy(() => import('./components/compliance/InternalAuditsPanel.jsx'));
const DocReviewPanel = lazy(() => import('./components/compliance/DocReviewPanel.jsx'));
const FacilityMapPanel = lazy(() => import('./components/compliance/FacilityMapPanel.jsx'));
const RetentionSamplesPanel = lazy(() => import('./components/compliance/RetentionSamplesPanel.jsx'));
const ProductionLog = lazy(() => import('./components/compliance/ProductionLog.jsx'));
const ProductionSchedule = lazy(() => import('./components/compliance/ProductionSchedule.jsx'));
const ProductionDashboard = lazy(() => import('./components/compliance/ProductionDashboard.jsx'));
const COAPanel = lazy(() => import('./components/compliance/COAPanel.jsx'));
import CommsView from './components/comms/CommsView.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import PageInfo from './components/PageInfo.jsx';
const SupplyOrdersPanel = lazy(() => import('./components/office/SupplyOrdersPanel.jsx'));
const TimeTrackingPanel = lazy(() => import('./components/office/TimeTrackingPanel.jsx'));
const CheckedOutPanel = lazy(() => import('./components/compliance/CheckedOutPanel.jsx'));
const OfficeRequestsPanel = lazy(() => import('./components/office/OfficeRequestsPanel.jsx'));
const LedgerPanel = lazy(() => import('./components/office/LedgerPanel.jsx'));
const ProcurementPanel = lazy(() => import('./components/office/ProcurementPanel.jsx'));
const NewsletterPanel = lazy(() => import('./components/office/NewsletterPanel.jsx'));
const NewsletterReader = lazy(() => import('./components/office/NewsletterReader.jsx'));
const ControlledChangesPanel = lazy(() => import('./components/compliance/ControlledChangesPanel.jsx'));
const LogBuilderStudio = lazy(() => import('./components/compliance/LogBuilderStudio.jsx'));
const PayTrackingPanel = lazy(() => import('./components/office/PayTrackingPanel.jsx'));
const PartnerReconPanel = lazy(() => import('./components/office/PartnerReconPanel.jsx'));
const ReimbursementsPanel = lazy(() => import('./components/office/ReimbursementsPanel.jsx'));
const BankingPanel = lazy(() => import('./components/office/BankingPanel.jsx'));
const QuickBooksPanel = lazy(() => import('./components/office/QuickBooksPanel.jsx'));
const PartnerPortalPage = lazy(() => import('./components/office/PartnerPortalPage.jsx'));

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'operator', label: 'Operator View', icon: HardHat },
    ],
  },
  {
    // The kiosk QR forms, reachable in-app. Toggleable per user like any
    // module (Settings → module access); QR scans deep-link to the same forms.
    label: 'Quick Forms',
    items: [
      { id: 'form-maintenance', label: 'Sign Out an Item', icon: Wrench },
      { id: 'form-knife', label: 'Knife Sign In/Out', icon: Scissors },
      { id: 'form-components', label: 'Component Pull', icon: PackageCheck },
      { id: 'form-scale', label: 'Scale Verification', icon: Scale, keywords: 'scale calibration verification weights form 417 three point' },
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
      { id: 'receiving-log', label: 'Receiving Log', icon: PackageCheck, keywords: 'receiving incoming raw material po part lot form 204' },
      { id: 'component-signout', label: 'Component Sign In/Out', icon: PackageCheck },
      { id: 'sign-out', label: 'Sign In/Out', icon: Wrench, anyOf: ['maintenance-signout', 'knife-accountability'], keywords: 'checked out knife blade razor scissor equipment tool chemical form 440-02 703-01' },
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
      // Sits at the top of Quality on purpose: it's the "what do I owe today"
      // screen, and it spans the logs below it.
      { id: 'qa-review', label: 'QA Review', icon: ClipboardCheck, keywords: 'sign off signature verify pending queue backlog' },
      { id: 'coa', label: 'COA / Lab Testing', icon: TestTubes },
      { id: 'quality-schedules', label: 'Quality Schedules', icon: CalendarClock },
      { id: 'hygienic', label: 'Hygienic Design', icon: ClipboardCheck },
      // The plan with live status on it — cleaning, production, BP&G zones.
      { id: 'facility-map', label: 'Facility Map', icon: MapIcon, keywords: 'floor plan layout rooms zones rodent traps pest sinks extinguishers building' },
      { id: 'qa-inspections', label: 'QA Inspections', icon: Lightbulb, keywords: 'light inspection brittle plastic glass form 110 431' },
      // Physical sample custody — retains and lab pulls, by box. Linked to COA
      // where a lab sample was actually tested, but its own module: see the
      // header of server/api/retention.js.
      { id: 'retention-samples', label: 'Retention Samples', icon: Archive, keywords: 'retains retention library box destruction date lab sample keep jar 90g' },
      { id: 'organoleptic', label: 'Organoleptic Sensory', icon: TestTubes },
      { id: 'flavor-approvals', label: 'Flavor Approvals', icon: Sparkles },
      { id: 'capa', label: 'CAPA / Complaints', icon: FileWarning },
      // One sidebar entry for the three quality-event logs — tabs inside; access
      // stays granular per underlying module id.
      { id: 'quality-events', label: 'Quality Events', icon: FileWarning, anyOf: ['deviations', 'non-conformance', 'on-hold'], keywords: 'deviations non-conformance on hold' },
      { id: 'disposals', label: 'Disposals', icon: Trash2 },
      { id: 'recall', label: 'Mock Recall', icon: Package },
      // Sits in Quality because the two meetings that MUST be recorded
      // (management review, food safety team) are SQF records; the module
      // covers production and safety meetings too.
      { id: 'meetings', label: 'Meetings', icon: Users, keywords: 'minutes management review food safety team agenda attendance action items' },
      { id: 'internal-audits', label: 'Internal Audits', icon: ClipboardCheck, keywords: 'form 403-01 checklist audit findings CAR corrective action self audit' },
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
      // One "Documents" entry for SOPs / WIs / Job Descriptions — tabs inside.
      // Sits at the top of Document Control for the same reason QA Review sits
      // at the top of Quality: it's the "what do I owe today" screen, and it
      // spans the modules below it. Same visibility rule as Controlled Changes —
      // access by department, not by a module grant.
      { id: 'doc-review', label: 'Doc Control Review', icon: FileCheck2, keywords: 'review due documents change requests controlled changes drafts queue', visible: (u) => u?.role === 'admin' || (u?.department || '').toLowerCase() === 'document_control' || (u?.role === 'supervisor' && ['qa', 'document_control'].includes((u?.department || '').toLowerCase())) },
      { id: 'document-control', label: 'Controlled Documents', icon: FileText, anyOf: ['sops', 'work-instructions', 'job-descriptions'], keywords: 'sop work instructions job descriptions' },
      { id: 'training', label: 'Training Records', icon: GraduationCap },
      { id: 'certifications', label: 'Certifications', icon: BadgeCheck },
      { id: 'dcr', label: 'Document Change Requests', icon: ClipboardCheck },
      // Deployed changes to controlled definitions waiting on DC. Lives here,
      // not in Settings — Settings is admin-only, and this is Document
      // Control's own queue, not an admin toggle.
      { id: 'controlled-changes', label: 'Controlled Changes', icon: ShieldCheck, visible: (u) => u?.role === 'admin' || (u?.department || '').toLowerCase() === 'document_control' },
      // Access by department or explicit grant, not admin-only — the whole
      // point of moving this out of Settings is that Document Control can
      // reach it. Approval stays admin-only inside the module.
      { id: 'log-builder', label: 'Log Builder', icon: Sliders, keywords: 'dropdown lists custom fields draft copy edit approve structure',
        visible: (u) => u?.role === 'admin' || (u?.department || '').toLowerCase() === 'document_control'
          || (u?.module_access && !Array.isArray(u.module_access) && u.module_access['log-builder'] === 'edit') },
      { id: 'org-chart', label: 'Org Chart', icon: Network },
    ],
  },
  {
    label: 'Office',
    items: [
      // Supervisors submit through the form-only Requests pseudo-module; the
      // full modules (logs, invoices, stats) are admin workspaces.
      { id: 'office-requests', label: 'Requests', icon: ShoppingCart },
      { id: 'supply-orders', label: 'Supply Orders', icon: ShoppingCart, adminOnly: true },
      { id: 'time-tracking', label: 'Time Tracking', icon: AlarmClock, adminOnly: true },
      // AP, AR and the trading-partner reconciliation are one place to go —
      // they are the same job (money in, money out, what's owed) split only by
      // which direction it points.
      { id: 'accounting', label: 'Accounting', icon: Landmark, anyOf: ['accounts-payable', 'accounts-receivable', 'partner-reconciliation', 'reimbursements', 'banking'], keywords: 'AP AR bills vendors customers invoices owed reconcile settlement M4 net expense reimbursement receipt personal card bank statement balance' },
      { id: 'procurement', label: 'Procurement & Demand', icon: PackageSearch, keywords: 'purchase orders PO BOM parts demand planning samples pricing' },
      { id: 'newsletter', label: 'Newsletter', icon: Newspaper, keywords: 'announcements events shoutouts news monthly' },
      { id: 'pay-tracking', label: 'Pay Tracking', icon: BadgeDollarSign, keywords: 'raise increase evaluation rubric wage rate salary review compensation' },
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

// "Checked Out" is an opt-in summary view: visible to Ricardo by default (built
// for his floor check) and to anyone explicitly granted the 'currently-out'
// module in Settings — hidden for everyone else to keep sidebars lean.
const isRicardo = (u) => (u?.name || '').toLowerCase().startsWith('ricardo');

// Sends a signed-in kiosk-QR scanner into the app with the form as an overlay
// (?form=…). A component (not an inline call) so the navigation runs as an
// effect rather than as a side effect during render.
function KioskAppRedirect({ form }) {
  useEffect(() => { window.location.replace(`/?form=${form}`); }, [form]);
  return null;
}
const canSeeCheckedOut = (u) => isRicardo(u) || hasExplicitGrant(u, 'currently-out');
// The Sign In/Out hub: visible to anyone who can reach any of its tabs. Ricardo
// has only the Out-now grant and must still land here — it's his floor check.
const canSeeSignOut = (u) => canViewModule(u, 'maintenance-signout')
  || canViewModule(u, 'knife-accountability') || canSeeCheckedOut(u);

// QA Review: the cross-module sign-off queue. QA and quality staff by
// department, supervisors and admins by role, anyone else by explicit grant —
// it isn't a role default, because an operator has nothing to do there.

// "Requests" (supply order + time tracking forms) is for every supervisor,
// regardless of how their module access is trimmed — plus anyone explicitly
// granted the module in Settings (e.g. office staff who submit orders).
const canSeeOfficeRequests = (u) => u?.role === 'supervisor' ||
  hasExplicitGrant(u, 'office-requests') || hasExplicitGrant(u, 'supply-requests') || hasExplicitGrant(u, 'time-requests');

// Does this user's bottom tab bar include a Messages tab? If so, the bar stays
// visible inside the Messages workspace too — those users navigate by tabs.
function wantsMessagesTab(u) {
  let w = u?.quick_tabs;
  if (typeof w === 'string') { try { w = JSON.parse(w); } catch { w = null; } }
  if (!Array.isArray(w) || !w.length) return isRicardo(u);
  return w.includes('messages');
}

function Sidebar({ activeTab, setActiveTab, user, onClose, badges, badgeDetail, scheduleNotice, onOpenComms }) {
  const { data: aiStatus } = useApiGet('/ai/status');
  const { data: commsChannels, refresh: refreshComms } = useApiGet('/comms/channels', [activeTab]);
  // The user's own open sign-outs — pinned above the footer as a reminder to
  // return them, with a one-click Return. Refetches on every tab change.
  const { data: myOut, refresh: refreshMyOut } = useApiGet('/qms/mine/checked-out', [activeTab]);
  const [returningId, setReturningId] = useState(null);
  const returnItem = async (it) => {
    setReturningId(it.id);
    try { await apiPost(`/qms/mine/checked-out/${it.id}/return`, {}); refreshMyOut(); }
    catch { /* leave in list */ }
    finally { setReturningId(null); }
  };
  const commsUnread = (commsChannels || []).reduce((n, c) => n + (c.unread || 0), 0);
  const aiOn = !!aiStatus?.enabled;

  // Live-update the Messages unread badge when chat activity arrives.
  useEffect(() => {
    const s = getSocket();
    const onChange = () => refreshComms();
    s.on('channels:changed', onChange);
    return () => s.off('channels:changed', onChange);
  }, [refreshComms]);
  // Reflect total unread on the installed PWA's home-screen icon (Badging API).
  useEffect(() => { setAppBadge(commsUnread); }, [commsUnread]);
  // All groups expanded by default — users prefer seeing every module at once.
  // (Groups are still individually collapsible.) Collapse state is remembered
  // per-user across sessions via localStorage.
  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {};
    NAV_GROUPS.forEach(g => { initial[g.label] = true; });
    try {
      const saved = JSON.parse(localStorage.getItem('sidebar_open_groups') || '{}');
      for (const k of Object.keys(saved)) if (k in initial) initial[k] = !!saved[k];
    } catch { /* ignore malformed */ }
    return initial;
  });

  useEffect(() => {
    try { localStorage.setItem('sidebar_open_groups', JSON.stringify(openGroups)); } catch { /* quota */ }
  }, [openGroups]);

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
            if (i.id === 'settings') return false; // lives in the top-right gear icon
            if (i.id === 'sign-out') return canSeeSignOut(user);
            if (i.id === 'office-requests') return canSeeOfficeRequests(user);
            if (i.id === 'qa-review') return canSeeQaReview(user);
            // A nav item can decide for itself when module access isn't the
            // right question — Controlled Changes is Document Control's by
            // department, not by a module grant.
            if (i.visible) return i.visible(user);
            if (i.adminOnly && user.role !== 'admin') return false;
            if (i.roles && !i.roles.includes(user.role)) return false;
            if (i.aiOnly && !aiOn) return false;
            // Hub items combine several modules — visible if the user can see any.
            if (i.anyOf) return i.anyOf.some(id => canViewModule(user, id));
            return canViewModule(user, i.id);
          });
          if (visibleItems.length === 0) return null;
          const isOpen = openGroups[group.label];
          const hasActive = visibleItems.some(i => i.id === activeTab);
          // Roll up notifications so a collapsed section still surfaces them.
          const badgeFor = (i) => i.anyOf ? i.anyOf.reduce((n, id) => n + (badges?.[id] || 0), 0) : (badges?.[i.id] || 0);
          // The badge number is a count of items; the tooltip says which items,
          // so "7" is never a mystery.
          const badgeTip = (i) => {
            const ids = i.anyOf || [i.id];
            const lines = ids.flatMap(id => badgeDetail?.[id] || [])
              .filter(d => d.severity === 'critical' || d.severity === 'warning')
              .map(d => `• ${d.label}`);
            return lines.length ? `Needs attention:\n${lines.join('\n')}` : 'Needs attention';
          };
          const groupBadgeCount = visibleItems.reduce((n, i) => n + badgeFor(i), 0);
          const groupHasNotice = visibleItems.some(i => i.id === 'production-schedule') && scheduleNotice?.unseen;

          return (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.label)}
                className={`w-full flex items-center justify-between gap-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider ${hasActive ? 'text-powder-700' : 'text-gray-400'} hover:text-gray-600`}
              >
                <span className="truncate">{group.label}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {!isOpen && groupBadgeCount > 0 && (
                    <span className="min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1 normal-case">
                      {groupBadgeCount}
                    </span>
                  )}
                  {!isOpen && !groupBadgeCount && groupHasNotice && (
                    <span className="h-[8px] w-[8px] rounded-full bg-emerald-500" title="New schedule update" />
                  )}
                  <ChevronDown size={12} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                </span>
              </button>
              {isOpen && (
                <div className="space-y-0.5 pb-1">
                  {visibleItems.map((item) => {
                    const isActive = activeTab === item.id || !!item.anyOf?.includes(activeTab);
                    const itemBadge = badgeFor(item);
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
                        {itemBadge > 0 && (
                          <span data-tip={badgeTip(item)} data-tip-left
                            className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
                            {itemBadge}
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

      {(myOut || []).length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 px-1 mb-1">
            You have {myOut.length} item{myOut.length === 1 ? '' : 's'} checked out
          </p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {myOut.map(it => (
              <div key={it.id} className="flex items-center gap-1.5 rounded-lg bg-white border border-amber-200 px-2 py-1">
                <button onClick={() => { setActiveTab(it.module); onClose(); }}
                  className="flex-1 min-w-0 text-left text-xs text-gray-800 hover:text-powder-700 truncate"
                  data-tip="Open the sign-out log">
                  {it.item}{it.qty > 1 ? ` ×${it.qty}` : ''}
                  <span className="block text-[10px] text-gray-400">out since {it.date || '—'}</span>
                </button>
                <button onClick={() => returnItem(it)} disabled={returningId === it.id}
                  className="shrink-0 px-2 py-1 text-[10px] font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
                  {returningId === it.id ? '…' : 'Return'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-powder-100 flex items-center justify-center text-xs font-bold text-powder-700">
            {(user.name || '?')[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
            <div className="text-[10px] text-gray-400 truncate">{user.role} / {deptLabel(user.department)}</div>
          </div>
          <button onClick={() => window.dispatchEvent(new CustomEvent('app-change-password'))} className="text-gray-400 hover:text-gray-600" data-tip="Change password" data-tip-left>
            <KeyRound size={15} />
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('app-logout'))} className="text-gray-400 hover:text-gray-600" title="Sign Out">
            <LogOut size={16} />
          </button>
        </div>
        {!installEnvironment().standalone && (
          <button onClick={() => window.dispatchEvent(new CustomEvent('app-install-help'))}
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-powder-700 bg-powder-50 hover:bg-powder-100">
            <Smartphone size={13} /> Add ReadyDoc to your phone
          </button>
        )}
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

// Self-service password change, reachable from the account menu. Uses raw fetch
// (not the useApi wrapper) so a wrong current password surfaces as a form error
// instead of triggering an auto-logout on 401.
// `forced` = the password is past its yearly change date. The server refuses
// every other call until it's changed, so there is deliberately no way to
// dismiss this: an escape hatch here would just produce a session that can't
// do anything, with no explanation of why.
// Every layout (main, operator, kiosk, auditor) passes through its own
// `if (!user)` check, so the expiry gate is inserted after each rather than
// relying on one of them being the only way in.
// The "prompt" half of the policy. The gate is the wall; this is the notice
// that stops the wall being a surprise. Dismissed per session (sessionStorage),
// so it reappears tomorrow and stays out of the way today.
function PasswordExpiringBanner({ daysLeft }) {
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('pw_warn_hidden') === '1');
  if (hidden || daysLeft == null || daysLeft > 14 || daysLeft <= 0) return null;
  const dismiss = () => { sessionStorage.setItem('pw_warn_hidden', '1'); setHidden(true); };
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3 text-[12px] text-amber-900">
      <span>
        Your password must be changed {daysLeft === 1 ? 'tomorrow' : `within ${daysLeft} days`}.{' '}
        <button onClick={() => window.dispatchEvent(new CustomEvent('app-change-password'))}
          className="font-semibold underline hover:no-underline">Change it now</button>
      </span>
      <button onClick={dismiss} className="text-amber-700 hover:text-amber-900 shrink-0" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

function PasswordExpiredGate() {
  return (
    <div className="min-h-screen bg-gray-50">
      <ChangePasswordModal forced onClose={() => {}} />
    </div>
  );
}

function ChangePasswordModal({ onClose, forced = false }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (nw.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    if (nw !== confirm) { setErr('New passwords do not match.'); return; }
    setBusy(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: cur, new_password: nw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not change password.'); return; }
      setDone(true);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center px-4" onClick={forced ? undefined : onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={18} className="text-powder-600" />
          <h3 className="text-base font-bold text-gray-900">{forced ? 'Time to change your password' : 'Change your password'}</h3>
        </div>
        {forced && (
          <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-2">
            Passwords are changed at least once a year. Set a new one to carry on — you'll need your current password.
          </p>
        )}
        {done ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">Password changed. Use your new password next time you sign in.</p>
            <button onClick={forced ? () => window.location.reload() : onClose} className="w-full py-2.5 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-3">
            <p className="text-xs text-gray-500">Enter your current password, then choose a new one (at least 8 characters).</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Current password</label>
              <input type="password" autoFocus value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Current password" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
              <input type="password" value={nw} onChange={e => setNw(e.target.value)} autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="At least 8 characters" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confirm new password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Re-enter new password" />
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={busy} className="flex-1 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Change password'}
              </button>
              {!forced && <button type="button" onClick={onClose} className="px-4 py-2.5 text-gray-500 text-sm font-medium rounded-lg hover:bg-gray-100">Cancel</button>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Floating "Viewing as" pill — shown while an admin previews the app as
// another user. Everything renders with that user's access; writes are blocked.
function ViewAsBar({ viewAs, onExit }) {
  if (!viewAs) return null;
  return (
    <div className="fixed bottom-16 md:bottom-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2.5 bg-amber-500 text-white rounded-full pl-4 pr-1.5 py-1.5 shadow-lg whitespace-nowrap">
      <Eye size={15} className="shrink-0" />
      <span className="text-sm font-semibold">Viewing as {viewAs.name} <span className="font-normal opacity-80">· read-only</span></span>
      <button onClick={onExit} className="px-3 py-1 bg-white/25 hover:bg-white/35 rounded-full text-xs font-bold">Exit</button>
    </div>
  );
}

// Admin picker: choose any active non-admin user to preview the app as.
function ViewAsPickerModal({ onPick, onClose }) {
  const { data: users } = useApiGet('/users');
  const [q, setQ] = useState('');
  const list = (users || [])
    .filter(u => u.is_active && u.role !== 'admin')
    .filter(u => !q || u.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 bg-black/30 z-[80] flex items-start justify-center p-4 pt-[12vh]" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
          <Eye size={16} className="text-amber-500" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="View the app as…"
            className="flex-1 text-sm outline-none bg-transparent" />
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-400" /></button>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {list.length === 0 && <div className="px-4 py-6 text-center text-gray-400 text-sm">No matching users</div>}
          {list.map(u => (
            <button key={u.id} onClick={() => onPick(u)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
              <span className="text-gray-800 truncate">{u.name}</span>
              <span className="text-[11px] text-gray-400 shrink-0 capitalize">{u.role}{u.department ? ` · ${deptLabel(u.department)}` : ''}</span>
            </button>
          ))}
        </div>
        <p className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-400">
          The whole app — sidebar, shortcuts, permissions — renders exactly as this person sees it. Read-only until you exit.
        </p>
      </div>
    </div>
  );
}

// Top-right account menu: name/avatar → View as / Change password / Sign out.
function AccountMenu({ user, onChangePassword, onLogout, onViewAs, onInstallHelp }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-100" data-tip="Account" data-tip-left>
        <div className="h-7 w-7 rounded-full bg-powder-100 flex items-center justify-center text-xs font-bold text-powder-700">
          {(user.name || '?')[0]}
        </div>
        <span className="hidden lg:inline text-sm text-gray-600">{user.name}</span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden py-1">
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
            <div className="text-[11px] text-gray-400 capitalize">{user.role}</div>
            {user.username && user.username !== user.name && (
              <div className="text-[11px] text-gray-400 truncate">Signs in as {user.username}</div>
            )}
          </div>
          {onViewAs && (
            <button onClick={() => { setOpen(false); onViewAs(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Eye size={15} className="text-gray-400" /> View as user…
            </button>
          )}
          <button onClick={() => { setOpen(false); onChangePassword(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <KeyRound size={15} className="text-gray-400" /> Change password
          </button>
          {!installEnvironment().standalone && (
            <button onClick={() => { setOpen(false); onInstallHelp(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Smartphone size={15} className="text-gray-400" /> Add to home screen
            </button>
          )}
          <button onClick={() => { setOpen(false); onLogout(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <LogOut size={15} className="text-gray-400" /> Sign out
          </button>
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
      if (i.id === 'sign-out') {
        if (canSeeSignOut(user)) flat.push({ ...i, group: g.label });
        continue;
      }
      if (i.id === 'office-requests') {
        if (canSeeOfficeRequests(user)) flat.push({ ...i, group: g.label });
        continue;
      }
      if (i.adminOnly && user.role !== 'admin') continue;
      if (i.roles && !i.roles.includes(user.role)) continue;
      if (i.aiOnly && !aiOn) continue;
      // Hub entries (anyOf) are visible when any of their sub-modules is.
      if (i.anyOf ? !i.anyOf.some(id => canViewModule(user, id)) : !canViewModule(user, i.id)) continue;
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
    return items.filter(i => i.label.toLowerCase().includes(term) || i.group.toLowerCase().includes(term) || (i.keywords || '').includes(term));
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

const MOBILE_TAB_LABELS = { dashboard: 'Home', operator: 'Operator', pm: 'Tasks', 'production-schedule': 'Schedule', 'production-log': 'Production', capa: 'CAPA', sanitation: 'Sanitation', 'sign-out': 'Sign In-Out', messages: 'Messages' };

// Audit-readiness chip on the Dashboard tab row — the Phase 3 "one number"
// view of Critical Tracking. Own component so the fetch only happens for
// users who can actually see the critical view.
function ReadinessChip({ onClick }) {
  const { data } = useApiGet('/compliance/critical');
  if (!data?.readiness) return null;
  const tone = data.overall === 'crit' ? 'bg-red-100 text-red-800' : data.overall === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800';
  return (
    <button onClick={onClick} data-tip="Audit readiness — open Critical Tracking for the gaps"
      className={`px-2.5 py-1 rounded-full text-xs font-bold ${tone} hover:opacity-80`}>
      {data.readiness.score}% audit-ready
    </button>
  );
}

// Dashboard with tabs: Overview for everyone with dashboard access, and
// Critical Tracking for admins/supervisors or anyone explicitly granted the
// 'critical-tracking' module in Settings (shareable like any module).
function DashboardHub({ user, onNavigate, initialTab = 'overview' }) {
  const canCritical = user?.role === 'admin' || user?.role === 'supervisor' || hasExplicitGrant(user, 'critical-tracking');
  const [tab, setTab] = useState(canCritical && initialTab === 'critical' ? 'critical' : 'overview');
  if (!canCritical) return <ComplianceDashboard />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {[['overview', 'Overview'], ['critical', 'Critical Tracking']].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>
        <ReadinessChip onClick={() => setTab('critical')} />
      </div>
      {tab === 'overview' ? <ComplianceDashboard /> : <CriticalPanel onNavigate={onNavigate} />}
    </div>
  );
}

// Sidebar consolidation: several single-purpose registries share one nav entry
// with tabs inside. Access stays granular — tabs only show sub-modules the
// user can view, and cross-links to the old module ids land on the right tab.
const HUB_TABS = {
  'document-control': [
    { id: 'sops', label: 'SOPs', render: () => <DocumentRegistry docType="sop" moduleId="sops" title="SOP Registry" typeLabel="SOP" /> },
    { id: 'work-instructions', label: 'Work Instructions', render: () => <DocumentRegistry docType="work_instruction" moduleId="work-instructions" title="Work Instructions" typeLabel="Work Instruction" /> },
    { id: 'job-descriptions', label: 'Job Descriptions', render: () => <DocumentRegistry docType="job_description" moduleId="job-descriptions" title="Job Descriptions" typeLabel="Job Description" /> },
  ],
  // Forms 440-02 (knives/blades) and 703-01 (equipment/tools/chemicals) record
  // the same transaction — a person takes an item, brings it back, condition
  // checked both ways. They were separate modules only because they are
  // separate paper forms. They stay separate CONTROLLED RECORDS (an auditor
  // asking for 440-02 must get exactly those, and Document Control owns whether
  // the two forms ever merge) — but they are one place to go, with "Out now"
  // spanning both.
  'sign-out': [
    { id: 'currently-out', label: 'Out now', render: () => <CheckedOutPanel />,
      // A read-only roll-up of records you can already see, so anyone with
      // either form — or Ricardo's explicit grant — gets it.
      visible: (u) => canViewModule(u, 'maintenance-signout') || canViewModule(u, 'knife-accountability') || canSeeCheckedOut(u) },
    { id: 'maintenance-signout', label: 'Equipment, Tools & Chemicals', render: () => <QMSRecordsPanel recordType="maintenance_sign_out" moduleId="maintenance-signout" /> },
    { id: 'knife-accountability', label: 'Knives & Blades', render: () => <KnifePanel /> },
  ],
  // Money in, money out, and what's owed net between us and a trading partner.
  // Reconciliation is a tab rather than its own module because it is read
  // against the same ledgers — someone checking the M4 number wants the AP and
  // AR rows a click away, not a screen away.
  accounting: [
    { id: 'accounts-payable', label: 'Accounts Payable', render: () => <LedgerPanel ledger="ap" /> },
    { id: 'accounts-receivable', label: 'Accounts Receivable', render: () => <LedgerPanel ledger="ar" /> },
    { id: 'partner-reconciliation', label: 'Partner Reconciliation', render: (u) => <PartnerReconPanel user={u} /> },
    { id: 'reimbursements', label: 'Reimbursements', render: (u) => <ReimbursementsPanel user={u} /> },
    { id: 'banking', label: 'Banking', render: (u) => <BankingPanel user={u} /> },
    // Admin-only, and only worth a tab while QuickBooks is still the system of
    // record — the whole point is to get the books out of it.
    {
      id: 'quickbooks', label: 'QuickBooks', visible: (u) => u?.role === 'admin',
      render: (u) => <QuickBooksPanel user={u} />,
    },
  ],
  'quality-events': [
    { id: 'deviations', label: 'Deviations', render: () => <QMSRecordsPanel recordType="deviation" moduleId="deviations" /> },
    { id: 'non-conformance', label: 'Non-Conformance', render: () => <QMSRecordsPanel recordType="non_conformance" moduleId="non-conformance" /> },
    { id: 'on-hold', label: 'On Hold', render: () => <QMSRecordsPanel recordType="on_hold" moduleId="on-hold" /> },
  ],
};
// Maps an old module id back to its hub (legacy quick-tab picks, deep links).
const HUB_OF = Object.fromEntries(Object.entries(HUB_TABS).flatMap(([hub, tabs]) => tabs.map(t => [t.id, hub])));

// A hub is several controlled records that are one place to GO. It now renders
// its strip with the shared <ModuleTabs> like every other module — a hub tab
// and a module tab were always the same idea, drawn twice.
//
// A hub tab with no `visible` of its own falls back to "can this person see the
// module behind it", which is the rule hubs have always used.
function ModuleHub({ hubId, user, initialTab, badges }) {
  const defs = useMemo(() => HUB_TABS[hubId].map(t => ({
    ...t,
    visible: t.visible || ((u) => canViewModule(u, t.id)),
  })), [hubId]);
  const { tabs, tab, setTab } = useModuleTabs({ id: `hub-${hubId}`, tabs: defs, user, initial: initialTab });
  if (!tabs.length) return null;
  const active = tabs.find(t => t.id === tab) || tabs[0];
  const withBadges = tabs.map(t => ({ ...t, badge: badges?.[t.id], badgeTone: 'alert' }));
  return (
    <div className="space-y-4">
      <ModuleTabs tabs={withBadges} value={active.id} onChange={setTab} hideWhenSingle={false} />
      {active.render(user)}
    </div>
  );
}

function MobileBottomNav({ activeTab, setActiveTab, user, onOpenComms }) {
  // Bottom-bar tabs, in priority order: the user's own picks (set per-user in
  // Settings, may include the special 'messages' workspace), else Ricardo's
  // floor default, else role-aware auto-picks from accessible modules.
  const quickTabs = useMemo(() => {
    const flat = accessibleNavItems(user, false);
    const byId = Object.fromEntries(flat.map(i => [i.id, i]));
    let wanted = user.quick_tabs;
    if (typeof wanted === 'string') { try { wanted = JSON.parse(wanted); } catch { wanted = null; } }
    if (!Array.isArray(wanted) || !wanted.length) {
      wanted = isRicardo(user) ? ['operator', 'production-schedule', 'messages', 'currently-out'] : null;
    }

    const picked = [];
    const seen = new Set();
    const push = (id) => {
      // Old per-module ids consolidated into hubs still work as quick-tab picks.
      if (!byId[id] && HUB_OF[id]) id = HUB_OF[id];
      if (picked.length >= 4 || seen.has(id)) return;
      if (id === 'messages') { picked.push({ id: 'messages', icon: MessageSquare, isMessages: true }); seen.add(id); return; }
      // 'home' is a shortcut to whichever workspace this user calls home.
      if (id === 'home') { picked.push({ id: 'home', label: 'Home', icon: Home, isHome: true }); seen.add(id); return; }
      if (byId[id]) { picked.push(byId[id]); seen.add(id); }
    };

    if (wanted) wanted.forEach(push);
    if (!picked.length) {
      // Auto mode (or none of the custom picks were accessible).
      ['dashboard', 'operator', 'pm', 'production-schedule', 'production-log', 'capa', 'sanitation'].forEach(push);
      for (const it of flat) { if (picked.length >= 4) break; push(it.id); }
    }
    return picked.slice(0, 4).map(i => ({ ...i, label: MOBILE_TAB_LABELS[i.id] || i.label }));
  }, [user]);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-area-bottom">
      <div className="flex">
        {quickTabs.map(tab => {
          const homeIsMessages = user.home_workspace === 'messages';
          const isActive = tab.isMessages ? activeTab === '__messages'
            : tab.isHome ? (homeIsMessages ? activeTab === '__messages' : activeTab === 'dashboard')
            : activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.isMessages || (tab.isHome && homeIsMessages)) return onOpenComms?.();
                setActiveTab(tab.isHome ? 'dashboard' : tab.id);
              }}
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
  const { deferred, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('install_dismissed') === '1');

  // iOS Safari never fires beforeinstallprompt — users must add to the home
  // screen manually — so detect it and show step-by-step instructions instead.
  const { ios: isIOS, standalone: isStandalone } = installEnvironment();
  const [showIosHelp, setShowIosHelp] = useState(false);

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
      <button onClick={install}
        className="px-3 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700">Install</button>
      <button onClick={close} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
    </div>
  );
}

// Shown while a module's bundle is in flight. Deliberately quiet — a spinner
// that flashes for 80ms on a warm cache is worse than nothing.
function ModuleLoading() {
  return (
    <div className="py-16 text-center text-sm text-gray-400 animate-pulse" role="status" aria-live="polite">
      Loading…
    </div>
  );
}

function App() {
  const { user, realUser, viewAs, startViewAs, stopViewAs, loading, login, loginWithToken, logout } = useAuth();
  // Reloading keeps you where you were instead of bouncing to the Dashboard.
  // (A ?tab= deep link or the user's Home preference still wins — both are
  // applied after mount.)
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('active_tab') || 'dashboard'; } catch { return 'dashboard'; }
  });
  useEffect(() => {
    try { localStorage.setItem('active_tab', activeTab); } catch { /* private mode */ }
  }, [activeTab]);
  const [showViewAsPicker, setShowViewAsPicker] = useState(false);
  const [workspace, setWorkspace] = useState('fsqa');
  // Cross-link request from a module → a specific comms channel, remembering
  // where to return. Set by an 'open-comms-channel' event (e.g. from Schedule).
  const [commsLink, setCommsLink] = useState(null); // { channel, from, fromLabel }
  const [homePref, setHomePref] = useState('fsqa');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  // ReadyDoc feedback box — one click from anywhere in the app.
  const [requestOpen, setRequestOpen] = useState(false);
  // Docked chat: a slim Messages panel beside the modules (desktop split screen).
  const [dockChat, setDockChat] = useState(() => { try { return localStorage.getItem('dock_chat') === '1'; } catch { return false; } });
  const toggleDockChat = () => setDockChat(d => { const n = !d; try { localStorage.setItem('dock_chat', n ? '1' : '0'); } catch { /* private mode */ } return n; });
  // Docked-chat width is draggable and remembered. Clamped so it can't crowd out
  // the module on the left (min) or swallow the screen (max).
  const DOCK_MIN = 320, DOCK_MAX = 760;
  const [dockWidth, setDockWidth] = useState(() => {
    try { const v = parseInt(localStorage.getItem('dock_chat_w'), 10); return Number.isFinite(v) ? Math.min(DOCK_MAX, Math.max(DOCK_MIN, v)) : 420; }
    catch { return 420; }
  });
  const [dockDragging, setDockDragging] = useState(false);
  // Drag the left edge of the docked panel. Tracked on window so the pointer can
  // leave the thin handle mid-drag; the iframe is made click-through meanwhile so
  // it doesn't swallow the move events.
  const startDockResize = (e) => {
    e.preventDefault();
    setDockDragging(true);
    const move = (ev) => {
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const w = Math.min(DOCK_MAX, Math.max(DOCK_MIN, window.innerWidth - x));
      setDockWidth(w);
    };
    const end = () => {
      setDockDragging(false);
      try { localStorage.setItem('dock_chat_w', String(dockWidthRef.current)); } catch { /* private mode */ }
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
  };
  const dockWidthRef = useRef(dockWidth);
  useEffect(() => { dockWidthRef.current = dockWidth; }, [dockWidth]);
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

  // Module badges and the bell count come from one endpoint, and it used to be
  // refetched only when the active tab changed — so clearing six time entries
  // left the badge on its old number until you navigated away and back. A
  // module says notifyDataChanged() after a write; coming back to the tab asks
  // again too, since anyone else's work may have moved the counts meanwhile.
  useEffect(() => {
    const off = onDataChanged(() => refreshNotifications());
    const onVisible = () => { if (document.visibilityState === 'visible') refreshNotifications(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { off(); document.removeEventListener('visibilitychange', onVisible); };
  }, [refreshNotifications]);

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('app-logout', handler);
    return () => window.removeEventListener('app-logout', handler);
  }, [logout]);

  // The sidebar footer lives outside this component, so it asks by event.
  useEffect(() => {
    const handler = () => setShowInstall(true);
    window.addEventListener('app-install-help', handler);
    return () => window.removeEventListener('app-install-help', handler);
  }, []);

  useEffect(() => {
    const handler = () => setShowChangePw(true);
    window.addEventListener('app-change-password', handler);
    return () => window.removeEventListener('app-change-password', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => setActiveTab(e.detail?.tab || 'dashboard');
    window.addEventListener('app-navigate', handler);
    return () => window.removeEventListener('app-navigate', handler);
  }, []);

  // The docked Messages panel and the chat popout run the /chat route in their
  // own document, where the `app-navigate` event above has no listener. A
  // ReadyDoc link clicked in there asks THIS window to navigate instead, so the
  // panel keeps showing Messages and the module opens where the modules live.
  // Origin-checked: a message from anywhere else is ignored.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== 'readydoc-navigate') return;
      const tab = typeof e.data.tab === 'string' ? e.data.tab : null;
      if (tab) { setWorkspace('fsqa'); setActiveTab(tab); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Deep links: ?tab=<module> jumps straight to a module (ReadyBot alert
  // links use this), ?form=<kiosk> pops a quick form over whatever's open
  // (kiosk QR codes scanned by signed-in users). Params are consumed once.
  const [kioskForm, setKioskForm] = useState(null); // 'knife' | 'components' | 'maintenance' | 'scale'
  // `?section=` addresses a pane inside a module (currently Settings). It is
  // read HERE and handed down rather than read by the module itself: this
  // effect wipes the query string, and a lazily-loaded module mounts after it
  // has run, so a module reading window.location.search would always find it
  // already gone.
  const [deepSection, setDeepSection] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const form = params.get('form');
    const section = params.get('section');
    if (tab) { setWorkspace('fsqa'); setActiveTab(tab); }
    if (section) setDeepSection(section);
    if (form && ['knife', 'components', 'maintenance', 'scale'].includes(form)) setKioskForm(form);
    if (tab || form || section) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // Jump from a module to a specific comms channel, remembering the origin.
  useEffect(() => {
    const handler = (e) => {
      setCommsLink({ channel: e.detail?.channel || null, from: e.detail?.from || null, fromLabel: e.detail?.fromLabel || 'Back' });
      setWorkspace('comms');
    };
    window.addEventListener('open-comms-channel', handler);
    return () => window.removeEventListener('open-comms-channel', handler);
  }, []);

  // Deep-link into a channel from a push notification. Three paths, because iOS
  // PWAs are unreliable about honoring the notification URL:
  //  1. URL query (?c=…) when the app boots at the notification target.
  //  2. A pending-nav entry the service worker stashes in the Cache API — read on
  //     load AND whenever the app is foregrounded (iOS opens at start_url and
  //     drops the query string, so this is the path that actually fires there).
  //  3. A postMessage from the SW when a window is already open.
  const openFromNotification = useCallback((channelId, messageId = null) => {
    if (!channelId) return;
    setCommsLink({ channelId, messageId: messageId || null, from: null, fromLabel: 'Back' });
    setWorkspace('comms');
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('c');
    if (c) {
      openFromNotification(c, params.get('m'));
      window.history.replaceState({}, '', window.location.pathname);
    }
    let cancelled = false;
    const checkPending = async () => {
      if (!('caches' in window)) return;
      try {
        const cache = await caches.open('pending-nav');
        const res = await cache.match('/__pending_nav');
        if (!res) return;
        await cache.delete('/__pending_nav');
        const { channelId, messageId, ts } = await res.json();
        if (!cancelled && channelId && Date.now() - ts < 5 * 60 * 1000) openFromNotification(channelId, messageId);
      } catch { /* ignore */ }
    };
    checkPending();
    const onVis = () => { if (document.visibilityState === 'visible') checkPending(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [openFromNotification]);

  // Notification tapped while the app is already open: the SW posts the channel.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e) => { if (e.data?.type === 'open-channel') openFromNotification(e.data.channelId, e.data.messageId); };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [openFromNotification]);

  // Global edge-swipe navigation (mobile). From the left edge: in Messages it
  // steps back one level (thread → channel → channel list → ReadyDoc), handled
  // inside CommsView via the 'comms-back' event; elsewhere it opens the sidebar
  // — following the finger, so the drawer tracks the drag instead of popping in
  // on release. From the right edge (only in ReadyDoc): opens Messages.
  const drawerBackdropRef = useRef(null);
  const drawerPanelRef = useRef(null);
  const DRAWER_W = 240; // Tailwind w-60
  useEdgeSwipe({
    onSwipeRightFromLeft: () => { if (workspace === 'comms') window.dispatchEvent(new CustomEvent('comms-back')); else setSidebarOpen(true); },
    onSwipeLeftFromRight: () => { if (workspace !== 'comms') setWorkspace('comms'); },
    onLeftDragStart: () => {
      if (workspace === 'comms' || sidebarOpen) return false;
      const panel = drawerPanelRef.current, backdrop = drawerBackdropRef.current;
      if (!panel || !backdrop) return false;
      panel.style.transition = 'none';
      backdrop.style.transition = 'none';
      return true;
    },
    onLeftDragMove: (dx) => {
      const panel = drawerPanelRef.current, backdrop = drawerBackdropRef.current;
      if (!panel || !backdrop) return;
      // Tailwind 4's translate-x utilities use the CSS `translate` property, so
      // the inline override must too (an inline `transform` would compose with
      // the class's translate and double the offset).
      panel.style.translate = `${Math.min(0, -DRAWER_W + dx)}px 0`;
      backdrop.style.opacity = String(Math.min(1, dx / DRAWER_W));
    },
    onLeftDragEnd: (committed) => {
      const panel = drawerPanelRef.current, backdrop = drawerBackdropRef.current;
      // Clearing the inline styles hands control back to the classes; the CSS
      // transition animates from wherever the finger left off.
      if (panel) { panel.style.transition = ''; panel.style.translate = ''; }
      if (backdrop) { backdrop.style.transition = ''; backdrop.style.opacity = ''; }
      if (committed) setSidebarOpen(true);
    },
  });

  if (path === '/submit') {
    return <><SubmitWorkOrder /><UpdateBanner /></>;
  }

  // Signed-in users who scan a kiosk QR get the same form INSIDE the app
  // (overlay via ?form=…) so closing it lands on their normal view. Logged-out
  // scanners still get the public no-login kiosk page.
  const hasSession = (() => { try { return !!localStorage.getItem('auth_token'); } catch { return false; } })();
  if (path === '/kiosk/knife') {
    if (hasSession) return <KioskAppRedirect form="knife" />;
    return <><KnifeKiosk /><UpdateBanner /></>;
  }

  // Flavor-approval magic link (texted to the approver) — public, token-gated.
  if (path.startsWith('/approve/')) {
    return <ApprovePage token={path.split('/')[2] || ''} />;
  }

  // A trading partner's own view of the shared ledger. Public and token-gated
  // for the same reason as the flavor link: the person on the other end has no
  // ReadyDoc account and shouldn't need one to see the number we're both
  // settling against. Sits BEFORE the auth gate — a signed-in Powder Ops user
  // opening the link should still see what the partner sees.
  if (path.startsWith('/partner/')) {
    return (
      <ModuleBoundary>
        <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading…</div>}>
          <PartnerPortalPage token={decodeURIComponent(path.split('/')[2] || '')} />
        </Suspense>
        <UpdateBanner />
      </ModuleBoundary>
    );
  }

  if (path === '/kiosk/components') {
    if (hasSession) return <KioskAppRedirect form="components" />;
    return <><ComponentKiosk /><UpdateBanner /></>;
  }

  if (path === '/kiosk/maintenance') {
    if (hasSession) return <KioskAppRedirect form="maintenance" />;
    return <><MaintenanceKiosk /><UpdateBanner /></>;
  }

  if (path === '/kiosk/scale') {
    if (hasSession) return <KioskAppRedirect form="scale" />;
    return <><ScaleKiosk /><UpdateBanner /></>;
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
    if (user.password_expired) return <PasswordExpiredGate />;
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
    if (user.password_expired) return <PasswordExpiredGate />;
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
    if (user.password_expired) return <PasswordExpiredGate />;
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
              {!installEnvironment().standalone && (
                <button onClick={() => setShowInstall(true)} className="text-gray-400 hover:text-gray-600" title="Add to home screen">
                  <Smartphone size={17} />
                </button>
              )}
              <button onClick={() => setShowChangePw(true)} className="text-gray-400 hover:text-gray-600" data-tip="Change password" data-tip-left>
                <KeyRound size={17} />
              </button>
              <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        {/* The standalone operator layout runs on the floor phones — the exact
            place the Wi-Fi drops — and was the one layout without the
            offline / queued-writes bar. */}
        <OfflineBar />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <OperatorView />
        </main>
        {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
        {showInstall && <InstallHelp onClose={() => setShowInstall(false)} />}
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

  if (user.password_expired) return <PasswordExpiredGate />;

  // Auditors only ever see the read-only evidence binder — no matter which
  // URL they sign in from, and never the operating app or comms.
  if (user.role === 'auditor') {
    return <><AuditorView /><UpdateBanner /></>;
  }

  // The newsletter as a page, which is what #announcements links to — it's the
  // only place the EN/ES toggle can live, since a PDF is a static file. Sits
  // after the auth gate so a link opened cold lands on login and then here.
  if (path.startsWith('/newsletter/')) {
    const issueId = decodeURIComponent(path.split('/')[2] || '');
    return (
      <ModuleBoundary>
        <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading…</div>}>
          <NewsletterReader id={issueId} onExit={() => { window.location.href = '/'; }} />
        </Suspense>
        <UpdateBanner />
      </ModuleBoundary>
    );
  }

  // Slim standalone chat — the target of "Open in window" popouts and the
  // docked side panel's iframe. Renders only the conversation UI (CommsView's
  // compact layout takes over at narrow widths); /chat/<channel> deep-links.
  if (path.startsWith('/chat')) {
    const chanFromPath = decodeURIComponent(path.split('/')[2] || '') || null;
    const chanId = new URLSearchParams(window.location.search).get('cid');
    // NO `onExit` on purpose. This view is either a 420px docked panel or a
    // 460px popout, and "back" used to navigate it to `/` — loading the entire
    // app, sidebar and all, into a column narrower than a phone. Without the
    // prop the back chain stops at the channel list, which is the outermost
    // thing inside Messages, and the header drops its ReadyDoc button: in the
    // docked case ReadyDoc is already on screen beside it, and in the popout
    // case it belongs in the window you came from.
    return <CommsView user={user} openChannelName={chanFromPath} openChannelId={chanId} />;
  }

  // Messages workspace — full-screen, separable from the FSQA workspace.
  if (workspace === 'comms') {
    const keepBar = wantsMessagesTab(user);
    return <>
      <CommsView
        user={user}
        onExit={() => { setWorkspace('fsqa'); setCommsLink(null); }}
        onSplitScreen={() => { if (!dockChat) toggleDockChat(); setWorkspace('fsqa'); setCommsLink(null); }}
        onGoToSchedule={canViewModule(user, 'production-schedule') ? () => { setWorkspace('fsqa'); setActiveTab('production-schedule'); } : null}
        openChannelName={commsLink?.channel}
        openChannelId={commsLink?.channelId}
        openMessageId={commsLink?.messageId}
        backLabel={commsLink?.from ? commsLink.fromLabel : null}
        onBackToModule={commsLink?.from ? () => { setWorkspace('fsqa'); setActiveTab(commsLink.from); setCommsLink(null); } : null}
        homePref={homePref}
        onSetHome={setHome}
        bottomNavPadding={keepBar}
      />
      {keepBar && (
        <MobileBottomNav activeTab="__messages" user={user}
          setActiveTab={(id) => { setWorkspace('fsqa'); setCommsLink(null); setActiveTab(id); }}
          onOpenComms={() => {}} />
      )}
      <ViewAsBar viewAs={viewAs} onExit={stopViewAs} />
      <UpdateBanner />
    </>;
  }

  // Determine effective accessible modules for this user. Hub nav entries
  // (anyOf) expand to their underlying module ids so per-module grants and
  // deep links to the old ids keep working; the hub id itself is then added
  // whenever any of its sub-modules is visible.
  const allModuleIds = NAV_GROUPS.flatMap(g => g.items).filter(i => (!i.adminOnly || user.role === 'admin') && (!i.roles || i.roles.includes(user.role))).flatMap(i => i.anyOf ? i.anyOf : [i.id]);
  let effectiveModules = visibleModuleIds(user, allModuleIds);
  for (const hub of NAV_GROUPS.flatMap(g => g.items).filter(i => i.anyOf)) {
    if (hub.anyOf.some(id => effectiveModules.includes(id)) && !effectiveModules.includes(hub.id)) effectiveModules = [...effectiveModules, hub.id];
  }
  // "Checked Out" follows its own opt-in rule rather than plain module access.
  effectiveModules = canSeeCheckedOut(user)
    ? (effectiveModules.includes('currently-out') ? effectiveModules : [...effectiveModules, 'currently-out'])
    : effectiveModules.filter(id => id !== 'currently-out');
  // "Requests" is always available to supervisors, never to anyone else.
  effectiveModules = canSeeOfficeRequests(user)
    ? (effectiveModules.includes('office-requests') ? effectiveModules : [...effectiveModules, 'office-requests'])
    : effectiveModules.filter(id => id !== 'office-requests');
  // QA Review is QA/supervisor/admin by role, or an explicit grant — the same
  // rule the sidebar applies, so a deep link can't reach it either.
  effectiveModules = canSeeQaReview(user)
    ? (effectiveModules.includes('qa-review') ? effectiveModules : [...effectiveModules, 'qa-review'])
    : effectiveModules.filter(id => id !== 'qa-review');
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
              {!installEnvironment().standalone && (
                <button onClick={() => setShowInstall(true)} className="text-gray-400 hover:text-gray-600" title="Add to home screen">
                  <Smartphone size={17} />
                </button>
              )}
              <button onClick={() => setShowChangePw(true)} className="text-gray-400 hover:text-gray-600" data-tip="Change password" data-tip-left>
                <KeyRound size={17} />
              </button>
              <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>
        {/* The standalone operator layout runs on the floor phones — the exact
            place the Wi-Fi drops — and was the one layout without the
            offline / queued-writes bar. */}
        <OfflineBar />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <OperatorView />
        </main>
        {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
        {showInstall && <InstallHelp onClose={() => setShowInstall(false)} />}
        <ViewAsBar viewAs={viewAs} onExit={stopViewAs} />
        <UpdateBanner />
      </div>
    );
  }

  // Show first accessible module if current tab isn't accessible. No silent
  // dashboard fallback: a user with zero modules gets an empty state instead
  // of a page they can't actually access.
  const resolvedTab = effectiveModules.includes(activeTab) ? activeTab : (effectiveModules[0] || null);
  const activeItem = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === resolvedTab || !!i.anyOf?.includes(resolvedTab));

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:block flex-shrink-0 sticky top-0 h-screen">
        <Sidebar activeTab={resolvedTab} setActiveTab={setActiveTab} user={user} onClose={() => {}} badges={notifications?.badges} badgeDetail={notifications?.badgeDetail} scheduleNotice={notifications?.scheduleNotice} onOpenComms={() => setWorkspace('comms')} />
      </aside>

      {/* Mobile sidebar overlay — always mounted so the edge swipe can pull it
          in following the finger; `sidebarOpen` is the committed state. */}
      <div className={`fixed inset-0 z-50 md:hidden ${sidebarOpen ? '' : 'pointer-events-none'}`}>
        <div ref={drawerBackdropRef} onClick={() => setSidebarOpen(false)}
          className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`} />
        <div ref={drawerPanelRef}
          className={`absolute left-0 top-0 bottom-0 w-60 shadow-xl transition-transform duration-200 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar activeTab={resolvedTab} setActiveTab={setActiveTab} user={user} onClose={() => setSidebarOpen(false)} badges={notifications?.badges} badgeDetail={notifications?.badgeDetail} scheduleNotice={notifications?.scheduleNotice} onOpenComms={() => setWorkspace('comms')} />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <PasswordExpiringBanner daysLeft={user.password_days_left} />
        {/* Desktop top bar */}
        <header className="hidden md:block bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-6 lg:px-8 py-2.5 flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-1">
              <h1 className="text-sm font-semibold text-gray-700">{activeItem?.label || 'Dashboard'}</h1>
              <PageInfo moduleId={resolvedTab} title={activeItem?.label || 'Dashboard'} />
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden lg:block"><ModuleSearch user={user} onNavigate={setActiveTab} /></div>
              <button onClick={toggleDockChat} data-tip={dockChat ? 'Close the docked Messages panel' : 'Dock Messages beside this module'}
                className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${dockChat ? 'text-powder-700 bg-powder-50' : 'text-gray-500 hover:bg-gray-100'}`}>
                <PanelRight size={16} /> Split Screen
              </button>
              {(user.role === 'admin' || user.role === 'supervisor') && (
                <button onClick={() => setRequestOpen(true)} data-tip="Request a ReadyDoc change or report a problem"
                  className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100">
                  <MessageSquarePlus size={16} /> Request
                </button>
              )}
              <button onClick={() => setHome('fsqa')} data-tip={homePref === 'fsqa' ? 'ReadyDoc is your home screen' : 'Make ReadyDoc your home screen'}
                className={`p-1.5 rounded-lg transition-colors ${homePref === 'fsqa' ? 'text-powder-600 bg-powder-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                <Home size={18} />
              </button>
              <NotificationBell notifications={notifications} onNavigate={setActiveTab} />
              {user.role === 'admin' && (
                <button onClick={() => setActiveTab('settings')} data-tip="Settings" data-tip-left
                  className={`p-1.5 rounded-lg transition-colors ${resolvedTab === 'settings' ? 'text-powder-600 bg-powder-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                  <Settings size={18} />
                </button>
              )}
              <AccountMenu user={user} onChangePassword={() => setShowChangePw(true)} onLogout={logout}
                onInstallHelp={() => setShowInstall(true)}
                onViewAs={realUser?.role === 'admin' && !viewAs ? () => setShowViewAsPicker(true) : null} />
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
              <div className="flex items-center gap-1 min-w-0">
                <h1 className="text-sm font-bold text-gray-900 truncate">{activeItem?.label || 'Dashboard'}</h1>
                <PageInfo moduleId={resolvedTab} title={activeItem?.label || 'Dashboard'} />
              </div>
            </div>
            <NotificationBell notifications={notifications} onNavigate={setActiveTab} />
            {user.role === 'admin' && (
              <button onClick={() => setActiveTab('settings')} title="Settings"
                className={`p-1 rounded-lg transition-colors ${resolvedTab === 'settings' ? 'text-powder-600 bg-powder-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                <Settings size={18} />
              </button>
            )}
            <button onClick={logout} className="text-gray-400 hover:text-gray-600" title="Sign Out">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* Where your work is: no connection, and/or entries still to send.
            Directly under the header so it's the first thing on every screen. */}
        <OfflineBar />

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-20 md:pb-6 max-w-7xl w-full mx-auto">
          {resolvedTab === null && (
            <div className="text-center py-20 text-gray-400">
              <Shield size={36} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No modules are enabled for this account.</p>
            </div>
          )}
          {/* What the sidebar badge on this module actually refers to. */}
          <AttentionBar detail={notifications?.badgeDetail?.[resolvedTab]} />
          {/* Each module is its own bundle, fetched the first time its tab is
              opened. The whole app used to ship as one 2 MB script — a second
              of parse on a phone before anything paints, for forty modules
              nobody opens in one session. */}
          <ModuleBoundary resetKey={resolvedTab}>
          <Suspense fallback={<ModuleLoading />}>
          {resolvedTab === 'dashboard' && <DashboardHub user={user} onNavigate={setActiveTab} />}
          {resolvedTab === 'ask-ai' && <AiAskPanel />}
          {resolvedTab === 'form-maintenance' && <MaintenanceKiosk defaultName={user.name} />}
          {resolvedTab === 'form-knife' && <KnifeKiosk defaultName={user.name} />}
          {resolvedTab === 'form-components' && <ComponentKiosk defaultName={user.name} />}
          {resolvedTab === 'form-scale' && <ScaleKiosk defaultName={user.name} />}
          {resolvedTab === 'operator' && <OperatorView />}
          {resolvedTab === 'office-requests' && <OfficeRequestsPanel />}
          {resolvedTab === 'qa-inspections' && <QAInspectionsPanel />}
          {resolvedTab === 'qa-review' && <QAReviewPanel />}
          {(resolvedTab === 'accounting' || HUB_OF[resolvedTab] === 'accounting') &&
            <ModuleHub key={`acct-${resolvedTab}`} hubId="accounting" user={user} initialTab={resolvedTab} badges={notifications?.badges} />}
          {resolvedTab === 'procurement' && <ProcurementPanel />}
          {resolvedTab === 'newsletter' && <NewsletterPanel />}
          {resolvedTab === 'pay-tracking' && <PayTrackingPanel />}
          {resolvedTab === 'supply-orders' && <SupplyOrdersPanel />}
          {resolvedTab === 'controlled-changes' && <ControlledChangesPanel />}
          {resolvedTab === 'log-builder' && <LogBuilderStudio />}
          {resolvedTab === 'time-tracking' && <TimeTrackingPanel />}
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
          {(resolvedTab === 'document-control' || HUB_OF[resolvedTab] === 'document-control') &&
            <ModuleHub key={`dc-${resolvedTab}`} hubId="document-control" user={user} initialTab={resolvedTab} badges={notifications?.badges} />}
          {resolvedTab === 'org-chart' && <OrgChart />}
          {resolvedTab === 'disposals' && <DisposalsPanel />}
          {resolvedTab === 'dcr' && <QMSRecordsPanel recordType="document_change_request" moduleId="dcr" />}
          {(resolvedTab === 'quality-events' || HUB_OF[resolvedTab] === 'quality-events') &&
            <ModuleHub key={`qe-${resolvedTab}`} hubId="quality-events" user={user} initialTab={resolvedTab} badges={notifications?.badges} />}
          {resolvedTab === 'receiving-log' && <ReceivingLogPanel user={user} />}
          {resolvedTab === 'component-signout' && <QMSRecordsPanel recordType="component_sign_out" moduleId="component-signout" />}
          {resolvedTab === 'maintenance-signout' && <QMSRecordsPanel recordType="maintenance_sign_out" moduleId="maintenance-signout" />}
          {(resolvedTab === 'sign-out' || HUB_OF[resolvedTab] === 'sign-out') &&
            <ModuleHub key={`so-${resolvedTab}`} hubId="sign-out" user={user} initialTab={resolvedTab} badges={notifications?.badges} />}
          {resolvedTab === 'organoleptic' && <QMSRecordsPanel recordType="organoleptic" moduleId="organoleptic" />}
          {resolvedTab === 'flavor-approvals' && <FlavorPanel />}
          {resolvedTab === 'certifications' && <CertificationsPanel />}
          {resolvedTab === 'knife-accountability' && <KnifePanel />}
          {resolvedTab === 'training' && <TrainingPanel />}
          {resolvedTab === 'recall' && <MockRecallPanel />}
          {resolvedTab === 'meetings' && <MeetingsPanel />}
          {resolvedTab === 'internal-audits' && <InternalAuditsPanel />}
          {resolvedTab === 'doc-review' && <DocReviewPanel />}
          {resolvedTab === 'facility-map' && <FacilityMapPanel user={user} />}
          {resolvedTab === 'retention-samples' && <RetentionSamplesPanel user={user} />}
          {resolvedTab === 'critical-tracking' && <DashboardHub user={user} onNavigate={setActiveTab} initialTab="critical" />}
          {resolvedTab === 'team-activity' && user.role === 'admin' && <TeamActivityPanel />}
          {resolvedTab === 'audit' && <AuditLogPanel />}
          {resolvedTab === 'settings' && <SettingsPanel initialSection={deepSection} />}
          </Suspense>
          </ModuleBoundary>
        </main>
      </div>

      {/* Docked Messages panel — split screen: the module stays open on the
          left while a slim live chat (the /chat standalone view) rides along
          on the right. Desktop only; state persists across sessions. */}
      {requestOpen && <RequestModal onClose={() => setRequestOpen(false)} />}

      {dockChat && (
        <aside className="hidden lg:flex flex-col shrink-0 border-l border-gray-200 sticky top-0 h-screen bg-white relative"
          style={{ width: dockWidth }}>
          {/* Drag handle straddling the left border. Widens on hover so it's
              catchable without being visible clutter at rest.
              Positioning is inline, not via the `absolute` utility: this element
              carries data-tip, and the tooltip CSS (@media hover:hover
              [data-tip]{position:relative}) would otherwise override `absolute`,
              drop the handle into flow, and its h-full would eat the whole
              column — collapsing the chat panel to nothing. Inline styles win
              over the stylesheet rule, so the handle stays out of flow. */}
          <div onMouseDown={startDockResize} onTouchStart={startDockResize}
            style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '6px', transform: 'translateX(-50%)', zIndex: 10 }}
            className="cursor-col-resize group"
            data-tip="Drag to resize" role="separator" aria-orientation="vertical">
            <div className={`h-full w-0.5 mx-auto transition-colors ${dockDragging ? 'bg-powder-500' : 'bg-transparent group-hover:bg-powder-300'}`} />
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50">
            <span className="text-xs font-semibold text-gray-500">Messages</span>
            <button onClick={toggleDockChat} className="p-1 text-gray-400 hover:text-gray-600 rounded" data-tip="Close docked chat">
              <X size={14} />
            </button>
          </div>
          {/* Click-through while dragging so the resize keeps tracking over the
              iframe instead of the iframe eating the pointer moves.
              The iframe lives in a flex-growing wrapper and fills it at
              height:100% — an iframe is a replaced element and ignores
              flex-grow on itself (Chrome collapses it to its intrinsic 150px),
              which left the panel mostly blank with the chat squished at the
              bottom. min-h-0 lets the wrapper shrink within the flex column. */}
          <div className="flex-1 min-h-0 w-full">
            <iframe src="/chat" title="Messages" className="h-full w-full border-0" style={{ pointerEvents: dockDragging ? 'none' : 'auto' }} />
          </div>
        </aside>
      )}

      <MobileBottomNav activeTab={resolvedTab} setActiveTab={setActiveTab} user={user} onOpenComms={() => setWorkspace('comms')} />
      {/* Quick-form overlay: a scanned kiosk QR (?form=…) pops the form over
          whatever's open; closing it returns to the normal app view. */}
      {kioskForm && (
        <div className="fixed inset-0 z-[70] bg-gray-50 overflow-y-auto">
          <button onClick={() => setKioskForm(null)}
            className="fixed top-3 right-3 z-[75] p-2 bg-white border border-gray-200 rounded-full shadow-md text-gray-500 hover:text-gray-800" data-tip="Close form">
            <X size={18} />
          </button>
          {kioskForm === 'knife' && <KnifeKiosk defaultName={user.name} />}
          {kioskForm === 'components' && <ComponentKiosk defaultName={user.name} />}
          {kioskForm === 'maintenance' && <MaintenanceKiosk defaultName={user.name} />}
          {kioskForm === 'scale' && <ScaleKiosk defaultName={user.name} />}
        </div>
      )}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
        {showInstall && <InstallHelp onClose={() => setShowInstall(false)} />}
      {showViewAsPicker && <ViewAsPickerModal onPick={(u) => { setShowViewAsPicker(false); startViewAs(u); }} onClose={() => setShowViewAsPicker(false)} />}
      <ViewAsBar viewAs={viewAs} onExit={stopViewAs} />
      <UpdateBanner />
      <InstallPrompt />
    </div>
  );
}

export default App;
