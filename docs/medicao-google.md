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

## Prazo da atribuição e contrato Meta (25/10/2026)

Publicado no portal em 25/10/2026, no commit `f92378d`, após 32 testes locais
e os fluxos de navegador com RPCs simulados. A Edge Function foi implantada
na versão 22, ativa e com `verify_jwt=false` preservado.

`sf_attribution_v1` aceita apenas objetos com `captured_at` válido, positivo,
sem data futura e com idade menor que 90 dias. Entre cookie e armazenamento
local, vale a cópia válida mais recente. Um clique interno mantém a data
original e o cookie recebe apenas os segundos restantes até o fim do prazo.
Sem uma cópia válida, a nova chegada registra a referência disponível,
sem reutilizar a campanha ou os identificadores expirados.

O worker Meta preserva o país de telefones que começam com `+`; sem esse
sinal, números de 10 ou 11 dígitos recebem o código brasileiro. O número
normalizado, entre 8 e 15 dígitos, continua sendo enviado somente em SHA-256.
Datas inválidas, futuras ou com mais de sete dias são recusadas e registradas
como falha na fila, sem substituição pela data do processamento. Os eventos,
IDs de deduplicação e o valor estimado legado de R$58 por pessoa continuam
com o contrato anterior.

Os helpers Meta são puros em `meta-event.ts`. O teste do worker simula RPCs,
autenticação e fetch: não lê clientes nem envia conversões. Executar na pasta
do portal:

```powershell
npx --yes deno test --allow-read tools/attribution_test.mjs tools/reservation_funnel_test.mjs tools/openai_event_test.ts tools/openai_validation_test.mjs tools/meta_event_test.mjs
python -X utf8 tools/reservation_funnel_browser_test.py
```

Push de `main` publica o portal estático pelo GitHub Pages. A Edge Function
exige implantação própria. A função `send-openai-ads-conversions` passou da
versão 21 para 22 por implantação restrita a essa função. O segredo do cron
ou o usuário autorizado continuam sendo validados dentro da função.

Os três módulos publicados foram baixados para diretório isolado fora do
Git e comparados com `f92378d`, sem sobrescrever o workspace. SHA-256 após
normalizar as quebras de linha para LF:

| Módulo | SHA-256 publicado |
| --- | --- |
| `index.ts` | `3be33ed42bacffff92bd2a41bfe6b3147b4b751b4b781560bd173794bd244eef` |
| `openai-event.ts` | `585e4e73729319bd25e536922c3dd512e5e1c6566fe12d31cb6b303e15ffd004` |
| `meta-event.ts` | `e079d22f5c7aed3a4399fce53c3c7169fdffaed42fc68c83f888d0c86e0f5c90` |

Essa conferência não chamou a função nem enviou conversões de teste. Não
houve SQL, alteração de secrets, reserva ou marcação de comparecimento.

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
reservas ou visitas. Em 13/10/2026, reservas e comparecimentos deixaram de enviar
o valor estimado de R$58 por pessoa no GA4 e na OpenAI. Os eventos continuam
contando resultados, sem declarar faturamento. Valores históricos estimados
e o evento Meta legado não equivalem a receita realizada.

## Funil da reserva comum (22/10/2026)

O formulário normal envia eventos GA4 próprios, sem depender dos eventos
automáticos de qualquer formulário do site:

| Evento | Significado |
| --- | --- |
| `reservation_form_view` | Formulário renderizado, antes da consulta de configurações |
| `reservation_form_start` | Primeira interação em campo, horário ou botão de envio |
| `reservation_availability` | Consulta retornou ao menos um horário disponível |
| `reservation_slot_selected` | Visitante escolheu um horário |
| `reservation_submit_attempt` | Tentativa de enviar, inclusive com campos faltantes |
| `reservation_unavailable` | Impedimento operacional, como corte do dia, lotação ou grupo maior |
| `reservation_error` | Validação incompleta ou falha técnica |
| `reservation_confirmed` | Mesmo evento existente, somente após sucesso do RPC |

Os parâmetros `form_kind=standard`, `reservation_stage`, `reservation_reason`
e `cta_position` usam valores categóricos. `sf_cta` recebido no link aceita
apenas as posições conhecidas do site; sem esse contexto usa `unspecified`.
Nenhum novo evento envia valores digitados, data desejada ou erro bruto.
O contexto do botão não altera a atribuição de campanha salva no banco.
O Réveillon continua no fluxo próprio, com `reveillon_prebooking` e a decisão
de tracking do evento; não é tratado como reserva comum confirmada.

Visualização/início são únicos por carregamento. Indisponibilidade idêntica
é deduplicada até mudar a seleção ou voltar a haver horários. Tentativas e
erros são ocorrências, não pessoas distintas. Respostas antigas de uma consulta
de disponibilidade não substituem a seleção atual nem geram medição falsa.
Falhas dos pixels não escondem a confirmação de uma reserva já criada.

As quatro dimensões de escopo de evento foram criadas e relidas no GA4
`353205396` em 22/10/2026. O registro só libera dados novos e a propagação
nos relatórios pode levar até 48 horas. O MCP continua somente leitura;
o cadastro foi feito pela Admin API com a credencial existente, sem copiar
a chave ou alterar a configuração do MCP. Conferir sem escrita:

```powershell
# Usar o Python do ambiente isolado do MCP, que ja contem o SDK Google.
python tools/registrar_funil_ga4.py
```

