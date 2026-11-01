# Atendimento do Instagram em nuvem

## Atualização de 01/11/2026: próximas FAQs após WhatsApp

Gestao `629247e` e reservas `9cdae46` publicados; Actions e Pages passaram,
painel e módulo HTTP 200 com o texto novo. A migration `20261101161022` foi
aplicada com histórico na mesma transação e cópia privada prévia. Funções
públicas dos outros sistemas e seus grants ficaram iguais; Advisor do
atendimento sem WARN/ERROR. Edge 27 ACTIVE começou em OFF e passou saúde,
autenticação, challenge e HMAC de callback vazio. Os 29 nomes de segredos
existentes foram preservados; dois gates públicos sem credencial foram
acrescentados fechados.

A indicação automática do WhatsApp mantém a próxima FAQ elegível. O caso
continua aberto com um aviso por caso, sem repetir uma tentativa failed,
uncertain ou sent. Se a fonte inicial foi cancelada antes da tentativa, um
pedido novo pode receber o primeiro aviso. Orientação sensível pendente vem
antes da FAQ. Pausas manuais, echo desconhecido e envio incerto preservam
o bloqueio; encerrar preserva a pausa vigente. O cliente inicia o atendimento
no WhatsApp: o link não transfere histórico nem avisa a equipe. Sem horário
humano ou promessa de prazo. Horários da casa foram preservados.

Validação: 81 testes Node (65 atendimento + 8 implantação + 8 ativação),
42 contratos PostgreSQL18 + duas guardas de destino e catálogo227 passaram.
Revisão independente repetiu os 81 Node, sem P1/P2 aberto. O mesmo TEST1 e
cron único foram retomados após check real de identidade; health200,
interseção1, zero pendências, seis envios/três chamadas anteriores,
responsável NULL/e-mails desligados. Ambos os gates públicos de dados e
entrega permanecem false no runtime e no banco.

A continuidade passou depois em ensaio real restrito: pedido humano → FAQ
de endereço → novo pedido humano no mesmo caso produziu um aviso de WhatsApp,
uma FAQ e nenhum segundo aviso. O caso permaneceu aberto e sem pausa até a
coordenação encerrá-lo pelo painel autenticado. O aviso estava sem horário,
prazo ou afirmação de pausa. A FAQ nativa Instagram ficou temporariamente
desligada no ensaio, sob controle da coordenação.
Recebimento até conclusão no banco: aviso 4,620 s, FAQ 5,397 s. São duas
observações, sem SLA. Só a FAQ usou modelo, com 297 tokens de entrada e um
de saída. Leitura após encerrar: oito envios/quatro chamadas acumulados,
zero casos abertos, três fechados, zero pendências e conversa sem pausa.
Cron único ativo/TEST1/gates públicos false preservados, sem replay. O
observador fez somente leituras; o encerramento era de um caso de teste.

A conexão Facebook permanece preservada. A opção oficial Instagram Login
está em preparação pela coordenação: app Empresa separado depende de
autorização específica; consentimento público para Gemini Paid/Supabase e
prova real fora dos papéis continuam separados. Nenhuma IA pública ativada.
O site `42a9ee6` foi publicado e conferido pela coordenação com esse fluxo
futuro explícito. FAQs nativas e regra de reserva OFF estão sem horário humano.

## Registros anteriores

Regra de spam implantada no código `71c5a2d`, Edge 19 ACTIVE: padrões PT/EN antes da
ingesta, caso, aviso e Gemini, com 76 testes Node aprovados (60 atendimento e
16 dos helpers). Spam inequívoco gera 200 e contador agregado, sem guardar
texto/MID ou chamar provedores. Nenhuma mensagem é excluída/bloqueada na Meta.
Relatos de golpe, cobranças próprias, reclamações e pedidos de pessoa têm
prioridade; links, cardápio, CV e propostas comuns seguem o atendimento.
Echo e cancelamento de envio preservam o fluxo. Não há migration ou mudança de
permissão. Revisão independente aprovada. A implantação começou em OFF e
preservou os 29 nomes de segredos; testes HTTP de saúde/HMAC vazio passaram.
Após `--check` com identidade exata, somente o TEST da mesma conta e o cron
existente foram retomados. Health200/interseção1, zero pendências, seis envios
e três chamadas anteriores; responsável NULL/e-mails desligados. Sem chamada
nova de IA, Meta send ou ampliação de lista nessa implantação.
O filtro foi exercitado com callbacks sintéticos locais, incluindo assinatura
e persistência; não foi enviada mensagem real de spam a cliente para testá-lo.

