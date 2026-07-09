# Supabase — banco de dados, autenticação e duplicação do projeto

## Aplicando o schema (projeto novo / duplicação)

Os quatro arquivos em `/supabase` são a fonte da verdade do banco e devem ser aplicados **nesta ordem** (via SQL Editor do Supabase, `supabase db push`, ou MCP `apply_migration`):

1. `schema.sql` — extensões, tabelas, índices, constraints.
2. `functions.sql` — funções e triggers (todas `SECURITY DEFINER`, sem grants ainda).
3. `rls.sql` — habilita RLS, cria as policies e concede os grants (tabela e função).
4. `seed.sql` — parâmetros iniciais e grade de horários de exemplo.

Esses arquivos já refletem duas correções encontradas em testes reais (não apenas leitura de código):

- **Ambiguidade de colunas em PL/pgSQL**: como `fn_create_reservation` e `fn_cancel_reservation_public` usam `RETURNS TABLE(...)` com colunas chamadas `id`, `status`, `party_size` etc., referências *sem* alias a colunas de mesmo nome em `reservations` ficavam ambíguas (`column reference "id" is ambiguous`). Corrigido qualificando todas as referências com alias de tabela.
- **Schema do pgcrypto**: `gen_random_bytes()` e `digest()` (usados para gerar/hashear o token de cancelamento) estão instalados no schema `extensions`, não em `public`. Como as funções fixam `search_path = public, pg_temp` (para evitar sequestro de search_path), as chamadas precisam ser qualificadas como `extensions.gen_random_bytes(...)` / `extensions.digest(...)`.
- **Policies sem `to <role>`**: toda policy RLS declara explicitamente `to anon` / `to authenticated`. Sem isso, o Postgres avalia *todas* as policies permissivas da tabela para qualquer papel — inclusive as que chamam `fn_is_admin()`/`fn_is_active_staff()` — e como essas funções não têm `EXECUTE` liberado para `anon`, a consulta falhava com `permission denied for function fn_is_admin` mesmo em tabelas que deveriam ter uma parte pública (`restaurant_settings`).

Se for reaplicar em um projeto novo do zero, esses três pontos já estão corrigidos nos arquivos — não precisa repetir a descoberta.

## Extensões usadas

- `pgcrypto` (schema `extensions`) — hash do token de cancelamento, geração de bytes aleatórios.
- `citext` (schema `public`) — e-mail case-insensitive. O linter de segurança do Supabase recomenda mover extensões para fora do schema `public`; não fizemos isso porque `citext` já é usado como **tipo de coluna** em `app_users`, `customers` e `reservations` — mover a extensão exigiria recriar essas colunas. É um aviso de baixa severidade (organização de schema, não uma vulnerabilidade), documentado aqui conscientemente.

## Autenticação: Google OAuth

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto (ou use um existente) e configure uma tela de consentimento OAuth.
2. Crie uma credencial "OAuth client ID" do tipo **Web application**.
3. Em "Authorized redirect URIs", adicione a URL de callback do Supabase Auth, no formato:
   `https://SEU-PROJETO.supabase.co/auth/v1/callback`
4. No painel Supabase: **Authentication > Providers > Google**, ative o provedor e cole o Client ID e Client Secret gerados no passo 2.
5. Em **Authentication > URL Configuration**, adicione a URL do seu site publicado (GitHub Pages) em "Redirect URLs" (ex.: `https://seuusuario.github.io/reservas/admin/dashboard.html`), além de `http://localhost:8000/admin/dashboard.html` para testes locais.

Login com Google **não libera acesso ao painel por si só** — ele só autentica. A autorização real é feita pela tabela `app_users` (ver abaixo) e pelas policies de RLS.

## Cadastrando o primeiro administrador

Como o painel só é acessível a quem já tem uma linha em `app_users`, e a tela de "Usuários" só existe dentro do painel (que exige acesso), o **primeiro** administrador precisa ser cadastrado manualmente uma única vez, direto no banco (SQL Editor do Supabase ou MCP):

```sql
insert into public.app_users (email, name, role, active)
values ('seu-email@gmail.com', 'Seu Nome', 'admin', true);
```

Depois disso, ao fazer login com Google usando esse e-mail pela primeira vez, o sistema vincula automaticamente a conta (função `fn_claim_app_user`, chamada pelo painel a cada carregamento de página). A partir daí, esse admin pode cadastrar todos os outros usuários (admins e operadores) diretamente pela tela **Usuários** do painel — sem precisar mexer no banco de novo.

## Estrutura geral

Ver o resumo de tabelas/funções/policies no arquivo de plano da sessão de implementação, ou diretamente nos arquivos SQL comentados em `/supabase`. Resumo rápido:

- **Nenhum papel** tem `DELETE` em `reservations` ou `reservation_status_history` — apagar fisicamente uma reserva é impossível pela API.
- **`anon`** não tem nenhum grant de tabela, exceto `SELECT` em `restaurant_settings` (filtrado por RLS a `is_public = true`). Toda a interação pública (consultar horários, criar reserva, cancelar) passa pelas 3 funções `SECURITY DEFINER`: `get_available_time_slots`, `fn_create_reservation`, `fn_cancel_reservation_public`.
- **Operador** só alcança `reservations` para leitura direta e por duas RPCs (`fn_update_reservation_status`, `fn_update_internal_notes`) — nunca por `UPDATE` direto na tabela.
- **Admin** tem `UPDATE` direto em `reservations` (edição completa) e CRUD completo em configurações/bloqueios/usuários.

## Advisors do Supabase

Depois de qualquer alteração de schema, rode os advisors de segurança e performance (`get_advisors` via MCP, ou Database > Advisors no painel). Ao final desta implementação, os únicos avisos restantes são:

- `citext` instalado em `public` (ver acima, aceito conscientemente).
- As 3 funções públicas (`get_available_time_slots`, `fn_create_reservation`, `fn_cancel_reservation_public`) aparecem como "executável por anon" — isso é *intencional*, é exatamente a superfície pública da API.
- `rls_auto_enable()` — função interna do próprio Supabase (não criada por este projeto), do tipo `event trigger`; não pode ser chamada diretamente via RPC independentemente do grant.

Qualquer outro aviso novo que aparecer no futuro merece investigação antes de ser ignorado.