Somente `--aplicar` cria definições faltantes; definições existentes são
preservadas. Esta coleta começa após a publicação e não reconstrói as etapas
que faltavam nos relatórios anteriores. O total de confirmações GA4 continua
sujeito à cobertura da tag: conferir também a coorte de reservas efetivas no
banco, pela data de criação em Fortaleza, sem exportar dados pessoais.

## Validação do funil

```powershell
deno test --allow-read tools/reservation_funnel_test.mjs tools/attribution_test.mjs
# Python do ambiente analytics, que ja possui Playwright:
../site/tools/analytics/.venv/Scripts/python.exe -X utf8 tools/reservation_funnel_browser_test.py
```

O teste de navegador usa Edge isolado em tela de celular, bloqueia rede
externa e simula todos os RPCs. Cobre PT/EN, confirmação, falta de campos,
corte, lotação, falha de rede, resposta antiga e pixels quebrados. Não envia
eventos reais, não grava reservas nem acessa dados de clientes.

### Revisão da jornada em 25/10/2026

A leitura anônima das configurações públicas confirmou mínimo de 1 pessoa,
máximo de 10, corte às 15h30, antecedência de 60 dias, tolerância de 15 minutos
e liberação após 60 minutos sem ocupação. Esses valores continuam no painel;
o RPC confere as regras vigentes ao consultar horários e criar a reserva.

- A falha da leitura de configurações passa a usar os valores de apoio do
  formulário, que foram alinhados à configuração confirmada. Antes, uma
  exceção interrompia a instalação dos controles e os valores de apoio ainda
  diziam mínimo de 2 pessoas e corte ao meio-dia. O WhatsApp do rodapé também
  funciona antes de o JavaScript carregar. Uma falha do pixel na abertura
  também permite que o formulário termine de carregar.
- Alterar data ou quantidade de pessoas remove a escolha de horário no mesmo
  evento. A espera de 250 ms antes da consulta continua reduzindo requisições;
  o formulário exige uma escolha compatível com a seleção atual.
- Uma falha de cancelamento mantém o botão para tentar novamente e mostra
  mensagem no idioma escolhido. A equipe continua recebendo os mesmos status.

O teste de navegador agora cobre os retornos de erro e exceções de rede na
leitura das configurações, envio imediato após trocar o grupo, repetição do
cancelamento após falha, celular e desktop. Todos os RPCs desse teste são
simulados. Os 20 testes locais de atribuição, funil e contratos OpenAI passaram.
Nenhuma reserva, cancelamento ou conversão real foi criada nesta verificação.

Neste PC, o ambiente virtual antigo aponta para outro caminho de instalação.
O Python global já tem Playwright e o Deno pode ser executado por `npx`:

```powershell
python -X utf8 tools/reservation_funnel_browser_test.py
npx --yes deno test --allow-read tools/reservation_funnel_test.mjs tools/attribution_test.mjs tools/openai_event_test.ts tools/openai_validation_test.mjs
```

### Orientações do formulário em 02/11/2026

O aviso de grupo acima do limite do portal encaminha grupos de até 29
pessoas ao WhatsApp e eventos de 30 a 100 pessoas sentadas ao configurador.
Acima de 100, o formulário orienta consultar a equipe para avaliar o pedido,
sem indicar capacidade disponível. O limite do portal continua vindo das
configurações públicas.

Após o corte para confirmar uma reserva no mesmo dia, o formulário informa
que a visita segue por ordem de chegada, conforme a disponibilidade de
mesas. Exibe “Como chegar” e WhatsApp para dúvidas. Essa orientação também
aparece quando o corte é retornado no envio da reserva. A regra limita o
momento da confirmação, e o horário de corte continua vindo do painel.

A conferência local cobre português e inglês em telas de 390 e 1440 pixels,
os limites de grupo 11, 29, 30, 100 e 101, configurações diferentes das de
apoio e o corte no envio. O navegador bloqueia a rede externa e simula os
RPCs. A verificação preserva os eventos existentes e não cria reservas ou
conversões reais.

## Validação da atribuição

### Links de conteúdo e campanha em 02/11/2026

O gerador privado em [`admin/links-marketing.html`](../admin/links-marketing.html)
prepara links com `utm_content=ig_<id>` ou `fb_<id>`. Em anúncios, inclui
`campaign_id`, `ad_group_id`, `ad_id` e `utm_id`, com os IDs informados pelo
administrador. [Operação, contrato e cobertura](marketing-links.md).

O site e o portal passaram a conservar `utm_id`. O portal usa esse valor
como `campaign_id` quando o parâmetro explícito faltar. Uma chegada com
parâmetros e referência externa inicia um toque novo e elimina os IDs do
clique anterior. A navegação entre os subdomínios preserva o toque e seu
prazo; capturar de novo no envio do formulário conserva a chegada já lida.
Sem referência disponível e com parâmetros iguais, o histórico válido é
preservado porque faltam dados para distinguir outro clique de navegação.

O banco, os status e as filas existentes foram preservados. Os testes
locais confirmaram o payload até o RPC simulado e o mesmo ID Meta
`sf-sched-<reservation-id>`. Não se criou reserva, comparecimento ou evento
de conversão em produção para essa validação.

```powershell
deno test --allow-read reservas/tools/attribution_test.mjs
```

Os testes cobrem cookies GS1/GS2, API da tag, valores inválidos, storage
bloqueado e tag que nunca responde. Não fazem RPCs nem alteram o banco.
