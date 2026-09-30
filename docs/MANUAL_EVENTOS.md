# Manual de eventos — o que o cliente contrata e como ler o painel

Atualizado em 29/09/2026 (regras `eventos-2026-09-v2`). Fonte das regras: `supabase/functions/event-quote/pricing.ts`.

## 1. O que o cliente escolhe

O configurador tem 4 etapas: data e horário, convidados, comida e bebidas. Aceita de **30 a 100 convidados sentados** (96 cadeiras autorizadas + 4 extras). Abaixo de 30, o trabalho fixo de um evento (proposta, contrato, sinal, lista, briefing) e o desconto não compensam, e o site tira o cliente do orçamento: até 10 pessoas, reserva de mesa no site de reservas; de 11 a 29, reserva de mesas pelo WhatsApp (o site de reservas vai até 10), sempre com link para o cardápio. Acima de 100 sentados, ou evento em pé, WhatsApp para a equipe avaliar. No painel, a equipe pode ajustar uma proposta fora dessa faixa. No fim, o cliente sempre vê **três níveis lado a lado** (Essencial, Equilibrada e Completa) do formato escolhido e escolhe um.

### Comida — 3 formatos

| Formato | O que é |
|---|---|
| **Petiscos** | Petiscos servidos por garçons circulando (serviço volante) durante todo o evento. |
| **Petiscos + clássico da casa** | Petiscos na recepção e, depois, **1 clássico da casa por convidado**, à escolha: Edimburger, Fisher Burger ou Fish & Chips. O cliente informa até 7 dias antes quantos de cada. |
| **Petiscos + almoço ou jantar** | Petiscos na recepção e **pratos para compartilhar em travessas** (1 travessa de 300 g de proteína a cada 2 convidados), com arroz, batata ou macaxeira, salada, farota e molho. O cliente escolhe 2 proteínas da lista do nível até 7 dias antes. |

### O que muda em cada nível

**Petiscos**

| Nível | Itens | Unidades por pessoa |
|---|---|---|
| Essencial | pasteizinhos, bolinha de peixe, crocante de carne de sol, dadinho | ~7 |
| Equilibrada | pasteizinhos, bolinha, crocantes (carne de sol + calabresa), dadinho, Crispy Spicy Chicken, isca de peixe | ~9 |
| Completa | tudo da Equilibrada + NewCastle (1 porção de camarão a cada 4 convidados) | ~11 |

**Petiscos + clássico da casa** (sempre 1 clássico da casa por pessoa)

| Nível | Petiscos | Extra |
|---|---|---|
| Essencial | pasteizinhos, crocante de carne de sol, dadinho (~4 un.) | — |
| Equilibrada | pasteizinhos, bolinha, crocantes, dadinho (~5 un.) | brownie |
| Completa | pasteizinhos, bolinha, crocantes, dadinho, NewCastle (1 porção a cada 4 convidados) | brownie com sorvete |

**Petiscos + almoço ou jantar**

| Nível | Petiscos | Proteínas liberadas (escolher 2) | Sobremesa |
|---|---|---|---|
| Essencial | pasteizinhos, dadinho (~3 un.) | peito de frango com ervas, picanha suína, filé de peixe grelhado | — |
| Equilibrada | pasteizinhos, bolinha, dadinho (~4 un.) | as do Essencial + carne de sol acebolada | brownie |
| Completa | pasteizinhos, bolinha, crocantes, NewCastle (1 porção a cada 5 convidados) | filé de peixe, carne de sol, filé mignon, picanha importada | brownie com sorvete |

"Principal grelhado" e "principal premium", da versão 1, deixaram de existir: agora cada nível diz exatamente quais pratos entram.

Cada nível custa pelo menos R$ 7 a mais por pessoa que o anterior (há teste automático). Na comparação, um nível que empate com o de cima ou não fique abaixo do cardápio (quando o piso do horário segura o preço) é escondido do cliente e aparece como alerta no painel.

