// O AsyncStorage depende do celular e não existe nos testes.
// Este é o mock oficial da biblioteca, que guarda os dados na memória.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
