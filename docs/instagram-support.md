# Atendimento do Instagram em nuvem

Implantado em 01/11/2026: **instagram-support versão 1, ACTIVE no portal,
com atendimento desligado**. O commit de código é `104f007` em `reservas`.
Os três gates de runtime foram conferidos por digest: modo off, uso de dados
de clientes false e alertas false. Nenhum cliente recebeu mensagem por esta
função e o cron não foi ativado.

O HTTP público retornou 503 `not_configured`, esperado enquanto falta o App
Secret; controle anônimo retornou 403 e worker sem segredo retornou 401.
Página administrativa e módulo JavaScript responderam HTTP 200. Login,
fila e callback com conta controlada continuam como testes separados.

## Componentes

- `supabase/functions/instagram-support/`: webhook assinado, processamento
  da fila, classificação por enum e API administrativa. Usa Web APIs nativas,
  sem nova dependência externa.
- `admin/atendimento.html`: fila humana, aviso de falha de e-mail, pausa
  global, assumir caso, encerrar e retomar uma conversa. A navegação do
  portal exibe o link somente para administradores.
- Banco isolado em `instagram_support`, na migration do repositório
  `gestao`: `20261101071634_instagram_support_durable_queue.sql`.
  Não modifica tabelas de reservas ou finanças. RPCs somente `service_role`,
  RLS e grants explícitos. Consultar a migration para o contrato atual.

O projeto aceito pelo backend é `lucpxoynpvogkvzepagi.supabase.co`, portal.
Os ativos fixos são o app `224912007567636`, Página `107690041045934` e
Instagram `17841439937145607`. Esses identificadores não são credenciais.

## Entrada e fila durável

`GET /functions/v1/instagram-support` responde à verificação oficial da
Meta somente quando `hub.mode`, token e challenge são válidos.

`POST` valida `X-Hub-Signature-256` por HMAC-SHA256 sobre os bytes originais,
antes de interpretar ou gravar o JSON. O corpo tem limite de 64 KiB e o
lote tem até 40 eventos. Só aceita eventos do Instagram e dos ativos
esperados. Ignora leituras, reações, mensagens apagadas e grupos sinalizados.
Comentários públicos não são tratados por este MVP.

Cada `mid` entra uma vez no banco antes do HTTP 200. `waitUntil` apenas
acelera o processamento: a fila e os leases ficam no Postgres. O fallback
cron chama `/drain` com segredo próprio; o job e a configuração começam
desligados. Não criar uma segunda rotina para a mesma fila.

Mensagens longas ou com pedido de humano, reclamação, cobrança contestada,
urgência, alergia, alteração de reserva, objeto perdido ou evento recebem
uma classificação de segurança antes de qualquer truncamento. A ingesta
pausa a conversa e cria o caso na mesma transação. Uma mensagem posterior
não pode apagar esse pedido. Nesse caminho conservador, a gerente responde;
o bot não envia uma confirmação automática de transferência.

Echo com `mid` já registrado no outbox é reconhecido como próprio. Echo
desconhecido pausa a conversa sem prazo automático. Um echo próprio que
chegue antes do retorno da Meta pode causar uma pausa conservadora; o painel
permite retomar depois da conferência. O código não depende de `app_id`
de echo nem do protocolo legado de handover do Messenger.

## IA e respostas

O Gemini **somente escolhe um enum**. O servidor recusa saída fora da lista,
resposta incompleta ou metadados de uso inválidos. Ele envia textos revisados
do `policy.mjs`; não envia texto livre escrito pelo modelo.

As informações vêm de `gestao/docs/instagram-atendimento/CONHECIMENTO.md`
e das confirmações do proprietário de 01/11/2026. O bot se identifica como
assistente virtual, oferece pessoa e responde em português. Preços e porções
do catálogo permanecem em conferência. Horários preservam as exceções de
24, 25 e 31/12/2026. As datas fornecidas pelo cliente sobrevivem à remoção
de contatos do texto.

Reservas, disponibilidade, pagamentos e cancelamentos **não são executados
por esta função**. Ela orienta o portal e o link seguro de cancelamento.
Não confirma vaga, reserva ou quitação sem resultado do sistema correspondente.
Um assunto desconhecido recebe um pedido de esclarecimento; se continuar
sem resposta, a conversa vai para a fila humana e fica pausada.

A automação respeita uma janela conservadora de 24h desde a mensagem
recebida. Não usa Human Agent para prolongar IA e não responde ao histórico
retroativamente. A cobertura do webhook Facebook Login precisa passar por
teste real com conta que tenha papel no app. A falta de Advanced Access
observada na listagem não prova, por si, bloqueio universal de todos os
eventos; a aprovação necessária deve ser verificada antes de usar clientes.

