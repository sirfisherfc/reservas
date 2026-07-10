# Fase 2 — não implementado, só preparado/documentado

Itens fora do escopo da primeira entrega, por exigirem serviço externo, custo recorrente, ou simplesmente não serem essenciais para o lançamento.

## E-mail de confirmação automático — ✅ IMPLEMENTADO

Implementado via Edge Function `send-notifications` + Resend. Ver
[`docs/email.md`](email.md) para o passo a passo de configuração (domínio,
secrets e webhook). A fila `notification_queue` alimenta o envio, o e-mail inclui
botão de cancelamento, e o status vira `sent`/`failed` com o erro registrado.

## WhatsApp automático

Mesma ideia do e-mail (`channel='whatsapp'` na fila), mas via API oficial do WhatsApp Business (Meta) ou um provedor (ex.: Twilio, Z-API) — normalmente pago por mensagem. Na fase 1, existe só o botão/link manual de WhatsApp (`wa.me`) espalhado pelo site.

## Lembrete no dia da reserva

Dependeria de um cron (ex.: Supabase Cron/pg_cron, ou Edge Function agendada) rodando algumas horas antes do horário de cada reserva confirmada do dia, reaproveitando o canal de e-mail/WhatsApp acima.

## Pesquisa pós-visita

Enviar um link de pesquisa de satisfação depois que o status virar `compareceu`. Reaproveita `notification_queue` com um novo `type`.

## CRM de clientes / campanhas promocionais

A tabela `customers` já guarda o essencial (opt-in de marketing com data/hora, primeira e última reserva). Falta a interface de campanhas em si (segmentação, disparo em massa) — propositalmente fora do escopo para não acoplar o site de reservas a uma ferramenta de marketing.

## Lista de espera

Quando um horário está lotado, hoje o cliente só vê a indisponibilidade e o link de WhatsApp. Uma lista de espera exigiria uma tabela nova e lógica de notificação quando uma vaga abrir (ex.: por cancelamento).

## Integração com Google Calendar

Sincronizar reservas confirmadas com uma agenda — exigiria OAuth adicional (Google Calendar API) e mapeamento de reservas para eventos.

## Mapa de mesas

Só faz sentido se um dia o restaurante decidir atribuir mesas específicas por reserva (hoje, propositalmente, o sistema não atribui mesa nenhuma — ver regras de negócio no README/plano original).

## Relatórios avançados

O dashboard atual cobre os indicadores básicos pedidos (reservas do dia, próximos 7 dias, status, pessoas previstas, taxa de no-show). Relatórios históricos mais elaborados (comparativos mês a mês, sazonalidade etc.) ficam para quando houver volume de dados relevante.

## Domínio próprio (www.sirfisher.com.br)

Ver `docs/github-pages.md`, seção "Domínio próprio" — é só configuração de DNS + CNAME + atualizar Redirect URLs do Google OAuth, não exige mudança de código.
