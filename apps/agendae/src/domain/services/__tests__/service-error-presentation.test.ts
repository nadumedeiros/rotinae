import { resolveServiceErrorPresentation } from "../service-error-presentation";
import type { ServiceErrorCode } from "../types";

describe("resolveServiceErrorPresentation", () => {
  it("SERVICE_NOT_FOUND sempre vira feedback com recarga, em qualquer contexto", () => {
    for (const context of ["form", "inline-action"] as const) {
      const presentation = resolveServiceErrorPresentation("SERVICE_NOT_FOUND", "Serviço não encontrado.", context);
      expect(presentation).toEqual({
        kind: "feedback",
        tone: "warning",
        message: "Este serviço não foi encontrado. A lista foi atualizada.",
        reload: true,
      });
    }
  });

  it("SESSION_EXPIRED sempre vira feedback de erro, em qualquer contexto", () => {
    for (const context of ["form", "inline-action"] as const) {
      const presentation = resolveServiceErrorPresentation("SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.", context);
      expect(presentation).toEqual({ kind: "feedback", tone: "error", message: "Sua sessão expirou. Entre novamente." });
    }
  });

  it("SERVICE_NAME_INVALID vira erro inline no campo nome", () => {
    const presentation = resolveServiceErrorPresentation("SERVICE_NAME_INVALID", "Informe um nome válido.", "form");
    expect(presentation).toEqual({ kind: "field", field: "name", message: "Informe um nome válido." });
  });

  it("DURATION_INVALID vira erro inline no campo duração", () => {
    const presentation = resolveServiceErrorPresentation("DURATION_INVALID", "Duração inválida.", "form");
    expect(presentation).toEqual({ kind: "field", field: "duration", message: "Duração inválida." });
  });

  it("VALUE_INVALID vira erro inline no campo valor", () => {
    const presentation = resolveServiceErrorPresentation("VALUE_INVALID", "Valor inválido.", "form");
    expect(presentation).toEqual({ kind: "field", field: "value", message: "Valor inválido." });
  });

  it("SERVICE_NAME_CONFLICT em contexto de formulário (criar/editar) vira erro inline no campo nome", () => {
    const presentation = resolveServiceErrorPresentation("SERVICE_NAME_CONFLICT", "Nome duplicado.", "form");
    expect(presentation).toEqual({ kind: "field", field: "name", message: "Nome duplicado." });
  });

  it("SERVICE_NAME_CONFLICT em ação inline (reativar, sem atalho oferecido pelo chamador) vira feedback de aviso", () => {
    const presentation = resolveServiceErrorPresentation("SERVICE_NAME_CONFLICT", "Nome duplicado.", "inline-action");
    expect(presentation).toEqual({ kind: "feedback", tone: "warning", message: "Nome duplicado." });
  });

  it("FORBIDDEN em formulário vira banner dentro do modal", () => {
    const presentation = resolveServiceErrorPresentation("FORBIDDEN", "sem permissão", "form");
    expect(presentation).toEqual({ kind: "banner", message: "Você não tem permissão para esta ação." });
  });

  it("FORBIDDEN em ação inline (sem modal de formulário aberto) vira feedback de erro", () => {
    const presentation = resolveServiceErrorPresentation("FORBIDDEN", "sem permissão", "inline-action");
    expect(presentation).toEqual({ kind: "feedback", tone: "error", message: "Você não tem permissão para esta ação." });
  });

  it.each(["NETWORK_ERROR", "UNKNOWN"] as ServiceErrorCode[])(
    "%s em formulário vira banner, preservando o formulário preenchido",
    (code) => {
      const presentation = resolveServiceErrorPresentation(code, "Falha de conexão.", "form");
      expect(presentation).toEqual({ kind: "banner", message: "Falha de conexão." });
    },
  );

  it.each(["NETWORK_ERROR", "UNKNOWN"] as ServiceErrorCode[])(
    "%s em ação inline (sem modal aberto) vira feedback de erro",
    (code) => {
      const presentation = resolveServiceErrorPresentation(code, "Falha de conexão.", "inline-action");
      expect(presentation).toEqual({ kind: "feedback", tone: "error", message: "Falha de conexão." });
    },
  );
});
