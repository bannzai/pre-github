import { tasklist } from "@mdit/plugin-tasklist";
import MarkdownIt, { type Env, type Token } from "markdown-it";
import { findLeaks, leakMarkStart, markLeaks, type LeakCounts, type LeakKind } from "./leaks";

/**
 * The GitHub Flavored Markdown renderer of the pages (documents/PROJECT.md, HTML pages). The
 * default preset brings tables, strikethrough, and fenced code with a `language-*` class.
 * `html: false` escapes raw HTML instead of passing it through, `linkify` turns bare URLs into
 * links, and `breaks` turns a line break inside a paragraph into `<br>`, as GitHub does in issue
 * and pull request bodies and comments. Link targets such as `javascript:` are refused by
 * markdown-it's default link validation. The class names of task lists are GitHub's.
 */
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(tasklist, {
  containerClass: "contains-task-list",
});

// GitHub autolinks only `http://` and `https://` URLs, `www.` hosts, and email addresses.
// linkify-it's fuzzy links would also turn file names such as `README.md` or `main.py` into
// links, because `.md` and `.py` are top-level domains, and its `//` schema would link
// `//README.md`, so both are off along with `ftp:`, and `www.` is added back on its own.
markdown.linkify
  .set({ fuzzyLink: false })
  .add("//", null)
  .add("ftp:", null)
  .add("www.", {
    validate: (text, pos) =>
      /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#:][^\s<]*[^\s<.,:;"')\]!?])?/i.exec(text.slice(pos))?.[0]
        .length ?? 0,
    normalize: (match) => {
      match.url = `http://${match.url}`;
    },
  });

/** The `env` of one render: the possible leaks marked so far (src/leaks.ts). */
type LeakEnv = Env & { leakCounts: LeakCounts };

/** The counts of the render whose `env` is `env` (a `LeakEnv`, as `renderMarkdown` passes it). */
function leakCountsOf(env: Env | undefined): LeakCounts {
  return (env as LeakEnv).leakCounts;
}

// Possible leaks are searched in the text markdown-it is about to escape, never in the HTML it
// wrote, so that a mark cannot split a tag or an entity. Text, inline code, and code blocks mark
// each match. A link's or an image's address and title, and an image's alt text, are not shown as
// text, so the whole link or image is wrapped in one `<mark>` per possible leak they hold; a link
// whose text is its address (an autolink) is left to its text. A link reference definition that
// no link uses is not rendered and not searched.
markdown.renderer.rules.text = (tokens, index, _options, env) =>
  markLeaks(tokens[index]!.content, leakCountsOf(env));
markdown.renderer.rules.code_inline = (tokens, index, _options, env, renderer) =>
  `<code${renderer.renderAttrs(tokens[index]!)}>${markLeaks(tokens[index]!.content, leakCountsOf(env))}</code>`;
markdown.renderer.rules.code_block = (tokens, index, _options, env, renderer) =>
  `<pre${renderer.renderAttrs(tokens[index]!)}><code>${markLeaks(tokens[index]!.content, leakCountsOf(env))}</code></pre>\n`;
markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index]!;
  // The first word of the info string names the language, as in markdown-it's own fence rule.
  const language = markdown.utils.unescapeAll(token.info).trim().split(/\s+/)[0];
  if (language) token.attrJoin("class", `${options.langPrefix}${language}`);
  return `<pre><code${renderer.renderAttrs(token)}>${markLeaks(token.content, leakCountsOf(env))}</code></pre>\n`;
};

/**
 * The kinds of the possible leaks that `token`, a link or an image, holds outside its text: in
 * its address `attribute`, its title, and an image's alt text, one entry per leak. None for an
 * autolink. Adds them to the counts of `env`. The address is searched decoded, since markdown-it
 * percent-encodes it (`/Users/太郎` would otherwise not read as a home directory path).
 */
function hiddenLeakKinds(
  token: Token,
  attribute: "href" | "src",
  env: Env | undefined,
): LeakKind[] {
  if (token.info === "auto") return [];
  const kinds = [
    markdown.normalizeLinkText(String(token.attrGet(attribute) ?? "")),
    String(token.attrGet("title") ?? ""),
    token.type === "image" ? token.content : "",
  ].flatMap((hiddenText) => findLeaks(hiddenText).map((leak) => leak.kind));
  for (const kind of kinds) leakCountsOf(env)[kind] += 1;
  return kinds;
}

/** markdown-it's own image rule, which the rule below wraps. */
const renderImage = markdown.renderer.rules.image!;
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const kinds = hiddenLeakKinds(tokens[index]!, "src", env);
  return `${kinds.map(leakMarkStart).join("")}${renderImage(tokens, index, options, env, renderer)}${"</mark>".repeat(kinds.length)}`;
};
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const kinds = hiddenLeakKinds(tokens[index]!, "href", env);
  // Links do not nest, so the first `link_close` after this token closes this link and its marks.
  for (let later = index + 1; kinds.length > 0 && later < tokens.length; later += 1) {
    if (tokens[later]!.type === "link_close") {
      tokens[later]!.meta = { leakMarkCount: kinds.length };
      break;
    }
  }
  return `${kinds.map(leakMarkStart).join("")}${renderer.renderToken(tokens, index, options)}`;
};
markdown.renderer.rules.link_close = (tokens, index, options, _env, renderer) =>
  `${renderer.renderToken(tokens, index, options)}${"</mark>".repeat(Number(tokens[index]!.meta?.leakMarkCount ?? 0))}`;

/**
 * The HTML of `text` rendered as GitHub Flavored Markdown, safe to insert into a page, with each
 * possible leak marked. Adds the marked leaks to `leakCounts`.
 */
export function renderMarkdown(text: string, leakCounts: LeakCounts): string {
  return markdown.render(text, { leakCounts } satisfies LeakEnv);
}
