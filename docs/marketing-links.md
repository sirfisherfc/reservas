# Links de conteúdo e campanha

Entrega de 02/11/2026. Acesse
<https://reservas.sirfisher.com.br/admin/links-marketing.html> com perfil de
administrador. O menu do portal contém **Links de marketing**.

## Operação

1. Copie do painel de marketing o ID real da mídia do Instagram ou da
   publicação da Página do Facebook. Identifique a campanha com um nome
   estável em minúsculas, como `novembro-2026`.
2. Escolha plataforma, tipo e página pública de destino. Informe o ID do
   conteúdo. Em anúncio, preencha também os IDs reais de campanha, conjunto
   e anúncio. Esses campos só preparam o link; nenhuma configuração de anúncio
   é alterada.
3. Gere o link, confira a prévia e copie. Use o conteúdo e a data aprovados
   pelo proprietário no fluxo de publicação. Em Stories, o link pode ir no
   adesivo. Legendas comuns do Instagram não oferecem o mesmo acesso por
   clique a um link.
4. Registre o comparecimento no portal quando a visita ocorrer. O mesmo
   registro da reserva conserva a origem e o identificador de conteúdo.

O link registra o conteúdo escolhido pelo administrador. Um destino
compartilhado na bio identifica a campanha desse link; para relacionar uma
reserva a uma publicação, é preciso que o visitante siga seu link próprio.
Repassar um link pode manter a identificação anterior. O registro descreve
o link observado, sujeito à cobertura da coleta.

O gerador aceita destinos HTTPS do site e do portal. No portal, aceita a
página comum de reservas e o Réveillon. Conserva `lang` e contexto público
`sf_origin`/`sf_cta`; remove parâmetros anteriores de campanha e parâmetros
arbitrários de uma URL copiada. Evite nomes, contatos e tokens em campanhas.
O Réveillon mantém suas decisões próprias sobre envio de eventos de anúncios.

## Contrato usado pelo painel

| Parâmetro no link | Destino existente na reserva | Uso |
| --- | --- | --- |
| `utm_source` | `utm_source` | `instagram` ou `facebook` |
| `utm_medium` | `utm_medium` | `organic_social` ou `paid_social` |
| `utm_campaign` | `utm_campaign` | Nome estável da campanha |
| `utm_content` | `utm_content` | `ig_<media-id>` ou `fb_<post-id>` |
| `campaign_id` ou `utm_id` | `chatgpt_campaign_id` | ID da campanha; `campaign_id` explícito prevalece |
| `ad_group_id` | `chatgpt_ad_group_id` | ID do conjunto Meta |
| `ad_id` | `chatgpt_ad_id` | ID do anúncio Meta |

Os nomes `chatgpt_*` são legados. O RPC já gravava esses parâmetros para
qualquer origem. O painel deve conferir `utm_source`, campanha e IDs antes
de relacionar dados da Meta. Esta entrega usa o schema existente.

O cookie compartilhado `sf_attribution_v1` conserva `utm_id`, `utm_content`
e os IDs de anúncio por até 90 dias desde o toque. `reservationAttribution()`
envia o objeto ao RPC, incluindo a campanha normalizada em `campaign_id`.
O portal preserva a data durante a navegação interna e ao enviar o formulário.
Uma nova chegada identificada com referência externa substitui o toque,
mesmo quando apenas a fonte coincide. Sem referência, tags iguais preservam
a cópia válida; esse limite impede concluir que houve outro clique.

## Como ler os resultados

- **Portal:** origem registrada pelo link, reservas criadas e o status que
  a equipe atribuiu à mesma coorte. `source=admin` identifica registros da
  equipe e deve aparecer separado do fluxo público. Reservas criadas usam
  `created_at` em Fortaleza; visitas por data usam `reservation_date`.
- **Google Analytics:** sessões e eventos medidos pela propriedade, conforme
  sua cobertura e regra de atribuição. Bloqueio de tag pode reduzir a coleta.
- **Meta:** resultados atribuídos pelo provedor, com sua janela e sua regra.
  O envio de CAPI confirma recepção de evento conforme a resposta; não
  estabelece sozinho uma relação entre uma publicação e uma reserva.

Para custo por reserva, relacione gastos e reservas com o mesmo ID explícito
de campanha/anúncio e informe período, janela e critério da coorte. Para
custo por comparecimento da coorte, use somente reservas correspondentes
com `status=compareceu`. Denominador sem registros ou correspondência
incompleta produz **indisponível**, até haver dados para calcular. Totais
por data de visita pertencem a outra cobertura e não formam essa coorte.

O Pixel e a CAPI Meta conservam `Schedule` e o mesmo
`sf-sched-<reservation-id>`. A fila mantém sua unicidade. O evento legado
Meta continua enviando a estimativa anterior por pessoa; ela não equivale
à receita confirmada. Retorno financeiro exige consumo efetivamente pago.

## Validação

Executar na pasta `reservas`:

```powershell
npx --yes deno test --allow-read tools/attribution_test.mjs tools/marketing_links_test.mjs tools/reservation_funnel_test.mjs tools/openai_event_test.ts tools/openai_validation_test.mjs tools/meta_event_test.mjs
python -X utf8 tools/reservation_funnel_browser_test.py
python -X utf8 tools/marketing_links_browser_test.py
```

Resultado local: 42 testes Deno passaram. O navegador conferiu a reserva
PT/EN com RPCs simulados e a passagem de conteúdo/campanha até o payload;
o gerador passou em 390 e 1440 pixels, sem erros JavaScript. A guarda do
gerador foi simulada para conferir a interface: o acesso real continua pelo
`requireStaff({adminOnly:true})` já usado no portal. Nenhuma API externa foi
chamada pelos testes e nenhuma reserva real foi criada.

Fontes oficiais consultadas em 02/11/2026:
[parâmetros de campanhas do Google Analytics](https://support.google.com/analytics/answer/10917952?hl=en)
e [dimensões de origem de tráfego](https://support.google.com/analytics/answer/11242841?hl=en).
