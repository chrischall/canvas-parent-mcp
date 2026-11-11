import {
  UNTRUSTED_CONTENT_RULE,
  minifiedResult,
  resolveView,
  stripMediaUrls,
  untrustedEnvelope,
  viewParam,
  type View,
} from '@chrischall/mcp-utils';
import { attr, decodeEntities, htmlToMarkdown, type HtmlReadOptions, type RichElement } from '@chrischall/mcp-utils/rich';
import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * The rungs this server honours (`@chrischall/mcp-utils`' `view` vocabulary;
 * `chrischall/workflows` `docs/fleet-conventions.md`, "Response shape").
 *
 * **What compact does here, and what it deliberately does NOT do.**
 *
 * Every read tool in this server hands back Canvas's payload verbatim —
 * `textContent(await client.request(path))`, with no projection anywhere. So
 * nothing here can honestly say which of Canvas's fields matter and which are
 * noise, and inventing a field list would risk a record coming back with holes
 * in it that reads like a verified answer.
 *
 * Compact therefore does the one projection that needs no such knowledge: it
 * strips avatar URLs. That is SUBTRACTIVE, so it cannot lose a field nobody
 * knew about.
 *
 * The one other thing compact does is read teacher-written HTML as Markdown,
 * on the tools that opt in (`{ html: true }`): see {@link markdownBodies}.
 * That rewrites a value rather than removing one, and `full` keeps the HTML.
 *
 * `raw` is not offered. There is no normalisation layer here for `full` to sit
 * above — `full` already IS Canvas's untouched payload, and advertising a rung
 * that aliases to another one is exactly what `viewParam` warns against.
 */
export const CV_VIEWS = ['compact', 'full'] as const;

const NOTE =
  'compact removes the avatar URLs Canvas attaches to user objects (avatar_url, avatar_image_url); ' +
  '"full" returns Canvas\'s payload untouched. Link fields (url, html_url, preview_url) survive both rungs. ' +
  'No field projection: this server passes Canvas\'s payload through verbatim and has no verified record of ' +
  'which of its fields a caller needs.';

const HTML_NOTE =
  ' On compact, the HTML Canvas stores teacher-written text in (message, description, syllabus_body, body, ' +
  'lock_explanation, long_description) comes back as Markdown: lists, tables, emphasis and links kept, styling ' +
  'and hidden text dropped, images as [alt text]. "full" keeps the HTML.';

/** What a read's `view` does beyond avatars: `html` when its payload carries Canvas rich-content HTML. */
export interface ViewOptions {
  html?: boolean;
}

/** The `view` parameter the read tools take. */
export const viewArg = (opts: ViewOptions = {}): ReturnType<typeof viewParam> =>
  viewParam(CV_VIEWS, { note: opts.html === true ? NOTE + HTML_NOTE : NOTE });

/**
 * The keys Canvas stores rich-content-editor HTML under, at any depth: an
 * announcement's or discussion's `message`, an assignment's or calendar
 * event's `description` (also nested under a submission's `assignment`), a
 * course's `syllabus_body`, an online-text submission's `body`, a locked
 * assignment's `lock_explanation`, and a rubric criterion's
 * `long_description`.
 *
 * `body` is why this is opt-in per tool: a conversation message's `body` is
 * plain text with meaningful newlines, and the conversation tools do not opt
 * in. A value under one of these keys is converted only when it holds a tag,
 * so a plain-text one (a rubric criterion's `description`) is left byte for
 * byte.
 */
const HTML_FIELDS = new Set(['message', 'description', 'syllabus_body', 'body', 'lock_explanation', 'long_description']);
const HAS_TAG = /<\/?[a-z][a-z0-9]*[\s/>]/i;

/**
 * How two Canvas elements read, beyond the shared reader's defaults.
 *
 * - An `<iframe>` (an embedded YouTube video or Google Doc) reads as nothing
 *   by default, which loses the only pointer to it. It reads as a link to its
 *   http(s) `src`, labelled with its `title` (else the bare address); any
 *   other `src` stays nothing.
 * - Canvas appends a screen-reader-only "Links to an external site." to every
 *   external link, which reads glued onto the label (`Grading CategoriesLinks
 *   to an external site.`). That span is dropped; any other screen-reader
 *   label is kept, since on an icon-only link it is the link's only name.
 */
const EXTERNAL_LINK_NOTE = /^\(?\s*Links to an external site\.?\s*\)?$/i;

function embedLink(el: RichElement): string {
  const src = decodeEntities(attr(el.attrs, 'src') ?? '').trim();
  if (!/^https?:\/\//i.test(src)) return '';
  const title = decodeEntities(attr(el.attrs, 'title') ?? '').replace(/[\s[\]]+/g, ' ').trim();
  const href = src.replace(/[()\s]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)));
  return title === '' ? href : `[${title}](${href})`;
}

/** Only ever passed to `htmlToMarkdown`, so every call is for Markdown output. */
const READ: HtmlReadOptions = {
  element: (el, _output, inner) => {
    if (el.tag === 'iframe') return embedLink(el);
    return /(?:^|\s)screenreader-only(?:\s|$)/.test(attr(el.attrs, 'class') ?? '') && EXTERNAL_LINK_NOTE.test(inner.trim())
      ? ''
      : undefined;
  },
};

