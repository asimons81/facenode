import React, { useState } from 'react';

// ── Design tokens ─────────────────────────────────────────────────────────────

export const C = {
  bg:        '#0d0d12',
  panel:     '#13131a',
  border:    '#2a2a38',
  accent:    '#4FB7A0',
  text:      '#d0d0e0',
  textDim:   '#6b6b88',
  inputBg:   '#1c1c28',
  danger:    '#e05c5c',
} as const;

// ── Section (collapsible) ─────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: C.text,
          fontFamily: 'monospace',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        <span>{title}</span>
        <span style={{ color: C.textDim, fontSize: '10px' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '4px 12px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Row layout helper ─────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  children: React.ReactNode;
}

export function Row({ label, children }: RowProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: '8px',
      gap: '8px',
    }}>
      <span style={{ color: C.textDim, fontSize: '11px', flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {children}
      </div>
    </div>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  accentColor?: string;
  onChange: (v: number) => void;
}

export function Slider({ label, value, min = 0, max = 1, step = 0.01, accentColor = C.accent, onChange }: SliderProps) {
  return (
    <Row label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100px', accentColor }}
      />
      <span style={{ color: C.text, fontSize: '11px', width: '30px', textAlign: 'right' }}>
        {value.toFixed(2)}
      </span>
    </Row>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

interface ToggleProps {
  label: string;
  value: boolean;
  accentColor?: string;
  onChange: (v: boolean) => void;
}

export function Toggle({ label, value, accentColor = C.accent, onChange }: ToggleProps) {
  return (
    <Row label={label}>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: '36px',
          height: '20px',
          borderRadius: '10px',
          border: 'none',
          cursor: 'pointer',
          background: value ? accentColor : C.border,
          position: 'relative',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          top: '3px',
          left: value ? '19px' : '3px',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }} />
      </button>
    </Row>
  );
}

// ── SegmentedControl ──────────────────────────────────────────────────────────

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  accentColor?: string;
  onChange: (v: T) => void;
}

export function SegmentedControl<T extends string>({ label, value, options, accentColor = C.accent, onChange }: SegmentedControlProps<T>) {
  return (
    <Row label={label}>
      <div style={{
        display: 'flex',
        border: `1px solid ${C.border}`,
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '3px 8px',
              fontSize: '10px',
              fontFamily: 'monospace',
              border: 'none',
              borderRight: `1px solid ${C.border}`,
              cursor: 'pointer',
              background: value === opt.value ? accentColor : C.inputBg,
              color: value === opt.value ? '#000' : C.textDim,
              fontWeight: value === opt.value ? 600 : 400,
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

// ── ColorPicker ───────────────────────────────────────────────────────────────

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <Row label={label}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '32px',
          height: '22px',
          border: `1px solid ${C.border}`,
          borderRadius: '3px',
          cursor: 'pointer',
          background: 'none',
          padding: '1px',
        }}
      />
      <span style={{ color: C.text, fontSize: '11px', fontFamily: 'monospace' }}>{value}</span>
    </Row>
  );
}

// ── TextInput ─────────────────────────────────────────────────────────────────

interface TextInputProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}

export function TextInput({ label, value, placeholder, onChange }: TextInputProps) {
  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ color: C.textDim, fontSize: '11px', marginBottom: '4px' }}>{label}</div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          background: C.inputBg,
          border: `1px solid ${C.border}`,
          borderRadius: '4px',
          color: C.text,
          fontFamily: 'monospace',
          fontSize: '11px',
          padding: '5px 7px',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}
