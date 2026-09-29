# Configurador de eventos - diagnóstico, regras e arquitetura do MVP

Atualizado em 29/09/2026. Este documento separa decisões confirmadas, cálculos, recomendações, hipóteses provisórias e itens que exigem aprovação.

## 1. Resumo executivo

- **DEFINIDA:** o catálogo de referência é o cardápio interno versionado, hoje exportado em `site/cardapio/dados/cardapio.json`. O Hubt não participa do cálculo de eventos.
- **DEFINIDA:** o cliente escolhe experiência, não porções. Quantidades técnicas só aparecem internamente.
- **DEFINIDA:** o valor mostrado inclui atendimento; a interface nunca acrescenta 10% depois.
- **DEFINIDA:** a página pública fica em `site/eventos/` e chama a Edge Function `event-quote`.
- **DEFINIDA:** o painel interno deve ser uma rotina `eventos.html` do projeto `gestao`, cadastrada em `pagina_permissao`, para o proprietário liberar por papel.
- **DEFINIDA:** nenhuma reserva é confirmada pelo configurador. O estado inicial é sempre `pending` e o CTA é “Enviar para validação”.
- **PROVISÓRIA:** CMV de cada produto = 35% do preço vigente, até existir custo real confiável.
- **PROVISÓRIA:** margem de contribuição protegida de 52% no cálculo técnico e piso de alerta de 45% depois dos custos estimados.
- **PROVISÓRIA:** diária adicional de R$ 100 e regras de dimensionamento descritas abaixo.
- **PENDENTE DE APROVAÇÃO:** publicar a Edge Function, aplicar a migration canônica e publicar os frontends. A rotina do `gestao` já está integrada localmente e começa exclusiva do admin.
- **PENDENTE DE DADOS:** custo de oportunidade e capacidade histórica ao vivo. O MVP não inventa adicional de alta demanda; marca o caso para validação quando o agregado não existe.

## 2. Diagnóstico dos arquivos e dados

### Site

- HTML/CSS/JS estático, sem build, publicado pelo GitHub Pages.
- Cardápio interno em JSON com versão `1`, publicado em 22/09/2026, contendo 81 produtos e preços em centavos.
- Fotos locais dos principais produtos permitem escolhas visuais sem dependência externa.
- Aviso de privacidade já existia e foi ampliado para o configurador.

### Reservas e backend

- Supabase compartilhado, com reservas, bloqueios, grade de horários, capacidade configurável, usuários internos e RLS.
- `blocked_dates`, `blocked_time_slots`, `availability_rules`, `reservations` e `restaurant_settings` permitem a conferência inicial sem alterar reserva alguma.
- Edge Functions já usam `SUPABASE_SERVICE_ROLE_KEY` no servidor e validação explícita de usuários internos.
- O módulo de Réveillon demonstra que um módulo isolado pode coexistir sem alterar o fluxo comum de reservas.

### Gestão e dados de demanda

- O painel tem as views solicitadas: `app_painel_diario`, `app_painel_resumo_mensal`, `app_painel_recebimento_hora`, `app_painel_margem_contribuicao` e `app_escala_cobertura`.
- A origem transacional `recebimento_transacao_net` cobre aproximadamente 94% do faturamento com hora.
- O projeto já documenta uma defasagem de 75 minutos entre pagamento e pedido. A view `escala_demanda_base` aplica essa correção transação a transação.
- Não houve acesso ao banco ao vivo nesta rodada. `event_demand_baselines` foi criada vazia para receber apenas agregados; sem linha comparável, o cálculo não aplica custo de oportunidade e sinaliza conferência.
- O repositório `gestao` já tinha alterações locais pendentes na área de cardápio/QA. Elas foram preservadas; a integração de eventos alterou apenas arquivos separados de navegação/permissões e adicionou a migration `20260929000000`.

### Histórico comercial

Os orçamentos de 2024-2025 e o contrato de 2026 indicam:

- aproximadamente 4 a 7 unidades de entradas por pessoa em pacotes com principal;
- 0,6 a 1 principal por pessoa conforme o formato;
- 1 a 2 bebidas sem álcool por pessoa e chope controlado próximo de 1 a 2,4 unidades por adulto;
- atendimento incluído no total;
- sinal de 20%, saldo 7 dias antes, open bar de 3 horas e consumos posteriores em comandas individuais;
- convidados excedentes sujeitos a disponibilidade e cobrança proporcional;
- redução tardia sem redução automática do total quando insumos e equipe já foram dimensionados;
- hora adicional não estende open bar.