### Bebidas — 4 modelos

| Modelo | O que está incluído | Depois disso |
|---|---|---|
| **Sem bebidas incluídas** | nada | cada convidado paga o que pedir, na comanda |
| **Água, refrigerante e suco** | 2 por convidado (água, refrigerante ou suco) | comanda individual |
| **Chope + água, refrigerante e suco** | 3 chopes Brahma 300 ml por adulto + 1 água, refrigerante ou suco por convidado | comanda individual |
| **Chope e coquetel + água, refrigerante e suco** | 2 chopes + 1 caipirinha ou caipiroska por adulto + 1 água, refrigerante ou suco por convidado | comanda individual |

Crianças contam só nas bebidas sem álcool. Open bar, fichas, crédito e "pacote selecionado" saíram do site; se um cliente pedir, a equipe ajusta a proposta manualmente no painel.

### Duração

Todos os pacotes incluem **3 horas**. Cada hora a mais acrescenta **10% do valor de cardápio** (a mesma regra de hora extra do contrato). A hora a mais não aumenta as bebidas incluídas.

### Exclusividade do espaço

O site não oferece nem cota exclusividade: a função ignora esse pedido vindo do site. Quem quiser o espaço só para o grupo trata diretamente com a equipe, e o preço é negociado caso a caso. Ele precisa cobrir o que o salão deixaria de faturar naquele dia e horário; o painel mostra o "faturamento esperado na janela" como referência.

### Valores são estimativa

O site deixa claro, em três pontos, que o valor é uma estimativa: o quadro "Estes valores são uma estimativa, não uma proposta fechada" acima dos cartões (você escolhe → a equipe confere e pode ajustar → proposta oficial); "valor estimado por pessoa" em cada cartão; e uma caixa obrigatória antes do envio ("Entendo que os valores são uma estimativa e só valem depois da confirmação da equipe e da proposta oficial"). A função recusa o envio sem esse aceite e o registra no histórico do pedido.

### Datas fechadas

O site recusa **24/12 e 25/12** (casa fechada) e encaminha **31/12** para a página do Réveillon.

## 2. Como o preço é calculado

O evento sai **abaixo do cardápio**: o cliente paga antes, fecha a quantidade e assume o risco de sobra, e a casa ganha no volume.

1. **Valor de cardápio** = porções × preço do cardápio + bebidas × preço do cardápio, mais 10% de serviço. Cada hora além de 3h soma 10%.
2. **Desconto** (teto de 25%), somando:
   - **antecipado:** 5% sempre;
   - **volume:** 3% (30–40 convidados), 6% (41–60), 8% (61–80), 10% (81 ou mais);
   - **horário:** até 10%. É 10% × (1 − movimento do horário). Com o salão vazio, 10%; no pico, perto de 0%. Evento exclusivo não recebe essa parte;
   - **formato:** petiscos 3%, petiscos + clássico da casa 2%, almoço/jantar 0% (itens em lote custam menos para a cozinha).
   - **nível** (aplicado depois do teto): Essencial −3 pontos, Equilibrada 0, Completa +3 pontos, para o cliente ver vantagem em subir de nível. Ex.: 10% / 13% / 16%.
   - **temporada** (também depois do teto): escala contínua pelo fator do mês, de **+5%** no mês mais fraco (hoje março) a **−5%** no mais forte (hoje dezembro). Nos meses fortes, a redução só vale inteira com a casa movimentada (movimento de 60% do pico ou mais); em horário tranquilo cai na mesma proporção. Nos meses fracos o bônus vale sempre.

   Exemplo (60 pessoas, clássico da casa + chope, Essencial): quarta 15h vai de R$ 82 em março a R$ 92 em dezembro; sábado 19h, de R$ 86 a R$ 99.
