import { parsePushNotificationData } from "../push-notification-data";

describe("parsePushNotificationData", () => {
  it("aceita uma notificação com destino interno conhecido", () => {
    expect(
      parsePushNotificationData({
        notificationId: "notification-1",
        recipientUserId: "user-1",
        destination: "/client-booking",
      }),
    ).toEqual({
      notificationId: "notification-1",
      recipientUserId: "user-1",
      destination: "/client-booking",
    });
  });

  it("rejeita destinos externos ou desconhecidos", () => {
    expect(
      parsePushNotificationData({
        notificationId: "notification-1",
        recipientUserId: "user-1",
        destination: "https://example.com",
      }),
    ).toBeNull();
  });

  it("rejeita payload sem identificador", () => {
    expect(parsePushNotificationData({ destination: "/agenda" })).toBeNull();
  });
});
