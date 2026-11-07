# Réveillon — venda de mesas numeradas

Módulo separado da reserva comum para vender as mesas da noite de 31/12. Ele substitui a planilha em que as mesas eram pintadas. A reserva comum dos outros dias continua igual: sem mesa atribuída e com confirmação automática.

- **Página pública:** `reveillon.html` (ex.: `https://reservas.sirfisher.com.br/reveillon.html`)
- **Painel:** `admin/reveillon.html`, no item **Réveillon** do menu do painel
- **Banco:** tabelas `rv_*` (arquivos `supabase/reveillon-*.sql`)

## Como funciona, em uma frase por etapa

1. O cliente escolhe uma mesa livre no mapa, informa quantas pessoas vão e vê o valor calculado na hora.
2. Ao enviar, vira uma **pré-reserva**: a mesa fica "em negociação" por 48h (configurável) e o cliente recebe a chave Pix e o botão para mandar o comprovante pelo WhatsApp.
3. Quando você registra um pagamento de **R$ 0,01 ou mais**, a reserva vira **sinal pago**. O formulário sugere 30% (configurável) e aceita o valor que você combinou com o cliente. Quando o total positivo é pago, a reserva vira **quitada**.
4. Se nenhum pagamento for registrado no prazo, a pré-reserva **expira sozinha** e a mesa volta a ficar livre.

```
pré-reserva ──(pagamento ≥ R$ 0,01)──▶ sinal pago ──(pago ≥ total positivo, ou "marcar quitada")──▶ quitada
     │
     ├── prazo vencido e nenhum pagamento ──▶ expirada  (automático, a cada 15 min)
     └── qualquer status ativo ──▶ cancelada  (admin, com motivo)
```

## Antes de abrir as vendas (uma vez)

No celular, abra **Painel → Réveillon → Configurar**:

1. **Evento, Pix e WhatsApp:** confira a data, o endereço, a chave Pix (já está o CNPJ 37.889.047/0001-68) e o WhatsApp. O titular do Pix é opcional.
2. **Limite de cadeiras:** as 7 laterais (8 cadeiras cada) e as 9 centrais (4 cada) somam 92 cadeiras-base, mas o limite do evento é **96 pessoas nessas mesas** (campo "Limite de cadeiras (sem bistrô)" em Regras). A folga serve para cadeiras extras: a lateral aceita até 16 e a central até 8, desde que a soma geral não passe de 96. Os bistrôs ficam fora dessa conta. O banco confere o limite em toda criação, edição e troca de mesa, inclusive com duas reservas chegando ao mesmo tempo.
3. **Regras de pagamento e prazos:** sinal (30%), desconto no Pix (5%), validade da pré-reserva (48h), aviso antes de expirar (12h), data do saldo (20/12/2026), desconto por criança (R$ 100) e idade (11 anos).
4. **Lotes e preços:** o **Lote 1** vem com os preços combinados. Para criar um Lote 2, toque em **+ Novo lote**. Ele copia os preços e nasce inativo; ajuste valores e vigência e ative. Vale o primeiro lote ativo, pela ordem, dentro da vigência. **Reservas já feitas mantêm o preço do lote em que foram criadas.**
5. **Termos:** o texto integral está lá. Editar cria uma nova versão, e cada reserva guarda a versão que o cliente aceitou, com data e hora.
6. **Mesas e mapa:** o mapa inicial foi desenhado a partir da foto aérea e do croqui do Réveillon 2026 (mureta em diagonal, quiosque oval, DJ, árvore, cerca verde e calçadão), com as cadeiras de cada mesa. Para ajustar, toque em **Editar mapa**: arraste as mesas, o quiosque, o DJ e a árvore; gire a mesa selecionada com ⟲/⟳; depois toque em **Salvar posições**. Tamanho e forma de cada mesa ficam na lista logo abaixo, e o contorno da área, a mureta e a cerca ficam em "Mapa avançado" (JSON). No celular, o mapa rola para o lado para as mesas terem tamanho de toque.
7. **Vendas e integrações:** marque **Vendas abertas no site** e toque em **Salvar**. Enquanto estiver desmarcado, o site mostra o mapa, mas não aceita pré-reservas.