3. **Pisos**, que o preço nunca fura:
   - **custo:** (CMV + freelancers de salão + cozinheiros extras + horas extras + sobra de bebida) ÷ (1 − 35%) × 1,10. Garante margem mínima de 35%. A equipe fixa da cozinha não entra, porque é paga com ou sem evento;
   - **oportunidade:** faturamento esperado do salão na janela do evento × parte do salão ocupada (convidados ÷ capacidade, ou 100% se exclusivo). O evento nunca sai por menos do que o salão faria normalmente naquele horário.
4. Preço = o maior entre cardápio com desconto e os dois pisos, arredondado para cima por pessoa.

### Como a economia aparece para o cliente

- **Valor de referência:** mesmos itens no cardápio, com os 10%, mais as horas além de 3h pelo preço de tabela (10% por hora).
- **Site:** selo "−X% sobre o cardápio" no topo do cartão e o quadro "Você economiza R$ Y", com o valor por pessoa e o preço de referência riscado.
- **PDF:** faixa dourada "Você economiza R$ Y (X%)" no quadro do investimento e a linha "Condição de evento".

### De onde vêm os dados

| Dado | Fonte |
|---|---|
| Movimento por dia da semana e hora | `escala_demanda_base` (faturamento médio por hora, últimos 12 meses, no horário do pedido) |
| Fator do mês | **Metas** (`meta_mensal`): meta por dia aberto ÷ média dos 12 meses mais recentes com meta. Dezembro conta 28 dias (sem 24, 25 e 31/12). Para mudar a força de um mês, ajuste a meta dele |
| CMV | `painel_resumo_mensal`: média do CMV % dos últimos 6 meses fechados; sem dado, 35% |
| Capacidade | `restaurant_settings.total_capacity` |

Esses dados ficam prontos na tabela `event_demand_cache`, recalculada todo dia 1º do mês às 4h20 (`public.refresh_event_demand_cache()`, pelo pg_cron). O orçamento só lê essa linha: fica rápido (~2 s) e o mesmo pedido sempre sai com o mesmo preço. Se o cache sumir ou tiver mais de 45 dias, a função lê o histórico por hora ao vivo e usa a estimativa de mês.

Sem o histórico por hora, a função usa uma estimativa fixa: sexta e sábado à noite = 90% do pico; domingo de dia = 80%; sábado no almoço = 65%; quinta à noite = 55%; outras noites = 40%; almoço em dia de semana = 35%; demais horários = 20%. Jan, jul e dez valem 20% a mais quando também não há histórico mensal. O painel mostra se o pedido usou "histórico" ou "estimativa".

### Feriados

O movimento usa um calendário próprio (`supabase/functions/event-quote/holidays.ts`):

- **feriado conta como domingo:** nacionais (1/1, Tiradentes, 1/5, 7/9, 12/10, Finados, 15/11, Consciência Negra, Natal), móveis (Carnaval segunda e terça, Sexta-feira Santa, Corpus Christi), Ceará (19/3 São José, 25/3 Data Magna), Fortaleza (15/8 Assunção), mais 24/12 e 31/12;
- **véspera de feriado conta como sábado**, inclusive domingo antes de feriado de segunda.

O painel mostra o alerta "Feriado (…)" ou "Véspera de feriado (…)" no pedido.

Todos os percentuais são provisórios: calibrar depois dos primeiros eventos reais.

## 3. Semáforo do painel

- **Vermelho:** data bloqueada, conflito com reservas, capacidade estourada ou margem abaixo de 35%.
- **Amarelo** (pede decisão): horário forte da casa, feriado ou véspera, desconto travado por um piso, mais de 80 convidados, mais de 4 horas, casa perto da lotação, agenda não conferida (por exemplo, data além da janela de 60 dias da agenda de reservas) ou convidados fora de 30–100.
- **Verde:** todo o resto. Pode aprovar; os avisos informativos (freelancer, controle do álcool etc.) aparecem no detalhe sem mudar a cor.

