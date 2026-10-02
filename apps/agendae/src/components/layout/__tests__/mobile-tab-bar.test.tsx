import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { MobileTabBar } from "../mobile-tab-bar";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  usePathname: () => "/dashboard",
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/src/components/ui/app-icon", () => ({ AppIcon: () => null }));
jest.mock("@/src/components/layout/universal-create-menu", () => ({
  UniversalCreateMenu: () => null,
}));

describe("MobileTabBar", () => {
  it("troca de página sem empilhar rota e sem sombra traseira", async () => {
    const screen = await render(<MobileTabBar />);

    fireEvent.press(screen.getByLabelText("Agenda"));
    expect(mockReplace).toHaveBeenCalledWith("/agenda");

    const style = StyleSheet.flatten(screen.getByTestId("mobile-tab-bar").props.style);
    expect(style.elevation).toBe(0);
    expect(style.shadowOpacity).toBe(0);
    expect(style.minHeight + style.marginTop).toBe(72);
    expect(style.paddingTop + style.marginTop).toBe(8);
  });
});
