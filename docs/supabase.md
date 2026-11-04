# Supabase — banco de dados, autenticação e duplicação do projeto

## Vouchers de benefício

A página `admin/vouchers.html`, acessível pelo menu **Vouchers** e pelo
atalho **Consultar voucher** no dashboard, consulta e registra o uso dos
vouchers emitidos pelos sócios no portal de gestão. Esse módulo é separado
das reservas, códigos de pré-reserva, pagamentos e consumação do Réveillon.
Não altera `reservations`, `customers` nem as tabelas `rv_*`.

O acesso reutiliza a sessão Google e o cadastro ativo em `app_users`, com
os perfis existentes `admin` e `operator`. A guarda da interface apenas
organiza a navegação: as RPCs conferem a autorização no servidor. O código
identifica o voucher e não libera acesso público nem concede permissão de
utilização. O formulário não coloca códigos na URL, no armazenamento local
ou em ferramentas de análise.
O código usa o alfabeto Crockford de 32 símbolos, incluindo `0` e `1`.
A consulta aceita prefixo `SF` opcional e interpreta `O` como `0` e `I`/`L`
como `1`, seguindo a normalização do servidor.

O backend é versionado no repositório `gestao`, na migration
`supabase/migrations/20261104200024_benefit_vouchers.sql`, aplicada e
confirmada no projeto `portal` em 04/11/2026. O ensaio transacional dos
perfis reais passou com reversão dos dados de teste. As RPCs autenticadas
deste fluxo usam o prefixo `benefit_voucher_`:

- `benefit_voucher_lookup(p_code text)` consulta o código e devolve
  `{ok, reason, voucher}`. Ausência, código inválido e limite de consultas
  aparecem respectivamente como `not_found`, `invalid_code` e `rate_limited`.
- `benefit_voucher_redeem(p_id uuid, p_confirm boolean)` exige confirmação
  explícita e faz o resgate único no servidor. A página envia `p_confirm = true`
  somente depois do diálogo e da conferência marcada pelo gerente. O UUID
  vem da consulta autenticada, não de parâmetros livres da URL.

O objeto de consulta contém código, beneficiário, tipo e valor do benefício,
validade, unidade, condições, situação e os dados necessários à conferência
da utilização/cancelamento. Telefone, motivo da emissão e observação interna
ficam restritos à gestão e não são exibidos nesta consulta.
O módulo da interface mantém somente os campos permitidos da resposta e
escreve textos do servidor com `textContent`.

As situações são `available`, `used`, `expired` e `cancelled`. A data final
vale inclusive até o fim do dia em `America/Fortaleza`; a página mostra
**até 23h59, horário de Fortaleza**. Datas puras não passam por conversão de
fuso. Horários de utilização/cancelamento são convertidos explicitamente
para Fortaleza. O navegador não decide se um voucher está vencido.

As condições vêm do servidor: uso único sem saldo remanescente, sem acúmulo
com promoções ou outro voucher na mesma conta; percentual sobre a conta
inteira, sem teto, com taxa de serviço opcional; unidade Sir Fisher.
A validade padrão é de 30 dias, ajustável pelo emissor no portal de gestão.
Percentuais são exibidos como percentuais, valores fixos como reais.

Durante uma operação a página bloqueia ações concorrentes. Uma recusa ou
erro no resgate provoca somente uma nova **consulta**, nunca reenvio
automático da utilização. Se a resposta for incerta, o gerente deve conferir
a situação, data e responsável e consultar novamente antes de aplicar o
benefício. A ação fica bloqueada até uma nova consulta manual bem-sucedida.
Vouchers utilizados, vencidos e cancelados não exibem ação de utilização.

Validação local do fluxo da interface, sem banco nem cliente real:

```text
node --test tools/benefit_vouchers_test.mjs
```

Com Deno, o mesmo teste roda com
`deno test --allow-read tools/benefit_vouchers_test.mjs`.