/**
 * `data` with every Canvas HTML body ({@link HTML_FIELDS}) read as Markdown, as
 * a copy: the caller's payload is never rewritten. Markdown keeps what a
 * reader acts on — lists, tables, emphasis, links with their text — at about
 * the size of plain text; on a live observer account it cut announcement
 * bodies by 45% and assignment descriptions by a third. Content the teacher
 * hid is dropped, as is styling.
 */
export function markdownBodies(data: unknown, key?: string): unknown {
  if (typeof data === 'string') {
    return key !== undefined && HTML_FIELDS.has(key) && HAS_TAG.test(data) ? htmlToMarkdown(data, READ) : data;
  }
  if (Array.isArray(data)) return data.map((v) => markdownBodies(v));
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, markdownBodies(v, k)]));
  }
  return data;
}

/**
 * `url`, `html_url` and `preview_url` are KEPT, by name.
 *
 * These are Canvas's LINK fields, not decoration: `html_url` opens the item in
 * the web app, `preview_url` renders a submission, and `url` is the download
 * handle `canvas_list_course_files` documents and `canvas_download_file`
 * consumes — and on an `online_url` submission it is the student's submitted
 * work itself.
 *
 * Naming them is what makes their survival DETERMINISTIC. None of them matches
 * a media KEY, so today they are at risk only from the VALUE rule, which drops
 * any http string whose path ends in an image extension. Canvas normally hands
 * back the `/files/:id/download?verifier=…` form, which has no extension to
 * match — but a student who submits a link to `…/diagram.png` would have had
 * their submission silently removed from the compact rung, and nothing in the
 * response would have explained it.
 */
const KEEP = ['url', 'html_url', 'preview_url'] as const;

/**
 * `avatar_url` and `avatar_image_url` are DROPPED by name.
 *
 * They no longer HAVE to be. When this was written the built-in `MEDIA_KEY`
 * anchored a media noun at the start and allowed only a `Link|Uri|Url` suffix
 * run directly against it, so it matched `avatarUrl` and bare `avatar` but
 * neither of Canvas's snake_case spellings — and Canvas names every media field
 * in snake_case, so the key rule removed nothing here. mcp-utils 0.23.1
 * (#198/#201) made the separator optional and allowed a bounded qualifier
 * prefix, which covers both.
 *
 * They stay because a repo naming the fields it means to drop is more legible
 * than one relying on a library pattern to keep matching them, and because this
 * list is what the live-payload verification was done against. It is now
 * belt-and-braces rather than the only thing holding.
 *
 * The VALUE rule fires only by accident: Canvas's DEFAULT avatar is
 * `…/images/messages/avatar-50.png`, which ends in an image extension and is
 * dropped — but a user who has UPLOADED a picture gets
 * `…/images/thumbnails/11689524/MVccGAaJXYRhHy4rIGaKBbKGeht3umUwFgXObNVu`, an
 * extension-less thumbnail id, which survives. Both spellings appeared in a
 * single live `canvas_list_conversations` response, one participant per form.
 * Leaving it to the built-in rules would have produced a payload where one
 * participant kept their avatar and the other lost it, with the difference
 * turning on whether they had ever uploaded a photo.
 *
 * Naming them closes both gaps at once, and pins the removal to a field name
 * rather than to the shape of a CDN URL that Canvas is free to change.
 */
const DROP = ['avatar_url', 'avatar_image_url'] as const;

/**
 * Answer in the requested rung.
 *
 * Called from a READ tool whose payload embeds a Canvas user object — a
 * conversation participant, a discussion or announcement author, a submission
 * comment's author, a course's teachers, an observee, or the profile itself;
 * those are the only places Canvas hangs an avatar — or teacher-written HTML.
 * The HTML reads pass `{ html: true }` (announcements, discussions, the
 * course's syllabus, submissions, assignments, missing submissions, calendar
 * and upcoming events); the conversation tools do not, since an inbox
 * message's `body` is plain text.
 *
 * The tools left out are left out on purpose. `canvas_list_courses`,
 * `canvas_list_planner_items` and `canvas_list_enrollments` return neither — a
 * live `canvas_list_courses` over twelve courses carried no media field of any
 * kind, and live planner items carried no HTML — and a `view` parameter that
 * changes nothing is worse than no parameter. `canvas_list_course_files` and
 * `canvas_download_file` are left out for the opposite reason: their PRODUCT is
 * the URL.
 */
export function viewResponse(
  view: string | undefined,
  data: unknown,
  opts: ViewOptions = {},
): ReturnType<typeof minifiedResult> {
  const rung: View = resolveView(view, CV_VIEWS);
  if (rung !== 'compact') return minifiedResult(data);
  const read = opts.html === true ? markdownBodies(data) : data;
  return minifiedResult(stripMediaUrls(read, { keep: KEEP, drop: DROP }));
}

/**
 * Answer a `view: "brief"` read whose lines carry third-party text (a
 * teacher-written assignment title): the lines as the untrusted-data
 * envelope's `data` array — `{ untrusted_content: true, note, data: string[] }`,
 * minified, markers first — so the marker precedes the text wherever the
 * result is read. A host composing a group answer (mcp-host's intent tools)
 * unwraps the envelope and takes `data` as the lines. An empty list is the
 * caller's to turn into the `-- none` note.
 */
export function untrustedBriefResponse(lines: string[], whoWrote: string): CallToolResult {
  const payload = untrustedEnvelope(lines, { note: `${whoWrote} ${UNTRUSTED_CONTENT_RULE}` });
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
