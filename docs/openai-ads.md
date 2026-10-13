# Medicao de ChatGPT Ads

Esta integracao mede dois momentos do funil:

```
ChatGPT Ads -> entrada no site -> reserva confirmada -> visita realizada
```

- `page_viewed`: disparado pelo Pixel ao abrir a pagina de reservas.
- `appointment_scheduled`: disparado pelo Pixel e pela Conversions API quando a
  reserva e concluida. Os dois envios usam o mesmo `event_id`, portanto contam
  uma unica conversao.
- `visit_realized`: conversao server-side, enfileirada somente quando a equipe marca a reserva como `compareceu`.

O `oppref` e os UTMs ficam gravados na reserva. Os eventos server-side usam o
mesmo `oppref` quando ele existe. E-mail, telefone e identificador interno sao
normalizados e enviados somente como SHA-256; a chave da Conversions API nunca
vai para o navegador.

## Ativacao

1. No Supabase SQL Editor, execute [`supabase/openai-ads.sql`](../supabase/openai-ads.sql)
   e [`supabase/openai-ads-schedule-capi.sql`](../supabase/openai-ads-schedule-capi.sql)
   uma unica vez.
2. No ChatGPT Ads Manager, crie uma fonte de conversoes e obtenha o Pixel ID e a Conversions API key.
3. Configure os secrets da Edge Function no Supabase:

   ```text
   OPENAI_ADS_PIXEL_ID=<pixel-id>
   OPENAI_ADS_CONVERSIONS_API_KEY=<conversions-api-key>
   OPENAI_ADS_TRIGGER_SECRET=<segredo-aleatorio-longo> (necessario para webhook/cron)
   ```

4. Publique a funcao:

   ```bash
   supabase functions deploy send-openai-ads-conversions
   ```

5. Copie apenas o Pixel ID para `OPENAI_ADS_PIXEL_ID` em `assets/js/config.js` e publique o site. Nunca coloque a Conversions API key nesse arquivo.
6. No Ads Manager, associe a campanha aos eventos `appointment_scheduled` e ao evento customizado `visit_realized`.

Para reenvio independente do navegador, crie um Database Webhook no Supabase para `INSERT` em `public.ad_conversion_events`, com URL:

```text
https://<project-ref>.supabase.co/functions/v1/send-openai-ads-conversions
```

Inclua o header `x-openai-ads-secret` com o mesmo valor de `OPENAI_ADS_TRIGGER_SECRET`. A funcao ignora o corpo do webhook e processa a fila pendente. Sem o webhook, o painel ainda tenta enviar a fila quando alguem marca uma reserva como compareceu.

## URL do anuncio

Para anuncios de reserva, o destino pode ser a pagina de reservas:

```text
https://reservas.sirfisher.com.br/?utm_source=chatgpt&utm_medium=paid&utm_campaign=<nome-da-campanha>
```

O ChatGPT Ads acrescenta `oppref` automaticamente. O sistema tambem armazena `campaign_id`, `ad_group_id` e `ad_id` se chegarem na URL, mas a documentacao atual informa que macros dinamicas de UTM nao sao suportadas. Use UTMs estaticas e exporte os IDs pelo Ads Manager quando precisar detalhar campanhas.

Para descoberta da casa, a campanha de outubro usa `/conheca/`, com acesso a
cardapio, rotas e reservas. O site ja captura a origem, compartilha o cookie e
decora os links para o portal. Nao trocar o destino apenas por nao haver reservas.

## Recuperacao de 13 de outubro de 2026

- Campanha de cliques pausada e associada a Reserva confirmada e Visita
  realizada. Orcamento e lance preservados; retomada depende de aprovacao.
- Nova origem substitui os parametros da anterior, sem herdar `oppref` ou IDs
  de outro anuncio. Cookie compartilhado mais recente prevalece sobre storage
  antigo do dominio. Links internos com a mesma origem preservam o toque.
- Pixel e CAPI enviam apenas identificadores reais, normalizados e em hash.
  A cidade do restaurante nao e enviada como localizacao presumida do cliente.
  Telefones internacionais com `+` mantem o codigo original.
- OpenAI e GA4 contam reservas e visitas sem valores monetarios presumidos.
  O evento Meta legado ainda usa estimativa; nao representa consumo realizado.
- A Edge Function foi publicada na versao 17. Os dois contratos de evento
  foram aceitos em `validate_only`, sem salvar conversoes ou reivindicar filas.

O diagnostico autenticado aceita `{"validate_only":true}` no mesmo endpoint e
com a mesma autenticacao do worker. Usa identificador sintetico exclusivo do
teste, nao le clientes e retorna apenas resultado agregado. Nao colocar o
segredo do worker no navegador. O envio normal continua processando a fila.

Testes locais, sem eventos em producao:

```powershell
deno test --allow-read reservas/tools/attribution_test.mjs reservas/tools/openai_event_test.ts reservas/tools/openai_validation_test.mjs
```

Esses testes conferem preservacao da origem, hashes, IDs de deduplicacao,
ausencia de valores presumidos, limites de timestamp e isolamento do diagnostico.
A deduplicacao efetiva de uma futura reserva paga depende da recepcao pelo
provedor; IDs iguais no codigo nao comprovam sozinhos essa recepcao.

## Privacidade e limites

O fluxo server-side nunca envia nome, telefone ou e-mail em texto puro. Ele
envia hashes SHA-256 de e-mail, telefone e identificador interno, alem do
`oppref` quando disponivel. Antes de habilitar o Pixel, atualize o aviso de
privacidade e aplique o consentimento exigido para o caso. O Pixel da OpenAI
suporta controle explicito de consentimento.

Esta entrega mede reservas e comparecimentos. Ela ainda nao mede consumo nem ROAS financeiro, porque o sistema de reservas nao recebe o valor fechado no PDV. Quando houver integracao com o SAIPOS, o proximo evento deve ser `order_created` com o valor em centavos e `BRL`.

## Conferencia operacional

No painel, uma reserva com `oppref` aparece com origem `ChatGPT Ads`; o CSV inclui `oppref`, UTMs e `campaign_id`. Para uma conferencia basica no SQL Editor:

```sql
select
  count(*) filter (where openai_oppref is not null) as reservas_chatgpt,
  count(*) filter (where openai_oppref is not null and status = 'compareceu') as visitas_chatgpt
from public.reservations;
```

Consulte a [documentacao oficial de Conversion Measurement](https://help.openai.com/en/articles/20001409-conversion-measurement), a [Conversions API](https://developers.openai.com/ads/conversions-api) e o [Measurement Pixel](https://developers.openai.com/ads/measurement-pixel) ao configurar a fonte de dados.
