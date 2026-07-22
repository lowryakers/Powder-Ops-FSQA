import { useState } from 'react';
import QMSRecordsPanel from './QMSRecordsPanel.jsx';

// Knife / Razor Blade / Scissor module: the per-transaction Sign In/Out Log
// (Form 440-02, QA-reviewed — kiosk check-outs land here) plus the per-tool
// Master List registry (Form 440-01).
export default function KnifePanel() {
  const [tab, setTab] = useState('log');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[['log', 'Sign In/Out Log'], ['master', 'Master List']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
        ))}
      </div>
      {tab === 'log'
        ? <QMSRecordsPanel key="log" recordType="knife_sign_out" moduleId="knife-accountability" />
        : <QMSRecordsPanel key="master" recordType="knife_accountability" moduleId="knife-accountability" />}
    </div>
  );
}