Tudo o que aparece no site (preços, prazos, textos, mensagens de WhatsApp) sai dessas telas. Nada fica fixo no código.

### A página pública (estrutura de venda)

Topo com foto → **A noite** (4 fotos com legenda) → **Incluso** → **As mesas** (preço do lote atual e quantas estão livres, por tipo) → mapa e formulário → **Perguntas frequentes** → chamada final. No celular, um botão fixo "Escolher minha mesa" aparece enquanto o mapa não está na tela.

- Em **Textos da página**: título de "A noite", legendas das fotos (`Título | texto`, uma por linha, na ordem das fotos), linha de prova (vazia = não aparece), perguntas extras (`Pergunta | Resposta`) e a chamada final. As demais perguntas frequentes (horário, pagamento, crianças, grupo, regras) são montadas dos textos que já existem, para a regra não ficar escrita em dois lugares.
- A frase "Restam N das M mesas" no topo só aparece quando 40% ou mais das mesas já saíram. Antes disso, número baixo de vendas não é mostrado.
- As fotos são as do site principal (`www.sirfisher.com.br/assets/img`), exceto duas, que ficam em `assets/img`. A do cartão "DJ e cantor ao vivo" (`festa-reveillon-sir-fisher-*`) é um quadro sem legenda do reel do Réveillon 2025 (Instagram, dez/2025), com a pista cheia; o letreiro do hotel ao fundo foi apagado e a imagem foi restaurada com IA (Gemini: nitidez e borrão de movimento), mantendo cena e pessoas. A do cartão "Os fogos de toda a orla" (`fogos-orla-reveillon-sir-fisher-*`) é uma montagem: a foto do pôr do sol do site levada para a noite, sem o toldo, com janelas e fogos desenhados e finalizada com IA (Gemini) para parecer foto real, porque o Instagram não tem foto boa da queima. O original e o script estão em `site/_materiais/midia/output/reveillon/`. Trocar por foto real da virada quando houver.

## Uso no dia a dia (celular)

### Ver a situação

**Mapa**, com as cores por status:

| Cor | Significado |
|---|---|
| Branca com borda | livre |
| Amarela tracejada | em negociação (marcada à mão, sem cliente e sem prazo) |
| Laranja | pré-reserva (mostra quanto falta do prazo) |
| Vermelha | prazo vencido com pagamento parcial (decida: estender, cobrar ou cancelar) |
| Azul | sinal pago |
| Verde | quitada |
| Cinza tracejada | bloqueada |

O mapa se atualiza sozinho quando alguém reserva, inclusive pelo site.

### Registrar um pagamento (2 toques)

1. Toque na mesa.
2. Toque em **Registrar pagamento**. O valor já vem preenchido com o que falta para o sinal (ou o saldo), no Pix. Trocar para Débito/Crédito ajusta o valor sem o desconto do Pix. A data, o pagador e a observação podem ficar como estão.
3. Confira o valor recebido e toque em **Salvar pagamento**. Qualquer valor a partir de R$ 0,01 confirma o sinal, inclusive abaixo do percentual sugerido.

O status muda sozinho e o cliente recebe o e-mail de "sinal recebido" ou de "quitada".
Depois da confirmação, a ficha mostra **Sinal: Pago** e o saldo restante.
Se todos os pagamentos forem estornados, a reserva volta para pré-reserva;
um estorno parcial mantém o sinal pago enquanto restar pagamento ativo.

> **Pix com desconto:** cada Pix de R$ X abate X ÷ 0,95 do valor cheio. Exemplo: mesa de R$ 2.800 com sinal de R$ 798 no Pix. Abate R$ 840 e o saldo fica R$ 1.960 no cartão, ou R$ 1.862 se também for pago no Pix.

### Outras ações (na folha da mesa)

