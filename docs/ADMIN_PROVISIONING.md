# Provisionamento seguro de administrador

O aplicativo não contém conta, senha, e-mail administrativo nem `service_role` no código. Um administrador começa como uma conta comum confirmada e recebe o sinalizador `profiles.is_admin` por uma operação privilegiada no SQL Editor do Supabase.

## Promover o primeiro administrador

1. Crie a conta normalmente pelo Rotinaê e confirme o e-mail.
2. No Supabase, abra **Authentication > Users**, localize a conta e copie o UUID do usuário.
3. Abra **SQL Editor > New query** e execute a transação abaixo, substituindo apenas o UUID temporário:

```sql
begin;

select set_config('request.jwt.claim.role', 'service_role', true);

update public.profiles
set is_admin = true
where user_id = '00000000-0000-0000-0000-000000000000'::uuid;

commit;
```

4. Confirme que exatamente uma linha foi alterada. Encerre a sessão do app e entre novamente para recarregar o perfil.

O UUID é usado apenas na consulta executada no painel e não deve ser salvo no repositório. A senha nunca entra na consulta.

## Remover o acesso

Repita a transação usando `set is_admin = false`. A migration `20260807090000_profiles_admin_flag.sql` bloqueia usuários comuns de alterarem o próprio sinalizador e registra mudanças em `audit_events`.

## Regras operacionais

- Use uma conta individual por administrador; não compartilhe login.
- Ative MFA para a conta do Supabase que acessa o projeto.
- Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` em variável `EXPO_PUBLIC_*`, Netlify pública, aplicativo ou repositório.
- Revogue o acesso imediatamente quando ele não for mais necessário.
- Revise periodicamente os eventos de alteração de `profiles.is_admin`.
