import { useEffect } from "react";
import { Platform } from "react-native";

const interactiveSelector = [
  "button[aria-label]",
  "[role='button'][aria-label]",
  "[role='tab'][aria-label]",
  "[role='link'][aria-label]",
  "[role='menuitem'][aria-label]",
].join(",");

export function DesktopTooltips() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const applyTitles = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(interactiveSelector).forEach((element) => {
        const label = element.getAttribute("aria-label")?.trim();
        if (label && !element.getAttribute("title")) element.setAttribute("title", label);
      });
    };

    applyTitles(document);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(interactiveSelector)) {
            const label = node.getAttribute("aria-label")?.trim();
            if (label && !node.getAttribute("title")) node.setAttribute("title", label);
          }
          applyTitles(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
