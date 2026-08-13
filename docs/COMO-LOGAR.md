# Como colocar o CRM no ar e fazer login

O CRM é um sistema completo (banco + login + servidor), não um arquivo que se abre no navegador.
Para logar, ele precisa estar publicado. São **3 etapas**. Faça uma de cada vez, sem pressa.

Você vai precisar de **3 contas gratuitas**: Supabase, GitHub e Netlify (você já tem o Netlify).

---

## Etapa 1 — Banco de dados (Supabase)

1. Acesse **supabase.com** → *Start your project* → entre com o Google.
2. *New project*: dê um nome (ex.: `atelie-crm`), crie uma senha forte para o banco e escolha a
   região **South America (São Paulo)**. Aguarde ~2 min o projeto ficar pronto.
3. No menu lateral, abra **SQL Editor** → *New query*.
4. Abra o arquivo `atelie-crm/supabase/setup_all.sql`, **copie tudo** e cole no editor →
   clique **Run**. Deve aparecer "Success". (Isso cria as 47 tabelas de uma vez.)
5. Agora crie seu usuário de login: menu **Authentication** → **Users** → *Add user* →
   *Create new user*. Use seu e-mail e uma senha. **Marque "Auto Confirm User".**
6. Copie o **User UID** que aparece na lista. Volte no **SQL Editor**, cole o bloco abaixo
   trocando `COLE_O_UID_AQUI`, e clique **Run**:

   ```sql
   insert into public.staff (id, name, email)
   values ('COLE_O_UID_AQUI', 'Giovane', 'giovane12motta@gmail.com');

   insert into public.staff_roles (staff_id, role_id)
   select 'COLE_O_UID_AQUI', id from public.roles where key = 'admin';
   ```

7. Guarde **3 chaves** (menu **Project Settings → API**):
   - **Project URL** (ex.: `https://xxxx.supabase.co`)
   - **anon public** key
   - **service_role** key ⚠️ (secreta — nunca compartilhe)

---

## Etapa 2 — Publicar o site (GitHub + Netlify)

O Netlify precisa do código num repositório para compilar na nuvem.

1. Crie conta em **github.com** (se ainda não tiver).
2. Crie um repositório novo, **privado**, chamado `atelie-crm` (vazio, sem README).
3. Me avise que você chegou aqui — eu te passo os comandos `git` exatos para enviar a pasta
   `atelie-crm/` para esse repositório (é rápido, seu PC já tem git).
4. No **Netlify** → *Add new site* → *Import an existing project* → conecte o GitHub → escolha
   o repositório `atelie-crm`.
5. Em configurações de build, defina **Base directory = `atelie-crm`** (o resto o
   `netlify.toml` já preenche). Clique em *Deploy*.
6. Depois do primeiro deploy, vá em **Site settings → Environment variables** e cadastre
   (valores da Etapa 1 e, por ora, deixe os tokens de WhatsApp/Frenet/IA em branco):

   ```
   VITE_SUPABASE_URL       = (Project URL)
   VITE_SUPABASE_ANON_KEY  = (anon public)
   SUPABASE_URL            = (Project URL)
   SUPABASE_SERVICE_ROLE_KEY = (service_role)
   ALLOWED_ORIGINS         = (a URL do seu site .netlify.app)
   SITE_URL                = (a URL do seu site .netlify.app)
   ```

7. Em **Deploys**, clique *Trigger deploy → Deploy site* para reconstruir já com as variáveis.

---

## Etapa 3 — Logar

1. Abra a URL do site (ex.: `https://seu-crm.netlify.app`).
2. Digite o e-mail e a senha que você criou na Etapa 1.
3. Pronto — você entra no painel. O **Dashboard** mostra "Banco conectado ✓" se tudo estiver
   certo. Explore **Clientes**, **Produtos** e **Pedidos** (já funcionam de verdade).

---

### Se algo der errado
- Tela de login não abre / página branca → provavelmente faltou uma variável `VITE_...`
  (refaça o passo 2.6 e reimplante).
- "Seu usuário ainda não tem acesso" → faltou o passo 1.6 (inserir em `staff`/`staff_roles`).
- Qualquer erro no deploy → copie o log do Netlify e me mande, eu corrijo.