Os quadros do topo contam só pedidos **pendentes**.

A agenda é conferida lendo as tabelas de reservas (se a leitura falhar, a função usa a rotina pública `get_available_time_slots`, que cobre 60 dias). A cota de cada horário da grade de reservas (ex.: 48 lugares na quarta) é só a parte reservável e não limita o evento; o limite é a capacidade da casa (100). Reservas já confirmadas no período deixam o pedido amarelo.

### Confirmar o evento e bloquear a agenda

No detalhe do pedido, **"Sinal recebido: confirmar evento"** muda o status para *Confirmado* e bloqueia no site de reservas todos os horários cuja mesa ainda estaria ocupada no início do evento e os que começam antes do fim dele (ex.: evento 17h–21h com mesa de 2h bloqueia 15h30 a 20h). O bloqueio aparece no painel de reservas com o motivo "Evento EV-…". Reservas já feitas continuam valendo.

**"Cancelar evento e liberar agenda"** remove só os bloqueios criados por aquele evento. Bloqueios manuais que já existiam não são mexidos.

## 4. Como ler a "Análise interna" do painel

| Campo | Significado |
|---|---|
| Valor cobrado | Total da proposta. |
| Mesmos itens no cardápio | O que o grupo pagaria à la carte, com os 10%. |
| Diferença p/ cardápio | Quanto o evento sai abaixo do cardápio (negativo = mais barato). |
| Desconto calculado / composição | Antecipado, volume, horário e formato. |
| Movimento do horário | Faturamento das horas do evento ÷ hora mais movimentada da semana, com a fonte. |
| Fator do mês | Força do mês em relação à média. |
| Faturamento esperado na janela | Quanto o salão costuma faturar nessas horas. |
| Piso de oportunidade / Piso de custo | Os dois limites mínimos. |
| Quem definiu o preço | Cardápio com desconto, piso de custo ou faturamento do horário. |
| CMV usado / estimado | Percentual usado (real ou 35%) e valor em reais. |
| Margem estimada | (valor − CMV − mão de obra − duração − sobra) ÷ valor. Abaixo de 45% fica amarelo. |

## 4. Pontos ainda provisórios

- Equipe extra (diária de R$ 100): salão +1 acima de 50 convidados, +1 com coquetel acima de 50 adultos ou chope acima de 70, +1 acima de 4 horas; cozinha +1 a partir de 61 convidados e +2 a partir de 91.
- Os percentuais de desconto e a margem mínima de 35% precisam de calibração com eventos reais.

## 5. Código de verificação da proposta

Cada PDF oficial recebe um código aleatório (ex.: `SF-7K2Q-9XWD`), impresso na capa, no aceite, na nota final e no rodapé de todas as páginas. O código fica gravado no histórico do pedido com versão, data de emissão, cliente, data do evento, convidados, pacote, valor por pessoa e total.

Se um cliente apresentar uma proposta, digite o código em **Verificar proposta**, no topo de `eventos.html`. O painel mostra:

- **✓ autêntica**, com os valores registrados: compare com o PDF apresentado; qualquer diferença indica alteração;
- se aquela versão foi **substituída** por uma mais nova;
- **✗ código não encontrado**: a proposta não foi emitida pelo Sir Fisher.

## 6. Regras que vão no PDF

O PDF traz capa, cardápio com fotos e quantidades, bebidas, investimento (sinal, saldo com data, acréscimo de 10% no cartão, dados do PIX) e as regras do contrato-modelo: horário e hora extra, bebidas e maiores de 18, convidados extras e comparecimento menor, pagamento e atraso, serviço volante, alergias, alterações com 7 dias, fornecedores externos e normas municipais, fogos, espaço ao ar livre e chuva, cancelamento (sinal não devolvido e multa de 50% nos 30 dias), força maior e responsabilidades. Termina com os próximos passos e o campo de aceite. Ele não substitui o contrato.
