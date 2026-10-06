# Sir Fisher Praia — Portal de Reservas

Site de reservas para o restaurante Sir Fisher Praia. HTML/CSS/JS puro (sem build step, sem framework), Supabase como backend, compatível com GitHub Pages.

- Reserva automática, com confirmação imediata (sem aprovação manual).
- Cancelamento público via link seguro (token).
- Painel administrativo com login Google e dois perfis (admin/operador).
- Toda regra operacional (capacidade, horários, corte de mesmo dia, bloqueios) é configurável pelo painel — nada fixo no código.

## Documentação

- [`docs/setup.md`](docs/setup.md) — instalação e configuração geral.
- [`docs/supabase.md`](docs/supabase.md) — banco de dados, RLS, Google OAuth, primeiro admin.
- [`docs/github-pages.md`](docs/github-pages.md) — publicação.
- [`docs/admin-guide.md`](docs/admin-guide.md) — manual do painel.
- [`docs/email.md`](docs/email.md) — e-mail de confirmação automático (Resend + Edge Function).
- [`docs/openai-ads.md`](docs/openai-ads.md) — medição de reservas e comparecimentos do ChatGPT Ads.
- [`docs/medicao-google.md`](docs/medicao-google.md) — origem, reservas e comparecimentos no Google Analytics.
- [`docs/privacidade-dados.md`](docs/privacidade-dados.md) — quais dados são salvos e por quê.
- [`docs/security-checklist.md`](docs/security-checklist.md) — checklist de testes manuais.
- [`docs/reveillon.md`](docs/reveillon.md) — módulo de Réveillon (mesas numeradas, pré-reserva, sinal, portaria).
- [`docs/future-roadmap.md`](docs/future-roadmap.md) — fase 2 (não implementada).

## Estrutura

```
index.html, cancelar.html   — site público
reveillon.html              — venda das mesas do Réveillon (módulo separado)
admin/                      — painel administrativo
assets/css/, assets/js/     — estilos e módulos JS
supabase/                   — schema.sql, functions.sql, rls.sql, seed.sql; reveillon-*.sql (módulo de Réveillon)
supabase/functions/         — Edge Functions (send-notifications: e-mail de confirmação)
docs/                       — documentação
```
