import React from 'react';

export default function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section className="sectionCard">
      <div className="sectionHead">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
