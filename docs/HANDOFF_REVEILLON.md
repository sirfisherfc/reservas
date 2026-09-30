# Handoff — módulo de Réveillon 2027

Atualizado em 30/09/2026 (página indexável movida para o www). Este documento permite que outra IA retome o módulo de Réveillon sem depender do histórico da conversa. Manual de uso: [`reveillon.md`](reveillon.md).

## Estado atual (em produção)

- O módulo está publicado e **as vendas estão abertas** (`rv_events.sales_open = true` em 30/09/2026, Lote 1; 2 mesas reservadas e 2 em negociação nessa data).
- E-mails automáticos do réveillon **ligados** (`emails_enabled = true`). Conversões de Ads **desligadas** (`tracking` todo `false`).
- Chave Pix: CNPJ `37889047000168` (tipo `cnpj`). WhatsApp `5585988544274`.
- Evento: Réveillon 2027, 31/12/2026 20h → 01/01/2027 2h, slug `reveillon-2027`.
- Nenhuma reserva real ainda. Todas as reservas de teste foram apagadas.
- Páginas: `reveillon.html` (público) e `admin/reveillon.html` (item **Réveillon** no menu do painel).
- Última versão: `6b8b419` (repo `reservas`, main). A Edge Function `send-notifications` está publicada na versão 20.

## Regras de negócio decididas com o Rogério

- **Mesas (21), numeradas pela posição no mapa**, sem número repetido. Bistrô leva "B" só para identificar; no sistema de vendas lança-se só o número.
  - Beira da mureta, da esquerda para a direita: 01, 02, 03, 04 (laterais), **05 (central de 4 lugares**, ao lado de uma árvore, onde não cabe lateral), 06, 07, 08 (laterais).
  - Fileira do meio: B09, B10 (bistrôs), 11 a 14 (centrais).
  - Fileira de trás, rente à cerca da entrada: B15, B16 (bistrôs), 17 a 20 (centrais).
  - B21: bistrô entre a 11 e a 17, com cadeiras para os lados.
- **Tipos e preços (Lote 1):**

  | Tipo | Valor | Consumação | Pessoas |
  |---|---|---|---|
  | Lateral (azul, 2 mesas unidas) | R$ 2.800 | R$ 800 | mínimo 8, máximo 16 (cadeira extra a partir da 9ª) |
  | Central (verde) | R$ 1.500 | R$ 400 | cobre 4, mínimo 1 (paga as 4), máximo 8 |
  | Bistrô (roxo) | R$ 800 | R$ 200 | exatamente 2 |

  Cadeira extra: R$ 350 com R$ 100 de consumação.
- **Limite do evento: 96 pessoas somando laterais e centrais** (`rv_events.seat_limit`). A base é de 92 cadeiras (7×8 + 9×4) e a folga serve para extras. Bistrôs ficam fora dessa conta (`rv_table_types.counts_toward_limit = false`).
- **Sinal de 30%** em até 48h. Sem sinal, a pré-reserva expira. Com pagamento parcial, **não expira**: o painel mostra "prazo vencido".
- **Pix com desconto** (`rv_events.pix_discount_pct`: 8% em 30/09/2026; era 5% no lançamento): cada Pix de R$ X abate X ÷ (1 − desconto) do valor cheio. Cartão só presencial. Não há gateway nem link de pagamento.
- **Crianças:** de colo não pagam e não contam para o mínimo. Até 11 anos têm R$ 100 de desconto cada.
- **Datas:** saldo até 20/12/2026. Termos: reembolso em até 7 dias, nada após 25/12/2026.
- **Operador** vê só o mapa (status, nome, pessoas, observações) e a portaria, **sem valores**. Isso é garantido no banco, não só na tela.

## Onde está cada coisa