Preços e descontos históricos não foram reutilizados. O MVP sempre parte do cardápio interno vigente e das regras ativas.

## 3. Fluxo do cliente (máximo de cinco etapas)

1. **Data e horário:** data, início e duração. O backend consulta bloqueios, grade, reservas sobrepostas e capacidade.
2. **Convidados:** quantidade exata e crianças, usadas internamente para estimar adultos. Fora de 30-100, o caso vai para atendimento manual.
3. **Alimentação:** petiscos; petiscos + principal; almoço/jantar; recomendação.
4. **Bebidas:** consumo individual; sem álcool; crédito; fichas; chope; pacote selecionado; open bar; recomendação.
5. **Perfil:** essencial; equilibrada; completa; comparar. Orçamento por pessoa é opcional e nunca reduz o piso técnico.

O resultado mostra até três opções. O cliente escolhe uma, informa nome e WhatsApp, aceita o aviso de privacidade e envia para validação.

## 4. Wireframes

### Mobile público

```text
+----------------------------------+
| Sir Fisher        30-100 pessoas |
| FOTO / proposta de valor         |
+----------------------------------+
| Etapa 2 de 5       Convidados    |
| [==========----------------]     |
| Quantas pessoas você espera?     |
| [ 60 ] convidados                |
| [  4 ] crianças                  |
| [ ] restrição importante         |
|          [Voltar] [Continuar]    |
+----------------------------------+
```

### Resultado público

```text
+----------------------------------+
| Pré-proposta                     |
| Opções para comparar             |
| + Essencial  R$ pp / R$ total    |
| + Equilibrada R$ pp / R$ total   |
| + Completa   R$ pp / R$ total    |
| Atendimento incluído             |
| [Escolher esta opção]            |
| Nome / WhatsApp / privacidade    |
| [Enviar para validação]          |
+----------------------------------+
```

### Rotina interna proposta (`gestao/eventos.html`)

```text
+--------------------------------------------------------------+
| Rotinas > Eventos         [Verde 4] [Amarelo 3] [Vermelho 1] |
| Filtros: data | risco | status | busca                      |
+--------------------------+-----------------------------------+
| EV-2026-...  60p amarelo | Cliente / data / configuração     |
| EV-2026-...  40p verde   | Quantidades / equipe / alertas    |
| EV-2026-...  80p vermelho| CMV / margem / oportunidade       |
|                          | versões / histórico               |
|                          | [Aprovar] [Ajustar] [Alternativa] |
+--------------------------+-----------------------------------+
```

## 5. Dimensionamento

### Faixas internas

- 30-40;
- 41-60;
- 61-80;
- 81-100.

As faixas existem em `event_package_rules`. A carga inicial repete os mesmos parâmetros nas quatro faixas para não fingir uma precisão que ainda não foi validada; depois de acompanhar eventos reais, cada faixa pode receber fator próprio.

### Alimentação inicial

| Pacote | Essencial | Equilibrada | Completa |
|---|---:|---:|---:|
| Petiscos | 5 un./pessoa | 6,5 un./pessoa | 8 un./pessoa |
| Petiscos + principal | 4,5 entradas + 0,75 principal | 6 entradas + 0,85 principal | 7,5 entradas + 1 principal + sobremesa |
| Almoço/jantar | entrada leve + 0,8 principal | entradas + 1 principal + brownie | recepção + 1 principal premium + sobremesa |

Arredondamento: toda porção ou unidade calculada sobe para o inteiro seguinte. Nunca reduzir por arredondamento.

### Equipe

- até 50: sem freelancer obrigatório;
- 51-100: +1 freelancer;
- open bar: +1 por até 70 adultos, além da regra anterior;
- chope/pacote selecionado acima de 70: +1;
- duração acima de 4 horas: +1;
- diária provisória: R$ 100.

### Bebidas

| Módulo | Regra inicial | Revisão |
|---|---:|---|
| Individual | sem quantidade contratada | verde |
| Sem álcool | 1,7 unidade/adulto | verde |
| Crédito | R$ 22/adulto | verde |
| Fichas | 2/adulto | verde |
| Chope | 2,4/adulto + 10% risco | amarelo |
| Selecionado | 2,5/adulto + 10% risco | amarelo |
| Open bar | 4,2/adulto + 18% risco, máximo 3h | amarelo/vermelho conforme contexto |

