import { useState } from 'react';
import { useApiGet, apiPut } from '../../hooks/useApi';

// Settings → Products (R-0645, D-342). Who moves a product to Active, and who
// edits prices and distributor/wholesale item numbers. Stored as USER IDS in
// app_settings — nothing in the code names a person. Unset is a refusal on the
// product screen that names the setting, never "any admin".
export default function ProductPeopleSection() {
  const { data, refresh } = useApiGet('/products/sot-settings');
  const { data: users } = useApiGet('/users');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const people = (Array.isArray(users) ? users : users?.users || [])
    .filter((u) => u.is_active && !u.is_external && u.name !== 'ReadyBot')
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const save = async (key, id) => {
    setBusy(key); setError('');
    try { await apiPut('/products/sot-settings', { [key]: id || null }); refresh(); }
    catch (e) { setError(e.message); }
    setBusy('');
  };

  return (
    <div className="space-y-4" data-sot-settings>
      <p className="text-sm text-gray-600">
        A product becomes <b>Active</b> only when this person moves it there, in their own session, with its
        checklist done or marked not applicable. Prices and item numbers are edited only by the person named here.
        A bot or an API token can do none of these. Until a person is chosen, the product screen refuses and says so.
      </p>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {(data?.settings || []).map((s) => (
          <li key={s.key} className="px-4 py-3 text-sm" data-sot-setting={s.key}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{s.label}</div>
                <div className="text-xs text-gray-500">
                  {s.user ? (s.user.missing ? 'The account set here no longer exists — choose again.' : s.user.name)
                    : s.falls_back ? `Not set — ${s.effective?.name} (the price editor) covers it`
                      : <span className="text-amber-700">Nobody chosen yet</span>}
                </div>
              </div>
              {data?.can_edit && (
                <select value={s.user?.id || ''} disabled={busy === s.key} onChange={(e) => save(s.key, e.target.value)}
                  className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm" data-sot-pick={s.key}
                  aria-label={s.label}>
                  <option value="">{s.key === 'item_no_editor' ? 'Same as the price editor' : 'Nobody yet'}</option>
                  {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