- **WhatsApp:** quatro botões com mensagem pronta para o cliente: cobrar sinal, sinal recebido, lembrar saldo e confirmação final. Os textos são editáveis em Configurar → Mensagens de WhatsApp.
- **Desconto:** em % ou R$, com motivo obrigatório. Fica registrado quem aplicou.
- **Marcar quitada:** se ainda houver saldo, pede uma justificativa.
- **Alterar prazo:** qualquer data e hora até o início do evento; os botões +12h, +24h e +48h só preenchem o campo (só em pré-reserva). RPC `rv_admin_set_hold`.
- **Marcar em negociação** (mesa livre): tira a mesa do site sem cliente e sem prazo, com uma observação opcional. Some com **Liberar mesa** ou ao **Criar reserva manual** nela. RPC `rv_admin_set_table_negotiating`.
- **Mover de mesa:** mostra o valor novo antes de confirmar se o tipo de mesa mudar.
- **Editar dados:** nome, WhatsApp, e-mail, pessoas e observações. O valor é recalculado.
- **Cancelar:** com motivo. Os pagamentos continuam registrados; a devolução, se houver, é feita por fora.
- **Estornar pagamento:** pelo link "estornar" na lista de pagamentos. Nada é apagado.

### Cliente que fechou pelo WhatsApp

Toque numa mesa livre → **Criar reserva manual**. E-mail é opcional. Dá para liberar abaixo do mínimo e marcar que o cliente aceitou os termos (mande o link de `reveillon.html`). A reserva nasce como pré-reserva, e você já pode registrar o pagamento em seguida.

### Bloquear uma mesa

Toque numa mesa livre → **Bloquear mesa** (ex.: patrocinador). No site ela aparece como reservada.

### Portaria

A aba **Portaria** lista as mesas com reserva: responsável, pessoas e observações, **sem valores**. Tem busca, **Imprimir** (com coluna "Chegou" para marcar à mão) e CSV.

### Resumo e exportação (só admin)

A aba **Resumo** mostra: mesas vendidas por tipo, pessoas, cadeiras usadas contra o limite de 96 (laterais + centrais) e a ocupação dos bistrôs, total vendido, recebido (por forma), a receber, consumação comprometida e descontos (crianças, manuais e Pix). **Exportar CSV** gera a planilha completa para o Excel (separador `;`, vírgula decimal).

## Perfis

| | Admin | Operador | Site (público) |
|---|:---:|:---:|:---:|
| Mapa com status das mesas | ✅ | ✅ | livre / em negociação / reservada |
| Nome, pessoas e observações | ✅ | ✅ | ❌ |
| Telefone e e-mail do cliente | ✅ | ❌ | ❌ |
| Preços, valores, pagamentos e descontos | ✅ | ❌ | só a tabela de preços e a própria simulação |
| Portaria (sem valores) | ✅ | ✅ | ❌ |
| Resumo financeiro / CSV com valores | ✅ | ❌ | ❌ |
| Registrar pagamento e demais ações | ✅ | ❌ | ❌ |
| Configurações | ✅ | ❌ | ❌ |

Essas restrições são garantidas **no banco**, não só na tela:
- O operador não tem leitura das tabelas com valor (`rv_bookings`, `rv_payments`, `rv_lot_prices`, `rv_events`).
- As funções `rv_staff_board` e `rv_door_list` só incluem campos financeiros quando quem chama é admin.
- O público (chave anon) só lê `rv_table_state`, que tem id da mesa e estado, e usa as funções `rv_public_event`, `rv_simulate` e `rv_create_prebooking`.

## E-mails automáticos

Pela fila `notification_queue` e pela Edge Function `send-notifications` (a mesma da reserva comum):

| Tipo | Quando |
|---|---|
| `rv_prebooking` | ao criar a pré-reserva: chave Pix, valor do sinal e prazo |
| `rv_expiry_warning` | 12h antes de expirar, se ainda não houver pagamento |
| `rv_deposit_received` | ao registrar o primeiro pagamento positivo |
| `rv_paid_in_full` | quando fica quitada |

Liga e desliga em Configurar → Vendas e integrações ("Enviar e-mails automáticos").

## Conversões de Ads

Estão preparadas no site (GA4 `reveillon_prebooking`, Meta `Lead` com `eventID sf-rv-<id>`, ChatGPT Ads `lead_submitted`) e **desligadas**. Para ligar, use Configurar → Vendas e integrações. A parte servidor (CAPI) não foi ligada à fila `ad_conversion_events`; veja `future-roadmap.md`.

## Reserva comum em 31/12

