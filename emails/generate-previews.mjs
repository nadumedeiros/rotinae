import { mkdir, writeFile } from "node:fs/promises";

import { sampleTransactionalData } from "./sample-data.mjs";
import { renderTransactionalEmail, transactionalTemplateIds } from "./transactional-templates.mjs";

const outputDirectory = new URL("./previews/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const links = [];
for (const id of transactionalTemplateIds) {
  const email = renderTransactionalEmail(id, sampleTransactionalData[id]);
  await writeFile(new URL(`${id}.html`, outputDirectory), email.html, "utf8");
  links.push(`<li><a href="./${id}.html">${id}</a><span>${email.subject}</span></li>`);
}

const index = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia dos e-mails Rotinaê</title>
<style>body{margin:0;padding:40px 20px;background:#F7F5FF;color:#191725;font-family:Arial,sans-serif}.page{max-width:820px;margin:auto}.brand{color:#21065F;font-size:32px;font-weight:800}.brand b{color:#5416FF}.card{margin-top:24px;padding:28px;background:#fff;border:1px solid #E8E5EF;border-radius:20px;box-shadow:0 12px 32px rgba(33,6,95,.08)}ul{list-style:none;margin:0;padding:0}li{display:flex;gap:16px;justify-content:space-between;padding:16px 0;border-bottom:1px solid #E8E5EF}li:last-child{border:0}a{color:#5416FF;font-weight:700;text-decoration:none}span{color:#555264;text-align:right}@media(max-width:620px){li{display:block}span{display:block;margin-top:6px;text-align:left}}</style></head>
<body><main class="page"><div class="brand">agenda<b>ê</b></div><section class="card"><h1>Modelos transacionais</h1><p>Prévia gerada com dados fictícios. Os arquivos desta pasta não devem ser usados como fonte; altere o renderizador e gere novamente.</p><ul>${links.join("")}</ul></section></main></body></html>`;
await writeFile(new URL("index.html", outputDirectory), index, "utf8");
console.log(`Geradas ${transactionalTemplateIds.length} prévias em emails/previews.`);

