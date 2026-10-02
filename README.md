# Rotinaê

Workspace do MVP universal do Rotinaê.

## Início rápido

```powershell
npm run web
```

Acesse `http://localhost:8081`.

Para conferir a exportação de produção localmente:

```powershell
npm run export:web
npm run preview:web
```

Para abrir no Expo Go:

```powershell
npm run start
```

Escaneie o QR code com o celular na mesma rede Wi-Fi. Se a rede bloquear a conexão:

```powershell
npm --prefix apps/agendae run start -- --tunnel
```

## Estrutura

- `apps/agendae`: aplicação universal Expo para web, Android e iOS;
- `docs`: visão, regras, requisitos, histórias, UX e preparação técnica;
- `BACKLOG.md`: registro central de decisões e rastreabilidade.

Consulte o [guia completo de ambiente](./docs/PREPARACAO_AMBIENTE_DESENVOLVIMENTO.md).
