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
      <link rel="stylesheet" href="/styles/dashboard.css" />
      <main
        style={{
          minHeight: '100vh',
          // Cena noturna FIXA (não segue o tema) — gradiente petróleo North Editorial
          background: 'linear-gradient(180deg, #0D1215 0%, #132630 60%, #0F2028 100%)',
          color: '#ECEFEA',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'var(--f-body, system-ui, -apple-system, sans-serif)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Auroras teal por trás do card pra dar profundidade na cena noturna */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        }}>
          <div style={{
            position: 'absolute', top: '-15%', left: '-10%',
            width: 700, height: 700, borderRadius: '50%',
            background: 'radial-gradient(circle, #3EB7D4, transparent 60%)',
            filter: 'blur(80px)', opacity: 0.35,
          }}/>
          <div style={{
            position: 'absolute', bottom: '-20%', right: '-15%',
            width: 700, height: 700, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(62,183,212,0.18), transparent 60%)',
            filter: 'blur(80px)', opacity: 0.30,
          }}/>
        </div>

        <div
          className="lg-deep"
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            maxWidth: 380,
            padding: 32,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <img src="/assets/logo-mark-dark.svg" alt="" width={36} height={36} className="logo-mark logo-dark" />
            <img src="/assets/logo-mark-light.svg" alt="" width={36} height={36} className="logo-mark logo-light" />
            <div style={{ fontFamily: 'var(--f-display, serif)', fontSize: 22, lineHeight: 1 }}>
              north<em style={{ color: '#3EB7D4' }}>scale</em>
            </div>
          </div>

          <div
            style={{
              fontFamily: 'var(--f-mono, ui-monospace, monospace)',
              fontSize: 10,
              letterSpacing: '0.15em',
              color: '#92A1A1',
              marginBottom: 6,
            }}
          >
            ENTRAR
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500, marginBottom: 20 }}>
            Acessar o <em style={{ color: '#3EB7D4', fontStyle: 'normal' }}>dashboard</em>
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
              className="lg-cyan"
              style={{
                marginTop: 6,
                padding: '12px 16px',
                borderRadius: 999,
                fontFamily: 'var(--f-mono, ui-monospace, monospace)',
                fontSize: 12,
                letterSpacing: '0.08em',
                fontWeight: 600,
                color: '#fff',
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.7 : 1,
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
              color: '#71807F',
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
          color: '#92A1A1',
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
          color: '#ECEFEA',
          background: '#161D21',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          outline: 'none',
          fontFamily: 'inherit',
          transition: 'border-color 150ms, background 150ms',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = '#3EB7D4';
          e.currentTarget.style.background = '#1B252B';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
          e.currentTarget.style.background = '#161D21';
        }}
      />
    </label>
  );
}
