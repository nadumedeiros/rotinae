/**
 * O código completo de vínculo retornado pelo backend
 * (`rotate_provider_link_code`, ver
 * apps/agendae/supabase/migrations/20260806101300_provider_link_rpcs.sql)
 * tem 32 caracteres hexadecimais — bem mais longo que o valor de mock usado
 * durante o desenvolvimento da UI ("AG-M4R8-K2Q7", 12 caracteres).
 *
 * A tela de Clientes (`app/clients.tsx`) usa esta função para decidir quando
 * aplicar uma variante de estilo mais compacta (fonte menor, menos
 * letter-spacing) ao exibir o código. Antes desta correção, o texto usava
 * `numberOfLines={1}` + `adjustsFontSizeToFit` + `letterSpacing` fixos, o que
 * fazia o valor real (32 caracteres) ultrapassar o container mesmo no piso do
 * `minimumFontScale` — no Android isso podia fazer o texto renderizar sem
 * nenhum glifo visível, embora o valor no estado continuasse correto (por
 * isso o botão "Copiar código" sempre funcionava). Mantendo esta regra
 * centralizada e testada evita reintroduzir o bug caso o formato do código
 * mude novamente no futuro.
 */
export const LONG_LINK_CODE_THRESHOLD = 20;

export function isLongLinkCode(code: string): boolean {
  return code.length > LONG_LINK_CODE_THRESHOLD;
}
