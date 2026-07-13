# E-mail de confirmação automático (Resend)

Toda reserva criada enfileira uma confirmação em `notification_queue`
(`channel='email'`). A Edge Function **`send-notifications`** lê essa fila, envia
o e-mail pelo [Resend](https://resend.com) e marca o registro como `sent`/`failed`.

O e-mail traz código da reserva, data, horário, nº de pessoas e um botão
**Cancelar reserva** (link `cancelar.html?t=TOKEN`).

## Visão geral do fluxo

```
reserva criada → fn_create_reservation enfileira em notification_queue (pending)
   → Database Webhook dispara a Edge Function send-notifications
      → fn_claim_pending_notifications reivindica os pendentes (processing)
         → envia via API do Resend
            → marca sent (ou failed, com o erro)
```

## 1. Configurar o domínio no Resend (feito uma vez)

1. Crie a conta em resend.com.
2. **Domains → Add Domain →** digite o domínio **raiz**: `sirfisher.com.br`
   (não use `send.` — o Resend cria os registros de bounce nesse subdomínio
   sozinho, e o remetente fica bonito: `reservas@sirfisher.com.br`).
3. O Resend mostra 2–3 registros DNS (um DKIM, um SPF/MX no `send.`). **Repasse
   esses valores exatos para quem administra o DNS na Hostinger** adicionar.
   - Eles **não** conflitam com o MX/SPF que a Hostinger já tem na raiz.
4. Espere o Resend marcar o domínio como **Verified**.
5. **API Keys → Create API Key** (permissão *Sending access*). Guarde a chave
   `re_...` — ela só aparece uma vez.

## 2. Publicar a Edge Function

Com a [Supabase CLI](https://supabase.com/docs/guides/local-development) instalada
e o projeto linkado (`supabase link --project-ref lucpxoynpvogkvzepagi`):

```bash
supabase functions deploy send-notifications
```

## 3. Configurar os secrets

```bash
supabase secrets set \
  RESEND_API_KEY="re_sua_chave_aqui" \
  NOTIFY_SECRET="um-segredo-longo-e-aleatorio" \
  RESEND_FROM="Sir Fisher Praia <reservas@sirfisher.com.br>" \
  PUBLIC_SITE_URL="https://reservas.sirfisher.com.br"
```

- **RESEND_API_KEY** — a chave do passo 1.
- **NOTIFY_SECRET** — invente uma string longa (ex.: saída de `openssl rand -hex 24`).
  É o que protege a função; o webhook precisa mandar o mesmo valor.
- **RESEND_FROM** — precisa usar o domínio verificado no Resend.
- **PUBLIC_SITE_URL** — URL pública do site (sem barra no fim). Usada só para montar
  o link de cancelamento. Se ficar vazia, o e-mail sai sem o botão de cancelar.
  Ajuste quando o site for publicado / ganhar domínio próprio.

## 4. Disparar a função a cada reserva (gatilho pg_net)

Já configurado via gatilho no banco (não pelo painel de Webhooks). Um `after insert`
em `notification_queue` chama a Edge Function por `net.http_post`, mandando o header
`x-notify-secret` lido do **Vault** (segredo `notify_secret`). Ver a função
`tg_notification_queue_send` em `supabase/functions.sql` e os pré-requisitos ali
descritos (extensão `pg_net` + segredo no Vault).

A função processa **todos** os pendentes a cada chamada, então um único disparo já
basta. Alternativa: um cron (pg_cron) a cada minuto chamando a mesma URL/header.

## 5. Testar

1. Faça uma reserva de teste pelo site com um e-mail seu.
2. Veja se o e-mail chega (cheque spam nas primeiras vezes).
3. Confira a fila:

```sql
select id, status, error, sent_at, payload->>'email'
from public.notification_queue
order by created_at desc limit 5;
```

Deve estar `sent`. Se estiver `failed`, a coluna `error` diz o motivo (chave do
Resend errada, domínio não verificado, remetente fora do domínio, etc.).

Para reenviar um item travado, volte-o para a fila:

```sql
update public.notification_queue set status='pending' where id = 'UUID-AQUI';
```

## Segurança

- A fila é acessível só a admin/`service_role` (RLS) — o `anon` não lê nem escreve.
- `fn_claim_pending_notifications` é restrita a `service_role`.
- A função exige o header `x-notify-secret`; sem ele, responde 401.
- O token de cancelamento fica no `payload` até o envio; só permite cancelar
  aquela reserva (a mesma ação que o cliente já pode fazer).
