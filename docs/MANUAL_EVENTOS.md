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

1. **Mesmos itens no cardápio** = porções × preço do cardápio + bebidas × preço do cardápio, mais 10% de serviço.
2. **+ horas além de 3h**: 10% do item 1 por hora.
3. **Mínimo técnico** = (CMV + cozinha por pessoa + freelancers + custo de duração + risco de sobra de bebida) ÷ (1 − 52%) × 1,10.
4. **Piso de oportunidade**: faturamento típico do salão naquele dia e horário. **Hoje está vazio** (não há base histórica carregada), então não influencia.
5. O valor cobrado é o **maior** entre 1+2, 3 e 4, arredondado para cima por pessoa.

Parâmetros provisórios: CMV = 35% do preço de cardápio; margem-alvo 52%; alerta abaixo de 45%; freelancer R$ 100 por diária; cozinha de R$ 7 a R$ 13 por pessoa conforme o pacote. Para o lanche, a base é a média dos três (R$ 39,67); para as travessas, o prato mais caro liberado no nível.

## 3. Como ler a "Análise interna" do painel

| Campo | Significado |
|---|---|
| Valor cobrado | Total da proposta. |
| Mesmos itens no cardápio | Quanto o grupo pagaria pedindo as mesmas porções e bebidas à la carte, com os 10%. |
| Diferença p/ cardápio | Quanto o evento sai acima (ou abaixo) do à la carte. |
| Horas além de 3h | Acréscimo pela duração. |
| Mínimo técnico | O menor valor que preserva 52% de margem com os custos provisórios. |
| Quem definiu o preço | Qual dos três pisos venceu: cardápio, técnico ou oportunidade. |
| CMV estimado | 35% do valor de cardápio dos itens. Provisório. |
| Margem estimada | (valor − CMV − mão de obra − duração − sobra) ÷ valor. Abaixo de 45% fica vermelho. |
| Piso de oportunidade / Mediana comparável | Faturamento típico do salão no mesmo dia e horário. "Sem dado" até a base histórica existir. |

## 4. O que ainda não entra no preço

- **Dia da semana, mês e horário**: só geram alertas ("período potencialmente forte"). O custo de oportunidade estava no escopo inicial, mas depende de carregar a tabela `event_demand_baselines` com o histórico de vendas por dia e hora, o que ainda não foi feito.
- **Custo real por produto**: o CMV de 35% é uma estimativa.

## 5. Regras que vão no PDF

O PDF traz capa, cardápio com fotos e quantidades, bebidas, investimento (sinal, saldo com data, acréscimo de 10% no cartão, dados do PIX) e as regras do contrato-modelo: horário e hora extra, bebidas e maiores de 18, convidados extras e comparecimento menor, pagamento e atraso, serviço volante, alergias, alterações com 7 dias, fornecedores externos e normas municipais, fogos, espaço ao ar livre e chuva, cancelamento (sinal não devolvido e multa de 50% nos 30 dias), força maior e responsabilidades. Termina com os próximos passos e o campo de aceite. Ele não substitui o contrato.