Os testes exercitam confirmação, clique simultâneo, recusa por concorrência,
resposta perdida após gravação, reconsulta indisponível, perfil sem permissão,
campos privados, situações terminais, códigos e formatos de benefício/data.
Não substituem os testes transacionais das RPCs nem a conferência visual em
celular. A página não usa câmera nem biblioteca externa de QR Code.

## Consentimento de publicidade por reserva (03/11/2026)

Migration `20261103071209_publicidade_consentimento.sql` do gestao aplicada
e registrada no projeto `lucpxoynpvogkvzepagi`. A assinatura de
`fn_create_reservation` permanece igual. `p_attribution` recebe autorização,
comprovante UUID, data e versão do aviso; a função aceita somente o contrato
atual, datas válidas e comprovantes ainda autorizados. Grava três colunas
`advertising_consent_*` na reserva. A falta de escolha impede publicidade;
o cadastro e as mensagens operacionais seguem o fluxo existente.

As funções de fila Meta/OpenAI conferem data e revogação; o worker versão 48
confere novamente antes do envio. Registros antigos sem autorização ficam
fora dos reenvios publicitários, com o motivo registrado na fila. GA4
estatístico mantém sua fila e envia `ad_user_data`/`ad_personalization=DENIED`.

`private.advertising_revocations` tem RLS, nenhuma policy pública e acesso
direto revogado de anon/authenticated. `service_role` recebe SELECT explícito.
`public.fn_revoke_advertising_consent(uuid)` é a nova RPC anônima intencional:
revoga pelo comprovante imprevisível e retorna somente um booleano.
`fn_advertising_event_allowed(uuid)` permite execução somente a service_role.
Os avisos do Advisor sobre a RPC pública de revogação e sobre RLS sem policy
nessa tabela privada correspondem a esse desenho. As funções fixam search_path.
[Referência dos avisos](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Validação em transação desfeita confirmou reserva sem escolha, escolha
válida, limpeza de URL e revogação, com zero reserva ou e-mail persistido.
O CI executa `scripts/ci/test_publicidade_sql.py` do gestao em PostgreSQL
descartável: escolha, validade, filas, revogação, privilégios e reaplicação.
O endpoint público foi conferido com comprovante nulo (200/false) e o
worker sem autenticação respondeu 401. Nenhuma fila real foi drenada no teste.

## Aplicando o schema (projeto novo / duplicação)

Os quatro arquivos em `/supabase` são a fonte da verdade do banco e devem ser aplicados **nesta ordem** (via SQL Editor do Supabase, `supabase db push`, ou MCP `apply_migration`):

1. `schema.sql` — extensões, tabelas, índices, constraints.
2. `functions.sql` — funções e triggers (todas `SECURITY DEFINER`, sem grants ainda).
3. `rls.sql` — habilita RLS, cria as policies e concede os grants (tabela e função).
4. `seed.sql` — parâmetros iniciais e grade de horários de exemplo.

O módulo de Réveillon tem seus próprios arquivos, aplicados **depois** dos quatro acima e nesta ordem: `reveillon-schema.sql`, `reveillon-functions.sql`, `reveillon-rls.sql`, `reveillon-seed.sql`, `reveillon-integration.sql`. `reveillon-tests.sql` valida tudo com ROLLBACK. Detalhes em [`reveillon.md`](reveillon.md).

Esses arquivos já refletem duas correções encontradas em testes reais (não apenas leitura de código):

- **Ambiguidade de colunas em PL/pgSQL**: como `fn_create_reservation` e `fn_cancel_reservation_public` usam `RETURNS TABLE(...)` com colunas chamadas `id`, `status`, `party_size` etc., referências *sem* alias a colunas de mesmo nome em `reservations` ficavam ambíguas (`column reference "id" is ambiguous`). Corrigido qualificando todas as referências com alias de tabela.
- **Schema do pgcrypto**: `gen_random_bytes()` e `digest()` (usados para gerar/hashear o token de cancelamento) estão instalados no schema `extensions`, não em `public`. Como as funções fixam `search_path = public, pg_temp` (para evitar sequestro de search_path), as chamadas precisam ser qualificadas como `extensions.gen_random_bytes(...)` / `extensions.digest(...)`.
- **Policies sem `to <role>`**: toda policy RLS declara explicitamente `to anon` / `to authenticated`. Sem isso, o Postgres avalia *todas* as policies permissivas da tabela para qualquer papel — inclusive as que chamam `fn_is_admin()`/`fn_is_active_staff()` — e como essas funções não têm `EXECUTE` liberado para `anon`, a consulta falhava com `permission denied for function fn_is_admin` mesmo em tabelas que deveriam ter uma parte pública (`restaurant_settings`).

Se for reaplicar em um projeto novo do zero, esses três pontos já estão corrigidos nos arquivos — não precisa repetir a descoberta.

## Grants explícitos em tabelas novas (desde 30/10/2026)

O Supabase deixou de conceder automaticamente acesso da Data API (supabase-js, PostgREST, GraphQL) a tabelas e views criadas no schema `public`. Vale para tabelas novas no `portal`, projetos novos, preview branches e `supabase db reset`. As tabelas que já existiam mantiveram os grants. Sem o grant, a API devolve `permission denied` (`42501`).

Ao criar uma tabela ou view, colocar no mesmo arquivo SQL os grants de cada papel, só com os privilégios usados:

- **`service_role`**: obrigatório quando uma Edge Function (`event-quote`, `send-notifications`, `send-openai-ads-conversions`) acessa o objeto com `.from(...)`. A chave de serviço ignora RLS, mas não dispensa o grant de tabela. Modelos: `eventos-rls.sql` (tabelas usadas só pela Edge Function, com `usage` na sequência do `bigserial`) e a migration `20260930010000` do gestao (só os privilégios usados em tabelas compartilhadas).
- **`authenticated`**: o que o painel admin usa, coerente com as policies.
- **`anon`**: nada, salvo decisão explícita (hoje só `restaurant_settings` e `rv_table_state`, além da `cardapio_publico` do gestao). Não copiar o exemplo do aviso do Supabase que concede `select` ao `anon`.
- `drop` + `create` gera um objeto novo e perde os grants; repeti-los ao recriar.

**Duplicação do projeto:** `rls.sql` e `reveillon-rls.sql` concedem tabelas a `anon` e `authenticated`, mas ao `service_role` só `select` em `app_users`. No `portal`, a `event-quote` lê e altera a agenda com os grants das migrations `20260930000000` e `20260930010000` do repositório gestao. Num projeto novo, aplicar também essas migrations (ou grants equivalentes) antes de publicar as Edge Functions.

## Atendimento Instagram

O atendimento Instagram tem schema privado próprio `instagram_support` e
RPCs exclusivos de `service_role`, criados pela migration
`gestao/supabase/migrations/20261101071634_instagram_support_durable_queue.sql`.
O aviso único de WhatsApp por caso ativo fica na migration
`20261101102855_instagram_support_whatsapp_notice.sql`, no mesmo repositório.
Ela acrescenta `cases.handoff_notice_event_id` com FK de retenção, recria os
RPCs de fila/controle com grants somente ao servidor e mantém a instalação OFF,
sem responsável padrão, e-mail ou cron. A revisão `20261101161022`
separa indicação automática do WhatsApp de pausa: uma FAQ posterior segue
elegível. Pausas manuais/echo e envio incerto exigem conferência. O caso
mantém um único aviso e o fechamento preserva a pausa vigente.
A Edge Function instala com modo desligado e autentica o webhook por HMAC;
o controle administrativo valida o JWT e `fn_is_admin`. Nenhuma tabela de
reservas ou financeira participa da fila. Implantação, segredos e testes
estão descritos em [`instagram-support.md`](instagram-support.md).

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
