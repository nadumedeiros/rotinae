// Limpa o que o app deixou guardado no aparelho quando a pessoa sai da conta.
// Esta versão roda na Web. No celular, o app usa `limpar-dados-locais.native.ts`.
export async function limparDadosLocais(): Promise<void> {
  // Na Web ainda não há nada além da sessão, que o próprio Supabase apaga.
}