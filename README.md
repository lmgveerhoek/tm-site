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
`tm.allocentric.nl/<slug>/`. If a document fails to compile nothing is deployed and
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

A course repo with submodules passes `with: { submodules: true }` in its `site.yml`. For a private submodule it also needs the secret `SUBMODULES_TOKEN`: a fine-grained token with read-only Contents access to that submodule repo.


Each course repo and this repo need the Actions secrets `CLOUDFLARE_API_TOKEN`
(template "Edit Cloudflare Workers", including Workers Routes write access on the
`allocentric.nl` zone) and `CLOUDFLARE_ACCOUNT_ID`. The zone must be active in the
same Cloudflare account. The hub's custom domain creates its DNS record and TLS
certificate automatically; no separate Pages project is needed.

Publish the hub first with the "Publish hub" workflow, then run "Publish site"
in each of the five course repos. A green workflow with a skipped Deploy step
checks the build but does not publish the site.

### Manage credentials with 1Password

The single source of truth is the item **Cloudflare Credentials - TM site** in
the **Private** vault, fields `cloudflare_api_token` and `cloudflare_account_id`.
`cloudflare-secrets.yaml` contains only references and the six target repositories.
S3 credentials in the same item are not read or uploaded by this task.

With 1Password CLI (`op`) authenticated and GitHub CLI (`gh`) logged in as a repo
admin, run from this repo:

```sh
mise run cloudflare-secrets -- --dry-run  # Check both fields and access; no writes
mise run cloudflare-secrets              # Set/update both secrets in all six repos
```

Values are read into memory and sent to `gh secret set` through stdin, never
command-line arguments, logs or temporary files. Every repository is checked
before any upload. If individual uploads fail, the task attempts the remaining
uploads, reports which ones failed and exits nonzero. Running it again is safe.

For rotation, create the replacement Cloudflare token, update
`cloudflare_api_token` in this 1Password item, and run the same task once. Revoke
the old token after all uploads succeed and deployment with the new one works.
Adding GitHub secrets does not itself trigger a deployment.

### Deferred idea: Infisical with GitHub OIDC

Infisical is already in use, but keep the working 1Password/mise workflow for
now. Migrating these two credentials is not a prerequisite for publishing the
site. Revisit when token rotation becomes a nuisance, more projects need shared
secrets, or deployment workflows are being revised anyway.

The proposed migration is to fetch the Cloudflare secrets from Infisical during
each Actions job using OIDC, without a stored Infisical client secret or Cloudflare
secret copies in GitHub. Scope the CI identity to the six repositories and their
production context. Add `id-token: write` to both the hub and reusable-workflow
callers, and replace the existing `HAS_TOKEN` checks and `${{ secrets.* }}`
environment overrides so they use the fetched values. Test both hub and course
deployments before removing the old GitHub secrets. Infisical must be reachable
for new deployments; the published static site does not depend on it at runtime.

Reference: [Infisical GitHub Actions integration](https://infisical.com/docs/integrations/cicd/githubactions).

### Deferred idea: one protected entry point

Publish the current site first. A future version could put a Dutch shared-password
login with Cloudflare Turnstile in the hub Worker, before any page or PDF is served.
Use server-side password and Turnstile validation plus a signed session cookie;
a client-side password screen would not protect direct document links.

Keep independent course builds, but route their requests through the hub using
internal Service Bindings. Remove the course Workers' public routes and other
public entry points so the central login cannot be bypassed. Cloudflare Access
with individual email authentication is an alternative if shared access no longer
suits the audience. Test direct PDF access, session expiry and logout before enabling.

Video links may remain public by design; no private bucket or signed video URLs
are requested. This is a future idea only: the current publication adds no login,
captcha or gateway restructuring.
