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

/** The HTML of `text` rendered as GitHub Flavored Markdown, safe to insert into a page. */
export function renderMarkdown(text: string): string {
  return markdown.render(text);
}
