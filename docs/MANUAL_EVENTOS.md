# Manual de eventos — o que o cliente contrata e como ler o painel

Atualizado em 29/09/2026 (regras `eventos-2026-09-v2`). Fonte das regras: `supabase/functions/event-quote/pricing.ts`.

## 1. O que o cliente escolhe

O configurador tem 4 etapas: data e horário, convidados, comida e bebidas. No fim, o cliente sempre vê **três níveis lado a lado** (Essencial, Equilibrada e Completa) do formato escolhido e escolhe um.

### Comida — 3 formatos

| Formato | O que é |
|---|---|
| **Só petiscos** | Petiscos servidos por garçons circulando (serviço volante) durante todo o evento. |
| **Petiscos + lanche** | Petiscos na recepção e, depois, **1 lanche por convidado**, à escolha: Edimburger, Fisher Burger ou Fish & Chips. O cliente informa até 7 dias antes quantos de cada. |
| **Petiscos + almoço ou jantar** | Petiscos na recepção e **pratos para compartilhar em travessas** (1 travessa de 300 g de proteína a cada 2 convidados), com arroz, batata ou macaxeira, salada, farota e molho. O cliente escolhe 2 proteínas da lista do nível até 7 dias antes. |

### O que muda em cada nível

**Só petiscos**

| Nível | Itens | Unidades por pessoa |
|---|---|---|
| Essencial | pasteizinhos, bolinha de peixe, crocante de carne de sol, dadinho | ~7 |
| Equilibrada | pasteizinhos, bolinha, crocantes (carne de sol + calabresa), dadinho, Crispy Spicy Chicken | ~8 |
| Completa | pasteizinhos, bolinha, crocantes, dadinho, NewCastle, isca de peixe | ~10 |

**Petiscos + lanche** (sempre 1 lanche por pessoa)

| Nível | Petiscos | Extra |
|---|---|---|
| Essencial | pasteizinhos, crocante de carne de sol, dadinho (~4 un.) | — |
| Equilibrada | pasteizinhos, bolinha, crocantes, dadinho (~5 un.) | — |
| Completa | pasteizinhos, bolinha, crocantes, dadinho, NewCastle (~7 un.) | brownie |

**Petiscos + almoço ou jantar**

| Nível | Petiscos | Proteínas liberadas (escolher 2) | Sobremesa |
|---|---|---|---|
| Essencial | pasteizinhos, dadinho (~3 un.) | peito de frango com ervas, picanha suína, filé de peixe grelhado | — |
| Equilibrada | pasteizinhos, bolinha, dadinho (~4 un.) | as do Essencial + carne de sol acebolada | brownie |
| Completa | pasteizinhos, bolinha, crocantes, NewCastle (~5 un.) | filé de peixe, carne de sol, filé mignon, picanha importada | brownie com sorvete |

"Principal grelhado" e "principal premium", da versão 1, deixaram de existir: agora cada nível diz exatamente quais pratos entram.

### Bebidas — 4 modelos

| Modelo | O que está incluído | Depois disso |
|---|---|---|
| **Sem bebidas incluídas** | nada | cada convidado paga o que pedir, na comanda |
| **Bebidas sem álcool** | 2 por convidado (água, refrigerante ou suco) | comanda individual |
| **Sem álcool + chope** | 3 chopes Brahma 300 ml por adulto + 1 água ou refrigerante por convidado | comanda individual |
| **Sem álcool + chope + coquetel** | 2 chopes + 1 caipirinha ou caipiroska por adulto + 1 água ou refrigerante por convidado | comanda individual |

Crianças contam só nas bebidas sem álcool. Open bar, fichas, crédito e "pacote selecionado" saíram do site; se um cliente pedir, a equipe ajusta a proposta manualmente no painel.

### Duração

Todos os pacotes incluem **3 horas**. Cada hora a mais acrescenta **10% do valor de cardápio** (a mesma regra de hora extra do contrato). A hora a mais não aumenta as bebidas incluídas.

## 2. Como o preço é calculado

O evento sai **abaixo do cardápio**: o cliente paga antes, fecha a quantidade e assume o risco de sobra, e a casa ganha no volume.

1. **Valor de cardápio** = porções × preço do cardápio + bebidas × preço do cardápio, mais 10% de serviço. Cada hora além de 3h soma 10%.
2. **Desconto** (teto de 25%), somando:
   - **antecipado:** 5% sempre;
   - **volume:** 3% (30–40 convidados), 6% (41–60), 8% (61–80), 10% (81 ou mais);
   - **horário:** até 10%. É 10% × (1 − movimento do horário). Com o salão vazio, 10%; no pico, perto de 0%. Evento exclusivo não recebe essa parte;
   - **formato:** petiscos 3%, petiscos + lanche 2%, almoço/jantar 0% (itens em lote custam menos para a cozinha).
3. **Pisos**, que o preço nunca fura:
   - **custo:** (CMV + cozinha por pessoa + freelancers + horas extras + sobra de bebida) ÷ (1 − 35%) × 1,10. Garante margem mínima de 35%;
   - **oportunidade:** faturamento esperado do salão na janela do evento × parte do salão ocupada (convidados ÷ capacidade, ou 100% se exclusivo). O evento nunca sai por menos do que o salão faria normalmente naquele horário.
4. Preço = o maior entre cardápio com desconto e os dois pisos, arredondado para cima por pessoa.

### De onde vêm os dados

| Dado | Fonte |
|---|---|
| Movimento por dia da semana e hora | `escala_demanda_base` (faturamento médio por hora, últimos 12 meses, no horário do pedido) |
| Fator do mês | `painel_resumo_mensal`: faturamento médio do mesmo mês ÷ média dos meses |
| CMV | `painel_resumo_mensal`: média do CMV % dos últimos 6 meses; sem dado, 35% |
| Capacidade | `restaurant_settings.total_capacity` |

Sem o histórico por hora, a função usa uma estimativa fixa: sexta e sábado à noite = 90% do pico; domingo de dia = 80%; sábado no almoço = 65%; quinta à noite = 55%; outras noites = 40%; almoço em dia de semana = 35%; demais horários = 20%. Jan, jul e dez valem 20% a mais quando também não há histórico mensal. O painel mostra se o pedido usou "histórico" ou "estimativa".

Todos os percentuais são provisórios: calibrar depois dos primeiros eventos reais.

## 3. Como ler a "Análise interna" do painel

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

- Custo de cozinha por pessoa (R$ 7 a R$ 13) é estimativa. É ele que mais segura o desconto em "só petiscos".
- Os percentuais de desconto e a margem mínima de 35% precisam de calibração com eventos reais.

## 5. Regras que vão no PDF

O PDF traz capa, cardápio com fotos e quantidades, bebidas, investimento (sinal, saldo com data, acréscimo de 10% no cartão, dados do PIX) e as regras do contrato-modelo: horário e hora extra, bebidas e maiores de 18, convidados extras e comparecimento menor, pagamento e atraso, serviço volante, alergias, alterações com 7 dias, fornecedores externos e normas municipais, fogos, espaço ao ar livre e chuva, cancelamento (sinal não devolvido e multa de 50% nos 30 dias), força maior e responsabilidades. Termina com os próximos passos e o campo de aceite. Ele não substitui o contrato.
