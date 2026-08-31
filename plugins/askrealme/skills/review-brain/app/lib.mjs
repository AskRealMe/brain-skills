import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKDOWN_LINK = /\[[^\]]+\]\(([^)]+\.md(?:#[^)]*)?)\)/g;
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

export const scanners = [
  {
    category: "Email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    reason: "This may identify a person or provide a direct way to contact them.",
    replacement: "[email redacted]",
    secret: false,
  },
  {
    category: "Phone number",
    pattern: /(?<![\d-])(?:(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}|\+\d{1,3}[ .-](?:\d[ .()-]?){6,13}\d)(?!\d)/gu,
    reason: "This may be a direct phone number for a person.",
    replacement: "[phone number redacted]",
    secret: false,
  },
  {
    category: "Local path",
    pattern: /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)(?:[\\/][^\s)\]}>"']*)?/giu,
    reason: "This may reveal a local account name and private directory structure.",
    replacement: "[local path redacted]",
    secret: false,
  },
  {
    category: "Credential",
    pattern: /(?:\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}["']?)/giu,
    reason: "This may be a secret that grants access to an account or service.",
    replacement: "[credential redacted]",
    secret: true,
  },
  {
    category: "Street address",
    pattern: /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,6}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b/giu,
    reason: "This looks like an address that may identify a home or workplace.",
    replacement: "[address redacted]",
    secret: false,
  },
];

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return { fields: new Map(), duplicates: new Set(), body: text };
  const fields = new Map();
  const duplicates = new Set();
  for (const line of match[1].split(/\r?\n/u)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (field) {
      if (fields.has(field[1])) duplicates.add(field[1]);
      fields.set(field[1], field[2]);
    }
  }
  return { fields, duplicates, body: text.slice(match[0].length) };
}

function parseScalar(value) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("Could not read BRAIN.md metadata.");
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}

