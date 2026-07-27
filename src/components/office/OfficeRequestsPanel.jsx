import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { hasExplicitGrant } from '../../utils/permissions';
import { OrderForm, QuickReorder } from './SupplyOrdersPanel.jsx';
import { AdjustmentForm } from './TimeTrackingPanel.jsx';

// Form-only pseudo-module for supervisors: submit a supply order or an
// absence/tardy report without seeing the admin logs (those live in the
// admin-only Supply Orders / Time Tracking modules).
//
// The two forms are granted separately in Settings ('supply-requests' /
// 'time-requests'), so office staff can get one without the other. Supervisors
// and admins get both, and the older combined 'office-requests' grant still
// means both.
export default function OfficeRequestsPanel() {
  const { user } = useAuth();
  const bothByRole = user?.role === 'admin' || user?.role === 'supervisor' || hasExplicitGrant(user, 'office-requests');
  const canSupply = bothByRole || hasExplicitGrant(user, 'supply-requests');
  const canTime = bothByRole || hasExplicitGrant(user, 'time-requests');

  const [tab, setTab] = useState(canSupply ? 'supply' : 'time');
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: items, refresh: refreshItems } = useApiGet(canSupply ? '/office/supply/items' : null, [refreshKey]);
  const { data: employees } = useApiGet(canTime ? '/users/technicians' : null);
  const bump = () => { setRefreshKey(k => k + 1); refreshItems(); };

  const tabs = [
    canSupply && ['supply', 'Supply Order'],
    canTime && ['time', 'Time Tracking'],
  ].filter(Boolean);
  const active = tabs.some(([v]) => v === tab) ? tab : tabs[0]?.[0];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Requests</h2>
        {tabs.length > 1 && (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {tabs.map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${active === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {active === 'supply' && (
        <div className="space-y-4">
          <OrderForm items={items} onCreated={bump} />
          <QuickReorder items={items} onCreated={bump} />
        </div>
      )}
      {active === 'time' && <AdjustmentForm employees={employees} onCreated={() => {}} />}
      {!active && <p className="text-sm text-gray-500">You don&apos;t have a request form yet. Ask an admin to grant one in Settings.</p>}
    </div>
  );
}
