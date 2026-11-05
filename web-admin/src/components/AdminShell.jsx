import React from 'react';
import logoLong from '@brand/logo_long.jpg';

const LIBRARY_ITEMS = [
  { id: 'videos', label: 'Videos' },
  { id: 'study-materials', label: 'Study Materials' },
  { id: 'worksheets', label: 'Worksheets' },
  { id: 'quizzes', label: 'Quiz Bank' },
  { id: 'assignments', label: 'Assignments' },
];

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  today: 'Today',
  batches: 'Batches',
  calendar: 'Calendar',
  review: 'Review',
  students: 'Students',
  leads: 'Leads',
  subscriptions: 'Subscriptions',
  'other-users': 'Directory',
  lessons: 'Lessons',
  courses: 'Courses',
  billing: 'Billing & combos',
  payments: 'Payments & invoices',
  videos: 'Videos',
  'study-materials': 'Study materials',
  worksheets: 'Worksheets',
  quizzes: 'Quiz bank',
  assignments: 'Assignments',
  settings: 'Settings',
};

function navStudentsBatches(showSubscriptionsNav) {
  const items = [
    { id: 'students', label: 'Students' },
    { id: 'batches', label: 'Batches' },
    { id: 'leads', label: 'Leads' },
  ];
  if (showSubscriptionsNav) items.splice(2, 0, { id: 'subscriptions', label: 'Subscriptions' });
  return items;
}

const NAV_SECTIONS_BASE = [
  {
    collapseKey: 'studentsBatches',
    title: 'Students & Batches',
    getItems: ({ showSubscriptionsNav }) => navStudentsBatches(showSubscriptionsNav),
  },
  {
    collapseKey: 'otherUsers',
    title: 'Other Users',
    getItems: () => [{ id: 'other-users', label: 'Directory' }],
  },
  {
    collapseKey: 'lessonsCourses',
    title: 'Lessons & Courses',
    getItems: ({ lessonsCoursesItems }) => lessonsCoursesItems,
  },
  {
    collapseKey: 'library',
    title: 'Library',
    getItems: () => LIBRARY_ITEMS,
  },
];

const TRAINER_NAV_ITEMS = [
  { id: 'today', label: 'Today' },
  { id: 'batches', label: 'My Batches' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'review', label: 'Review' },
  ...LIBRARY_ITEMS,
  { id: 'courses', label: 'Courses' },
  { id: 'lessons', label: 'Lessons' },
];

