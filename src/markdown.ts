import { tasklist } from "@mdit/plugin-tasklist";
import MarkdownIt, { type Env, type Token } from "markdown-it";
import { findLeaks, leakMarkStart, markLeaks, type LeakCounts } from "./leaks";

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
// each match. A link target or an image address is not shown, so the whole link or image is
// marked when its `href` or `src` holds a leak; a link whose text is its target (an autolink) is
// left to its text. Image alt text and link titles are not searched.
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
 * The start tag of the `<mark>` around a link or an image whose address `attribute` of `token`
 * holds possible leaks, or `""` when it holds none. Adds those leaks to the counts of `env`. The
 * address is searched decoded, since markdown-it percent-encodes it (`/Users/太郎` would
 * otherwise not read as a home directory path).
 */
function addressLeakMarkStart(token: Token, attribute: "href" | "src", env: Env | undefined) {
  const leaks =
    token.info === "auto"
      ? []
      : findLeaks(markdown.normalizeLinkText(String(token.attrGet(attribute) ?? "")));
  for (const leak of leaks) leakCountsOf(env)[leak.kind] += 1;
  return leaks.length === 0 ? "" : leakMarkStart(leaks.map((leak) => leak.kind));
}

/** markdown-it's own image rule, which the rule below wraps. */
const renderImage = markdown.renderer.rules.image!;
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const markStart = addressLeakMarkStart(tokens[index]!, "src", env);
  const image = renderImage(tokens, index, options, env, renderer);
  return markStart ? `${markStart}${image}</mark>` : image;
};
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const markStart = addressLeakMarkStart(tokens[index]!, "href", env);
  // Links do not nest, so the first `link_close` after this token closes this link and the mark.
  for (let later = index + 1; markStart && later < tokens.length; later += 1) {
    if (tokens[later]!.type === "link_close") {
      tokens[later]!.meta = { closesLeakMark: true };
      break;
    }
  }
  return `${markStart}${renderer.renderToken(tokens, index, options)}`;
};
markdown.renderer.rules.link_close = (tokens, index, options, _env, renderer) =>
  `${renderer.renderToken(tokens, index, options)}${tokens[index]!.meta?.closesLeakMark ? "</mark>" : ""}`;

/**
 * The HTML of `text` rendered as GitHub Flavored Markdown, safe to insert into a page, with each
 * possible leak marked. Adds the marked leaks to `leakCounts`.
 */
export function renderMarkdown(text: string, leakCounts: LeakCounts): string {
  return markdown.render(text, { leakCounts } satisfies LeakEnv);
}
