# tm-site

Generator and landing page for the public Technical Medicine study site. Each
course repo publishes its own page; this repo holds what they share.

- `build.ts` builds one course page from that repo's `site.yaml` (or `site.json`).
- `bin/tm-video` prepares and uploads lecture videos, then prints an entry for the same course config.
- `template.html` is the course page; `hub/public/` is the landing page, the stylesheet and the self-hosted fonts (Montserrat and Lato, SIL Open Font License 1.1).
- `.github/workflows/publish.yml` is the reusable workflow every course repo calls on a push to `main`.
- `.github/workflows/hub.yml` deploys the landing page.

## How a course page updates

A push to `main` in a course repo starts its `.github/workflows/site.yml`, which
calls `publish.yml` here. That compiles every document in the site config with
Typst, writes `dist/<slug>/`, and deploys it as the Worker `tm-<slug>` on
`tm.veerhoek.eu/<slug>/`. If a document fails to compile nothing is deployed and
the live page stays as it was.

Course pages are not rebuilt when this repo changes. Run "Publish site" by hand
in a course repo (Actions tab) to pick up a new template.

## site.yaml

The config may be `site.yaml`, `site.yml` or `site.json`; the first one found is used.

```yaml
slug: asa
code: TM12001
title: Advanced Signal Acquisition
subtitle: Samenvatting, stappenplannen en toetsanalyse
docs:
  - section: Samenvatting
    title: Volledige samenvatting
    typ: summary/main.typ
    out: samenvatting.pdf
  - section: Per lecture
    title: Lecture 2
    typ: summary/main.typ
    inputs: { only: lecture-2 }
    out: lecture-2.pdf
  - section: Opdrachten
    title: Opdrachten lecture 1
    pdf: assignments/print-ready/ASA-Lecture-1-Assignments.pdf
```

Only what is listed is published. Per document:

| Field | Meaning |
|---|---|
| `section`, `title` | Where and how it is listed. Sections appear in order of first use. |
| `typ` | Typst entrypoint to compile. Needs `out`. |
| `pdf` | Tracked PDF to copy as is. |
| `inputs` | Passed to Typst as `--input key=value`, for example `{ "only": "lecture-2" }`. |
| `watch` | Paths whose last commit sets the "bijgewerkt op" date. Defaults to the folder of `typ`, or the `pdf` itself. |
| `note` | Small line under the title. |

Set `"index": true` at the top level to let search engines index the page.

## Recordings

`videos` lists lecture recordings as in-page players. Recordings are far larger
than the 25 MiB asset limit, so they never pass through git or the build: they
are published to object storage with this repo's `bin/tm-video`, which also
prints the entry to paste here. The page only embeds and links them.

```yaml
video_base: https://<bucket>.fsn1.your-objectstorage.com
videos:
  - section: Opnames
    title: Lecture 1 — Signals and DC circuits
    file: lecture-1-0123456789abcdef.mp4
    original: lecture-1-original-fedcba9876543210.mov
    note: "1:28:33"
    date: "2026-09-08"
    bytes: 387123456
    originalBytes: 711111111
```

| Field | Meaning |
|---|---|
| `section`, `title`, `note` | As for documents; `note` suits the duration. |
| `file` | Encoded 1080p MP4 under `<video_base>/<slug>/`, used by the player. |
| `original` | Untouched original under the same prefix, offered as download. |
| `date` | Date shown; recordings are untracked, so it is given by hand. |
| `bytes`, `originalBytes` | Sizes for the meta line; printed by `tm-video`. |

`video_base` must be an HTTPS URL; it can be set per course, or once as
`VIDEO_BASE` in `build.ts`. The uploader prints content-hashed filenames so
updated encodes cannot be confused with cached versions. URLs are public;
noindex pages reduce discoverability but do not restrict access.

### Publishing a recording

From the `tm-site` checkout:

```sh
bin/tm-video --repo <course-repo> --file <recording.mp4|.mov> --name lecture-5 --title "Lecture 5 — Biomarkers" [options]
# The same command is available through mise:
mise run video -- --repo <course-repo> --file <recording> --name lecture-5 --title "Lecture 5 — Biomarkers" [options]
```

From a course checkout, use `../tm-site/bin/tm-video --repo . --file ...`.

The publisher encodes a web MP4 (`libx264`, CRF 24, AAC, `+faststart`) capped at
1920×1080 without upscaling, uploads it and the untouched original to the media
bucket (`<slug>/<name>-<content-hash>.mp4` and
`<slug>/<name>-original-<content-hash>.<ext>`), then prints the entry to paste
under `videos`. Original files have `Content-Disposition: attachment`.

The encode is kept in `<recording-directory>/derived/web/<slug>/`. Ignore that
directory in the recording repository. A cache manifest records the source
hash, encoding settings and completed output hash. Failed encodes cannot replace
a completed file; retries reuse only a matching, intact encode. Pass `--reencode`
to force a new encode. Content-hashed object names make immutable caching safe
when sources or settings change.

Rclone uploads use S3 system metadata for MIME type, caching and disposition.
The command checks public access, sizes and MIME types, the original's download
header, and byte-range seeking before printing the config entry. Uploads run
locally, independently of the GitHub Actions site build.

Options: `--section` (default "Opnames"), `--date` (default the recording's
mtime), `--crf`, `--preset`, `--remote` (default `tm-media`), `--bucket` (or
`TM_VIDEO_BUCKET`), `--base` (public bucket URL; defaults to the course's
`video_base`), `--reencode`, `--dry-run` (encodes locally but skips uploads and
network verification). Use `--date` for the lecture date if the file's mtime
does not reflect it. Configure the public base URL before a real upload.

One-time setup (create the bucket in Hetzner Console first):

```sh
brew install ffmpeg rclone
rclone config create tm-media s3 provider=Hetzner env_auth=true \
  endpoint=https://fsn1.your-objectstorage.com region=fsn1
```

Inject `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from 1Password into the
upload process environment; do not put their values on command lines or in
repository files. Set `--bucket` and the course's `video_base`, for example
`https://<bucket>.fsn1.your-objectstorage.com` (match your bucket's location).
Objects are uploaded with `--s3-acl public-read`.

### Verification

`bun test` runs the site, dashboard and video-publisher tests. The publisher
tests use local FFmpeg and simulated uploads; no credentials or network uploads
are needed. GitHub Actions installs FFmpeg and runs this same combined suite.

## Local build

```bash
mise install
mise run build -- ../TM12001-advanced-signal-acquisition
mise run preview
```

mise installs the pinned Bun and Typst from `mise.toml`. PDFs above 25 MiB are downsampled to
300 ppi with Ghostscript (`brew install ghostscript`); without it the build
stops at the first oversized document.

## Setup

Each course repo and this repo need the Actions secrets `CLOUDFLARE_API_TOKEN`
(template "Edit Cloudflare Workers", plus DNS edit on the zone for the hub's
custom domain) and `CLOUDFLARE_ACCOUNT_ID`.
