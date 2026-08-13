# Publicar o Painel de Expedição — passo a passo

Guia para colocar o painel no ar. Faz-se **uma vez**. Contas gratuitas:
**Supabase** (banco), **GitHub** (guarda o código), **Netlify** (hospeda).
Versão visual (com botões de copiar): peça o link do guia ao Claude.

---

## Etapa A — Supabase (banco)

**1. Criar projeto** — em [supabase.com](https://supabase.com) → *New project*.
Nome `atelie-expedicao`, crie e **anote** a *Database Password*, região **São Paulo**.

**2. Criar as tabelas** — menu **SQL Editor → New query**. Abra o arquivo
[`supabase/setup/full_setup.sql`](../supabase/setup/full_setup.sql), copie **tudo**
(<kbd>Ctrl</kbd>+<kbd>A</kbd>, <kbd>Ctrl</kbd>+<kbd>C</kbd>), cole e **Run**.
Deu certo com *“Success. No rows returned”*. Rode **só uma vez**.

**3. Copiar as chaves** — **Project Settings → API**: `Project URL`, `anon public`,
`service_role`. A **service_role é secreta** (só vai no Netlify, nunca em site/print).

**4. Criar login admin** — **Authentication → Users → Add user** (e-mail + senha, auto
confirm). Copie o **UID** do usuário. No **SQL Editor**, rode (troque o UID):

```sql
insert into public.staff (id, name, email)
values ('COLE_O_UID_AQUI', 'Giovane', 'giovane12motta@gmail.com');

insert into public.staff_roles (staff_id, role_id)
select 'COLE_O_UID_AQUI', id from public.roles where key = 'admin';
```

## Etapa B — GitHub (código)

**5.** Baixe o **GitHub Desktop** ([desktop.github.com](https://desktop.github.com)),
entre, **File → Add local repository** → escolha a pasta `atelie-crm` → **Publish
repository** (pode ser *Private*). Pronto. *(Alternativa: `github.com/new` e subir os
arquivos pela web.)* A pasta já vem com o git inicializado.

## Etapa C — Netlify (publicar)

**6. Criar o site** — [app.netlify.com](https://app.netlify.com) → **Add new site →
Import an existing project → GitHub** → escolha o repositório. **Base directory:**
`atelie-crm` (deixe em branco se o repositório já for só essa pasta). Build/publish já
vêm do `netlify.toml`:

```
Base directory:     atelie-crm
Build command:      npm --prefix web install && npm --prefix web run build
Publish directory:  web/dist
Functions:          netlify/functions
```

**7. Variáveis de ambiente** — **Site configuration → Environment variables**:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=cole_a_anon_public
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=cole_a_service_role
SITE_URL=https://SEU-SITE.netlify.app
ALLOWED_ORIGINS=https://SEU-SITE.netlify.app
FRENET_API_TOKEN=seu_token_do_cliente
FRENET_PARTNER_TOKEN=seu_partner_token
FRENET_ENV=homologacao
FRENET_CEP_ORIGEM=00000000
ANTHROPIC_API_KEY=            # opcional: preenchimento por IA
```

> `VITE_SUPABASE_URL` e `SUPABASE_URL` = mesmo endereço. `anon` e `service_role` = chaves
> diferentes. Preencha `SITE_URL`/`ALLOWED_ORIGINS` depois que o Netlify der o endereço e
> republique. Depois clique **Deploy**.

## Etapa D — Usar

**8.** Abra o endereço do Netlify e faça login (usuário do passo 4).
**9.** **Configurações › Frenet**: CEP de origem, remetente, caixa; **Testar conexão** (🟢).
Webhook (opcional) no painel Frenet: `https://SEU-SITE.netlify.app/webhooks/frenet-tracking`.
**10.** **Expedição → Novo envio**: cola a mensagem → *Extrair e preencher* → frete →
*Confirmar* → imprimir.

Atalho: edite `Abrir Painel Expedição.bat` (na pasta do projeto) com a sua URL.

---

### Para gerar etiqueta real
O OneClick da Frenet exige **Partner Token WhiteLabel + saldo/limite** (liberados pela
Frenet no cadastro/homologação). Sem isso, a cotação funciona e a geração avisa o que
falta — não simula. Detalhes em [`frenet.md`](frenet.md).
