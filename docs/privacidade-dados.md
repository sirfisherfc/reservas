# Privacidade e dados pessoais

Resumo dos dados coletados pelo site de reservas do Sir Fisher Praia e para que servem. Não substitui um aviso de privacidade jurídico completo, mas documenta a base para escrever um.

## Dados coletados na reserva pública

- **Nome, e-mail, telefone/WhatsApp** — necessários para confirmar e, se preciso, entrar em contato sobre a reserva.
- **Data, horário, quantidade de pessoas** — dados da própria reserva.
- **Observação (opcional)** — texto livre do cliente; consideramos quando possível, mas não é garantido.
- **Aceite das regras da reserva** — obrigatório, registrado junto com a reserva (não é a mesma coisa que o aceite de marketing).
- **Aceite de marketing (opcional)** — checkbox separado, **desmarcado por padrão**, nunca vem pré-marcado. Se aceito, guardamos também a data/hora do aceite (`marketing_opt_in_at`).

## O que NÃO coletamos

Não pedimos restrição alimentar, escolha de mesa/área, nem qualquer dado além do necessário para operar a reserva.

## Onde os dados ficam

- **`customers`** — cadastro do cliente (nome, e-mail, telefone, opt-in de marketing e datas da primeira/última reserva), reaproveitado entre reservas para não duplicar cadastro.
- **`reservations`** — os dados da reserva em si, incluindo uma cópia (snapshot) do nome/e-mail/telefone no momento da reserva (para manter o histórico estável mesmo que o cliente peça para atualizar o cadastro depois).
- **`reservation_status_history`** — log de mudanças de status (sem dados pessoais além dos já existentes na reserva).

## Observação interna

O campo de observação interna (preenchido pela equipe, ex.: "cliente pediu atenção especial") **nunca é exibido ao cliente** e nunca é usado em comunicações públicas — é visível só dentro do painel administrativo, só para administradores e operadores autenticados.

## Cancelamento

O link de cancelamento contém um token aleatório de alta entropia; só o **hash** dele é guardado no banco (nunca o token em texto puro). O link só permite mudar o status da própria reserva para "cancelada pelo cliente" — nunca lista, edita ou expõe dados de outras reservas.

## Quem acessa o quê

- Ninguém de fora da equipe (site público) consegue ler dados de reservas de terceiros — todo acesso público passa por funções que devolvem só o necessário (ex.: confirmação da própria reserva recém-criada).
- Dentro da equipe, acesso é restrito a quem está cadastrado e ativo em `app_users` (ver `docs/admin-guide.md`), com login via Google.
- `service_role` (chave com acesso total, que ignora todas as travas) **nunca** é usada no site — só a chave pública (`anon`), protegida pelas regras de acesso do banco (RLS).

## Fase 2 (não implementada ainda)

Envio automático de e-mail/WhatsApp de confirmação usará os mesmos dados já coletados aqui — nenhum dado novo precisa ser pedido ao cliente para isso. Ver `docs/future-roadmap.md`.
