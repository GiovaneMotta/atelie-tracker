# Scripts de apoio (rodam no seu computador)

Estes scripts nao fazem parte do painel nem do site. Eles moram aqui so para
nao se perderem numa troca de computador — o repositorio do site e servido
publico pelo Cloudflare, entao nada que seja ferramenta local pode ficar la.

## Onde eles esperam estar

Eles procuram a pasta do site **um nivel acima**, assim:

```
atelie-da-lili/
├── ateliedalili-site/     <- o site
├── atelie-tracker/        <- o painel
└── tools/                 <- COPIE ESTA PASTA PARA CA
```

Entao, no computador novo, copie esta pasta para a raiz do espaco de trabalho:

```
cp -r atelie-tracker/tools ./tools
```

## O que cada um faz

| Script | Para que serve |
|---|---|
| `gerar-miniaturas.ps1` | Gera as miniaturas de 500px na convencao do catalogo. `-Pasta "ateliedalili-site\images\menino"` |
| `servidor.ps1` | Sobe o site local na porta 8790 |
| `consulta-catalogo.ps1` | Le o catalogo publico do Supabase (somente leitura) |
| `diagnostico-supabase.ps1` | Verifica se o Supabase responde |
| `hero-fullbleed-styles.css` | Trecho de CSS guardado de um teste antigo |

Nenhum deles tem senha dentro: o `consulta-catalogo.ps1` le a chave publica
direto do `js/catalog-data.js` do site na hora de rodar.
