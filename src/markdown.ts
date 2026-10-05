import { tasklist } from "@mdit/plugin-tasklist";
import MarkdownIt from "markdown-it";

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

// GitHub autolinks only URLs with a scheme, `www.` hosts, and email addresses. linkify-it's
// fuzzy links would also turn file names such as `README.md` or `main.py` into links, because
// `.md` and `.py` are top-level domains, so they are off and `www.` is added back on its own.
markdown.linkify.set({ fuzzyLink: false }).add("www.", {
  validate: (text, pos) =>
    /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*[^\s<.,:;"')\]!?])?/i.exec(text.slice(pos))?.[0]
      .length ?? 0,
  normalize: (match) => {
    match.url = `http://${match.url}`;
  },
});

/** The HTML of `text` rendered as GitHub Flavored Markdown, safe to insert into a page. */
export function renderMarkdown(text: string): string {
  return markdown.render(text);
}
