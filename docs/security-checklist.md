# Checklist de testes manuais

Itens marcados **[✔ verificado]** já foram testados nesta implementação — via chamada direta às funções no banco e via requisições HTTP reais contra a API REST do Supabase usando a *anon key* pública (não apenas leitura de código). Itens marcados **[ ] verificar]** dependem de navegador/login Google real e ficam para você confirmar, já que este ambiente não tinha um navegador disponível para automatizar.

## Regras de negócio

- [✔ verificado] Criar reserva pública válida (via RPC `fn_create_reservation`, com anon key real).
- [✔ verificado] Bloquear reserva abaixo de 2 pessoas (`INVALID_PARTY_SIZE`).
- [✔ verificado] Bloquear reserva acima de 10 pessoas, direcionando para WhatsApp (`PARTY_TOO_LARGE`).
- [ ] verificar] Bloquear reserva no mesmo dia após o horário de corte (regra existe e foi lida no código; não testada no horário exato porque depende da hora local no momento do teste — force `same_day_cutoff_time` para um horário já passado hoje e tente reservar para hoje).
- [✔ verificado] Bloquear horário lotado por limite de pessoas (`SLOT_FULL_PEOPLE`).
- [✔ verificado] Bloquear horário lotado por quantidade de reservas (`SLOT_FULL_RESERVATIONS`).
- [✔ verificado] Bloquear dia inteiro (`blocked_dates`) — `get_available_time_slots` retorna vazio, `fn_create_reservation` recusa com `DATE_BLOCKED`.
- [✔ verificado] Bloquear faixa de horário específica (`blocked_time_slots`) — excluída da lista de horários e recusada na criação (`SLOT_BLOCKED`).
- [✔ verificado] Cancelar reserva pelo link público (token) e confirmar que a vaga é liberada (testado: criar, cancelar, e reservar novamente no mesmo horário).
- [✔ verificado] Cancelar uma reserva já cancelada não gera erro nem duplica — retorna `already_cancelled: true`.
- [✔ verificado] Honeypot preenchido é rejeitado silenciosamente (erro genérico, sem detalhar para o remetente que foi detecção de spam).
- [✔ verificado] Bloqueio de horário por faixa (inicial/final) cria um bloqueio para cada horário já configurado na grade dentro do intervalo, de uma vez.
- [✔ verificado] Janela de ocupação (margem antes + duração depois): reserva às 19h com padrões (60min/120min) ocupa 18h–21h; horários dentro da janela mostram a ocupação corretamente, fora dela não. Testado inclusive no horário mais tardio da grade (22h30) para confirmar que a aritmética não quebra perto da meia-noite.
- [ ] verificar] Layout mobile (visual — precisa de navegador).

## Segurança / permissões

- [✔ verificado] `anon` **não consegue** ler `reservations`, `app_users` ou `customers` diretamente via REST (`401 permission denied`, testado com a anon key real).
- [✔ verificado] `anon` só lê de `restaurant_settings` as linhas com `is_public = true` (testado via REST).
- [✔ verificado] `anon` não consegue chamar `fn_update_reservation_status` (função restrita a `authenticated`, `401 permission denied`).
- [✔ verificado] RLS habilitado em todas as 9 tabelas do schema público.
- [✔ verificado] Nenhuma policy dá `DELETE` em `reservations` ou `reservation_status_history` para nenhum papel.
- [✔ verificado] `service_role` não aparece em nenhum arquivo do frontend (`grep -r service_role assets/ index.html cancelar.html admin/` retorna vazio — só a anon/publishable key é usada).
- [✔ verificado] Histórico de status é gravado automaticamente (testado: cancelamento gerou entrada com `changed_by_type = 'customer'`).
- [✔ verificado] Login Google de um usuário **sem** linha em `app_users` cria um pedido de acesso pendente (`fn_request_access`, idempotente — chamar de novo não duplica) e não cria `app_users` nenhum sozinho.
- [✔ verificado] Admin aprova pedido de acesso (`fn_review_access_request`) → cria `app_users` ativo com o papel escolhido e marca o pedido como `approved`.
- [✔ verificado] Admin recusa pedido de acesso → marca como `rejected` e **não** cria linha em `app_users`.
- [✔ verificado] Apenas admin consegue chamar `fn_review_access_request` (checagem `fn_is_admin()` interna à função).
- [ ] verificar] Login Google de um usuário sem cadastro mostra a tela "Aguardando aprovação" (não mais "acesso negado" — precisa de conta Google real de teste). Uma conta previamente cadastrada e **desativada** continua mostrando "conta desativada".
- [ ] verificar] Contador de solicitações pendentes aparece ao lado de "Usuários" no menu lateral (admin).
- [ ] verificar] Operador não vê os menus de Configurações/Bloqueios/Usuários (a UI já remove esses links via JS para quem não é admin — confirmar visualmente).
- [ ] verificar] Operador não consegue alterar parâmetros nem gerenciar usuários mesmo tentando via URL direta (a proteção real é RLS + guarda de página, não apenas esconder o menu — vale um teste tentando acessar `admin/configuracoes.html` logado como operador: a página deve mostrar "acesso restrito a administradores").
- [ ] verificar] Exportação CSV funciona e contém os dados esperados (visual).

## Como reproduzir os testes automatizados

Os testes de negócio foram feitos chamando as funções diretamente:

```sql
select * from public.get_available_time_slots(current_date + 3, 4);
select * from public.fn_create_reservation('Nome','email@x.com','21999999999', current_date+3, '12:00', 4, null, false, true, null, null);
select * from public.fn_cancel_reservation_public('TOKEN-RETORNADO-ACIMA');
```

Os testes de permissão foram feitos via `curl` contra a API REST real com a anon key (substitua pela sua):

```bash
curl -s "https://SEU-PROJETO.supabase.co/rest/v1/reservations?select=*" \
  -H "apikey: SUA_ANON_KEY" -H "Authorization: Bearer SUA_ANON_KEY"
# esperado: 401 permission denied
```
