import React from 'react';

export default function StatusBanner({ error, message }) {
  if (!error && !message) return null;
  return (
    <div className={`banner ${error ? 'error' : 'success'}`}>
      {error || message}
    </div>
  );
}
