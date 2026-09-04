import { describe, it, expect } from 'vitest';
import { CV_VIEWS, viewArg, viewResponse } from '../src/view.js';

/** The single text block every tool result carries. */
const text = (r: { content: Array<{ type: string; text: string }> }) => r.content[0].text;
const parsed = (r: { content: Array<{ type: string; text: string }> }) => JSON.parse(text(r));

describe('CV_VIEWS / viewArg', () => {
  it('offers compact and full, and not raw', () => {
    // `raw` would alias to `full`: this server applies no normalisation on the
    // way out, so Canvas's untouched payload IS the `full` rung. Advertising a
    // third value that returns the same bytes decides nothing for a caller.
    expect(CV_VIEWS).toEqual(['compact', 'full']);
  });

  it('is optional, so an existing caller that passes no view still parses', () => {
    // Adding a required parameter to nine shipped tools would break every
    // caller that already knows their schemas.
    expect(viewArg().safeParse(undefined).success).toBe(true);
  });

  it('names both avatar fields in its description, since that is the only place a caller learns what compact removed', () => {
    const description = viewArg().description ?? '';
    expect(description).toContain('avatar_url');
    expect(description).toContain('avatar_image_url');
  });

  it('rejects a rung this server does not honour', () => {
    expect(viewArg().safeParse('raw').success).toBe(false);
  });
});

describe('viewResponse rungs', () => {
  const payload = { id: '1', name: 'Erik Hall', avatar_url: 'https://cms.instructure.com/images/messages/avatar-50.png' };

  it('compacts by default — an absent view is the cheap rung, not the expensive one', () => {
    // The whole point of the vocabulary: an efficiency a caller has to ask for
    // is one they usually do not get, and the caller paying for it is the one
    // least able to know it was available.
    expect(parsed(viewResponse(undefined, payload))).toEqual({ id: '1', name: 'Erik Hall' });
  });

  it('compacts on an explicit view:"compact"', () => {
    expect(parsed(viewResponse('compact', payload))).toEqual({ id: '1', name: 'Erik Hall' });
  });

  it('returns everything on view:"full"', () => {
    expect(parsed(viewResponse('full', payload))).toEqual(payload);
  });

  it('falls back to compact rather than throwing when a caller names an unhonoured rung', () => {
    // A caller who somehow asked for `raw` is better served by a small correct
    // response than by an error.
    expect(parsed(viewResponse('raw', payload))).toEqual({ id: '1', name: 'Erik Hall' });
  });

  it('emits a single line — the response carries no formatting whitespace', () => {
    expect(text(viewResponse('compact', payload))).not.toContain('\n');
    expect(text(viewResponse('full', payload))).not.toContain('\n');
  });
});

describe('compact drops the avatars the built-in rules miss', () => {
  it('drops an UPLOADED avatar, whose URL has no image extension', () => {
    // This is the case the explicit DROP rule exists for, and it is not
    // hypothetical: this exact value came back from a live
    // canvas_list_conversations. The key is snake_case, so MEDIA_KEY (anchored,
    // with no underscore-separated suffix form) does not match it; the value is
    // an extension-less thumbnail id, so the value rule does not match it
    // either. Left to the built-ins it would have survived compact untouched.
    const conversation = {
      id: '14849439',
      subject: "Ms Arch and Mr Webb's Students",
      avatar_url: 'https://cms.instructure.com/images/thumbnails/11689524/MVccGAaJXYRhHy4rIGaKBbKGeht3umUwFgXObNVu',
      participants: [
        { id: '8507', name: 'Sallie Davis', avatar_url: 'https://cms.instructure.com/images/thumbnails/11689524/MVccGAaJXYRhHy4rIGaKBbKGeht3umUwFgXObNVu' },
        { id: '712454', name: 'Chris Hall', avatar_url: 'https://cms.instructure.com/images/messages/avatar-50.png' },
      ],
    };
    expect(parsed(viewResponse('compact', conversation))).toEqual({
      id: '14849439',
      subject: "Ms Arch and Mr Webb's Students",
      participants: [
        { id: '8507', name: 'Sallie Davis' },
        { id: '712454', name: 'Chris Hall' },
      ],
    });
  });

  it('drops avatar_image_url on an author, which no built-in rule matches at all', () => {
    // Canvas names the author avatar on discussion topics, announcements and
    // submission comments `avatar_image_url`. MEDIA_KEY does not match it under
    // any of its forms, so without the explicit rule this field was untouchable.
    const topic = {
      id: '9',
      title: 'Week 3 reading',
      author: { id: '8507', display_name: 'Sallie Davis', avatar_image_url: 'https://cms.instructure.com/images/thumbnails/1/abc', html_url: 'https://cms.instructure.com/users/8507' },
    };
    expect(parsed(viewResponse('compact', topic))).toEqual({
      id: '9',
      title: 'Week 3 reading',
      author: { id: '8507', display_name: 'Sallie Davis', html_url: 'https://cms.instructure.com/users/8507' },
    });
  });

  it('drops both avatar spellings consistently, so one participant cannot keep theirs while another loses it', () => {
    // The failure the explicit rules prevent. Under the built-ins alone the
    // default `.png` avatar is removed by the value rule and the uploaded
    // extension-less one is not, producing a payload whose inconsistency turns
    // on whether a person ever uploaded a photo.
    const users = [
      { id: '1', avatar_url: 'https://cms.instructure.com/images/messages/avatar-50.png' },
      { id: '2', avatar_url: 'https://cms.instructure.com/images/thumbnails/2/xyz' },
      { id: '3', avatar_image_url: 'https://cms.instructure.com/images/thumbnails/3/xyz' },
    ];
    expect(parsed(viewResponse('compact', users))).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
  });
});