O open bar termina no horário contratado. Depois, consumo individual. Hora adicional nunca o prorroga automaticamente.

## 6. Classificação dos 81 produtos

A classificação completa e executável está em `supabase/eventos-seed.sql`; a carga falha se não encontrar exatamente 81 IDs.

- **Recomendado (25):** itens de lote/padronizados e bebidas estáveis, como pasteizinhos, bolinha, NewCastle, crocantes, dadinho, crispy chicken, isca, brownie, long necks/600 ml e bebidas sem álcool.
- **Permitido com limite (27):** fish & chips, fritas, caldo, camarão, calabresa, sanduíches, principais mais simples, brownie com sorvete, chope, energético e coquetéis. Limite padrão de 60 quando a qualidade depende de finalização.
- **Exige aprovação (23):** patinha, filé mignon, picanha, peixe grelhado e carne de sol em volume; doses e destilados; rolha. A justificativa é custo, grelha/finalização, controle de álcool ou variabilidade.
- **Não recomendado (6):** café expresso, sumo de limão, molho/arroz extra, pacote de gelo e embalagem de viagem como componentes de pacote.

**RECOMENDADA:** revisar a classificação com cozinha e salão após os três primeiros eventos e registrar alterações em nova versão, não sobrescrever o histórico usado por propostas anteriores.

## 7. Pacotes-base

### Petiscos

Serviço volante. Essencial usa quatro itens de alta padronização; Equilibrada amplia variedade; Completa adiciona itens do mar e maior reposição.

### Petiscos com principal

Recepção volante e principal. Principal é escolha limitada pela capacidade: fish & chips/sanduíche nos grupos menores; grelhados e opções premium exigem análise operacional.

### Almoço ou jantar

Entrada compartilhada, principal e sobremesa conforme perfil. A experiência é refeição, não serviço à la carte livre.

## 8. Modelo de custo de oportunidade

### Dados necessários

- mês;
- dia da semana;
- hora provável do pedido, não apenas recebimento;
- duração;
- feriado/data especial;
- mediana e faixa histórica por dia comparável;
- capacidade proporcional ocupada;
- reservas já confirmadas;
- cobertura de equipe.

### Consulta proposta (somente leitura na origem)

```sql
with cfg as (
  select 75::int as lag_min, 18::int as meses
), pedido as (
  select
    (data_venda - make_interval(mins => cfg.lag_min)) as momento,
    bruto_net
  from public.recebimento_transacao_net, cfg
  where data_venda >= current_date - (cfg.meses || ' months')::interval
), dia_hora as (
  select momento::date as dia, extract(hour from momento)::int as hora,
         sum(bruto_net) as faturamento
  from pedido
  group by 1, 2
), comparaveis as (
  select dia, sum(faturamento) as faturamento_periodo
  from dia_hora
  where extract(month from dia) = :mes
    and extract(isodow from dia) = :dia_semana
    and hora >= :hora_inicio
    and hora < :hora_fim
  group by dia
)
select count(*) as amostra,
       percentile_cont(0.25) within group (order by faturamento_periodo) as faixa_baixa,
       percentile_cont(0.50) within group (order by faturamento_periodo) as mediana,
       percentile_cont(0.75) within group (order by faturamento_periodo) as faixa_alta
from comparaveis;
```

**CALCULADA:** exclusividade usa no mínimo a mediana do período comparável, ajustada pela duração e por fatos conhecidos.

**CALCULADA:** sem exclusividade, piso de oportunidade = mediana × fração provável de capacidade deslocada. A fração é limitada a 100%.

**PROVISÓRIA:** a origem horária cobre cerca de 94% do faturamento. Não aplicar correção de 1/0,94 até validar mês a mês contra `app_painel_diario`; registrar a cobertura junto do agregado.

**PENDENTE DE APROVAÇÃO:** feriados e datas especiais devem ter coorte própria ou multiplicador derivado dos dados, nunca taxa arbitrária.

## 9. Precificação

Para cada opção:

