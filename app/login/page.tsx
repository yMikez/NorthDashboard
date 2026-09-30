'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

// Tela de login no NorthScale Design System 1.0: interface clara (segue o
// tema do html[data-theme]), só tokens var(--…), sem efeito decorativo.
// Marca: logotipo oficial em arquivo — nunca recomposto com fonte.

// Estado que estilo inline não alcança (hover, pressionado, processando,
// alvo de toque). Classes com prefixo ns-login- pra não vazar pro resto da SPA.
const loginCss = `
/* Processando: aria-disabled (não disabled) pra não derrubar o foco de quem
   acionou pelo teclado. A regra global .btn[aria-disabled] apaga pra 45% —
   aqui o botão está trabalhando, não indisponível, então segue legível. */
.btn.ns-login-submit[aria-disabled="true"],
.btn.ns-login-submit[aria-disabled="true"]:hover {
  opacity: 1;
  cursor: progress;
  background: var(--cta);
  border-color: var(--cta);
}
/* Mostrar senha: alvo de 44 px (altura inteira do campo). A borda
   transparente de 4 px recua o fundo visível sem encolher o alvo. */
.ns-login-toggle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  min-width: 44px;
  padding: 0 12px;
  font-family: var(--f-body);
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--accent);
  background: transparent;
  background-clip: padding-box;
  border: 4px solid transparent;
  border-radius: calc(var(--r-sm) + 4px);
  cursor: pointer;
}
.ns-login-toggle:hover { background-color: var(--bg-hover); }
.ns-login-toggle[aria-pressed="true"] {
  background-color: var(--bg-hover);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.ns-login-toggle:focus-visible { outline-offset: -3px; }
.ns-login-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (pointer: coarse) {
  /* 16px evita o zoom automático do iOS ao focar o campo */
  .ns-login-input { font-size: 16px !important; }
}
`;

type LoginError = { message: string; credentials: boolean };

/** Destino pós-login: só caminho do mesmo site. Bloqueia ?next=https://…,
 *  //host e javascript: (redirecionamento aberto / XSS no login). */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  try {
    const target = new URL(raw, window.location.origin);
    if (target.origin !== window.location.origin) return '/';
    const path = `${target.pathname}${target.search}${target.hash}`;
    // Mesma origem não basta: "https://<este site>//evil.com" e "/.//evil.com"
    // viram o caminho "//evil.com", que o navegador lê como OUTRO domínio.
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/';
    return path;
  } catch {
    return '/';
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const errorId = useId();

  // Voltar do dashboard pelo histórico (bfcache) restauraria o botão preso
  // em "Entrando…"; a página volta pronta pra novo envio.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      busyRef.current = false;
      setBusy(false);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  function fail(message: string, credentials = false) {
    setError({ message, credentials });
    busyRef.current = false;
    setBusy(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Bloqueia reenvio (Enter no campo ou clique repetido) enquanto processa.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        if (res.status === 401) fail('E-mail ou senha incorretos.', true);
        else fail(`Não foi possível entrar (erro ${res.status}). Tente de novo.`);
        return;
      }
      // Sucesso: segue em "Entrando…" até a navegação trocar a página.
      window.location.href = safeNext(new URL(window.location.href).searchParams.get('next'));
    } catch {
      fail('Falha de rede. Verifique a conexão e tente de novo.');
    }
  }

  const describedBy = error ? errorId : undefined;
  const invalid = !!error?.credentials;

  return (
    <>
      <link rel="stylesheet" href="/styles/colors_and_type.css" />
      <link rel="stylesheet" href="/styles/dashboard.css" />
      <style>{loginCss}</style>
      <main
        style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          color: 'var(--fg1)',
          display: 'grid',
          placeItems: 'center',
          padding: 16,
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          lineHeight: '22px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            padding: 'clamp(24px, 6vw, 32px)',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <img
              src="/assets/brand/logo-azul-preto.svg"
              alt="NorthScale"
              className="ns-only-light"
              style={{ height: 32, width: 'auto', maxWidth: '100%', display: 'block' }}
            />
            <img
              src="/assets/brand/logo-azulclaro-branco.svg"
              alt="NorthScale"
              className="ns-only-dark"
              style={{ height: 32, width: 'auto', maxWidth: '100%', display: 'block' }}
            />
          </div>

          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontSize: 28,
              lineHeight: '36px',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              fontVariationSettings: 'normal',
              color: 'var(--fg1)',
            }}
          >
            Acessar o dashboard
          </h1>
          <p style={{ margin: '8px 0 24px', fontSize: 14, lineHeight: '22px', color: 'var(--fg4)' }}>
            Use o e-mail e a senha da sua conta.
          </p>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
            <Field
              label="E-mail"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
              required
              autoFocus
              invalid={invalid}
              describedBy={describedBy}
            />
            <Field
              label="Senha"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
              invalid={invalid}
              describedBy={describedBy}
              reveal={{ shown: showPassword, onToggle: () => setShowPassword((v) => !v) }}
            />

            {error && (
              <div
                id={errorId}
                role="alert"
                style={{
                  fontSize: 14,
                  lineHeight: '22px',
                  color: 'var(--danger)',
                  background: 'var(--danger-bg)',
                  padding: '8px 12px',
                  borderRadius: 'var(--r-md)',
                }}
              >
                {error.message}
              </div>
            )}

            <button
              type="submit"
              aria-disabled={busy || undefined}
              className="btn btn-primary ns-login-submit"
              style={{
                width: '100%',
                height: 44,
                padding: '0 22px',
                fontFamily: 'var(--f-body)',
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
              }}
            >
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </form>

          <p style={{ margin: '24px 0 0', fontSize: 14, lineHeight: '22px', color: 'var(--fg4)' }}>
            Sem acesso? Peça ao administrador do time.
          </p>
        </div>
      </main>
    </>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  value,
  onChange,
  required,
  autoFocus,
  invalid,
  describedBy,
  reveal,
}: {
  label: string;
  name: string;
  type: 'email' | 'password' | 'text';
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Senha: botão Mostrar dentro do campo. Botão de alternância — o nome
   *  fica fixo ("Mostrar senha") e o estado vai em aria-pressed; trocar o
   *  rótulo junto com o estado faria o leitor ler "Ocultar senha, pressionado". */
  reveal?: { shown: boolean; onToggle: () => void };
}) {
  const id = useId();
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label
        htmlFor={id}
        style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--fg2)' }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          name={name}
          className="ns-login-input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          style={{
            display: 'block',
            width: '100%',
            height: 44,
            padding: reveal ? '0 96px 0 12px' : '0 12px',
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            color: 'var(--fg1)',
            background: 'var(--bg-raised)',
            border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--r-md)',
          }}
        />
        {reveal && (
          <button
            type="button"
            className="ns-login-toggle"
            aria-pressed={reveal.shown}
            aria-controls={id}
            onClick={reveal.onToggle}
          >
            Mostrar<span className="ns-login-sr"> senha</span>
          </button>
        )}
      </div>
    </div>
  );
}
