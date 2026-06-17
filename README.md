# TecnoAssist — Gestão de Assistência Técnica

Plataforma web (HTML/CSS/JS, sem dependências) para gerir **ordens de serviço** de uma
assistência técnica de equipamentos e consumíveis informáticos que atende 3 lojas
(Recoshop, G.S.Center, LifeTech) e os respetivos clientes.

## Como abrir

Basta abrir o ficheiro **`index.html`** num navegador (duplo-clique). Não precisa de servidor.

> Ao abrir, se vires uma versão antiga, faz **Ctrl + F5** para limpar a cache.

## Contas de teste

| Utilizador | Senha | Perfil |
|---|---|---|
| `admin` | `admin` | Administrador (supervisão, acesso total) |
| `recoshop` | `123` | Utilizador (loja Recoshop) |
| `gscenter` | `123` | Utilizador (loja G.S.Center) |
| `lifetech` | `123` | Utilizador (loja LifeTech) |
| `responsavel` | `123` | Responsável técnico (todas as lojas) |

## Perfis e fluxo

- **Utilizador** — regista a OS com os dados do cliente (nome, morada, equipamento,
  marca/modelo, avaria) e entrega o equipamento ao cliente no fim.
- **Responsável técnico** — recebe as notificações, atribui o técnico, define a
  prioridade (normal/urgente) e a taxa de diagnóstico, agenda, edita avaria/conserto.
- **Administrador** — supervisão e gestão de contas.

Fluxo: `Registo (utilizador) → Responsável técnico → Reparação → Concluída → Entregue ao cliente`.

## Funcionalidades

Dashboard, ordens com fluxo e permissões por perfil, clientes e técnicos (crescem com o
uso), agenda semanal por técnico, contas, exportação mensal (CSV/Excel) e notificações.

## Modos de funcionamento

- **Modo local (por defeito):** os dados ficam no `localStorage` de cada navegador. Cada
  pessoa tem a sua própria base isolada — bom para demonstrar a interface individualmente.
- **Modo nuvem (partilhado):** ligando ao Supabase (abaixo), todos os colaboradores
  partilham a **mesma base de dados em tempo real** — o fluxo entre perfis funciona a sério.

O modo atual aparece no menu da conta (canto superior direito).

## Partilhar dados entre colaboradores (Supabase, grátis)

1. Cria uma conta e um projeto em https://supabase.com (plano grátis).
2. No projeto, abre **SQL Editor** e corre:

   ```sql
   create table if not exists public.tecnoassist_state (
     id int primary key,
     data jsonb,
     updated_at timestamptz default now()
   );
   insert into public.tecnoassist_state (id, data)
   values (1, '{}'::jsonb) on conflict (id) do nothing;

   alter table public.tecnoassist_state enable row level security;
   create policy "acesso de teste" on public.tecnoassist_state
     for all using (true) with check (true);

   -- ativar tempo real
   alter publication supabase_realtime add table public.tecnoassist_state;
   ```

3. Em **Project Settings → API**, copia o **Project URL** e a chave **anon public**.
4. Cola-as em [`js/config.js`](js/config.js):

   ```js
   window.TECNOASSIST_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "ey...."
   };
   ```

5. Faz commit/push. A partir daí, quem abrir a app partilha os mesmos dados em tempo real.

> ⚠️ **Segurança:** a política acima deixa qualquer pessoa com a chave ler/escrever — ok
> para a **fase de testes**, mas **não** uses dados sensíveis reais assim. Para produção,
> ativa autenticação do Supabase e políticas (RLS) adequadas. (Posso ajudar a configurar.)
>
> Nota: a sincronização usa um documento partilhado (último a gravar prevalece). Para uma
> equipa pequena de testes é suficiente; edições exatamente simultâneas podem sobrepor-se.

Repor o sistema (apaga ordens/clientes/técnicos, mantém contas): botão **"Repor sistema"**
na página *Contas* (admin) ou, na consola do navegador, `App.resetData()`.

## Publicar no GitHub Pages

1. Cria um repositório no GitHub e envia este código (ver instruções abaixo).
2. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Escolhe a branch `main` e a pasta `/ (root)` e guarda.
4. Passados ~1–2 minutos, a app fica disponível em
   `https://<o-teu-utilizador>.github.io/<nome-do-repo>/`.

## Estrutura

```
index.html        # app (login + páginas)
css/styles.css    # estilos
js/data.js        # base de dados inicial (lojas + listas vazias)
js/app.js         # lógica (perfis, fluxo, dashboard, agenda, notificações)
```
