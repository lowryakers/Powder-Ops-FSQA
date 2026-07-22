import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { OrderForm, QuickReorder } from './SupplyOrdersPanel.jsx';
import { AdjustmentForm } from './TimeTrackingPanel.jsx';

// Form-only pseudo-module for supervisors: submit a supply order or an
// absence/tardy report without seeing the admin logs (those live in the
// admin-only Supply Orders / Time Tracking modules).
export default function OfficeRequestsPanel() {
  const [tab, setTab] = useState('supply');
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: items, refresh: refreshItems } = useApiGet('/office/supply/items', [refreshKey]);
  const { data: employees } = useApiGet('/users/technicians');
  const bump = () => { setRefreshKey(k => k + 1); refreshItems(); };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Requests</h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[['supply', 'Supply Order'], ['time', 'Time Tracking']].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'supply' && (
        <div className="space-y-4">
          <OrderForm items={items} onCreated={bump} />
          <QuickReorder items={items} onCreated={bump} />
        </div>
      )}
      {tab === 'time' && <AdjustmentForm employees={employees} onCreated={() => {}} />}
    </div>
  );
}
