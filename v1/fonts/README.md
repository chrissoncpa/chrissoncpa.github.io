# Fonts

`InterVariable-subset.woff2` is a subset build of Inter Variable, not the
upstream file. **345 KB → 75 KB (-78%).**

## What was cut

- **Glyphs** — kept Latin-1 Supplement, General Punctuation, arrows, and a
  few common symbols. Dropped Cyrillic, Greek, Vietnamese, and the extended
  Latin sets. The kept range is a deliberate superset of the characters the
  site uses today, so ordinary copy edits (accented names, curly quotes,
  ellipses, en/em dashes, `→`) will not produce tofu.
- **Weight axis** — instanced from `100–900` down to `400–700`, the only
  range this design uses. The `opsz` (optical size) axis is preserved.

## ⚠ Constraint

`styles.css` declares `font-weight: 400 700` to match the axis. A weight
outside that range will **silently clamp** rather than visibly fail. If the
design needs one, rebuild the subset with a wider range — don't just widen
the CSS declaration.

## Rebuild

Requires `fonttools` and `brotli`:

```bash
python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
```

Then, from the repo root with an upstream `InterVariable.woff2` present:

```bash
UNI="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD"
/tmp/fontenv/bin/fonttools varLib.instancer InterVariable.woff2 wght=400:700 -o /tmp/inter-inst.ttf --no-optimize
/tmp/fontenv/bin/pyftsubset /tmp/inter-inst.ttf --output-file=fonts/InterVariable-subset.woff2 --flavor=woff2 --layout-features='*' --unicodes="$UNI"
```

After rebuilding, verify coverage against the live copy before shipping —
render the page and confirm no tofu, and check that 400/500/600/700 still
render as visibly distinct weights.

Upstream: https://github.com/rsms/inter (SIL Open Font License 1.1)