| Parte | Arquivos |
|---|---|
| Banco | `supabase/reveillon-schema.sql`, `reveillon-functions.sql`, `reveillon-rls.sql`, `reveillon-seed.sql`, `reveillon-integration.sql` (nessa ordem) |
| Testes | `supabase/reveillon-tests.sql` (roda em transação com ROLLBACK; esperado `TODOS OS TESTES PASSARAM`) |
| Site | `reveillon.html`, `assets/js/reveillon.js`, `assets/css/reveillon.css` |
| Painel | `admin/reveillon.html`, `assets/js/adminReveillon.js`, `assets/css/admin-reveillon.css` |
| Compartilhado | `assets/js/reveillonCommon.js` (formatação e desenho do mapa SVG), `assets/css/reveillon-map.css` |
| E-mails | `supabase/functions/send-notifications/index.ts` (ramo `rv_*`) |
| Integração com a reserva comum | 31/12 em `blocked_dates` + `restaurant_settings.special_date_notices` + trecho em `assets/js/reservations.js` |

Peças-chave do banco:
- `rv_calc_price`: a única função de preço, usada por simulação, criação e painel.
- `rv_create_prebooking`: trava a mesa e o evento.
- Índice único parcial `uq_rv_bookings_one_active_per_table`.
- `rv_seat_limit_error`: o limite de 96.
- Job pg_cron `rv-reveillon-tick` a cada 15 min: expira pré-reservas e manda o aviso de 12h.
- `rv_table_state`: único dado do módulo legível pelo anon, publicado no Realtime.

## Mapa (como foi feito e como mexer)

- **Base:** desenhado a partir da foto de drone e do croqui do PDF de venda do Réveillon 2026 (`OneDrive/Sir Fisher/Vendas/Eventos/Reveillon 2026. lote 2.pdf`, páginas 4 e 5) e da planilha `Reveillon 2026.xlsx`.
- **Onde fica gravado:**
  - `rv_events.map`: viewBox `[-20, 0, 940, 870]` e elementos de referência (`decor`).
  - `rv_tables`: `x`, `y`, `w`, `h`, `rotation` e `shape` em unidades do viewBox; `x`/`y` são o canto superior esquerdo da mesa sem girar.
- **Elementos de referência (`decor`):**
  - mar;
  - área do salão (`deck`);
  - mureta cinza (`wall`), que desce pelo lado direito como grade até a cerca;
  - quadro de energia em frente à 07 (`box`, sem texto, pedido do Rogério);
  - cerca verde (`hedge`), aberta entre o DJ e a 17;
  - texto "▲ Entrada" (`label`);
  - duas árvores (`tree`);
  - quiosque oval (`kiosk`) e DJ (`dj`);
  - calçadão (`street`).
- **Geometria da beira:** a linha da mureta vai de (220, 195) a (950, 412.5), cerca de 16,6°.
  - Laterais: 100×50, giradas 106,6° (perpendiculares à mureta), com o centro a 65 unidades da linha.
  - Centrais: 50×50. Bistrôs: 36.
  - Cadeiras desenhadas pela capacidade do tipo.
- **Como editar:**
  - Pelo celular, o Rogério ajusta em Painel → Réveillon → Configurar → Mesas e mapa → **Editar mapa**. Arrastar mesas, quiosque, DJ, árvores e texto, e girar a mesa selecionada.
  - **Regra:** ao mexer por SQL, atualizar o banco **e** o `reveillon-seed.sql` (mapa e tabela de mesas), para os dois ficarem iguais.
- **Celular:** o mapa tem 700 px de largura, rola para o lado e abre centralizado nas mesas (`centerMapScroll`).

## Como trabalhar no banco (sem pedir ao Rogério)

