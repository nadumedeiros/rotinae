Deno.serve((request) => {
  const incoming = new URL(request.url);
  const target = incoming.searchParams.get("target") === "app"
    ? new URL("rotinae://subscription-return")
    : new URL(Deno.env.get("MERCADO_PAGO_RETURN_URL") ?? "http://localhost:8081/subscription-return");
  incoming.searchParams.forEach((value, key) => {
    if (key !== "target") target.searchParams.set(key, value);
  });
  return Response.redirect(target, 302);
});
