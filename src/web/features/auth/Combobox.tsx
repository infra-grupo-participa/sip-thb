import { useEffect, useRef, useState } from 'react';

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlight(text: string, term: string): string {
  if (!term) return escapeHtml(text);
  const t = escapeHtml(text);
  const re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return t.replace(re, '<span class="match">$1</span>');
}

interface ComboboxProps {
  id: string;
  value: string;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
}

// Combobox custom portado de cadastro.html (setupCombobox).
export default function Combobox({
  id,
  value,
  options,
  disabled,
  placeholder,
  maxLength,
  onChange,
  onCommit,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const term = norm(value.trim());
  const filtered = (term ? options.filter((o) => norm(o).includes(term)) : options).slice(0, 200);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  function selectOption(v: string) {
    onChange(v);
    if (onCommit) onCommit(v);
    setOpen(false);
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setActiveIdx((i) => Math.max(0, i - 1));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const pick = activeIdx >= 0 ? filtered[activeIdx] : filtered[0];
      if (pick) {
        selectOption(pick);
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={`combobox${open ? ' is-open' : ''}`} ref={wrapRef}>
      <input
        type="text"
        id={id}
        className="hb-input combobox-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
          if (onCommit) onCommit(value);
        }}
        onKeyDown={onKeyDown}
      />
      <svg className="combobox-toggle" width="12" height="8" viewBox="0 0 12 8" fill="none">
        <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="combobox-list" role="listbox" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="combobox-empty">Nenhum resultado.</div>
        ) : (
          filtered.map((o, i) => (
            <div
              key={o}
              className={`combobox-item${i === activeIdx ? ' is-active' : ''}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(o);
              }}
              dangerouslySetInnerHTML={{ __html: highlight(o, value.trim()) }}
            />
          ))
        )}
      </div>
    </div>
  );
}