- **Projeto Supabase:** `lucpxoynpvogkvzepagi`, **o mesmo banco do repo `gestao`**. Tudo do módulo usa o prefixo `rv_`.
- **Sem MCP:** quando o MCP do Supabase não carrega (sessão aberta fora de `reservas/`), usar a Management API: `POST https://api.supabase.com/v1/projects/lucpxoynpvogkvzepagi/database/query` com o token do `reservas/.mcp.json`. Esse arquivo está no `.gitignore`: **nunca** copiar o token para docs ou commits.
- **Testar como operador ou admin:** no mesmo SQL, `select set_config('request.jwt.claims', json_build_object('sub', <auth_user_id>, 'role', 'authenticated')::text, true); set local role authenticated;`.
- **Testar como anon:** chamadas REST com a chave publicável do `assets/js/config.js`.
- **Não criar usuário via service_role:** o classificador de permissões bloqueou. Para testar a interface do painel, usar Playwright (Edge, `channel='msedge'`) com um mock do `supabaseClient.js` alimentado por respostas reais das RPCs.
- **Edge Function:** a CLI do Supabase está logada na máquina. Antes de republicar, baixar a versão no ar (`supabase functions download ... --use-api`) e comparar com o repo, para não apagar mudança feita direto no Supabase.
- **Windows:** abrir arquivos com `encoding='utf-8'` no Python (o padrão cp1252 quebrou um JSON). Commits na main são o passo final normal, sem pedir confirmação.

## Testes já feitos (produção)

- 20 pré-reservas simultâneas na mesma mesa: 1 sucesso e 19 "mesa acabou de ser reservada".
- Limite em 16 com 7 pré-reservas simultâneas de 8 pessoas: 2 passaram e 5 foram recusadas. O bistrô seguiu livre.
- Simulação pública = valor gravado = painel (4 pontos comparados).
- Anon: sem acesso a nenhuma tabela `rv_*` exceto `rv_table_state`; só executa `rv_public_event`, `rv_simulate` e `rv_create_prebooking`.
- Operador: 0 linhas em `rv_bookings`, `rv_payments`, `rv_lot_prices` e `rv_events`; `FORBIDDEN` nas funções de admin. O JSON do mapa e o da portaria que chegam a ele não têm nenhum campo financeiro nem telefone.
- Os 4 e-mails (`rv_prebooking`, `rv_expiry_warning`, `rv_deposit_received`, `rv_paid_in_full`) foram enviados pelo Resend para `delivered@resend.dev`.
- Reserva comum: 31/12 mostra o aviso com link; os outros dias seguem iguais.
- Página pública e painel testados no Edge headless a 390 px, sem erro no console.

## Fotos da página pública (seção "A noite")

- "De frente para o mar" e "O cardápio do Sir Fisher": fotos do site principal (`www.sirfisher.com.br/assets/img`).
- "DJ e cantor ao vivo": `assets/img/festa-reveillon-sir-fisher-*`. Quadro sem legenda (≈5,3 s) do reel do Réveillon 2025 publicado no Instagram em 27/12/2025 (`media/reels/202512/18090950935968978.mp4` no export). Letreiro "Blue Tree Towers" apagado (OpenCV) e imagem restaurada com Gemini Pro (nitidez, borrão de movimento), mantendo cena e pessoas. O Rogério **reprovou** um quadro do DJ tocando (cena poluída, 720p): não voltar a ele.
- "Os fogos de toda a orla": `assets/img/fogos-orla-reveillon-sir-fisher-*`. Montagem: `pordosol-1200.jpg` do site levada para a noite (sem o toldo, a pedido do Rogério), fogos e janelas desenhados por script e finalizada com Gemini Pro para parecer foto real. O export do Instagram não tem foto utilizável da queima (só ~1 s no mesmo reel, com legenda).
- Originais em alta e o script da montagem (`virada.py`): `site/_materiais/midia/output/reveillon/` (ignorado pelo Git).
- Ao trocar uma imagem mantendo o nome, suba o `?v=` das URLs dela em `reveillon.html` e o `?v=` do CSS/JS.
- Export completo do Instagram (29/09/2026): `OneDrive/Sir Fisher/Marketing/Fotos/Instagram` (`media/` + HTMLs com data e legenda em `your_instagram_activity/media/`).

## Busca do Google (Search Console)

