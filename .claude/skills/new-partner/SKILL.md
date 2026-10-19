---
name: new-partner
description: Onboard a new partner organisation (school or company) from a name and website. Creates the organisation and campus location, records the campaign link, makes the branded QR code and writes the email text. Use when the user says "new partner", "create a partner", or gives a school or company name with a website.
---

# New partner onboarding

The user gives a name and usually a website, for example "Jebel Ali School https://jebelalischool.org".
The script `scripts/new-partner.py` does the database, QR and email work. Your job is the research and the checking.

## Steps

1. **Research the organisation.**
   - Official name and the campus or office address (fetch the website, then confirm elsewhere).
   - A logo: find the header logo URL on the site and download it into the scratchpad directory only. Look at it before using it.
   - Coordinates of the actual building. Look up the address with OpenStreetMap Nominatim (`https://nominatim.openstreetmap.org/search?q=...&format=json`, send a User-Agent header, at most 1 request per second), then cross-check with Overpass (`amenity=school` near the point) or a second source. Schools move: Jebel Ali School is in Damac Hills, not Jebel Ali Village. If sources disagree, ask the user.
   - Short code for `?client=`: lowercase letters, digits, underscore. Existing examples: `hixs`, `dhcm`, `tanglin_trust_school`, `ds_al_khawaneej`. Prefer an obvious one (initials for long names, full words for short ones).
2. **Dry run on dev** (the default, writes nothing):
   ```
   python3 scripts/new-partner.py --name "<Name>" --code <code> \
       --location "<Place name>|<lat>,<lng>" --logo-file <path> --met "on Monday"
   ```
   Show the user the name, code, link, location and logo, and the look-alike warning if any. Wait for a yes if anything is uncertain.
3. **Apply on dev** by adding `--apply`. The script creates the org, location and campaign link, makes `partner-kits/<code>/qr.png`, `qr.svg` and `email.txt`, runs a scan check on the QR and copies the email to the clipboard.
4. **Prod only when the user says so.** Run the same command with `--env prod --apply --confirm-prod`. The email and QR then use `https://communitycarpool.org/?client=<code>`. The QR points at prod, so the org must exist in prod before the email goes out. Never run prod unprompted.
5. **Tell the user** where the kit is, show the email text in the reply, mention if the logo needs `deploy-prod.sh` (logos copied into `orgs/` only appear after a frontend deploy), and that the QR must be attached manually.

## Options worth knowing

- `--logo-url <url>` hotlinks an existing hosted logo instead of copying a file (fragile, avoid unless the user prefers it).
- `--message` sets the line under the logo (default "Carpool platform for <name>").
- `--cross-matching` lets people match outside the organisation (default off).
- `--greeting "Dear Sarah,"`, `--met "on Monday"`, `--sender` adjust the email.
- Several `--location` flags are allowed for multi-site partners.

## Rules

- Dev first. Prod needs an explicit instruction from the user.
- The script refuses a code that already exists. Never edit or delete an existing org to make a run succeed.
- Do not use `SUPABASE_ACCESS_TOKEN` for this project, it may be another account's token. The script reads `~/.supabase/carpool-token`.
- If the QR scan check fails, do not send that QR. Tell the user and offer to make it in QR Code Monkey.
- Write the email with no em dashes and no contractions. The script template already follows this.
- Test partners created on dev stay on dev. Do not delete test data by name prefix, delete by exact `org_code` only.
