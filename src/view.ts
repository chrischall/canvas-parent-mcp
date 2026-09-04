import { minifiedResult, resolveView, stripMediaUrls, viewParam, type View } from '@chrischall/mcp-utils';

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

/** The `view` parameter the avatar-carrying read tools take. */
export const viewArg = (): ReturnType<typeof viewParam> => viewParam(CV_VIEWS, { note: NOTE });

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
 * Only ever called from a READ tool whose payload embeds a Canvas user object —
 * a conversation participant, a discussion or announcement author, a submission
 * comment's author, a course's teachers, an observee, or the profile itself.
 * Those are the only places Canvas hangs an avatar.
 *
 * The tools left out are left out on purpose. `canvas_list_courses`,
 * `canvas_list_assignments`, `canvas_list_missing_submissions`,
 * `canvas_list_calendar_events`, `canvas_list_upcoming_events`,
 * `canvas_list_planner_items` and `canvas_list_enrollments` return no user
 * object — a live `canvas_list_courses` over twelve courses carried no media
 * field of any kind — and a `view` parameter that changes nothing is worse than
 * no parameter. `canvas_list_course_files` and `canvas_download_file` are left
 * out for the opposite reason: their PRODUCT is the URL.
 */
export function viewResponse(view: string | undefined, data: unknown): ReturnType<typeof minifiedResult> {
  const rung: View = resolveView(view, CV_VIEWS);
  return minifiedResult(rung === 'compact' ? stripMediaUrls(data, { keep: KEEP, drop: DROP }) : data);
}
