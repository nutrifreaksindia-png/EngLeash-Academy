import React from 'react';

const NAV_SECTIONS = [
  {
    collapseKey: 'studentsBatches',
    title: 'Students & Batches',
    items: [
      { id: 'students', label: 'Students' },
      { id: 'batches', label: 'Batches' },
      { id: 'approvals', label: 'Pending Approvals' },
    ],
  },
  {
    collapseKey: 'otherUsers',
    title: 'Other Users',
    items: [{ id: 'other-users', label: 'Directory' }],
  },
  {
    collapseKey: 'lessonsCourses',
    title: 'Lessons & Courses',
    items: [
      { id: 'lessons', label: 'Lessons' },
      { id: 'courses', label: 'Courses' },
    ],
  },
  {
    collapseKey: 'library',
    title: 'Library',
    items: [
      { id: 'videos', label: 'Videos' },
      { id: 'study-materials', label: 'Study Materials' },
      { id: 'worksheets', label: 'Worksheets' },
      { id: 'quizzes', label: 'Quiz Bank' },
      { id: 'assignments', label: 'Assignments' },
    ],
  },
];

export default function AdminShell({ currentPage, onNavigate, onRefresh, onLogout, children, creatorMode = false }) {
  const navSections = creatorMode
    ? NAV_SECTIONS.filter((s) => s.collapseKey === 'library' || s.collapseKey === 'lessonsCourses')
    : NAV_SECTIONS;
  const [collapsed, setCollapsed] = React.useState({
    studentsBatches: true,
    otherUsers: true,
    lessonsCourses: true,
    library: true,
  });

  React.useEffect(() => {
    if (creatorMode) {
      setCollapsed({ studentsBatches: true, otherUsers: true, lessonsCourses: false, library: false });
    }
  }, [creatorMode]);

  function toggle(sectionKey) {
    setCollapsed((prev) => {
      const nextOpen = !prev[sectionKey];
      return {
        studentsBatches: sectionKey === 'studentsBatches' ? nextOpen : true,
        otherUsers: sectionKey === 'otherUsers' ? nextOpen : true,
        lessonsCourses: sectionKey === 'lessonsCourses' ? nextOpen : true,
        library: sectionKey === 'library' ? nextOpen : true,
      };
    });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">EngLeash Admin</div>
        {!creatorMode ? (
          <button
            className={`navItem ${currentPage === 'dashboard' ? 'active' : ''}`}
            onClick={() => onNavigate('dashboard')}
          >
            Dashboard
          </button>
        ) : null}
        <nav className="nav">
          {navSections.map((section) => {
            const { collapseKey } = section;
            const isCollapsed = collapsed[collapseKey];
            return (
              <div key={section.title} className="navSection">
                <button type="button" className="navSectionTitleBtn" onClick={() => toggle(collapseKey)}>
                  <span>{section.title}</span>
                  <span>{isCollapsed ? '+' : '-'}</span>
                </button>
                {!isCollapsed ? section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`navItem ${currentPage === item.id ? 'active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                  >
                    {item.label}
                  </button>
                )) : null}
              </div>
            );
          })}
        </nav>
        {!creatorMode ? (
          <button
            type="button"
            className={`navItem sidebarSettingsBtn ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => onNavigate('settings')}
          >
            Settings
          </button>
        ) : null}
        <div className="sidebarActions">
          <button className="secondaryBtn" onClick={onRefresh}>Refresh</button>
          <button className="dangerBtn" onClick={onLogout}>Logout</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