A data 31/12/2026 está em `blocked_dates`. Quem escolher esse dia na reserva comum vê uma mensagem com o botão **Ver mesas do Réveillon**, que vem de `restaurant_settings.special_date_notices`. Os outros dias não mudaram.

## Parte técnica

### Arquivos SQL (ordem de aplicação)

Todos já foram aplicados no projeto `lucpxoynpvogkvzepagi`. Para um projeto novo, rode depois dos arquivos da reserva comum:

1. `supabase/reveillon-schema.sql`: tabelas, o índice único de 1 reserva ativa por mesa e a coluna `rv_booking_id` em `notification_queue`.
2. `supabase/reveillon-functions.sql`: `rv_calc_price` (função única de preço), RPCs, triggers e o job pg_cron `rv-reveillon-tick` (a cada 15 min).
3. `supabase/reveillon-rls.sql`: RLS, grants e a publicação Realtime de `rv_table_state`.
4. `supabase/reveillon-seed.sql`: evento Réveillon 2027, termos, tipos, 21 mesas (7 laterais, 9 centrais, 5 bistrôs; numeradas pela posição, bistrô com "B" e sem número repetido) e Lote 1.
5. `supabase/reveillon-integration.sql`: bloqueio de 31/12 e aviso na reserva comum.

`supabase/reveillon-tests.sql` roda todos os testes dentro de uma transação com ROLLBACK (nada fica gravado): preços, anti-colisão, expiração e permissões de anon e operador. O resultado esperado é `TODOS OS TESTES PASSARAM`.

### Sinal aceito abaixo do percentual sugerido (07/11/2026)

A migration `20261107175623_reveillon_any_positive_deposit.sql`, no repositório
`gestao`, foi aplicada no `portal` em 07/11/2026 e atualiza `rv_recalc_booking`
e `rv_admin_register_payment`. A regra
aceita pagamentos finitos a partir de R$ 0,01. Os cálculos de 30%, desconto Pix
e saldo continuam usando `rv_calc_price`. A quitação do total positivo e as
permissões administrativas mantêm suas regras.

A migration ajusta pré-reservas que já têm pagamento ativo, preserva os
lançamentos e registra a mudança de status no histórico. Essa correção de
registros antigos não enfileira e-mail retroativo. Em instalações sem o módulo
de Réveillon, a migration encerra sem criar objetos. Os arquivos SQL de
instalação deste repositório já contêm a regra atualizada.

`supabase/reveillon-deposit-tests.sql` testa as três formas de pagamento,
R$ 0,01, sugestão de 30%, estornos, desconto, total zero, quitação e permissões
em transação com ROLLBACK. O resultado esperado é `TESTES DO SINAL PASSARAM`.
O teste local do formulário simula as RPCs, bloqueia a rede externa e confere
390px e 1366px, incluindo o retorno de um pagamento de R$ 0,01:

```text
python tools/reveillon_payment_browser_test.py
```

### Garantias

- **Nunca 2 reservas ativas na mesma mesa:** índice único parcial `uq_rv_bookings_one_active_per_table` e trava da linha da mesa em `rv_create_prebooking`. Testado com 20 chamadas HTTP simultâneas à mesma mesa: 1 sucesso e 19 recusas "mesa acabou de ser reservada".
- **Mesmo valor em todo lugar:** simulação pública, reserva gravada e painel usam `rv_calc_price`. A reserva guarda uma cópia dos preços do lote (colunas `snap_*`).
- **Expiração:** a mesa aparece livre no segundo exato do vencimento (`rv_table_live_state`). O cron só grava o status `expirada` e manda o aviso de 12h.
- **Limite de 96 cadeiras (sem bistrô):** `rv_seat_limit_error`, com trava do evento. Testado com 7 pré-reservas simultâneas de 8 pessoas e limite em 16: 2 passaram e 5 foram recusadas.
- **Anti-abuso no site:** honeypot, 3 pedidos a cada 10 min por contato e até 3 pré-reservas abertas por telefone ou e-mail (configurável).

### Teste de concorrência (para repetir)

Com as vendas abertas, dispare 20 chamadas simultâneas a `/rest/v1/rpc/rv_create_prebooking` na mesma mesa, com a chave anon e telefones diferentes. Deve haver exatamente 1 sucesso. Depois apague as reservas de teste.
