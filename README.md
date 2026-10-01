# tm-site

Generator and landing page for the public Technical Medicine study site. Each
course repo publishes its own page; this repo holds what they share.

- `build.ts` builds one course page from that repo's `site.yaml` (or `site.json`).
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
