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

## ⚠️ Limitação importante (multi-utilizador)

Os dados são guardados em **`localStorage`**, ou seja, **no navegador de cada pessoa**.
Cada utilizador/dispositivo tem a sua própria base de dados isolada — **os dados não são
partilhados entre pessoas**. É ideal para demonstração individual da interface, mas para
um teste colaborativo real (vários utilizadores na mesma base de dados) é necessário um
**backend com base de dados partilhada**.

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
