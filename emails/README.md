# Modelos de e-mail do Rotinaê

Os modelos prontos e o contrato de integração estão em [docs/HANDOFF_EMAILS_TRANSACIONAIS.md](../docs/HANDOFF_EMAILS_TRANSACIONAIS.md).

## Comandos

```bash
npm run test:emails
npm run preview:emails
```

Depois de gerar as prévias, abra `emails/previews/index.html` no navegador. Os arquivos em `emails/previews/` são exemplos gerados; a fonte de verdade é `transactional-templates.mjs`.

## Estrutura

- `supabase/`: modelos de autenticação e notificações de segurança compatíveis com as variáveis Go Template do Supabase Auth;
- `transactional-templates.mjs`: renderizador de agenda, vínculo e assinatura com HTML e texto alternativo;
- `sample-data.mjs`: dados fictícios usados apenas nas prévias;
- `transactional-templates.test.mjs`: valida escape HTML, URLs, campos obrigatórios e catálogo;
- `generate-previews.mjs`: gera uma prévia HTML por template.

Os e-mails não devem ser renderizados nem enviados pelo aplicativo cliente. O backend deve importar o renderizador, preencher os dados autorizados e enviar pela fila/outbox.

