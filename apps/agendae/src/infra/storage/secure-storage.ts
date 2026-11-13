import * as SecureStore from "expo-secure-store";

// Armazenamento seguro (aula 09): guarda dados sensíveis, como o token de
// login, criptografados pelo próprio sistema do celular (Keychain no iOS,
// Keystore no Android). Dado que não é sensível vai para o AsyncStorage.

export async function salvarSeguro(chave: string, valor: string): Promise<void> {
  await SecureStore.setItemAsync(chave, valor);
}

export async function lerSeguro(chave: string): Promise<string | null> {
  return SecureStore.getItemAsync(chave);
}

export async function apagarSeguro(chave: string): Promise<void> {
  await SecureStore.deleteItemAsync(chave);
}

// Formato que o Supabase espera para guardar a sessão de login.
export const armazenamentoSeguroSupabase = {
  getItem: lerSeguro,
  setItem: salvarSeguro,
  removeItem: apagarSeguro,
};