```text
CMV estimado = equivalente vigente de alimentos e bebidas × 35%

custo operacional = CMV estimado
                  + cozinha por pessoa
                  + freelancers
                  + duração adicional
                  + risco de desperdício de bebidas

preço técnico = custo operacional ÷ (1 - margem protegida)
              × (1 + atendimento)

equivalente do cardápio = alimentos + bebidas no preço vigente
                        × (1 + atendimento)

piso de oportunidade = agregado comparável × fração deslocada

preço comercial mínimo = maior(preço técnico,
                               equivalente do cardápio,
                               piso de oportunidade)

preço por pessoa = arredondar para cima(preço comercial mínimo ÷ convidados)
preço final = preço por pessoa × convidados
```

O campo opcional de orçamento nunca força preço abaixo do mínimo; serve apenas para ordenar alternativas ou explicar incompatibilidade.

## 10. Semáforo

### Verde

- 30-60 convidados;
- duração normal;
- sem exclusividade;
- sem open bar/chope de risco;
- itens recomendados;
- disponibilidade e margem conferidas.

### Amarelo

- mais de 60;
- mês/fim de semana potencialmente forte sem agregado conclusivo;
- chope, pacote selecionado ou open bar controlado;
- duração acima de 4h;
- freelancer adicional;
- restrição alimentar;
- exclusividade ou capacidade acima de 85%.

### Vermelho

- data bloqueada;
- conflito/capacidade excedida;
- margem abaixo do piso;
- preço abaixo do custo de oportunidade;
- desconto;
- item não recomendado;
- open bar de alto risco ou regra fora do padrão.

## 11. Arquitetura técnica

```text
site/eventos/ (público)
      |
      | POST: configuração sem preço confiável do cliente
      v
Supabase Edge Function event-quote
      |-- lê catálogo/regras versionadas
      |-- lê bloqueios, grade, reservas e capacidade
      |-- lê somente agregados de demanda
      |-- recalcula tudo no envio
      |-- devolve somente snapshot público
      v
event_requests + event_request_audit (RLS; sem grants anon)
      |
      v
gestao/eventos.html (autenticado + pagina_permissao)
```

O navegador nunca recebe CMV, margem, piso, custo de oportunidade, custo de equipe ou regra de desconto. Alterar preço no DevTools não tem efeito porque `submit` recalcula no servidor e escolhe apenas um ID autorizado.

## 12. Modelo de dados

- `event_pricing_versions`: versão ativa, CMV, atendimento, margem e freelancer.
- `event_package_rules`: pacote × perfil × faixa, unidades, equivalente, custo operacional e composição.
- `event_beverage_rules`: modo, unidades/adulto, risco e composição.
- `event_product_rules`: classificação dos 81 itens por versão do cardápio.
- `event_demand_baselines`: somente agregados comparáveis; nenhum dado financeiro bruto no cliente.
- `event_requests`: dados mínimos do cliente, configuração e snapshots público/interno.
- `event_request_audit`: alterações manuais imutáveis por solicitação.

## 13. Rotina interna e permissões

Integração implementada localmente no `gestao`:

1. `eventos.html` segue `assets/auth.js` e o padrão visual das rotinas;
2. `eventos.html` está na lista de páginas configuráveis, em Rotinas e em `permissoes.html`;
3. a migration insere `pagina_permissao` com `papeis = '{}'` para começar apenas com admin;
4. o proprietário marca Sócio e/ou Gerente na matriz quando desejar;
5. toda view/RPC do módulo usa `usuario_pode_acessar_pagina('eventos.html')` no servidor;
6. operador não vê CMV, margem, histórico ou desconto, a menos que o papel seja explicitamente autorizado;
7. aprovar desconto permanece exclusivo do proprietário/admin, com responsável e justificativa.

Campos da tela: cliente, configuração, quantidades, preço, CMV, margem, oportunidade, comparáveis, equipe, alertas, semáforo e versões. Ações: aprovar, ajustar, recusar, pedir informação, oferecer alternativa, aprovar desconto e gerar proposta definitiva.

## 14. Modelo de pré-proposta

Caso verde:

> Pré-proposta de R$ {valor_por_pessoa} por pessoa, total de R$ {total}, com atendimento incluído e sujeita à confirmação de disponibilidade.

Caso excepcional:

> Estimativa inicial de R$ {mínimo} a R$ {máximo} por pessoa, com atendimento incluído. Esta configuração exige validação de disponibilidade, operação e condições do período.

Inclui: experiência, alimentos principais, bebida, duração, total e adicionais possíveis. Não inclui custos internos nem serviços que o Sir Fisher não oferece.

## 15. Modelo de proposta definitiva

