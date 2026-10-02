import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sampleTransactionalData } from "./sample-data.mjs";
import {
  escapeEmailHtml,
  renderTransactionalEmail,
  transactionalTemplateIds,
} from "./transactional-templates.mjs";

test("renderiza todo o catálogo transacional em HTML e texto", () => {
  assert.equal(transactionalTemplateIds.length, 12);
  for (const id of transactionalTemplateIds) {
    const email = renderTransactionalEmail(id, sampleTransactionalData[id]);
    assert.equal(email.id, id);
    assert.match(email.subject, /\S/);
    assert.match(email.html, /^<!doctype html>/);
    assert.match(email.html, /agenda<span style="color:#5416FF;">ê<\/span>/);
    assert.match(email.text, /Equipe Rotinaê/);
    assert.doesNotMatch(email.html, /undefined|null/);
  }
});

test("escapa conteúdo fornecido pelo usuário", () => {
  const payload = {
    ...sampleTransactionalData.client_link_invitation,
    recipientName: '<img src=x onerror="alert(1)">',
  };
  const email = renderTransactionalEmail("client_link_invitation", payload);
  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.equal(escapeEmailHtml("A&B"), "A&amp;B");
});

test("recusa links inseguros e campos obrigatórios ausentes", () => {
  assert.throws(
    () =>
      renderTransactionalEmail("trial_started", {
        ...sampleTransactionalData.trial_started,
        actionUrl: "javascript:alert(1)",
      }),
    /deve usar HTTPS/,
  );
  assert.throws(
    () => renderTransactionalEmail("trial_started", { actionUrl: "https://app.agendae.com.br/planos" }),
    /Campo obrigatório ausente: recipientName/,
  );
});

test("remove quebras de linha do assunto", () => {
  const email = renderTransactionalEmail("appointment_request_received", {
    ...sampleTransactionalData.appointment_request_received,
    clientName: "Juliana\r\nBcc: atacante@example.com",
  });
  assert.doesNotMatch(email.subject, /[\r\n]/);
});

test("templates do Supabase usam apenas variáveis oficiais necessárias", async () => {
  const templates = {
    "confirmation.html": ["{{ .Email }}", "{{ .ConfirmationURL }}"],
    "recovery.html": ["{{ .Email }}", "{{ .ConfirmationURL }}"],
    "email-change.html": ["{{ .NewEmail }}", "{{ .ConfirmationURL }}"],
    "password-changed-notification.html": ["{{ .Email }}", "{{ .SiteURL }}"],
    "email-changed-notification.html": ["{{ .OldEmail }}", "{{ .SiteURL }}"],
  };
  for (const [file, variables] of Object.entries(templates)) {
    const html = await readFile(new URL(`./supabase/${file}`, import.meta.url), "utf8");
    assert.match(html, /^<!doctype html>/);
    for (const variable of variables) assert.ok(html.includes(variable), `${file} não contém ${variable}`);
  }
});

