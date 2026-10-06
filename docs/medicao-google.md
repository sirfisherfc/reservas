# Medição de reservas e comparecimentos

Há três etapas distintas:

| Etapa | Sinal | Interpretação |
| --- | --- | --- |
| Intenção | `click_reservation`, `click_menu`, contato ou rota | Ainda não comprova reserva/visita |
| Reserva concluída | `reservation_confirmed` no GA4 | Enviado após sucesso da criação |
| Comparecimento registrado | `visit_realized` no GA4, servidor | Depende de a equipe marcar `compareceu` |

O banco já tem `trg_enqueue_ga4_visit` e fila com unicidade por reserva,
provedor e evento. Nesta entrega não houve mudança de schema, status de
reservas, reenvio de conversões ou criação de reservas de teste em produção.

## Captura e origem

Em 06/10/2026, a captura passou a consultar `gtag('get', ..., 'client_id')`
e `session_id`, com limite de espera de 800 ms. Se a tag estiver bloqueada,
a reserva prossegue. Cookies GS1 e GS2 são fallback; bloqueio de localStorage
não interrompe o formulário. Tanto a reserva normal quanto o Réveillon
aguardam o objeto de atribuição antes de enviar o RPC.

Os links internos do site usam `sf_origin` para contexto, em lugar de
`utm_source=site&utm_medium=organic`. UTMs reais e identificadores de anúncios
continuam sendo propagados. Cookies com a campanha interna sintética são
limpos somente desses UTMs; não se inventa a origem original perdida.

O uso da mesma propriedade GA4 nos subdomínios permite acompanhar a jornada.
O relatório separa o site principal do portal, e não soma usuários por canal.
Eventos do servidor podem não ter hostname, por isso aparecem em uma seção
separada da propriedade. A origem informada pelo GA4 depende da coleta e da
atribuição disponíveis; não é prova absoluta do canal que gerou a visita.

## Conferência da equipe

Registrar o comparecimento e a ausência de forma consistente no painel.
Não marcar comparecimento apenas para testar a medição. Reservas feitas pela
equipe são separadas de reservas públicas na análise da captura de origem.

O relatório do site pode cruzar somente agregados do banco:

```powershell
site/tools/analytics/.venv/Scripts/python.exe -X utf8 site/tools/analytics/report.py --days 30 --end-date 2026-09-30 --operations
```

Comparecimentos usam a data da visita. Reservas criadas usam a data de criação
no fuso de Fortaleza. Não dividir esses totais para calcular uma taxa de
conversão de coorte. “Primeiro comparecimento registrado” não significa
primeira visita ao restaurante: clientes sem reserva não entram nesse histórico.

O GA4 mede somente a parte rastreável. Não usar zero no GA4 como prova de zero
reservas ou visitas. Valores estimados enviados pelos pixels não equivalem
a faturamento e não devem ser usados para afirmar receita realizada.

## Validação

```powershell
deno test --allow-read reservas/tools/attribution_test.mjs
```

Os testes cobrem cookies GS1/GS2, API da tag, valores inválidos, storage
bloqueado e tag que nunca responde. Não fazem RPCs nem alteram o banco.
