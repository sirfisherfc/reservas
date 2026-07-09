# Publicando no GitHub Pages

O site é 100% estático (HTML/CSS/JS, sem build step), então publicar é direto.

## Passos

1. Faça push do repositório para o GitHub.
2. No repositório: **Settings > Pages**.
3. Em "Source", selecione a branch (ex.: `main`) e a pasta `/ (root)`.
4. Salve. O GitHub publica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## Cuidados com paths

Todos os links entre páginas e todos os `import`/`src` de JS usam **caminhos relativos** (`./assets/...`, `../assets/...`), nunca caminhos absolutos começando com `/`. Isso é o que faz o site funcionar tanto em:

- `https://usuario.github.io/reservas/` (GitHub Pages de projeto — vive num subcaminho), quanto em
- um domínio próprio configurado como página raiz (`https://www.sirfisher.com.br/`).

Se algum dia adicionar uma página nova, mantenha esse padrão (nunca comece um `href`/`src` com `/`).

## Google OAuth e domínio

Depois de publicar, adicione a URL final do site (e a de qualquer domínio customizado) em **Authentication > URL Configuration > Redirect URLs** no painel Supabase — sem isso, o login Google completa no Google mas falha ao redirecionar de volta. Veja `docs/supabase.md`.

## Domínio próprio (fase futura)

Se um dia migrar para `www.sirfisher.com.br` (ver `docs/future-roadmap.md`):

1. Configure um registro CNAME apontando para `SEU-USUARIO.github.io`.
2. Adicione um arquivo `CNAME` na raiz do repositório com o domínio.
3. Atualize as Redirect URLs no Supabase Auth para o novo domínio.
