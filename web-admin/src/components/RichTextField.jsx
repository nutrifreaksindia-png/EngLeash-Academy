import React from 'react';
import {
  Editor,
  EditorProvider,
  Toolbar,
  BtnBold,
  BtnItalic,
  BtnUnderline,
  BtnNumberedList,
  BtnBulletList,
  BtnLink,
} from 'react-simple-wysiwyg';

const PALETTE = ['#111827', '#334155', '#1e3a8a', '#0f766e', '#166534', '#b45309', '#b91c1c', '#7c3aed'];

function runCommand(command, value) {
  if (typeof document === 'undefined') return;
  document.execCommand(command, false, value);
}

function titleCase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function sentenceCase(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function smallCaps(text) {
  return String(text || '').toLowerCase();
}

function transformSelectedText(mode) {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const selected = range.toString();
  if (!selected) return;
  let next = selected;
  if (mode === 'allCaps') next = selected.toUpperCase();
  if (mode === 'smallCaps') next = smallCaps(selected);
  if (mode === 'titleCase') next = titleCase(selected);
  if (mode === 'sentenceCase') next = sentenceCase(selected);
  range.deleteContents();
  range.insertNode(document.createTextNode(next));
  sel.removeAllRanges();
}

/** Editor must be inside EditorProvider or useEditorState() throws (blank screen). */
export default function RichTextField({ value, onChange }) {
  return (
    <div className="richWrap">
      <EditorProvider>
        <Editor value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <Toolbar>
            <BtnBold />
            <BtnItalic />
            <BtnUnderline />
            <BtnNumberedList />
            <BtnBulletList />
            <BtnLink />
            <button type="button" className="rsw-btn" title="Align left" onClick={() => runCommand('justifyLeft')}>L</button>
            <button type="button" className="rsw-btn" title="Align center" onClick={() => runCommand('justifyCenter')}>C</button>
            <button type="button" className="rsw-btn" title="Align right" onClick={() => runCommand('justifyRight')}>R</button>
            <button type="button" className="rsw-btn" title="Justify" onClick={() => runCommand('justifyFull')}>J</button>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="rsw-btn richColorBtn"
                title={`Text color ${c}`}
                onClick={() => runCommand('foreColor', c)}
              >
                <span className="richColorDot" style={{ backgroundColor: c }} />
              </button>
            ))}
            <button type="button" className="rsw-btn" title="All caps" onClick={() => transformSelectedText('allCaps')}>AA</button>
            <button type="button" className="rsw-btn" title="Small caps" onClick={() => transformSelectedText('smallCaps')}>Aa</button>
            <button type="button" className="rsw-btn" title="Title case" onClick={() => transformSelectedText('titleCase')}>Tt</button>
            <button type="button" className="rsw-btn" title="Sentence case" onClick={() => transformSelectedText('sentenceCase')}>Ss</button>
          </Toolbar>
        </Editor>
      </EditorProvider>
    </div>
  );
}