1. identificação das partes;
2. data, início, fim e limite de open bar;
3. público confirmado e regra para excedentes/reduções;
4. cardápio e modelo de bebidas;
5. formato de serviço e equipe;
6. valor final com atendimento incluído;
7. forma de pagamento e diferença por instrumento claramente informada;
8. sinal, saldo e validade;
9. cancelamento, reagendamento, caso fortuito e clima;
10. itens não incluídos;
11. aceite e trilha de versões.

### Recomendação comercial

- validade da proposta: 5 dias corridos ou até a data indicada;
- sinal: 20% após aprovação;
- saldo: 7 dias antes;
- confirmação final de convidados: 7 dias antes;
- aumento: sujeito a capacidade, insumo/equipe e cobrança do valor vigente;
- redução após o prazo: não reduz automaticamente o valor dimensionado;
- cartão: preço diferente pode ser praticado se informado de forma clara antes da contratação;
- cancelamento: preservar o direito de arrependimento quando aplicável e usar retenção/multa proporcional a prazo e custos efetivos.

### Validação jurídica obrigatória

- compatibilidade do sinal não reembolsável e multa de 50% nos 30 dias anteriores com o CDC e a proporcionalidade do caso;
- direito de arrependimento em contratação remota;
- tratamento de força maior, chuva e reagendamento;
- forma de comprovação de custos não recuperáveis;
- texto final sobre diferença de preço no cartão;
- base legal, retenção e exclusão dos dados do evento.

Referências oficiais: Lei 8.078/1990 (CDC, especialmente arts. 6, 39, 46, 49 e 51), Lei 13.455/2017 (diferenciação por instrumento/prazo de pagamento) e LGPD.

## 16. WhatsApp

```text
Olá, {nome}! Recebemos sua configuração de evento {codigo} para {data}, às {hora}, com {convidados} convidados.

Opção escolhida: {pacote}
Valor preliminar: {valor_por_pessoa} por pessoa, total de {total}, com atendimento incluído.

Esta é uma pré-proposta. Vamos confirmar disponibilidade, operação e eventuais condições especiais antes de liberar a proposta definitiva e o sinal.
```

## 17. Plano por etapas

### Etapa A - MVP implementado localmente

- página pública e privacidade;
- motor server-side e 10 cenários automatizados;
- tabelas/RLS/seeds isolados;
- classificação dos 81 produtos;
- armazenamento, auditoria e rotas administrativas da Edge Function.

### Etapa B - aplicação controlada

- revisar regras com cozinha/proprietário;
- aplicar `eventos-schema.sql`, `eventos-rls.sql`, `eventos-seed.sql`;
- publicar `event-quote` com `verify_jwt=false` e validação interna das rotas admin;
- testar CORS, rate limit e RLS em staging;
- alimentar agregados de demanda;
- publicar o site.

### Etapa C - rotina no `gestao` (interface implementada; publicação pendente)

- publicar página, migration e permissão editável já implementadas;
- gerar PDF e resumo de WhatsApp;
- aprovar proposta, aceite e sinal;
- registrar realizado do evento e recalibrar consumo/margem.

### Etapa D - aprendizado

- comparar previsto × consumido × sobra × equipe × duração;
- substituir CMV de 35% por custo real por produto;
- ajustar faixas apenas com amostra suficiente;
- versionar toda mudança.

## 18. Cenários de aceitação automatizados

`supabase/functions/event-quote/pricing_test.ts` cobre:

1. 30 pessoas, almoço em dia de semana, sem álcool;
2. 50 pessoas, sexta, petiscos e chope;
3. 60 pessoas, sábado, sem exclusividade;
4. 80 pessoas, sábado forte, com exclusividade e piso de oportunidade;
5. 100 pessoas, duração ampliada;
6. open bar;
7. data bloqueada;
8. piso/margem protegidos;
9. alteração de quantidade;
10. tentativa de preço manipulado no navegador.

## 19. Limites conhecidos

- A Edge Function e os SQLs ainda não foram aplicados no Supabase.
- O cálculo de disponibilidade usa reservas e capacidade existentes, mas precisa ser validado contra a operação real de eventos, que ocupa área e janela diferentes de uma mesa comum.
- O agregado de oportunidade está vazio; não há taxa de alta demanda inventada.
- PDF, aceite, sinal e resultado real pertencem às próximas etapas.
- O preço é proposta comercial, não estimativa de lucro líquido.
