'use client';

import { useState, type FormEvent } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        if (res.status === 401) setError('Credenciais inválidas');
        else setError(`Erro ${res.status}`);
        setBusy(false);
        return;
      }
      const url = new URL(window.location.href);
      const next = url.searchParams.get('next') || '/';
      window.location.href = next;
    } catch (err) {
      setError('Falha de rede — tenta de novo.');
      setBusy(false);
    }
  }

  return (
    <>
      <link rel="stylesheet" href="/styles/colors_and_type.css" />
      <main
        style={{
          minHeight: '100vh',
          background: 'var(--navy-950)',
          color: 'var(--white)',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'var(--f-body, system-ui, -apple-system, sans-serif)',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 380,
            background: 'rgba(15,31,77,0.45)',
            border: '1px solid rgba(91,200,255,0.18)',
            borderRadius: 12,
            padding: 32,
            boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(91,200,255,0.05) inset',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <img src="/assets/logo-mark-dark.svg" alt="" width={36} height={36} />
            <div style={{ fontFamily: 'var(--f-display, serif)', fontSize: 22, lineHeight: 1 }}>
              north<em style={{ color: 'var(--glow-cyan)' }}>scale</em>
            </div>
          </div>

          <div
            style={{
              fontFamily: 'var(--f-mono, ui-monospace, monospace)',
              fontSize: 10,
              letterSpacing: '0.15em',
              color: 'var(--navy-300)',
              marginBottom: 6,
            }}
          >
            ENTRAR
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500, marginBottom: 20 }}>
            Acessar o <em style={{ color: 'var(--glow-cyan)', fontStyle: 'normal' }}>dashboard</em>
          </h1>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
            <Field
              label="E-mail"
              type="email"
              value={email}
              onChange={setEmail}
              required
              autoFocus
            />
            <Field
              label="Senha"
              type="password"
              value={password}
              onChange={setPassword}
              required
            />

            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--danger)',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontFamily: 'var(--f-mono, ui-monospace, monospace)',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                marginTop: 6,
                padding: '12px 16px',
                borderRadius: 6,
                fontFamily: 'var(--f-mono, ui-monospace, monospace)',
                fontSize: 12,
                letterSpacing: '0.08em',
                fontWeight: 600,
                background: busy ? 'rgba(91,200,255,0.4)' : 'var(--glow-cyan)',
                color: 'var(--navy-950)',
                border: 0,
                cursor: busy ? 'wait' : 'pointer',
                transition: 'opacity 0.15s',
              }}
            >
              {busy ? 'ENTRANDO...' : 'ENTRAR'}
            </button>
          </form>

          <div
            style={{
              marginTop: 22,
              fontSize: 11,
              color: 'var(--navy-400)',
              fontFamily: 'var(--f-mono, ui-monospace, monospace)',
              lineHeight: 1.5,
            }}
          >
            Sem acesso? Pede pro admin do time criar.
          </div>
        </div>
      </main>
    </>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  required,
  autoFocus,
}: {
  label: string;
  type: 'email' | 'password' | 'text';
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span
        style={{
          fontFamily: 'var(--f-mono, ui-monospace, monospace)',
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'var(--navy-300)',
        }}
      >
        {label.toUpperCase()}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        autoComplete={type === 'password' ? 'current-password' : 'email'}
        style={{
          padding: '10px 12px',
          fontSize: 13,
          color: 'var(--white)',
          background: 'rgba(91,200,255,0.05)',
          border: '1px solid rgba(91,200,255,0.2)',
          borderRadius: 6,
          outline: 'none',
          fontFamily: 'inherit',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--glow-cyan)';
          e.currentTarget.style.background = 'rgba(91,200,255,0.1)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(91,200,255,0.2)';
          e.currentTarget.style.background = 'rgba(91,200,255,0.05)';
        }}
      />
    </label>
  );
}