- Propriedade `sc-domain:sirfisher.com.br` (cobre o subdomínio `reservas`). A conta de serviço `ai-analytics@capable-avatar-480514-g0.iam.gserviceaccount.com` (`site/tools/analytics/service_account.json`) tem acesso total, com escopo `webmasters`: dá para inspecionar URLs e enviar sitemaps pela API.
- Em 30/09/2026 a página do réveillon era desconhecida do Google. Criados `robots.txt` (bloqueia `/admin/` e `cancelar.html`), `sitemap.xml` (réveillon + reservas) e o canonical de `reveillon.html`; sitemap enviado sem erros. "Solicitar indexação" só existe na interface do Search Console (a API não faz).
- Inspeção de 30/09/2026: rastreada às 03:37 UTC, **"Rastreada, mas não indexada no momento"**. Linha de base: 0 impressões para consultas com "réveillon" no domínio inteiro (jun/2025 a set/2026).

### SEO da página (branch `seo-reveillon`)

- `<title>` "Réveillon 2027 na Beira-Mar de Fortaleza | Sir Fisher Praia"; o JS monta o mesmo formato com `rv_events.name`.
- O kicker do topo entrou no `<h1>` (visual igual). O h1 renderizado é "Réveillon 2027 na Beira-Mar de Fortaleza / Vire o ano de frente para o mar" (`hero_kicker` trocado no banco e no seed em 30/09/2026).
- "Pé na areia" saiu: o salão fica à beira da praia e uma escada desce direto para a areia (confirmado pelo Rogério). A vista dos fogos (oficial do Aterro + toda a orla) também foi confirmada por ele.
- Texto de abertura (`#intro`), montado do banco (data, horário, endereço).
- O HTML traz **fallback estático** de tudo que o JS preenche (hero, incluso, data/local, cartões de mesa com preços, FAQ). Serve para quem não roda JS e para a primeira leitura do Google; o JS reescreve com o banco.
- FAQ ganhou "O valor é por pessoa ou por mesa?" (montada de `rv_table_types`) e "Onde fica?".
- JSON-LD `Event` no `<head>` (`#event-jsonld`); `syncEventJsonLd` reescreve `offers` com preço e `InStock`/`SoldOut` do banco a cada atualização do mapa.
- Fotos: a da pista leva "Foto do Réveillon 2025 no Sir Fisher"; a dos fogos, "Imagem ilustrativa (montagem sobre foto do local)". Tirar a legenda da montagem quando houver foto real.

- **Desde 30/09/2026 a página indexável é `www.sirfisher.com.br/reveillon/`** (repo `site`, `reveillon/index.html`): conteúdo estático, JSON-LD `Event`, `FAQPage` e `BreadcrumbList`, no sitemap do www. O motivo: o www tem a autoridade do domínio, e a página do subdomínio estava "rastreada, mas não indexada". Os botões levam a `reveillon.html#mapa`, com `utm_content=pagina_reveillon*`.
- `reveillon.html` (subdomínio) virou só a página de venda: `noindex, follow`, sem canonical e fora do `sitemap.xml` do subdomínio. O JSON-LD dela foi mantido (inofensivo), porque o JS o reescreve.
- A home do app (`reservas.sirfisher.com.br/`) continua indexável de propósito: quem busca "reserva Sir Fisher" cai direto no formulário.
- Links internos: home (2), `/eventos/` e `/como-chegar/` do site principal apontam para `/reveillon/` (`data-evt="click_reveillon"`). O post do Perfil da Empresa e os anúncios continuam indo direto para `reveillon.html`, que converte com um clique a menos.
- As fotos da festa e dos fogos foram copiadas para `site/assets/img/` (mesmos nomes). Ao trocar uma, trocar nos dois repos.
- Perfil da Empresa: post padrão com botão "Reservar" publicado em 30/09/2026 (texto sem preço, foto da pista 2025, link com `utm_campaign=gbp_post&utm_content=reveillon_2027`). As visitas dele aparecem no GA4 com essa UTM.

