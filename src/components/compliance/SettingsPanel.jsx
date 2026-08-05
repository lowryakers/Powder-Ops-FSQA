import { useAuth } from '../../hooks/useAuth';
import { Users, Sliders, MessageSquarePlus, Database, Sparkles, Link2, Plug } from 'lucide-react';
import SettingsShell from '../settings/SettingsShell.jsx';
import UsersSection from '../settings/UsersSection.jsx';
import DataBackupSection from '../settings/DataBackupSection.jsx';
import ShareableLinksSection from '../settings/ShareableLinksSection.jsx';
import LogBuilderPanel from '../settings/LogBuilderPanel.jsx';
import CleanupReviewPanel from '../settings/CleanupReviewPanel.jsx';
import RequestListPanel from '../common/RequestBox.jsx';
import QuickBooksSetupCard from './QuickBooksSetupCard.jsx';

// Settings is a REGISTRY, not a page.
//
// It used to be one render stacking seven blocks with their permission rules
// written inline between them. Adding a settings area meant appending more JSX
// to a 1,100-line component, and a section's visibility rule sat somewhere in
// the middle of the markup — so the heading could render with nothing under it,
// or content could render under no heading.
//
// Now: a section is an entry in SECTIONS with a `visible(user)` predicate, and
// SettingsShell builds both the nav and the pane from that same predicate. They
// cannot disagree. Adding a settings area is one entry here plus a component.
//
// Grouping follows what people come here to DO, not which module owns the code:
// managing people is one job, changing what the forms ask is another, and the
// plumbing (backups, links, integrations) is a third that is mostly read-only
// once it's set up.

const isAdmin = (u) => u?.role === 'admin';

// The Log Builder grant is an explicit per-module edit right, not a role — the
// intended way for a non-admin to add a dropdown option without being handed
// Settings.
//
// NOTE, carried over from the code this replaced: that second branch cannot
// currently fire. Settings is admin-only at the DOOR — both gear buttons in
// App.jsx test `user.role === 'admin'`, and 'settings' is in ADMIN_ALWAYS — so
// a grantee never reaches this screen to begin with. The rule is kept as
// written because it is the correct rule for the section; making the grant
// actually usable is a decision about who gets into Settings, which belongs to
// whoever owns that policy, not to this refactor.
const canBuildLogs = (u) => isAdmin(u)
  || (u?.module_access && !Array.isArray(u.module_access) && u.module_access['log-builder'] === 'edit');

const SECTIONS = [
  {
    label: 'People',
    sections: [
      {
        id: 'users',
        label: 'Users & access',
        description: 'Accounts, roles, departments, per-module permissions',
        keywords: 'staff technicians password reset permissions role department quick tabs bulk add',
        icon: Users,
        Component: UsersSection,
      },
    ],
  },
  {
    label: 'How the app works',
    sections: [
      {
        id: 'log-structure',
        label: 'Log structure',
        description: 'Dropdown lists and the extra fields your forms ask for',
        keywords: 'custom fields managed lists dropdown options uom zones log builder',
        icon: Sliders,
        visible: canBuildLogs,
        Component: LogBuilderPanel,
      },
      {
        id: 'requests',
        label: 'ReadyDoc requests',
        description: 'What the team has asked for, as a checklist',
        keywords: 'feedback suggestions ideas bugs requests',
        icon: MessageSquarePlus,
        visible: isAdmin,
        Component: ({ user }) => <RequestListPanel user={user} />,
      },
    ],
  },
  {
    label: 'Data & connections',
    sections: [
      {
        id: 'backup',
        label: 'Data backup',
        description: 'Full export, and the automatic weekly copies',
        keywords: 'export csv zip download restore friday archive',
        icon: Database,
        Component: DataBackupSection,
      },
      {
        id: 'links',
        label: 'Shareable links',
        description: 'QR-code forms and the auditor portal',
        keywords: 'qr code public submit production entry auditor portal url',
        icon: Link2,
        Component: ShareableLinksSection,
      },
      {
        id: 'integrations',
        label: 'Integrations',
        description: 'QuickBooks',
        keywords: 'quickbooks qbo accounting sync bills invoices',
        icon: Plug,
        Component: QuickBooksSetupCard,
      },
      {
        id: 'cleanup',
        label: 'Cleanup review',
        description: 'Close out what was filed before the plant was really using ReadyDoc',
        keywords: 'stale backlog waive cancel pre-launch old tasks',
        icon: Sparkles,
        visible: isAdmin,
        Component: CleanupReviewPanel,
      },
    ],
  },
];

export default function SettingsPanel({ initialSection }) {
  const { user } = useAuth();
  return <SettingsShell groups={SECTIONS} user={user} initialSection={initialSection} />;
}