function initialsFromName(name, email) {
  const source = String(name || email || '').trim();
  if (!source) return 'U';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function Icon({ name }) {
  const p = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'home':
      return (
        <svg {...p}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 10v10h5v-6h4v6h5V10" />
        </svg>
      );
    case 'key':
      return (
        <svg {...p}>
          <circle cx="8" cy="12" r="4" />
          <path d="M12 12h10" />
          <path d="M19 12v3M16 12v2" />
        </svg>
      );
    case 'userPlus':
      return (
        <svg {...p}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" />
        </svg>
      );
    case 'user':
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20c1.2-3.2 3.7-5 7-5s5.8 1.8 7 5" />
        </svg>
      );
    case 'layers':
      return (
        <svg {...p}>
          <path d="M12 2 3 7l9 5 9-5-9-5z" />
          <path d="M3 12l9 5 9-5" />
          <path d="M3 17l9 5 9-5" />
        </svg>
      );
    case 'inbox':
      return (
        <svg {...p}>
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      );
    case 'megaphone':
      return (
        <svg {...p}>
          <path d="M3 11v2a1 1 0 0 0 1 1h2l6 5V5L6 10H4a1 1 0 0 0-1 1z" />
          <path d="M15.5 8.5a4.5 4.5 0 0 1 0 7" />
        </svg>
      );
    case 'repeat':
      return (
        <svg {...p}>
          <path d="M17 1v4h-4" />
          <path d="M7 23v-4h4" />
          <path d="M20 7a8 8 0 0 0-13.7-3L7 5" />
          <path d="M4 17a8 8 0 0 0 13.7 3L17 19" />
        </svg>
      );
    case 'bookmark':
      return (
        <svg {...p}>
          <path d="M7 4h10a1 1 0 0 1 1 1v16l-6-3.5L6 21V5a1 1 0 0 1 1-1z" />
        </svg>
      );
    case 'graduation':
      return (
        <svg {...p}>
          <path d="M22 10 12 5 2 10l10 5 10-5z" />
          <path d="M6 12v5c3 2 9 2 12 0v-5" />
          <path d="M22 10v6" />
        </svg>
      );
    case 'tag':
      return (
        <svg {...p}>
          <path d="M20.6 13.4 12 22l-9-9 8.6-8.6a2 2 0 0 1 1.4-.4H20v6.9a2 2 0 0 1-.4 1.5z" />
          <circle cx="16" cy="8" r="1.2" />
        </svg>
      );
    case 'wallet':
      return (
        <svg {...p}>
          <rect x="3" y="7" width="18" height="12" rx="2" />
          <path d="M3 7V6a2 2 0 0 1 2-2h12" />
          <circle cx="16.5" cy="13" r="1.2" />
        </svg>
      );
    case 'newspaper':
      return (
        <svg {...p}>
          <path d="M4 5h12v14H6a2 2 0 0 1-2-2V5z" />
          <path d="M16 8h4v9a2 2 0 0 1-2 2h-2" />
          <path d="M8 9h5M8 13h5M8 17h3" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'help':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 1.9" />
          <path d="M12 17h.01" />
        </svg>
      );
    case 'pen':
      return (
        <svg {...p}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
        </svg>
      );
    case 'briefcase':
      return (
        <svg {...p}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M3 13h18" />
        </svg>
      );
    case 'archive':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="5" rx="1" />
          <path d="M5 8v12h14V8" />
          <path d="M10 12h4" />
        </svg>
      );
    case 'users':
      return (
        <svg {...p}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="3" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a3 3 0 0 1 0 5.74" />
        </svg>
      );
    case 'id':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="12" r="2" />
          <path d="M14 10h4M14 14h4" />
        </svg>
      );
    case 'book':
      return (
        <svg {...p}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...p}>
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.7.9 1.2 1.5 1.2H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18" />
        </svg>
      );
    case 'play':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9l6 3-6 3z" />
        </svg>
      );
    case 'file':
      return (
        <svg {...p}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      );
    case 'clipboard':
      return (
        <svg {...p}>
          <path d="M9 5h6" />
          <rect x="6" y="3" width="12" height="4" rx="1" />
          <path d="M8 7H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case 'card':
      return (
        <svg {...p}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
        </svg>
      );
    case 'invoice':
      return (
        <svg {...p}>
          <path d="M6 2h9l5 5v15H6z" />
          <path d="M15 2v5h5M8 13h8M8 17h5" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

function ChevronIcon({ open }) {
  return (
    <span className={`navChevron ${open ? 'isOpen' : ''}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  );
}

const ITEM_ICONS = {
  dashboard: 'home',
  today: 'sun',
  batches: 'layers',
  calendar: 'calendar',
  review: 'inbox',
  students: 'user',
  leads: 'userPlus',
  subscriptions: 'key',
  'other-users': 'id',
  lessons: 'bookmark',
  courses: 'graduation',
  billing: 'tag',
  payments: 'wallet',
  videos: 'play',
  'study-materials': 'newspaper',
  worksheets: 'grid',
  quizzes: 'help',
  assignments: 'pen',
  settings: 'settings',
};

const SECTION_ICONS = {
  studentsBatches: 'users',
  otherUsers: 'briefcase',
  lessonsCourses: 'graduation',
  library: 'archive',
};

function NavButton({ id, label, currentPage, onNavigate, nested = false, root = false }) {
  return (
    <button
      type="button"
      className={`navItem ${nested ? 'isNested' : ''} ${root ? 'isRoot' : ''} ${currentPage === id ? 'active' : ''}`}
      onClick={() => onNavigate(id)}
    >
      <span className="navItemIcon">
        <Icon name={ITEM_ICONS[id] || 'file'} />
      </span>
      <span className="navItemLabel">{label}</span>
    </button>
  );
}

export default function AdminShell({
  currentPage,
  onNavigate,
  onRefresh,
  onLogout,
  children,
  currentUser = null,
  loadNotifications = null,
  creatorMode = false,
  trainerMode = false,
  showBillingNav = false,
  showPaymentsNav = false,
  showSubscriptionsNav = false,
}) {
  const lessonsCoursesItems = React.useMemo(() => {
    const base = [
      { id: 'lessons', label: 'Lessons' },
      { id: 'courses', label: 'Courses' },
    ];
    if (showBillingNav) base.push({ id: 'billing', label: 'Billing & combos' });
    if (showPaymentsNav) base.push({ id: 'payments', label: 'Payments & invoices' });
    return base;
  }, [showBillingNav, showPaymentsNav]);

  const navSections = React.useMemo(() => {
    if (trainerMode) return [];
    const navCtx = { showSubscriptionsNav, lessonsCoursesItems };
    if (creatorMode) {
      return NAV_SECTIONS_BASE.filter((s) => s.collapseKey === 'library' || s.collapseKey === 'lessonsCourses').map((s) => ({
        ...s,
        items:
          s.collapseKey === 'lessonsCourses'
            ? lessonsCoursesItems.filter((i) => i.id !== 'billing')
            : s.getItems(navCtx),
      }));
    }
    return NAV_SECTIONS_BASE.map((s) => ({
      ...s,
      items: s.collapseKey === 'lessonsCourses' ? lessonsCoursesItems : s.getItems(navCtx),
    }));
  }, [trainerMode, creatorMode, showSubscriptionsNav, lessonsCoursesItems]);

  const [menu, setMenu] = React.useState(null);
  const [openSection, setOpenSection] = React.useState(null);
  const [notifications, setNotifications] = React.useState([]);
  const headerRef = React.useRef(null);

  React.useEffect(() => {
    const match = navSections.find((section) => section.items.some((item) => item.id === currentPage));
    setOpenSection(match ? match.collapseKey : null);
  }, [currentPage, navSections]);

  function toggleSection(key) {
    setOpenSection((prev) => (prev === key ? null : key));
  }

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!loadNotifications) {
        setNotifications([]);
        return;
      }
      try {
        const rows = await loadNotifications();
        if (!cancelled) setNotifications(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadNotifications]);

  React.useEffect(() => {
    function onDocClick(e) {
      if (headerRef.current && !headerRef.current.contains(e.target)) setMenu(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const showDashboard = !creatorMode && !trainerMode;
  const showSettings = !creatorMode && !trainerMode;
  const displayName = currentUser?.name || currentUser?.email || 'Account';
  const displayRole = currentUser?.role || (trainerMode ? 'Trainer' : creatorMode ? 'Creator' : 'Admin');
  const pageTitle = PAGE_TITLES[currentPage] || (trainerMode ? 'Trainer' : 'Admin');
  const photo = currentUser?.profile_photo_url || currentUser?.profile?.profile_photo_url || '';
  const initials = initialsFromName(currentUser?.name, currentUser?.email);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebarBrand">
          <img src={logoLong} alt="EngLeash Academy" className="sidebarBrandLogo" />
        </div>
        <nav className={`nav ${trainerMode ? 'navFlat' : ''}`}>
          {showDashboard ? (
            <NavButton id="dashboard" label="Dashboard" currentPage={currentPage} onNavigate={onNavigate} root />
          ) : null}
          {trainerMode
            ? TRAINER_NAV_ITEMS.map((item) => (
                <NavButton key={item.id} id={item.id} label={item.label} currentPage={currentPage} onNavigate={onNavigate} />
              ))
            : navSections.map((section) => {
                const isOpen = openSection === section.collapseKey;
                const hasActive = section.items.some((item) => item.id === currentPage);
                return (
                  <div
                    key={section.collapseKey}
                    className={`navSection ${isOpen ? 'isOpen' : ''} ${hasActive ? 'hasActive' : ''}`}
                  >
                    <button
                      type="button"
                      className={`navSectionHead ${isOpen ? 'isOpen' : ''} ${hasActive ? 'hasActive' : ''}`}
                      onClick={() => toggleSection(section.collapseKey)}
                      aria-expanded={isOpen}
                    >
                      <span className="navSectionIcon">
                        <Icon name={SECTION_ICONS[section.collapseKey] || 'folder'} />
                      </span>
                      <span className="navSectionTitle">{section.title}</span>
                      <ChevronIcon open={isOpen} />
                    </button>
                    <div className="navSectionBody">
                      {section.items.map((item) => (
                        <NavButton
                          key={item.id}
                          id={item.id}
                          label={item.label}
                          currentPage={currentPage}
                          onNavigate={onNavigate}
                          nested
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
        </nav>
        {showSettings ? (
          <div className="sidebarFooter">
            <NavButton id="settings" label="Settings" currentPage={currentPage} onNavigate={onNavigate} />
          </div>
        ) : null}
      </aside>
      <div className="shellBody">
        <header className="topbar" ref={headerRef}>
          <div className="topbarTitleBlock">
            <h1 className="topbarTitle">{pageTitle}</h1>
            <p className="topbarSubtitle">
              {trainerMode ? 'Trainer workspace' : creatorMode ? 'Creator workspace' : 'Admin workspace'}
            </p>
          </div>
          <div className="topbarActions">
            <button type="button" className="topbarIconBtn" onClick={onRefresh} title="Refresh" aria-label="Refresh">
              <RefreshIcon />
            </button>
            <div className="topbarMenuWrap">
              <button
                type="button"
                className={`topbarIconBtn ${menu === 'notes' ? 'isOpen' : ''}`}
                onClick={() => setMenu((m) => (m === 'notes' ? null : 'notes'))}
                title="Notifications"
                aria-label="Notifications"
                aria-expanded={menu === 'notes'}
              >
                <BellIcon />
                {notifications.length ? <span className="topbarBadge">{notifications.length > 9 ? '9+' : notifications.length}</span> : null}
              </button>
              {menu === 'notes' ? (
                <div className="topbarDropdown topbarDropdownWide" role="menu">
                  <div className="topbarDropdownHead">Notifications</div>
                  {notifications.length === 0 ? (
                    <p className="topbarEmpty">You&apos;re all caught up.</p>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="topbarDropdownItem"
                        onClick={() => {
                          setMenu(null);
                          if (n.page) onNavigate(n.page);
                        }}
                      >
                        <strong>{n.title}</strong>
                        {n.body ? <span>{n.body}</span> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <div className="topbarMenuWrap">
              <button
                type="button"
                className={`topbarProfileBtn ${menu === 'profile' ? 'isOpen' : ''}`}
                onClick={() => setMenu((m) => (m === 'profile' ? null : 'profile'))}
                aria-label="Profile menu"
                aria-expanded={menu === 'profile'}
              >
                <span className="topbarAvatar" aria-hidden>
                  {photo ? <img src={photo} alt="" /> : initials}
                </span>
                <span className="topbarProfileText">
                  <span className="topbarProfileName">{displayName}</span>
                  <span className="topbarProfileRole">{displayRole}</span>
                </span>
              </button>
              {menu === 'profile' ? (
                <div className="topbarDropdown" role="menu">
                  <div className="topbarDropdownUser">
                    <div className="topbarDropdownName">{displayName}</div>
                    {currentUser?.email ? <div className="topbarDropdownEmail">{currentUser.email}</div> : null}
                  </div>
                  {showSettings ? (
                    <button
                      type="button"
                      className="topbarDropdownItem"
                      onClick={() => {
                        setMenu(null);
                        onNavigate('settings');
                      }}
                    >
                      Settings
                    </button>
                  ) : null}
                  <button type="button" className="topbarDropdownItem danger" onClick={onLogout}>
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
