# Guia do painel administrativo

## Acesso

`admin/index.html` — login com Google. Só entra quem tiver uma linha ativa em `app_users`. Ver "Cadastrando o primeiro administrador" em `docs/supabase.md` para o primeiro acesso.

Depois disso, o próprio admin cadastra os demais em **Usuários**: basta o e-mail do Google que a pessoa vai usar. O acesso é liberado automaticamente no primeiro login com esse e-mail — não é preciso nenhum ID técnico.

### Solicitação de acesso (autoatendimento)

Se alguém fizer login com Google sem estar cadastrado, em vez de um simples "acesso negado" o sistema registra um **pedido de acesso pendente** e mostra uma tela de "Aguardando aprovação" para a pessoa (com opção de verificar novamente depois). Esse pedido aparece na página **Usuários**, numa seção própria acima do cadastro manual, com um contador visível no menu lateral. O admin escolhe o papel (admin/operador) e aprova ou recusa ali mesmo — sem precisar que a pessoa passe o e-mail por fora.

Uma conta que já existiu e foi **desativada** por um admin não entra nesse fluxo de solicitação — continua mostrando "conta desativada", já que isso foi uma decisão deliberada, não uma pessoa nova pedindo acesso.

## Perfis

| Ação | Admin | Operador |
|---|:---:|:---:|
| Ver reservas, filtrar, criar reserva manual | ✅ | ✅ |
| Alterar status (compareceu, no-show, desistiu, cancelar) | ✅ | ✅ |
| Editar observação interna | ✅ | ✅ |
| Editar dados da reserva (nome, data, horário, pessoas...) | ✅ | ❌ |
| Exportar CSV | ✅ | ❌ |
| Configurações (parâmetros, grade de horários) | ✅ | ❌ |
| Bloqueios (dias/horários) | ✅ | ❌ |
| Gerenciar usuários | ✅ | ❌ |
| Deletar reserva | ❌ (ninguém pode) | ❌ (ninguém pode) |

Reservas nunca são apagadas fisicamente — apenas mudam de status. O histórico de todas as mudanças de status fica registrado automaticamente (data/hora e quem alterou: cliente, operador, admin ou sistema).

## Páginas

- **Dashboard** — indicadores do dia (reservas, confirmadas, canceladas, no-show, compareceu, pessoas previstas por horário) e lista rápida das próximas reservas de hoje.
- **Reservas** — lista com filtros (hoje / amanhã / próximos 7 dias / todas, status, busca por nome/telefone/código), criação manual, detalhe com histórico e ações de status.
- **Configurações** (admin) — parâmetros gerais do site e a grade de horários recorrente por dia da semana.
- **Bloqueios** (admin) — bloqueio pontual de um dia inteiro ou de uma faixa de horário (inicial/final) numa data específica (eventos, manutenção, datas comemorativas). A faixa bloqueia de uma vez todos os horários já configurados na grade daquele dia da semana dentro do intervalo escolhido.
- **Usuários** (admin) — cadastro e gestão de administradores/operadores.

## Configurações disponíveis

Tudo em **Configurações > Parâmetros gerais** é editável sem mexer em código:

- Capacidade total da casa e percentual reservável (informativo/marketing).
- Mínimo e máximo de pessoas por reserva feita pelo site.
- Horário de corte para reserva no mesmo dia.
- Dias de antecedência permitidos para reserva.
- Tolerância de chegada (minutos) e tempo de liberação da mesa sem check-in.
- Número de WhatsApp e mensagem padrão usada nos links.

**Grade de horários**: escolha o dia da semana e edite, por horário, se está habilitado, o máximo de pessoas e o máximo de reservas simultâneas. Para fechar um dia da semana inteiro (ex.: às segundas), desabilite todos os horários daquele dia. Para bloquear um horário recorrente só em alguns dias (ex.: sábado e domingo às 17h30), desabilite apenas essa linha nesses dias. Bloqueios pontuais (uma data específica) ficam em **Bloqueios**, não aqui.

### Regra importante sobre reservas manuais (painel)

Quando o **admin ou operador** cria uma reserva manual, os limites pensados para o público (mínimo/máximo de pessoas, corte de mesmo dia, antecedência) **não se aplicam** — pressupõe-se que um humano já conversou com o cliente (por telefone/WhatsApp) e está registrando algo já combinado, incluindo grupos grandes. Os limites físicos continuam valendo sempre para todo mundo: dia bloqueado, horário bloqueado, e o limite de pessoas/reservas por horário da grade.

## Status de uma reserva

`confirmada` → (automático ao criar) · `cancelada_cliente` (via link público) · `cancelada_restaurante` · `compareceu` · `no_show` · `desistiu` · `recusada`.

Só reservas com status `confirmada` ocupam a disponibilidade dos horários.

## Exportação CSV

Botão "Exportar CSV" em Reservas (só admin) — exporta exatamente as linhas que estão carregadas na tela no momento (respeitando o filtro de período escolhido, mas não o filtro de texto/status, que são só visuais).
