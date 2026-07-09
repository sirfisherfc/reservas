# Setup — Sir Fisher Praia

Site estático (HTML/CSS/JS puro, sem build step) + Supabase. Compatível com GitHub Pages.

## Estrutura do projeto

```
index.html                — página pública de reserva
cancelar.html              — cancelamento público via link com token
admin/                     — painel administrativo (login, dashboard, reservas, configurações, bloqueios, usuários)
assets/css/                — estilos (style.css = site público, admin.css = painel)
assets/js/                 — módulos ES (sem bundler, importados via <script type="module">)
supabase/                  — schema.sql, functions.sql, rls.sql, seed.sql (fonte da verdade do banco)
docs/                      — esta documentação
```

## Rodando localmente

Não há servidor Node nem variáveis de ambiente de servidor. Basta servir os arquivos estáticos:

```bash
python -m http.server 8000
# depois abra http://localhost:8000/index.html
```

Qualquer servidor estático funciona (é só HTML/CSS/JS). Não use `file://` direto no navegador — módulos ES exigem um servidor HTTP.

## Configuração do Supabase

1. Copie `assets/js/config.example.js` para `assets/js/config.js` (o repositório já vem com um `config.js` preenchido para o projeto atual — troque os valores se for duplicar para outro restaurante).
2. Preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (Project Settings > API no painel Supabase).
3. Preencha `WHATSAPP_NUMBER` (ou configure o número em Configurações no painel admin, chave `whatsapp_number` — o painel tem prioridade sobre o valor do arquivo).

A anon/publishable key **não é secreta** — ela é feita para rodar no navegador. A segurança real do sistema vem inteiramente do RLS (Row Level Security) configurado no banco, não de esconder essa chave. Veja `docs/supabase.md` para os detalhes de como o banco foi montado.

## Deploy no GitHub Pages

Veja `docs/github-pages.md`.

## Primeiro acesso administrativo

Veja `docs/admin-guide.md` (seção "Cadastrando o primeiro administrador").

## Fase 2

Itens propositalmente deixados como estrutura pronta, mas não implementados nesta fase — veja `docs/future-roadmap.md`.
