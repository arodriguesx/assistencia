# Assistência Técnica — Gestão de Assistências

Plataforma web (HTML/CSS/JS, sem dependências de build) para gerir **assistências** de
equipamentos e consumíveis informáticos de uma empresa que atende 3 lojas
(Recoshop, G.S.Center, LifeTech) e os respetivos clientes. Dados partilhados em tempo real
via **Supabase**, com **autenticação real** (email + senha).

## Perfis

- **Utilizador** — regista a assistência (cliente, morada, equipamento, marca/modelo, avaria),
  aprova o orçamento com o cliente e entrega o equipamento no fim.
- **Responsável técnico** — recebe as notificações, atribui o técnico, define prioridade
  (normal/urgente) e taxa de diagnóstico, agenda, edita avaria/conserto, cancela. Vê todas as lojas.
  Faz também tudo o que o Utilizador faz.
- **Administrador** — supervisão, gestão de contas e repor sistema.

## Fluxo (7 etapas)

`Registado → Diagnóstico → Orçamento → Manutenção → Finalizado → Entregue` + `Cancelada` (saída).

## Funcionalidades

Dashboard, assistências com fluxo e permissões por perfil, clientes e técnicos (catálogos que
crescem com o uso), agenda semanal/lista por técnico, contas, exportação mensal (CSV/Excel),
notificações em tempo real, tema claro/escuro e layout responsivo (incl. tab bar no telemóvel).

---

## Configuração do Supabase (uma vez)

A app já está ligada a um projeto Supabase em [`js/config.js`](js/config.js) (URL + chave anon).
Para a **autenticação** funcionar, é preciso preparar o projeto:

### 1) SQL (SQL Editor)

```sql
-- estado partilhado (se ainda não existir)
create table if not exists public.tecnoassist_state (
  id int primary key, data jsonb, updated_at timestamptz default now()
);
insert into public.tecnoassist_state (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
alter publication supabase_realtime add table public.tecnoassist_state;

-- perfis (perfil/loja por utilizador)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text, email text, role text default 'operador', loja text, created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "perfis: ler (autenticado)" on public.profiles
  for select using (auth.role() = 'authenticated');

-- fechar o estado: só autenticados podem ler/escrever
alter table public.tecnoassist_state enable row level security;
drop policy if exists "acesso de teste" on public.tecnoassist_state;
create policy "estado: autenticado" on public.tecnoassist_state
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
```

### 2) Auth settings
**Authentication → Providers → Email**: ativo. Desliga **"Allow new users to sign up"**
(as contas são criadas só pelo administrador, via função).

### 3) Edge Function `admin-users`
**Edge Functions → Deploy a new function**, nome **`admin-users`**, cola o conteúdo de
[`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts) e faz deploy.
(Não é preciso configurar segredos — `SUPABASE_SERVICE_ROLE_KEY` é injetada automaticamente.)

### 4) Criar o 1º administrador (bootstrap)
Em **Authentication → Users → Add user**, cria o teu utilizador (email + senha). Depois, no SQL Editor:

```sql
insert into public.profiles (id, nome, email, role)
select id, 'Administrador', email, 'admin' from auth.users where email = '<o-teu-email>'
on conflict (id) do update set role = 'admin', nome = 'Administrador';
```

A partir daqui, entra na app com esse email/senha e cria as restantes contas na página **Contas**.

> ⚠️ **Nota de segurança:** o RLS exige login para aceder aos dados (fecha o acesso público).
> Como os dados são um **documento partilhado**, qualquer utilizador autenticado recebe o documento
> completo (a filtragem por loja/perfil é feita na app). Isolamento por loja imposto pela base de
> dados exigiria migrar para tabelas relacionais — passo futuro.

---

## Publicar no GitHub Pages

**Settings → Pages → Deploy from a branch → `main` / `(root)`**. Fica em
`https://<utilizador>.github.io/<repo>/`. Re-deploy automático a cada push.

## Repor o sistema
Botão **"Repor sistema"** (menu da conta → Contas, admin) apaga assistências/clientes/técnicos
do documento partilhado. **Não** afeta as contas (essas vivem no Supabase Auth).

## Estrutura

```
index.html                              app (login 2 painéis + páginas)
css/styles.css                          estilos + responsividade
js/config.js                            URL + chave anon do Supabase
js/data.js                              estado inicial (lojas + listas vazias)
js/app.js                               lógica (auth, fluxo, dashboard, agenda, contas, sync)
supabase/functions/admin-users/index.ts Edge Function de gestão de contas (admin)
```
