# Medicao de ChatGPT Ads

Esta integracao mede dois momentos do funil:

```
ChatGPT Ads -> entrada no site -> reserva confirmada -> visita realizada
```

- `page_viewed`: disparado pelo Pixel ao abrir a pagina de reservas.
- `appointment_scheduled`: disparado pelo Pixel quando a reserva e concluida.
- `visit_realized`: conversao server-side, enfileirada somente quando a equipe marca a reserva como `compareceu`.

O `oppref` e os UTMs ficam gravados na reserva. O evento presencial usa o mesmo `oppref`, portanto a chave da Conversions API nunca vai para o navegador.

## Ativacao

1. No Supabase SQL Editor, execute [`supabase/openai-ads.sql`](../supabase/openai-ads.sql) uma unica vez.
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

Prefira apontar o anuncio diretamente para a pagina de reservas:

```text
https://reservas.sirfisher.com.br/?utm_source=chatgpt&utm_medium=paid&utm_campaign=<nome-da-campanha>
```

O ChatGPT Ads acrescenta `oppref` automaticamente. O sistema tambem armazena `campaign_id`, `ad_group_id` e `ad_id` se chegarem na URL, mas a documentacao atual informa que macros dinamicas de UTM nao sao suportadas. Use UTMs estaticas e exporte os IDs pelo Ads Manager quando precisar detalhar campanhas.

Se o destino precisar ser `www.sirfisher.com.br` antes de abrir a reserva, instale o mesmo mecanismo de captura nesse site ou propague os parametros no link para `reservas.sirfisher.com.br`. O cookie do projeto foi preparado para compartilhar a atribuicao entre subdominios de `sirfisher.com.br`, mas a pagina institucional tambem precisa capturar o clique inicial.

## Privacidade e limites

O fluxo server-side envia somente o `oppref` e o evento de visita; nao envia nome, telefone ou e-mail do cliente. Antes de habilitar o Pixel, atualize o aviso de privacidade e aplique o consentimento que for exigido para o seu caso. O Pixel da OpenAI suporta controle explicito de consentimento.

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