**Estado atual: TEST para a mesma conta controlada, com recuperação em nuvem
ativa. O agente responde apenas à conta de teste.** Para corrigir mensagens canceladas,
o cron e a flag foram desligados, o banco ficou pausado e o uso de dados/modelo
foi fechado, preservando histórico e custos.
A migration `20261101130005_instagram_support_withdrawal.sql`, no projeto
gestao, acrescenta cancelamento por MID e remetente. Antes do processamento,
o cancelamento impede IA e envio; quando a IA já começou, o resultado perde
validade e o consumo reservado é mantido. Texto, classificação e conteúdo
derivado do alvo são retirados. Um registro mínimo impede reentrega tardia.
Outras mensagens e o controle humano permanecem preservados.

Se o envio à Meta já começou, o sistema guarda o resultado/MID ou a incerteza
e não tenta reenviar. O cancelamento não recolhe uma mensagem já enviada nem
remove um prompt já recebido pelo fornecedor. Os contratos usam dados fictícios;
o callback real passou no ensaio específico sob pausa descrito abaixo.
O aviso WhatsApp permanece limitado a uma tentativa por caso, mesmo após
cancelar sua fonte. Quando ainda não houve tentativa, outra fonte válida pode
manter o aviso com a prioridade recalculada.

Validação desta correção: 63 testes Node (47 atendimento + 8 instalador +
8 ativação), 37 contratos PostgreSQL18 e catálogo de 226 migrations.
Revisão independente sem P0/P1/P2 pendente. Fontes consultadas em 01/11/2026:
[webhooks do Messenger Instagram, `is_deleted`](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks),
[revisão para apps da própria empresa](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-your-own-business)
e [termos da plataforma Meta](https://developers.facebook.com/terms/).

Publicação: reservas `85abd70`, gestao `5f6a80a`; migration aplicada com seu
histórico na mesma transação e cópia privada prévia das funções. Definições e
grants das outras funções públicas permaneceram iguais. Security Advisor:
dez INFO do schema privado, zero WARN/ERROR do atendimento. Edge versão 15
ACTIVE implantada em OFF, preservando 29 nomes de segredos. Health OFF 200,
anônimo/segredo incorreto 403, vazio assinado 200/zero eventos, assinatura
alterada 401, challenge correto e controle anônimo 403.

Depois do `--check` real, o helper retomou somente o perfil privado já
autorizado: identidade correspondente, runtime/banco/interseção com uma conta,
dados/modelo aprovados nesse teste e bootstrap zero. O job existente único
`sirfisher-instagram-support-drain`, owner postgres, voltou a ativo a cada minuto,
com `cron_enabled=true` e Vault canônico único. Guard de fila vazia preservado.
Conferência final: conversa de teste sem pausa, zero pendências, seis envios
e três chamadas de IA acumulados; sem novo drain/envio/modelo nesta implantação.
Manager NULL e e-mails desligados. Teto R$45/2.000 gerações/2 centavos preservado,
com tarifa limitada a 30 dias. A recuperação já passou com mensagem real no
ciclo anterior; essa retomada não repetiu o teste nem cancelou mensagem real.

A sonda externa autorizada foi enviada e recebida no Instagram, na Primary
aceita, mas as duas leituras do banco e os logs do webhook não encontraram
evento/POST correspondente. Nenhuma consulta de perfil, IA ou resposta foi
feita para esse perfil; ele permaneceu fora da lista. O resultado não isola
Pedidos, Review ou outra causa de transporte. Produção continua pendente.

Na Meta, configurações 100%, ícone, categoria, descrição, plataforma Website
e instruções do analista foram salvos. A coordenação reabriu as instruções e
confirmou persistência e campos de credenciais vazios. O rascunho declara
piloto exclusivo do proprietário. O guia Meta de app próprio trata detalhes
adicionais de verificação como opcionais e orienta credenciais vazias; não
exigir convite ou conta nova por inferência.
O proprietário confirmou que desligou o acesso a URLs de arquivos e reafirmou
as respostas de segurança nacional, legitimidade e minimização do formulário.
O cadastro preexistente de Anthropic foi preservado como pendência, pois sua
integração efetiva não foi confirmada nem assumida para este agente.

A captura da aba Instagram retornou indisponibilidade do CDP enquanto o
BrowserUse resolvia uma resposta de documento pausada, tanto na aba existente
quanto na nova. A gravação não iniciou e nenhuma pergunta extra, caso, chamada
de modelo ou gravação de clientes foi gerada nessa tentativa de gravação.
Depois, o proprietário autorizou uma única mensagem de teste e seu cancelamento
definitivo. A coordenação enviou e cancelou somente esse alvo na interface.
O ensaio colocou pausa global/cron OFF, capturou a entrada única e seu MID em RAM
e confirmou a marca de retirada, texto já vazio pela pausa e derivados neutros.
Zero novo caso/reserva/envio/modelo; seis envios/três chamadas históricas.
Após sinal, o helper restaurou o mesmo TEST/cron e conferiu health200, uma conta
e leitura fresca sem interferência. A sessão foi encerrada sem salvar o MID.
O resultado cobre callback real sob pausa; races de fila ativa seguem os testes
locais. Não houve exclusão de outra mensagem, Graph outbound ou chamada de IA.
Vídeo, dependências, declarações legais e dados de fornecedores/países continuam
pendentes; o pedido de Review não foi enviado. Logs/contribuição do AI Studio
não foram conferidos porque a tela permaneceu carregando. Paid não substitui
essa conferência. A política pública atual registra retenção Google de 55 dias
para abuso, separada de logs opcionais do projeto, e DB em São Paulo sem afirmar
que toda execução Edge ocorre no Brasil. Ver
[políticas de uso Google](https://ai.google.dev/gemini-api/docs/usage-policies)
e [política Sir Fisher](https://www.sirfisher.com.br/privacidade/).

Auditoria nativa final sem alterações: resposta automática ativa somente no
Messenger, Instagram desmarcado; ausência apenas como sugestão, nova reserva
IG desligada. Quatro FAQs continuam ativas no Instagram durante o piloto.
Desligar as respostas concorrentes antes de liberar o agente ao público.

O CI de gestao inicialmente recusou o endereço interno do PostgreSQL no
service Docker. O runner agora aceita esse destino só com flags explícitos
do Actions/descartável, host loopback, banco dedicado, porta e rede privada
conferidos. O fixture também confere o banco dedicado antes de ajustar somente
BYPASSRLS do papel fictício service_role, que outros testes criam no mesmo
cluster. Uma reprodução local partindo da role sem BYPASSRLS passou nos
37 contratos e nas duas guardas de destino adicionais. Nenhuma dessas
correções de CI altera o ambiente em nuvem.

Na etapa anterior, a conversa de teste foi
retomada explicitamente após encerrar os dois casos de teste. Não há pendência
ou aviso reservado. O modo global era TEST exclusivo dela, com cron inativo no fim desse ciclo.
A aplicação anterior de TEST foi
restrita a uma única conta com identidade confirmada pela Meta, após revisão
e `--check` real. O banco/runtime foram novamente fechados e conferidos,
preservando consumo e histórico. Depois, o commit `9afafed` passou por revisão
e 57 testes Node, foi implantado OFF na versão 11 e retornou ao teste de uma
conta após novo `--check`. O reteste real retornou UNKNOWN e MID confirmado,
sem nova IA: duas chamadas anteriores e três envios acumulados. Tempo do
recebimento à conclusão no banco: 4,550s. A coordenação confirmou a cópia correta.

| Teste real com a conta controlada | Resultado |
| --- | --- |
| Horário da casa | HOURS; uma resposta virtual com horários corretos, confirmada na interface. Recebimento→fim: 5,066s. |
| Horário da cozinha após correção | UNKNOWN; explica a falta de fonte e oferece detalhar/pedir pessoa. Zero nova IA; 4,550s. |
| Reserva para quatro com pedido de confirmação | RESERVATION_LINK; portal, corte 15h30 e tolerância 15min. Não confirmou mesa/disponibilidade; 7,621s. |
| Pedido de uma pessoa | Um caso e pausa antes do aviso único de WhatsApp. Sem IA, nome de gerente ou promessa de transferência; 4,700s. |
| Reclamação durante a pausa | Mesmo caso mudou para complaint. Zero novo aviso ou IA; pausa mantida. |
| Encerrar e retomar pelo painel | Encerrar manteve a pausa; retomar exigiu confirmação separada e liberou somente mensagens novas. Sem replay ou novo envio. |
| Resposta manual da equipe pela Meta Suite | Novo echo recebido e caso manual criado; a conversa voltou a pausar sem aviso automático ou IA. |
| Recuperação em nuvem | Mensagem nova retida no lease, claim genuíno expirado antes da IA e um único ciclo cron. UNKNOWN/sent/MID confirmado, HTTP200 no worker e zero nova IA. Job/flag desligados após o teste. |

Acumulado real: seis envios e três chamadas de IA, incluindo o teste de
cozinha inicialmente reprovado. Dois casos de teste fechados, sem caso aberto,
e-mails ou cron ativo. Fechar esses casos não marca reclamação real como
resolvida. A Meta
confirmou MID nos envios; a coordenação conferiu na interface horário, cozinha,
reserva, aviso humano e resposta manual.
O registro de teste foi conferido no painel com motivo em português, perfil
verificado e indicação do link enviado no Instagram. Duplicatas, falhas de
provedor e concorrência também passam pelos testes locais documentados abaixo.

O Vault guarda uma única cópia do segredo limitado já usado pelo worker,
com correspondência conferida e sem token privilegiado no header. O job
existente foi preservado, com owner `postgres` e intervalo de um minuto.
Em fila vazia, o guard evita chamar a Edge Function. No teste de recuperação,
o único POST `/drain` retornou 200 às 12:04:02,483 UTC, e o recebimento→fim foi
65,413s, incluindo retenção e espera proposital do ciclo. Esse tempo não é
a latência normal. Logs do pg_net são temporários; a fila e o outbox duráveis
continuam no schema próprio. Não prometer SLA ou que cron evita pausa do Free.

Uma leitura de metadados às 11:52:56 UTC não encontrou incoming fora do owner
no banco. Nenhum cliente foi consultado no Profile API, enviado à IA ou
incluído na lista por esse diagnóstico. O zero não prova aprovação de produção
nem a causa de ausência de entrega.

Na etapa inicial de TEST,
Health confirmou runtime e banco TEST, pausa global false, dados aprovados
somente nesse teste, listas e interseção com uma conta. Modelo/faturamento
verificados, teto R$45, 2.000 gerações, reserva de 2 centavos e tarifa válida
por até 30 dias. Responsável NULL, alertas e cron false. Na leitura imediatamente
após ativar: zero outbox, chamadas de modelo, casos e bootstrap pendente.
O helper não processou a fila. A primeira mensagem nova foi classificada como
HOURS; o outbox recebeu `sent` e MID confirmado pela Meta, com 298 tokens de
entrada e dois de saída. Uma chamada/um envio, sem caso ou pausa humana.
O segundo teste, sobre horário da cozinha, falhou: o modelo escolheu HOURS
apesar da instrução UNKNOWN. A resposta sobre o funcionamento da casa foi
enviada à conta controlada. O teste foi suspenso. A correção aplica uma regra
antes do modelo para horário da cozinha/último pedido sem fonte confirmada;
responde que falta informação e oferece detalhar ou pedir uma pessoa.
Regras humanas/sensíveis mantêm prioridade. O teste de regressão usa um
classificador que retornaria HOURS e exige zero chamada/reserva. São agora
57 testes Node aprovados. A repetição real passou como descrito acima;
reserva e WhatsApp passaram nos testes descritos acima.

Revisão de 01/11/2026 implantada em OFF: pedidos humanos vão ao WhatsApp
oficial `https://wa.me/5585988544274`, conforme decisão do proprietário.
O novo fluxo grava o caso e a pausa antes de enviar um único aviso revisado,
sem IA, por caso ativo. Migration `20261101102855` aplicada e registrada
na mesma transação. Edge Function versão **7 ACTIVE**, commit `281e2e7`.
Os 28 nomes de segredos foram preservados; responsável NULL, alertas e cron
desligados. O modo TEST exige revisão em etapa separada.

Passaram 56 testes Node (40 atendimento/painel + 8 instalador OFF + 8 helper
TEST) e 26 contratos reais PostgreSQL18. A revisão independente não apontou
P0/P1. O Security Advisor trouxe dez INFO de RLS sem policy no schema privado,
sem WARN/ERROR do atendimento. A conferência confirmou grants somente ao
servidor e preservação das definições/grants das outras funções públicas.

Na versão publicada, health autenticado retornou 200 com runtime/effective OFF,
pausa ativa e dados/alertas false; anônimo e segredo incorreto retornaram 403.
Payload vazio assinado retornou 200/zero eventos e assinatura inválida, 401.
O helper `--check` real confirmou perfil correspondente, remetente único e
prontidão em OFF. Não houve drain, envio de Direct ou ativação TEST nesta etapa.

Histórico anterior: **instagram-support versão 5, ACTIVE no portal,
com atendimento desligado**. O código atual está no commit `368acf0` em
`reservas`; a primeira implantação foi a versão 1, do commit `104f007`.
Os três gates de runtime foram conferidos por digest: modo off, uso de dados
de clientes false e alertas false. Nenhum cliente recebeu mensagem por esta
função e o cron não foi ativado.

A versão 5 acrescenta perfis verificados à fila administrativa, sem migration.
Passaram 35 testes do atendimento e oito do helper, incluindo falhas de perfil,
limites de cache e preservação dos cartões após erro HTTP na atualização.
Os seis cenários HTTP de autenticação e payload vazio foram repetidos após o
deploy e passaram. Os 28 nomes de segredos existentes foram preservados.
O GitHub Pages teve falha por uma implantação anterior em andamento. Em
01/11/2026, o commit real `86a185a` foi publicado e houve uma única solicitação
oficial `POST /pages/builds`, aceita com HTTP 201. A publicação automática e
essa reconstrução terminaram com sucesso; o estado do site e do último build
passou a `built`. O HTML do painel e seu módulo retornaram HTTP 200 com a
interface de perfil verificado no domínio do portal. Branch `main`, pasta
raiz, método `legacy` e domínio foram preservados. A repetição antiga de
`368acf0` ainda aparecia na fila, sem impedir a nova publicação confirmada.

Depois da configuração das credenciais existentes, seis cenários HTTP
passaram: challenge correto 200; token incorreto 403; evento vazio assinado
200 com zero eventos; assinatura incorreta 401; worker autenticado em off
200 com zero processamentos, envios e alertas; controle anônimo 403. O
challenge também passou após a substituição do Verify Token. Nenhum teste
inseriu conversa de cliente. Página e módulo administrativo responderam 200.
Login, fila e evento de conta controlada continuam como testes separados.

App, Página e Instagram foram confirmados por GET oficial, incluindo a
identidade dos tokens. Isso não presume Advanced Access. Verify Token e
segredo do worker persistem no arquivo privado `reservas/.env.local`,
ignorado pelo Git; seus valores não ficam neste documento. Os outros
segredos existentes foram preservados. Em 01/11/2026, a coordenação verificou
e salvou o callback oficial na interface do Instagram, com o novo token
canônico. O diálogo fechou após a validação; o campo oculto não permite
comparar o valor pelo DOM e não foi usado como evidência de falha.
A Página Sir Fisher permanecia com zero campos de evento assinados nessa
etapa. Depois, a interface mostrou somente `messages` para o teste restrito.
A auditoria por Graph API, descrita abaixo, separou os registros do app e da
Página. A coordenação publicou o app Meta para o teste restrito autorizado;
a função de atendimento e o cron continuam desligados.

Os filtros iniciais de logs usaram o campo de caminho do API Gateway.
A consulta corrigida usa `source='function_edge_logs'`, o `function_id`
consultado pelo slug e `request.pathname`. Os testes HTTP anteriores aparecem
nessa fonte. Os dois POST 200 às 08:44 e 08:46 UTC foram reconhecidos pela
coordenação como Test Dashboard da Meta; confirmam transporte e HMAC nesses
testes. Até então, os DMs reais controlados ainda aguardavam recebimento.
As consultas posteriores usam `received_at` e `now()` do banco para definir
a janela, pois o relógio local estava cerca de 85 segundos atrasado.

Uma auditoria posterior por GET oficial confirmou duas camadas: no app,
objeto `instagram` ativo com `messages` e callback correspondente; na Página,
DeathStar estava inscrito somente em `name`. O guia v26.0 de Webhooks,
seção “Facebook credentials”, manda usar Page token no `subscribed_apps`
da Página vinculada com os campos escolhidos no App Dashboard. A matriz
identifica as permissões deste MVP no caminho Instagram Messaging API
(Messenger Platform).

Para o teste restrito autorizado, foi lido o conjunto atual `[name]` e
aplicada uma única união `[messages, name]`. O POST retornou HTTP 200 e
`success=true`; o GET posterior retornou HTTP 200 e os dois campos,
preservando o campo anterior. Essa etapa manteve a assinatura global
`instagram/messages`, os gates off/false e o cron inativo. A configuração
por API foi conferida. A consulta após o novo DM controlado retornou zero
candidatos; a validação de perfil e a preparação da lista de teste ainda
dependem de um inbound persistido. Nenhum dado de cliente foi usado nessa
alteração de assinatura.

A credencial atual do atendimento foi confirmada como Page token do app
correto, derivada do mesmo ator do token `SYSTEM_USER` já usado no Analytics.
O token atual mantém os cinco escopos do fluxo de perfil, as tarefas
`MODERATE` e `MESSAGING` e os ativos corretos. Um candidato gerado pela
interface oficial ficou somente no arquivo privado local, sem substituir
o token atual ou os segredos em nuvem. Ele tem outro ator e corresponde ao
app, à Página e ao Instagram, mas falta `pages_read_engagement`. A comparação
com um identificador direto da pessoa não comprovou identidade, pois o ID
do token pode ter escopo de app.

A leitura mínima de Conversations com os três escopos específicos dessa
operação retornou HTTP 400, código `-2`, subcódigo `2534084`, tanto com o
token atual quanto com o candidato. O `error.message` capturado foi
`Timeout`. Esse retorno isolado não comprova falta de Advanced Access nem
que uma nova concessão resolverá o recebimento. A referência v26.0 usa a
Página nesse caminho e informa que paginação por tempo não está disponível.
Novos diagnósticos devem conservar os campos de erro sanitizados, incluindo
`error_user_msg`, para evitar interpretar apenas o código.

O portfólio da Página retornou `verification_status=verified`. A consulta
do vínculo empresarial do app pelo campo `business` retornou erro 100 de
campo inexistente. Depois, a coordenação conferiu na interface oficial
App Review → Verificação, com 100%, o DeathStar vinculado ao portfólio
Sir Fisher verificado. Essa leitura confirmou o vínculo empresarial sem
alterá-lo. O Timeout continua sem causa comprovada por esse campo ou pelo
tipo exibido para o app.

Após o teste controlado mais recente, a leitura às 09:49:30 UTC encontrou
zero eventos e zero conversas no banco. Os logs oficiais de 09:29:30 a
09:50:30 UTC também não mostraram requisições da função. Os gates em nuvem
foram conferidos como off/false; o banco estava em off, pausado, com
`model_usage_allowed=false`, `billing_verified=false`, alertas e cron
desligados. A documentação consultada não fixou
um prazo de propagação para presumir que aguardar 30 minutos resolverá.

Depois, o proprietário concluiu a associação do Instagram pessoal ao Facebook
pelo Accounts Center e conferiu a persistência após recarregar. O DM controlado
seguinte foi recebido às 10:08:41 UTC, com POST 200 e um evento persistido em
OFF. A User Profile API retornou 200 e o username correspondeu exatamente à
conta de teste autorizada. O identificador permaneceu privado. Esse teste
comprova recebimento e identidade desse remetente; envio, IA e produção seguem
como etapas separadas. O evento de bootstrap não recebe resposta retroativa.

## Componentes

- `supabase/functions/instagram-support/`: webhook assinado, processamento
  da fila, classificação por enum e API administrativa. Usa Web APIs nativas,
  sem nova dependência externa.
- `admin/atendimento.html`: fila humana, estado do aviso de WhatsApp, pausa
  global, assumir caso, encerrar e retomar uma conversa. A navegação do
  portal exibe o link somente para administradores.
- Banco isolado em `instagram_support`, na migration do repositório
  `gestao`: `20261101071634_instagram_support_durable_queue.sql`.
  O aviso único usa `20261101102855_instagram_support_whatsapp_notice.sql`.
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
não pode apagar esse pedido. O evento fica reservado para um único aviso
curto: o cliente deve abrir o WhatsApp e enviar a mensagem por lá. O aviso
oferece somente o WhatsApp, sem horário humano ou promessa de prazo. O link
oferecido não comprova transferência nem atendimento no WhatsApp.

O aviso pertence ao caso ativo. Repetições e mensagens normais durante a
pausa não geram outro aviso nem chamam IA. Uma urgência ou alergia de maior
prioridade antes do envio atualiza a orientação e invalida o lease anterior.
Urgência orienta procurar a equipe presente se a pessoa estiver na casa.
Depois de iniciado um envio, o sistema conserva seu resultado sem repetir
automaticamente o link. Pausa global, echo desconhecido, assumir, encerrar e
retomar cancelam avisos pendentes; despausar não os reapresenta.

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
Um assunto desconhecido informa que falta uma resposta confirmada e oferece
detalhar a dúvida ou pedir uma pessoa; se continuar
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
não comprova, sozinho, o tier financeiro ou a franquia desta chave. Depois,
a coordenação conferiu Nível 1 pré-pagamento na interface e a correspondência
da chave em memória. O gate permaneceu false durante essa preparação. A
liberação posterior aplica-se somente à conta de teste descrita no estado atual.
O tier gratuito pode usar conteúdo para melhorar produtos. Antes de texto
real de clientes, o responsável deve conferir os termos e liberar os gates
de privacidade separadamente.

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
Após autenticar o administrador e ler os casos, o servidor pode consultar
somente `username` pela User Profile API oficial com Facebook Login e Page
token. A API exige consentimento da pessoa por mensagem recebida ou ação
equivalente documentada, cinco permissões e token solicitado por pessoa com
tarefa `MODERATE` na Página. Um perfil bloqueado ou sem acesso fica indisponível.

A fila usa o `@username` retornado e validado pela Meta para “Abrir perfil”.
No perfil, a equipe pode tocar em Mensagem para abrir a conversa existente.
“Abrir Direct” continua disponível para conferir a caixa pelo horário do caso.
Não existe um link de thread inventado a partir do identificador numérico.
Falha, 403, timeout ou username inválido conservam o caso e mostram que o
perfil está indisponível. Nenhum nome, foto ou campo extra é solicitado.

Cada leitura consulta até 12 perfis novos com concorrência máxima de quatro
e prazo total de 2,5 segundos. Um cache somente em memória guarda no máximo
128 resultados: 120 segundos para perfil válido e 30 para indisponível.
Atualizações seguintes podem consultar casos ainda sem cache. O username
não é gravado no banco, nos alertas ou nos logs. Os testes simulados cobrem
autorização antes da consulta, falha sem perder a fila e renderização segura.

O fluxo escolhido mantém `manager_auth_user_id=NULL` e alertas desativados.
Nenhum nome de gerente aparece na mensagem. Os acessos administrativos
existentes do portal permanecem como estão. O painel mostra aviso pendente,
envio iniciado, link enviado no Instagram, falha, resultado incerto ou aviso
cancelado. Confirmação exige o MID retornado pela Meta; o painel não confirma
leitura nem atendimento da equipe no WhatsApp.

O adaptador Resend permanece disponível no código para outro fluxo autorizado;
ele pode avisar sobre **caso novo**, quando os dois gates
de alerta estiverem liberados. O destinatário é resolvido no banco pelo
`manager_auth_user_id` configurado e validado como administrador ativo.
O cliente do navegador não recebe esse e-mail. A mensagem contém somente
assunto fixo e link do painel, sem nome, texto ou identificador de cliente.

O outbox de alerta é idempotente por caso/revisão. `Idempotency-Key` fica
estável; a Resend conserva a proteção por 24h. Uma resposta aceita com ID
marca o alerta como aceito pelo provedor, sem afirmar leitura ou entrega na
caixa da gerente. Timeout fica incerto e não é repetido automaticamente.
Falha e supressão ficam registradas no banco. Ativar avisos não envia casos anteriores
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

Regras do teste restrito: `mode=test` nos dois lados e **interseção** entre
`INSTAGRAM_TEST_SENDER_IDS` e `test_sender_ids` no banco. Usar somente conta
controlada com identidade confirmada pela Profile API e mensagens sintéticas.
E-mail e cron continuam desligados. O modo live depende de revisão, autenticação, custos
e testes com o responsável. O painel não muda esses gates para produção.

## Verificação local e passos antes de ativar

```powershell
node --test tools/instagram_support_test.mjs tools/deploy_instagram_support_test.mjs tools/activate_instagram_support_test_test.mjs
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
e receber evento de conta controlada; testar orientação ao WhatsApp e pausa;
conferir ausência de resposta duplicada com as automações nativas/ManyChat;
confirmar custo total e privacidade; apresentar os resultados ao proprietário.
Somente depois liberar clientes. Não enviar mensagem de teste a cliente real.

Os quatro FAQs nativos continuam ativos para os clientes durante o teste
restrito. Antes da produção, escolher um único motor de respostas e desligar
as automações nativas que duplicarem este fluxo. Um echo sem MID do outbox
continua causando pausa conservadora, inclusive se vier de outra automação.
Não liberar modo live enquanto o escopo de produção/App Review estiver pendente.

## Helper separado de teste restrito

`tools/activate_instagram_support_test.mjs` tem plano offline por padrão.
`--check` confere somente por leitura; `--apply` é reservado à revisão da
coordenação e habilita exclusivamente a conta de teste autorizada. Não aceita
modo live, IDs na linha de comando, criação de credenciais ou alterações em
faturamento, cron, analytics e automações nativas da Meta.

O remetente único, o username esperado e o Page token canônico são lidos em memória de `.env.local`
ignorado ou do ambiente. O helper valida inbound OFF persistido, username exato,
backend com suporte ao aviso único, limites e gates desligados nos dois lados.
Ele grava quatro flags de teste no runtime com o banco ainda OFF, confere seus
digests e muda o banco atomicamente por último. O evento de bootstrap continua
terminal. A confirmação imprime somente booleans e contagens. Uma falha parcial
fecha o banco e o runtime; se a conferência de rollback falhar, informa a
necessidade de conferir OFF. O helper não chama `/drain`. O GET `/health`,
protegido pelo mesmo segredo do worker em cabeçalho, confirma modo efetivo,
gates e contagens após a troca, sem processar eventos ou revelar identificadores.
Lease ativo e envio de resultado incerto do remetente impedem a ativação.

O teste autorizado usa Supabase e Gemini Paid, texto redigido e teto do agente
de R$45/mês, com R$5 de margem dentro do orçamento de R$50. A tarifa vale por
até 30 dias; depois o modelo encaminha para atendimento humano. São no máximo
três gerações por dez minutos para o remetente. O teste real depende de uma
mensagem nova após a conferência da ativação; os clientes permanecem fora da lista.

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

A configuração posterior usou `secrets --apply --replace-owned` por entrada
em memória para os segredos próprios. A chave Gemini existente foi reutilizada;
os segredos Resend não foram copiados nem alterados. Uma nova execução trocou
somente o Verify Token local e em nuvem, conservando os demais. As verificações
e o worker permaneceram em off, sem Meta POST ou ativação do cron.

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
- [Meta: User Profile API com Facebook Login](https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile/).
  Página atualizada em 01/04/2026; leitura pública HTTP 200 em 01/11/2026.
  Documenta `GET graph.facebook.com/v26.0/{IGSID}?fields=username`, Page token,
  tarefa `MODERATE` e as permissões `instagram_basic`, `instagram_manage_messages`,
  `pages_manage_metadata`, `pages_read_engagement` e `pages_show_list`.
- [Meta: configuração de Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)
  e [matriz de campos e permissões](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields).
  A seção “Facebook credentials” documenta v26.0, Page token e assinatura
  na Página. As rotas por conta Instagram pertencem aos fluxos de login
  identificados separadamente nesse guia.
- [Meta: assinatura da Página](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/)
  e [assinatura do app](https://developers.facebook.com/docs/graph-api/reference/app/subscriptions/).
- [Meta: Conversations da Página, v26.0](https://developers.facebook.com/docs/graph-api/reference/page/conversations/?version=v26.0)
  e [estado de verificação do portfólio](https://developers.facebook.com/docs/marketing-api/reference/business/).
- [Resend: idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)
  e [envio](https://resend.com/docs/api-reference/emails/send-email).
- [Supabase Management API: deploy](https://supabase.com/docs/reference/api/v1-deploy-a-function).
- [GitHub: solicitar build do Pages](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build).
  Foi usada uma única solicitação na configuração existente, seguida de
  leitura do build e conferência dos arquivos públicos.