**Manutenção (a cada troca de lote, esgotamento ou edição):**
1. Troca de lote ou de desconto do Pix: atualizar no `reveillon.html` os preços do JSON-LD e dos fallbacks (cartões e FAQ) e subir o `?v=`. **E também em `site/reveillon/index.html`**: tabela de valores, lista de consumação, quadro do Pix ("Valores do 1º lote"), FAQ visível, `FAQPage`, `offers` do `Event` e a meta description ("a partir de R$ 800").
2. Esgotou: no subdomínio o JS marca `SoldOut`. Em `site/reveillon/index.html`, trocar à mão as `offers` para `SoldOut` e ajustar os textos e botões.
3. Depois de 01/01/2027: em `site/reveillon/` e em `reveillon.html`, trocar o texto para "Réveillon 2027 encerrado · lista de interesse para 2028" e manter a URL (não apagar a página); tirar o JSON-LD `Event` ou atualizar para a edição seguinte assim que as datas estiverem definidas.
4. Nova edição: mesmas URLs (`/reveillon/` indexável e `reveillon.html` de venda), novo `rv_events` e revisão de title, description, JSON-LD e fallbacks nas duas.

## Edição de imagem com IA (Gemini)

- Script: `site/tools/ia-imagem/editar.py FOTO "instrução" [--saida arq] [--modelo nome]`; `--modelos` lista os modelos da chave. Padrão: `gemini-3-pro-image`. Saída padrão em `site/_materiais/midia/output/ia/`, para aprovação antes de publicar.
- Chave: variável de ambiente do usuário `GEMINI_API_KEY` (definir com `site/tools/ia-imagem/configurar-chave.ps1`). Conta Google pessoal rogeriof86@gmail.com, projeto `gen-lang-client-0894233383` ("Default Gemini Project"), conta de faturamento `01AD9E-A05044-67AC47`.
- Faturamento em **crédito pré-pago do AI Studio** (R$ 30 em 30/09/2026). Sem saldo pré-pago a API responde 402 "prepayment credits are depleted"; no plano gratuito os modelos de imagem têm cota 0 (429). Os R$ 40 pagos antes entraram como crédito geral da conta de faturamento (pós-pago), que não vale para a API; dá para pedir reembolso na tela de faturamento.
- O console do Google Cloud falha no Chrome deste PC (`ERR_HTTP2_FRAME_SIZE_ERROR`, até em janela anônima). Usar o Edge ou o celular.

## Pendências e riscos

1. **Abrir as vendas** quando o Rogério decidir (um toque no painel).
2. **Painel nunca testado com login real:** só com mock. Recomendar que o Rogério faça uma reserva manual, registre um pagamento e estorne pelo celular antes de abrir as vendas.
3. **Operador vê telefone pela tabela de clientes:** a policy `customers_select_staff` já existia na reserva comum, e o cliente do réveillon entra em `customers`. Valores ele não vê. Restringir exigiria mexer na reserva comum; o Rogério não decidiu.
4. **Conversões server-side (CAPI/GA4 MP) não ligadas:** `ad_conversion_events.reservation_id` é `NOT NULL` e está em produção. Só o navegador está preparado, e desligado.
5. **Mapa:** o Rogério ajustou visualmente até o estado atual. Qualquer pedido novo de posição: editar banco + seed, tirar print e conferir sobreposição com a mureta, a grade e a cerca.
6. **Depois do evento:** desativar o job `rv-reveillon-tick` (`cron.unschedule`) e decidir se `special_date_notices` continua.
7. **Trocar a chave do Gemini:** a atual foi colada no chat em 30/09/2026. Criar outra no AI Studio, apagar a antiga e rodar `configurar-chave.ps1`.
8. **Foto real da virada:** a dos fogos é montagem. Fotografar a queima do salão na virada 2026→2027 (ou pedir o bruto do reel à agência) e trocar.