## Custo e privacidade

Modelo fixo: `gemini-3.5-flash-lite`. Em 01/11/2026, o preço Standard
publicado era US$0,30 por milhão de tokens de entrada e US$2,50 por milhão
de saída. Limites por chamada: 4.096 tokens de entrada e 96 de saída. O
servidor usa um limite conservador por bytes antes da chamada e não oferece
ferramentas, busca, loops ou repetição automática da IA.

O banco reserva **2 centavos antes de chamar o modelo**, com limites
independentes de R$45/mês, 2.000 gerações/mês, dez por minuto no agente e
três por dez minutos na conversa. Uma cotação de R$10/US$ serve à estimativa
conservadora desse preço. No padrão de duas parcelas por chamada, 2.000
gerações reservam R$40. Erro, timeout e ausência de metadados conservam a
reserva inteira. Um limite de tokens excedido pausa o agente para revisão.

Esse teto cobre esta integração de IA. A margem de R$5 e o custo total
dependem do plano e das cotas existentes de hospedagem/e-mail, que precisam
ser conferidos pelo responsável. O código não configura faturamento nem
garante o bloqueio financeiro de outros usos da mesma conta do Google.

O teste real com pergunta pública retornou HTTP 200, enum `HOURS`, 297
tokens de entrada e dois de saída. Isso comprova a chamada por enum;
não comprova o tier financeiro ou a franquia desta chave. O tier gratuito
pode usar conteúdo para melhorar produtos. Antes de texto real de clientes,
o responsável deve verificar o plano/termos e liberar os gates de privacidade.

Não são gravados corpos de webhook ou respostas do provedor em logs. E-mails,
telefones, perfis e links do texto são removidos antes do armazenamento e da
IA. Essa remoção não garante eliminar toda informação pessoal em linguagem
natural; a aprovação de tratamento continua necessária. O banco limpa o
texto dos eventos finalizados e conserva assunto/estado para acompanhamento.
O histórico completo continua no Instagram.

## Atendimento humano e avisos

O painel exige JWT válido, confirmação por `/auth/v1/user` e `fn_is_admin`
com o JWT da própria pessoa. Não aceita papel vindo de `user_metadata`.
A chave de serviço e os segredos permanecem no servidor. O acesso inicial
reutiliza o papel de administrador existente, sem ampliar outros papéis.

Assumir e encerrar mantêm a conversa pausada. Retomar exige confirmação
separada, fecha o caso anterior e espera uma mensagem nova. O painel não
dispara resposta ao histórico. A pausa global também é uma ação registrada.
A pausa bloqueia novos envios; uma resposta cujo envio já começou pode
chegar depois da pausa. Uma operação de resultado incerto exige conferir o
Direct antes de retomar. O painel relê a fila após as ações e informa quando
a mudança não foi confirmada.
O botão “Abrir Direct” abre a caixa oficial: ainda falta um link direto
por conversa comprovado pela API; IDs numéricos de cliente não viram URLs.

O Resend existente pode avisar sobre **caso novo**, quando os dois gates
de alerta estiverem liberados. O destinatário é resolvido no banco pelo
`manager_auth_user_id` configurado e validado como administrador ativo.
O cliente do navegador não recebe esse e-mail. A mensagem contém somente
assunto fixo e link do painel, sem nome, texto ou identificador de cliente.

O outbox de alerta é idempotente por caso/revisão. `Idempotency-Key` fica
estável; a Resend conserva a proteção por 24h. Uma resposta aceita com ID
marca o alerta como aceito pelo provedor, sem afirmar leitura ou entrega na
caixa da gerente. Timeout fica incerto e não é repetido automaticamente.
Falha e supressão aparecem no painel. Ativar avisos não envia casos anteriores
ao instante de liberação. A fila possui cap próprio de tentativas.

## Configuração reservada ao responsável

Segredos usados, sem valores em documentação, frontend ou logs:

| Nome | Uso |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Ambiente server-side do portal. |
| `INSTAGRAM_APP_SECRET` | HMAC oficial do app existente. |
| `INSTAGRAM_VERIFY_TOKEN` | Token de verificação com pelo menos 32 caracteres. |
| `INSTAGRAM_PAGE_ACCESS_TOKEN` | Page token do ativo correto. |
| `INSTAGRAM_DRAIN_SECRET` | Segredo do worker; a cópia do Vault se chama `instagram_support_drain_secret`. |
| `GEMINI_API_KEY` | Chave existente, reutilizada somente no servidor. |
| `RESEND_API_KEY`, `RESEND_FROM` | Configuração existente de e-mail, sem substituir os valores atuais. |

Gates que começam fechados:

- `INSTAGRAM_SUPPORT_MODE=off`; banco com `mode=off` e `paused=true`.
- `INSTAGRAM_AI_DATA_APPROVED=false`; banco com `model_usage_allowed=false`
  e `billing_verified=false`; a validade da tarifa também precisa ser definida.
- `INSTAGRAM_ALERTS_ENABLED=false` e banco com `alerts_enabled=false`.
- Cron inativo; `cron_enabled=false`.

Teste futuro: `mode=test` nos dois lados e **interseção** entre
`INSTAGRAM_TEST_SENDER_IDS` e `test_sender_ids` no banco. Usar somente conta
controlada com papel no app, mensagens sintéticas e destinatário de e-mail
de teste confirmado. O modo live depende de revisão, autenticação, custos
e testes com o responsável. O painel não muda esses gates para produção.

## Verificação local e passos antes de ativar

```powershell
node --test tools/instagram_support_test.mjs tools/deploy_instagram_support_test.mjs
node --check supabase/functions/instagram-support/index.ts
node --check assets/js/adminAtendimento.js
git diff --check
```

Os testes offline usam contratos em memória e transportes simulados. Cobrem
assinatura sobre bytes, limite de corpo, conta incorreta, reentregas, workers
concorrentes, reserva de custo, pausas e corridas com intervenção humana,
texto longo, enum inválido, falha de IA, entrega incerta e e-mail mínimo.
O repositório `gestao` testa os RPCs e as corridas do banco em Postgres local.
Um tipo de teste não substitui o outro.

Antes de ativar: aplicar a migration revisada no portal; implantar a função
em off; testar 403 para controle anônimo e assinatura inválida; verificar
login administrativo e leitura real da fila; configurar callback oficial
e receber evento de conta controlada; testar encaminhamento, alerta e pausa;
conferir ausência de resposta duplicada com as automações nativas/ManyChat;
confirmar custo total e privacidade; apresentar os resultados ao proprietário.
Somente depois liberar clientes. Não enviar mensagem de teste a cliente real.

## Helper de implantação em modo desligado

`tools/deploy_instagram_support.mjs` prepara multipart com os quatro arquivos
de código, sem ZIP nem dependências. Reutiliza a credencial Management API do
ambiente ou de `reservas/.env.local`, em memória, e confirma o projeto `portal`
antes de qualquer gravação. O comando padrão apenas mostra o plano e hashes:

```powershell
node tools/deploy_instagram_support.mjs plan
node tools/deploy_instagram_support.mjs deploy
```

A implantação exige `deploy --apply`, reservado ao responsável depois da
revisão. Antes de enviar código, o helper grava somente os três gates próprios
em off/false. Outros segredos existentes permanecem presentes. Depois, confere
slug, status e configuração JWT na Management API. O helper também confere os
digests dos gates atualizados, inclusive o campo `value` que a API usa para
representar o digest. Esse readback de metadados
não substitui testar o comportamento HTTP da função publicada.

O comando `secrets` recebe um objeto JSON **pelo stdin**; o responsável deve
montá-lo em memória, sem valores na linha de comando ou arquivo temporário.
Sem `--apply`, valida e mostra somente nomes. Com `--apply`, acrescenta nomes
permitidos e conserva valores existentes; `--replace-owned` permite substituir
somente nomes `INSTAGRAM_*` fornecidos explicitamente. Ele não troca uma chave
Gemini já existente e recusa `RESEND_*`, chaves reservadas do Supabase e gates
de ativação. Para Resend, a função reutiliza os segredos já configurados.

O helper não habilita faturamento, cron, modo live, uso de dados de clientes
ou alertas. A implantação de versão 1 foi feita com `deploy --apply` depois
dos testes e do push; somente os gates próprios off/false foram gravados,
e os 20 nomes de segredos existentes foram preservados. Os testes do
helper simulam a API e comprovam ordem, preservação de nomes e ausência de
valores no resultado.

## Referências consultadas em 01/11/2026

- [Supabase changelog](https://supabase.com/changelog): lido o índice markdown;
  a mudança de TLS de 10/11 não exige biblioteca nova no fetch moderno.
- [Supabase: background tasks](https://supabase.com/docs/guides/functions/background-tasks)
  e [autorização](https://supabase.com/docs/guides/functions/auth-headers).
- [Google: geração e enums](https://ai.google.dev/api/generate-content),
  [preços](https://ai.google.dev/gemini-api/docs/pricing) e
  [limites por projeto](https://ai.google.dev/gemini-api/docs/rate-limits).
- [Meta: webhooks](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/webhooks).
  O caminho desta integração usa Facebook Login e deve ser testado nele.
- [Resend: idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)
  e [envio](https://resend.com/docs/api-reference/emails/send-email).
- [Supabase Management API: deploy](https://supabase.com/docs/reference/api/v1-deploy-a-function).