export function parseBrainMetadata(text) {
  const { fields, duplicates, body } = parseFrontmatter(text);
  if (duplicates.has("uuid")) throw new Error("BRAIN.md frontmatter contains more than one UUID.");
  const uuid = parseScalar(fields.get("uuid"));
  if (uuid !== undefined && !UUID_RE.test(uuid)) {
    throw new Error("BRAIN.md frontmatter contains an invalid UUID.");
  }
  const heading = body.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const title = parseScalar(fields.get("title")) || heading;
  if (!title) throw new Error("Could not read a title from BRAIN.md.");
  const bodyWithoutHeading = body.replace(/^#\s+.+(?:\r?\n|$)/mu, "");
  const firstParagraph = bodyWithoutHeading
    .split(/\r?\n\s*\r?\n/u)
    .map((part) => part.trim())
    .find((part) => part && !/^(?:#{1,6}\s|[-*+]\s|\d+\.\s|```)/u.test(part));
  return {
    title,
    description: parseScalar(fields.get("description")) || firstParagraph || "",
    uuid: uuid?.toLowerCase() ?? null,
  };
}

export function normalizeMarkdownPath(value) {
  if (typeof value !== "string") throw new Error("The Markdown path is invalid.");
  let raw = value.trim();
  if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1);
  const withoutFragment = raw.split("#", 1)[0];
  if (
    !withoutFragment
    || withoutFragment.includes("\0")
    || withoutFragment.includes("\\")
    || path.posix.isAbsolute(withoutFragment)
    || /^[A-Za-z]:/u.test(withoutFragment)
  ) {
    throw new Error(`Rejected a link that leaves the brain directory: ${value}`);
  }
  const normalized = path.posix.normalize(withoutFragment);
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.split("/").includes("..")
    || path.posix.extname(normalized) !== ".md"
  ) {
    throw new Error(`Rejected a link that leaves the brain directory: ${value}`);
  }
  return normalized;
}

function isWithin(root, candidate) {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

function walkMarkdownFiles(brain) {
  const names = [];
  const visit = (directory, relativeDirectory = "") => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const name = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const fullPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links cannot be reviewed: ${name}`);
      if (stat.isDirectory()) {
        visit(fullPath, name);
        continue;
      }
      if (!stat.isFile() || path.extname(entry.name) !== ".md") {
        throw new Error(`The brain may contain only Markdown files and directories: ${name}`);
      }
      if (entry.name === "AGENTS.md" || entry.name === "brain.md" || (entry.name === "BRAIN.md" && name !== "BRAIN.md")) {
        throw new Error(`This file is not allowed in a public brain: ${name}`);
      }
      const real = fs.realpathSync(fullPath);
      if (!isWithin(brain, real)) throw new Error(`Rejected a file outside the brain directory: ${name}`);
      names.push(name);
    }
  };
  visit(brain);
  return names;
}

function resolveCatalogTargets(index, names) {
  const available = new Set(names.filter((name) => name !== "BRAIN.md"));
  const byStem = new Map();
  for (const name of available) {
    const stem = path.posix.basename(name, ".md").toLocaleLowerCase("en-US");
    const matches = byStem.get(stem) ?? [];
    matches.push(name);
    byStem.set(stem, matches);
  }
  const references = [];
  for (const match of index.matchAll(MARKDOWN_LINK)) {
    references.push({ index: match.index, kind: "markdown", value: match[1] });
  }
  for (const match of index.matchAll(WIKI_LINK)) {
    references.push({ index: match.index, kind: "wiki", value: match[1] });
  }
  references.sort((left, right) => left.index - right.index);

  const targets = [];
  for (const reference of references) {
    if (reference.kind === "markdown") {
      targets.push(normalizeMarkdownPath(reference.value));
      continue;
    }
    const raw = reference.value.trim();
    let target;
    if (raw.includes("/") || raw.endsWith(".md")) {
      target = normalizeMarkdownPath(raw.endsWith(".md") ? raw : `${raw}.md`);
    } else {
      const matches = byStem.get(path.posix.basename(raw, ".md").toLocaleLowerCase("en-US"));
      if (!matches?.length) throw new Error(`BRAIN.md links to a file that does not exist: ${raw}`);
      if (matches.length > 1) {
        throw new Error(`BRAIN.md contains an ambiguous wiki link. Use an explicit relative path: ${raw}`);
      }
      target = matches[0];
    }
    targets.push(target);
  }
  if (new Set(targets).size !== targets.length) throw new Error("The BRAIN.md file catalog contains duplicate links.");
  for (const target of targets) {
    if (!available.has(target)) throw new Error(`BRAIN.md links to a file that does not exist: ${target}`);
  }
  const expected = [...available].sort();
  if (JSON.stringify([...targets].sort()) !== JSON.stringify(expected)) {
    throw new Error("The BRAIN.md catalog does not match the Markdown files on disk.");
  }
  return targets;
}

export function loadBrain(brainArgument) {
  if (!path.isAbsolute(brainArgument)) throw new Error("The brain path must be absolute.");
  const brain = fs.realpathSync(brainArgument);
  if (!fs.statSync(brain).isDirectory()) throw new Error("The brain path is not a directory.");
  const names = walkMarkdownFiles(brain);
  if (!names.includes("BRAIN.md")) throw new Error("BRAIN.md is missing.");
  const index = fs.readFileSync(path.join(brain, "BRAIN.md"), "utf8");
  const targets = resolveCatalogTargets(index, names);
  const ordered = ["BRAIN.md", ...targets];
  const files = ordered.map((name) => {
    const filePath = path.join(brain, ...name.split("/"));
    const content = fs.readFileSync(filePath, "utf8");
    return { name, path: filePath, content, hash: sha256(content) };
  });
  return { brain, files, metadata: parseBrainMetadata(index) };
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInline(value) {
  let escaped = escapeHtml(value);
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_whole, label, href) => {
    try {
      const target = normalizeMarkdownPath(href);
      return `<button class="doc-link" type="button" data-file="${escapeHtml(target)}">${label}</button>`;
    } catch {
      return `${label} (${escapeHtml(href)})`;
    }
  });
  return escaped;
}

export function renderMarkdown(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html = [];
  let inCode = false;
  let listOpen = false;
  const closeList = () => {
    if (listOpen) html.push("</ul>");
    listOpen = false;
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.startsWith("```")) {
      closeList();
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }
    if (
      line.trim().startsWith("|")
      && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/u.test(lines[lineIndex + 1] ?? "")
    ) {
      closeList();
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      html.push("<div class=\"table-scroll\"><table><thead><tr>");
      for (const cell of cells(line)) html.push(`<th>${renderInline(cell)}</th>`);
      html.push("</tr></thead><tbody>");
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim().startsWith("|")) {
        html.push("<tr>");
        for (const cell of cells(lines[lineIndex])) html.push(`<td>${renderInline(cell)}</td>`);
        html.push("</tr>");
        lineIndex += 1;
      }
      lineIndex -= 1;
      html.push("</tbody></table></div>");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const list = line.match(/^[-*]\s+(.+)$/);
    if (list) {
      if (!listOpen) html.push("<ul>");
      listOpen = true;
      html.push(`<li>${renderInline(list[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim() && line !== "---" && !/^(title|description):\s/u.test(line)) {
      html.push(`<p>${renderInline(line)}</p>`);
    }
  }
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

export function scanFiles(files) {
  const findings = [];
  for (const file of files) {
    const occurrences = new Map();
    for (const scanner of scanners) {
      scanner.pattern.lastIndex = 0;
      for (const match of file.content.matchAll(scanner.pattern)) {
        const quote = match[0];
        const key = `${scanner.category}\0${quote}`;
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        const start = match.index;
        const end = start + quote.length;
        findings.push({
          id: sha256(`${file.name}\0${scanner.category}\0${start}\0${quote}`).slice(0, 16),
          source: "local",
          file: file.name,
          quote,
          occurrence,
          category: scanner.category,
          reason: scanner.reason,
          proposedAction: "mask",
          replacement: scanner.replacement,
          start,
          end,
          secret: scanner.secret,
        });
      }
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
}

export function redactSecrets(content) {
  let output = content;
  for (const scanner of scanners.filter((item) => item.secret)) {
    scanner.pattern.lastIndex = 0;
    output = output.replace(scanner.pattern, "[LOCAL_SECRET_REDACTED]");
  }
  return output;
}

function assertBackupOutsideBrain(session, backupRoot) {
  const resolvedBackupRoot = path.resolve(backupRoot);
  let existing = resolvedBackupRoot;
  const missing = [];
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonicalBackupRoot = path.resolve(fs.realpathSync(existing), ...missing);
  if (
    canonicalBackupRoot === session.brain
    || canonicalBackupRoot.startsWith(`${session.brain}${path.sep}`)
  ) {
    throw new Error("Backups must stay outside the brain directory.");
  }
  return resolvedBackupRoot;
}

function validateProposedBrain(session, outputs) {
  const contents = new Map(session.files.map((file) => [file.name, file.content]));
  for (const [name, content] of outputs) contents.set(name, content);
  const index = contents.get("BRAIN.md");
  const metadata = parseBrainMetadata(index);
  if (metadata.uuid !== session.metadata.uuid) {
    throw new Error("The review workspace cannot add, remove, or replace the BRAIN.md UUID.");
  }
  resolveCatalogTargets(index, session.files.map((file) => file.name));
  return metadata;
}

function assertNoSymlinkComponents(brain, name) {
  let cursor = brain;
  const segments = name.split("/");
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`Cannot save through a symbolic link: ${name}`);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`This path cannot be saved safely: ${name}`);
    if (index === segments.length - 1 && !stat.isFile()) throw new Error(`This file cannot be saved safely: ${name}`);
  }
}

export function assertSessionUnchanged(session) {
  let current;
  try {
    current = loadBrain(session.brain);
  } catch (error) {
    throw new Error(`The brain file set changed during review, so the operation was stopped: ${error.message}`);
  }
  const expected = new Map(session.files.map((file) => [file.name, file.hash]));
  if (current.files.length !== expected.size) throw new Error("The brain file set changed during review, so the operation was stopped.");
  for (const file of current.files) {
    if (!expected.has(file.name)) throw new Error("The brain file set changed during review, so the operation was stopped.");
    if (expected.get(file.name) !== file.hash) throw new Error(`A file changed during review, so the operation was stopped: ${file.name}`);
  }
}

export function saveDrafts(session, drafts, backupRoot) {
  if (!Array.isArray(drafts) || drafts.length === 0) throw new Error("There are no files to save.");
  const resolvedBackupRoot = assertBackupOutsideBrain(session, backupRoot);
  const byName = new Map(session.files.map((file) => [file.name, file]));
  const outputs = new Map();
  for (const draft of drafts) {
    if (!draft || typeof draft.name !== "string" || typeof draft.content !== "string") {
      throw new Error("A file draft has an invalid format.");
    }
    if (outputs.has(draft.name)) throw new Error(`The same file cannot be saved twice: ${draft.name}`);
    const original = byName.get(draft.name);
    if (!original) throw new Error(`This file is not part of the review session: ${draft.name}`);
    if (draft.content !== original.content) outputs.set(draft.name, draft.content);
  }
  if (outputs.size === 0) return { changed: [], backup: null };
  const metadata = validateProposedBrain(session, outputs);
  const originals = new Map();
  const modes = new Map();
  for (const [name] of outputs) {
    const original = byName.get(name);
    const target = original.path;
    assertNoSymlinkComponents(session.brain, name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`This file cannot be saved safely: ${name}`);
    const real = fs.realpathSync(target);
    if (!real.startsWith(`${session.brain}${path.sep}`)) throw new Error(`Rejected a file outside the brain directory: ${name}`);
    const current = fs.readFileSync(real, "utf8");
    if (sha256(current) !== original.hash) throw new Error(`The file changed during review and was not saved: ${name}`);
    originals.set(name, current);
    modes.set(name, stat.mode & 0o777);
  }

  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backup = path.join(resolvedBackupRoot, session.id, `save-${stamp}-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const [name] of outputs) {
    const backupPath = path.join(backup, ...name.split("/"));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(backupPath, originals.get(name), { encoding: "utf8", mode: 0o600 });
  }
  fs.writeFileSync(
    path.join(backup, "manifest.json"),
    `${JSON.stringify({
      brain: session.brain,
      createdAt: new Date().toISOString(),
      files: [...outputs].map(([name, content]) => ({
        name,
        before: sha256(originals.get(name)),
        after: sha256(content),
      })),
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const temporary = [];
  const replaced = [];
  try {
    for (const [name, content] of outputs) {
      const target = byName.get(name).path;
      const temp = path.join(path.dirname(target), `.review-${session.id}-${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(temp, content, { encoding: "utf8", mode: modes.get(name) });
      temporary.push({ temp, target, name });
    }
    for (const item of temporary) {
      fs.renameSync(item.temp, item.target);
      replaced.push(item);
    }
  } catch (error) {
    for (const item of temporary) {
      if (fs.existsSync(item.temp)) fs.unlinkSync(item.temp);
    }
    for (const item of replaced) {
      const original = originals.get(item.name);
      if (original !== undefined) {
        const rollback = `${item.target}.rollback-${session.id}`;
        fs.writeFileSync(rollback, original, { encoding: "utf8", mode: modes.get(item.name) });
        fs.renameSync(rollback, item.target);
      }
    }
    throw error;
  }

  for (const [name, content] of outputs) {
    const file = byName.get(name);
    file.content = content;
    file.hash = sha256(content);
  }
  session.metadata = metadata;
  const changedNames = new Set(outputs.keys());
  session.findings = [
    ...session.findings.filter((finding) => !changedNames.has(finding.file)),
    ...scanFiles(session.files.filter((file) => changedNames.has(file.name))),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
  return { changed: [...outputs.keys()], backup };
}

export function createSession(brainArgument) {
  const loaded = loadBrain(brainArgument);
  return {
    id: crypto.randomUUID(),
    ...loaded,
    findings: scanFiles(loaded.files),
    createdAt: new Date().toISOString(),
  };
}

export function refreshSession(session) {
  const loaded = loadBrain(session.brain);
  session.brain = loaded.brain;
  session.files = loaded.files;
  session.metadata = loaded.metadata;
  session.findings = scanFiles(loaded.files);
  return session;
}

export function defaultReviewRoot() {
  return path.join(os.tmpdir(), "askrealme-review-brain");
}
