# Imagens de marca

As imagens de marca do Sir Fisher (logo, emblema, favicon) **não moram mais
aqui**. A fonte canônica é o site institucional:

```
https://www.sirfisher.com.br/assets/img/
```

Repositório: [`sirfisherfc/index`](https://github.com/sirfisherfc/index).

Todas as páginas e o `adminGuard.js` apontam para lá. Para trocar o logo em
qualquer um dos sites do Sir Fisher, altere só no repositório `index`.

Motivo: os arquivos estavam duplicados entre os dois repositórios e chegaram
a divergir — o `logo-horizontal.png` daqui recebeu uma correção que o do site
institucional não tinha.

## Exceção: `logo-horizontal.png`

Este arquivo continua aqui, mas **não é usado por nenhuma página**.

Os e-mails de confirmação de reserva enviados antes de agosto de 2026 trazem
o logo apontando para `reservas.sirfisher.com.br/assets/img/logo-horizontal.png`.
Apagá-lo quebraria a imagem nesses e-mails já entregues.

A edge function `send-notifications` já foi atualizada e os e-mails novos usam
a URL canônica. Este arquivo pode ser removido quando não fizer mais diferença
que e-mails antigos percam a imagem do cabeçalho.
