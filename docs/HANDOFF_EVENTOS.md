# Handoff — Configurador e propostas de eventos

Atualizado em 29/09/2026. Estado: v2 publicada e migrations aplicadas em 30/09/2026 (pacotes v2, leitura da agenda, confirmação com bloqueio de horários).

## Versão 2 (29/09/2026)

- Manual para a equipe e o proprietário: `docs/MANUAL_EVENTOS.md`.
- Site com 4 etapas (sem etapa de perfil e sem faixa de investimento); o resultado sempre mostra os três níveis.
- Comida: só petiscos; petiscos + lanche (1 por pessoa: Edimburger, Fisher Burger ou Fish & Chips); petiscos + almoço/jantar em travessas com proteínas definidas por nível.
- Bebidas: sem bebidas; sem álcool; sem álcool + chope; sem álcool + chope + coquetel. Open bar, fichas, crédito e pacote selecionado saíram do site.
- Duração: base de 3 horas; cada hora a mais soma 10% do valor de cardápio.
- Preço abaixo do cardápio: desconto por antecipação, volume, movimento do horário (histórico por dia da semana × hora e fator do mês) e formato, limitado por piso de custo (margem mínima de 35%) e piso de oportunidade. Detalhes no manual.
- PDF refeito: capa com foto, cardápio com fotos, investimento com datas, PIX, acréscimo do cartão e todas as regras do contrato-modelo.
- Painel: análise interna explicada, comparação com o cardápio e campo de acréscimo do cartão.
- A função só usa regras do banco quando a versão ativa for `eventos-2026-09-v2`; até lá, usa as constantes de `pricing.ts`.
- Solicitações de teste apagadas em 30/09/2026: a base de eventos começou zerada.

## Acessos

- Cliente: `https://www.sirfisher.com.br/eventos/`
- Equipe: `https://admin.sirfisher.com.br/eventos.html`
- Permissões: `https://admin.sirfisher.com.br/permissoes.html`
- Backend: Edge Function `event-quote`, no projeto Supabase unificado `portal` (`lucpxoynpvogkvzepagi`).

## Fluxo entregue

1. O cliente configura data, convidados, alimentação, bebidas e perfil.
2. O backend recalcula e grava uma pré-proposta; preço ou opção alterados no navegador não são aceitos.
3. O cliente recebe o código e um botão de WhatsApp com a mensagem preenchida.
4. Os administradores ativos recebem e-mail com o resumo e o acesso à rotina.
5. A equipe pode editar data, horário, duração, convidados, cardápio, porções, bebidas, adicionais, exclusões, valores e condições.
6. Toda alteração é auditada. Redução de preço exige admin, confirmação de desconto e justificativa.
7. A ação de proposta definitiva gera e baixa um PDF versionado para envio ao cliente.

## Quantidades e PDF

- Os números internos representam o total dimensionado para o evento, não uma quantidade por pessoa.
- Alimentos são porções; o PDF informa a equivalência em unidades quando cadastrada. Exemplos: 1 porção de pasteizinhos = 10 pastéis, bolinha de peixe = 6, crocante = 6 e dadinho = 12.
- Bebidas são totais por tipo de serviço: unidades, latas, copos, fichas ou crédito, conforme o módulo escolhido.
- O PDF inclui identificação, evento, cardápio, quantidades, bebidas, valor por pessoa, total, sinal, saldo, validade, adicionais, exclusões, regras e aceite.
- CMV, margem e demais cálculos internos nunca aparecem no PDF nem na resposta pública.

## Banco e segurança

- Migrations aplicadas: `20260929000000_configurador_eventos.sql` e `20260929010000_eventos_propostas_notificacoes.sql`.
- Tabelas principais: `event_requests` e `event_request_audit`, além das tabelas versionadas de preços, pacotes, bebidas, produtos e demanda.
- O acesso administrativo depende de autenticação e de `pagina_permissao` para `eventos.html`.
- O projeto legado `qqefegpievdlaprwzktx` não deve ser usado.

## Validações concluídas

- 10 cenários automatizados do motor de preços e 1 teste do gerador de PDF aprovados.
- Formatação, lint e checagem de tipos Deno aprovados.
- Qualidade, contratos de acesso, frontend e migrations do `gestao` aprovados.
- PDF A4 renderizado e inspecionado visualmente, sem corte ou sobreposição.
- Envio público real confirmou gravação, código, WhatsApp e notificação por e-mail; os dados fictícios foram removidos depois.
- Páginas públicas verificadas com HTTP 200 e assets de ajuste/PDF/WhatsApp presentes em produção.

## Commits de referência

- `site`: `e5d6a97` — contato por WhatsApp na confirmação.
- `reservas`: `d81cc02` — ajustes, PDF e notificações.
- `gestao`: `b886833` — fluxo interno completo; `fff9454` — registro no canal entre IAs.

## Próximas etapas ainda não implementadas

- aceite eletrônico do cliente;
- cobrança e conciliação do sinal;
- bloqueio automático da data após aceite/pagamento;
- envio automático do PDF ao cliente — hoje a equipe baixa e envia pelo WhatsApp;
- registro de consumo, sobra, equipe e resultado real para recalibrar as regras;
- validação jurídica final das cláusulas comerciais.

## Cuidados para continuidade

- O cardápio interno versionado é a referência; não voltar a depender do Hubt.
- Não expor snapshot interno, CMV, margem ou custo de oportunidade ao cliente.
- Não sobrescrever propostas antigas: preservar versão e auditoria.
- Qualquer regra nova deve ser versionada e testada antes de entrar no cálculo.
