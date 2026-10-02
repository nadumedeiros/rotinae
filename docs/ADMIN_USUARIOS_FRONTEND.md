# Administração de usuários no frontend

## Escopo do protótipo

A rota `/admin-users` é uma ferramenta restrita de suporte, não um painel administrativo completo. No ambiente demonstrativo, o acesso administrativo é reconhecido pela conta `admin@agendae.com`. No backend real, a autorização deverá ser atribuída pelo servidor e nunca inferida apenas do e-mail.

## Planos

O Premium pertence ao perfil Prestador. Usuários exclusivamente clientes não podem receber Premium; registros locais antigos incompatíveis são normalizados para Gratuito na leitura.

Toda alteração administrativa de plano deverá gerar auditoria imutável com ator, usuário afetado, estado anterior, estado novo, instante UTC, resultado e identificador de correlação.

## Termos e privacidade

A visão de dados mostra a versão dos Termos de Uso, a versão da Política de Privacidade, a data e hora do aceite e a plataforma de origem. O check visual não substitui o evento de consentimento persistido de maneira auditável no backend.
