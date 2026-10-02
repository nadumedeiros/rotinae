import type { ClientPortfolioPort } from "../client-portfolio-port";
import { loadAllClients } from "../load-all-clients";
import type { Client, Page } from "../types";

const client = (id: string): Client => ({
  id,
  clientUserId: null,
  recordOrigin: "provider_created",
  name: `Cliente ${id}`,
  email: `${id}@example.com`,
  phone: null,
  communicationPreferences: {
    whatsappAppointmentConfirmation: false,
    whatsappAppointmentReminder: false,
  },
  status: "active",
  primaryService: null,
  primaryServiceId: null,
  serviceValueCents: 0,
  bookingPolicy: {
    totalBookingLimit: null,
    dailyBookingLimit: null,
    requestWindowStart: null,
    requestWindowEnd: null,
  },
  lastServiceAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

function portfolioWithPages(pages: Page<Client>[]): ClientPortfolioPort {
  return {
    listClients: jest.fn(async ({ page }) => pages[page - 1]),
  } as unknown as ClientPortfolioPort;
}

describe("loadAllClients", () => {
  it("trata carteira vazia como resultado normal", async () => {
    const portfolio = portfolioWithPages([
      { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
    ]);

    await expect(loadAllClients(portfolio)).resolves.toEqual([]);
    expect(portfolio.listClients).toHaveBeenCalledTimes(1);
  });

  it("reúne todas as páginas reais sem inserir fallback", async () => {
    const portfolio = portfolioWithPages([
      { items: [client("1")], page: 1, pageSize: 10, totalItems: 2, totalPages: 2 },
      { items: [client("2")], page: 2, pageSize: 10, totalItems: 2, totalPages: 2 },
    ]);

    await expect(loadAllClients(portfolio)).resolves.toEqual([client("1"), client("2")]);
    expect(portfolio.listClients).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 10 });
    expect(portfolio.listClients).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 10 });
  });
});