describe('compact keeps what a caller acts on', () => {
  it('keeps a submitted url even when it points at an image', () => {
    // An `online_url` submission IS a link, and a student who submits a link to
    // a .png would otherwise have their work removed by the value rule — the
    // response emptied rather than shrunk, with nothing in it to explain why.
    const submission = { id: '5', submission_type: 'online_url', url: 'https://example.com/diagram.png', preview_url: 'https://cms.instructure.com/courses/1/assignments/2/submissions/3?preview=1' };
    expect(parsed(viewResponse('compact', submission))).toEqual(submission);
  });

  it('keeps a download url of the /files/:id/download form', () => {
    // The shape Canvas actually hands back for an attachment. It has no image
    // extension ending its path, so the value rule leaves it alone anyway — but
    // KEEP pins that rather than leaving it to the shape of a URL.
    const attachment = { id: '77', display_name: 'syllabus.pdf', url: 'https://cms.instructure.com/files/77/download?verifier=abc' };
    expect(parsed(viewResponse('compact', attachment))).toEqual(attachment);
  });

  it('reaches snake_case media keys on its own since mcp-utils 0.23.1', () => {
    // This test previously pinned the OPPOSITE, and pinning it is why the
    // change was noticed: `MEDIA_KEY` used to anchor a media noun at the start
    // and allow only a Link|Uri|Url suffix run directly against it, so Canvas's
    // snake_case `thumbnail_url` matched nothing and the local DROP list had to
    // name `avatar_url` explicitly.
    //
    // mcp-utils#198/#201 made the separator optional and allowed a bounded
    // qualifier prefix, so the built-in rule now covers the whole snake_case
    // family. The DROP entries below are kept anyway — see src/view.ts.
    const out = parsed(viewResponse('compact', { id: '77', thumbnail_url: 'https://cms.instructure.com/images/thumbnails/77/abc' }));
    expect(out.thumbnail_url).toBeUndefined();
    expect(out.id).toBe('77');
  });

  it('keeps a null rather than removing the key', () => {
    // An absent key and a null one are the same to JSON.parse and not to a
    // reader deciding whether a question was answered.
    expect(parsed(viewResponse('compact', { id: '1', pronouns: null }))).toEqual({ id: '1', pronouns: null });
  });
});

describe('whitespace INSIDE a value is content', () => {
  it('preserves a message body byte for byte, blank lines and indentation included', () => {
    // Only FORMATTING whitespace goes. Any hand-rolled minifier — a regex over
    // the serialised text, a collapse of \\s+ — corrupts exactly the payloads
    // this exists to shrink, and an announcement body is the biggest one here.
    const body = 'Good afternoon,\n\n  Both teachers will be out.\n\n    Please stay in your 2nd block.\n\nThanks';
    const message = { id: '1', body, avatar_url: 'https://cms.instructure.com/images/thumbnails/1/abc' };

    const compact = parsed(viewResponse('compact', message));
    expect(compact.body).toBe(body);
    expect(compact).not.toHaveProperty('avatar_url');
    expect(parsed(viewResponse('full', message)).body).toBe(body);
  });

  it('emits one line even when a value contains newlines', () => {
    // The newlines that survive are inside the JSON string as \\n escapes, so
    // the serialised response is still a single physical line.
    const out = text(viewResponse('compact', { body: 'a\n\nb' }));
    expect(out).not.toContain('\n');
    expect(out).toBe('{"body":"a\\n\\nb"}');
  });
});

describe('viewResponse does not mutate its input', () => {
  it('leaves the caller\'s object intact', () => {
    // Several tools hand these helpers the object they just parsed; rewriting
    // it in place would make the compact rung leak into a later `full` read.
    const payload = { id: '1', avatar_url: 'https://cms.instructure.com/a.png' };
    viewResponse('compact', payload);
    expect(payload.avatar_url).toBe('https://cms.instructure.com/a.png');
  });
});
