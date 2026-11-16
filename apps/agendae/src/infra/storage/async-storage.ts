import AsyncStorage from "@react-native-async-storage/async-storage";

export async function salvar(chave: string, valor: string): Promise<void> {
  await AsyncStorage.setItem(chave, valor);
}

export async function ler(chave: string): Promise<string | null> {
  return AsyncStorage.getItem(chave);
}

export async function deletar(chave: string): Promise<void> {
  await AsyncStorage.removeItem(chave);
}
